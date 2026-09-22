"""Append-only usage log for every model call (Laya local, OpenRouter, Jev)."""
import json
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

LOG = Path(__file__).resolve().parent.parent / "data" / "usage.jsonl"
_lock = threading.Lock()
_prices: dict[str, tuple[float, float]] = {}   # model -> ($/1M in, $/1M out)


def set_prices(models: list[dict[str, Any]]) -> None:
    for m in models:
        _prices[m["id"]] = (m.get("prompt_price") or 0.0, m.get("completion_price") or 0.0)


def cost_for(model: str | None, tin: int | None, tout: int | None) -> float | None:
    if not model or model not in _prices:
        return None
    pi, po = _prices[model]
    return round(((tin or 0) * pi + (tout or 0) * po) / 1e6, 6)


def record(*, purpose: str, engine: str, model: str | None, input_tokens: int | None = None, output_tokens: int | None = None,
           latency_ms: float | None = None, ok: bool = True, error: str | None = None, extra: dict[str, Any] | None = None) -> None:
    entry = {
        "ts": time.time(), "purpose": purpose, "engine": engine, "model": model,
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "cost_usd": cost_for(model, input_tokens, output_tokens) if engine == "openrouter" else (0.0 if engine == "laya" else None),
        "latency_ms": round(latency_ms, 1) if latency_ms is not None else None, "ok": ok, "error": (error or None) and str(error)[:300],
    }
    if extra:
        entry.update(extra)   # may override cost_usd with the provider-reported cost
    with _lock:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(json.dumps(entry) + "\n")


def _read() -> list[dict[str, Any]]:
    if not LOG.exists():
        return []
    out = []
    for line in LOG.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def summary(limit: int = 200, since: float | None = None) -> dict[str, Any]:
    rows = _read()
    if since:
        rows = [r for r in rows if r["ts"] >= since]

    def agg():
        return {"calls": 0, "errors": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "latency_ms": 0.0}

    by_model, by_purpose, by_day = defaultdict(agg), defaultdict(agg), defaultdict(agg)
    total = agg()
    for r in rows:
        for bucket in (total, by_model[f"{r['engine']}:{r['model'] or '-'}"], by_purpose[r["purpose"]], by_day[time.strftime("%Y-%m-%d", time.localtime(r["ts"]))]):
            bucket["calls"] += 1
            bucket["errors"] += 0 if r.get("ok", True) else 1
            bucket["input_tokens"] += r.get("input_tokens") or 0
            bucket["output_tokens"] += r.get("output_tokens") or 0
            bucket["cost_usd"] += r.get("cost_usd") or 0.0
            bucket["latency_ms"] += r.get("latency_ms") or 0.0
    for b in [total, *by_model.values(), *by_purpose.values(), *by_day.values()]:
        b["avg_latency_ms"] = round(b.pop("latency_ms") / b["calls"], 1) if b["calls"] else 0
        b["cost_usd"] = round(b["cost_usd"], 6)
    return {
        "total": total,
        "by_model": [{"key": k, **v} for k, v in sorted(by_model.items(), key=lambda kv: -kv[1]["calls"])],
        "by_purpose": [{"key": k, **v} for k, v in sorted(by_purpose.items(), key=lambda kv: -kv[1]["calls"])],
        "by_day": [{"key": k, **v} for k, v in sorted(by_day.items())],
        "recent": list(reversed(rows[-limit:])),
    }


def clear() -> None:
    with _lock:
        if LOG.exists():
            LOG.unlink()
