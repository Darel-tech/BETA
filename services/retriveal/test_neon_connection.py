import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# Find the .env file in the BETA project folder
project_folder = Path(__file__).resolve().parents[2]
load_dotenv(project_folder / ".env")

database_url = os.getenv("DATABASE_URL")

if not database_url:
    print("DATABASE_URL not found. Check your .env file.")
else:
    try:
        with psycopg.connect(database_url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database(), current_user")
                result = cur.fetchone()

        print("Neon connection successful!")
        print("Database:", result[0])
        print("User:", result[1])

    except Exception as error:
        print("Connection failed:", type(error).__name__)
        print(error)