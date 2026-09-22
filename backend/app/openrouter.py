"""AI layer: uses OpenRouter to turn natural language into Laya-ready JSON."""
import json
import re
import time
from typing import Any

import httpx

from . import usage
from .config import get_openrouter_key, get_openrouter_model, settings

SYSTEM_PROMPT = """You convert a user's request into a JSON spec for the Laya decision model.

Laya takes a `state` (a string, or a JSON object such as an email/ticket) and a dict of typed `questions`.
Question types:
- "choice": pick one option. `criteria` is an object mapping option_name -> short description.
- "score": a 0..N ordinal rating. `criteria` is an ordered list of level descriptions (low -> high).
- "noul": yes/no probability. No criteria.

Every question needs a short `instructions` string phrased as a question.
Option/label names must be short snake_case identifiers.

Respond with ONLY a JSON object of the form:
{"state": <string or object or null>, "questions": {<name>: {"type": ..., "instructions": ..., "criteria": ...}}}
No markdown, no commentary.

The following question-writing guidance comes from the TypeSafe (Jev) agent skill; Laya and Jev
share this question schema, so follow it:

"""

CRITERIA_PROMPT = """You write one-line descriptions for classification labels so a small
decision model can pick between them. Given a dataset name and a list of labels, respond with ONLY
a JSON object mapping each label (exactly as given) to a concise description (max 15 words) of
what texts belong to that label. Do not add or rename labels."""


def _extract_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in model output: {text[:200]}")
    return json.loads(text[start : end + 1])


def system_prompt() -> str:
    from .question_guide import guide

    return SYSTEM_PROMPT + guide()


async def chat_messages(messages: list[dict[str, str]], purpose: str = "chat", json_mode: bool = True, temperature: float = 0.2) -> Any:
    """Generic chat completion. Returns parsed JSON (json_mode) or the raw text."""
    api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OpenRouter API key not set: add it in Settings or backend/.env")
    model = get_openrouter_model()
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "HTTP-Referer": "http://localhost:5173", "X-Title": "System One Playground"},
            json={"model": model, "messages": messages, "temperature": temperature},
        )
        if r.status_code >= 400:
            usage.record(purpose=purpose, engine="openrouter", model=model, latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=r.text[:200])
        r.raise_for_status()
        body = r.json()
    content = body["choices"][0]["message"]["content"]
    u = body.get("usage") or {}
    usage.record(purpose=purpose, engine="openrouter", model=model, input_tokens=u.get("prompt_tokens"), output_tokens=u.get("completion_tokens"),
                 latency_ms=(time.perf_counter() - t0) * 1000)
    return _extract_json(content) if json_mode else content


async def chat_json(system: str, user: str, purpose: str = "prepare") -> Any:
    api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OpenRouter API key not set: add it in Settings or backend/.env")
    model = get_openrouter_model()
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "System One Playground",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
            },
        )
        if r.status_code >= 400:
            usage.record(purpose=purpose, engine="openrouter", model=model, latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=r.text[:200])
        r.raise_for_status()
        body = r.json()
        content = body["choices"][0]["message"]["content"]
    u = body.get("usage") or {}
    usage.record(purpose=purpose, engine="openrouter", model=model, input_tokens=u.get("prompt_tokens"), output_tokens=u.get("completion_tokens"),
                 latency_ms=(time.perf_counter() - t0) * 1000)
    return _extract_json(content)


async def prepare_spec(description: str, sample_text: str | None) -> dict[str, Any]:
    user = f"Request:\n{description}"
    if sample_text:
        user += f"\n\nExample input the user wants to analyse:\n{sample_text}"
    return await chat_json(system_prompt(), user, purpose="prepare")


async def describe_labels(dataset_name: str, labels: list[str]) -> dict[str, str]:
    user = f"Dataset: {dataset_name}\nLabels: {json.dumps(labels)}"
    out = await chat_json(CRITERIA_PROMPT, user, purpose="criteria")
    # keep only known labels, fill gaps
    return {lab: str(out.get(lab) or lab.replace("_", " ")) for lab in labels}


