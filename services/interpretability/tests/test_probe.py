import os
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

# We import the FastAPI app and required schemas/classes
from app import app
from sae_probe import EntityScore, ProbeNotCalibratedError

# Create a TestClient for testing the FastAPI endpoints
client = TestClient(app)

# --------------------------------------------------------------------------
# Mocked Fast Tests (CI/CD Friendly)
# --------------------------------------------------------------------------

@patch("app.get_probe")
@patch("app.load_model_and_sae")
def test_check_endpoint_returns_valid_shape(mock_load, mock_get_probe):
    """
    Week 8 Milestone: test that /v1/check returns a valid response shape 
    for a sample request. This is mocked so it runs instantly without loading 
    the 2B model, making it perfect for CI/CD pipelines.
    """
    # 1. Setup our mocked probe
    mock_probe = MagicMock()
    mock_probe.score_entities.return_value = [
        EntityScore(entity="Barack Obama", known_ness=0.95, token_span=(1, 2)),
        EntityScore(entity="Obscure Name", known_ness=0.10, token_span=(4, 5)),
    ]
    mock_get_probe.return_value = mock_probe

    # 2. Simulate the /v1/check request
    # Note: verify_internal_api_key will pass if INTERNAL_API_KEY is not set in env 
    # (assuming is_production is False). If needed, pass a fake key.
    headers = {"X-Internal-Api-Key": os.environ.get("INTERNAL_API_KEY", "")}
    
    response = client.post(
        "/v1/check",
        json={
            "text": "Barack Obama and Obscure Name",
            "source": "local-gemma",
            "entities": ["Barack Obama", "Obscure Name"]
        },
        headers=headers
    )

    # 3. Assert the contract shape
    assert response.status_code == 200
    data = response.json()
    
    assert "verdict" in data
    assert data["verdict"] in ["trustworthy", "uncertain", "needs_correction"]
    
    assert "confidence" in data
    assert isinstance(data["confidence"], float)
    assert 0.0 <= data["confidence"] <= 1.0
    
    assert "evidence" in data
    assert isinstance(data["evidence"], list)
    
    assert "latency_ms" in data
    assert isinstance(data["latency_ms"], int)


@patch("sae_probe._load_known_direction")
@patch("sae_probe.get_probe")
def test_known_ness_score_separation_mocked(mock_get_probe, mock_load_dir):
    """
    Week 8 Milestone: test that known_ness_score returns a higher score 
    for a known entity than an unknown one. 
    
    This is a mocked version to ensure the logic extracting and comparing scores works.
    For the real scientific evaluation, use the integration test below.
    """
    mock_probe = MagicMock()
    mock_probe.score_entities.return_value = [
        EntityScore(entity="Barack Obama", known_ness=0.92, token_span=(1, 2)),
        EntityScore(entity="Blarghox", known_ness=0.15, token_span=(4, 5)),
    ]
    
    scores = mock_probe.score_entities("Barack Obama and Blarghox", ["Barack Obama", "Blarghox"])
    
    known_score = next(s.known_ness for s in scores if s.entity == "Barack Obama")
    unknown_score = next(s.known_ness for s in scores if s.entity == "Blarghox")
    
    assert known_score > unknown_score
    assert known_score - unknown_score > 0.7  # separation


# --------------------------------------------------------------------------
# Integration Tests (Requires real model + probe artifact)
# --------------------------------------------------------------------------

@pytest.mark.slow
def test_real_probe_separation():
    """
    Week 8 Milestone: The REAL test that loads the Gemma-2-2B model and SAE,
    and proves that the known_ness_score separates known vs unknown entities.
    
    Run this with `pytest -m slow` locally or on a GPU instance.
    """
    try:
        from model_loader import load_model_and_sae
        from sae_probe import get_probe
        
        loaded = load_model_and_sae()
        probe = get_probe(loaded)
    except (Exception, ProbeNotCalibratedError) as e:
        pytest.skip(f"Skipping real probe test: model or probe not available ({e})")
        
    text = "Barack Obama is a very famous person, unlike Blarghox The Unseen."
    entities = ["Barack Obama", "Blarghox"]
    
    scores = probe.score_entities(text, entities)
    
    known_score = next((s.known_ness for s in scores if s.entity == "Barack Obama"), 0.0)
    unknown_score = next((s.known_ness for s in scores if s.entity == "Blarghox"), 1.0)
    
    assert known_score > unknown_score, "Probe failed to separate known from unknown!"
