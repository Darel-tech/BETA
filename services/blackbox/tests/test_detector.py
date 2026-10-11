"""Pipeline (Detector) and HTTP API integration tests.

All provider and model calls are replaced by fakes; nothing here touches the
network, needs API keys, or downloads a model.
"""

import asyncio
import sys

import pytest
from fastapi.testclient import TestClient

from ..app import create_app, get_detector
from ..decision_logic import Verdict
from ..detector import Detector
from ..entailment_check import EntailmentLabel, EntailmentResult, FactResult
from ..errors import (
    ConfigurationError,
    InputValidationError,
    ModelError,
    ProviderError,
)
from ..resample_entropy import ConsistencyResult

QUESTION = "What is the capital of France?"
TEXT = "The capital of France is Paris."
FACTS = ["Paris is the capital of France."]


def consistency(score, provider="openai", n=5):
    return ConsistencyResult(
        question=QUESTION,
        answers=tuple(f"answer {i}" for i in range(n)),
        consistency_score=score,
        sample_count=n,
        provider=provider,
        model="fake-model",
        temperature=1.0,
    )


def entailment(label, score, facts=None, conflict=False):
    facts = facts or FACTS
    return EntailmentResult(
        claim=TEXT,
        label=label,
        score=score,
        fact_results=tuple(
            FactResult(f, label, score, 0.0, 0.0, 0.0) for f in facts
        ),
        has_conflict=conflict,
        model_name="fake-nli",
    )


class Recorder:
    """Callable that records its calls and returns / raises a preset outcome."""

    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


def make_detector(c=0.95, e=None):
    c_fn = Recorder(consistency(c) if not isinstance(c, BaseException) else c)
    e_fn = Recorder(e if e is not None else entailment(EntailmentLabel.SUPPORTED, 0.93))
    return Detector(consistency_fn=c_fn, entailment_fn=e_fn), c_fn, e_fn


def payload(**overrides):
    body = {"text": TEXT, "source": "chatgpt", "question": QUESTION, "reference_facts": FACTS}
    body.update(overrides)
    return {k: v for k, v in body.items() if v is not ...}


@pytest.fixture
def client_factory():
    clients = []

    def build(detector):
        client = TestClient(create_app(detector))
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.close()


# ====================================================== Detector (no HTTP)


def test_detector_combines_both_signals_into_trustworthy():
    detector, c_fn, e_fn = make_detector(0.95)
    outcome = detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS)
    assert outcome.decision.verdict is Verdict.TRUSTWORTHY
    assert outcome.consistency.sample_count == 5
    assert outcome.entailment.label is EntailmentLabel.SUPPORTED
    assert c_fn.calls == [(QUESTION, "openai")]
    assert e_fn.calls == [(TEXT, FACTS)]
    assert outcome.signals["sample_count"] == 5
    assert outcome.signals["fact_results"][0]["label"] == "supported"


def test_source_selects_provider():
    detector, c_fn, _ = make_detector()
    detector.detect(text=TEXT, source="claude", question=QUESTION, reference_facts=FACTS)
    assert c_fn.calls == [(QUESTION, "anthropic")]


def test_contradiction_beats_high_consistency_in_pipeline():
    detector, _, _ = make_detector(0.99, entailment(EntailmentLabel.CONTRADICTED, 0.96))
    outcome = detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS)
    assert outcome.decision.verdict is Verdict.NEEDS_CORRECTION
    assert any("does not override" in line for line in outcome.evidence)


def test_without_question_resampling_is_skipped_and_stated():
    detector, c_fn, e_fn = make_detector()
    outcome = detector.detect(text=TEXT, source="chatgpt", reference_facts=FACTS)
    assert c_fn.calls == []
    assert len(e_fn.calls) == 1
    assert outcome.consistency is None
    assert outcome.signals["consistency_score"] is None
    assert any("resampling was skipped" in line for line in outcome.evidence)


def test_without_facts_entailment_is_skipped_and_unavailability_stated():
    detector, c_fn, e_fn = make_detector(0.95)
    outcome = detector.detect(text=TEXT, source="chatgpt", question=QUESTION)
    assert e_fn.calls == []
    assert len(c_fn.calls) == 1
    assert outcome.entailment is None
    assert outcome.decision.verdict is Verdict.TRUSTWORTHY
    assert outcome.decision.confidence <= 0.75
    assert any("unavailable" in line for line in outcome.evidence)


def test_blank_facts_count_as_absent():
    detector, _, e_fn = make_detector()
    detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=["  ", ""])
    assert e_fn.calls == []


