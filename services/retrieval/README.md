# BETA Retrieval & Correction Microservice

A production-grade, self-contained microservice providing:
1. **Knowledge Store** with Neon PostgreSQL + `pgvector`
2. **Dense Vector Embeddings** via `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions)
3. **Quantization** support (FP32 baseline, Int8 scalar quantization, Binary quantization)
4. **`/retrieve` endpoint**: Cosine similarity top-k search with optional entity filtering and response caching
5. **`/correct` endpoint**: Source-grounded re-prompting with strict prompt-injection defenses and citations
6. **`/health` endpoint**: Health checks for database connectivity, embedder status, and chunk count

## API Contract

All requests except `/health` require the `X-Internal-Api-Key` header matching `INTERNAL_API_KEY`.

### 1. `POST /retrieve` (also mounted at `/v1/retrieve`)
Request:
```json
{
  "query": "What is Neon PostgreSQL?",
  "entities": ["database"],
  "k": 5
}
```
Response:
```json
{
  "facts": [
    "Neon is a serverless, cloud-hosted PostgreSQL database service with vector search capabilities."
  ],
  "latency_ms": 14,
  "matches": [
    {
      "id": 1,
      "score": 0.8921,
      "source": "neon_docs",
      "entity_tag": "database"
    }
  ]
}
```

### 2. `POST /correct` (also mounted at `/v1/correct`)
Request:
```json
{
  "original_question": "What kind of database is Neon?",
  "flagged_answer": "Neon is a NoSQL document database.",
  "facts": [
    "Neon is a serverless, cloud-hosted PostgreSQL database service."
  ]
}
```
Response:
```json
{
  "corrected_answer": "Neon is a serverless PostgreSQL database service, not a NoSQL database.",
  "used_facts": [
    "Neon is a serverless, cloud-hosted PostgreSQL database service."
  ]
}
```

### 3. `GET /health` (also mounted at `/v1/health`)
Response:
```json
{
  "status": "ok",
  "db": "ok",
  "embedder_loaded": true,
  "knowledge_chunks_count": 250,
  "version": "1.0.0"
}
```

## Running Locally

1. Create a virtual environment and install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your Neon DATABASE_URL and INTERNAL_API_KEY
   ```
3. Run migrations:
   ```bash
   python scripts/migrate.py
   ```
4. Ingest sample knowledge facts:
   ```bash
   python scripts/ingest.py --file sample_facts.jsonl
   ```
5. Start service:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

## Running Tests & Benchmarks
```bash
pytest tests/unit
python scripts/benchmark_storage.py
```
