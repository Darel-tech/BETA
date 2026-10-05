"""
The live service. Run locally with:
    uvicorn app:app --reload --port 8001

Security posture (read before deploying):
  - Every request to /v1/check must carry a correct X-Internal-Api-Key header.
    This is a service-to-service secret shared with the router (Ahamed's
    code), not a public API — never expose INTERNAL_API_KEY to a browser.
  - CORS is restricted to settings.allowed_origins — never "*" in production.
  - A simple in-memory rate limiter caps requests per client IP. This is
    sufficient for a single-process deployment (our Hugging Face Spaces
    target); if we ever scale to multiple instances, swap this for a
    Redis-backed limiter so limits are shared across processes.
  - All inputs are validated and length-capped by schemas.py before they
    ever reach the model, which protects the GPU from being starved by
    oversized or malformed payloads.
  - Internal errors are logged in full server-side but never leaked to the
    client — the client only ever sees a generic message plus a request id.
"""

from __future__ import annotations

import hmac
import logging
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from model_loader import ModelLoadError, is_loaded, load_model_and_sae
from sae_probe import ProbeNotCalibratedError, get_probe
from schemas import CheckRequest, CheckResponse, HealthResponse

settings = get_settings()

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("interpretability.app")

# Tracks whether startup actually succeeded, independent of whether the
# process is running — lets /health report a true "not ready" instead of
# the whole container crash-looping.
_startup_error: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_error
    try:
        loaded = load_model_and_sae()
        get_probe(loaded)  # fail fast at startup if the probe isn't calibrated,
        # rather than on the first real request a user sends.
        logger.info("Startup complete — model and probe ready.")
    except (ModelLoadError, ProbeNotCalibratedError) as exc:
        _startup_error = str(exc)
        logger.error("Startup did not fully succeed: %s", exc)
    yield
    logger.info("Shutting down interpretability service.")


app = FastAPI(
    title="BETA Interpretability Core",
    description="SAE-based known-ness detection for the BETA hallucination firewall.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["X-Internal-Api-Key", "Content-Type"],
)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
async def verify_internal_api_key(x_internal_api_key: str = Header(default="")) -> None:
    if settings.is_production and not settings.internal_api_key:
        # Never allow production to silently run with auth disabled.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Service misconfigured.")
    if not settings.internal_api_key:
        # Local development without a key configured — allowed, but logged loudly.
        logger.warning("INTERNAL_API_KEY is unset — running without auth. Do not deploy like this.")
        return
    # Constant-time comparison — a plain `==` here would leak timing
    # information that could help an attacker guess the key byte by byte.
    if not hmac.compare_digest(x_internal_api_key, settings.internal_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key.")


# --------------------------------------------------------------------------
# Minimal in-memory rate limiter (per-process; see module docstring)
# --------------------------------------------------------------------------
class SlidingWindowLimiter:
    def __init__(self, limit_per_minute: int):
        self.limit = limit_per_minute
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        window = self._hits[key]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self.limit:
            return False
        window.append(now)
        return True


_limiter = SlidingWindowLimiter(settings.rate_limit_per_minute)


async def enforce_rate_limit(request: Request) -> None:
    client_key = request.client.host if request.client else "unknown"
    if not _limiter.check(client_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok" if (_startup_error is None and is_loaded()) else "degraded",
        model_loaded=is_loaded(),
        probe_calibrated=_startup_error is None,
        device=get_settings().device,
    )


@app.post(
    "/v1/check",
    response_model=CheckResponse,
    dependencies=[Depends(verify_internal_api_key), Depends(enforce_rate_limit)],
)
async def check(payload: CheckRequest, request: Request) -> CheckResponse:
    request_id = str(uuid.uuid4())
    start = time.perf_counter()

    if _startup_error is not None:
        logger.error("[%s] Rejecting request — service not ready: %s", request_id, _startup_error)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Service not ready.")

    if len(payload.entities) > settings.max_entities:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Too many entities in one request.")

    try:
        loaded = load_model_and_sae()
        probe = get_probe(loaded)
        scores = probe.score_entities(payload.text, payload.entities)
    except Exception:
        # Full detail goes to the logs; the client gets a safe, generic error.
        logger.exception("[%s] Unhandled error during scoring", request_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal error processing request.")

    verdict, confidence, evidence = _decide(scores)

    latency_ms = int((time.perf_counter() - start) * 1000)
    logger.info("[%s] verdict=%s confidence=%.2f latency_ms=%d entities=%d",
                request_id, verdict, confidence, latency_ms, len(scores))

    return CheckResponse(verdict=verdict, confidence=confidence, evidence=evidence, latency_ms=latency_ms)


def _decide(scores: list) -> tuple[str, float, list[str]]:
    """
    Combines per-entity known-ness scores into one overall verdict.
    Thresholds come from config — recalibrate them from real evaluation
    data rather than hand-tuning against a handful of examples.
    """
    if not scores:
        # No recognizable entities to check — we have no basis to flag
        # anything, so default to trustworthy rather than invent a signal.
        return "trustworthy", 0.5, ["No entities found to check."]

    min_score = min(s.known_ness for s in scores)
    worst = min(scores, key=lambda s: s.known_ness)

    if min_score >= settings.threshold_trustworthy:
        return "trustworthy", min_score, [f"All checked entities scored above the trustworthy threshold (lowest: {worst.entity})."]
    if min_score >= settings.threshold_uncertain_low:
        return "uncertain", min_score, [f"'{worst.entity}' scored in the uncertain range ({min_score:.2f})."]
    return "needs_correction", min_score, [f"'{worst.entity}' scored low on the known-ness probe ({min_score:.2f}) — likely unfamiliar to the model."]


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Last-resort catch-all so a bug never leaks a stack trace to a client.
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})