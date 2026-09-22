"""Thin wrapper around the laya Router; loaded lazily once per process."""
import asyncio
import os
from functools import lru_cache
from typing import Any

os.environ.setdefault("USE_TF", "0")  # README: TF probing can hang transformers import
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")


def is_loaded() -> bool:
    return get_router.cache_info().currsize > 0


async def ensure_loaded() -> float:
    """Load the Laya checkpoints if needed; returns seconds spent (0 if already loaded)."""
    import time

    if is_loaded():
        return 0.0
    t0 = time.perf_counter()
    await asyncio.to_thread(get_router)
    return time.perf_counter() - t0


@lru_cache(maxsize=1)
def get_router():
    from laya import Router

    return Router(preload=True)


_embed_fns: dict[str, Any] = {}


def _embed_fn_for(model_name: str):
    from laya import embed_fn_from_agent

    if model_name not in _embed_fns:
        _embed_fns[model_name] = embed_fn_from_agent(get_router().load(model_name))
    return _embed_fns[model_name]


def _predict_sync(state: Any, questions: dict[str, Any], shortlist_k: int | None) -> dict[str, Any]:
    router = get_router()
    if not shortlist_k:
        return router.predict(state, questions)
    # Many-label choice: rank labels by embedding similarity first, then ask Laya over the top-k.
    from laya import predict_shortlist

    decision = router.route(state, questions)
    embed_fn = _embed_fn_for(decision["model"])
    return predict_shortlist(router, state, questions, embed_fn, k=shortlist_k, model=decision["model"])


async def predict(state: Any, questions: dict[str, Any], shortlist_k: int | None = None) -> dict[str, Any]:
    import time

    from . import usage

    t0 = time.perf_counter()
    try:
        res = await asyncio.to_thread(_predict_sync, state, questions, shortlist_k)
    except Exception as e:
        usage.record(purpose="decide", engine="laya", model=None, latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=str(e))
        raise
    u = res.get("usage") or {}
    usage.record(purpose="decide", engine="laya", model=(res.get("routing") or {}).get("model"), input_tokens=u.get("input_tokens"),
                 output_tokens=u.get("output_tokens"), latency_ms=(time.perf_counter() - t0) * 1000, extra={"questions": len(questions)})
    return res


def extract_choice(result: dict[str, Any], qname: str) -> tuple[str, float | None]:
    """Return (choice, confidence) tolerant to slight differences in laya's answer dict."""
    ans = result.get("answers", {}).get(qname, {})
    choice = ans.get("choice")
    conf = None
    for key in ("confidence", "probability", "prob"):
        if isinstance(ans.get(key), (int, float)):
            conf = float(ans[key])
            break
    if conf is None:
        for key in ("probs", "probabilities", "distribution"):
            dist = ans.get(key)
            if isinstance(dist, dict) and choice in dist:
                conf = float(dist[choice])
                break
    return str(choice), conf


async def decide(state: Any, questions: dict[str, Any], engine: dict[str, Any] | None = None, shortlist_k: int | None = None) -> dict[str, Any]:
    """Dispatch to Laya (local) or an OpenRouter LLM according to `engine`."""
    from . import openrouter
    from .config import get_decision_engine

    engine = engine or get_decision_engine()
    if engine.get("kind") == "openrouter":
        return await openrouter.decide(state, questions, engine["model"])
    if engine.get("kind") == "jev":
        return await openrouter.jev_decide(state, questions, engine.get("model") or "jev-latest")
    return await predict(state, questions, shortlist_k)
