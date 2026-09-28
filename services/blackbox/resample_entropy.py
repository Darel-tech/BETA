"""
Consistency checking via resampled model outputs (Technique 1).

Asks a closed-model the same question multiple times with slight temperature
variation, embeds the responses with a sentence-transformer, and measures
semantic disagreement. Low disagreement → high consistency score.

This module is responsible ONLY for:
  - Generating multiple answers from a closed model (ChatGPT / Claude).
  - Embedding those answers and computing a consistency score.

It does NOT:
  - Perform entailment / NLI checking (see entailment_check.py).
  - Decide a verdict (see decision_logic.py).

Architecture reference: ARCHITECTURE_esha_blackbox.md §Week 2.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from functools import lru_cache
from typing import List, Optional, Protocol, runtime_checkable

import numpy as np
from numpy.typing import NDArray
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


# ==============================================================================
# Structured Result
# ==============================================================================

@dataclass(frozen=True)
class ConsistencyResult:
    """
    Output of the consistency-checking pipeline.

    Attributes:
        question:          The original question sent to the model.
        sampled_answers:   The list of generated answer strings.
        consistency_score: Mean pairwise cosine similarity (0.0–1.0).
                           High → answers agree. Low → answers diverge.
        num_samples:       Number of samples that were generated.
    """
    question: str
    sampled_answers: List[str]
    consistency_score: float
    num_samples: int


# ==============================================================================
# Model Caller Abstraction
# ==============================================================================

@runtime_checkable
class ModelCaller(Protocol):
    """
    Protocol for calling a closed LLM.

    Implementations must provide a `generate` method that sends a single
    question to the model at a given temperature and returns the text response.
    API keys are read from the environment — never passed as arguments or
    hard-coded.
    """

    def generate(self, question: str, temperature: float) -> str:
        """Generate a single answer for *question* at *temperature*."""
        ...


class OpenAICaller:
    """
    Calls the OpenAI ChatCompletions API.

    Reads OPENAI_API_KEY from the environment. Raises EnvironmentError if the
    key is missing.
    """

    def __init__(self, model: str = "gpt-3.5-turbo") -> None:
        self._api_key = os.environ.get("OPENAI_API_KEY", "")
        if not self._api_key:
            raise EnvironmentError(
                "OPENAI_API_KEY is not set. Add it to your .env file."
            )
        self._model = model

    def generate(self, question: str, temperature: float) -> str:
        """Call OpenAI ChatCompletions and return the assistant message."""
        # Import lazily to avoid hard dependency at module load time
        import openai

        client = openai.OpenAI(api_key=self._api_key)
        response = client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": question}],
            temperature=temperature,
            max_tokens=512,
        )
        content = response.choices[0].message.content
        return content.strip() if content else ""


class AnthropicCaller:
    """
    Calls the Anthropic Messages API.

    Reads ANTHROPIC_API_KEY from the environment. Raises EnvironmentError if
    the key is missing.
    """

    def __init__(self, model: str = "claude-3-haiku-20240307") -> None:
        self._api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not self._api_key:
            raise EnvironmentError(
                "ANTHROPIC_API_KEY is not set. Add it to your .env file."
            )
        self._model = model

    def generate(self, question: str, temperature: float) -> str:
        """Call Anthropic Messages API and return the assistant text."""
        import anthropic

        client = anthropic.Anthropic(api_key=self._api_key)
        response = client.messages.create(
            model=self._model,
            max_tokens=512,
            messages=[{"role": "user", "content": question}],
            temperature=temperature,
        )
        # response.content is a list of ContentBlock; extract the text.
        text_parts = [
            block.text for block in response.content if hasattr(block, "text")
        ]
        return " ".join(text_parts).strip()


def get_model_caller(source: str) -> ModelCaller:
    """
    Factory: return the correct ModelCaller for a given source identifier.

    Args:
        source: One of "chatgpt" or "claude" (matches app.py SourceEnum).

    Returns:
        A ModelCaller instance configured for that provider.

    Raises:
        ValueError: If *source* is not a recognised provider.
    """
    source_lower = source.strip().lower()
    if source_lower == "chatgpt":
        return OpenAICaller()
    if source_lower == "claude":
        return AnthropicCaller()
    raise ValueError(
        f"Unsupported source '{source}'. Expected 'chatgpt' or 'claude'."
    )


# ==============================================================================
# Embedding & Scoring (pure computation — no API calls)
# ==============================================================================

@lru_cache(maxsize=4)
def _load_embedding_model(
    model_name: str = "all-MiniLM-L6-v2",
) -> SentenceTransformer:
    """
    Load and cache a sentence-transformer model.

    Using lru_cache avoids reloading the model on every call, which matters
    both for latency and for keeping memory stable during repeated test runs.
    """
    logger.info("Loading sentence-transformer model: %s", model_name)
    return SentenceTransformer(model_name)


def compute_consistency_score(
    answers: List[str],
    embedding_model_name: str = "all-MiniLM-L6-v2",
) -> float:
    """
    Measure semantic agreement among a list of answer strings.

    Process:
      1. Encode every answer into a dense vector with a sentence-transformer.
      2. Compute pairwise cosine similarity for all unique (i, j) pairs.
      3. Return the mean similarity as the consistency score.

    Returns:
        A float in [0.0, 1.0].
        - 1.0 means every answer is semantically identical.
        - Values near 0.0 mean the answers strongly disagree.
        - Returns 1.0 trivially when there are fewer than 2 answers.

    Args:
        answers:              List of generated answer strings.
        embedding_model_name: Name of a sentence-transformers model to use.
    """
    if len(answers) < 2:
        # Cannot measure disagreement with fewer than 2 answers.
        return 1.0

    model = _load_embedding_model(embedding_model_name)
    embeddings: NDArray[np.float32] = model.encode(
        answers, convert_to_numpy=True, normalize_embeddings=True
    )

    # With L2-normalised vectors, cosine similarity = dot product.
    num = len(embeddings)
    similarities: List[float] = []
    for i in range(num):
        for j in range(i + 1, num):
            sim = float(np.dot(embeddings[i], embeddings[j]))
            similarities.append(sim)

    mean_similarity = float(np.mean(similarities))

    # Clamp to [0, 1] — cosine similarity on normalised vectors is in [-1, 1]
    # but for semantically meaningful text it rarely goes negative.
    return max(0.0, min(1.0, mean_similarity))


# ==============================================================================
# Sampling (generation across temperature variation)
# ==============================================================================

def _sample_answers(
    caller: ModelCaller,
    question: str,
    n: int = 5,
    base_temperature: float = 0.7,
    temperature_spread: float = 0.2,
) -> List[str]:
    """
    Generate *n* answers to *question* with slight temperature variation.

    The architecture specifies "slight temperature variation" across resamples.
    Each sample uses a temperature uniformly spaced around *base_temperature*
    within ± *temperature_spread*, clamped to [0.0, 1.5].

    Args:
        caller:              A ModelCaller instance for the target provider.
        question:            The question to ask the model.
        n:                   Number of samples to generate.
        base_temperature:    Centre of the temperature sweep.
        temperature_spread:  Half-width of the temperature range.

    Returns:
        A list of *n* answer strings.
    """
    if n < 1:
        raise ValueError("Number of samples (n) must be >= 1.")

    # Build a list of temperatures spread around the base
    if n == 1:
        temperatures = [base_temperature]
    else:
        low = max(0.0, base_temperature - temperature_spread)
        high = min(1.5, base_temperature + temperature_spread)
        temperatures = [
            low + (high - low) * i / (n - 1) for i in range(n)
        ]

    answers: List[str] = []
    for idx, temp in enumerate(temperatures):
        logger.debug(
            "Sampling %d/%d at temperature=%.2f", idx + 1, n, temp
        )
        try:
            answer = caller.generate(question, temperature=temp)
            answers.append(answer)
        except Exception:
            logger.exception(
                "Failed to generate sample %d/%d at temperature=%.2f",
                idx + 1, n, temp,
            )
            # Re-raise so the caller knows sampling failed — don't silently
            # swallow errors that would corrupt the consistency score.
            raise

    return answers


# ==============================================================================
# Public API — matches the signature in ARCHITECTURE_esha_blackbox.md §Week 2
# ==============================================================================

def consistency_score(
    question: str,
    model: str,
    n: int = 5,
    *,
    embedding_model_name: str = "all-MiniLM-L6-v2",
    caller: Optional[ModelCaller] = None,
) -> ConsistencyResult:
    """
    End-to-end consistency checking for a single question.

    1. Calls the target closed model *n* times with temperature variation.
    2. Embeds all answers with a sentence-transformer.
    3. Computes mean pairwise cosine similarity as the consistency score.

    Args:
        question:             The question to ask the model.
        model:                Source identifier ("chatgpt" or "claude").
        n:                    Number of resamples (default 5).
        embedding_model_name: Sentence-transformer model for embeddings.
        caller:               Optional pre-built ModelCaller (useful for
                              testing with a mock). If None, one is created
                              via get_model_caller(model).

    Returns:
        A ConsistencyResult with sampled answers, score, and sample count.

    Raises:
        ValueError:        If *model* is not a supported source.
        EnvironmentError:  If the required API key is not set.
        Exception:         Propagated from the model API if a call fails.
    """
    if caller is None:
        caller = get_model_caller(model)

    answers = _sample_answers(caller, question, n=n)
    score = compute_consistency_score(answers, embedding_model_name)

    return ConsistencyResult(
        question=question,
        sampled_answers=answers,
        consistency_score=score,
        num_samples=len(answers),
    )
