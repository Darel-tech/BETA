# BETA — Interpretability Core
**Owner:** Darel Oliver Tauro
**Repo path you own (and the only path you touch):** `services/interpretability/`
**Also allowed:** appending (never editing) new files under `infra/db/migrations/`

---

## 1. Read this first — what BETA is and where you fit

BETA watches an AI assistant's answer and decides whether it's **trustworthy**, **uncertain**, or **needs_correction**. It does this two different ways depending on whether we control the model or not:

- When BETA is watching our own local model (Gemma-2-2B), we can look *inside* it while it thinks. That's your job.
- When BETA is watching a closed model like ChatGPT or Claude, we can only see the text it produced, not its internals. That's Esha's job (`services/blackbox/`).

Both of you build a service that answers the exact same question in the exact same shape (see §3). The dashboard (Ahamed) doesn't care which of you answered it — it just calls whichever one is relevant and shows the verdict. This is what lets four people build in parallel without waiting on each other.

**Your specific mission:** inside Gemma-2-2B, there is an internal signal that fires when the model genuinely recognizes something ("I know this") versus when it's only superficially familiar with it ("I've seen the name, but I don't actually know facts about it"). When that signal misfires — recognizes a name without knowing anything real about it — the model hallucinates confidently instead of admitting uncertainty. Your job is to find that signal, prove it's real (not a coincidence), and read it live while the model is generating an answer.

If you've never touched model internals before: think of it like this. A language model's "thoughts" while generating a word are a giant list of numbers (activations). Normally that list is a tangled mess — thousands of ideas squeezed together, so no single number means one clean thing. A tool called a **Sparse Autoencoder (SAE)** untangles that mess into separate dials, each one closer to meaning one specific thing. One of those dials, it turns out, tracks "do I actually know this." You are not training that tool from scratch — Google DeepMind already trained and gave away SAEs for exactly this model (`Gemma Scope`). Your job is to *use* it, verify it, and wire it into a live service.

---

## 2. Your folder — exact structure to create

```
services/interpretability/
├── ARCHITECTURE.md          # this file, copied here
├── requirements.txt
├── model_loader.py          # loads Gemma-2-2B + Gemma Scope SAE
├── sae_probe.py              # the known/unknown "known-ness" scoring logic
├── causal_steering.py        # proves the signal is causal (week 3 milestone)
├── entity_dataset.py         # builds/labels the known vs unknown entity set
├── app.py                     # FastAPI service exposing /v1/check
├── Dockerfile
└── tests/
    └── test_probe.py
```

**Rule: never create or edit any file outside `services/interpretability/`.** If you think you need something from Chandru's retrieval service or Esha's detector, you call their HTTP endpoint — you never import their code or edit their files. This is what keeps merge conflicts at zero: Git only sees conflicts when two people edit the *same file*. If nobody but you ever opens a file in this folder, there is structurally nothing to conflict over.

---

## 3. The contract you must implement — do not deviate from this shape

