import hashlib
from typing import Any
from psycopg.rows import dict_row

from app.db import get_connection


def compute_content_hash(text: str, source: str | None, entity_tag: str | None) -> str:
    """Compute SHA-256 content hash for idempotent chunk deduplication."""
    hasher = hashlib.sha256()
    hasher.update(text.strip().encode("utf-8"))
    hasher.update((source or "").strip().encode("utf-8"))
    hasher.update((entity_tag or "").strip().encode("utf-8"))
    return hasher.hexdigest()


class ChunkRepository:
    """
    Data access layer for knowledge_chunks table in PostgreSQL / Neon with pgvector.
    ALL SQL lives here and is strictly parameterized.
    """

    async def search_similar(
        self,
        query_embedding: list[float],
        k: int = 5,
        entities: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Cosine similarity search via pgvector operator <=>.
        Cosine distance d = embedding <=> query_embedding.
        Cosine similarity = 1 - d.
        Order is deterministic: similarity DESC, id ASC.
        """
        async with get_connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                # If entities are provided, filter or boost by entity_tag
                if entities:
                    query = """
                        SELECT id, text, source, entity_tag,
                               1 - (embedding <=> %s::vector) AS similarity
                        FROM knowledge_chunks
                        WHERE embedding IS NOT NULL
                          AND entity_tag = ANY(%s)
                        ORDER BY embedding <=> %s::vector, id ASC
                        LIMIT %s;
                    """
                    await cur.execute(query, (query_embedding, entities, query_embedding, k))
                    rows = await cur.fetchall()

                    # Fallback if filtered results are fewer than requested k
                    if len(rows) < k:
                        remaining_k = k - len(rows)
                        existing_ids = [r["id"] for r in rows] if rows else [-1]
                        fallback_query = """
                            SELECT id, text, source, entity_tag,
                                   1 - (embedding <=> %s::vector) AS similarity
                            FROM knowledge_chunks
                            WHERE embedding IS NOT NULL
                              AND id != ALL(%s)
                            ORDER BY embedding <=> %s::vector, id ASC
                            LIMIT %s;
                        """
                        await cur.execute(fallback_query, (query_embedding, existing_ids, query_embedding, remaining_k))
                        fallback_rows = await cur.fetchall()
                        rows.extend(fallback_rows)
                else:
                    query = """
                        SELECT id, text, source, entity_tag,
                               1 - (embedding <=> %s::vector) AS similarity
                        FROM knowledge_chunks
                        WHERE embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector, id ASC
                        LIMIT %s;
                    """
                    await cur.execute(query, (query_embedding, query_embedding, k))
                    rows = await cur.fetchall()

                return [dict(row) for row in rows]

    async def insert_chunk(
        self,
        text: str,
        embedding: list[float],
        source: str | None = None,
        entity_tag: str | None = None,
        embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> int | None:
        """Insert a single knowledge chunk with idempotent content_hash deduplication."""
        content_hash = compute_content_hash(text, source, entity_tag)
        query = """
            INSERT INTO knowledge_chunks (text, embedding, source, entity_tag, content_hash, embedding_model)
            VALUES (%s, %s::vector, %s, %s, %s, %s)
            ON CONFLICT (content_hash) DO NOTHING
            RETURNING id;
        """
        async with get_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    query,
                    (text, embedding, source, entity_tag, content_hash, embedding_model),
                )
                row = await cur.fetchone()
                return row[0] if row else None

    async def insert_chunks_batch(
        self,
        chunks: list[dict[str, Any]],
        embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> int:
        """Batch insert knowledge chunks using executemany for high throughput."""
        if not chunks:
            return 0

        params = []
        for c in chunks:
            text = c["text"]
            source = c.get("source")
            entity_tag = c.get("entity_tag")
            embedding = c["embedding"]
            content_hash = compute_content_hash(text, source, entity_tag)
            params.append((text, embedding, source, entity_tag, content_hash, embedding_model))

        query = """
            INSERT INTO knowledge_chunks (text, embedding, source, entity_tag, content_hash, embedding_model)
            VALUES (%s, %s::vector, %s, %s, %s, %s)
            ON CONFLICT (content_hash) DO NOTHING;
        """
        async with get_connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(query, params)
                return cur.rowcount

    async def count_chunks(self) -> int:
        """Count total stored knowledge chunks."""
        query = "SELECT COUNT(*) FROM knowledge_chunks;"
        async with get_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query)
                row = await cur.fetchone()
                return row[0] if row else 0

    async def check_health(self) -> bool:
        """Check database ping with a fast SELECT 1."""
        query = "SELECT 1;"
        try:
            async with get_connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(query)
                    row = await cur.fetchone()
                    return bool(row and row[0] == 1)
        except Exception:
            return False
