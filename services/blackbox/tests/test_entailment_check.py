"""Tests for the entailment module using mock NLI scorers (no downloads)."""

import numpy as np
import pytest

from .. import entailment_check as ent
from ..entailment_check import (
    CrossEncoderNLIScorer,
    EntailmentLabel,
    check_entailment,
    normalize_facts,
)
from ..errors import (
    InputValidationError,
    ModelError,
    NoReferenceFactsError,
)

CLAIM = "Paris is the capital of France."

# Probability rows are (contradiction, entailment, neutral).
SUPPORT = (0.02, 0.95, 0.03)
CONTRA = (0.93, 0.03, 0.04)
NEUTRAL = (0.05, 0.05, 0.90)


class FakeScorer:
    model_name = "fake-nli"

    def __init__(self, table):
        self.table = table
        self.calls = []

    def score(self, pairs):
        self.calls.append(list(pairs))
        return [self.table[premise] for premise, _ in pairs]


def test_supported_claim():
    scorer = FakeScorer({"Paris is France's capital city.": SUPPORT})
    result = check_entailment(CLAIM, ["Paris is France's capital city."], scorer=scorer)
    assert result.label is EntailmentLabel.SUPPORTED
    assert result.score == pytest.approx(0.95)
    assert result.has_conflict is False
    assert result.model_name == "fake-nli"
    assert len(result.fact_results) == 1
    assert result.fact_results[0].label is EntailmentLabel.SUPPORTED


def test_fact_is_premise_and_claim_is_hypothesis():
    scorer = FakeScorer({"fact": SUPPORT})
    check_entailment("  claim  ", ["  fact  "], scorer=scorer)
    assert scorer.calls == [[("fact", "claim")]]


def test_contradicted_claim():
    scorer = FakeScorer({"Berlin is the capital of France.": CONTRA})
    result = check_entailment(CLAIM, ["Berlin is the capital of France."], scorer=scorer)
    assert result.label is EntailmentLabel.CONTRADICTED
    assert result.score == pytest.approx(0.93)


def test_unrelated_claim():
    scorer = FakeScorer({"The Nile is a river.": NEUTRAL})
    result = check_entailment(CLAIM, ["The Nile is a river."], scorer=scorer)
    assert result.label is EntailmentLabel.UNRELATED
    assert result.score == pytest.approx(0.90)


def test_contradiction_is_not_outvoted_by_supporting_facts():
    scorer = FakeScorer({"f1": SUPPORT, "f2": SUPPORT, "f3": CONTRA})
    result = check_entailment(CLAIM, ["f1", "f2", "f3"], scorer=scorer)
    assert result.label is EntailmentLabel.CONTRADICTED
    assert result.has_conflict is True
    assert result.score == pytest.approx(0.93)
    assert [r.label for r in result.fact_results] == [
        EntailmentLabel.SUPPORTED,
        EntailmentLabel.SUPPORTED,
        EntailmentLabel.CONTRADICTED,
    ]


def test_contradiction_without_support_has_no_conflict():
    scorer = FakeScorer({"f1": CONTRA, "f2": NEUTRAL})
    result = check_entailment(CLAIM, ["f1", "f2"], scorer=scorer)
    assert result.label is EntailmentLabel.CONTRADICTED
    assert result.has_conflict is False


def test_support_score_is_best_supporting_fact():
    scorer = FakeScorer({"f1": (0.1, 0.70, 0.2), "f2": (0.02, 0.90, 0.08), "f3": NEUTRAL})
    result = check_entailment(CLAIM, ["f1", "f2", "f3"], scorer=scorer)
    assert result.label is EntailmentLabel.SUPPORTED
    assert result.score == pytest.approx(0.90)


def test_unrelated_score_is_highest_neutral_probability():
    scorer = FakeScorer({"f1": (0.1, 0.1, 0.8), "f2": (0.05, 0.05, 0.9)})
    result = check_entailment(CLAIM, ["f1", "f2"], scorer=scorer)
    assert result.label is EntailmentLabel.UNRELATED
    assert result.score == pytest.approx(0.9)


