"""Claim-level entailment checking against supplied reference facts.

Model and label mapping
-----------------------
The default scorer wraps ``cross-encoder/nli-deberta-v3-small`` through the
maintained ``sentence-transformers`` ``CrossEncoder`` class. For each pair
``(premise, hypothesis)`` the model emits three logits, in this order::

    index 0 -> contradiction
    index 1 -> entailment
    index 2 -> neutral

Here the *premise* is a reference fact and the *hypothesis* is the claim being
checked. Logits are converted to probabilities with a softmax. If the loaded
model exposes an ``id2label`` config, the order is read from it instead of
being assumed.

Internally every scorer returns probabilities as
``(p_contradiction, p_entailment, p_neutral)``. These are mapped to labels:

* ``contradiction`` -> ``contradicted``
* ``entailment``    -> ``supported``
* ``neutral``       -> ``unrelated``

Score interpretation
--------------------
A per-fact score is the model's softmax probability for the winning label.
It measures the NLI model's confidence about the *textual relation between the
fact and the claim*. It is not a calibrated probability and it is **not proof
that the claim is true or false**: the NLI model can be wrong, and the
reference facts themselves can be incomplete or incorrect.

Aggregation across several facts
--------------------------------
1. If **any** fact is labelled ``contradicted`` the overall label is
   ``contradicted`` (score = highest contradiction probability among those
   facts). Contradictory evidence is never outvoted by supporting facts;
   ``has_conflict`` is set when some other fact supports the claim.
2. Otherwise, if **any** fact is ``supported`` the overall label is
   ``supported`` (score = highest entailment probability among those facts).
3. Otherwise the overall label is ``unrelated`` (score = highest neutral
   probability).

The claim is treated as a single unit; splitting a long answer into atomic
claims is left to the caller.
"""

from __future__ import annotations

import logging
import math
import os
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, Sequence, Tuple

import numpy as np

from .errors import (
    BlackBoxError,
    InputValidationError,
    ModelError,
    NoReferenceFactsError,
)

logger = logging.getLogger(__name__)

DEFAULT_NLI_MODEL = "cross-encoder/nli-deberta-v3-small"
MAX_FACTS = 50
MAX_TEXT_CHARS = 10000

#: Order in which scorers return probabilities.
SCORER_ORDER = ("contradiction", "entailment", "neutral")


class EntailmentLabel(str, Enum):
    """Overall or per-fact relation between reference fact(s) and a claim."""

    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    UNRELATED = "unrelated"


_INDEX_TO_LABEL = (
    EntailmentLabel.CONTRADICTED,
    EntailmentLabel.SUPPORTED,
    EntailmentLabel.UNRELATED,
)


class NLIScorer(Protocol):
    """Interface for NLI backends (real or mock)."""

    def score(self, pairs: Sequence[Tuple[str, str]]) -> Sequence[Sequence[float]]:
        """Score ``(premise, hypothesis)`` pairs.

        Returns one ``(p_contradiction, p_entailment, p_neutral)`` row per pair.
        """
        ...


@dataclass(frozen=True)
class FactResult:
    """NLI outcome for one reference fact."""

    fact: str
    label: EntailmentLabel
    score: float
    contradiction: float
    entailment: float
    neutral: float


@dataclass(frozen=True)
class EntailmentResult:
    """Aggregated entailment outcome for one claim.

    Attributes:
        claim: The claim that was checked.
        label: Overall label (see module docstring for aggregation rules).
        score: NLI confidence for the overall label, in ``[0, 1]``. Not a
            calibrated probability of factual truth.
        fact_results: One :class:`FactResult` per usable reference fact.
        has_conflict: True when the overall label is ``contradicted`` but at
            least one other fact supports the claim.
        model_name: Name of the NLI backend that produced the scores.
    """

    claim: str
    label: EntailmentLabel
    score: float
    fact_results: Tuple[FactResult, ...]
    has_conflict: bool = False
    model_name: str = ""


# --------------------------------------------------------------------------
# Real scorer
# --------------------------------------------------------------------------


