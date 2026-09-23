"""Shared helpers for local open-weight decision engines (openjev, Jev-Omni)."""
import math
from typing import Any


def state_text(state: Any) -> str:
    import json

    return state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)


def option_items(criteria: Any) -> list[tuple[str, str]]:
    """choice criteria -> [(option_name, rubric)]"""
    if isinstance(criteria, dict):
        return [(str(k), "" if v is None else str(v)) for k, v in criteria.items()]
    if isinstance(criteria, list):
        return [(str(v), "") for v in criteria]
    return []


def normalize(scores: list[float]) -> list[float]:
    s = sum(scores)
    if s <= 0 or not math.isfinite(s):
        n = len(scores) or 1
        return [1.0 / n] * n
    return [x / s for x in scores]


def confidence_from(probs: list[float]) -> float:
    """Same spirit as Laya/Jev: margin-aware confidence in [0,1] (top prob rescaled from uniform)."""
    if not probs:
        return 0.0
    n = len(probs)
    top = max(probs)
    if n == 1:
        return 1.0
    return round(max(0.0, (top - 1.0 / n) / (1.0 - 1.0 / n)), 4)


def answer_choice(names: list[str], probs: list[float]) -> dict[str, Any]:
    best = max(range(len(names)), key=lambda i: probs[i])
    return {"type": "choice", "choice": names[best], "probabilities": {n: round(p, 4) for n, p in zip(names, probs)}, "confidence": confidence_from(probs)}


def answer_score(levels: list[str], probs: list[float]) -> dict[str, Any]:
    exp = sum(i * p for i, p in enumerate(probs))
    return {"type": "score", "score": round(exp, 4), "probabilities": {str(i): round(p, 4) for i, p in enumerate(probs)}, "confidence": confidence_from(probs), "levels": levels}


def answer_noul(p_yes: float) -> dict[str, Any]:
    p_yes = min(1.0, max(0.0, p_yes))
    return {"type": "noul", "noul": round(p_yes, 4), "confidence": round(max(p_yes, 1 - p_yes), 4)}


def device_and_dtype():
    import torch

    if torch.cuda.is_available():
        return "cuda", torch.bfloat16
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps", torch.float16
    return "cpu", torch.bfloat16
