import pytest
from app.adapters.quantizer import BinaryQuantizer, IdentityQuantizer, Int8ScalarQuantizer


def test_identity_quantizer_roundtrip():
    q = IdentityQuantizer()
    vec = [0.1, -0.2, 0.5, 0.8]
    qvec = q.quantize(vec)
    reconstructed = q.dequantize(qvec)
    assert reconstructed == pytest.approx(vec, abs=1e-6)
    sim = q.calculate_similarity(qvec, qvec)
    assert sim == pytest.approx(1.0, abs=1e-5)


def test_int8_quantizer_compression_and_recall():
    q = Int8ScalarQuantizer()
    vec1 = [0.05 * i for i in range(20)]
    vec2 = [0.05 * i for i in range(20)]
    qvec1 = q.quantize(vec1)
    qvec2 = q.quantize(vec2)

    # Reconstructed should be within quantization rounding delta
    recon = q.dequantize(qvec1)
    assert len(recon) == len(vec1)
    assert recon == pytest.approx(vec1, abs=0.02)

    # Identical vectors should have similarity close to 1.0
    sim = q.calculate_similarity(qvec1, qvec2)
    assert sim == pytest.approx(1.0, abs=0.01)


def test_binary_quantizer_hamming_similarity():
    q = BinaryQuantizer()
    vec1 = [1.0, -1.0, 1.0, -1.0] * 8  # 32 dimensions
    vec2 = [1.0, -1.0, 1.0, -1.0] * 8
    qvec1 = q.quantize(vec1)
    qvec2 = q.quantize(vec2)

    sim = q.calculate_similarity(qvec1, qvec2)
    assert sim == pytest.approx(1.0, abs=1e-6)

    # Invert vec2
    inv_vec = [-x for x in vec1]
    qvec_inv = q.quantize(inv_vec)
    sim_inv = q.calculate_similarity(qvec1, qvec_inv)
    assert sim_inv == pytest.approx(0.0, abs=1e-6)