Every detection service in BETA (yours and Esha's) exposes the same endpoint:

```
POST /v1/check

Request body:
{
  "text": "string — the AI-generated answer to check",
  "source": "local-gemma",
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

Your service only ever receives requests where `"source": "local-gemma"` — the router (Ahamed's code) sends closed-model requests to Esha instead. You don't need to handle other `source` values; return a 400 if you get one you don't recognize.

**Why this matters:** because your response shape is identical to Esha's, nobody downstream needs to know or care which of you answered. Keep this contract exact — if you need to add a field, add it as optional and tell the team, never rename or remove an existing field without a team conversation first.

---

## 4. Task checklist — do these in order, each is a real milestone

### Week 1 — Environment and first signal
- [ ] `pip install transformer-lens sae-lens torch transformers --upgrade` inside `services/interpretability/` (use a virtualenv, list versions in `requirements.txt`).
- [ ] In `model_loader.py`: write a function `load_model_and_sae(layer: int = 20)` that loads `google/gemma-2-2b-it` via `transformer_lens.HookedTransformer` and the matching Gemma Scope SAE for that layer via `sae_lens`.
- [ ] Milestone: run the model on the sentence `"Barack Obama was born in"`, hook the residual stream at the token for "Obama," pass it through the SAE, print the top active latent indices. This proves your pipeline works end to end. Do not move on until this runs without error.

### Week 2 — Build the ground-truth entity set and find the signal
- [ ] In `entity_dataset.py`: generate ~300 "known" entities (high-frequency real people/places — you can hardcode a curated list, or pull from a public Wikipedia pageview list) and ~300 "unknown" entities (obscure real ones, or ask the model itself to invent 300 plausible fake names). Save this as a table, not a flat file, so the rest of the team can see it too — write it to Postgres (see §5 on migrations).
- [ ] In `sae_probe.py`: for each entity, extract the SAE latent activation at its final token, and confirm there's a statistically distinct pattern between known and unknown groups (e.g., a simple threshold or a tiny logistic regression on the latent vector, not a full new model).
- [ ] Milestone: a function `known_ness_score(entity: str) -> float` that returns a 0–1 score, correct on your held-out test entities at a level clearly better than chance (aim for >75% separation — write this number down, you'll need it for the final report).

### Week 3 — Prove it's causal, not correlational
- [ ] In `causal_steering.py`: write a function that manually boosts the "known" direction on an *unknown* entity during generation, and confirms the model starts hallucinating confident facts about it. Then do the reverse: suppress the direction on a *known* entity and confirm the model becomes uncertain/refuses.
- [ ] This is the single most important result in your part of the project — it's what proves you found the real mechanism, not a coincidence. Save example transcripts (before/after) — you'll want these for the demo.

### Week 4 — Decision point (time-boxed to end of this week)
- [ ] Try extending the same approach to one non-entity hallucination type (e.g., fabricated numbers or fabricated citations). Give yourself a hard deadline — if it doesn't generalize cleanly by end of week 4, that's a fine, honest finding. Write it down and fall back to entity-only scope for the rest of the project. Do not let this open-ended exploration eat into weeks 5–8.

### Weeks 5–6 — Turn it into a live service
- [ ] In `app.py`: build a FastAPI app with a single `POST /v1/check` route matching §3 exactly. Internally: for each entity in the request's `entities` list, call `known_ness_score`, combine into an overall verdict using simple thresholds (e.g., all high → trustworthy, any very low → needs_correction, otherwise uncertain).
- [ ] Add a `GET /health` route that returns `{"status": "ok", "model_loaded": true}` — every service in BETA needs this so a demo-day failure is diagnosable in seconds.
- [ ] Add `latency_ms` timing around the actual inference call, not the whole request.

### Week 7 — Deploy
- [ ] Write a `Dockerfile` that installs `requirements.txt` and runs `app.py` with `uvicorn`.
- [ ] Deploy to Hugging Face Spaces (GPU tier — your service is the one part of BETA that actually needs a GPU). Document the Space URL in this file's top section once live.
- [ ] Give the URL to Ahamed so he can point the dashboard's router at it via an environment variable — never hardcode it.

### Week 8 — Tests and polish
- [ ] `tests/test_probe.py`: at minimum, a test that `known_ness_score` returns a higher score for a known entity than an unknown one, and a test that `/v1/check` returns a valid response shape for a sample request.
- [ ] Re-run your week 2 accuracy number and your week 3 causal example one more time on the deployed version — confirm nothing broke between local and hosted.

---

## 5. Database access — the one shared space, and how to use it without conflicts

You need one table: `entity_labels (entity TEXT, known_flag BOOLEAN, source TEXT)`. Database schema lives in `infra/db/migrations/`, which everyone shares — but it's **append-only**, so it's conflict-free by construction: you only ever add a *new* file, never edit an existing one.

- [ ] Create `infra/db/migrations/0002_entity_labels.sql` (check with the team for the next free number before you create it) containing your `CREATE TABLE` statement. Do not touch any other file in that folder.

---

## 6. How to develop without waiting on anyone else

You never need Esha's, Chandru's, or Ahamed's code running to build or test your service — your service is fully self-contained. If you want to simulate a correction flow (calling Chandru's retrieval service), stub it with a fake HTTP response in your own tests folder rather than pointing at his in-progress code.

## 7. Definition of done

- `/v1/check` returns correct, contract-shaped responses for local-gemma requests
- The causal steering result is reproducible and saved as an example transcript
- Service is deployed and reachable at a stable URL
- `/health` responds
- No file outside `services/interpretability/` was ever modified by you
