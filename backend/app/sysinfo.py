"""Process / system RAM and GPU VRAM readings for the UI."""
import os
import shutil
import subprocess
from typing import Any

import psutil


def _gpu_via_torch() -> list[dict[str, Any]] | None:
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        out = []
        for i in range(torch.cuda.device_count()):
            free, total = torch.cuda.mem_get_info(i)
            out.append({"index": i, "name": torch.cuda.get_device_name(i), "total_mb": total / 2**20, "used_mb": (total - free) / 2**20,
                        "process_mb": torch.cuda.memory_reserved(i) / 2**20})
        return out
    except Exception:
        return None


def _gpu_via_nvidia_smi() -> list[dict[str, Any]] | None:
    if not shutil.which("nvidia-smi"):
        return None
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=3)
        out = []
        for line in r.stdout.strip().splitlines():
            idx, name, total, used = [x.strip() for x in line.split(",")]
            out.append({"index": int(idx), "name": name, "total_mb": float(total), "used_mb": float(used), "process_mb": None})
        return out or None
    except Exception:
        return None


def _gpu_via_mps() -> list[dict[str, Any]] | None:
    """Apple Silicon: unified memory, report what PyTorch has allocated on the Metal device."""
    try:
        import torch

        if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            return None
        alloc = torch.mps.current_allocated_memory() / 2**20 if hasattr(torch, "mps") else 0.0
        drv = torch.mps.driver_allocated_memory() / 2**20 if hasattr(torch.mps, "driver_allocated_memory") else alloc
        total = psutil.virtual_memory().total / 2**20   # unified memory: shares system RAM
        return [{"index": 0, "name": "Apple GPU (Metal, unified memory)", "total_mb": total, "used_mb": drv, "process_mb": alloc}]
    except Exception:
        return None


def _device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def snapshot() -> dict[str, Any]:
    proc = psutil.Process(os.getpid())
    vm = psutil.virtual_memory()
    gpus = _gpu_via_torch() or _gpu_via_mps() or _gpu_via_nvidia_smi()
    from . import laya_service
    import platform

    dev = _device()
    note = None
    if dev == "cpu" and gpus and any("NVIDIA" in (g.get("name") or "") for g in gpus):
        note = "NVIDIA GPU present but PyTorch cannot use it (driver / CUDA build mismatch): Laya runs on CPU."

    return {
        "process": {"rss_mb": proc.memory_info().rss / 2**20, "cpu_percent": proc.cpu_percent(interval=None)},
        "ram": {"total_mb": vm.total / 2**20, "used_mb": (vm.total - vm.available) / 2**20, "percent": vm.percent},
        "cpu_percent": psutil.cpu_percent(interval=None),
        "gpus": gpus or [],
        "laya_loaded": laya_service.is_loaded(),
        "laya_device": dev,
        "os": f"{platform.system()} {platform.release()}",
        "free_mb": vm.available / 2**20,
        "laya_min_free_mb": laya_service.MIN_FREE_MB_TO_LOAD,
        "note": note,
    }


def quick_mem() -> dict[str, float | None]:
    """Cheap sample for per-run tracking: process RSS and (if CUDA/MPS) GPU memory used, in MB."""
    proc = psutil.Process(os.getpid())
    rss = proc.memory_info().rss / 2**20
    vram = None
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info(0)
            vram = (total - free) / 2**20
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            vram = torch.mps.driver_allocated_memory() / 2**20
    except Exception:
        pass
    return {"rss_mb": rss, "vram_mb": vram}
