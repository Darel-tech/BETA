"""Response-consistency module (resampling + semantic consistency proxy).

What this computes
------------------
Given a question, the module samples several answers from an external LLM
(OpenAI, Anthropic, Groq, or OpenRouter), embeds them with a sentence-transformers
model, and returns the **mean pairwise cosine similarity** (clipped to
``[0, 1]``) as ``consistency_score``.

This is a *semantic consistency proxy*. It is **not** the semantic entropy
algorithm of Farquhar et al. (2024), which clusters answers by bidirectional
entailment and computes entropy over the clusters. Despite the module name
(kept for compatibility with the project layout), no entropy is computed here.

Known limitation: an LLM can be consistently wrong, so a high score is not
evidence of factual correctness.

Design
------
* Generation (``sample_answers``) and scoring (``compute_consistency``) are
  separate and independently testable.
* Callers can inject a ``SampleCaller`` and an ``Embedder`` so tests need no
  network access, API keys, or model downloads.
* Provider SDKs and sentence-transformers are imported lazily.
* The embedding model is loaded once per process and cached.
* Logs never contain API keys, prompts, answers, or provider error messages.
"""

from __future__ import annotations

import logging
import math
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Protocol, Sequence, Tuple

import numpy as np

from .errors import (
    BlackBoxError,
    ConfigurationError,
    InputValidationError,
    ModelError,
    ProviderError,
)

logger = logging.getLogger(__name__)

PROVIDER_OPENAI = "openai"
PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_GROQ = "groq"
PROVIDER_OPENROUTER = "openrouter"
SUPPORTED_PROVIDERS: Tuple[str, ...] = (
    PROVIDER_OPENAI,
    PROVIDER_ANTHROPIC,
    PROVIDER_GROQ,
    PROVIDER_OPENROUTER,
)

DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b"
DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free"
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

DEFAULT_SAMPLE_COUNT = 5
DEFAULT_TEMPERATURE = 1.0
DEFAULT_MAX_TOKENS = 300

MIN_SAMPLES = 2
MAX_SAMPLES = 20
MAX_QUESTION_CHARS = 8000
MAX_TOKENS_LIMIT = 4096

#: Highest temperature each provider accepts.
MAX_TEMPERATURE: Dict[str, float] = {
    PROVIDER_OPENAI: 2.0,
    PROVIDER_ANTHROPIC: 1.0,
    PROVIDER_GROQ: 2.0,
    PROVIDER_OPENROUTER: 2.0,
}

METHOD_DESCRIPTION = (
    "mean pairwise cosine similarity of sentence embeddings, clipped to [0, 1] "
    "(semantic consistency proxy; NOT the Farquhar et al. semantic entropy)"
)

#: ``(question, n, temperature) -> answers``. Model name and token limits are
#: bound into the callable by :func:`make_provider_caller`.
SampleCaller = Callable[[str, int, float], Sequence[str]]


class Embedder(Protocol):
    """Anything with a sentence-transformers style ``encode`` method."""

    def encode(self, sentences: Sequence[str]) -> Any:
        """Return an array-like of shape ``(len(sentences), dim)``."""
        ...


@dataclass(frozen=True)
class ConsistencyResult:
    """Outcome of resampling a question.

    Attributes:
        question: The question that was sampled.
        answers: The sampled answers (stripped, non-blank).
        consistency_score: Mean pairwise cosine similarity in ``[0, 1]``.
            Higher means the samples agree more. A heuristic, not a probability.
        sample_count: Number of answers used (``len(answers)``).
        provider: ``"openai"``, ``"anthropic"``, ``"groq"``, or ``"openrouter"``.
        model: Provider model name used for sampling.
        temperature: Sampling temperature used.
        method: Human-readable description of how the score was computed.
    """

    question: str
    answers: Tuple[str, ...]
    consistency_score: float
    sample_count: int
    provider: str = ""
    model: str = ""
    temperature: float = DEFAULT_TEMPERATURE
    method: str = METHOD_DESCRIPTION
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cached_input_tokens: Optional[int] = None


