"""Tests for the response-consistency module. No network, keys or downloads."""

import math
import sys
import types

import numpy as np
import pytest

from .. import resample_entropy as re_mod
from ..errors import ConfigurationError, InputValidationError, ModelError, ProviderError
from ..resample_entropy import (
    ConsistencyResult,
    compute_consistency,
    make_provider_caller,
    measure_consistency,
    sample_answers,
)


class FakeEmbedder:
    """Maps each text to a preset vector (default: a vector keyed by text)."""

    def __init__(self, table=None, default=None):
        self.table = table or {}
        self.default = default
        self.calls = []

    def encode(self, sentences):
        self.calls.append(list(sentences))
        return np.array([self.table.get(s, self.default) for s in sentences], dtype=float)


class RecordingCaller:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def __call__(self, question, n, temperature):
        self.calls.append((question, n, temperature))
        return self.answers


# ---------------------------------------------------------------- scoring


def test_identical_embeddings_give_score_one():
    emb = FakeEmbedder(default=[1.0, 2.0, 3.0])
    assert compute_consistency(["a", "b", "c"], emb) == pytest.approx(1.0)


def test_orthogonal_embeddings_give_score_zero():
    emb = FakeEmbedder({"a": [1, 0], "b": [0, 1]})
    assert compute_consistency(["a", "b"], emb) == pytest.approx(0.0)


def test_negative_similarity_is_clipped_to_zero():
    emb = FakeEmbedder({"a": [1, 0], "b": [-1, 0]})
    assert compute_consistency(["a", "b"], emb) == 0.0


def test_three_answers_use_mean_of_pairwise_similarities():
    # pair sims: (a,b)=1, (a,c)=0, (b,c)=0 -> mean 1/3
    emb = FakeEmbedder({"a": [1, 0], "b": [1, 0], "c": [0, 1]})
    assert compute_consistency(["a", "b", "c"], emb) == pytest.approx(1 / 3)


def test_score_is_scale_invariant_and_bounded():
    emb = FakeEmbedder({"a": [10, 0], "b": [0.5, 0.5], "c": [3, 1]})
    score = compute_consistency(["a", "b", "c"], emb)
    assert 0.0 <= score <= 1.0


def test_answers_are_stripped_before_embedding():
    emb = FakeEmbedder(default=[1.0, 0.0])
    compute_consistency(["  a ", "b\n"], emb)
    assert emb.calls[0] == ["a", "b"]


@pytest.mark.parametrize(
    "bad",
    [[], ["only one"], "not a list", None, ["a", ""], ["a", "   "], ["a", 5], ["a", None]],
)
def test_compute_consistency_rejects_invalid_answers(bad):
    with pytest.raises(InputValidationError):
        compute_consistency(bad, FakeEmbedder(default=[1.0, 0.0]))


def test_embedder_failure_becomes_model_error():
    class Boom:
        def encode(self, sentences):
            raise RuntimeError("weights corrupted")

    with pytest.raises(ModelError) as info:
        compute_consistency(["a", "b"], Boom())
    assert "RuntimeError" in str(info.value)


@pytest.mark.parametrize(
    "vectors",
    [
        [[1.0, 0.0]],  # wrong row count
        [1.0, 2.0],  # not 2-D
        [[float("nan"), 1.0], [1.0, 1.0]],
        [[0.0, 0.0], [1.0, 0.0]],  # zero vector
    ],
)
def test_malformed_embeddings_raise_model_error(vectors):
    class Fixed:
        def encode(self, sentences):
            return vectors

    with pytest.raises(ModelError):
        compute_consistency(["a", "b"], Fixed())


# -------------------------------------------------------------- generation


def test_sample_answers_passes_count_and_temperature_to_caller():
    caller = RecordingCaller(["x1", "x2", "x3"])
    answers = sample_answers("Q?", provider="openai", n=3, temperature=0.7, caller=caller)
    assert answers == ["x1", "x2", "x3"]
    assert caller.calls == [("Q?", 3, 0.7)]


def test_sample_answers_drops_blank_answers_and_truncates_to_n():
    caller = RecordingCaller(["a", "  ", "b", "c", "d"])
    assert sample_answers("Q?", provider="openai", n=3, caller=caller) == ["a", "b", "c"]


def test_too_few_usable_answers_is_provider_error():
    caller = RecordingCaller(["only", "", "  "])
    with pytest.raises(ProviderError):
        sample_answers("Q?", provider="openai", n=3, caller=caller)


def test_non_sequence_caller_result_is_provider_error():
    with pytest.raises(ProviderError):
        sample_answers("Q?", provider="openai", caller=lambda q, n, t: "just a string")


