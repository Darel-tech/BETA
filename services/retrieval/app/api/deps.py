import hmac
import time
from collections import defaultdict
from fastapi import Header, HTTPException, Request, status

from app.adapters.cache import Cache, InMemoryTTLCache
from app.adapters.embedder import Embedder, SentenceTransformerEmbedder
from app.adapters.llm_client import HttpLLMClient, LLMClient, MockLLMClient
from app.adapters.quantizer import Quantizer, get_quantizer
from app.config import settings
from app.repositories.chunk_repository import ChunkRepository
from app.services.correction_service import CorrectionService
from app.services.retrieval_service import RetrievalService

# In-memory rate limiting sliding window tracker
_rate_limit_records: dict[str, list[float]] = defaultdict(list)

# Global singletons initialized during lifespan
_embedder_instance: Embedder | None = None
_cache_instance: Cache = InMemoryTTLCache(default_ttl=settings.CACHE_TTL_SECONDS)
_repository_instance: ChunkRepository = ChunkRepository()
_quantizer_instance: Quantizer = get_quantizer(settings.QUANTIZATION_MODE)
_llm_client_instance: LLMClient | None = None


def get_embedder() -> Embedder:
    global _embedder_instance
    if _embedder_instance is None:
        _embedder_instance = SentenceTransformerEmbedder(
            model_name=settings.EMBEDDING_MODEL,
            expected_dim=settings.EMBEDDING_DIMENSION,
        )
    return _embedder_instance


def set_embedder(embedder: Embedder) -> None:
    global _embedder_instance
    _embedder_instance = embedder


def get_repository() -> ChunkRepository:
    return _repository_instance


def get_quantizer_dep() -> Quantizer:
    return _quantizer_instance


def get_cache() -> Cache:
    return _cache_instance


def get_llm_client() -> LLMClient:
    global _llm_client_instance
    if _llm_client_instance is None:
        if settings.LLM_API_KEY:
            _llm_client_instance = HttpLLMClient(
                base_url=settings.LLM_BASE_URL,
                model=settings.LLM_MODEL,
                api_key=settings.LLM_API_KEY,
                timeout_seconds=settings.LLM_TIMEOUT_SECONDS,
                max_tokens=settings.LLM_MAX_TOKENS,
            )
        else:
            _llm_client_instance = MockLLMClient()
    return _llm_client_instance


def set_llm_client(client: LLMClient) -> None:
    global _llm_client_instance
    _llm_client_instance = client


from fastapi import Depends


def get_retrieval_service(
    embedder: Embedder = Depends(get_embedder),
    repository: ChunkRepository = Depends(get_repository),
    quantizer: Quantizer = Depends(get_quantizer_dep),
    cache: Cache = Depends(get_cache),
) -> RetrievalService:
    return RetrievalService(
        embedder=embedder,
        repository=repository,
        quantizer=quantizer,
        cache=cache,
    )


def get_correction_service(
    llm_client: LLMClient = Depends(get_llm_client),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
) -> CorrectionService:
    return CorrectionService(
        llm_client=llm_client,
        retrieval_service=retrieval_service,
    )


async def verify_internal_api_key(
    x_internal_api_key: str | None = Header(None, alias="X-Internal-Api-Key"),
) -> None:
    """
    Authenticate internal service-to-service requests using timing-safe comparison.
    """
    if not settings.INTERNAL_API_KEY and settings.ENVIRONMENT == "production":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfiguration: INTERNAL_API_KEY is unset in production",
        )

    if not x_internal_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing required header: X-Internal-Api-Key",
        )

    expected_key = settings.INTERNAL_API_KEY.encode("utf-8")
    provided_key = x_internal_api_key.encode("utf-8")

    if not hmac.compare_digest(expected_key, provided_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid X-Internal-Api-Key",
        )


async def check_rate_limit(request: Request) -> None:
    """
    In-memory per-client IP rate limiting.
    """
    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = 60.0  # 1 minute window

    # Purge timestamps older than 60 seconds
    timestamps = [t for t in _rate_limit_records[client_ip] if now - t < window]
    if len(timestamps) >= settings.RATE_LIMIT_REQUESTS_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Try again in a minute.",
        )

    timestamps.append(now)
    _rate_limit_records[client_ip] = timestamps
