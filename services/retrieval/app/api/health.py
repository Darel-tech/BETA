from fastapi import APIRouter, Depends

from app.api.deps import get_embedder, get_repository
from app.config import settings
from app.repositories.chunk_repository import ChunkRepository
from app.schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check for DB connectivity, embedder status, and chunk count",
)
async def get_health(
    repository: ChunkRepository = Depends(get_repository),
) -> HealthResponse:
    db_ok = await repository.check_health()
    chunk_count = 0
    if db_ok:
        try:
            chunk_count = await repository.count_chunks()
        except Exception:
            db_ok = False

    embedder_loaded = False
    try:
        embedder = get_embedder()
        embedder_loaded = embedder is not None and embedder.dimension == settings.EMBEDDING_DIMENSION
    except Exception:
        embedder_loaded = False

    overall_status = "ok" if (db_ok and embedder_loaded) else "degraded"

    return HealthResponse(
        status=overall_status,
        db="ok" if db_ok else "down",
        embedder_loaded=embedder_loaded,
        knowledge_chunks_count=chunk_count,
        version=settings.VERSION,
    )
