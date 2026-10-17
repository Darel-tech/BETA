CREATE TABLE knowledge_chunks (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    embedding vector(384),
    source TEXT,
    entity_tag TEXT
);

CREATE INDEX ON knowledge_chunks
USING ivfflat (embedding vector_cosine_ops);