def test_blank_facts_are_dropped_before_scoring():
    scorer = FakeScorer({"real": SUPPORT})
    result = check_entailment(CLAIM, ["", "  ", "real"], scorer=scorer)
    assert scorer.calls == [[("real", CLAIM)]]
    assert len(result.fact_results) == 1


@pytest.mark.parametrize("facts", [None, [], ["", "   "]])
def test_missing_or_empty_facts_raise_no_reference_facts(facts):
    scorer = FakeScorer({})
    with pytest.raises(NoReferenceFactsError):
        check_entailment(CLAIM, facts, scorer=scorer)
    assert scorer.calls == []


def test_no_reference_facts_is_an_input_validation_error():
    assert issubclass(NoReferenceFactsError, InputValidationError)


@pytest.mark.parametrize("claim", ["", "   ", None, 7, ["x"]])
def test_invalid_claim(claim):
    with pytest.raises(InputValidationError):
        check_entailment(claim, ["fact"], scorer=FakeScorer({"fact": SUPPORT}))


@pytest.mark.parametrize("facts", ["a string", 5, {"a": 1}, ["ok", 3], [None]])
def test_invalid_facts(facts):
    with pytest.raises(InputValidationError):
        check_entailment(CLAIM, facts, scorer=FakeScorer({"ok": SUPPORT}))


def test_too_many_facts():
    with pytest.raises(InputValidationError):
        normalize_facts(["f"] * (ent.MAX_FACTS + 1))


def test_overlong_claim_and_fact():
    with pytest.raises(InputValidationError):
        check_entailment("x" * (ent.MAX_TEXT_CHARS + 1), ["f"], scorer=FakeScorer({"f": SUPPORT}))
    with pytest.raises(InputValidationError):
        normalize_facts(["x" * (ent.MAX_TEXT_CHARS + 1)])


def test_scorer_exception_becomes_model_error():
    class Boom:
        def score(self, pairs):
            raise RuntimeError("cuda out of memory")

    with pytest.raises(ModelError) as info:
        check_entailment(CLAIM, ["fact"], scorer=Boom())
    assert "RuntimeError" in str(info.value)


def test_model_error_from_scorer_passes_through():
    class Boom:
        def score(self, pairs):
            raise ModelError("could not load")

    with pytest.raises(ModelError, match="could not load"):
        check_entailment(CLAIM, ["fact"], scorer=Boom())


@pytest.mark.parametrize(
    "bad_output",
    [
        [],  # wrong length
        [(0.1, 0.2)],  # row too short
        [(0.1, 0.2, 0.3, 0.4)],  # row too long
        [(float("nan"), 0.5, 0.5)],
        [(1.5, 0.0, 0.0)],
        [(-0.5, 0.5, 0.5)],
        [("a", "b", "c")],
        None,
        [5],
    ],
)
def test_malformed_scorer_output_is_model_error(bad_output):
    class Bad:
        def score(self, pairs):
            return bad_output

    with pytest.raises(ModelError):
        check_entailment(CLAIM, ["fact"], scorer=Bad())


def test_tie_resolves_to_contradiction_conservatively():
    scorer = FakeScorer({"f": (0.4, 0.4, 0.2)})
    assert check_entailment(CLAIM, ["f"], scorer=scorer).label is EntailmentLabel.CONTRADICTED


def test_default_scorer_is_used_when_none_injected(monkeypatch):
    fake = FakeScorer({"f": SUPPORT})
    requested = []

    def fake_get(name=None):
        requested.append(name)
        return fake

    monkeypatch.setattr(ent, "get_default_scorer", fake_get)
    result = check_entailment(CLAIM, ["f"], model_name="some-model")
    assert result.label is EntailmentLabel.SUPPORTED
    assert requested == ["some-model"]


# ------------------------------------------------ CrossEncoder wrapper logic


class FakeCrossEncoder:
    def __init__(self, output, id2label=None):
        self.output = output
        self.calls = []
        if id2label is not None:
            self.config = type("Cfg", (), {"id2label": id2label})()

    def predict(self, pairs, **kwargs):
        self.calls.append((pairs, kwargs))
        return np.asarray(self.output, dtype=float)