def test_blank_question_counts_as_absent():
    detector, c_fn, _ = make_detector()
    detector.detect(text=TEXT, source="chatgpt", question="   ", reference_facts=FACTS)
    assert c_fn.calls == []


def test_entities_are_echoed_but_do_not_change_the_verdict():
    detector, _, _ = make_detector(0.95)
    with_entities = detector.detect(
        text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS, entities=["Paris"]
    )
    without = detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS)
    assert with_entities.signals["entities"] == ["Paris"]
    assert with_entities.decision.verdict is without.decision.verdict


def test_neither_question_nor_facts_is_rejected():
    detector, c_fn, e_fn = make_detector()
    with pytest.raises(InputValidationError):
        detector.detect(text=TEXT, source="chatgpt")
    assert c_fn.calls == [] and e_fn.calls == []


@pytest.mark.parametrize("text", ["", "   ", None, 5])
def test_invalid_text_is_rejected(text):
    detector, _, _ = make_detector()
    with pytest.raises(InputValidationError):
        detector.detect(text=text, source="chatgpt", question=QUESTION)


@pytest.mark.parametrize("source", ["gemini", "", None, "ChatGPT"])
def test_invalid_source_is_rejected(source):
    detector, _, _ = make_detector()
    with pytest.raises(InputValidationError):
        detector.detect(text=TEXT, source=source, question=QUESTION)


@pytest.mark.parametrize("error", [ProviderError("down"), ConfigurationError("no key")])
def test_consistency_failures_propagate_instead_of_producing_a_verdict(error):
    detector, _, e_fn = make_detector(error)
    with pytest.raises(type(error)):
        detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS)


def test_entailment_failure_propagates():
    detector, _, _ = make_detector(0.9, ModelError("nli down"))
    with pytest.raises(ModelError):
        detector.detect(text=TEXT, source="chatgpt", question=QUESTION, reference_facts=FACTS)


# ============================================================ HTTP API


def test_health_reports_status_without_leaking_secrets(client_factory, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-super-secret-value")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client = client_factory(None)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["providers_configured"] == {"openai": True, "anthropic": False}
    assert "embedding" in body["models"] and "nli" in body["models"]
    assert "sk-super-secret-value" not in response.text


@pytest.mark.parametrize("route", ["/detect", "/v1/check"])
def test_valid_request_returns_documented_schema(client_factory, route):
    detector, c_fn, e_fn = make_detector(0.95)
    client = client_factory(detector)
    response = client.post(route, json=payload(entities=["Paris", "France"]))
    assert response.status_code == 200
    body = response.json()
    assert body["verdict"] == "trustworthy"
    assert 0.0 <= body["confidence"] <= 1.0
    assert isinstance(body["evidence"], list) and body["evidence"]
    assert all(isinstance(line, str) for line in body["evidence"])
    assert isinstance(body["latency_ms"], (int, float)) and body["latency_ms"] >= 0
    assert body["signals"]["consistency_score"] == pytest.approx(0.95)
    assert body["signals"]["entities"] == ["Paris", "France"]
    assert body["signals"]["confidence_is_calibrated"] is False
    assert len(c_fn.calls) == 1 and len(e_fn.calls) == 1


def test_both_routes_give_the_same_verdict(client_factory):
    detector, _, _ = make_detector(0.9, entailment(EntailmentLabel.CONTRADICTED, 0.95))
    client = client_factory(detector)
    a = client.post("/detect", json=payload()).json()
    b = client.post("/v1/check", json=payload()).json()
    assert a["verdict"] == b["verdict"] == "needs_correction"
    assert a["confidence"] == b["confidence"]


def test_claude_source_uses_anthropic_provider(client_factory):
    detector, c_fn, _ = make_detector()
    client_factory(detector).post("/detect", json=payload(source="claude"))
    assert c_fn.calls[0][1] == "anthropic"


def test_request_without_facts_returns_fallback_evidence(client_factory):
    detector, _, e_fn = make_detector(0.95)
    response = client_factory(detector).post("/detect", json=payload(reference_facts=...))
    assert response.status_code == 200
    assert e_fn.calls == []
    assert any("unavailable" in line for line in response.json()["evidence"])


def test_blank_facts_in_request_are_treated_as_absent(client_factory):
    detector, _, e_fn = make_detector(0.95)
    response = client_factory(detector).post("/detect", json=payload(reference_facts=["", "  "]))
    assert response.status_code == 200
    assert e_fn.calls == []


def test_request_without_question_skips_resampling(client_factory):
    detector, c_fn, _ = make_detector()
    response = client_factory(detector).post("/detect", json=payload(question=...))
    assert response.status_code == 200
    assert c_fn.calls == []


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},
        {"source": "chatgpt"},  # missing text
        {"text": TEXT},  # missing source
        {"text": "", "source": "chatgpt", "question": QUESTION},
        {"text": "   ", "source": "chatgpt", "question": QUESTION},
        {"text": TEXT, "source": "gemini", "question": QUESTION},
        {"text": TEXT, "source": "chatgpt", "question": QUESTION, "reference_facts": "a string"},
        {"text": TEXT, "source": "chatgpt", "question": QUESTION, "reference_facts": [{"a": 1}]},
        {"text": TEXT, "source": "chatgpt", "question": QUESTION, "reference_facts": ["f"] * 51},
        {"text": TEXT, "source": "chatgpt", "question": QUESTION, "entities": "Paris"},
        {"text": "x" * 10001, "source": "chatgpt", "question": QUESTION},
        {"text": 123, "source": "chatgpt", "question": QUESTION},
    ],
)
@pytest.mark.parametrize("route", ["/detect", "/v1/check"])
def test_invalid_requests_return_422(client_factory, route, bad_payload):
    detector, c_fn, e_fn = make_detector()
    response = client_factory(detector).post(route, json=bad_payload)
    assert response.status_code == 422
    assert c_fn.calls == [] and e_fn.calls == []


