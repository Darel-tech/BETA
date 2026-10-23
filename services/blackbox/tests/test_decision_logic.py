"""Tests for the decision rules."""

import itertools
import math
from types import SimpleNamespace

import pytest

from ..decision_logic import Decision, DecisionThresholds, Verdict, decide
from ..entailment_check import EntailmentLabel, EntailmentResult, FactResult
from ..errors import ConfigurationError, InputValidationError


def make_entailment(label, score, *, conflict=False, n_facts=1):
    fact_results = tuple(
        FactResult(
            fact=f"fact {i}",
            label=label,
            score=score,
            contradiction=score if label is EntailmentLabel.CONTRADICTED else 0.0,
            entailment=score if label is EntailmentLabel.SUPPORTED else 0.0,
            neutral=score if label is EntailmentLabel.UNRELATED else 0.0,
        )
        for i in range(n_facts)
    )
    return EntailmentResult(
        claim="claim",
        label=label,
        score=score,
        fact_results=fact_results,
        has_conflict=conflict,
        model_name="test",
    )


SUPPORTED = EntailmentLabel.SUPPORTED
CONTRADICTED = EntailmentLabel.CONTRADICTED
UNRELATED = EntailmentLabel.UNRELATED


def joined(decision):
    return " ".join(decision.evidence).lower()


# ------------------------------------------------------------- contradiction


def test_strong_contradiction_overrides_high_consistency():
    d = decide(0.97, make_entailment(CONTRADICTED, 0.95))
    assert d.verdict is Verdict.NEEDS_CORRECTION
    assert d.confidence == pytest.approx(0.95)
    text = joined(d)
    assert "contradicts" in text
    assert "does not override" in text


def test_strong_contradiction_with_low_consistency_still_needs_correction():
    d = decide(0.1, make_entailment(CONTRADICTED, 0.9))
    assert d.verdict is Verdict.NEEDS_CORRECTION


def test_strong_contradiction_without_consistency_mentions_missing_signal():
    d = decide(None, make_entailment(CONTRADICTED, 0.9))
    assert d.verdict is Verdict.NEEDS_CORRECTION
    assert "not computed" in joined(d)


def test_weak_contradiction_is_uncertain():
    d = decide(0.95, make_entailment(CONTRADICTED, 0.6))
    assert d.verdict is Verdict.UNCERTAIN
    assert "weaker" in joined(d)


def test_contradiction_with_supporting_fact_is_reported_as_conflict():
    d = decide(0.9, make_entailment(CONTRADICTED, 0.92, conflict=True, n_facts=2))
    assert d.verdict is Verdict.NEEDS_CORRECTION
    assert "another reference fact supports" in joined(d)
    assert d.signals["has_conflict"] is True
    assert d.signals["reference_facts_checked"] == 2


# ----------------------------------------------------------------- supported


def test_supported_with_high_consistency_is_trustworthy():
    d = decide(0.9, make_entailment(SUPPORTED, 0.9))
    assert d.verdict is Verdict.TRUSTWORTHY
    assert d.confidence == pytest.approx(0.9)
    assert "support" in joined(d)


def test_supported_with_moderate_consistency_is_trustworthy_with_lower_confidence():
    high = decide(0.95, make_entailment(SUPPORTED, 0.9))
    moderate = decide(0.6, make_entailment(SUPPORTED, 0.9))
    assert moderate.verdict is Verdict.TRUSTWORTHY
    assert moderate.confidence < high.confidence
    assert "moderately" in joined(moderate)


def test_supported_with_low_consistency_is_uncertain():
    d = decide(0.2, make_entailment(SUPPORTED, 0.95))
    assert d.verdict is Verdict.UNCERTAIN
    assert "conflicts" in joined(d)


def test_weak_support_is_uncertain_even_with_high_consistency():
    d = decide(0.95, make_entailment(SUPPORTED, 0.4))
    assert d.verdict is Verdict.UNCERTAIN
    assert "weaker" in joined(d)


def test_supported_without_consistency_is_capped():
    d = decide(None, make_entailment(SUPPORTED, 0.99))
    assert d.verdict is Verdict.TRUSTWORTHY
    assert d.confidence == pytest.approx(DecisionThresholds().single_signal_cap)
    assert "not computed" in joined(d)


# ----------------------------------------------------------------- unrelated


def test_unrelated_facts_with_high_consistency_are_not_trustworthy():
    d = decide(0.98, make_entailment(UNRELATED, 0.9))
    assert d.verdict is Verdict.UNCERTAIN
    assert "not proof" in joined(d)


def test_unrelated_facts_with_low_consistency_need_correction_with_capped_confidence():
    d = decide(0.1, make_entailment(UNRELATED, 0.9))
    assert d.verdict is Verdict.NEEDS_CORRECTION
    assert d.confidence <= DecisionThresholds().single_signal_cap


def test_unrelated_facts_with_moderate_consistency_are_uncertain():
    assert decide(0.65, make_entailment(UNRELATED, 0.9)).verdict is Verdict.UNCERTAIN


def test_unrelated_facts_without_consistency_are_uncertain():
    d = decide(None, make_entailment(UNRELATED, 0.9))
    assert d.verdict is Verdict.UNCERTAIN


# --------------------------------------------------------- no reference facts


