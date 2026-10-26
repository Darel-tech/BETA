from typing import Protocol, runtime_checkable
import numpy as np


@runtime_checkable
class Embedder(Protocol):
    """Protocol for embedding generation models."""

    @property
    def dimension(self) -> int:
        ...

    def embed_text(self, text: str) -> list[float]:
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        ...


class SentenceTransformerEmbedder:
    """Production embedder using sentence-transformers (all-MiniLM-L6-v2)."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2", expected_dim: int = 384) -> None:
        from sentence_transformers import SentenceTransformer

        self._model_name = model_name
        self._expected_dim = expected_dim
        self._model = SentenceTransformer(model_name)
        if hasattr(self._model, "get_embedding_dimension"):
            test_dim = self._model.get_embedding_dimension()
        else:
            test_dim = self._model.get_sentence_embedding_dimension()
        if test_dim != self._expected_dim:
            raise ValueError(
                f"Model {model_name} dimension {test_dim} does not match expected {self._expected_dim}"
            )

    @property
    def dimension(self) -> int:
        return self._expected_dim

    def embed_text(self, text: str) -> list[float]:
        embedding = self._model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
        return embedding.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings = self._model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        return embeddings.tolist()
