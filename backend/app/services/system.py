"""Best-effort hardware detection; every field is optional."""
import os
import platform
import shutil
import subprocess
from pathlib import Path


def _ram_bytes() -> int | None:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        pass
    if os.name == "nt":
        try:
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("m", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                            ("a", ctypes.c_ulonglong), ("b", ctypes.c_ulonglong), ("c", ctypes.c_ulonglong),
                            ("d", ctypes.c_ulonglong), ("e", ctypes.c_ulonglong), ("f", ctypes.c_ulonglong)]

            s = MS()
            s.l = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))  # type: ignore[attr-defined]
            return int(s.total)
        except Exception:
            return None
    return None


def _gpus() -> list[str]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run([exe, "--query-gpu=name,memory.total", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=5)
        return [l.strip() for l in out.stdout.splitlines() if l.strip()] if out.returncode == 0 else []
    except (OSError, subprocess.SubprocessError):
        return []


def system_info(data_dir: Path) -> dict:
    probe = data_dir if data_dir.exists() else data_dir.parent
    try:
        disk = shutil.disk_usage(probe)
        disk_info = {"total": disk.total, "free": disk.free}
    except OSError:
        disk_info = None
    return {
        "os": f"{platform.system()} {platform.release()}",
        "cpu_count": os.cpu_count(),
        "ram_total_bytes": _ram_bytes(),
        "disk": disk_info,
        "gpus": _gpus(),
        "gpu_note": "GPU detection covers NVIDIA via nvidia-smi only; CPU-only use is fully supported.",
    }
