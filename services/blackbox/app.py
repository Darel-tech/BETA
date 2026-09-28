"""
FastAPI service skeleton for the Black-Box Hallucination Detector (BETA).

This module handles API routing, request validation, and response serialization.
All detector logic (semantic entropy, entailment checking, and decision logic)
lives in separate modules and will be integrated here modularly:
  - resample_entropy.py (Technique 1: Consistency across resamples)
  - entailment_check.py (Technique 2: Claim vs. retrieved facts)
  - decision_logic.py   (Verdict and confidence resolution)
"""

import time
from enum import Enum
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator


# ==============================================================================
# Enums and Schemas
# ==============================================================================

class VerdictEnum(str, Enum):
    """Allowed verdicts as defined in ARCHITECTURE_esha_blackbox.md §3."""
    TRUSTWORTHY = "trustworthy"
    UNCERTAIN = "uncertain"
    NEEDS_CORRECTION = "needs_correction"


class SourceEnum(str, Enum):
    """Permitted source models for the blackbox service."""
    CHATGPT = "chatgpt"
    CLAUDE = "claude"


class DetectRequest(BaseModel):
    """
    Request model for black-box hallucination detection.
    
    Compatible with ARCHITECTURE_esha_blackbox.md contract while providing
    extensibility for user question/prompt and pre-retrieved facts.
    """
    text: str = Field(
        ...,
        description="The AI-generated answer to check for hallucinations.",
        examples=["Paris is the capital of France."]
    )
    source: str = Field(
        ...,
        description="The source model producing the text ('chatgpt' or 'claude').",
        examples=["chatgpt"]
    )
    question: Optional[str] = Field(
        default=None,
        description="The original user question or prompt (used for consistency resampling).",
        examples=["What is the capital of France?"]
    )
    entities: Optional[List[str]] = Field(
        default_factory=list,
        description="Optional list of entity strings mentioned in the answer."
    )
    reference_facts: Optional[List[str]] = Field(
        default=None,
        description="Optional list of retrieved reference facts for entailment verification."
    )

    @field_validator("text")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Field 'text' must not be empty or blank.")
        return value.strip()

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        normalized = value.strip().lower()
        valid_sources = {s.value for s in SourceEnum}
        if normalized not in valid_sources:
            raise ValueError(
                f"Invalid source '{value}'. Allowed sources are: {sorted(list(valid_sources))}."
            )
        return normalized


class DetectResponse(BaseModel):
    """
    Response model matching the shared contract in ARCHITECTURE_esha_blackbox.md §3.
    """
    verdict: VerdictEnum = Field(
        ...,
        description="Final detection verdict: trustworthy, uncertain, or needs_correction."
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0."
    )
    evidence: List[str] = Field(
        default_factory=list,
        description="Human-readable strings explaining the verdict."
    )
    latency_ms: float = Field(
        ...,
        description="Execution latency in milliseconds for the detection stage."
    )


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    service: str = "blackbox-detector"
    version: str = "0.1.0"


# ==============================================================================
# FastAPI Application Initialization
# ==============================================================================

app = FastAPI(
    title="BETA Black-Box Hallucination Detector",
    description="FastAPI service detecting hallucinations in closed LLM outputs (ChatGPT, Claude).",
    version="0.1.0"
)


# ==============================================================================
# Exception Handlers
# ==============================================================================

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handles request validation errors.
    
    As specified in ARCHITECTURE_esha_blackbox.md §3, an invalid or missing 'source'
    must return a 400 Bad Request rather than default 422.
    """
    for error in exc.errors():
        loc = error.get("loc", ())
        if "source" in loc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": error.get("msg", "Invalid source specified.")}
            )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()}
    )


# ==============================================================================
# Modular Pipeline Stub (Separation of Concerns)
# ==============================================================================

def _run_detection_pipeline(request: DetectRequest) -> tuple[VerdictEnum, float, List[str]]:
    """
    Modular execution hook for blackbox detection.
    
    NOTE: Detector logic is deliberately kept outside app.py.
    In upcoming milestones, this function will coordinate:
      1. resample_entropy.py  -> consistency_score(question, model)
      2. entailment_check.py  -> entailment(claim, reference_facts)
      3. decision_logic.py    -> decide(consistency, entailment_result)
    """
    raise NotImplementedError(
        "Black-box detection pipeline is not yet implemented. Modules "
        "(resample_entropy, entailment_check, decision_logic) are pending integration."
    )


# ==============================================================================
# Endpoints
# ==============================================================================

@app.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health check endpoint",
    tags=["Monitoring"]
)
async def health_check() -> HealthResponse:
    """Returns basic service health status."""
    return HealthResponse()


@app.post(
    "/detect",
    response_model=DetectResponse,
    status_code=status.HTTP_200_OK,
    summary="Black-box hallucination detection",
    tags=["Detection"]
)
@app.post(
    "/v1/check",
    response_model=DetectResponse,
    status_code=status.HTTP_200_OK,
    summary="Contract alias for black-box detection (ARCHITECTURE §3)",
    tags=["Detection"]
)
async def detect_hallucination(payload: DetectRequest) -> DetectResponse:
    """
    Detect hallucinations in closed-model responses (ChatGPT / Claude).
    
    Accepts text, source, optional prompt/question, entities, and optional reference facts.
    Times the detection execution for latency_ms reporting.
    """
    start_time = time.perf_counter()

    try:
        verdict, confidence, evidence = _run_detection_pipeline(payload)
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Detection pipeline error: {str(exc)}"
        )

    latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

    return DetectResponse(
        verdict=verdict,
        confidence=confidence,
        evidence=evidence,
        latency_ms=latency_ms
    )


# ==============================================================================
# Runnable with uvicorn
# ==============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