DEFAULT_ID2LABEL = {0: "contradiction", 1: "entailment", 2: "neutral"}


def test_wrapper_converts_logits_to_probabilities():
    model = FakeCrossEncoder([[-1.0, 4.0, 0.0]], DEFAULT_ID2LABEL)
    rows = CrossEncoderNLIScorer("x", model=model).score([("fact", "claim")])
    row = rows[0]
    assert sum(row) == pytest.approx(1.0)
    assert row[1] > 0.9  # entailment dominates
    assert model.calls[0][0] == [["fact", "claim"]]


def test_wrapper_keeps_values_that_are_already_probabilities():
    model = FakeCrossEncoder([[0.1, 0.8, 0.1]], DEFAULT_ID2LABEL)
    row = CrossEncoderNLIScorer("x", model=model).score([("f", "c")])[0]
    assert row == pytest.approx([0.1, 0.8, 0.1])


def test_wrapper_reorders_columns_using_model_id2label():
    # This model emits (entailment, neutral, contradiction).
    id2label = {0: "ENTAILMENT", 1: "NEUTRAL", 2: "CONTRADICTION"}
    model = FakeCrossEncoder([[0.7, 0.2, 0.1]], id2label)
    row = CrossEncoderNLIScorer("x", model=model).score([("f", "c")])[0]
    assert row == pytest.approx([0.1, 0.7, 0.2])  # contradiction, entailment, neutral


def test_wrapper_assumes_default_order_without_usable_config():
    model = FakeCrossEncoder([[0.7, 0.2, 0.1]], {0: "LABEL_0", 1: "LABEL_1", 2: "LABEL_2"})
    row = CrossEncoderNLIScorer("x", model=model).score([("f", "c")])[0]
    assert row == pytest.approx([0.7, 0.2, 0.1])


def test_wrapper_handles_single_row_output_shape():
    model = FakeCrossEncoder([0.1, 0.8, 0.1])  # 1-D, no config
    rows = CrossEncoderNLIScorer("x", model=model).score([("f", "c")])
    assert len(rows) == 1 and len(rows[0]) == 3


def test_wrapper_rejects_wrong_output_width():
    model = FakeCrossEncoder([[0.5, 0.5]])
    with pytest.raises(ModelError):
        CrossEncoderNLIScorer("x", model=model).score([("f", "c")])


def test_wrapper_inference_failure_is_model_error():
    class Boom:
        def predict(self, pairs, **kwargs):
            raise RuntimeError("boom")

    with pytest.raises(ModelError):
        CrossEncoderNLIScorer("x", model=Boom()).score([("f", "c")])


def test_wrapper_is_lazy_and_does_not_load_on_construction():
    scorer = CrossEncoderNLIScorer("never-downloaded-model")
    assert scorer._model is None


def test_wrapper_load_failure_is_model_error(monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "sentence_transformers", None)  # forces ImportError
    with pytest.raises(ModelError):
        CrossEncoderNLIScorer("x").score([("f", "c")])


def test_default_scorer_is_cached(monkeypatch):
    ent.clear_scorer_cache()
    created = []

    class Counting:
        def __init__(self, name):
            created.append(name)

    monkeypatch.setattr(ent, "CrossEncoderNLIScorer", Counting)
    monkeypatch.delenv("BLACKBOX_NLI_MODEL", raising=False)
    a = ent.get_default_scorer()
    b = ent.get_default_scorer()
    assert a is b
    assert created == [ent.DEFAULT_NLI_MODEL]
    ent.get_default_scorer("other")
    assert created == [ent.DEFAULT_NLI_MODEL, "other"]
    ent.clear_scorer_cache()


def test_label_permutation_helper():
    assert ent._label_permutation(DEFAULT_ID2LABEL) == [0, 1, 2]
    assert ent._label_permutation({0: "entailment", 1: "neutral", 2: "contradiction"}) == [2, 0, 1]
    assert ent._label_permutation(None) is None
    assert ent._label_permutation({0: "yes", 1: "no"}) is None
