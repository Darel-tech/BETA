# BETA — Black-Box Detector
**Owner:** Esha Shaeeq
**Repo path you own (and the only path you touch):** `services/blackbox/`
**Also allowed:** appending (never editing) new files under `infra/db/migrations/`

---

## 1. Read this first — what BETA is and where you fit

BETA watches an AI assistant's answer and decides whether it's **trustworthy**, **uncertain**, or **needs_correction**. It does this two different ways depending on whether we control the model or not:

- When BETA is watching our own local model, we can look *inside* it while it thinks — that's Darel's job (`services/interpretability/`).
- When BETA is watching a **closed model — ChatGPT, Claude, or anything reached only through an API — we cannot see its internals, only the text it outputs.** That's your job.

Both of you build a service that answers the exact same question in the exact same shape (see §3). The dashboard (Ahamed) doesn't care which of you answered — it just calls whichever one is relevant to the source model and shows the verdict. This is what lets four people build in parallel without waiting on each other.

**Your specific mission:** since you can't read a closed model's mind, you have to infer confidence from its *behavior*. Two independent techniques, used together:

1. **Consistency checking (semantic entropy).** Ask the model the same question a few different ways, or resample it a few times. If it gives genuinely different facts each time, it's probably improvising rather than recalling something it actually knows. If it gives the same facts every time, that's a much stronger (though not perfect) sign of real knowledge.
2. **Fact entailment.** Take the claim in the answer and compare it against real reference facts (pulled from Chandru's knowledge store) using a small, dedicated model whose only job is to say "supported," "contradicted," or "unrelated." This is not another big LLM call — it's a tiny, fast classifier built exactly for this comparison task.

If you've never done this kind of work before: think of technique 1 like asking a person the same question twice, worded differently, and seeing if their story stays straight. Technique 2 is like fact-checking a claim against a reference book, except the "fact-checker" is a small AI model instead of a person doing manual lookup.

---

## 2. Your folder — exact structure to create

```
services/blackbox/
├── ARCHITECTURE.md            # this file, copied here
├── requirements.txt
├── resample_entropy.py        # technique 1: consistency across resamples
├── entailment_check.py        # technique 2: claim vs. retrieved fact
├── decision_logic.py          # combines both signals into one verdict
├── app.py                      # FastAPI service exposing /v1/check
├── Dockerfile
├── .env.example                 # documents required API keys, never real ones
└── tests/
    └── test_detector.py
```

**Rule: never create or edit any file outside `services/blackbox/`.** If you need something from Darel's, Chandru's, or Ahamed's part of the system, call their HTTP endpoint — never import or edit their code. This is what keeps merge conflicts at zero: Git only sees a conflict when two people edit the *same file*. If nobody but you ever opens a file in this folder, there is nothing to conflict over.

**Critical secrets rule:** you will need your own OpenAI and/or Anthropic API key for local development. Put it in a local `.env` file that is in `.gitignore` (already set up at the repo root — do not remove your service from it). Never commit a real key. `.env.example` should list the variable names only, e.g. `OPENAI_API_KEY=`, with no values.

---

## 3. The contract you must implement — do not deviate from this shape

Every detection service in BETA (yours and Darel's) exposes the same endpoint:

```
POST /v1/check

Request body:
{
  "text": "string — the AI-generated answer to check",
  "source": "chatgpt" | "claude",
  "entities": ["optional — list of entity strings mentioned in the answer"]
}

Response body:
{
  "verdict": "trustworthy" | "uncertain" | "needs_correction",
  "confidence": 0.0 to 1.0,
  "evidence": ["short human-readable strings explaining the verdict"],
  "latency_ms": 123
}
```

Your service only ever receives requests where `"source"` is `"chatgpt"` or `"claude"` — the router (Ahamed's code) sends local-model requests to Darel instead. Return a 400 for any other `source` value.

**Why this matters:** your response shape is identical to Darel's, so nobody downstream needs to know or care which of you answered. Keep this contract exact — if you need to add a field, add it as optional and tell the team first.

---

## 4. Task checklist — do these in order, each is a real milestone

### Week 1 — Environment and first API call
- [ ] `pip install openai anthropic sentence-transformers` inside `services/blackbox/`. List exact versions in `requirements.txt`.
- [ ] Get your own API keys (personal dev keys, not production ones — Ahamed manages production secrets separately in Vercel).
- [ ] Milestone: a script that sends one test prompt to GPT and to Claude and prints both responses. This confirms your environment and keys work.

### Week 2 — Consistency checking
- [ ] In `resample_entropy.py`: write a function `consistency_score(question: str, model: str, n: int = 5) -> float` that calls the model `n` times (same question, slight temperature variation or paraphrased wording), embeds the answers with a small sentence-transformer, and measures how much they disagree. Low disagreement → high score. High disagreement → low score.
- [ ] Be deliberate about cost here — every resample is a paid API call. Cache results for repeated test runs during development so you're not burning your key's budget on every test run.

### Week 3 — Entailment checking
- [ ] In `entailment_check.py`: load `cross-encoder/nli-deberta-v3-small` (small, ~140MB, runs on CPU instantly — do not reach for a bigger model here, it's not needed).
- [ ] Write a function `entailment(claim: str, reference_facts: list[str]) -> str` returning `"supported"`, `"contradicted"`, or `"unrelated"`.
- [ ] For now, while Chandru's retrieval endpoint may not be ready, stub `reference_facts` with a small hardcoded list of test facts so you can develop independently. Swap in his real endpoint once it's live (week 5–6), never before — don't block on him.

### Week 4 — Combine into decision logic
- [ ] In `decision_logic.py`: write `decide(consistency: float, entailment_result: str) -> tuple[str, float, list[str]]` returning `(verdict, confidence, evidence)`. Simple, explainable rules are better than a clever black box here — e.g., contradicted fact → `needs_correction` regardless of consistency; low consistency alone → `uncertain`; high consistency and supported/unrelated → `trustworthy`.
- [ ] Write down your rule table in this file's changelog section (bottom) so the team and future-you can see the logic at a glance.

### Weeks 5–6 — Turn it into a live service
- [ ] In `app.py`: FastAPI app with `POST /v1/check` matching §3 exactly. Internally: run `consistency_score`, call Chandru's real `/retrieve` endpoint (URL from an environment variable, never hardcoded) to get reference facts, run `entailment_check`, combine via `decision_logic`.
- [ ] Add `GET /health` returning `{"status": "ok"}`.
- [ ] Time only the actual detection work for `latency_ms`, not the whole request lifecycle.
- [ ] Add basic rate limiting or a request queue so a burst of dashboard traffic can't blow through your API budget unexpectedly — this matters more for you than for Darel, since every check here costs real money.

### Week 7 — Deploy
- [ ] `Dockerfile` installing `requirements.txt`, running `app.py` with `uvicorn`.
- [ ] Deploy to Hugging Face Spaces (CPU tier is enough — you're not running a big model) or Railway.
- [ ] Set your API keys as environment variables on the hosting platform, never in code. Give the deployed URL to Ahamed.

### Week 8 — Tests and polish
- [ ] `tests/test_detector.py`: a test that consistent answers score higher than contradictory ones, and a test that `/v1/check` returns a valid response shape.
- [ ] Re-verify actual cost per check (log token usage) — this number matters for the team's final benchmark comparison against Darel's near-free method.

---

## 5. Database access

You don't own any table, but you'll read from Chandru's `knowledge_chunks` indirectly through his `/retrieve` HTTP endpoint — never query his database table directly. If you ever need to log your own detection results for the benchmark, write to `queries_log` (owned by Ahamed's eval harness) only via appending a new migration if a column is missing — check with Ahamed first.

## 6. How to develop without waiting on anyone else

Stub Chandru's retrieval response with a hardcoded fact list during weeks 1–4. Swap to his real endpoint only once he confirms it's live — you should never be blocked waiting on him.

## 7. Definition of done

- `/v1/check` returns correct, contract-shaped responses for chatgpt/claude requests
- Consistency and entailment each independently demonstrated to work on a handful of test cases
- Service is deployed, reachable, and cost-aware (rate-limited)
- `/health` responds
- No file outside `services/blackbox/` was ever modified by you
