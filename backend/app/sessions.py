"""Chat sessions persisted as JSON files in backend/data/chats/."""
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

DIR = Path(__file__).resolve().parent.parent / "data" / "chats"
_lock = threading.Lock()
ID_RE = re.compile(r"^[0-9a-f]{12}$")


def _path(sid: str) -> Path:
    if not ID_RE.match(sid):
        raise ValueError("bad session id")
    return DIR / f"{sid}.json"


def create(engine: dict[str, Any] | None = None, kind: str = "chat") -> dict[str, Any]:
    DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    s = {"id": uuid.uuid4().hex[:12], "kind": kind, "title": "New chat", "created": now, "updated": now, "engine": engine, "messages": []}
    _path(s["id"]).write_text(json.dumps(s))
    return s


def get(sid: str) -> dict[str, Any]:
    p = _path(sid)
    if not p.exists():
        raise FileNotFoundError("session not found")
    return json.loads(p.read_text())


def save(s: dict[str, Any]) -> None:
    s["updated"] = time.time()
    with _lock:
        _path(s["id"]).write_text(json.dumps(s, ensure_ascii=False))


def append(sid: str, messages: list[dict[str, Any]], engine: dict[str, Any] | None = None) -> dict[str, Any]:
    s = get(sid)
    s["messages"].extend(messages)
    if engine:
        s["engine"] = engine
    if s["title"] == "New chat":
        first = next((m["content"] for m in s["messages"] if m["role"] == "user"), "")
        s["title"] = (first.strip().split("\n")[0][:60] or "New chat")
    save(s)
    return s


def list_all(kind: str = "chat") -> list[dict[str, Any]]:
    if not DIR.exists():
        return []
    out = []
    for p in DIR.glob("*.json"):
        try:
            s = json.loads(p.read_text())
            if s.get("kind", "chat") != kind:
                continue
            out.append({"id": s["id"], "kind": kind, "title": s["title"], "created": s["created"], "updated": s["updated"], "count": len(s["messages"]), "engine": s.get("engine")})
        except Exception:
            continue
    return sorted(out, key=lambda s: -s["updated"])


def delete(sid: str) -> bool:
    p = _path(sid)
    if p.exists():
        p.unlink()
        return True
    return False


def delete_all(kind: str = "chat") -> int:
    n = 0
    for p in list(DIR.glob("*.json")) if DIR.exists() else []:
        try:
            if json.loads(p.read_text()).get("kind", "chat") != kind:
                continue
        except Exception:
            pass
        p.unlink()
        n += 1
    return n
