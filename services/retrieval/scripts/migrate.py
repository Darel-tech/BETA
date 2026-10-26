"""
Database migration runner for Neon PostgreSQL.
Executes pending SQL migrations in ascending order using direct connection.
"""
import os
import sys
from pathlib import Path
import psycopg
from dotenv import load_dotenv

# Add app to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings

load_dotenv()


def run_migrations():
    db_url = settings.DATABASE_URL_DIRECT or settings.DATABASE_URL
    if not db_url or "localhost" in db_url:
        print("[!] No active remote DATABASE_URL configured. Skipping database migration.")
        return

    migrations_dir = Path(__file__).resolve().parent.parent.parent.parent / "infra" / "db" / "migrations"
    if not migrations_dir.exists():
        print(f"[!] Migrations directory not found at {migrations_dir}")
        return

    sql_files = sorted(migrations_dir.glob("*.sql"))
    print(f"[*] Found {len(sql_files)} migration files in {migrations_dir}")

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            # Create schema migration tracker if not exists
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(255) PRIMARY KEY,
                    applied_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()

            cur.execute("SELECT version FROM schema_migrations;")
            applied = {row[0] for row in cur.fetchall()}

            for sql_file in sql_files:
                if sql_file.name in applied:
                    print(f"  [-] Already applied: {sql_file.name}")
                    continue

                print(f"  [+] Applying migration: {sql_file.name}...")
                content = sql_file.read_text(encoding="utf-8")
                cur.execute(content)
                cur.execute("INSERT INTO schema_migrations (version) VALUES (%s);", (sql_file.name,))
                conn.commit()
                print(f"  [✓] Applied {sql_file.name}")

    print("[✓] All migrations successfully verified.")


if __name__ == "__main__":
    run_migrations()
