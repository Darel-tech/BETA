"""
Centralized configuration for the Interpretability Core service.

Design intent (read this before changing anything):
- Every tunable value lives here, loaded from environment variables, so the
  rest of the codebase never hardcodes a model name, a threshold, or a secret.
- This file has zero dependency on any other file in this service, and zero
  dependency on anything outside `services/interpretability/`. That isolation
  is deliberate: it's what lets this service be built, tested, and deployed
  completely independently of Esha's, Chandru's, or Ahamed's code.
- Never commit a real `.env` file. `.env.example` documents the variable
  names only. Secrets are injected at deploy time via the hosting platform's
  environment variable settings (Hugging Face Spaces secrets, in our case).
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Model & interpretability ---
    model_name: str = Field(default="google/gemma-2-2b-it")
    sae_release: str = Field(default="gemma-scope-2b-pt-res-canonical")
    sae_layer: int = Field(default=20, ge=0, le=25)
    device: Literal["cuda", "cpu", "mps", "auto"] = Field(default="auto")
    model_dtype: Literal["float16", "bfloat16", "float32"] = Field(default="bfloat16")

    # Path to the calibrated known/unknown direction vector produced by
    # scripts/train_probe.py. The service refuses to start without this file
    # present (see model_loader.py) — we never want to silently serve an
    # untrained, meaningless probe.
    probe_artifact_path: str = Field(default="artifacts/known_direction.npz")

    # Decision thresholds — tune these from calibration data, not by guessing.
    threshold_trustworthy: float = Field(default=0.70, ge=0.0, le=1.0)
    threshold_uncertain_low: float = Field(default=0.40, ge=0.0, le=1.0)

    # --- Database (entity_labels table only — see entity_dataset.py) ---
    database_url: str | None = Field(default=None)

    # --- Security ---
    # Shared secret that sibling services (and the Vercel router) must send
    # in the `X-Internal-Api-Key` header. This is NOT a public API — it's
    # internal service-to-service auth. Generate with `openssl rand -hex 32`.
    internal_api_key: str = Field(default="")

    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    rate_limit_per_minute: int = Field(default=30, ge=1)
    max_text_length: int = Field(default=4000, ge=1)
    max_entities: int = Field(default=20, ge=1, le=100)
    request_timeout_seconds: float = Field(default=20.0, gt=0)

    # --- Observability ---
    log_level: str = Field(default="INFO")
    environment: Literal["development", "staging", "production"] = Field(default="development")

    @field_validator("internal_api_key")
    @classmethod
    def warn_if_empty_in_prod(cls, v: str, info) -> str:
        # We don't hard-fail here because local dev without a key should still
        # work; app.py enforces the hard requirement for non-development envs.
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Settings are loaded once and cached — avoids re-parsing env on every request."""
    return Settings()