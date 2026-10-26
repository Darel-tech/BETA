import logging
from typing import Any

from app.adapters.embedder import Embedder
from app.repositories.chunk_repository import ChunkRepository

logger = logging.getLogger(__name__)


class IngestionService:
    """
    Service for batched, idempotent ingestion of reference knowledge chunks.
    """

    def __init__(
        self,
        embedder: Embedder,
        repository: ChunkRepository,
        model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> None:
        self.embedder = embedder
        self.repository = repository
        self.model_name = model_name

    async def ingest_batch(self, items: list[dict[str, Any]]) -> int:
        """
        Embed and insert knowledge items in a batch.
        Deduplication is guaranteed via content_hash.
        """
        if not items:
            return 0

        texts = [item["text"].strip() for item in items]
        embeddings = self.embedder.embed_batch(texts)

        chunks_to_insert = []
        for item, emb in zip(items, embeddings):
            chunks_to_insert.append({
                "text": item["text"].strip(),
                "embedding": emb,
                "source": item.get("source"),
                "entity_tag": item.get("entity_tag"),
            })

        inserted_count = await self.repository.insert_chunks_batch(
            chunks_to_insert,
            embedding_model=self.model_name,
        )
        return inserted_count
