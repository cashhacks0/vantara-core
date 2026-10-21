"""Studio capability detection and local generation adapters.

Only capabilities backed by detected libraries/binaries are reported as
available.  Nothing here fabricates progress or placeholder media.
"""

from __future__ import annotations

import asyncio
import importlib.util
import random
import shutil
from pathlib import Path
from typing import Any

from ..core.db import new_id, utc_now
from ..core.logging import get_logger
from ..security import safe_join

log = get_logger(__name__)
_IMAGE_PIPELINES: dict[str, Any] = {}


class StudioUnavailable(RuntimeError):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


def _diffusers_available() -> bool:
    return importlib.util.find_spec("torch") is not None and importlib.util.find_spec("diffusers") is not None


def detect_image_models(models_dir: Path) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    if not models_dir.exists():
        return models
    for index in models_dir.rglob("model_index.json"):
        models.append({"path": str(index.parent), "name": index.parent.name})
    return models


def capabilities(models_dir: Path, outputs_dir: Path) -> dict[str, Any]:
    image_models = detect_image_models(models_dir)
    diffusers = _diffusers_available()
    image = {
        "available": diffusers and bool(image_models),
        "reason": (
            f"Diffusers detected with {len(image_models)} local pipeline(s)."
            if diffusers and image_models
            else "A local Diffusers pipeline is not installed."
        ),
        "hint": None if diffusers and image_models else "Install torch + diffusers and place a pipeline in the models directory, or use a ComfyUI backend (planned).",
        "models": image_models,
    }
    asr_available = importlib.util.find_spec("faster_whisper") is not None
    tts_binary = shutil.which("piper")
    audio = {
        "available": bool(asr_available or tts_binary),
        "speech_recognition": asr_available,
        "text_to_speech": bool(tts_binary),
        "reason": (
            "faster-whisper and/or Piper detected."
            if audio_available(asr_available, tts_binary)
            else "No local audio backend detected."
        ),
        "hint": None if audio_available(asr_available, tts_binary) else "Install faster-whisper for transcription or Piper for speech synthesis.",
    }
    video = {
        "available": False,
        "reason": "No local video generation backend is configured.",
        "hint": "The plugin interface is ready; a supported video backend must be installed and registered first.",
    }
    return {
        "image": image,
        "audio": audio,
        "video": video,
        "outputs_dir": str(outputs_dir),
    }


def audio_available(asr: bool, tts: Any) -> bool:
    return bool(asr or tts)


def _load_pipeline(model: str):
    if model in _IMAGE_PIPELINES:
        return _IMAGE_PIPELINES[model]
    if not _diffusers_available():
        raise StudioUnavailable(
            "Local image generation requires PyTorch and Diffusers.",
            hint="Install with: pip install torch diffusers accelerate safetensors",
        )
    from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
    import torch

    path = Path(model)
    if not path.exists():
        raise StudioUnavailable(
            "The selected image model directory does not exist.",
            hint="Provide a local Diffusers model directory. VANTARA does not download gated pipelines automatically.",
        )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipeline = AutoPipelineForText2Image.from_pretrained(str(path), torch_dtype=torch.float16 if device == "cuda" else torch.float32)
    pipeline = pipeline.to(device)
    pipeline.safety_checker = None
    _IMAGE_PIPELINES[path.name] = pipeline
    return pipeline


async def generate_image(
    prompt: str,
    negative_prompt: str,
    model: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
    outputs_dir: Path,
    init_image: str | None = None,
) -> dict[str, Any]:
    if not prompt.strip():
        raise StudioUnavailable("A prompt is required.")
    resolved_seed = seed if seed is not None and seed >= 0 else random.randint(0, 2**31 - 1)
    try:
        generator = await _generate_sync(prompt, negative_prompt, model, width, height, steps, resolved_seed, init_image)
    except StudioUnavailable:
        raise
    except Exception as exc:
        log.warning("Image generation failed: %s", exc)
        raise StudioUnavailable(f"Image generation failed: {exc}") from exc
    output_id = new_id("out_")
    target = safe_join(outputs_dir, f"image-{output_id[:10]}.png")
    generator.save(target)
    return {
        "output_id": output_id,
        "name": target.name,
        "path": str(target),
        "seed": resolved_seed,
        "width": width,
        "height": height,
        "prompt": prompt,
        "model": model,
        "created_at": utc_now(),
    }


async def _generate_sync(prompt, negative_prompt, model, width, height, steps, seed, init_image):
    def run():
        import torch

        if not model:
            raise StudioUnavailable("No image model selected.")
        pipe = _load_pipeline(model)
        generator = torch.Generator(device="cpu").manual_seed(seed)
        if init_image:
            from diffusers import AutoPipelineForImage2Image
            from PIL import Image

            image = Image.open(init_image).convert("RGB")
            if not hasattr(pipe, "vae"):
                raise StudioUnavailable("The selected pipeline does not support image-to-image.")
            result = pipe(
                prompt=prompt, negative_prompt=negative_prompt or None, image=image,
                width=width, height=height, num_inference_steps=max(1, steps),
                generator=generator,
            )
        else:
            result = pipe(
                prompt=prompt, negative_prompt=negative_prompt or None,
                width=width, height=height, num_inference_steps=max(1, steps),
                generator=generator,
            )
        return result.images[0]

    return await asyncio.to_thread(run)


async def transcribe(path: Path, model_size: str = "base") -> dict[str, Any]:
    if importlib.util.find_spec("faster_whisper") is None:
        raise StudioUnavailable(
            "Local speech recognition requires faster-whisper.",
            hint="pip install faster-whisper",
        )
    from faster_whisper import WhisperModel

    def run():
        model = WhisperModel(model_size, device="auto", compute_type="int8")
        segments, info = model.transcribe(str(path))
        items = [{"start": s.start, "end": s.end, "text": s.text} for s in segments]
        return {"language": info.language, "duration": info.duration, "segments": items, "text": " ".join(i["text"] for i in items).strip()}

    return await asyncio.to_thread(run)