class SampleBatch(list):
    """Answers plus provider-reported usage when the SDK supplies it."""

    def __init__(self, answers: Sequence[str], input_tokens: Optional[int] = None, output_tokens: Optional[int] = None, cached_input_tokens: Optional[int] = None):
        super().__init__(answers)
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cached_input_tokens = cached_input_tokens


# --------------------------------------------------------------------------
# Validation and configuration helpers
# --------------------------------------------------------------------------


def _require_text(value: Any, name: str, max_chars: int = MAX_QUESTION_CHARS) -> str:
    if not isinstance(value, str):
        raise InputValidationError(f"{name} must be a string")
    stripped = value.strip()
    if not stripped:
        raise InputValidationError(f"{name} must not be blank")
    if len(stripped) > max_chars:
        raise InputValidationError(f"{name} must be at most {max_chars} characters")
    return stripped


def _validate_provider(provider: Any) -> str:
    if not isinstance(provider, str) or provider.strip().lower() not in SUPPORTED_PROVIDERS:
        raise InputValidationError(
            f"provider must be one of {list(SUPPORTED_PROVIDERS)}"
        )
    return provider.strip().lower()


def _validate_int(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise InputValidationError(f"{name} must be an integer")
    if not low <= value <= high:
        raise InputValidationError(f"{name} must be between {low} and {high}")
    return value


def _validate_temperature(value: Any, provider: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputValidationError("temperature must be a number")
    value = float(value)
    limit = MAX_TEMPERATURE[provider]
    if not math.isfinite(value) or not 0.0 <= value <= limit:
        raise InputValidationError(
            f"temperature must be between 0 and {limit} for provider '{provider}'"
        )
    return value


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number") from exc


def _provider_timeout_seconds() -> float:
    timeout = _env_float("BLACKBOX_PROVIDER_TIMEOUT_SECONDS", 15.0)
    if not math.isfinite(timeout) or not 1.0 <= timeout <= 60.0:
        raise ConfigurationError("BLACKBOX_PROVIDER_TIMEOUT_SECONDS must be between 1 and 60")
    return timeout


def resolve_model(provider: str, model: Optional[str] = None) -> str:
    """Return the model name to use: explicit argument, env var, or default."""
    if model and model.strip():
        return model.strip()
    configuration = {
        PROVIDER_OPENAI: ("BLACKBOX_OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
        PROVIDER_ANTHROPIC: ("BLACKBOX_ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
        PROVIDER_GROQ: ("GROQ_MODEL", DEFAULT_GROQ_MODEL),
        PROVIDER_OPENROUTER: ("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL),
    }
    env_name, default = configuration[provider]
    return os.environ.get(env_name, "").strip() or default


def is_api_key_configured(env_name: str) -> bool:
    """Return false for empty values and common sample credentials."""
    key = os.environ.get(env_name, "").strip()
    normalized = key.casefold()
    return bool(
        key
        and normalized not in {"changeme", "replace-me", "placeholder"}
        and not normalized.startswith(("your-", "replace-", "placeholder"))
    )


def _api_key(env_name: str) -> str:
    key = os.environ.get(env_name, "").strip()
    if not is_api_key_configured(env_name):
        raise ConfigurationError(f"{env_name} is not set")
    return key


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------


def make_provider_caller(
    provider: str,
    model: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> SampleCaller:
    """Build a :data:`SampleCaller` backed by the official provider SDK.

    The API key is read from ``OPENAI_API_KEY`` / ``ANTHROPIC_API_KEY`` when
    the returned callable is *invoked*, and the SDK is imported at that moment,
    so constructing a caller never touches the network or the environment.

    Raises:
        InputValidationError: Unknown provider.
    """
    provider = _validate_provider(provider)
    model_name = resolve_model(provider, model)
    if provider == PROVIDER_ANTHROPIC:
        return _anthropic_caller(model_name, max_tokens)
    return _openai_compatible_caller(provider, model_name, max_tokens)


def _openai_caller(model_name: str, max_tokens: int) -> SampleCaller:
    return _openai_compatible_caller(PROVIDER_OPENAI, model_name, max_tokens)


def _openai_compatible_caller(
    provider: str,
    model_name: str,
    max_tokens: int,
) -> SampleCaller:
    provider_config = {
        PROVIDER_OPENAI: ("OPENAI_API_KEY", None, "OpenAI", "max_completion_tokens"),
        PROVIDER_GROQ: ("GROQ_API_KEY", "https://api.groq.com/openai/v1", "Groq", "max_completion_tokens"),
        PROVIDER_OPENROUTER: ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "OpenRouter", "max_tokens"),
    }
    key_name, base_url, label, token_limit_name = provider_config[provider]

    def call(question: str, n: int, temperature: float) -> Sequence[str]:
        key = _api_key(key_name)
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise ConfigurationError("The 'openai' package is not installed") from exc
        try:
            client_options: Dict[str, Any] = {
                "api_key": key,
                "timeout": _provider_timeout_seconds(),
                "max_retries": 1,
            }
            if base_url:
                client_options["base_url"] = base_url
            client = OpenAI(**client_options)
            request_options: Dict[str, Any] = {
                "model": model_name,
                "messages": [{"role": "user", "content": question}],
                "temperature": temperature,
                token_limit_name: max_tokens,
            }

            def sample_one(_: int) -> tuple[str, Optional[int], Optional[int], Optional[int]]:
                response = client.chat.completions.create(
                    **request_options,
                    **({"n": n} if provider == PROVIDER_OPENAI else {"n": 1}),
                )
                usage = getattr(response, "usage", None)
                prompt_details = getattr(usage, "prompt_tokens_details", None)
                answer = response.choices[0].message.content or ""
                return (
                    answer,
                    getattr(usage, "prompt_tokens", None),
                    getattr(usage, "completion_tokens", None),
                    getattr(prompt_details, "cached_tokens", None),
                )

            # Groq supports only n=1. Issue bounded independent requests so
            # consistency checks still receive the requested number of samples.
            if provider == PROVIDER_OPENAI:
                response = client.chat.completions.create(
                    **request_options, n=n
                )
                usage = getattr(response, "usage", None)
                prompt_details = getattr(usage, "prompt_tokens_details", None)
                return SampleBatch(
                    [choice.message.content or "" for choice in response.choices],
                    getattr(usage, "prompt_tokens", None),
                    getattr(usage, "completion_tokens", None),
                    getattr(prompt_details, "cached_tokens", None),
                )

            with ThreadPoolExecutor(max_workers=min(n, 5)) as executor:
                samples = list(executor.map(sample_one, range(n)))
            inputs = [sample[1] for sample in samples]
            outputs = [sample[2] for sample in samples]
            cached = [sample[3] for sample in samples]
            return SampleBatch(
                [sample[0] for sample in samples],
                sum(inputs) if all(value is not None for value in inputs) else None,
                sum(outputs) if all(value is not None for value in outputs) else None,
                sum(cached) if all(value is not None for value in cached) else None,
            )
        except Exception as exc:  # SDK errors vary; never echo their messages.
            logger.warning("%s sampling failed: %s", label, type(exc).__name__)
            raise ProviderError(
                f"{label} request failed ({type(exc).__name__})"
            ) from exc

    return call


def _anthropic_caller(model_name: str, max_tokens: int) -> SampleCaller:
    def call(question: str, n: int, temperature: float) -> Sequence[str]:
        key = _api_key("ANTHROPIC_API_KEY")
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise ConfigurationError("The 'anthropic' package is not installed") from exc
        try:
            client = Anthropic(
                api_key=key,
                timeout=_provider_timeout_seconds(),
                max_retries=1,
            )

            def sample_one(_: int) -> tuple[str, Optional[int], Optional[int], Optional[int]]:
                response = client.messages.create(
                    model=model_name,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    messages=[{"role": "user", "content": question}],
                )
                answer = "".join(
                    block.text
                    for block in response.content
                    if getattr(block, "type", None) == "text"
                )
                usage = getattr(response, "usage", None)
                cache_read = getattr(usage, "cache_read_input_tokens", None)
                cache_write = getattr(usage, "cache_creation_input_tokens", None)
                cached = cache_read + cache_write if cache_read is not None and cache_write is not None else None
                return answer, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None), cached

            # Anthropic's Messages API returns one completion per request.
            # Independent resamples run concurrently, bounded to the normal
            # five-sample workload to avoid an unbounded request burst.
            with ThreadPoolExecutor(max_workers=min(n, 5)) as executor:
                samples = list(executor.map(sample_one, range(n)))
            inputs = [sample[1] for sample in samples]
            outputs = [sample[2] for sample in samples]
            cached = [sample[3] for sample in samples]
            return SampleBatch(
                [sample[0] for sample in samples],
                sum(inputs) if all(value is not None for value in inputs) else None,
                sum(outputs) if all(value is not None for value in outputs) else None,
                sum(cached) if all(value is not None for value in cached) else None,
            )
        except Exception as exc:
            logger.warning("Anthropic sampling failed: %s", type(exc).__name__)
            raise ProviderError(
                f"Anthropic request failed ({type(exc).__name__})"
            ) from exc

    return call


def sample_answers(
    question: str,
    *,
    provider: str,
    n: int = DEFAULT_SAMPLE_COUNT,
    temperature: float = DEFAULT_TEMPERATURE,
    model: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    caller: Optional[SampleCaller] = None,
) -> list:
    """Sample ``n`` answers to ``question`` from an LLM provider.

    Args:
        question: The question to ask.
        provider: ``"openai"`` or ``"anthropic"``.
        n: Number of answers (``MIN_SAMPLES``..``MAX_SAMPLES``).
        temperature: Sampling temperature (provider-specific upper bound).
        model: Model name; defaults to the env var or built-in default.
        max_tokens: Per-answer output token cap.
        caller: Optional injected callable replacing the real SDK (for tests).

    Returns:
        A list of 2..n stripped, non-blank answers.

    Raises:
        InputValidationError: Invalid arguments.
        ConfigurationError: Missing API key / SDK.
        ProviderError: The provider call failed or returned too few answers.
    """
    question = _require_text(question, "question")
    provider = _validate_provider(provider)
    n = _validate_int(n, "n", MIN_SAMPLES, MAX_SAMPLES)
    temperature = _validate_temperature(temperature, provider)
    max_tokens = _validate_int(max_tokens, "max_tokens", 1, MAX_TOKENS_LIMIT)

    if caller is None:
        caller = make_provider_caller(provider, model=model, max_tokens=max_tokens)

    try:
        raw = caller(question, n, temperature)
    except BlackBoxError:
        raise
    except Exception as exc:
        logger.warning("Sampling via %s failed: %s", provider, type(exc).__name__)
        raise ProviderError(
            f"Sampling via {provider} failed ({type(exc).__name__})"
        ) from exc

    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
        raise ProviderError("Provider returned an unexpected response shape")
    input_tokens = getattr(raw, "input_tokens", None)
    output_tokens = getattr(raw, "output_tokens", None)
    cached_input_tokens = getattr(raw, "cached_input_tokens", None)
    answers = [a.strip() for a in raw if isinstance(a, str) and a.strip()]
    if len(answers) < MIN_SAMPLES:
        raise ProviderError(
            f"Provider returned fewer than {MIN_SAMPLES} usable answers"
        )
    return SampleBatch(answers[:n], input_tokens, output_tokens, cached_input_tokens)


# --------------------------------------------------------------------------
# Embeddings and consistency
# --------------------------------------------------------------------------

_EMBEDDER_CACHE: Dict[str, Embedder] = {}
_EMBEDDER_LOCK = threading.Lock()


def _load_embedder(model_name: str) -> Embedder:
    """Load a SentenceTransformer (downloads weights on first use)."""
    try:
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(model_name)
    except Exception as exc:
        raise ModelError(
            f"Could not load embedding model '{model_name}' ({type(exc).__name__})"
        ) from exc


def get_default_embedder(model_name: Optional[str] = None) -> Embedder:
    """Return a process-wide cached embedder, loading it on first call only."""
    name = (
        (model_name or "").strip()
        or os.environ.get("BLACKBOX_EMBEDDING_MODEL", "").strip()
        or DEFAULT_EMBEDDING_MODEL
    )
    with _EMBEDDER_LOCK:
        if name not in _EMBEDDER_CACHE:
            _EMBEDDER_CACHE[name] = _load_embedder(name)
        return _EMBEDDER_CACHE[name]


def clear_embedder_cache() -> None:
    """Drop cached embedders (used by tests)."""
    with _EMBEDDER_LOCK:
        _EMBEDDER_CACHE.clear()


def compute_consistency(
    answers: Sequence[str], embedder: Optional[Embedder] = None
) -> float:
    """Mean pairwise cosine similarity of ``answers``, clipped to ``[0, 1]``.

    Negative similarities are clipped to 0 so the score stays in ``[0, 1]``.

    Raises:
        InputValidationError: Fewer than two answers, or non-string/blank items.
        ModelError: The embedder failed or returned malformed vectors.
    """
    if isinstance(answers, (str, bytes)) or not isinstance(answers, Sequence):
        raise InputValidationError("answers must be a list of strings")
    if len(answers) < MIN_SAMPLES:
        raise InputValidationError(
            f"At least {MIN_SAMPLES} answers are required to measure consistency"
        )
    cleaned = []
    for item in answers:
        if not isinstance(item, str) or not item.strip():
            raise InputValidationError("answers must be non-blank strings")
        cleaned.append(item.strip())

    if embedder is None:
        embedder = get_default_embedder()

    try:
        vectors = np.asarray(embedder.encode(cleaned), dtype=float)
    except BlackBoxError:
        raise
    except Exception as exc:
        raise ModelError(f"Embedding failed ({type(exc).__name__})") from exc

    if vectors.ndim != 2 or vectors.shape[0] != len(cleaned) or vectors.shape[1] == 0:
        raise ModelError("Embedder returned vectors with an unexpected shape")
    if not np.all(np.isfinite(vectors)):
        raise ModelError("Embedder returned non-finite values")
    norms = np.linalg.norm(vectors, axis=1)
    if np.any(norms == 0):
        raise ModelError("Embedder returned a zero vector")

    unit = vectors / norms[:, None]
    sims = unit @ unit.T
    upper = sims[np.triu_indices(len(cleaned), k=1)]
    score = float(np.clip(upper.mean(), 0.0, 1.0))
    return score


def measure_consistency(
    question: str,
    *,
    provider: str,
    n: Optional[int] = None,
    temperature: Optional[float] = None,
    model: Optional[str] = None,
    max_tokens: Optional[int] = None,
    caller: Optional[SampleCaller] = None,
    embedder: Optional[Embedder] = None,
) -> ConsistencyResult:
    """Sample answers to ``question`` and score their semantic consistency.

    ``n``, ``temperature`` and ``max_tokens`` default to the environment
    variables ``BLACKBOX_SAMPLE_COUNT``, ``BLACKBOX_TEMPERATURE`` and
    ``BLACKBOX_MAX_TOKENS`` (then to built-in defaults). Sampling happens
    before the embedding model is loaded, so a missing API key fails fast.
    """
    provider = _validate_provider(provider)
    n = _env_int("BLACKBOX_SAMPLE_COUNT", DEFAULT_SAMPLE_COUNT) if n is None else n
    temperature = (
        _env_float("BLACKBOX_TEMPERATURE", DEFAULT_TEMPERATURE)
        if temperature is None
        else temperature
    )
    max_tokens = (
        _env_int("BLACKBOX_MAX_TOKENS", DEFAULT_MAX_TOKENS)
        if max_tokens is None
        else max_tokens
    )

    answers = sample_answers(
        question,
        provider=provider,
        n=n,
        temperature=temperature,
        model=model,
        max_tokens=max_tokens,
        caller=caller,
    )
    score = compute_consistency(answers, embedder)
    return ConsistencyResult(
        question=question.strip(),
        answers=tuple(answers),
        consistency_score=score,
        sample_count=len(answers),
        provider=provider,
        model=resolve_model(provider, model),
        temperature=float(temperature),
        input_tokens=getattr(answers, "input_tokens", None),
        output_tokens=getattr(answers, "output_tokens", None),
        cached_input_tokens=getattr(answers, "cached_input_tokens", None),
    )
