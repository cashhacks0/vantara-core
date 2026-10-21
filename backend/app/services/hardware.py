"""Hardware and storage introspection for model recommendations."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _cpu_model() -> str:
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as handle:
            for line in handle:
                if line.lower().startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def _memory() -> dict[str, int]:
    total = available = 0
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                value_kb = int(rest.strip().split()[0])
                if key == "MemTotal":
                    total = value_kb * 1024
                elif key == "MemAvailable":
                    available = value_kb * 1024
    except (OSError, ValueError):
        total = available = 0
    return {"total_bytes": total, "available_bytes": available}


def _gpus() -> list[dict[str, Any]]:
    gpus: list[dict[str, Any]] = []
    if shutil.which("nvidia-smi"):
        try:
            output = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,memory.free,driver_version",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            ).stdout.strip()
            for line in output.splitlines():
                parts = [part.strip() for part in line.split(",")]
                if len(parts) >= 4:
                    gpus.append(
                        {
                            "vendor": "NVIDIA",
                            "name": parts[0],
                            "vram_total_bytes": int(float(parts[1])) * 1024 * 1024,
                            "vram_free_bytes": int(float(parts[2])) * 1024 * 1024,
                            "driver": parts[3],
                            "backend": "CUDA",
                        }
                    )
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    if not gpus and shutil.which("rocm-smi"):
        gpus.append(
            {
                "vendor": "AMD",
                "name": "AMD GPU (ROCm detected)",
                "vram_total_bytes": 0,
                "vram_free_bytes": 0,
                "backend": "ROCm",
            }
        )
    if not gpus and platform.system() == "Darwin" and platform.machine() == "arm64":
        gpus.append(
            {
                "vendor": "Apple",
                "name": "Apple Silicon (Metal)",
                "vram_total_bytes": 0,
                "vram_free_bytes": 0,
                "backend": "Metal (unified memory)",
            }
        )
    return gpus


def disk_info(path: Path) -> dict[str, int]:
    try:
        usage = shutil.disk_usage(path)
        return {"total_bytes": usage.total, "free_bytes": usage.free, "used_bytes": usage.used}
    except OSError:
        return {"total_bytes": 0, "free_bytes": 0, "used_bytes": 0}


def hardware_report(data_dir: Path, models_dir: Path) -> dict[str, Any]:
    memory = _memory()
    gpus = _gpus()
    cuda_available = any(gpu["backend"] == "CUDA" for gpu in gpus)
    return {
        "os": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "python": platform.python_version(),
        "cpu": {
            "model": _cpu_model(),
            "cores": os.cpu_count() or 1,
        },
        "memory": memory,
        "gpus": gpus,
        "accelerators": {
            "cuda": cuda_available,
            "rocm": any(gpu["backend"] == "ROCm" for gpu in gpus),
            "metal": any(gpu["backend"].startswith("Metal") for gpu in gpus),
        },
        "disk": disk_info(data_dir),
        "models_disk": disk_info(models_dir),
        "inference_mode": "GPU" if cuda_available else "CPU",
    }


def recommend_quantization(memory_bytes: int, file_bytes: int) -> dict[str, Any]:
    """Explain whether a model plausibly fits in RAM (rough, documented heuristic)."""
    if memory_bytes <= 0 or file_bytes <= 0:
        return {"fits": None, "reason": "Insufficient hardware information."}
    headroom = memory_bytes * 0.7
    if file_bytes <= headroom:
        return {
            "fits": True,
            "reason": (
                f"Weights (~{file_bytes / 1e9:.1f} GB) leave room for context in "
                f"{memory_bytes / 1e9:.1f} GB system memory."
            ),
        }
    return {
        "fits": False,
        "reason": (
            f"Weights (~{file_bytes / 1e9:.1f} GB) exceed the recommended "
            f"{headroom / 1e9:.1f} GB budget. Choose a smaller or more quantized model."
        ),
    }