def test_no_facts_high_consistency_is_cautious_trustworthy():
    d = decide(0.95, None)
    assert d.verdict is Verdict.TRUSTWORTHY
    assert d.confidence <= DecisionThresholds().single_signal_cap
    text = joined(d)
    assert "unavailable" in text
    assert "consistently wrong" in text
    assert d.signals["fact_verification_available"] is False
    assert d.signals["entailment_label"] is None


def test_no_facts_low_consistency_needs_correction():
    d = decide(0.2, None)
    assert d.verdict is Verdict.NEEDS_CORRECTION
    assert d.confidence == pytest.approx(0.75)  # min(1 - 0.2, cap)
    assert "unavailable" in joined(d)


def test_no_facts_moderate_consistency_is_uncertain():
    d = decide(0.65, None)
    assert d.verdict is Verdict.UNCERTAIN
    assert "unavailable" in joined(d)


# ------------------------------------------------------------ invalid inputs


def test_both_signals_missing_is_an_error():
    with pytest.raises(InputValidationError):
        decide(None, None)


@pytest.mark.parametrize("bad", [1.5, -0.1, float("nan"), float("inf"), "0.5", True, [0.5]])
def test_invalid_consistency_scores(bad):
    with pytest.raises(InputValidationError):
        decide(bad, None)


def test_unexpected_entailment_label_is_rejected():
    bogus = SimpleNamespace(label="maybe", score=0.5, has_conflict=False, fact_results=())
    with pytest.raises(InputValidationError, match="label"):
        decide(0.5, bogus)


@pytest.mark.parametrize("bad", [None, -0.2, 1.2, float("nan"), "high"])
def test_invalid_entailment_score(bad):
    bogus = SimpleNamespace(label="supported", score=bad, has_conflict=False, fact_results=())
    with pytest.raises(InputValidationError):
        decide(0.5, bogus)


def test_string_label_values_are_accepted():
    ok = SimpleNamespace(label="supported", score=0.9, has_conflict=False, fact_results=())
    assert decide(0.9, ok).verdict is Verdict.TRUSTWORTHY


# ------------------------------------------------------------ output contract


def test_confidence_is_bounded_and_verdict_is_valid_across_a_grid():
    grid = [0.0, 0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 1.0, None]
    entailments = [None] + [
        make_entailment(label, s)
        for label in (SUPPORTED, CONTRADICTED, UNRELATED)
        for s in (0.0, 0.5, 0.6, 0.8, 1.0)
    ]
    count = 0
    for c, e in itertools.product(grid, entailments):
        if c is None and e is None:
            continue
        d = decide(c, e)
        assert isinstance(d, Decision)
        assert 0.0 <= d.confidence <= 1.0
        assert d.verdict in set(Verdict)
        assert d.evidence and all(isinstance(line, str) and line for line in d.evidence)
        count += 1
    assert count > 100


def test_verdict_values_are_exactly_the_documented_set():
    assert {v.value for v in Verdict} == {"trustworthy", "uncertain", "needs_correction"}


def test_signals_expose_underlying_values_and_flag_uncalibrated_confidence():
    d = decide(0.85, make_entailment(SUPPORTED, 0.9))
    assert d.signals["consistency_score"] == pytest.approx(0.85)
    assert d.signals["entailment_label"] == "supported"
    assert d.signals["entailment_score"] == pytest.approx(0.9)
    assert d.signals["fact_verification_available"] is True
    assert d.signals["confidence_is_calibrated"] is False


# ------------------------------------------------------------------ thresholds


def test_custom_thresholds_change_the_verdict():
    entailment = make_entailment(CONTRADICTED, 0.7)
    assert decide(0.9, entailment).verdict is Verdict.UNCERTAIN
    strict = DecisionThresholds(strong_contradiction=0.6)
    assert decide(0.9, entailment, strict).verdict is Verdict.NEEDS_CORRECTION


def test_custom_consistency_thresholds_apply_to_fallback():
    assert decide(0.7, None).verdict is Verdict.UNCERTAIN
    lenient = DecisionThresholds(high_consistency=0.6, low_consistency=0.3)
    assert decide(0.7, None, lenient).verdict is Verdict.TRUSTWORTHY


@pytest.mark.parametrize(
    "kwargs",
    [
        {"high_consistency": 1.2},
        {"low_consistency": -0.1},
        {"min_support": float("nan")},
        {"single_signal_cap": "x"},
        {"low_consistency": 0.9, "high_consistency": 0.5},
    ],
)
def test_invalid_thresholds_are_rejected(kwargs):
    with pytest.raises(InputValidationError):
        DecisionThresholds(**kwargs)


def test_thresholds_from_env(monkeypatch):
    monkeypatch.setenv("BLACKBOX_T_HIGH_CONSISTENCY", "0.9")
    monkeypatch.setenv("BLACKBOX_T_LOW_CONSISTENCY", "0.4")
    t = DecisionThresholds.from_env()
    assert t.high_consistency == pytest.approx(0.9)
    assert t.low_consistency == pytest.approx(0.4)
    assert t.min_support == DecisionThresholds().min_support


def test_thresholds_from_env_rejects_bad_values(monkeypatch):
    monkeypatch.setenv("BLACKBOX_T_MIN_SUPPORT", "lots")
    with pytest.raises(ConfigurationError):
        DecisionThresholds.from_env()
    monkeypatch.setenv("BLACKBOX_T_MIN_SUPPORT", "0.6")
    monkeypatch.setenv("BLACKBOX_T_LOW_CONSISTENCY", "0.95")
    with pytest.raises(ConfigurationError):
        DecisionThresholds.from_env()
