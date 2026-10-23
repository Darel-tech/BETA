"""
The /v1/check contract — the shape every BETA detection service must return.

This is intentionally duplicated (not imported from packages/contracts/)
so this service has zero import-time dependency on anything outside its own
folder and can be built, tested, and deployed in complete isolation.

If you ever need to change this shape, it must match Esha's copy exactly —
raise it with the team before editing, per ARCHITECTURE.md §3.
"""

from pydantic import BaseModel, Field, field_validator

# Verdict is kept as a plain string (not a strict Enum) in the response model
# on purpose: it's returned as JSON to services written in other languages/
# frameworks (the Next.js router), so a plain string is the safer wire format.
# The three valid values are enforced in app.py's _decide() function instead.
VALID_VERDICTS = {"trustworthy", "uncertain", "needs_correction"}


class CheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000, description="AI-generated answer to check")
    source: str = Field(..., description='Must be "local-gemma" for this service')
    entities: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("text")
    @classmethod
    def strip_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty or whitespace-only")
        return v

    @field_validator("entities")
    @classmethod
    def validate_entities(cls, v: list[str]) -> list[str]:
        cleaned = []
        for e in v:
            e = e.strip()
            if not e:
                continue
            if len(e) > 200:
                raise ValueError("individual entity strings must be under 200 characters")
            cleaned.append(e)
        return cleaned

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        if v != "local-gemma":
            raise ValueError('this service only accepts source="local-gemma"')
        return v


class CheckResponse(BaseModel):
    verdict: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    latency_ms: int = Field(..., ge=0)


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    probe_calibrated: bool
    device: str