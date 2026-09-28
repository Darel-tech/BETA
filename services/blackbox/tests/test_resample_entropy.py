"""
Tests for resample_entropy.py — the consistency-checking component.

All tests are deterministic and isolated:
  - No real OpenAI / Anthropic API calls.
  - No real API keys required.
  - ModelCaller is mocked with predetermined answers.
  - Sentence-transformer embeddings are mocked where needed for speed;
    used directly where semantic comparison is under test.
"""

import sys
import os
from dataclasses import FrozenInstanceError
from typing import List
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# Ensure the blackbox package root is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from resample_entropy import (
    ConsistencyResult,
    ModelCaller,
    OpenAICaller,
    AnthropicCaller,
    compute_consistency_score,
    consistency_score,
    get_model_caller,
    _sample_answers,
)


# ==============================================================================
# Helpers — Mock ModelCaller
# ==============================================================================

class MockCaller:
    """
    A deterministic ModelCaller that returns answers from a pre-set list.

    Satisfies the ModelCaller protocol without making any API calls.
    """

    def __init__(self, answers: List[str]) -> None:
        self._answers = list(answers)
        self._call_index = 0
        self.call_log: List[tuple[str, float]] = []

    def generate(self, question: str, temperature: float) -> str:
        self.call_log.append((question, temperature))
        answer = self._answers[self._call_index % len(self._answers)]
        self._call_index += 1
        return answer


class FailingCaller:
    """A ModelCaller that always raises on generate()."""

    def generate(self, question: str, temperature: float) -> str:
        raise RuntimeError("Simulated API failure")


# ==============================================================================
# Tests — ConsistencyResult structure
# ==============================================================================

class TestConsistencyResult:
    """Verify the ConsistencyResult dataclass shape and immutability."""

    def test_fields_present(self):
        result = ConsistencyResult(
            question="What is 2+2?",
            sampled_answers=["4", "four"],
            consistency_score=0.95,
            num_samples=2,
        )
        assert result.question == "What is 2+2?"
        assert result.sampled_answers == ["4", "four"]
        assert result.consistency_score == 0.95
        assert result.num_samples == 2

    def test_frozen_immutability(self):
        result = ConsistencyResult(
            question="q",
            sampled_answers=["a"],
            consistency_score=1.0,
            num_samples=1,
        )
        with pytest.raises(FrozenInstanceError):
            result.consistency_score = 0.5  # type: ignore[misc]


# ==============================================================================
# Tests — get_model_caller factory
# ==============================================================================

class TestGetModelCaller:
    """Verify the factory dispatches to the right caller or raises."""

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key-123"})
    def test_chatgpt_returns_openai_caller(self):
        caller = get_model_caller("chatgpt")
        assert isinstance(caller, OpenAICaller)

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key-456"})
    def test_claude_returns_anthropic_caller(self):
        caller = get_model_caller("claude")
        assert isinstance(caller, AnthropicCaller)

    def test_unsupported_source_raises_value_error(self):
        with pytest.raises(ValueError, match="Unsupported source"):
            get_model_caller("gemini")

    def test_unsupported_source_empty_string(self):
        with pytest.raises(ValueError, match="Unsupported source"):
            get_model_caller("")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    def test_case_insensitive_chatgpt(self):
        caller = get_model_caller("ChatGPT")
        assert isinstance(caller, OpenAICaller)

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"})
    def test_case_insensitive_claude(self):
        caller = get_model_caller("CLAUDE")
        assert isinstance(caller, AnthropicCaller)


# ==============================================================================
# Tests — OpenAICaller / AnthropicCaller env-key validation
# ==============================================================================

class TestCallerEnvValidation:
    """API callers must raise EnvironmentError when the key is missing."""

    @patch.dict(os.environ, {}, clear=True)
    def test_openai_caller_missing_key(self):
        # Ensure OPENAI_API_KEY is not set
        os.environ.pop("OPENAI_API_KEY", None)
        with pytest.raises(EnvironmentError, match="OPENAI_API_KEY"):
            OpenAICaller()

    @patch.dict(os.environ, {}, clear=True)
    def test_anthropic_caller_missing_key(self):
        os.environ.pop("ANTHROPIC_API_KEY", None)
        with pytest.raises(EnvironmentError, match="ANTHROPIC_API_KEY"):
            AnthropicCaller()


# ==============================================================================
# Tests — MockCaller satisfies ModelCaller protocol
# ==============================================================================

