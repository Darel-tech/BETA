-- Migration: 0006_retrieval_knowledge_chunks_enhancements.sql
-- Description: Enhance knowledge_chunks with content_hash deduplication, embedding_model tracking,
--              created_at timestamp, HNSW cosine index for approximate nearest neighbors,
--              and B-tree index on entity_tag.
-- Migration rules: Append-only, never modifies previous migrations (0001, 0003).

ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) UNIQUE,
    ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(128) DEFAULT 'sentence-transformers/all-MiniLM-L6-v2',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Create HNSW index for fast approximate nearest neighbor search under cosine distance.
-- HNSW provides superior recall@k and lower query latency compared to IVFFlat without requiring a training step.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
    ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- B-Tree index on entity_tag for high-efficiency entity filtering and metadata lookups.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_entity_tag
    ON knowledge_chunks (entity_tag);
