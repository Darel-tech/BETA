"""Detection pipeline: orchestrates consistency, entailment and decision.

This small supporting module exists so that ``app.py`` stays a thin HTTP layer
and so the whole pipeline can be unit-tested (and its dependencies injected)
without FastAPI.

Data flow
---------
``detect()`` ->
  1. validates ``source`` and maps it to a provider (``chatgpt`` -> ``openai``,
     ``claude`` -> ``anthropic``);
  2. if a ``question`` is given, resamples answers from that same provider and
     scores their consistency; if not, consistency is **skipped** (documented
     fallback: resampling a synthetic prompt would measure something other than
     the original question);
  3. if reference facts are given, runs NLI entailment of ``text`` against
     them; if not, entailment is skipped;
  4. calls :func:`decision_logic.decide`.

At least one of ``question`` / ``reference_facts`` is required. Any failure in
a model or provider call is raised, never converted into a verdict.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence

from .decision_logic import Decision, DecisionThresholds, decide
from .entailment_check import (
    MAX_TEXT_CHARS,
    EntailmentResult,
    check_entailment,
    normalize_facts,
)
from .errors import InputValidationError
from .resample_entropy import ConsistencyResult, measure_consistency

SOURCE_TO_PROVIDER: Dict[str, str] = {"chatgpt": "openai", "claude": "anthropic"}

#: ``(question, provider) -> ConsistencyResult``
ConsistencyFn = Callable[[str, str], ConsistencyResult]
#: ``(claim, facts) -> EntailmentResult``
EntailmentFn = Callable[[str, List[str]], EntailmentResult]


def _default_consistency(question: str, provider: str) -> ConsistencyResult:
    return measure_consistency(question, provider=provider)


def _default_entailment(claim: str, facts: List[str]) -> EntailmentResult:
    return check_entailment(claim, facts)


@dataclass(frozen=True)
class DetectionOutcome:
    """Everything produced by one detection run."""

    decision: Decision
    consistency: Optional[ConsistencyResult]
    entailment: Optional[EntailmentResult]
    evidence: List[str]
    signals: Dict[str, Any]


class Detector:
    """Black-box hallucination detector pipeline.

    Args:
        consistency_fn: Replaces the real resampling step (for tests or custom
            backends).
        entailment_fn: Replaces the real NLI step.
        thresholds: Decision thresholds; defaults to
            :meth:`DecisionThresholds.from_env`.
    """

    def __init__(
        self,
        *,
        consistency_fn: Optional[ConsistencyFn] = None,
        entailment_fn: Optional[EntailmentFn] = None,
        thresholds: Optional[DecisionThresholds] = None,
    ) -> None:
        self._consistency_fn = consistency_fn or _default_consistency
        self._entailment_fn = entailment_fn or _default_entailment
        self._thresholds = thresholds or DecisionThresholds.from_env()

    def detect(
        self,
        *,
        text: str,
        source: str,
        question: Optional[str] = None,
        reference_facts: Optional[Sequence[str]] = None,
        entities: Optional[Sequence[str]] = None,
    ) -> DetectionOutcome:
        """Evaluate ``text`` and return a decision with its supporting signals.

        ``entities`` is accepted for API-contract compatibility and echoed in
        ``signals``; it does not influence the verdict.

        Raises:
            InputValidationError: Invalid input, or neither a question nor
                reference facts were supplied.
            ConfigurationError / ProviderError / ModelError: Propagated from the
                underlying steps; no verdict is fabricated on failure.
        """
        if not isinstance(text, str) or not text.strip():
            raise InputValidationError("text must be a non-blank string")
        if len(text) > MAX_TEXT_CHARS:
            raise InputValidationError(f"text must be at most {MAX_TEXT_CHARS} characters")
        if not isinstance(source, str) or source not in SOURCE_TO_PROVIDER:
            raise InputValidationError(
                f"source must be one of {sorted(SOURCE_TO_PROVIDER)}"
            )
        provider = SOURCE_TO_PROVIDER[source]

        question_clean: Optional[str] = None
        if question is not None:
            if not isinstance(question, str):
                raise InputValidationError("question must be a string")
            question_clean = question.strip() or None

        facts = normalize_facts(list(reference_facts) if reference_facts is not None else None)

        if question_clean is None and not facts:
            raise InputValidationError(
                "Provide 'question' (for response consistency) and/or "
                "'reference_facts' (for fact verification)."
            )

        consistency: Optional[ConsistencyResult] = None
        if question_clean is not None:
            consistency = self._consistency_fn(question_clean, provider)

        entailment: Optional[EntailmentResult] = None
        if facts:
            entailment = self._entailment_fn(text.strip(), facts)

        decision = decide(
            consistency.consistency_score if consistency is not None else None,
            entailment,
            self._thresholds,
        )

        evidence = list(decision.evidence)
        if consistency is not None:
            evidence.append(
                f"Consistency is a semantic similarity proxy over "
                f"{consistency.sample_count} sampled {provider} responses, "
                "not calibrated semantic entropy."
            )
        else:
            evidence.append(
                "No question was supplied, so response resampling was skipped."
            )
        evidence.append(
            "NLI results and the confidence value are heuristic signals, "
            "not proof of factual truth or calibrated probabilities."
        )

        signals: Dict[str, Any] = dict(decision.signals)
        signals["provider"] = provider
        signals["sample_count"] = consistency.sample_count if consistency else 0
        signals["entities"] = list(entities) if entities else []
        signals["fact_results"] = (
            [
                {
                    "fact": r.fact,
                    "label": r.label.value,
                    "score": r.score,
                }
                for r in entailment.fact_results
            ]
            if entailment is not None
            else []
        )

        return DetectionOutcome(
            decision=decision,
            consistency=consistency,
            entailment=entailment,
            evidence=evidence,
            signals=signals,
        )
