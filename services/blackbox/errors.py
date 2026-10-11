"""Shared exception types for the black-box detector.

This small module exists so that every other module (consistency, entailment,
decision, pipeline, API) can raise and catch the same exceptions without
importing each other, which avoids circular imports. Each exception carries a
stable machine-readable ``code`` used by the HTTP layer.

Messages on these exceptions must never contain API keys, prompts, or raw
provider error bodies.
"""

from __future__ import annotations


class BlackBoxError(Exception):
    """Base class for all expected detector errors."""

    code = "blackbox_error"


class InputValidationError(BlackBoxError, ValueError):
    """The caller supplied invalid input (maps to HTTP 422)."""

    code = "invalid_input"


class NoReferenceFactsError(InputValidationError):
    """Entailment was requested but no usable reference facts were supplied."""

    code = "no_reference_facts"


class ConfigurationError(BlackBoxError):
    """Required configuration (e.g. an API key) is missing or invalid (HTTP 503)."""

    code = "configuration_error"


class ProviderError(BlackBoxError):
    """An upstream LLM provider call failed or returned unusable output (HTTP 502)."""

    code = "provider_error"


class ModelError(BlackBoxError):
    """A local ML model (embedding or NLI) failed to load or run (HTTP 503)."""

    code = "model_error"
