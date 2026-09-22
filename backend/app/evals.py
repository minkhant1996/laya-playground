"""History of evaluation runs and model comparisons (backend/data/evals/*.json)."""
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

DIR = Path(__file__).resolve().parent.parent / "data" / "evals"
_lock = threading.Lock()
ID_RE = re.compile(r"^[0-9a-f]{12}$")


def _path(eid: str) -> Path:
    if not ID_RE.match(eid):
        raise ValueError("bad id")
    return DIR / f"{eid}.json"


def save(entry: dict[str, Any]) -> dict[str, Any]:
    DIR.mkdir(parents=True, exist_ok=True)
    entry = {**entry, "id": uuid.uuid4().hex[:12], "created": time.time()}
    with _lock:
        _path(entry["id"]).write_text(json.dumps(entry, ensure_ascii=False, default=str))
    return entry


def get(eid: str) -> dict[str, Any]:
    p = _path(eid)
    if not p.exists():
        raise FileNotFoundError("not found")
    return json.loads(p.read_text())


def list_all() -> list[dict[str, Any]]:
    if not DIR.exists():
        return []
    out = []
    for p in DIR.glob("*.json"):
        try:
            e = json.loads(p.read_text())
            out.append({k: e.get(k) for k in ("id", "kind", "title", "created", "dataset", "engine", "n", "accuracy", "accuracy_b", "avg_ms", "avg_ms_b", "question_type")})
        except Exception:
            continue
    return sorted(out, key=lambda e: -(e.get("created") or 0))


def delete(eid: str) -> bool:
    p = _path(eid)
    if p.exists():
        p.unlink()
        return True
    return False


def delete_all() -> int:
    n = 0
    for p in list(DIR.glob("*.json")) if DIR.exists() else []:
        p.unlink()
        n += 1
    return n
