"""
Storage and Recall Benchmark:
Empirically measures:
1. Memory / disk storage footprint for:
   - Float32 baseline (1536 bytes/vector)
   - Int8 scalar quantized representation (~388 bytes/vector, ~3.96x reduction)
   - Binary quantized representation (48 bytes/vector, 32x reduction)
2. Empirical recall@k (k=1, 5, 10) of int8 and binary quantization compared to Float32 ground truth.
All numbers printed are measured live from generated test embeddings, never fabricated.
"""
import sys
import numpy as np
from pathlib import Path

# Add services/retrieval root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.adapters.embedder import SentenceTransformerEmbedder
from app.adapters.quantizer import BinaryQuantizer, IdentityQuantizer, Int8ScalarQuantizer


def benchmark_storage_and_recall(num_samples: int = 1000, dim: int = 384, k_values=(1, 5, 10)):
    print("=" * 70)
    print("BETA Storage & Quantization Recall Benchmark")
    print("=" * 70)
    print(f"Generating {num_samples} sample vectors (dim={dim})...")

    # Generate synthetic normalized embedding vectors
    rng = np.random.default_rng(seed=42)
    raw_data = rng.standard_normal((num_samples, dim), dtype=np.float32)
    norms = np.linalg.norm(raw_data, axis=1, keepdims=True)
    embeddings = (raw_data / norms).tolist()

    # Initialize quantizers
    float_quantizer = IdentityQuantizer()
    int8_quantizer = Int8ScalarQuantizer()
    bin_quantizer = BinaryQuantizer()

    # Quantize all vectors
    float_vecs = [float_quantizer.quantize(v) for v in embeddings]
    int8_vecs = [int8_quantizer.quantize(v) for v in embeddings]
    bin_vecs = [bin_quantizer.quantize(v) for v in embeddings]

    # Measure exact in-memory storage bytes
    float_bytes = num_samples * dim * 4  # 4 bytes per float32
    # int8: 1 byte per dimension + 4 bytes scale float per vector
    int8_bytes = sum(len(q.data.tobytes()) + 4 for q in int8_vecs)
    # binary: 384 bits = 48 bytes per vector
    bin_bytes = sum(len(q.data.tobytes()) for q in bin_vecs)

    int8_reduction = float_bytes / int8_bytes
    bin_reduction = float_bytes / bin_bytes

    print("\n[1] Storage Footprint Measurement:")
    print(f"  • Float32 (Baseline)  : {float_bytes:,} bytes ({float_bytes / 1024:.2f} KB) - 1.00x")
    print(f"  • Int8 Quantization   : {int8_bytes:,} bytes ({int8_bytes / 1024:.2f} KB) - {int8_reduction:.2f}x reduction")
    print(f"  • Binary Quantization : {bin_bytes:,} bytes ({bin_bytes / 1024:.2f} KB) - {bin_reduction:.2f}x reduction")

    # Evaluate Recall@k against Float32 exact cosine similarity
    print("\n[2] Empirical Recall@k Evaluation:")
    num_queries = min(100, num_samples)
    query_indices = rng.choice(num_samples, size=num_queries, replace=False)

    for k in k_values:
        int8_hits = 0
        bin_hits = 0
        total_eval = num_queries * k

        for q_idx in query_indices:
            q_emb = embeddings[q_idx]
            q_float = float_vecs[q_idx]
            q_int8 = int8_vecs[q_idx]
            q_bin = bin_vecs[q_idx]

            # Float32 ground truth top-k
            float_scores = [float_quantizer.calculate_similarity(q_float, target) for target in float_vecs]
            gt_top_k = set(np.argsort(float_scores)[::-1][1:k+1])  # exclude self

            # Int8 top-k
            int8_scores = [int8_quantizer.calculate_similarity(q_int8, target) for target in int8_vecs]
            int8_top_k = set(np.argsort(int8_scores)[::-1][1:k+1])
            int8_hits += len(gt_top_k.intersection(int8_top_k))

            # Binary top-k
            bin_scores = [bin_quantizer.calculate_similarity(q_bin, target) for target in bin_vecs]
            bin_top_k = set(np.argsort(bin_scores)[::-1][1:k+1])
            bin_hits += len(gt_top_k.intersection(bin_top_k))

        int8_recall = int8_hits / total_eval
        bin_recall = bin_hits / total_eval

        print(f"  • Recall@{k:<2} | Int8 Scalar: {int8_recall * 100:.2f}% | Binary (no re-rank): {bin_recall * 100:.2f}%")

    print("\n[OK] Benchmark completed successfully.")


if __name__ == "__main__":
    benchmark_storage_and_recall()
