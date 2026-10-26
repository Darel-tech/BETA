from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class FactMatch(BaseModel):
    """Additive optional metadata field for match provenance and score."""
    model_config = ConfigDict(extra="forbid")

    id: int
    score: float
    source: str | None = None
    entity_tag: str | None = None


class RetrieveRequest(BaseModel):
    """POST /retrieve request body."""
    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., min_length=1, max_length=2000, description="Query text to search")
    entities: list[str] | None = Field(
        default=None,
        max_length=20,
        description="Optional entity tags for filtering/boosting (max 20)",
    )
    k: int = Field(default=5, ge=1, le=20, description="Top-k results to return")


class RetrieveResponse(BaseModel):
    """POST /retrieve response body. Exactly matches contract requirements."""
    model_config = ConfigDict(extra="allow")

    facts: list[str]
    latency_ms: int
    matches: list[FactMatch] | None = None


class CorrectRequest(BaseModel):
    """POST /correct request body."""
    model_config = ConfigDict(extra="forbid")

    original_question: str = Field(..., min_length=1, max_length=4000)
    flagged_answer: str = Field(..., min_length=1, max_length=8000)
    facts: list[str] | None = Field(
        default=None,
        description="Optional pre-retrieved facts. If omitted, the service will retrieve them.",
    )


class CorrectResponse(BaseModel):
    """POST /correct response body. Exactly matches contract requirements."""
    model_config = ConfigDict(extra="allow")

    corrected_answer: str
    used_facts: list[str]


class HealthResponse(BaseModel):
    """GET /health response body."""
    model_config = ConfigDict(extra="allow")

    status: Literal["ok", "degraded"]
    db: Literal["ok", "down"]
    embedder_loaded: bool
    knowledge_chunks_count: int
    version: str
