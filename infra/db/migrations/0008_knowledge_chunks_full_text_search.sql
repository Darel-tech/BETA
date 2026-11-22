-- 0008_knowledge_chunks_full_text_search.sql
-- Add an indexed full-text representation for hybrid retrieval.
-- Strictly additive: existing passage text and embeddings are preserved.

ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(entity_tag, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(source, '')), 'A') ||
        setweight(to_tsvector('english', text), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_search_vector
    ON knowledge_chunks USING GIN (search_vector);
