# Database Schema Notes

This document provides a plain-English reference for all tables and extensions managed within the BETA database.

---

## PostgreSQL Extensions

### `vector` (`0001_enable_pgvector.sql`)
- Enables vector storage, indexing, and similarity search distance operators (`<=>` for cosine distance, `<->` for L2 Euclidean distance, `<#>` for negative inner product) in Postgres via the `pgvector` extension.

---

## Tables

### `knowledge_chunks` (`0003_knowledge_chunks.sql` & `0006_retrieval_knowledge_chunks_enhancements.sql`)
The central factual reference library used by the retrieval-grounded correction pipeline to store source-grounded evidence chunks and verify/correct AI model outputs.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing unique identifier for each knowledge chunk. |
| `text` | `TEXT NOT NULL` | Raw reference text / factual passage used for evidence grounding. |
| `embedding` | `vector(384)` | 384-dimensional dense vector representation produced by `sentence-transformers/all-MiniLM-L6-v2`. |
| `source` | `TEXT` | Provenance / origin reference (e.g. documentation name, URL, or dataset identifier). |
| `entity_tag` | `TEXT` | Categorical topic or entity descriptor (e.g., `database`, `api`, `company`). |
| `content_hash` | `VARCHAR(64) UNIQUE` | SHA-256 hash of `text` + `source` + `entity_tag` ensuring idempotent ingestion and preventing duplicates. |
| `embedding_model` | `VARCHAR(128)` | Model identifier used to generate the embedding (defaults to `'sentence-transformers/all-MiniLM-L6-v2'`). Enables safe versioning and future model migrations without dropping historical records. |
| `created_at` | `TIMESTAMPTZ` | Timestamp when the chunk was inserted (defaults to `NOW()`). |

#### Indexes
1. `idx_knowledge_chunks_embedding_hnsw` (`USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`):
   - **Justification**: Hierarchical Navigable Small World (HNSW) provides logarithmic search complexity, superior recall@k (typically >98% recall at low search latency), and does not degrade with new un-clustered inserts like IVFFlat (which requires pre-training centroids). `m=16` and `ef_construction=64` strike a strong balance between build memory and recall speed.
2. `idx_knowledge_chunks_entity_tag` (`USING btree (entity_tag)`):
   - Fast B-tree index supporting exact entity filtering and entity-boost queries.
