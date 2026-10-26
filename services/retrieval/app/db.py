import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg_pool import AsyncConnectionPool
from pgvector.psycopg import register_vector_async

logger = logging.getLogger(__name__)

_pool: AsyncConnectionPool | None = None


async def _init_connection(conn) -> None:
    """Register pgvector types on each connection checked out from the pool."""
    await register_vector_async(conn)


async def init_db_pool(
    conninfo: str,
    min_size: int = 2,
    max_size: int = 10,
    timeout: float = 10.0,
) -> AsyncConnectionPool:
    global _pool
    if _pool is not None:
        return _pool

    logger.info("Initializing async database connection pool...")
    _pool = AsyncConnectionPool(
        conninfo=conninfo,
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        configure=_init_connection,
        open=False,
    )
    await _pool.open()
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        logger.info("Closing database connection pool...")
        await _pool.close()
        _pool = None


def get_db_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("Database connection pool is not initialized")
    return _pool


@asynccontextmanager
async def get_connection() -> AsyncIterator:
    pool = get_db_pool()
    async with pool.connection() as conn:
        yield conn
