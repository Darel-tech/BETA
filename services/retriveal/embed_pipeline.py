
import os

import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from your .env file")

# Create 384-dimensional embeddings.
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def add_knowledge(text: str, source: str, entity_tag: str = "") -> int:
    """Create an embedding and save knowledge in Neon."""
    embedding = model.encode(text).tolist()

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO knowledge_chunks
                    (text, embedding, source, entity_tag)
                VALUES (%s, %s, %s, %s)
                RETURNING id;
                """,
                (text, embedding, source, entity_tag),
            )
            chunk_id = cur.fetchone()[0]

    return chunk_id


if __name__ == "__main__":
    knowledge_items = [
        {
            "text": "Neon is a cloud-hosted PostgreSQL database service.",
            "source": "beta_sample",
            "entity_tag": "database",
        },
        {
            "text": "PostgreSQL is an open-source relational database system.",
            "source": "beta_sample",
            "entity_tag": "database",
        },
        {
            "text": "An API allows different software applications to communicate.",
            "source": "beta_sample",
            "entity_tag": "api",
        },
        {
            "text": "Python is a programming language used in web development and data science.",
            "source": "beta_sample",
            "entity_tag": "programming",
        },
        {
            "text": "An embedding represents text as a list of numerical values.",
            "source": "beta_sample",
            "entity_tag": "machine_learning",
        },
    ]

    for item in knowledge_items:
        new_id = add_knowledge(
            text=item["text"],
            source=item["source"],
            entity_tag=item["entity_tag"],
        )
        print(
            f"Knowledge saved successfully. "
            f"Record ID: {new_id} | {item['entity_tag']}"
        )
