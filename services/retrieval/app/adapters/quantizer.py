from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable
import numpy as np


@dataclass
class QuantizedVector:
    """Represents a quantized vector representation and metadata."""
    mode: str
    data: Any
    scale: float = 1.0


@runtime_checkable
class Quantizer(Protocol):
    """Protocol for vector quantization algorithms."""

    def quantize(self, vector: list[float]) -> QuantizedVector:
        ...

    def dequantize(self, qvec: QuantizedVector) -> list[float]:
        ...

    def calculate_similarity(self, q1: QuantizedVector, q2: QuantizedVector) -> float:
        ...


class IdentityQuantizer:
    """Float32 baseline with no quantization."""

    def quantize(self, vector: list[float]) -> QuantizedVector:
        return QuantizedVector(mode="none", data=list(vector), scale=1.0)

    def dequantize(self, qvec: QuantizedVector) -> list[float]:
        return list(qvec.data)

    def calculate_similarity(self, q1: QuantizedVector, q2: QuantizedVector) -> float:
        v1 = np.asarray(q1.data, dtype=np.float32)
        v2 = np.asarray(q2.data, dtype=np.float32)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(v1, v2) / (norm1 * norm2))


class Int8ScalarQuantizer:
    """
    Symmetric int8 scalar quantization.
    Maps floating-point embeddings from [-max_abs, max_abs] to int8 range [-127, 127].
    Delivers ~4x storage reduction (1 byte per dimension vs 4 bytes) with negligible precision loss.
    """

    def quantize(self, vector: list[float]) -> QuantizedVector:
        arr = np.asarray(vector, dtype=np.float32)
        max_abs = float(np.max(np.abs(arr)))
        if max_abs == 0.0:
            scale = 1.0
            q_data = np.zeros(len(arr), dtype=np.int8)
        else:
            scale = max_abs / 127.0
            q_data = np.clip(np.round(arr / scale), -127, 127).astype(np.int8)

        return QuantizedVector(mode="int8", data=q_data, scale=scale)

    def dequantize(self, qvec: QuantizedVector) -> list[float]:
        q_data = np.asarray(qvec.data, dtype=np.float32)
        reconstructed = q_data * qvec.scale
        return reconstructed.tolist()

    def calculate_similarity(self, q1: QuantizedVector, q2: QuantizedVector) -> float:
        # Fast dot product of int8 vectors, scaled by scale1 * scale2
        dot = int(np.dot(q1.data.astype(np.int32), q2.data.astype(np.int32)))
        unscaled_dot = dot * (q1.scale * q2.scale)
        # Approximate cosine similarity for normalized vectors
        norm1 = np.linalg.norm(q1.data.astype(np.float32)) * q1.scale
        norm2 = np.linalg.norm(q2.data.astype(np.float32)) * q2.scale
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(unscaled_dot / (norm1 * norm2))


class BinaryQuantizer:
    """
    1-bit binary sign quantization.
    Maps positive coordinates to 1, negative/zero to 0.
    Delivers 32x reduction for fast Hamming filtering before re-ranking.
    """

    def quantize(self, vector: list[float]) -> QuantizedVector:
        arr = np.asarray(vector, dtype=np.float32)
        bits = np.packbits(arr > 0)
        return QuantizedVector(mode="binary", data=bits, scale=1.0)

    def dequantize(self, qvec: QuantizedVector) -> list[float]:
        # Unpack bits to [-1.0, 1.0]
        unpacked = np.unpackbits(qvec.data)
        return np.where(unpacked > 0, 1.0, -1.0).tolist()

    def calculate_similarity(self, q1: QuantizedVector, q2: QuantizedVector) -> float:
        # Hamming distance converted to normalized similarity
        xor_bits = np.bitwise_xor(q1.data, q2.data)
        differing = int(np.sum(np.unpackbits(xor_bits)))
        total_bits = len(q1.data) * 8
        agreement = total_bits - differing
        return float(agreement / total_bits)


def get_quantizer(mode: str) -> Quantizer:
    if mode == "int8":
        return Int8ScalarQuantizer()
    elif mode == "binary":
        return BinaryQuantizer()
    return IdentityQuantizer()
