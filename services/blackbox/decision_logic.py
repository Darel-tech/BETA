"""Explainable decision rules combining consistency and entailment signals.

Verdicts
--------
``trustworthy``      - signals support the answer.
``uncertain``        - signals are weak, missing, or in conflict.
``needs_correction`` - the answer is contradicted by reference facts, or
                       (with no usable facts) its resamples disagree strongly.

Rules (evaluated in this order)
-------------------------------
Let ``c`` be the consistency score (or ``None`` if not computed) and ``e`` the
entailment result (or ``None`` if no reference facts were supplied).

1. ``e`` contradicted with score >= ``strong_contradiction``
   -> ``needs_correction``. High consistency never overrides this.
2. ``e`` contradicted with a weaker score -> ``uncertain``.
3. ``e`` supported:
   * score < ``min_support``            -> ``uncertain`` (weak support)
   * ``c`` is ``None``                  -> ``trustworthy`` (confidence capped)
   * ``c`` >= ``low_consistency``       -> ``trustworthy``
   * ``c`` <  ``low_consistency``       -> ``uncertain`` (conflicting signals)
4. ``e`` unrelated (facts exist but do not address the claim):
   * ``c`` < ``low_consistency``        -> ``needs_correction`` (capped)
   * otherwise                          -> ``uncertain``. High consistency is
     not proof of correctness, so it cannot yield ``trustworthy`` here.
5. ``e`` is ``None`` (no facts): fall back cautiously to consistency only:
   ``c`` >= ``high_consistency`` -> ``trustworthy``; ``c`` < ``low_consistency``
   -> ``needs_correction``; otherwise ``uncertain``. Confidence is capped at
   ``single_signal_cap`` and the evidence states that fact verification was
   unavailable.

Confidence
----------
``confidence`` is a **heuristic** score in ``[0, 1]`` describing how strongly
the rules back the verdict. It is **not** a calibrated probability: no
calibration has been performed or evaluated.

Threshold rationale
-------------------
The defaults are conservative starting points chosen by judgement, not tuned on
data. ``high_consistency=0.80`` and ``low_consistency=0.50`` are typical
regions for MiniLM-style cosine similarity between paraphrases versus
unrelated text. ``strong_contradiction=0.80`` and ``min_support=0.60`` demand
clear NLI confidence before the verdict hinges on it. They should be tuned on
a labelled validation set before any accuracy claim is made.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Tuple

from .entailment_check import EntailmentLabel, EntailmentResult
from .errors import ConfigurationError, InputValidationError


class Verdict(str, Enum):
    """The only verdict values the detector can return."""

    TRUSTWORTHY = "trustworthy"
    UNCERTAIN = "uncertain"
    NEEDS_CORRECTION = "needs_correction"


@dataclass(frozen=True)
class DecisionThresholds:
    """Configurable thresholds (see module docstring for rationale)."""

    high_consistency: float = 0.80
    low_consistency: float = 0.50
    strong_contradiction: float = 0.80
    min_support: float = 0.60
    single_signal_cap: float = 0.75

    def __post_init__(self) -> None:
        for name in (
            "high_consistency",
            "low_consistency",
            "strong_contradiction",
            "min_support",
            "single_signal_cap",
        ):
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not 0.0 <= value <= 1.0
            ):
                raise InputValidationError(f"threshold '{name}' must be in [0, 1]")
        if self.low_consistency > self.high_consistency:
            raise InputValidationError(
                "low_consistency must not exceed high_consistency"
            )

    @classmethod
    def from_env(cls) -> "DecisionThresholds":
        """Build thresholds from ``BLACKBOX_T_*`` environment variables."""
        defaults = cls()
        values: Dict[str, float] = {}
        mapping = {
            "high_consistency": "BLACKBOX_T_HIGH_CONSISTENCY",
            "low_consistency": "BLACKBOX_T_LOW_CONSISTENCY",
            "strong_contradiction": "BLACKBOX_T_STRONG_CONTRADICTION",
            "min_support": "BLACKBOX_T_MIN_SUPPORT",
            "single_signal_cap": "BLACKBOX_T_SINGLE_SIGNAL_CAP",
        }
        for field_name, env_name in mapping.items():
            raw = os.environ.get(env_name, "").strip()
            if not raw:
                values[field_name] = getattr(defaults, field_name)
                continue
            try:
                values[field_name] = float(raw)
            except ValueError as exc:
                raise ConfigurationError(f"{env_name} must be a number") from exc
        try:
            return cls(**values)
        except InputValidationError as exc:
            raise ConfigurationError(f"Invalid threshold configuration: {exc}") from exc


@dataclass(frozen=True)
class Decision:
    """Structured decision.

    Attributes:
        verdict: One of :class:`Verdict`.
        confidence: Heuristic strength of the verdict in ``[0, 1]`` (not a
            calibrated probability).
        evidence: Human-readable explanation lines.
        signals: The underlying signal values used by the rules.
    """

    verdict: Verdict
    confidence: float
    evidence: Tuple[str, ...]
    signals: Dict[str, Any] = field(default_factory=dict)


def _clamp01(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


def _validate_unit(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputValidationError(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise InputValidationError(f"{name} must be within [0, 1]")
    return value


def decide(
    consistency_score: Optional[float],
    entailment: Optional[EntailmentResult],
    thresholds: Optional[DecisionThresholds] = None,
) -> Decision:
    """Combine signals into a verdict using the documented rules.

    Raises:
        InputValidationError: Both signals missing, scores outside ``[0, 1]``,
            or an unexpected entailment label.
    """
    t = thresholds or DecisionThresholds()

    c: Optional[float] = None
    if consistency_score is not None:
        c = _validate_unit(consistency_score, "consistency_score")

    label: Optional[EntailmentLabel] = None
    e_score: Optional[float] = None
    if entailment is not None:
        try:
            label = EntailmentLabel(getattr(entailment, "label", None))
        except ValueError as exc:
            raise InputValidationError("Unexpected entailment label") from exc
        e_score = _validate_unit(getattr(entailment, "score", None), "entailment score")

    if c is None and entailment is None:
        raise InputValidationError(
            "At least one of consistency_score or entailment is required"
        )

    signals: Dict[str, Any] = {
        "consistency_score": c,
        "entailment_label": label.value if label else None,
        "entailment_score": e_score,
        "has_conflict": bool(getattr(entailment, "has_conflict", False))
        if entailment is not None
        else None,
        "reference_facts_checked": len(entailment.fact_results)
        if entailment is not None
        else 0,
        "fact_verification_available": entailment is not None,
        "confidence_is_calibrated": False,
    }

    def build(verdict: Verdict, confidence: float, evidence: list) -> Decision:
        return Decision(
            verdict=verdict,
            confidence=_clamp01(confidence),
            evidence=tuple(evidence),
            signals=signals,
        )

    c_txt = f"{c:.2f}" if c is not None else None

    # ---- No reference facts: consistency-only fallback -------------------
    if entailment is None:
        evidence = [
            "No reference facts were supplied, so fact verification was unavailable.",
            "The verdict rests on response consistency only; a model can be "
            "consistently wrong, so this is weaker evidence.",
        ]
        assert c is not None and c_txt is not None
        if c >= t.high_consistency:
            evidence.insert(0, f"Resampled answers agree strongly (consistency {c_txt}).")
            return build(Verdict.TRUSTWORTHY, min(c, t.single_signal_cap), evidence)
        if c < t.low_consistency:
            evidence.insert(0, f"Resampled answers disagree (consistency {c_txt}).")
            return build(
                Verdict.NEEDS_CORRECTION, min(1.0 - c, t.single_signal_cap), evidence
            )
        evidence.insert(0, f"Resampled answers agree only moderately (consistency {c_txt}).")
        return build(Verdict.UNCERTAIN, 0.5, evidence)

    assert label is not None and e_score is not None
    e_txt = f"{e_score:.2f}"
    c_missing = "Response consistency was not computed (no question supplied)."

    # ---- Contradicted -----------------------------------------------------
    if label is EntailmentLabel.CONTRADICTED:
        evidence = [
            f"A reference fact contradicts the claim (NLI score {e_txt})."
        ]
        if signals["has_conflict"]:
            evidence.append(
                "Another reference fact supports the claim; the contradiction "
                "is still treated as decisive evidence to review."
            )
        if e_score >= t.strong_contradiction:
            if c is not None and c >= t.high_consistency:
                evidence.append(
                    f"High response consistency ({c_txt}) does not override the "
                    "contradiction; consistent answers can still be wrong."
                )
            elif c is None:
                evidence.append(c_missing)
            return build(Verdict.NEEDS_CORRECTION, e_score, evidence)
        evidence.append(
            f"The contradiction is weaker than the strong-contradiction "
            f"threshold ({t.strong_contradiction:.2f}), so the result is uncertain."
        )
        if c is None:
            evidence.append(c_missing)
        return build(Verdict.UNCERTAIN, 0.5, evidence)

    # ---- Supported --------------------------------------------------------
    if label is EntailmentLabel.SUPPORTED:
        evidence = [f"Reference facts support the claim (NLI score {e_txt})."]
        if e_score < t.min_support:
            evidence.append(
                f"Support is weaker than the minimum ({t.min_support:.2f}), so "
                "the result is uncertain."
            )
            if c is None:
                evidence.append(c_missing)
            return build(Verdict.UNCERTAIN, 0.5, evidence)
        if c is None:
            evidence.append(c_missing)
            return build(Verdict.TRUSTWORTHY, min(e_score, t.single_signal_cap), evidence)
        if c >= t.low_consistency:
            if c >= t.high_consistency:
                evidence.append(f"Resampled answers agree strongly (consistency {c_txt}).")
            else:
                evidence.append(
                    f"Resampled answers agree moderately (consistency {c_txt}); "
                    "confidence is reduced."
                )
            return build(Verdict.TRUSTWORTHY, (e_score + c) / 2.0, evidence)
        evidence.append(
            f"Resampled answers disagree (consistency {c_txt}), which conflicts "
            "with the supporting fact."
        )
        return build(Verdict.UNCERTAIN, 0.5, evidence)

    # ---- Unrelated --------------------------------------------------------
    evidence = [
        "The reference facts do not address the claim (NLI judged them unrelated), "
        "so the claim could not be verified."
    ]
    if c is None:
        evidence.append(c_missing)
        return build(Verdict.UNCERTAIN, 0.5, evidence)
    if c < t.low_consistency:
        evidence.append(f"Resampled answers disagree (consistency {c_txt}).")
        return build(
            Verdict.NEEDS_CORRECTION, min(1.0 - c, t.single_signal_cap), evidence
        )
    if c >= t.high_consistency:
        evidence.append(
            f"Resampled answers agree strongly (consistency {c_txt}), but high "
            "consistency is not proof of correctness."
        )
    else:
        evidence.append(f"Resampled answers agree moderately (consistency {c_txt}).")
    return build(Verdict.UNCERTAIN, 0.5, evidence)