def test_unexpected_caller_exception_is_wrapped_without_message():
    def boom(q, n, t):
        raise RuntimeError("sk-leaky-secret")

    with pytest.raises(ProviderError) as info:
        sample_answers("Q?", provider="openai", caller=boom)
    assert "sk-leaky-secret" not in str(info.value)
    assert "RuntimeError" in str(info.value)


def test_blackbox_errors_from_caller_pass_through():
    def boom(q, n, t):
        raise ConfigurationError("OPENAI_API_KEY is not set")

    with pytest.raises(ConfigurationError):
        sample_answers("Q?", provider="openai", caller=boom)


@pytest.mark.parametrize("question", ["", "   ", None, 42])
def test_sample_answers_rejects_bad_question(question):
    with pytest.raises(InputValidationError):
        sample_answers(question, provider="openai", caller=RecordingCaller(["a", "b"]))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"provider": "gemini"},
        {"provider": "openai", "n": 1},
        {"provider": "openai", "n": 21},
        {"provider": "openai", "n": 3.5},
        {"provider": "openai", "n": True},
        {"provider": "openai", "temperature": -0.1},
        {"provider": "openai", "temperature": 2.5},
        {"provider": "openai", "temperature": float("nan")},
        {"provider": "openai", "temperature": "hot"},
        {"provider": "anthropic", "temperature": 1.5},  # Anthropic max is 1.0
        {"provider": "openai", "max_tokens": 0},
    ],
)
def test_sample_answers_rejects_invalid_arguments(kwargs):
    with pytest.raises(InputValidationError):
        sample_answers("Q?", caller=RecordingCaller(["a", "b"]), **kwargs)


def test_openai_allows_temperature_up_to_two():
    caller = RecordingCaller(["a", "b"])
    sample_answers("Q?", provider="openai", n=2, temperature=2.0, caller=caller)
    assert caller.calls[0][2] == 2.0


# ----------------------------------------------- real callers (fake SDKs)


def test_missing_openai_key_raises_configuration_error(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ConfigurationError) as info:
        sample_answers("Q?", provider="openai")
    assert "OPENAI_API_KEY" in str(info.value)


def test_missing_anthropic_key_raises_configuration_error(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ConfigurationError) as info:
        sample_answers("Q?", provider="anthropic")
    assert "ANTHROPIC_API_KEY" in str(info.value)


def test_blank_key_counts_as_missing(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "   ")
    with pytest.raises(ConfigurationError):
        sample_answers("Q?", provider="openai")


def _install_fake_openai(monkeypatch, *, fail=False):
    record = {}

    class Completions:
        def create(self, **kwargs):
            record["create"] = kwargs
            if fail:
                raise RuntimeError("401 invalid key sk-test-secret")
            msg = lambda text: types.SimpleNamespace(message=types.SimpleNamespace(content=text))
            return types.SimpleNamespace(choices=[msg("one"), msg("two"), msg(None)])

    class OpenAI:
        def __init__(self, api_key):
            record["api_key"] = api_key
            self.chat = types.SimpleNamespace(completions=Completions())

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=OpenAI))
    return record


def test_openai_caller_uses_sdk_with_expected_arguments(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    record = _install_fake_openai(monkeypatch)
    caller = make_provider_caller("openai", model="my-model", max_tokens=50)
    raw = caller("What is 2+2?", 3, 0.4)
    assert raw == ["one", "two", ""]
    assert record["api_key"] == "sk-test-secret"
    create = record["create"]
    assert create["model"] == "my-model"
    assert create["n"] == 3
    assert create["temperature"] == 0.4
    assert create["max_completion_tokens"] == 50
    assert create["messages"] == [{"role": "user", "content": "What is 2+2?"}]


def test_openai_provider_failure_is_sanitised(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    _install_fake_openai(monkeypatch, fail=True)
    with pytest.raises(ProviderError) as info:
        sample_answers("Q?", provider="openai", n=3)
    assert "sk-test-secret" not in str(info.value)
    assert "RuntimeError" in str(info.value)


def _install_fake_anthropic(monkeypatch, *, fail=False):
    record = {"calls": []}

    class Messages:
        def create(self, **kwargs):
            record["calls"].append(kwargs)
            if fail:
                raise RuntimeError("bad key sk-ant-secret")
            index = len(record["calls"])
            blocks = [
                types.SimpleNamespace(type="text", text=f"answer {index}"),
                types.SimpleNamespace(type="other"),
            ]
            return types.SimpleNamespace(content=blocks)

    class Anthropic:
        def __init__(self, api_key):
            record["api_key"] = api_key
            self.messages = Messages()

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Anthropic))
    return record


