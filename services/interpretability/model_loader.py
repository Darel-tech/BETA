"""
Loads Gemma-2-2B-it and its matching Gemma Scope SAE exactly once per
process, and hands out a cached handle to everyone else in this service.

Why a module-level singleton instead of loading per-request: the model is a
multi-gigabyte object and loading it takes real time. Loading it on every
request would make the service unusably slow and would hammer the GPU. We
load once at FastAPI startup (see app.py's lifespan handler) and reuse the
same object for the life of the process.

This file has no knowledge of FastAPI, HTTP, or the database — it only knows
how to produce a working model + SAE pair. That separation is what makes it
independently testable (see tests/test_probe.py, which mocks this module
rather than downloading real weights in CI).
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import torch

from config import get_settings

logger = logging.getLogger("interpretability.model_loader")


class ModelLoadError(RuntimeError):
    """Raised when the model or SAE fails to load. Never swallow this silently."""


@dataclass
class LoadedModel:
    model: "object"          # transformer_lens.HookedTransformer at runtime
    sae: "object"             # sae_lens.SAE at runtime
    device: str
    layer: int


_lock = threading.Lock()
_cached: LoadedModel | None = None


def _resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_model_and_sae() -> LoadedModel:
    """
    Thread-safe singleton accessor. Safe to call from multiple request
    handlers concurrently — only the first caller actually loads anything.
    """
    global _cached
    if _cached is not None:
        return _cached

    with _lock:
        # Re-check inside the lock: another thread may have finished loading
        # while we were waiting for the lock.
        if _cached is not None:
            return _cached

        settings = get_settings()
        device = _resolve_device(settings.device)
        logger.info(
            "Loading model=%s sae_release=%s layer=%d device=%s",
            settings.model_name, settings.sae_release, settings.sae_layer, device,
        )

        try:
            # Imported lazily so that importing this module (e.g. for a quick
            # unit test of _resolve_device) never requires torch/transformer_lens
            # to actually be installed and working.
            from transformer_lens import HookedTransformer
            from sae_lens import SAE

            dtype_map = {"float16": torch.float16, "bfloat16": torch.bfloat16, "float32": torch.float32}
            torch_dtype = dtype_map[settings.model_dtype]

            model = HookedTransformer.from_pretrained(
                settings.model_name,
                device=device,
                dtype=torch_dtype,
            )
            model.eval()

            sae, _cfg_dict, _sparsity = SAE.from_pretrained(
                release=settings.sae_release,
                sae_id=f"layer_{settings.sae_layer}/width_16k/canonical",
                device=device,
            )
            sae.eval()

        except Exception as exc:  # noqa: BLE001 — we want one clear failure mode
            logger.exception("Model/SAE load failed")
            raise ModelLoadError(f"Failed to load model or SAE: {exc}") from exc

        _cached = LoadedModel(model=model, sae=sae, device=device, layer=settings.sae_layer)
        logger.info("Model and SAE loaded successfully on %s", device)
        return _cached


def is_loaded() -> bool:
    return _cached is not None


def reset_cache_for_tests() -> None:
    """Only ever call this from tests. Never call this in production code paths."""
    global _cached
    with _lock:
        _cached = None