import time
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Cache(Protocol):
    """Protocol for short-lived response caching."""

    def get(self, key: str) -> Any | None:
        ...

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        ...


class InMemoryTTLCache:
    """Thread-safe in-memory cache with time-to-live expiration."""

    def __init__(self, default_ttl: int = 60) -> None:
        self.default_ttl = default_ttl
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        now = time.monotonic()
        item = self._store.get(key)
        if item is None:
            return None
        expires_at, val = item
        if now > expires_at:
            del self._store[key]
            return None
        return val

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        now = time.monotonic()
        lifespan = ttl if ttl is not None else self.default_ttl
        self._store[key] = (now + lifespan, value)

    def clear(self) -> None:
        self._store.clear()
