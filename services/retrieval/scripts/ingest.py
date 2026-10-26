"""
Batched, idempotent knowledge ingestion script.
Accepts JSONL or CSV files containing: text, source, entity_tag.
"""
import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path

# Add services/retrieval root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.adapters.embedder import SentenceTransformerEmbedder
from app.config import settings
from app.db import close_db_pool, init_db_pool
from app.repositories.chunk_repository import ChunkRepository
from app.services.ingestion_service import IngestionService


def load_items_from_file(file_path: Path) -> list[dict[str, str]]:
    items = []
    suffix = file_path.suffix.lower()

    if suffix == ".jsonl":
        with file_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    data = json.loads(line)
                    if "text" in data and data["text"].strip():
                        items.append({
                            "text": data["text"].strip(),
                            "source": data.get("source", "seed"),
                            "entity_tag": data.get("entity_tag", ""),
                        })
    elif suffix == ".csv":
        with file_path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                text = row.get("text", "").strip()
                if text:
                    items.append({
                        "text": text,
                        "source": row.get("source", "seed"),
                        "entity_tag": row.get("entity_tag", ""),
                    })
    else:
        raise ValueError(f"Unsupported file format: {suffix}. Expected .jsonl or .csv")

    return items


async def main():
    parser = argparse.ArgumentParser(description="Ingest knowledge chunks into BETA Neon Postgres knowledge store.")
    parser.add_argument("--file", type=str, help="Path to .jsonl or .csv file with knowledge chunks")
    parser.add_argument("--batch-size", type=int, default=64, help="Embedding and ingestion batch size")
    args = parser.parse_args()

    # If no file provided, produce a seed dataset of reference facts
    if not args.file:
        print("[*] No file specified, using curated seed reference facts...")
        items = [
            {"text": "Neon is a serverless, cloud-hosted PostgreSQL database service with branching.", "source": "docs", "entity_tag": "database"},
            {"text": "PostgreSQL is an open-source object-relational database management system.", "source": "docs", "entity_tag": "database"},
            {"text": "pgvector is a vector similarity search extension for PostgreSQL.", "source": "docs", "entity_tag": "vector_search"},
            {"text": "all-MiniLM-L6-v2 produces 384-dimensional dense semantic sentence embeddings.", "source": "ml_docs", "entity_tag": "machine_learning"},
            {"text": "FastAPI is a modern, fast web framework for building APIs with Python 3.8+ based on standard type hints.", "source": "docs", "entity_tag": "api"},
            {"text": "BETA is a hallucination detection and correction system utilizing interpretability probes and blackbox detectors.", "source": "beta_spec", "entity_tag": "beta_project"},
        ]
    else:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"[!] File not found: {file_path}")
            return
        items = load_items_from_file(file_path)

    print(f"[*] Loaded {len(items)} items for ingestion.")

    embedder = SentenceTransformerEmbedder(
        model_name=settings.EMBEDDING_MODEL,
        expected_dim=settings.EMBEDDING_DIMENSION,
    )
    repo = ChunkRepository()
    service = IngestionService(embedder, repo, model_name=settings.EMBEDDING_MODEL)

    await init_db_pool(
        conninfo=settings.DATABASE_URL,
        min_size=settings.DB_POOL_MIN_SIZE,
        max_size=settings.DB_POOL_MAX_SIZE,
    )

    try:
        total_inserted = 0
        batch_size = args.batch_size
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            inserted = await service.ingest_batch(batch)
            total_inserted += inserted
            print(f"  Processed batch {i // batch_size + 1}: inserted {inserted} new chunks.")

        total_chunks = await repo.count_chunks()
        print(f"[✓] Ingestion complete. Inserted {total_inserted} new chunks. Total knowledge chunks in DB: {total_chunks}")
    finally:
        await close_db_pool()


if __name__ == "__main__":
    asyncio.run(main())
