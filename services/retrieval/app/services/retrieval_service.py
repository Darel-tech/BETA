import json
import logging
import time
from typing import Any

from app.adapters.cache import Cache
from app.adapters.embedder import Embedder
from app.adapters.quantizer import Quantizer
from app.repositories.chunk_repository import ChunkRepository
from app.schemas import FactMatch, RetrieveResponse

logger = logging.getLogger(__name__)


class RetrievalService:
    """
    Business logic for vector search, fact retrieval, caching, and entity boosting.
    """

    def __init__(
        self,
        embedder: Embedder,
        repository: ChunkRepository,
        quantizer: Quantizer,
        cache: Cache,
    ) -> None:
        self.embedder = embedder
        self.repository = repository
        self.quantizer = quantizer
        self.cache = cache

    def _cache_key(self, query: str, entities: list[str] | None, k: int) -> str:
        norm_entities = sorted(entities) if entities else []
        return f"retrieve:{query.strip()}:{','.join(norm_entities)}:{k}"

    async def retrieve(
        self,
        query: str,
        entities: list[str] | None = None,
        k: int = 5,
    ) -> RetrieveResponse:
        start_time = time.perf_counter()

        cache_key = self._cache_key(query, entities, k)
        cached_result = self.cache.get(cache_key)
        if cached_result is not None:
            latency_ms = max(1, int((time.perf_counter() - start_time) * 1000))
            cached_result["latency_ms"] = latency_ms
            return RetrieveResponse(**cached_result)

        # 1. Embed query
        query_vector = self.embedder.embed_text(query)

        # 2. Search database
        rows = await self.repository.search_similar(
            query_embedding=query_vector,
            k=k,
            entities=entities,
        )

        facts: list[str] = []
        matches: list[FactMatch] = []

        for r in rows:
            text = r["text"].strip()
            facts.append(text)
            matches.append(
                FactMatch(
                    id=r["id"],
                    score=round(float(r["similarity"]), 4),
                    source=r.get("source"),
                    entity_tag=r.get("entity_tag"),
                )
            )

        latency_ms = max(1, int((time.perf_counter() - start_time) * 1000))
        response = RetrieveResponse(
            facts=facts,
            latency_ms=latency_ms,
            matches=matches,
        )

        # Cache response
        self.cache.set(cache_key, response.model_dump())
        return response
