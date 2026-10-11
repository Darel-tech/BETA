# Black-Box Hallucination Detector

Component of **Hallucination Firewall**. It evaluates an answer from an external LLM (ChatGPT or Claude) **without** access to model weights or activations, by combining two signals into an explainable verdict.

> Status: standalone component, implemented and unit-tested with mocks. Detection accuracy has **not** been evaluated, and no knowledge-retrieval service, dashboard, or white-box SAE detector is integrated.

## What it does / does not do

| Does | Does not |
|---|---|
| Resamples the question from the same provider and measures semantic agreement of the answers (a *consistency proxy*) | Compute true semantic entropy (Farquhar et al.); no entailment clustering or entropy is calculated |
| Checks the answer against **reference facts supplied in the request** using an NLI model | Retrieve facts itself, or prove that a claim is true or false |
| Combines both signals with explicit rules into `trustworthy` / `uncertain` / `needs_correction` | Provide calibrated probabilities (`confidence` is a heuristic) |

## Architecture and data flow

```
POST /detect | /v1/check
        |
   app.py (Pydantic validation, runs pipeline in a worker thread)
        |
   detector.py  Detector.detect()
        |-- question given? --> resample_entropy.py: sample N answers (OpenAI/Anthropic SDK)
        |                       + sentence-transformers embeddings -> consistency_score
        |-- facts given?    --> entailment_check.py: NLI(fact, claim) per fact -> aggregate
        v
   decision_logic.py  decide(consistency, entailment) -> verdict, confidence, evidence, signals
```

Files: `errors.py` (shared exceptions) and `detector.py` (pipeline) are small supporting modules: the first prevents circular imports, the second keeps `app.py` thin and the pipeline testable without HTTP.

`source` maps to the resampling provider: `chatgpt` -> OpenAI, `claude` -> Anthropic.

**Missing inputs.** `question` absent -> resampling is skipped (stated in the evidence). `reference_facts` absent or all blank -> fact verification is reported as unavailable and the verdict falls back cautiously to consistency, with confidence capped. At least one of the two must be present (otherwise HTTP 422). `entities` is accepted for contract compatibility but not used in scoring.

### Decision rules (summary)

1. Strong contradiction (NLI score >= 0.80) -> `needs_correction`, even if consistency is high.
2. Weak contradiction -> `uncertain`.
3. Supported (score >= 0.60): consistency >= 0.50 -> `trustworthy`; lower -> `uncertain`.
4. Facts unrelated: low consistency -> `needs_correction` (capped); otherwise `uncertain` (high consistency is not proof).
5. No facts: consistency >= 0.80 -> `trustworthy` (capped at 0.75), < 0.50 -> `needs_correction`, else `uncertain`.

Thresholds are configurable (`BLACKBOX_T_*`); defaults are untuned judgement calls. Full rationale is in `decision_logic.py`.

## Setup

Python 3.11+ (3.13 supported by the dependency ranges). From the **repository root**:

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r services/blackbox/requirements.txt
cp services/blackbox/.env.example services/blackbox/.env   # then edit
```

`requirements.txt` includes the test dependencies (`pytest`, `httpx`) and PyTorch via sentence-transformers.

### Environment variables

See `.env.example`. Required for live use: `OPENAI_API_KEY` (for `source: chatgpt` with a question) and/or `ANTHROPIC_API_KEY` (for `source: claude` with a question). Keys are read only from the environment and are never logged or returned. Everything else has a default.

## Run the service

From the repository root:

```bash
uvicorn services.blackbox.app:app --port 8000 --env-file services/blackbox/.env
```

Interactive docs: http://localhost:8000/docs

Docker (build context is the repository root; secrets are passed at runtime):

```bash
docker build -f services/blackbox/Dockerfile -t hallucination-blackbox .
docker run --rm -p 8000:8000 --env-file services/blackbox/.env -v hf-cache:/models hallucination-blackbox
```

## Example requests

```bash
curl -s localhost:8000/health

curl -s localhost:8000/detect -H 'content-type: application/json' -d '{
  "text": "The capital of Australia is Sydney.",
  "source": "chatgpt",
  "question": "What is the capital of Australia?",
  "reference_facts": ["Canberra is the capital city of Australia."]
}'
```

Response shape (values illustrative):

```json
{
  "verdict": "needs_correction",
  "confidence": 0.94,
  "evidence": [
    "A reference fact contradicts the claim (NLI score 0.94).",
    "Consistency is a semantic similarity proxy over 5 sampled openai responses, not calibrated semantic entropy.",
    "NLI results and the confidence value are heuristic signals, not proof of factual truth or calibrated probabilities."
  ],
  "latency_ms": 5321.4,
  "signals": {"consistency_score": 0.91, "entailment_label": "contradicted", "...": "..."}
}
```

`POST /v1/check` accepts and returns exactly the same payloads. `signals` is an additive field exposing the underlying values.

Error statuses (`{"detail": {"error": <code>, "message": ...}}`): `422` invalid input, `502` provider failure, `503` missing API key or local model failure, `500` unexpected error. No verdict is returned when a model or provider call fails.

## Tests

From the repository root (no network, API keys or model downloads needed):

```bash
python -m pytest services/blackbox/tests -v
```

## Model downloads and resources

| Model | Purpose | Approx. size |
|---|---|---|
| `sentence-transformers/all-MiniLM-L6-v2` | embeddings | ~90 MB |
| `cross-encoder/nli-deberta-v3-small` | NLI | ~570 MB |

Downloaded from Hugging Face on first use into `HF_HOME` (default `~/.cache/huggingface`) and cached in-process afterwards. PyTorch itself adds a large install. CPU is sufficient; first request is slow because of loading. Each question-bearing request makes `BLACKBOX_SAMPLE_COUNT` provider calls (Anthropic: one request per sample), so it costs money and takes seconds.

## Limitations

* **False negatives:** an LLM can be consistently wrong, so high consistency can accompany a hallucination. Without reference facts this is the only signal.
* **False positives:** legitimately open-ended questions yield varied answers (low consistency); NLI can mislabel paraphrases, negation, numbers, and long or multi-claim text; incomplete reference facts yield `unrelated`.
* The whole `text` is treated as one claim; split long answers upstream.
* Reference facts are trusted as given; wrong facts produce wrong verdicts.
* `confidence` is a heuristic rule output, **not** a calibrated probability. No calibration or accuracy evaluation has been done.
* Default thresholds are untuned.

## Plugging in a retrieval service later

Retrieval is not integrated. A future service should fetch passages for the question/entities and pass them as `reference_facts` in the request (or call `Detector.detect(..., reference_facts=...)` directly). No detector code needs to change.

## Future work

Calibration on labelled data, true semantic-entropy clustering, claim splitting, caching, and authentication/rate limiting for the HTTP API.
