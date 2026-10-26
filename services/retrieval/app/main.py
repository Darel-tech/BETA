import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.correct import router as correct_router
from app.api.deps import get_embedder
from app.api.health import router as health_router
from app.api.retrieve import router as retrieve_router
from app.config import settings
from app.db import close_db_pool, init_db_pool

# Structured logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)
logger = logging.getLogger("retrieval_service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: validate settings and warm embedder
    if settings.ENVIRONMENT == "production" and not settings.INTERNAL_API_KEY:
        raise RuntimeError("CRITICAL: INTERNAL_API_KEY must be set in production mode")

    logger.info(f"Initializing embedder: {settings.EMBEDDING_MODEL} (dim={settings.EMBEDDING_DIMENSION})")
    try:
        embedder = get_embedder()
        assert embedder.dimension == settings.EMBEDDING_DIMENSION, (
            f"Embedder dimension mismatch: {embedder.dimension} != {settings.EMBEDDING_DIMENSION}"
        )
        logger.info("Embedder initialized and dimension verified successfully.")
    except Exception as e:
        logger.warning(f"Embedder could not be loaded immediately: {e}")

    # Initialize connection pool if a database URL is present
    if settings.DATABASE_URL and "localhost" not in settings.DATABASE_URL:
        try:
            await init_db_pool(
                conninfo=settings.DATABASE_URL,
                min_size=settings.DB_POOL_MIN_SIZE,
                max_size=settings.DB_POOL_MAX_SIZE,
                timeout=settings.DB_TIMEOUT_SECONDS,
            )
            logger.info("Database connection pool initialized.")
        except Exception as e:
            logger.error(f"Failed to initialize database pool at startup: {e}")

    yield

    # Shutdown
    await close_db_pool()
    logger.info("Database connection pool closed.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="BETA Retrieval & Grounded Correction Service",
        description="Knowledge store vector search and source-grounded hallucination correction pipeline",
        version=settings.VERSION,
        lifespan=lifespan,
    )

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Internal-Api-Key", "X-Request-ID"],
    )

    # Request ID and structured request logging middleware
    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        start_time = time.perf_counter()

        # Enforce maximum body size protection (64 KB)
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 65536:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"detail": "Request body exceeds maximum allowed size (64KB)"},
            )

        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["X-Request-ID"] = request_id

        logger.info(
            f"request_id={request_id} method={request.method} path={request.url.path} "
            f"status={response.status_code} duration_ms={duration_ms}"
        )
        return response

    # Global unhandled exception handler (avoids leaking stack traces)
    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        logger.error(f"Unhandled server error on {request.url.path}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal server error occurred. Please contact the administrator."},
        )

    # Mount routers at root level
    app.include_router(health_router)
    app.include_router(retrieve_router)
    app.include_router(correct_router)

    # Mount identical routers under /v1 for versioning
    app.include_router(health_router, prefix="/v1")
    app.include_router(retrieve_router, prefix="/v1")
    app.include_router(correct_router, prefix="/v1")

    return app


app = create_app()
