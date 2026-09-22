"""Thin wrapper around the laya Router; loaded lazily once per process."""
import asyncio
import os
from functools import lru_cache
from typing import Any

os.environ.setdefault("USE_TF", "0")  # README: TF probing can hang transformers import
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")


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
    return await asyncio.to_thread(_predict_sync, state, questions, shortlist_k)


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
