
import os

import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from your .env file")

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def retrieve_knowledge(query: str, k: int = 5) -> list[dict]:
    """Find the most relevant knowledge stored in Neon."""

    query_embedding = model.encode(query).tolist()

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:

            # Check database and record count.
            cur.execute(
                """
                SELECT current_database(), current_user,
                       (SELECT COUNT(*) FROM knowledge_chunks),
                       (SELECT COUNT(embedding) FROM knowledge_chunks);
                """
            )
            print("Database diagnostic:", cur.fetchone())

            # Use exact search instead of the approximate vector index.
            cur.execute("SET LOCAL enable_indexscan = off;")
            cur.execute("SET LOCAL enable_bitmapscan = off;")

            # Retrieve the most relevant knowledge.
            cur.execute(
                """
                SELECT id, text, source, entity_tag,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM knowledge_chunks
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector
                LIMIT %s;
                """,
                (query_embedding, query_embedding, k),
            )

            rows = cur.fetchall()
            print("Number of rows retrieved:", len(rows))


    return [
        {
            "id": row[0],
            "text": row[1],
            "source": row[2],
            "entity_tag": row[3],
            "similarity": float(row[4]),
        }
        for row in rows
    ]


if __name__ == "__main__":
    question = input("Enter your question: ")

    results = retrieve_knowledge(question)

    if not results:
        print("No knowledge found in the database.")
    else:
        for item in results:
            print(f"\nRecord ID: {item['id']}")
            print(f"Text: {item['text']}")
            print(f"Source: {item['source']}")
            print(f"Entity tag: {item['entity_tag']}")
            print(f"Similarity: {item['similarity']:.4f}")
