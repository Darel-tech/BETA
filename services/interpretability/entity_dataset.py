"""
Builds and persists the known/unknown entity ground-truth set used to
calibrate the probe (scripts/train_probe.py) and to evaluate it.

Security note: every database write in this file uses parameterized queries
(the `%s` placeholders below) — never f-strings or `.format()` into SQL.
That's not a style preference, it's what prevents SQL injection even though
these inputs are currently "trusted" seed data; the moment this function is
reused with any external input, the protection is already in place.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager

from config import get_settings

logger = logging.getLogger("interpretability.entity_dataset")

# Small curated seed lists. Expand these from a real Wikipedia pageview
# frequency table before running a full calibration — this seed set is
# enough to validate the pipeline end to end, not a finished dataset.
SEED_KNOWN_ENTITIES: list[str] = [
    "Albert Einstein", "Marie Curie", "Leonardo da Vinci", "Isaac Newton",
    "William Shakespeare", "Mahatma Gandhi", "Nelson Mandela", "Barack Obama",
    "Elon Musk", "Steve Jobs", "Paris", "Tokyo", "Mount Everest", "The Great Wall of China",
    "Amazon River", "World War II", "The French Revolution", "Python (programming language)",
    "The Eiffel Tower", "Taj Mahal",
]

# Synthetic / genuinely obscure — the model should NOT have reliable
# knowledge of these. Mix of invented names and real but very low-salience
# entities is intentional; keep expanding this list as you calibrate.
SEED_UNKNOWN_ENTITIES: list[str] = [
    "Dr. Felix Hargrove-Mencken", "The Verdant Accord of Tessaly",
    "Lysandra Okafor-Whitmore", "the Blackhollow Treaty of 1884",
    "Corvin Thistlewood", "the Pallid Meridian Society", "Aurelio Vance-Kettering",
    "the Minor Vellican Dynasty", "Serenity Okwuosa-Ferreira", "the Thornfield Accords",
]


def get_seed_dataset() -> list[tuple[str, bool]]:
    """Returns list of (entity, known_flag) pairs."""
    rows = [(e, True) for e in SEED_KNOWN_ENTITIES]
    rows += [(e, False) for e in SEED_UNKNOWN_ENTITIES]
    return rows


@contextmanager
def _db_connection():
    """
    Lazily imports psycopg2 so this module can be imported (and the seed
    lists used) even in environments without the database driver installed,
    e.g. a quick local experiment.
    """
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to your .env — see .env.example. "
            "Never hardcode a connection string in source."
        )
    import psycopg2

    conn = psycopg2.connect(settings.database_url, connect_timeout=10)
    try:
        yield conn
    finally:
        conn.close()


def write_entities_to_db(rows: list[tuple[str, bool]], source: str = "darel_seed_v1") -> int:
    """
    Upserts entity labels. Uses `ON CONFLICT` so re-running this script is
    always safe — no duplicate rows, no manual cleanup needed.
    """
    inserted = 0
    with _db_connection() as conn:
        with conn.cursor() as cur:
            for entity, known_flag in rows:
                # Parameterized query — psycopg2 handles escaping. Never
                # build this string with f"... {entity} ..." instead.
                cur.execute(
                    """
                    INSERT INTO entity_labels (entity, known_flag, source)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (entity) DO UPDATE
                        SET known_flag = EXCLUDED.known_flag,
                            source = EXCLUDED.source
                    """,
                    (entity, known_flag, source),
                )
                inserted += 1
        conn.commit()
    logger.info("Upserted %d entity rows", inserted)
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    dataset = get_seed_dataset()
    count = write_entities_to_db(dataset)
    print(f"Wrote {count} entity labels to the database.")