class TestMockCallerProtocol:
    """Confirm our MockCaller satisfies the runtime-checkable Protocol."""

    def test_mock_is_model_caller(self):
        caller = MockCaller(["hello"])
        assert isinstance(caller, ModelCaller)

    def test_mock_returns_predetermined_answers(self):
        caller = MockCaller(["A", "B", "C"])
        assert caller.generate("q", 0.5) == "A"
        assert caller.generate("q", 0.6) == "B"
        assert caller.generate("q", 0.7) == "C"

    def test_mock_cycles_answers(self):
        caller = MockCaller(["X", "Y"])
        results = [caller.generate("q", 0.5) for _ in range(4)]
        assert results == ["X", "Y", "X", "Y"]


# ==============================================================================
# Tests — _sample_answers
# ==============================================================================

class TestSampleAnswers:
    """Test the internal _sample_answers function."""

    def test_returns_correct_number_of_answers(self):
        caller = MockCaller(["answer"] * 10)
        answers = _sample_answers(caller, "question?", n=5)
        assert len(answers) == 5

    def test_single_sample(self):
        caller = MockCaller(["only one"])
        answers = _sample_answers(caller, "q?", n=1)
        assert answers == ["only one"]

    def test_invalid_n_zero_raises(self):
        caller = MockCaller(["a"])
        with pytest.raises(ValueError, match="must be >= 1"):
            _sample_answers(caller, "q?", n=0)

    def test_invalid_n_negative_raises(self):
        caller = MockCaller(["a"])
        with pytest.raises(ValueError, match="must be >= 1"):
            _sample_answers(caller, "q?", n=-3)

    def test_caller_receives_question(self):
        caller = MockCaller(["a", "b", "c"])
        _sample_answers(caller, "What is AI?", n=3)
        for question, _ in caller.call_log:
            assert question == "What is AI?"

    def test_temperatures_vary_across_samples(self):
        caller = MockCaller(["a"] * 5)
        _sample_answers(caller, "q?", n=5)
        temps = [t for _, t in caller.call_log]
        # With n=5, temperatures should be spread, not all identical
        assert len(set(round(t, 6) for t in temps)) > 1

    def test_caller_failure_propagates(self):
        caller = FailingCaller()
        with pytest.raises(RuntimeError, match="Simulated API failure"):
            _sample_answers(caller, "q?", n=3)


# ==============================================================================
# Tests — compute_consistency_score
# ==============================================================================

class TestComputeConsistencyScore:
    """
    Test the pure scoring function.

    These tests mock _load_embedding_model to inject a deterministic
    fake sentence-transformer, making tests fast and reproducible.
    """

    def _make_mock_model(self, embeddings: np.ndarray) -> MagicMock:
        """Create a mock SentenceTransformer that returns fixed embeddings."""
        mock_model = MagicMock()
        # Normalise the provided embeddings so dot product = cosine sim
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)  # avoid division by zero
        normalised = embeddings / norms
        mock_model.encode.return_value = normalised
        return mock_model

    def test_identical_embeddings_score_1(self):
        """Identical vectors → cosine similarity = 1.0."""
        vec = np.array([[1.0, 0.0, 0.0]])
        embeddings = np.repeat(vec, 3, axis=0)
        mock_model = self._make_mock_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            score = compute_consistency_score(["a", "a", "a"])

        assert score == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_embeddings_score_0(self):
        """Orthogonal vectors → cosine similarity = 0.0."""
        embeddings = np.eye(3, dtype=np.float32)  # three orthogonal vectors
        mock_model = self._make_mock_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            score = compute_consistency_score(["a", "b", "c"])

        assert score == pytest.approx(0.0, abs=1e-6)

    def test_similar_higher_than_dissimilar(self):
        """
        Vectors that are close together should produce a higher score
        than vectors that are far apart.
        """
        # "similar" pair: two vectors pointing nearly the same direction
        similar_embeddings = np.array([
            [1.0, 0.0, 0.0],
            [0.95, 0.05, 0.0],
        ], dtype=np.float32)
        mock_similar = self._make_mock_model(similar_embeddings)

        # "dissimilar" pair: two vectors pointing in very different directions
        dissimilar_embeddings = np.array([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ], dtype=np.float32)
        mock_dissimilar = self._make_mock_model(dissimilar_embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_similar):
            score_similar = compute_consistency_score(["a", "b"])

        with patch("resample_entropy._load_embedding_model", return_value=mock_dissimilar):
            score_dissimilar = compute_consistency_score(["a", "b"])

        assert score_similar > score_dissimilar

    def test_single_answer_returns_1(self):
        """With fewer than 2 answers, disagreement is undefined → 1.0."""
        score = compute_consistency_score(["only one answer"])
        assert score == 1.0

    def test_empty_list_returns_1(self):
        """Empty answer list → trivially 1.0."""
        score = compute_consistency_score([])
        assert score == 1.0

    def test_score_in_valid_range(self):
        """Score must always be clamped to [0.0, 1.0]."""
        # Random embeddings — score should still be in range
        rng = np.random.default_rng(42)
        embeddings = rng.standard_normal((5, 64)).astype(np.float32)
        mock_model = self._make_mock_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            score = compute_consistency_score(["a", "b", "c", "d", "e"])

        assert 0.0 <= score <= 1.0


