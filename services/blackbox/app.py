"""FastAPI service for the black-box hallucination detector.

Run from the repository root::

    uvicorn services.blackbox.app:app --port 8000

Importing this module does not download models or call any network service;
the detector and its models are created lazily on the first request.
"""

import logging
import os
import threading
import time
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .decision_logic import Verdict
from .detector import Detector
from .entailment_check import DEFAULT_NLI_MODEL, MAX_FACTS, MAX_TEXT_CHARS
from .errors import (
    BlackBoxError,
    ConfigurationError,
    InputValidationError,
    ModelError,
    ProviderError,
)
from .resample_entropy import DEFAULT_EMBEDDING_MODEL

logger = logging.getLogger(__name__)

MAX_ENTITIES = 100


class DetectRequest(BaseModel):
    """Request body for ``POST /detect`` and ``POST /v1/check``."""

    text: str = Field(..., description="The answer or claim to evaluate.", max_length=MAX_TEXT_CHARS)
    source: Literal["chatgpt", "claude"] = Field(
        ..., description="Which LLM produced the text; selects the resampling provider."
    )
    question: Optional[str] = Field(
        None,
        description="Original question. Enables response-consistency analysis; "
        "if omitted, resampling is skipped.",
        max_length=8000,
    )
    entities: Optional[List[str]] = Field(
        None,
        description="Optional entity names. Accepted for contract compatibility; "
        "not used in scoring.",
        max_length=MAX_ENTITIES,
    )
    reference_facts: Optional[List[str]] = Field(
        None,
        description="Optional reference facts to check the text against. Blank "
        "entries are dropped; if none remain, fact verification is unavailable.",
        max_length=MAX_FACTS,
    )

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value

    @field_validator("question")
    @classmethod
    def _question_blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("entities")
    @classmethod
    def _clean_entities(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        cleaned = [v.strip() for v in value if v.strip()]
        return cleaned or None

    @field_validator("reference_facts")
    @classmethod
    def _clean_facts(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        cleaned = [v.strip() for v in value if v.strip()]
        for fact in cleaned:
            if len(fact) > MAX_TEXT_CHARS:
                raise ValueError(f"each reference fact must be at most {MAX_TEXT_CHARS} characters")
        return cleaned or None


class DetectResponse(BaseModel):
    """Response body for the detection endpoints."""

    verdict: Verdict
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Heuristic strength of the verdict; NOT a calibrated probability."
    )
    evidence: List[str]
    latency_ms: float
    signals: Dict[str, Any] = Field(
        default_factory=dict, description="Underlying signal values used by the decision rules."
    )


_STATUS_BY_ERROR = (
    (InputValidationError, 422),
    (ConfigurationError, 503),
    (ModelError, 503),
    (ProviderError, 502),
)


def _status_for(exc: BlackBoxError) -> int:
    for error_type, status in _STATUS_BY_ERROR:
        if isinstance(exc, error_type):
            return status
    return 500


def get_detector(request: Request) -> Detector:
    """FastAPI dependency returning the (lazily created) shared detector."""
    state = request.app.state
    if state.detector is None:
        with state.detector_lock:
            if state.detector is None:
                state.detector = Detector()
    return state.detector


def create_app(detector: Optional[Detector] = None) -> FastAPI:
    """Application factory.

    Args:
        detector: Optional pre-built detector (used by tests). When omitted a
            default :class:`Detector` is built on the first request.
    """
    app = FastAPI(
        title="Hallucination Firewall - Black-Box Detector",
        version=__version__,
        description=(
            "Combines response-consistency resampling with NLI entailment "
            "against supplied reference facts. Outputs are heuristic signals, "
            "not proof of factual truth."
        ),
    )
    app.state.detector = detector
    app.state.detector_lock = threading.Lock()

    @app.exception_handler(BlackBoxError)
    async def _blackbox_error_handler(_: Request, exc: BlackBoxError) -> JSONResponse:
        return JSONResponse(
            status_code=_status_for(exc),
            content={"detail": {"error": exc.code, "message": str(exc)}},
        )

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        """Service health. Does not load models or contact providers."""
        return {
            "status": "ok",
            "service": "blackbox-detector",
            "version": __version__,
            "providers_configured": {
                "openai": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
                "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY", "").strip()),
            },
            "models": {
                "embedding": os.environ.get("BLACKBOX_EMBEDDING_MODEL", "").strip()
                or DEFAULT_EMBEDDING_MODEL,
                "nli": os.environ.get("BLACKBOX_NLI_MODEL", "").strip() or DEFAULT_NLI_MODEL,
            },
        }

    @app.post(
        "/detect",
        response_model=DetectResponse,
        responses={
            422: {"description": "Invalid input"},
            502: {"description": "Upstream LLM provider failure"},
            503: {"description": "Missing configuration or local model failure"},
        },
    )
    @app.post("/v1/check", response_model=DetectResponse, include_in_schema=True)
    async def detect(
        payload: DetectRequest, detector: Detector = Depends(get_detector)
    ) -> DetectResponse:
        """Evaluate an answer; also available as ``POST /v1/check``."""
        started = time.perf_counter()
        try:
            # Model inference is blocking, so run it off the event loop.
            outcome = await run_in_threadpool(
                detector.detect,
                text=payload.text,
                source=payload.source,
                question=payload.question,
                reference_facts=payload.reference_facts,
                entities=payload.entities,
            )
        except BlackBoxError:
            raise  # handled by _blackbox_error_handler
        except Exception as exc:
            logger.error("Unexpected detection failure: %s", type(exc).__name__)
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "internal_error",
                    "message": "Unexpected internal error while running detection.",
                },
            ) from None

        return DetectResponse(
            verdict=outcome.decision.verdict,
            confidence=outcome.decision.confidence,
            evidence=outcome.evidence,
            latency_ms=round((time.perf_counter() - started) * 1000.0, 2),
            signals=outcome.signals,
        )

    return app


app = create_app()
