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
        Fuse vector, full-text, and exact-entity candidate ranks with RRF.
        The component rankings remain independent; this avoids comparing raw
        cosine distances with full-text scores, which have different scales.
        """
        entity_values = entities or []
        entity_query = " OR ".join(
            f'"{entity.replace(chr(34), "").strip()}"'
            for entity in entity_values
            if entity.strip()
        )
        async with get_connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                query = """
                    WITH vector_candidates AS (
                        SELECT id, ROW_NUMBER() OVER (ORDER BY distance, id) AS rank
                        FROM (
                            SELECT id, embedding <=> %s::vector AS distance
                            FROM knowledge_chunks
                            WHERE embedding IS NOT NULL
                            ORDER BY distance, id
                            LIMIT 40
                        ) AS nearest
                    ), full_text_candidates AS (
                        SELECT id, ROW_NUMBER() OVER (ORDER BY rank_score DESC, id) AS rank
                        FROM (
                            SELECT id, ts_rank_cd(
                                search_vector, websearch_to_tsquery('english', %s)
                            ) AS rank_score
                            FROM knowledge_chunks
                            WHERE search_vector @@ websearch_to_tsquery('english', %s)
                            ORDER BY rank_score DESC, id
                            LIMIT 40
                        ) AS text_matches
                    ), entity_candidates AS (
                        SELECT id, ROW_NUMBER() OVER (ORDER BY rank_score DESC, id) AS rank
                        FROM (
                            SELECT id, ts_rank_cd(
                                search_vector, websearch_to_tsquery('english', %s)
                            ) + CASE WHEN entity_tag = ANY(%s) THEN 1.0 ELSE 0.0 END AS rank_score
                            FROM knowledge_chunks
                            WHERE entity_tag = ANY(%s)
                               OR search_vector @@ websearch_to_tsquery('english', %s)
                            ORDER BY rank_score DESC, id
                            LIMIT 40
                        ) AS entity_matches
                    ), candidate_ids AS (
                        SELECT id FROM vector_candidates
                        UNION
                        SELECT id FROM full_text_candidates
                        UNION
                        SELECT id FROM entity_candidates
                    )
                    SELECT chunk.id, chunk.text, chunk.source, chunk.entity_tag,
                           COALESCE(1 - (chunk.embedding <=> %s::vector), 0) AS similarity
                    FROM candidate_ids AS candidate
                    JOIN knowledge_chunks AS chunk ON chunk.id = candidate.id
                    LEFT JOIN vector_candidates AS vector ON vector.id = chunk.id
                    LEFT JOIN full_text_candidates AS full_text ON full_text.id = chunk.id
                    LEFT JOIN entity_candidates AS entity ON entity.id = chunk.id
                    ORDER BY
                        (chunk.entity_tag = ANY(%s)) DESC,
                        COALESCE(1.0 / (60 + vector.rank), 0) +
                        COALESCE(1.0 / (60 + full_text.rank), 0) +
                        COALESCE(1.0 / (60 + entity.rank), 0) DESC,
                        similarity DESC,
                        chunk.id
                    LIMIT %s;
                """
                await cur.execute(
                    query,
                    (
                        query_embedding,
                        query,
                        query,
                        entity_query,
                        entity_values,
                        entity_values,
                        entity_query,
                        query_embedding,
                        entity_values,
                        k,
                    ),
                )
                return [dict(row) for row in await cur.fetchall()]

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