async def validate_key(api_key: str) -> dict[str, Any]:
    """Check a key against OpenRouter without storing it. Returns label/limit info."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{settings.openrouter_base_url}/auth/key",
            headers={"Authorization": f"Bearer {api_key}"},
        )
    if r.status_code == 401:
        raise ValueError("OpenRouter rejected this key (401)")
    r.raise_for_status()
    return r.json().get("data", {})


# ---------------------------------------------------------------- model list
_models_cache: dict[str, Any] = {"at": 0.0, "data": []}


async def list_models(force: bool = False) -> list[dict[str, Any]]:
    """All models on OpenRouter (id, name, context, prices). Cached for 10 minutes."""
    import time

    if not force and _models_cache["data"] and time.time() - _models_cache["at"] < 600:
        return _models_cache["data"]
    headers = {}
    if get_openrouter_key():
        headers["Authorization"] = f"Bearer {get_openrouter_key()}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{settings.openrouter_base_url}/models", headers=headers)
        r.raise_for_status()
    out = []
    for m in r.json().get("data", []):
        pr = m.get("pricing") or {}
        out.append({
            "id": m.get("id"), "name": m.get("name") or m.get("id"),
            "context": m.get("context_length"),
            "prompt_price": float(pr.get("prompt") or 0) * 1e6,      # $ per 1M tokens
            "completion_price": float(pr.get("completion") or 0) * 1e6,
            "structured": "response_format" in (m.get("supported_parameters") or []),
        })
    out.sort(key=lambda m: m["id"])
    _models_cache.update(at=time.time(), data=out)
    usage.set_prices(out)
    return out


# ---------------------------------------------------------------- LLM as decision engine
DECIDE_PROMPT = """You answer typed questions about a state, exactly like the Laya decision model.
For each question id, respond with one entry:
- type "choice": {"type":"choice","choice":"<one of the criteria keys>","confidence":<0..1>}
- type "score": {"type":"score","score":<index 0..N-1 of the matching criteria level, may be fractional>,"confidence":<0..1>}
- type "noul": {"type":"noul","noul":<probability 0..1 that the answer is yes>,"confidence":<0..1>}
Respond with ONLY a JSON object: {"answers": {<question id>: <entry>, ...}}. No commentary."""


async def decide(state: Any, questions: dict[str, Any], model: str) -> dict[str, Any]:
    user = "STATE:\n" + (state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)) + "\n\nQUESTIONS:\n" + json.dumps(questions, ensure_ascii=False)
    api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OpenRouter API key not set")
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "HTTP-Referer": "http://localhost:5173", "X-Title": "System One Playground"},
            json={"model": model, "temperature": 0, "messages": [{"role": "system", "content": DECIDE_PROMPT}, {"role": "user", "content": user}]},
        )
        if r.status_code >= 400:
            usage.record(purpose="decide", engine="openrouter", model=model, latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=r.text[:200])
        r.raise_for_status()
        body = r.json()
    u0 = body.get("usage") or {}
    usage.record(purpose="decide", engine="openrouter", model=model, input_tokens=u0.get("prompt_tokens"), output_tokens=u0.get("completion_tokens"),
                 latency_ms=(time.perf_counter() - t0) * 1000, extra={"questions": len(questions)})
    out = _extract_json(body["choices"][0]["message"]["content"])
    answers = out.get("answers", {})
    # normalise: make sure choice values are valid keys
    for qid, q in questions.items():
        a = answers.setdefault(qid, {"type": q.get("type")})
        a.setdefault("type", q.get("type"))
        if q.get("type") == "choice" and isinstance(q.get("criteria"), dict) and a.get("choice") not in q["criteria"]:
            # try case-insensitive match
            low = {k.lower(): k for k in q["criteria"]}
            a["choice"] = low.get(str(a.get("choice", "")).lower(), a.get("choice"))
    usage = body.get("usage") or {}
    return {"model": model, "answers": answers, "usage": {"input_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens")},
            "routing": {"model": f"openrouter:{model}", "repo": model, "reason": "LLM decision engine via OpenRouter"}}


# ---------------------------------------------------------------- Jev (TypeSafe API) as decision engine
TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"


def get_typesafe_key() -> str:
    from . import secrets_store

    return secrets_store.get_secret("typesafe_api_key") or settings.typesafe_api_key


async def jev_decide(state: Any, questions: dict[str, Any], model: str = "jev-1.13", api_key: str | None = None, via: str | None = None) -> dict[str, Any]:
    """Jev (TypeSafe System One). Same request/response schema as Laya (choice / score / noul).

    Routed through OpenRouter's /systemone endpoint when an OpenRouter key exists (model ids
    jev-1.13, jev-latest), otherwise through TypeSafe's own API with a TypeSafe key.
    """
    if via is None:
        via = "openrouter" if (api_key is None and get_openrouter_key()) else "typesafe"
    if via == "openrouter":
        key = api_key or get_openrouter_key()
        url = f"{settings.openrouter_base_url}/systemone"
        headers = {"Authorization": f"Bearer {key}", "HTTP-Referer": "http://localhost:5173", "X-Title": "System One Playground"}
        engine = "openrouter"
    else:
        key = api_key or get_typesafe_key()
        url = TYPESAFE_URL
        headers = {"Authorization": f"Bearer {key}"}
        engine = "jev"
    if not key:
        raise RuntimeError("no key for Jev: add an OpenRouter key or a TypeSafe key in Settings")
    model = model or "jev-1.13"
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json={"state": state, "model": model, "questions": questions})
        if r.status_code >= 400:
            usage.record(purpose="decide", engine=engine, model=f"typesafe/{model}", latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=r.text[:200])
            if r.status_code == 401:
                raise ValueError(f"{via} rejected this key (401)")
            raise RuntimeError(f"{via} systemone {r.status_code}: {r.text[:200]}")
        body = r.json()
    u = body.get("usage") or {}
    served = body.get("model", model)
    usage.record(purpose="decide", engine=engine, model=served if "/" in str(served) else f"typesafe/{served}", input_tokens=u.get("input_tokens"),
                 output_tokens=u.get("output_tokens"), latency_ms=(time.perf_counter() - t0) * 1000,
                 extra={"questions": len(questions), **({"cost_usd": float(u["cost"])} if u.get("cost") is not None else {})})
    body["routing"] = {"model": f"jev:{served}", "repo": "typesafe/jev", "reason": f"TypeSafe Jev via {'OpenRouter' if via == 'openrouter' else 'TypeSafe API'}"}
    return body
