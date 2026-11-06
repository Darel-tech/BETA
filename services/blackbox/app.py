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

    # ── /generate — single answer from a closed model (for /api/compare) ─────
    class GenerateRequest(BaseModel):
        question: str = Field(..., max_length=8000)
        source: str = Field(..., description='"chatgpt" or "claude"')

    class GenerateResponse(BaseModel):
        answer: str
        latency_ms: float

    @app.post("/generate", response_model=GenerateResponse)
    async def generate_answer(payload: GenerateRequest) -> GenerateResponse:
        """
        Generate a single answer from ChatGPT or Claude.
        Called by the Next.js /api/compare router during fan-out.
        Uses the real provider SDK — never returns a cached or mock response.
        """
        from .resample_entropy import _api_key, _openai_caller, _anthropic_caller, DEFAULT_MAX_TOKENS

        source_map = {"chatgpt": "openai", "claude": "anthropic"}
        if payload.source not in source_map:
            raise HTTPException(status_code=422, detail="source must be chatgpt or claude")

        provider = source_map[payload.source]
        started = time.perf_counter()

        try:
            if provider == "openai":
                caller = _openai_caller(
                    os.environ.get("BLACKBOX_OPENAI_MODEL", "gpt-4o-mini"), DEFAULT_MAX_TOKENS
                )
            else:
                caller = _anthropic_caller(
                    os.environ.get("BLACKBOX_ANTHROPIC_MODEL", "claude-haiku-5-5"), DEFAULT_MAX_TOKENS
                )

            answers = await run_in_threadpool(caller, payload.question, 1, 0.7)
            answer = answers[0] if answers else ""
        except BlackBoxError as exc:
            raise HTTPException(status_code=502, detail={"error": exc.code, "message": str(exc)}) from exc
        except Exception as exc:
            logger.error("Generation failed: %s", type(exc).__name__)
            raise HTTPException(status_code=500, detail="Generation failed") from exc

        return GenerateResponse(
            answer=answer,
            latency_ms=round((time.perf_counter() - started) * 1000.0, 2),
        )

    # ── /entail — cross-model NLI entailment for agreement computation ────────
    class EntailPair(BaseModel):
        model: str
        answer: str

    class EntailRequest(BaseModel):
        answers: List[EntailPair] = Field(..., min_length=2)

    class EntailResponse(BaseModel):
        all_agree: bool
        majority_cluster: str
        outliers: List[str]

    @app.post("/entail", response_model=EntailResponse)
    async def cross_entail(payload: EntailRequest) -> EntailResponse:
        """
        Run bidirectional NLI between all pairs of model answers.
        Returns the agreement label and outlier model names.
        Real NLI inference — no string matching shortcuts.
        """
        from .entailment_check import CrossEncoderNLIScorer

        pairs_input = payload.answers
        if len(pairs_input) < 2:
            raise HTTPException(status_code=422, detail="Need at least 2 answers")

        scorer = CrossEncoderNLIScorer()
        texts = [p.answer for p in pairs_input]
        models_ = [p.model for p in pairs_input]

        # Build all ordered pairs (a, b) for bidirectional entailment
        nli_pairs = [
            (texts[i], texts[j])
            for i in range(len(texts))
            for j in range(len(texts))
            if i != j
        ]

        try:
            raw = await run_in_threadpool(scorer.score, nli_pairs)
        except Exception as exc:
            logger.error("Cross-entailment failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="NLI inference failed") from exc

        # Average entailment probability for each model (as "source")
        n = len(texts)
        avg_entail: Dict[str, float] = {}
        pair_idx = 0
        for i in range(n):
            entail_scores = []
            for j in range(n):
                if i != j:
                    entail_scores.append(raw[pair_idx][1])  # index 1 = entailment prob
                    pair_idx += 1
            avg_entail[models_[i]] = sum(entail_scores) / len(entail_scores) if entail_scores else 0.0

        AGREE_THRESHOLD = 0.5
        all_agree = all(v >= AGREE_THRESHOLD for v in avg_entail.values())
        sorted_models = sorted(avg_entail.items(), key=lambda x: x[1])
        outliers = [m for m, s in sorted_models if s < AGREE_THRESHOLD] if not all_agree else []

        majority_cluster = max(avg_entail, key=lambda m: avg_entail[m])
        majority_text = next(p.answer for p in pairs_input if p.model == majority_cluster)

        return EntailResponse(
            all_agree=all_agree,
            majority_cluster=majority_text[:120],
            outliers=outliers,
        )

    return app


app = create_app()