def _to_probabilities(raw: Any) -> np.ndarray:
    """Convert model output to an ``(n, 3)`` probability matrix.

    Rows that already look like probabilities (within ``[0, 1]`` and summing to
    about 1) are kept; anything else is treated as logits and soft-maxed.
    """
    arr = np.atleast_2d(np.asarray(raw, dtype=float))
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ModelError("NLI model returned an unexpected output shape")
    if not np.all(np.isfinite(arr)):
        raise ModelError("NLI model returned non-finite values")
    looks_like_probs = (
        np.all(arr >= 0.0)
        and np.all(arr <= 1.0)
        and np.allclose(arr.sum(axis=1), 1.0, atol=1e-3)
    )
    if looks_like_probs:
        return arr
    shifted = arr - arr.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def _label_permutation(id2label: Any) -> Optional[List[int]]:
    """Indices that reorder model columns into ``SCORER_ORDER``.

    Returns ``None`` when the config has no recognisable NLI label names, in
    which case the documented default order is assumed.
    """
    if not isinstance(id2label, dict) or not id2label:
        return None
    found: Dict[str, int] = {}
    for idx, name in id2label.items():
        lowered = str(name).lower()
        for wanted in SCORER_ORDER:
            if lowered.startswith(wanted[:5]):
                try:
                    found[wanted] = int(idx)
                except (TypeError, ValueError):
                    return None
    if set(found) != set(SCORER_ORDER) or len(set(found.values())) != 3:
        return None
    return [found[name] for name in SCORER_ORDER]


class CrossEncoderNLIScorer:
    """NLI scorer backed by a sentence-transformers ``CrossEncoder``.

    The model is loaded lazily on the first :meth:`score` call (which may
    download roughly 570 MB on first use for the default model).
    A pre-built ``model`` can be injected to avoid any download.
    """

    def __init__(self, model_name: Optional[str] = None, *, model: Any = None) -> None:
        self.model_name = (
            (model_name or "").strip()
            or os.environ.get("BLACKBOX_NLI_MODEL", "").strip()
            or DEFAULT_NLI_MODEL
        )
        self._model = model
        self._permutation: Optional[List[int]] = None
        self._ready = False
        self._lock = threading.Lock()

    def _ensure_ready(self) -> Any:
        with self._lock:
            if self._model is None:
                try:
                    from sentence_transformers import CrossEncoder

                    self._model = CrossEncoder(self.model_name)
                except Exception as exc:
                    raise ModelError(
                        f"Could not load NLI model '{self.model_name}' "
                        f"({type(exc).__name__})"
                    ) from exc
            if not self._ready:
                config = getattr(self._model, "config", None)
                self._permutation = _label_permutation(
                    getattr(config, "id2label", None)
                )
                self._ready = True
            return self._model

    def score(self, pairs: Sequence[Tuple[str, str]]) -> List[List[float]]:
        model = self._ensure_ready()
        try:
            raw = model.predict(
                [[premise, hypothesis] for premise, hypothesis in pairs],
                show_progress_bar=False,
            )
        except Exception as exc:
            raise ModelError(f"NLI inference failed ({type(exc).__name__})") from exc
        probs = _to_probabilities(raw)
        if self._permutation is not None:
            probs = probs[:, self._permutation]
        return probs.tolist()


_SCORER_CACHE: Dict[str, NLIScorer] = {}
_SCORER_LOCK = threading.Lock()


def get_default_scorer(model_name: Optional[str] = None) -> NLIScorer:
    """Return a process-wide cached :class:`CrossEncoderNLIScorer`."""
    name = (
        (model_name or "").strip()
        or os.environ.get("BLACKBOX_NLI_MODEL", "").strip()
        or DEFAULT_NLI_MODEL
    )
    with _SCORER_LOCK:
        if name not in _SCORER_CACHE:
            _SCORER_CACHE[name] = CrossEncoderNLIScorer(name)
        return _SCORER_CACHE[name]


def clear_scorer_cache() -> None:
    """Drop cached scorers (used by tests)."""
    with _SCORER_LOCK:
        _SCORER_CACHE.clear()


# --------------------------------------------------------------------------
# Validation and checking
# --------------------------------------------------------------------------


