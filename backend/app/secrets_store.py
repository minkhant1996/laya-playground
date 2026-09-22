"""Encrypted-at-rest storage for the OpenRouter API key set from the UI.

- Key is encrypted with Fernet using a per-install secret (backend/data/.secret, mode 0600).
- Stored file is also mode 0600. The plaintext key is never returned to the frontend or logged.
"""
import json
import os
import secrets
import threading
from pathlib import Path

from cryptography.fernet import Fernet

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SECRET_FILE = DATA_DIR / ".secret"
STORE_FILE = DATA_DIR / "secrets.enc.json"
_lock = threading.Lock()


def _write_private(path: Path, data: bytes) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.chmod(path, 0o600)


def _fernet() -> Fernet:
    if not SECRET_FILE.exists():
        _write_private(SECRET_FILE, Fernet.generate_key())
    return Fernet(SECRET_FILE.read_bytes().strip())


def _read_store() -> dict[str, str]:
    if not STORE_FILE.exists():
        return {}
    try:
        return json.loads(STORE_FILE.read_text())
    except Exception:
        return {}


def set_secret(name: str, value: str) -> None:
    with _lock:
        store = _read_store()
        store[name] = _fernet().encrypt(value.encode()).decode()
        _write_private(STORE_FILE, json.dumps(store).encode())


def get_secret(name: str) -> str | None:
    with _lock:
        token = _read_store().get(name)
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except Exception:
        return None


def delete_secret(name: str) -> None:
    with _lock:
        store = _read_store()
        if store.pop(name, None) is not None:
            _write_private(STORE_FILE, json.dumps(store).encode())


def mask(value: str) -> str:
    return f"…{value[-4:]}" if len(value) >= 8 else "…"


def constant_time_eq(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode(), b.encode())


# ---------------------------------------------------------------- non-secret preferences
PREFS_FILE = DATA_DIR / "prefs.json"


def get_prefs() -> dict:
    try:
        return json.loads(PREFS_FILE.read_text()) if PREFS_FILE.exists() else {}
    except Exception:
        return {}


def set_prefs(**kv) -> dict:
    with _lock:
        p = get_prefs()
        p.update({k: v for k, v in kv.items() if v is not None})
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        PREFS_FILE.write_text(json.dumps(p))
    return p
