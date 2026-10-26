import pytest
from fastapi.testclient import TestClient

from app.api.deps import (
    get_embedder,
    get_llm_client,
    get_quantizer_dep,
    get_repository,
)
from app.config import settings
from app.main import app
from tests.fakes import FakeEmbedder, FakeLLMClient, FakeRepository


@pytest.fixture
def client():
    # Setup test overrides
    fake_repo = FakeRepository()
    fake_embedder = FakeEmbedder()
    fake_llm = FakeLLMClient("Corrected answer: Neon is a PostgreSQL database. [Fact 1]")

    app.dependency_overrides[get_repository] = lambda: fake_repo
    app.dependency_overrides[get_embedder] = lambda: fake_embedder
    app.dependency_overrides[get_llm_client] = lambda: fake_llm

    with TestClient(app) as tc:
        yield tc

    app.dependency_overrides.clear()


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"
    assert data["embedder_loaded"] is True
    assert data["knowledge_chunks_count"] == 3
    assert data["version"] == settings.VERSION

    # Test /v1/health mount
    v1_response = client.get("/v1/health")
    assert v1_response.status_code == 200
    assert v1_response.json()["status"] == "ok"


def test_auth_rejection_missing_header(client):
    response = client.post("/retrieve", json={"query": "test"})
    assert response.status_code == 401
    assert "Missing required header" in response.json()["detail"]


def test_auth_rejection_invalid_key(client):
    response = client.post(
        "/retrieve",
        json={"query": "test"},
        headers={"X-Internal-Api-Key": "wrong-key"},
    )
    assert response.status_code == 401
    assert "Invalid X-Internal-Api-Key" in response.json()["detail"]


def test_retrieve_success(client):
    headers = {"X-Internal-Api-Key": settings.INTERNAL_API_KEY}
    response = client.post(
        "/retrieve",
        json={"query": "What is Neon PostgreSQL?", "k": 2},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "facts" in data
    assert "latency_ms" in data
    assert len(data["facts"]) == 2
    assert "PostgreSQL" in data["facts"][0]

    # Verify mounted under /v1/retrieve
    v1_resp = client.post(
        "/v1/retrieve",
        json={"query": "What is Neon PostgreSQL?", "k": 2},
        headers=headers,
    )
    assert v1_resp.status_code == 200
    assert len(v1_resp.json()["facts"]) == 2


def test_retrieve_validation_errors(client):
    headers = {"X-Internal-Api-Key": settings.INTERNAL_API_KEY}
    # Empty query (< 1 char)
    r1 = client.post("/retrieve", json={"query": ""}, headers=headers)
    assert r1.status_code == 422

    # Invalid k (k > 20)
    r2 = client.post("/retrieve", json={"query": "test", "k": 50}, headers=headers)
    assert r2.status_code == 422


def test_correct_success(client):
    headers = {"X-Internal-Api-Key": settings.INTERNAL_API_KEY}
    payload = {
        "original_question": "What is Neon?",
        "flagged_answer": "Neon is a key-value store.",
        "facts": ["Neon is a serverless, cloud-hosted PostgreSQL database service."],
    }
    response = client.post("/correct", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "corrected_answer" in data
    assert "used_facts" in data
    assert len(data["used_facts"]) == 1
    assert "Neon is a serverless" in data["used_facts"][0]

    # Verify /v1/correct
    v1_resp = client.post("/v1/correct", json=payload, headers=headers)
    assert v1_resp.status_code == 200
    assert len(v1_resp.json()["used_facts"]) == 1
