"""Jev-Omni (akhilaaa3/Jev-Omni): Gemma 4 12B multimodal decision classifier.
One question per call: predict(state, question, options) -> probabilities over options.
Requires an NVIDIA GPU (the model card: CUDA required, ~24 GB in BF16). Apache-2.0.
"""
import asyncio
import sys
import time
from functools import lru_cache
from typing import Any

from .common import answer_choice, answer_noul, answer_score, normalize, option_items, state_text

REPO = "akhilaaa3/Jev-Omni"
VRAM_MB = 26000
_lock = asyncio.Lock()


def gpu_ok() -> tuple[bool, str]:
    try:
        import torch

        if not torch.cuda.is_available():
            hint = ""
            try:
                import subprocess

                r = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                                   capture_output=True, text=True, timeout=3)
                if r.returncode == 0 and r.stdout.strip():
                    gpu = r.stdout.strip().splitlines()[0]
                    hint = (f" A GPU is present ({gpu}) but this PyTorch build (CUDA {torch.version.cuda}) "
                            "cannot use the installed driver: install a PyTorch wheel matching your driver, or update the driver.")
            except Exception:
                pass
            return False, (f"Jev-Omni needs an NVIDIA GPU with CUDA and about {VRAM_MB / 1024:.0f} GB of VRAM." + hint)
        free, total = torch.cuda.mem_get_info(0)
        if total / 2**20 < VRAM_MB * 0.9:
            return False, f"Jev-Omni needs about {VRAM_MB / 1024:.0f} GB VRAM; this GPU has {total / 2**30:.0f} GB."
        return True, ""
    except Exception as e:
        return False, f"cannot query GPU: {e}"


@lru_cache(maxsize=1)
def _load():
    from huggingface_hub import snapshot_download

    path = snapshot_download(REPO, allow_patterns=["*.py", "*.json", "*.pt", "backbone/*", "chat_template.jinja"])
    if path not in sys.path:
        sys.path.insert(0, path)
    from jev_omni import load_jev_omni  # type: ignore

    return load_jev_omni()


def is_loaded() -> bool:
    return _load.cache_info().currsize > 0


def _ask(clf, state: str, question: str, options: list[str]) -> list[float]:
    r = clf.predict(state=state, question=question, options=options)
    probs = r.get("probabilities") or {}
    return [float(probs.get(o, 0.0)) for o in options]


def _decide_sync(state: Any, questions: dict[str, Any]) -> dict[str, Any]:
    clf = _load()
    text = state_text(state)
    answers: dict[str, Any] = {}
    for qid, q in questions.items():
        qt = q.get("type")
        instr = str(q.get("instructions", "")).strip() or "Which option is correct?"
        if qt == "choice":
            items = option_items(q.get("criteria"))
            names = [n for n, _ in items]
            opts = [f"{n}: {r}" if r else n for n, r in items]
            answers[qid] = answer_choice(names, normalize(_ask(clf, text, instr, opts)))
        elif qt == "score":
            levels = [str(x) for x in (q.get("criteria") or [])]
            answers[qid] = answer_score(levels, normalize(_ask(clf, text, instr, levels)))
        else:
            p = normalize(_ask(clf, text, instr, ["Yes", "No"]))
            answers[qid] = answer_noul(p[0])
    return {"model": "jev-omni", "answers": answers, "usage": {"input_tokens": None, "output_tokens": 0},
            "routing": {"model": "jev-omni", "repo": REPO, "reason": "local multimodal classifier on CUDA"}}


async def decide(state: Any, questions: dict[str, Any]) -> dict[str, Any]:
    from .. import usage

    ok, why = gpu_ok()
    if not ok and not is_loaded():
        raise RuntimeError(why)
    t0 = time.perf_counter()
    async with _lock:
        try:
            res = await asyncio.to_thread(_decide_sync, state, questions)
        except Exception as e:
            usage.record(purpose="decide", engine="jev_omni", model="jev-omni", latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=str(e))
            raise
    usage.record(purpose="decide", engine="jev_omni", model="jev-omni", latency_ms=(time.perf_counter() - t0) * 1000, extra={"questions": len(questions), "cost_usd": 0.0})
    return res


async def ensure_loaded() -> float:
    ok, why = gpu_ok()
    if not ok:
        raise RuntimeError(why)
    t0 = time.perf_counter()
    await asyncio.to_thread(_load)
    return time.perf_counter() - t0
