"""AI layer: uses OpenRouter to turn natural language into Laya-ready JSON."""
import json
import re
from typing import Any

import httpx

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
No markdown, no commentary."""

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


async def chat_json(system: str, user: str) -> Any:
    api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OpenRouter API key not set: add it in Settings or backend/.env")
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Laya Playground",
            },
            json={
                "model": get_openrouter_model(),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
            },
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    return _extract_json(content)


async def prepare_spec(description: str, sample_text: str | None) -> dict[str, Any]:
    user = f"Request:\n{description}"
    if sample_text:
        user += f"\n\nExample input the user wants to analyse:\n{sample_text}"
    return await chat_json(SYSTEM_PROMPT, user)


async def describe_labels(dataset_name: str, labels: list[str]) -> dict[str, str]:
    user = f"Dataset: {dataset_name}\nLabels: {json.dumps(labels)}"
    out = await chat_json(CRITERIA_PROMPT, user)
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
