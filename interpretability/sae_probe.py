"""
The scientific core of your part of BETA.

Pipeline, in order:
 1. Find where an entity's tokens sit inside the full text.
 2. Run the text through the model, capturing the residual-stream activation
   at the entity's final token (this is the hook point Gemma Scope's SAEs
   were trained on).
 3. Pass that activation through the SAE to get a sparse latent vector.
 4. Score it against a calibrated "known direction" — a vector learned
   offline (see scripts/train_probe.py) from labeled known vs. unknown
   entities, and stored in config.probe_artifact_path.

A score near 1.0 means the model's internal signal says "I genuinely know
this." A score near 0.0 means "I don't" — which is exactly the situation
where the model is prone to hallucinate confidently anyway.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from config import get_settings
from model_loader import LoadedModel, ModelLoadError

logger = logging.getLogger("interpretability.sae_probe")


class ProbeNotCalibratedError(RuntimeError):
    """Raised when the known-direction artifact hasn't been trained/saved yet."""


class EntityNotFoundError(ValueError):
    """Raised when an entity string can't be located inside the given text."""


@dataclass
class EntityScore:
    entity: str
    known_ness: float  # 0.0 (unknown) to 1.0 (known)
    token_span: tuple[int, int]


def _find_entity_token_span(model, text: str, entity: str) -> tuple[int, int]:
    """
    Locate the token indices covering `entity` inside `text`.

    This does a character-offset lookup against the tokenizer's offset
    mapping rather than a naive string search over decoded tokens, which
    avoids subtle off-by-one bugs when entities span multiple sub-word
    tokens or sit next to punctuation.
    """
    # NOTE (verify empirically): this assumes the HF tokenizer's offset
    # mapping and transformer_lens's `to_tokens` prepend the same special
    # tokens in the same positions for this model. That's true for Gemma-2
    # as of this writing, but if you ever see off-by-one scoring errors,
    # this is the first place to check — print both token sequences side
    # by side for a known sentence and confirm they line up.
    char_start = text.find(entity)
    if char_start == -1:
        raise EntityNotFoundError(f"entity {entity!r} not found verbatim in text")
    char_end = char_start + len(entity)

    encoding = model.tokenizer(text, return_offsets_mapping=True, add_special_tokens=True)
    offsets = encoding["offset_mapping"]

    token_indices = [
        i for i, (s, e) in enumerate(offsets)
        if s is not None and e is not None and s < char_end and e > char_start
    ]
    if not token_indices:
        raise EntityNotFoundError(f"could not map entity {entity!r} to any token span")

    return token_indices[0], token_indices[-1]


def _load_known_direction(path: str) -> np.ndarray:
    artifact_path = Path(path)
    if not artifact_path.exists():
        raise ProbeNotCalibratedError(
            f"No calibrated probe found at {path}. Run scripts/train_probe.py first — "
            "this service refuses to serve an uncalibrated probe rather than guess."
        )
    data = np.load(artifact_path)
    direction = data["direction"]
    # Defensive normalization: a non-unit vector would silently scale every
    # score, which is a very easy bug to ship if the training script changes.
    norm = np.linalg.norm(direction)
    if norm == 0:
        raise ProbeNotCalibratedError("Stored known-direction vector is all zeros — retrain the probe.")
    return direction / norm


class KnownnessProbe:
    """
    Stateful wrapper around a loaded model + SAE + calibrated direction.
    Construct once (via get_probe(), cached) and reuse across requests.
    """

    def __init__(self, loaded: LoadedModel, known_direction: np.ndarray):
        self._model = loaded.model
        self._sae = loaded.sae
        self._layer = loaded.layer
        self._device = loaded.device
        self._direction = torch.tensor(known_direction, device=self._device, dtype=torch.float32)
        self._hook_name = f"blocks.{self._layer}.hook_resid_post"

    @torch.no_grad()
    def score_entities(self, text: str, entities: list[str]) -> list[EntityScore]:
        if not entities:
            return []

        tokens = self._model.to_tokens(text)
        _, cache = self._model.run_with_cache(
            tokens, names_filter=lambda name: name == self._hook_name
        )
        resid = cache[self._hook_name][0]  # shape: [seq_len, d_model]

        # SAE encode the whole sequence at once — cheaper than one call per entity.
        latents = self._sae.encode(resid.to(torch.float32))  # [seq_len, d_sae]

        results: list[EntityScore] = []
        for entity in entities:
            try:
                start_tok, end_tok = _find_entity_token_span(self._model, text, entity)
            except EntityNotFoundError:
                logger.warning("Entity %r not found in text; skipping", entity)
                continue

            entity_latent = latents[end_tok]  # last token of the span carries the signal
            raw_score = torch.dot(entity_latent, self._direction).item()
            # Squash to [0, 1] with a sigmoid so downstream thresholds are stable
            # regardless of the raw dot-product's scale.
            known_ness = float(torch.sigmoid(torch.tensor(raw_score)))

            results.append(EntityScore(entity=entity, known_ness=known_ness, token_span=(start_tok, end_tok)))

        return results


@torch.no_grad()
def extract_latent_for_entity(loaded: LoadedModel, text: str, entity: str) -> np.ndarray:
    """
    Standalone extraction used by scripts/train_probe.py to build the
    calibration dataset. Deliberately independent of KnownnessProbe (which
    requires an already-calibrated direction) to avoid a chicken-and-egg
    dependency: you need this function to produce the direction in the
    first place.
    """
    layer = loaded.layer
    hook_name = f"blocks.{layer}.hook_resid_post"
    tokens = loaded.model.to_tokens(text)
    _, cache = loaded.model.run_with_cache(tokens, names_filter=lambda name: name == hook_name)
    resid = cache[hook_name][0]

    _, end_tok = _find_entity_token_span(loaded.model, text, entity)
    latent = loaded.sae.encode(resid[end_tok].unsqueeze(0).to(torch.float32))[0]
    return latent.cpu().numpy()


_probe_singleton: KnownnessProbe | None = None


def get_probe(loaded: LoadedModel) -> KnownnessProbe:
    """Cached probe accessor — mirrors model_loader's singleton pattern."""
    global _probe_singleton
    if _probe_singleton is None:
        settings = get_settings()
        direction = _load_known_direction(settings.probe_artifact_path)
        _probe_singleton = KnownnessProbe(loaded, direction)
    return _probe_singleton


def reset_probe_for_tests() -> None:
    global _probe_singleton
    _probe_singleton = None