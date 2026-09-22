"""Thin wrapper around the laya Router; loaded lazily once per process."""
import asyncio
import os
from functools import lru_cache
from typing import Any

os.environ.setdefault("USE_TF", "0")  # README: TF probing can hang transformers import
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")


MIN_FREE_MB_TO_LOAD = 2600      # one checkpoint ≈ 1.7–2.3 GB in RAM plus headroom
MIN_FREE_MB_TO_RUN = 400        # below this we stop an evaluation rather than let the OS thrash / kill us


class NotEnoughMemory(RuntimeError):
    pass


def free_mb() -> float:
    import psutil

    return psutil.virtual_memory().available / 2**20


def check_memory_to_load() -> None:
    free = free_mb()
    if free < MIN_FREE_MB_TO_LOAD:
        raise NotEnoughMemory(
            f"only {free / 1024:.1f} GB of RAM is free; loading a Laya checkpoint needs about {MIN_FREE_MB_TO_LOAD / 1024:.1f} GB. "
            "Close other programs, or switch the decision model to Jev (runs in the cloud)."
        )


def is_loaded() -> bool:
    return get_router.cache_info().currsize > 0


async def ensure_loaded() -> float:
    """Load the Laya checkpoints if needed; returns seconds spent (0 if already loaded)."""
    import time

    if is_loaded():
        return 0.0
    check_memory_to_load()
    t0 = time.perf_counter()
    await asyncio.to_thread(get_router)
    return time.perf_counter() - t0


@lru_cache(maxsize=1)
def get_router():
    """Lazy router: checkpoints load on first use, one at a time (English ≈ 1.7 GB, multilingual ≈ 1.3 GB),
    instead of all three up front, so a machine with 4 GB free can still run it."""
    from laya import Router

    check_memory_to_load()
    return Router(preload=False)


_embed_fns: dict[str, Any] = {}


def _embed_fn_for(model_name: str):
    from laya import embed_fn_from_agent

    if model_name not in _embed_fns:
        _embed_fns[model_name] = embed_fn_from_agent(get_router().load(model_name))
    return _embed_fns[model_name]


def _questions_text(questions: dict[str, Any]) -> str:
    """All human-readable text in the questions (instructions, option names, rubrics, levels)."""
    import json

    return json.dumps(questions, ensure_ascii=False)


def _needs_multilingual(text: str) -> bool:
    """True when the text contains a meaningful share of non-Latin letters."""
    from laya import detect_script

    try:
        info = detect_script(text)
        # laya returns either a dict with 'non_latin_fraction' or a script name
        if isinstance(info, dict):
            return float(info.get("non_latin_fraction", 0)) > 0.2
        return str(info).lower() not in ("latin", "")
    except Exception:
        letters = [c for c in text if c.isalpha()]
        return bool(letters) and sum(1 for c in letters if ord(c) > 0x024F) / len(letters) > 0.2


def _model_override(state: Any, questions: dict[str, Any]) -> str | None:
    """The router only inspects the state; if the questions are written in a non-Latin script
    (e.g. Burmese instructions/options with an English state) the English checkpoint cannot read
    them, so force the multilingual checkpoint."""
    if _needs_multilingual(_questions_text(questions)):
        return "multilingual"
    return None


def _predict_sync(state: Any, questions: dict[str, Any], shortlist_k: int | None) -> dict[str, Any]:
    router = get_router()
    override = _model_override(state, questions)
    if not shortlist_k:
        res = router.predict(state, questions, model=override)
        if override and isinstance(res.get("routing"), dict) and res["routing"].get("model") != "multilingual":
            res["routing"]["model"] = "multilingual"
        if override and isinstance(res.get("routing"), dict):
            res["routing"]["reason"] = "questions contain non-Latin script; multilingual checkpoint forced"
        return res
    # Many-label choice: rank labels by embedding similarity first, then ask Laya over the top-k.
    from laya import predict_shortlist

    decision = router.route(state, questions)
    model_name = override or decision["model"]
    embed_fn = _embed_fn_for(model_name)
    return predict_shortlist(router, state, questions, embed_fn, k=shortlist_k, model=model_name)


async def predict(state: Any, questions: dict[str, Any], shortlist_k: int | None = None) -> dict[str, Any]:
    import time

    from . import usage

    t0 = time.perf_counter()
    try:
        if not is_loaded():
            check_memory_to_load()
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