def test_neither_question_nor_facts_returns_422_with_error_code(client_factory):
    detector, _, _ = make_detector()
    response = client_factory(detector).post(
        "/detect", json=payload(question=..., reference_facts=...)
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "invalid_input"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ProviderError("OpenAI request failed (APIError)"), 502, "provider_error"),
        (ConfigurationError("OPENAI_API_KEY is not set"), 503, "configuration_error"),
        (ModelError("Embedding failed (RuntimeError)"), 503, "model_error"),
    ],
)
def test_consistency_dependency_failures_map_to_error_statuses(client_factory, error, status, code):
    detector, _, _ = make_detector(error)
    response = client_factory(detector).post("/detect", json=payload())
    assert response.status_code == status
    body = response.json()
    assert body["detail"]["error"] == code
    assert "verdict" not in body  # no fabricated verdict


def test_nli_failure_returns_503_without_verdict(client_factory):
    detector, _, _ = make_detector(0.9, ModelError("NLI inference failed (RuntimeError)"))
    response = client_factory(detector).post("/detect", json=payload())
    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "model_error"
    assert "verdict" not in response.json()


def test_unexpected_exception_returns_generic_500_without_leaking(client_factory):
    detector, _, _ = make_detector(RuntimeError("secret-token-123"))
    response = client_factory(detector).post("/detect", json=payload())
    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "internal_error"
    assert "secret-token-123" not in response.text


@pytest.mark.parametrize(
    ("source", "env_name"), [("chatgpt", "OPENAI_API_KEY"), ("claude", "ANTHROPIC_API_KEY")]
)
def test_missing_api_credentials_return_503(client_factory, monkeypatch, source, env_name):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    # Real default pipeline: it must fail on the missing key before any model load.
    client = client_factory(Detector())
    response = client.post("/detect", json=payload(source=source, reference_facts=...))
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["error"] == "configuration_error"
    assert env_name in detail["message"]
    assert "verdict" not in response.json()


def test_pipeline_runs_off_the_event_loop_thread(client_factory):
    seen = {}

    def consistency_fn(question, provider):
        try:
            asyncio.get_running_loop()
            seen["on_loop"] = True
        except RuntimeError:
            seen["on_loop"] = False
        return consistency(0.9)

    detector = Detector(
        consistency_fn=consistency_fn,
        entailment_fn=lambda claim, facts: entailment(EntailmentLabel.SUPPORTED, 0.9),
    )
    assert client_factory(detector).post("/detect", json=payload()).status_code == 200
    assert seen["on_loop"] is False


def test_dependency_override_replaces_the_pipeline():
    detector, c_fn, _ = make_detector(0.95)
    app = create_app()
    app.dependency_overrides[get_detector] = lambda: detector
    with TestClient(app) as client:
        response = client.post("/detect", json=payload())
    assert response.status_code == 200
    assert len(c_fn.calls) == 1


def test_openapi_documents_both_routes(client_factory):
    client = client_factory(None)
    paths = client.get("/openapi.json").json()["paths"]
    assert "/detect" in paths and "/v1/check" in paths and "/health" in paths


def test_importing_the_app_does_not_load_models():
    # The module is already imported above; ML libraries must not have been pulled in.
    assert "sentence_transformers" not in sys.modules
    assert "torch" not in sys.modules
