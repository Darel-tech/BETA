from typing import Any


class FakeEmbedder:
    """Deterministic fake embedder for fast unit tests."""

    def __init__(self, dim: int = 384) -> None:
        self._dim = dim

    @property
    def dimension(self) -> int:
        return self._dim

    def embed_text(self, text: str) -> list[float]:
        # Simple deterministic vector based on text length and character ordinals
        val = (len(text) % 100) / 100.0
        vec = [val] * self._dim
        return vec

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_text(t) for t in texts]


class FakeRepository:
    """In-memory chunk repository for unit testing."""

    def __init__(self, seed_chunks: list[dict[str, Any]] | None = None) -> None:
        self.chunks = seed_chunks or [
            {
                "id": 1,
                "text": "Neon is a serverless, cloud-hosted PostgreSQL database service.",
                "source": "docs",
                "entity_tag": "database",
                "similarity": 0.95,
            },
            {
                "id": 2,
                "text": "PostgreSQL is an open-source relational database management system.",
                "source": "docs",
                "entity_tag": "database",
                "similarity": 0.88,
            },
            {
                "id": 3,
                "text": "all-MiniLM-L6-v2 produces 384-dimensional dense sentence embeddings.",
                "source": "ml_docs",
                "entity_tag": "ml",
                "similarity": 0.72,
            },
        ]
        self._db_ok = True

    async def search_similar(
        self,
        query_embedding: list[float],
        k: int = 5,
        entities: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        results = self.chunks
        if entities:
            results = [c for c in self.chunks if c.get("entity_tag") in entities]
            if len(results) < k:
                # Add remainder
                remaining = [c for c in self.chunks if c not in results]
                results.extend(remaining)
        return results[:k]

    async def count_chunks(self) -> int:
        return len(self.chunks)

    async def check_health(self) -> bool:
        return self._db_ok


class FakeLLMClient:
    """Configurable fake LLM client for testing prompt building and injection defenses."""

    def __init__(self, response_text: str | None = None) -> None:
        self.response_text = response_text
        self.last_prompt = ""
        self.last_system_prompt = ""

    async def complete(self, prompt: str, system_prompt: str | None = None) -> str:
        self.last_prompt = prompt
        self.last_system_prompt = system_prompt or ""
        if self.response_text is not None:
            return self.response_text
        return "Corrected: Neon is a serverless PostgreSQL database service. [Fact 1]"
