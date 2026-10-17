# BETA Retrieval Service Architecture

The retrieval service stores knowledge facts in PostgreSQL with pgvector, retrieves
relevant facts, and prepares evidence-based corrections. Its existing HTTP contract
is provided by `/health`, `/retrieve`, and `/correct` in `app.py`.

## Components

- `embed_pipeline.py` creates embeddings and stores knowledge.
- `retrieve.py` retrieves facts by vector similarity.
- `correction.py` prepares responses from supplied facts.
- `app.py` exposes the FastAPI endpoints.

## Configuration and deployment

Set `DATABASE_URL` in the process environment or a local `.env` file. Never commit
the local file or include it in a container image. Build from this directory with
`docker build -t beta-retrieval .`; the image starts the API on port 8000.

## Testing

Run `python -m pytest tests -q` from this directory.
