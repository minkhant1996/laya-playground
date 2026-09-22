"""Library of previously loaded dataset sources (Kaggle / HF / uploads) with their chosen columns,
so they can be reused with one click. The data itself stays in the download caches / uploads dir."""
import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any

FILE = Path(__file__).resolve().parent.parent / "data" / "datasets_library.json"
_lock = threading.Lock()


def _read() -> list[dict[str, Any]]:
    try:
        return json.loads(FILE.read_text()) if FILE.exists() else []
    except Exception:
        return []


def _key(src: dict[str, Any]) -> str:
    parts = [src.get("kind"), src.get("path"), src.get("config"), src.get("file"), src.get("upload_id"), src.get("split")]
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def remember(src: dict[str, Any], *, name: str, size: int | None = None, labels: int | None = None) -> dict[str, Any]:
    entry = {**{k: v for k, v in src.items() if v is not None}, "id": _key(src), "name": name, "size": size, "labels": labels, "last_used": time.time()}
    with _lock:
        items = [e for e in _read() if e.get("id") != entry["id"]]
        items.insert(0, entry)
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps(items[:100], ensure_ascii=False))
    return entry


def list_all() -> list[dict[str, Any]]:
    return sorted(_read(), key=lambda e: -e.get("last_used", 0))


def delete(entry_id: str) -> bool:
    with _lock:
        items = _read()
        keep = [e for e in items if e.get("id") != entry_id]
        FILE.write_text(json.dumps(keep, ensure_ascii=False))
        return len(keep) != len(items)
