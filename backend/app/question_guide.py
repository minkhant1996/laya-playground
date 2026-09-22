"""Question-writing guidance distilled from the TypeSafe (Jev) agent skill.

The skill docs live in backend/skills/ (SKILL.md + primitives pages fetched from
docs.typesafe.ai). Jev and Laya share the same question schema (choice / score / noul),
so the guidance applies to both. The relevant sections are extracted at import time and
injected into the JSON-preparer prompt.
"""
import re
from functools import lru_cache
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def _strip_mdx(text: str) -> str:
    text = re.sub(r"<[^>\n]+>", "", text)           # drop JSX-style tags
    text = re.sub(r"\{[^}\n]*\}", "", text)           # drop {props}
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # links -> text
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _section(md: str, start: str, end: str) -> str:
    i = md.find(start)
    j = md.find(end, i + 1) if i >= 0 else -1
    return md[i:j] if i >= 0 and j > i else ""


FALLBACK = """- Ask for one snap judgment per question; split complex judgments into several questions.
- choice: 2-255 options, each with a short rubric; include an "other"/"none" option when the set may not cover everything.
- score: an ordered list of 2-10 level descriptions, low to high; the answer is the expected level index.
- noul: a yes/no question; optional criteria {"true": ..., "false": ...} sharpen the meaning.
- Instructions may be objects that reference specific fields of the state.
- Ask multiple related questions in one call; consume only the relevant answers."""


@lru_cache(maxsize=1)
def guide(max_chars: int = 7000) -> str:
    """Return the distilled guide text (or the fallback if the docs are missing)."""
    src = SKILLS_DIR / "primitives.md"
    if not src.exists():
        return FALLBACK
    md = src.read_text(encoding="utf-8", errors="ignore")
    parts = [
        _section(md, "## Ask for one snap judgment per question", "## What comes back"),
        _section(md, "## Reference specific fields", "## Next steps"),
    ]
    text = _strip_mdx("\n\n".join(p for p in parts if p))
    return (text[:max_chars] if text else FALLBACK)


def sources() -> list[str]:
    return sorted(p.name for p in SKILLS_DIR.glob("*.md")) if SKILLS_DIR.exists() else []
