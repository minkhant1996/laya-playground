"""Conversational layer: the OpenRouter text model talks with the user, prepares the
Laya/Jev questions JSON when it has enough information, the decision engine answers them,
and the text model explains the result in plain language."""
import json
from typing import Any

from . import laya_service, openrouter
from .question_guide import guide

CHAT_SYSTEM = """You are the assistant inside the System One Playground. Laya (and TypeSafe's Jev) are fast
"System One" decision models: they take a STATE (text or JSON) plus typed QUESTIONS and return
calibrated answers. They never write text. Your job is to help the user use them.

Question types:
- "choice": {"type":"choice","instructions":"...?","criteria":{option: "short rubric", ...}}
- "score":  {"type":"score","instructions":"...?","criteria":["level 0 (low)", ..., "level N (high)"]}
- "noul":   {"type":"noul","instructions":"yes/no question?"}
Question ids are short snake_case English. Instructions, option names and rubrics should be written in
the language the user is writing in (Burmese, Thai, ... are fine: both decision models read them). If the
user provides their own choices in their language, use them verbatim as the option names. Ask several
small questions rather than one big one.

How to behave:
0. Always reply in the language the user writes in (any language, including romanised text such as
   "myanmar lo pyaw" = "speak in Burmese" → switch to Burmese in native script). Keep question ids and
   JSON keys in English snake_case; instructions and option names follow the user's language.
1. Talk naturally and briefly. If the user's goal or the input text is unclear, ask ONE short
   clarifying question instead of guessing.
2. When you have enough (what to decide + the text/state to decide about), produce a spec.
   If the user gave the text to analyse, put it in "state" verbatim (string or JSON object).
3. When answers come back you will be shown them; explain them plainly, mention confidence,
   and suggest a follow-up or refinement if useful.

ALWAYS respond with ONLY a JSON object:
{"reply": "<your message to the user, markdown allowed>",
 "spec": null | {"state": <string|object>, "questions": {<id>: <question>}}}
Set "spec" only when it should be executed right now.

Guidance on writing good questions (from the TypeSafe/Jev agent skill):
"""

EXPLAIN_SYSTEM = """You are the assistant inside the System One Playground. The decision model just answered the
user's questions. Explain the result to the user in a few short sentences: the decisions, how
confident the model was (probabilities), anything surprising, and one concrete suggestion for
a follow-up question or refinement. Plain language, markdown allowed, no JSON.
Reply in the same language the user has been writing in."""


def _answers_brief(result: dict[str, Any]) -> str:
    lines = []
    for qid, a in (result.get("answers") or {}).items():
        t = a.get("type")
        if t == "choice":
            probs = a.get("probabilities") or {}
            top = sorted(probs.items(), key=lambda kv: -kv[1])[:4]
            lines.append(f"- {qid}: choice = {a.get('choice')} (confidence {a.get('confidence')}); probabilities {dict(top)}")
        elif t == "score":
            lines.append(f"- {qid}: score = {a.get('score')} (confidence {a.get('confidence')}); probabilities {a.get('probabilities')}")
        else:
            lines.append(f"- {qid}: yes-probability = {a.get('noul')}")
    routing = result.get("routing") or {}
    lines.append(f"(engine: {routing.get('model')})")
    return "\n".join(lines)


def _engine_label(engine: dict[str, Any] | None) -> str:
    from .config import get_decision_engine

    e = engine or get_decision_engine()
    return "Laya (local)" if e.get("kind") == "laya" else f"Jev ({e.get('model') or 'jev-1.13'} via OpenRouter)"


async def turn_events(messages: list[dict[str, str]], engine: dict[str, Any] | None, language: str | None = None):
    """Async generator: yields {"type": "status", ...} events, then {"type": "done", **result}."""
    from .config import get_openrouter_model

    text_model = get_openrouter_model()
    history = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    resp: dict[str, Any] = {"reply": "", "spec": None, "result": None, "explanation": None}

    yield {"type": "status", "stage": "preparing", "message": f"preparing questions with {text_model}"}
    lang_rule = f"\n\nOUTPUT LANGUAGE OVERRIDE: the user chose '{language}'. Write your 'reply' in {language} (native script) regardless of the input language. Keep question ids, option names and JSON keys in English snake_case." if language and language.lower() != "auto" else ""
    out = await openrouter.chat_messages([{"role": "system", "content": CHAT_SYSTEM + guide(4000) + lang_rule}, *history], purpose="chat", json_mode=True)
    reply = str(out.get("reply") or "")
    spec = out.get("spec")
    resp["reply"] = reply
    if not spec or not isinstance(spec, dict) or not spec.get("questions"):
        yield {"type": "done", **resp}
        return
    state = spec.get("state")
    resp["spec"] = spec
    if state in (None, ""):
        resp["reply"] = reply + "\n\nI have the questions ready, but I need the text or data to analyse. Paste it and I will run it."
        yield {"type": "done", **resp}
        return

    yield {"type": "status", "stage": "deciding", "message": f"deciding with {_engine_label(engine)} · {len(spec['questions'])} question(s)"}
    try:
        result = await laya_service.decide(state, spec["questions"], engine)
    except Exception as e:
        resp["reply"] = reply + f"\n\nI prepared the questions but running the decision model failed: {e}"
        yield {"type": "done", **resp}
        return
    resp["result"] = result

    yield {"type": "status", "stage": "explaining", "message": f"explaining the answers with {text_model}"}
    try:
        explanation = await openrouter.chat_messages(
            [
                {"role": "system", "content": EXPLAIN_SYSTEM + (f"\n\nOUTPUT LANGUAGE OVERRIDE: answer in {language} (native script)." if language and language.lower() != "auto" else "")},
                *history[-6:],
                {"role": "assistant", "content": reply},
                {"role": "user", "content": "Decision model results:\n" + _answers_brief(result) + "\n\nQuestions asked:\n" + json.dumps(spec["questions"], ensure_ascii=False)[:4000]},
            ],
            purpose="explain",
            json_mode=False,
        )
        resp["explanation"] = str(explanation)
    except Exception as e:
        resp["explanation"] = f"(could not generate explanation: {e})"
    yield {"type": "done", **resp}


async def turn(messages: list[dict[str, str]], engine: dict[str, Any] | None) -> dict[str, Any]:
    """Non-streaming wrapper."""
    last: dict[str, Any] = {}
    async for ev in turn_events(messages, engine):
        if ev["type"] == "done":
            last = {k: v for k, v in ev.items() if k != "type"}
    return last
