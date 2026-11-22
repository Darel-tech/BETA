"""Run the retrieval API on its port expected by the local web app."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
os.chdir(SERVICE_ROOT)
sys.path.insert(0, str(SERVICE_ROOT))

if sys.platform == "win32":
    # Psycopg's async driver does not support Windows' default Proactor loop.
    import uvicorn.loops.asyncio

    uvicorn.loops.asyncio.asyncio_loop_factory = lambda use_subprocess=False: asyncio.SelectorEventLoop

import uvicorn

from app.config import settings


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        loop="asyncio",
    )