def normalize_facts(facts: Any) -> List[str]:
    """Validate and clean a list of reference facts.

    ``None`` and an empty list both yield ``[]``. Blank facts are dropped and
    surrounding whitespace is stripped.

    Raises:
        InputValidationError: ``facts`` is not a list/tuple of strings, has too
            many items, or contains an over-long item.
    """
    if facts is None:
        return []
    if isinstance(facts, (str, bytes)) or not isinstance(facts, (list, tuple)):
        raise InputValidationError("reference facts must be a list of strings")
    if len(facts) > MAX_FACTS:
        raise InputValidationError(f"At most {MAX_FACTS} reference facts are allowed")
    cleaned: List[str] = []
    for fact in facts:
        if not isinstance(fact, str):
            raise InputValidationError("reference facts must be strings")
        stripped = fact.strip()
        if len(stripped) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Each reference fact must be at most {MAX_TEXT_CHARS} characters"
            )
        if stripped:
            cleaned.append(stripped)
    return cleaned


def _validate_rows(raw: Any, expected: int) -> List[Tuple[float, float, float]]:
    try:
        rows = list(raw)
    except TypeError as exc:
        raise ModelError("NLI scorer returned an unexpected result") from exc
    if len(rows) != expected:
        raise ModelError("NLI scorer returned the wrong number of results")
    validated: List[Tuple[float, float, float]] = []
    for row in rows:
        try:
            values = tuple(float(v) for v in row)
        except (TypeError, ValueError) as exc:
            raise ModelError("NLI scorer returned a malformed row") from exc
        if len(values) != 3:
            raise ModelError("NLI scorer returned a row that is not 3 values")
        if any(not math.isfinite(v) or v < -1e-6 or v > 1.0 + 1e-6 for v in values):
            raise ModelError("NLI scorer returned probabilities outside [0, 1]")
        validated.append(tuple(min(1.0, max(0.0, v)) for v in values))  # type: ignore[arg-type]
    return validated


def check_entailment(
    claim: str,
    facts: Any,
    *,
    scorer: Optional[NLIScorer] = None,
    model_name: Optional[str] = None,
) -> EntailmentResult:
    """Check ``claim`` against each reference fact and aggregate the result.

    Args:
        claim: The answer or claim to evaluate (treated as one hypothesis).
        facts: Reference facts (premises).
        scorer: Optional injected scorer; defaults to the cached real model.
        model_name: NLI model name for the default scorer.

    Raises:
        InputValidationError: Blank/invalid claim or malformed facts.
        NoReferenceFactsError: No usable (non-blank) facts were supplied.
        ModelError: The NLI model failed or returned malformed output.
    """
    if not isinstance(claim, str):
        raise InputValidationError("claim must be a string")
    claim = claim.strip()
    if not claim:
        raise InputValidationError("claim must not be blank")
    if len(claim) > MAX_TEXT_CHARS:
        raise InputValidationError(f"claim must be at most {MAX_TEXT_CHARS} characters")

    cleaned = normalize_facts(facts)
    if not cleaned:
        raise NoReferenceFactsError("No usable reference facts were supplied")

    if scorer is None:
        scorer = get_default_scorer(model_name)

    pairs = [(fact, claim) for fact in cleaned]
    try:
        raw = scorer.score(pairs)
    except BlackBoxError:
        raise
    except Exception as exc:
        raise ModelError(f"NLI scoring failed ({type(exc).__name__})") from exc
    rows = _validate_rows(raw, len(pairs))

    fact_results: List[FactResult] = []
    for fact, (contra, entail, neutral) in zip(cleaned, rows):
        probs = (contra, entail, neutral)
        idx = int(np.argmax(probs))  # ties resolve to contradiction (conservative)
        fact_results.append(
            FactResult(
                fact=fact,
                label=_INDEX_TO_LABEL[idx],
                score=probs[idx],
                contradiction=contra,
                entailment=entail,
                neutral=neutral,
            )
        )

    contradicted = [r for r in fact_results if r.label is EntailmentLabel.CONTRADICTED]
    supported = [r for r in fact_results if r.label is EntailmentLabel.SUPPORTED]
    if contradicted:
        label = EntailmentLabel.CONTRADICTED
        score = max(r.contradiction for r in contradicted)
        has_conflict = bool(supported)
    elif supported:
        label = EntailmentLabel.SUPPORTED
        score = max(r.entailment for r in supported)
        has_conflict = False
    else:
        label = EntailmentLabel.UNRELATED
        score = max(r.neutral for r in fact_results)
        has_conflict = False

    return EntailmentResult(
        claim=claim,
        label=label,
        score=float(score),
        fact_results=tuple(fact_results),
        has_conflict=has_conflict,
        model_name=getattr(scorer, "model_name", "") or "injected-scorer",
    )
