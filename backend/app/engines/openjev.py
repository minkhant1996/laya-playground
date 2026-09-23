"""openjev (AlexWortega/openjev): Qwen3.5 NLI cross-encoder used as a typed-decision model.

Mapping to the Laya/Jev question types:
  choice -> hypotheses "The correct answer is: <option> (<rubric>)", entailment scores normalised
  score  -> one hypothesis per level, expected level index
  noul   -> hypotheses yes / no, P(yes) from their entailment scores
All checkpoints are open (MIT). Variants differ hugely in size; see VARIANTS.
"""
import asyncio
import sys
import time
from functools import lru_cache
from typing import Any

from .common import answer_choice, answer_noul, answer_score, device_and_dtype, normalize, option_items, state_text

REPO = "AlexWortega/openjev"
VARIANTS: dict[str, dict[str, Any]] = {
    "qwen3.5-0.8b-nli-v2s-long": {"label": "openjev 0.8B (light, 4k ctx)", "ram_mb": 2500, "vram_mb": 2000},
    "qwen3.5-4b-nli-v2": {"label": "openjev 4B v2 (recommended, text + images)", "ram_mb": 10000, "vram_mb": 9000},
    "qwen3.5-35b-a3b-nli": {"label": "openjev 35B-A3B (MoE, GPU only)", "ram_mb": 75000, "vram_mb": 72000},
}
DEFAULT_VARIANT = "qwen3.5-0.8b-nli-v2s-long"
_lock = asyncio.Lock()


@lru_cache(maxsize=2)
def _load(variant: str):
    from huggingface_hub import snapshot_download

    path = snapshot_download(REPO, allow_patterns=["modeling_openjev.py", "modeling_qwen35_moe_seqcls.py", f"{variant}/*"])
    if path not in sys.path:
        sys.path.insert(0, path)
    from modeling_openjev import OpenJevCrossEncoder  # type: ignore

    device, dtype = device_and_dtype()
    return OpenJevCrossEncoder(REPO, subfolder=variant, device=device, dtype=dtype), device


def is_loaded() -> bool:
    return _load.cache_info().currsize > 0


def _entail(model, premise: str, hyps: list[str]) -> list[float]:
    import numpy as np

    probs = np.asarray(model.predict_hypotheses(premise, hyps))   # rows: [contradiction, entailment, neutral]
    return [float(r[1]) for r in probs]


def _decide_sync(state: Any, questions: dict[str, Any], variant: str) -> dict[str, Any]:
    model, device = _load(variant)
    text = state_text(state)
    answers: dict[str, Any] = {}
    for qid, q in questions.items():
        qt = q.get("type")
        instr = str(q.get("instructions", "")).strip()
        premise = f"{text}\n\nQuestion: {instr}" if instr else text
        if qt == "choice":
            items = option_items(q.get("criteria"))
            names = [n for n, _ in items]
            hyps = [f"The correct answer is: {n}" + (f" ({r})" if r else "") for n, r in items]
            answers[qid] = answer_choice(names, normalize(_entail(model, premise, hyps)))
        elif qt == "score":
            levels = [str(x) for x in (q.get("criteria") or [])]
            hyps = [f"The correct answer is: {lv}" for lv in levels]
            answers[qid] = answer_score(levels, normalize(_entail(model, premise, hyps)))
        else:
            e_yes, e_no = _entail(model, premise, ["The correct answer is: yes", "The correct answer is: no"])
            answers[qid] = answer_noul(e_yes / (e_yes + e_no) if (e_yes + e_no) > 0 else 0.5)
    return {"model": f"openjev/{variant}", "answers": answers, "usage": {"input_tokens": None, "output_tokens": 0},
            "routing": {"model": f"openjev:{variant}", "repo": REPO, "reason": f"local NLI cross-encoder on {device}"}}


async def decide(state: Any, questions: dict[str, Any], variant: str | None = None) -> dict[str, Any]:
    from .. import usage
    from ..laya_service import NotEnoughMemory, free_mb

    variant = variant or DEFAULT_VARIANT
    if variant not in VARIANTS:
        raise ValueError(f"unknown openjev variant {variant}")
    need = VARIANTS[variant]["ram_mb"]
    if _load.cache_info().currsize == 0 and free_mb() < need:
        raise NotEnoughMemory(f"openjev {variant} needs about {need / 1024:.0f} GB of RAM; only {free_mb() / 1024:.1f} GB is free.")
    t0 = time.perf_counter()
    async with _lock:
        try:
            res = await asyncio.to_thread(_decide_sync, state, questions, variant)
        except Exception as e:
            usage.record(purpose="decide", engine="openjev", model=variant, latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=str(e))
            raise
    usage.record(purpose="decide", engine="openjev", model=variant, latency_ms=(time.perf_counter() - t0) * 1000, extra={"questions": len(questions), "cost_usd": 0.0})
    return res


async def ensure_loaded(variant: str | None = None) -> float:
    variant = variant or DEFAULT_VARIANT
    t0 = time.perf_counter()
    await asyncio.to_thread(_load, variant)
    return time.perf_counter() - t0
