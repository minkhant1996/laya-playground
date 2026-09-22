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


def key(src: dict[str, Any]) -> str:
    parts = [src.get("kind"), src.get("dataset_id"), src.get("path"), src.get("config"), src.get("file"), src.get("upload_id"), src.get("split")]
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


_key = key


PRESET_PLANS = Path(__file__).resolve().parent.parent / "preset_plans.json"


def _preset_defaults() -> list[dict[str, Any]]:
    """Plans shipped with the app for the built-in presets (used until the user makes their own)."""
    try:
        data = json.loads(PRESET_PLANS.read_text()) if PRESET_PLANS.exists() else {}
    except Exception:
        return []
    out = []
    for pid, e in data.items():
        src = {"kind": "preset", "dataset_id": pid}
        plan = e.get("plan") or {}
        out.append({**src, "id": key(src), "name": plan.get("dataset") or pid, "size": plan.get("size"), "labels": len(plan.get("label_values") or []),
                    "plan": plan, "last_used": 0, "shipped": True, "split": e.get("split")})
    return out


def get(src: dict[str, Any]) -> dict[str, Any] | None:
    k = key(src)
    hit = next((e for e in _read() if e.get("id") == k), None)
    if hit:
        return hit
    return next((e for e in _preset_defaults() if e["id"] == k), None)


def remember(src: dict[str, Any], *, name: str | None = None, size: int | None = None, labels: int | None = None,
             plan: dict[str, Any] | None = None, criteria: dict[str, str] | None = None) -> dict[str, Any]:
    """Upsert an entry; plan / criteria are kept from the previous version unless given."""
    with _lock:
        items = _read()
        old = next((e for e in items if e.get("id") == key(src)), {})
        entry = {**old, **{k: v for k, v in src.items() if v is not None}, "id": key(src), "last_used": time.time()}
        if name is not None:
            entry["name"] = name
        if size is not None:
            entry["size"] = size
        if labels is not None:
            entry["labels"] = labels
        if plan is not None:
            entry["plan"] = plan
        if criteria is not None:
            entry["criteria"] = criteria
        entry.setdefault("name", entry.get("dataset_id") or entry.get("path") or entry["id"])
        items = [e for e in items if e.get("id") != entry["id"]]
        items.insert(0, entry)
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps(items[:100], ensure_ascii=False))
    return entry


def list_all() -> list[dict[str, Any]]:
    mine = _read()
    ids = {e.get("id") for e in mine}
    shipped = [e for e in _preset_defaults() if e["id"] not in ids]
    return sorted(mine, key=lambda e: -e.get("last_used", 0)) + shipped


def clear_plan(entry_id: str) -> bool:
    with _lock:
        items = _read()
        hit = False
        for e in items:
            if e.get("id") == entry_id:
                e.pop("plan", None)
                e.pop("criteria", None)
                hit = True
        FILE.write_text(json.dumps(items, ensure_ascii=False))
        return hit


def delete(entry_id: str) -> bool:
    with _lock:
        items = _read()
        keep = [e for e in items if e.get("id") != entry_id]
        FILE.write_text(json.dumps(keep, ensure_ascii=False))
        return len(keep) != len(items)