def test_anthropic_caller_makes_one_request_per_sample(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
    record = _install_fake_anthropic(monkeypatch)
    caller = make_provider_caller("anthropic", model="claude-test", max_tokens=77)
    raw = caller("Q?", 3, 0.9)
    assert raw == ["answer 1", "answer 2", "answer 3"]
    assert len(record["calls"]) == 3
    first = record["calls"][0]
    assert first["model"] == "claude-test"
    assert first["max_tokens"] == 77
    assert first["temperature"] == 0.9


def test_anthropic_provider_failure_is_sanitised(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
    _install_fake_anthropic(monkeypatch, fail=True)
    with pytest.raises(ProviderError) as info:
        sample_answers("Q?", provider="anthropic", n=2)
    assert "sk-ant-secret" not in str(info.value)


def test_model_name_resolution_prefers_argument_then_env_then_default(monkeypatch):
    monkeypatch.delenv("BLACKBOX_OPENAI_MODEL", raising=False)
    assert re_mod.resolve_model("openai") == re_mod.DEFAULT_OPENAI_MODEL
    monkeypatch.setenv("BLACKBOX_OPENAI_MODEL", "env-model")
    assert re_mod.resolve_model("openai") == "env-model"
    assert re_mod.resolve_model("openai", "arg-model") == "arg-model"


# ------------------------------------------------------- full measurement


def test_measure_consistency_end_to_end_with_mocks(monkeypatch):
    monkeypatch.delenv("BLACKBOX_SAMPLE_COUNT", raising=False)
    caller = RecordingCaller(["a", "b", "c"])
    emb = FakeEmbedder({"a": [1, 0], "b": [1, 0], "c": [0, 1]})
    result = measure_consistency(
        "  Why?  ", provider="anthropic", n=3, temperature=0.5, caller=caller, embedder=emb
    )
    assert isinstance(result, ConsistencyResult)
    assert result.question == "Why?"
    assert result.answers == ("a", "b", "c")
    assert result.sample_count == 3
    assert result.consistency_score == pytest.approx(1 / 3)
    assert result.provider == "anthropic"
    assert result.temperature == 0.5
    assert "NOT the Farquhar" in result.method
    assert caller.calls == [("Why?", 3, 0.5)]


def test_measure_consistency_defaults_come_from_environment(monkeypatch):
    monkeypatch.setenv("BLACKBOX_SAMPLE_COUNT", "4")
    monkeypatch.setenv("BLACKBOX_TEMPERATURE", "0.3")
    caller = RecordingCaller(["a", "b", "c", "d"])
    measure_consistency(
        "Q?", provider="openai", caller=caller, embedder=FakeEmbedder(default=[1.0, 1.0])
    )
    assert caller.calls == [("Q?", 4, 0.3)]


def test_invalid_environment_value_is_configuration_error(monkeypatch):
    monkeypatch.setenv("BLACKBOX_SAMPLE_COUNT", "many")
    with pytest.raises(ConfigurationError):
        measure_consistency(
            "Q?", provider="openai", caller=RecordingCaller(["a", "b"]),
            embedder=FakeEmbedder(default=[1.0]),
        )


def test_sampling_failure_happens_before_embedder_is_used():
    emb = FakeEmbedder(default=[1.0, 0.0])

    def boom(q, n, t):
        raise ProviderError("down")

    with pytest.raises(ProviderError):
        measure_consistency("Q?", provider="openai", n=2, caller=boom, embedder=emb)
    assert emb.calls == []


# ---------------------------------------------------------- lazy + caching


def test_default_embedder_is_loaded_lazily_and_cached(monkeypatch):
    re_mod.clear_embedder_cache()
    loads = []

    def fake_load(name):
        loads.append(name)
        return FakeEmbedder(default=[1.0, 0.0])

    monkeypatch.setattr(re_mod, "_load_embedder", fake_load)
    assert loads == []  # nothing loaded just by importing / patching
    first = re_mod.get_default_embedder("model-a")
    second = re_mod.get_default_embedder("model-a")
    assert first is second
    assert loads == ["model-a"]
    re_mod.get_default_embedder("model-b")
    assert loads == ["model-a", "model-b"]
    re_mod.clear_embedder_cache()


def test_compute_consistency_uses_cached_default_embedder(monkeypatch):
    re_mod.clear_embedder_cache()
    monkeypatch.delenv("BLACKBOX_EMBEDDING_MODEL", raising=False)
    loads = []

    def fake_load(name):
        loads.append(name)
        return FakeEmbedder(default=[1.0, 0.0])

    monkeypatch.setattr(re_mod, "_load_embedder", fake_load)
    assert compute_consistency(["a", "b"]) == pytest.approx(1.0)
    compute_consistency(["c", "d"])
    assert loads == [re_mod.DEFAULT_EMBEDDING_MODEL]
    re_mod.clear_embedder_cache()


def test_embedder_load_failure_is_model_error(monkeypatch):
    re_mod.clear_embedder_cache()
    monkeypatch.setitem(sys.modules, "sentence_transformers", None)  # forces ImportError
    with pytest.raises(ModelError):
        re_mod._load_embedder("whatever")
