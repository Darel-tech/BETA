import json
from typing import Literal
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    ENVIRONMENT: Literal["development", "test", "production"] = "development"
    VERSION: str = "1.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    ALLOWED_ORIGINS: list[str] = Field(default_factory=lambda: ["*"])

    # Authentication
    INTERNAL_API_KEY: str = Field(default="test-internal-key-12345")

    # Database URLs
    DATABASE_URL: str = Field(
        default="postgresql://user:pass@localhost:5432/neondb?sslmode=disable"
    )
    DATABASE_URL_DIRECT: str | None = None
    DB_POOL_MIN_SIZE: int = 2
    DB_POOL_MAX_SIZE: int = 10
    DB_TIMEOUT_SECONDS: float = 10.0

    # Embedder settings
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIMENSION: int = 384
    QUANTIZATION_MODE: Literal["none", "int8", "binary"] = "none"

    # LLM Settings for Correction
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_API_KEY: str = ""
    LLM_TIMEOUT_SECONDS: float = 15.0
    LLM_MAX_TOKENS: int = 512

    # In-memory Cache & Rate limiting
    CACHE_TTL_SECONDS: int = 60
    RATE_LIMIT_REQUESTS_PER_MINUTE: int = 120

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, list):
                        return [str(v) for v in parsed]
                except Exception:
                    pass
            return [v.strip() for v in value.split(",") if v.strip()]
        if isinstance(value, list):
            return [str(v) for v in value]
        return ["*"]


settings = Settings()
