"""Learn feature: the text model answers questions about System One / Jev / Laya using ONLY the
Markdown files in backend/knowledge-hub. Two-step agent:
  1. select  - given the index (titles + summaries), the model picks up to 3 relevant files
  2. extract - the model reads just those files and answers with citations
The model never receives anything outside the hub; file access is whitelisted by the index."""
import json
import re
from pathlib import Path
from typing import Any, AsyncIterator

from . import openrouter

HUB = Path(__file__).resolve().parent.parent / "knowledge-hub"
MAX_FILES = 3
MAX_CHARS_PER_FILE = 30000

SELECT_PROMPT = """You are a librarian for a small documentation set about System One decision models
(TypeSafe's Jev and the open Laya model). You will get the user's question and an index of files
(title, summary). Choose the files most likely to contain the answer. Prefer fewer, more specific
files. Respond with ONLY JSON: {"files": ["<file>", ...], "reason": "<short>"} with at most %d files.
Questions may be in any language (including romanised forms such as Burmese written in Latin letters);
understand them and pick files by topic. If the latest message is a follow-up or a request to change
language / rephrase / go deeper (e.g. "explain in Burmese", "myanmar lo pyaw", "más detalles"), treat it as
being about the PREVIOUS question and pick the files for that topic. If nothing fits, return {"files": [], "reason": "..."}."""

ANSWER_PROMPT = """You are the Learn assistant inside the System One Playground. Answer the user's question using
ONLY the documents provided below (they are the only sources you may use). Be concrete: quote or
paraphrase the relevant parts, include small code/JSON examples from the docs when useful, and keep
it under ~250 words unless the user asks for more. Cite sources inline as [n] using the document
numbers. If the documents do not answer the question, say so plainly and suggest which topic to ask
about instead. Never invent API details that are not in the documents.

LANGUAGE: always answer in the language the user wrote in, whatever it is (Burmese, Thai, Spanish, ...).
Romanised text such as "myanmar lo pyaw" means "speak in Burmese": that is a language switch request, not
a documentation question — re-answer the previous question in that language, in native script (e.g. Myanmar
script for Burmese). Keep code, JSON keys and API field names in English."""


def index() -> list[dict[str, Any]]:
    f = HUB / "index.json"
    if not f.exists():
        return []
    return json.loads(f.read_text())


def _allowed(file: str) -> bool:
    return any(d["file"] == file for d in index()) and (HUB / file).is_file()


def read(file: str) -> str:
    if not _allowed(file):
        raise ValueError(f"'{file}' is not in the knowledge hub")
    from .mdx_clean import clean

    return clean((HUB / file).read_text(encoding="utf-8", errors="ignore"))[:MAX_CHARS_PER_FILE]


def _keyword_fallback(question: str) -> list[str]:
    q = set(re.findall(r"[a-z0-9]+", question.lower()))
    scored = []
    for d in index():
        hay = f"{d['title']} {d['summary']} {d['file']}".lower()
        score = sum(1 for w in q if len(w) > 3 and w in hay)
        scored.append((score, d["file"]))
    scored.sort(reverse=True)
    return [f for s, f in scored[:2] if s > 0] or ["introduction.md"]


async def ask(question: str, history: list[dict[str, str]] | None = None, language: str | None = None) -> AsyncIterator[dict[str, Any]]:
    """Yields status events, then {"type": "done", "answer", "sources"}."""
    docs = index()
    if not docs:
        yield {"type": "error", "message": "knowledge hub is empty"}
        return
    text_model = openrouter.get_openrouter_model()

    yield {"type": "status", "stage": "selecting", "message": f"choosing documents with {text_model}"}
    listing = "\n".join(f"- {d['file']}: {d['title']} — {d['summary']}" for d in docs)
    try:
        sel = await openrouter.chat_messages(
            [{"role": "system", "content": SELECT_PROMPT % MAX_FILES},
             {"role": "user", "content": (("Previous conversation:\n" + "\n".join(f"{m['role']}: {m['content'][:300]}" for m in (history or [])[-4:] if m.get('content')) + "\n\n") if history else "")
                                         + f"Latest message: {question}\n\nIndex:\n{listing}"}],
            purpose="learn-select", json_mode=True, temperature=0,
        )
        files = [f for f in (sel.get("files") or []) if isinstance(f, str) and _allowed(f)][:MAX_FILES]
        reason = str(sel.get("reason", ""))
    except Exception as e:
        files, reason = [], f"selection failed ({e}); keyword fallback"
    if not files:
        files = _keyword_fallback(question)

    chosen = [d for d in docs if d["file"] in files]
    yield {"type": "status", "stage": "reading", "message": "reading " + ", ".join(d["title"] for d in chosen), "files": files, "reason": reason}

    context = "\n\n".join(f"===== [{i + 1}] {d['title']} ({d['url']}) =====\n{read(d['file'])}" for i, d in enumerate(chosen))
    lang_rule = f"\n\nOUTPUT LANGUAGE OVERRIDE: the user chose '{language}'. Always answer in {language} (native script), whatever language the question is in." if language and language.lower() != "auto" else ""
    msgs: list[dict[str, str]] = [{"role": "system", "content": ANSWER_PROMPT + lang_rule + "\n\nDOCUMENTS:\n" + context}]
    for m in (history or [])[-6:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": question})

    yield {"type": "status", "stage": "answering", "message": f"answering with {text_model}"}
    try:
        answer = await openrouter.chat_messages(msgs, purpose="learn", json_mode=False, temperature=0.2)
    except Exception as e:
        yield {"type": "error", "message": f"answer failed: {e}"}
        return
    yield {"type": "done", "answer": str(answer), "sources": [{"n": i + 1, "title": d["title"], "url": d["url"], "file": d["file"]} for i, d in enumerate(chosen)], "reason": reason}