# ==============================================================================
# Tests — consistency_score (end-to-end orchestration with mocks)
# ==============================================================================

class TestConsistencyScoreEndToEnd:
    """
    Test the public consistency_score() function with a mock caller and
    mock embeddings. Verifies orchestration without any real API or model.
    """

    def _mock_embedding_model(self, embeddings: np.ndarray) -> MagicMock:
        mock_model = MagicMock()
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        mock_model.encode.return_value = embeddings / norms
        return mock_model

    def test_returns_consistency_result(self):
        """consistency_score must return a ConsistencyResult."""
        caller = MockCaller(["Paris is the capital of France."] * 3)
        embeddings = np.array([[1, 0, 0]] * 3, dtype=np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("What is the capital?", "chatgpt", n=3, caller=caller)

        assert isinstance(result, ConsistencyResult)

    def test_result_contains_all_sampled_answers(self):
        """All n answers should appear in result.sampled_answers."""
        answers = ["A1", "A2", "A3"]
        caller = MockCaller(answers)
        embeddings = np.array([[1, 0, 0]] * 3, dtype=np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("q?", "chatgpt", n=3, caller=caller)

        assert result.sampled_answers == answers
        assert result.num_samples == 3

    def test_result_preserves_question(self):
        caller = MockCaller(["ans"])
        embeddings = np.array([[1, 0, 0]], dtype=np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("My question?", "chatgpt", n=1, caller=caller)

        assert result.question == "My question?"

    def test_identical_answers_high_score(self):
        """Identical answers → score should be 1.0."""
        caller = MockCaller(["same answer"] * 5)
        # All embeddings identical → sim = 1.0
        embeddings = np.tile([1.0, 0.0, 0.0], (5, 1)).astype(np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("q?", "chatgpt", n=5, caller=caller)

        assert result.consistency_score == pytest.approx(1.0, abs=1e-6)

    def test_divergent_answers_lower_score(self):
        """Orthogonal embeddings → score near 0."""
        caller = MockCaller(["a", "b", "c"])
        embeddings = np.eye(3, dtype=np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("q?", "chatgpt", n=3, caller=caller)

        assert result.consistency_score < 0.1

    def test_similar_beats_divergent(self):
        """Consistent answers must score higher than inconsistent ones."""
        # Consistent: all same vector
        consistent_caller = MockCaller(["a"] * 3)
        consistent_emb = np.tile([1.0, 0.0], (3, 1)).astype(np.float32)
        mock_consistent = self._mock_embedding_model(consistent_emb)

        # Divergent: orthogonal-ish vectors
        divergent_caller = MockCaller(["x", "y", "z"])
        divergent_emb = np.array([
            [1.0, 0.0],
            [0.0, 1.0],
            [-1.0, 0.0],
        ], dtype=np.float32)
        mock_divergent = self._mock_embedding_model(divergent_emb)

        with patch("resample_entropy._load_embedding_model", return_value=mock_consistent):
            result_consistent = consistency_score("q?", "chatgpt", n=3, caller=consistent_caller)

        with patch("resample_entropy._load_embedding_model", return_value=mock_divergent):
            result_divergent = consistency_score("q?", "chatgpt", n=3, caller=divergent_caller)

        assert result_consistent.consistency_score > result_divergent.consistency_score

    def test_caller_kwarg_bypasses_factory(self):
        """When caller= is provided, get_model_caller should not be called."""
        caller = MockCaller(["ans"] * 2)
        embeddings = np.array([[1, 0]] * 2, dtype=np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            # model="invalid" would raise ValueError in get_model_caller,
            # but caller= bypasses it entirely.
            result = consistency_score("q?", "invalid_model", n=2, caller=caller)

        assert isinstance(result, ConsistencyResult)
        assert result.num_samples == 2

    def test_no_caller_unsupported_model_raises(self):
        """Without caller=, unsupported model must raise ValueError."""
        with pytest.raises(ValueError, match="Unsupported source"):
            consistency_score("q?", "gemini", n=2)

    def test_score_in_valid_range(self):
        """Score must be in [0.0, 1.0] regardless of embedding geometry."""
        caller = MockCaller(["a", "b", "c", "d"])
        rng = np.random.default_rng(99)
        embeddings = rng.standard_normal((4, 32)).astype(np.float32)
        mock_model = self._mock_embedding_model(embeddings)

        with patch("resample_entropy._load_embedding_model", return_value=mock_model):
            result = consistency_score("q?", "chatgpt", n=4, caller=caller)

        assert 0.0 <= result.consistency_score <= 1.0
