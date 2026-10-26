import os
import pytest
from app.repositories.chunk_repository import ChunkRepository

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set; skipping integration test")
@pytest.mark.asyncio
async def test_pgvector_integration_search():
    from app.db import close_db_pool, init_db_pool

    await init_db_pool(TEST_DATABASE_URL, min_size=1, max_size=2)
    repo = ChunkRepository()
    try:
        ok = await repo.check_health()
        assert ok is True
    finally:
        await close_db_pool()
