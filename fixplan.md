# BETA — Master Fix & Real-Implementation Plan

**Read this entire file before writing a single line of code.** This is the one authoritative execution plan for the BETA repository (`github.com/Darel-tech/BETA`). It supersedes nothing in the four existing `ARCHITECTURE_*.md` files on scope or ownership — it exists to fix a specific, confirmed problem: **the current build is a thin wrapper that asks an AI model a question and prints the answer. It does not detect hallucinations, does not compare models, does not fact-check anything, and runs on mock/stub data that was never swapped for the real pipeline.** That is not what was designed in the architecture docs, and it is not what ships.

This document is written to be executed by a single autonomous coding agent, in order, top to bottom. Each phase has a goal, exact files, exact contracts, and — critically — a **Proof step** that produces real, inspectable output proving the phase is not mocked. Do not mark a phase done without running its Proof step and pasting the actual output into the PR description or commit message.

---

## 0. Ground rules (non-negotiable, apply to every phase)

1. **No mock data survives into the main branch.** A stub is allowed only as a temporary local-dev convenience while a *dependency* service isn't deployed yet (this is explicitly permitted in the architecture docs, e.g. Esha stubbing Chandru's `/retrieve` in week 1–4). It must be deleted or feature-flagged off the moment the real dependency exists. Grep the repo for `mock`, `stub`, `fake`, `TODO`, `hardcoded` before declaring any phase complete — if one of those appears in a code path that runs during a normal user request, the phase is not done.
2. **Every answer shown to the user must come from a real network/model call made at request time.** Gemma-2-2B runs locally via real inference. ChatGPT and Claude are called through their real APIs with real keys. There is no pre-baked "demo transcript" in the request path. (Saved example transcripts for the report, per Darel's week-3 milestone, are fine — they live in `docs/`, never in a live code path.)
3. **Detection must be the actual engineered method, not a confidence-sounding sentence from the same model that produced the answer.** Self-critique ("asking the AI if it's sure") is explicitly banned — Section III-C of the project's own literature review explains why this is unreliable. The only acceptable local-path signal is the Gemma Scope SAE feature score. The only acceptable black-box signal is resampled semantic entropy + NLI entailment against retrieved facts.
4. **Fact-checking must hit a real, populated knowledge store**, not a 5-line hardcoded Python list left in permanently. The int8-quantized FAISS/pgvector index must contain a real corpus (minimum 2,000 Wikipedia passages for the MVP, see Phase 4) before the project is considered functional.
5. **Every service must expose `/health` and be independently curl-able.** If a phase's Proof step can't be done with a plain `curl`, something is architecturally wrong — fix the architecture, not the proof step.
6. **Follow the ownership boundaries already defined** in the four `ARCHITECTURE_*.md` files (`services/interpretability/`, `services/blackbox/`, `services/retrieval/`, `apps/web/` + `apps/extension/` + `eval/`). This plan does not change who owns what — it changes what "done" means inside each folder.
7. **Zero manual steps for the person asking the question.** The moment a question is typed into the app and submitted, everything downstream — which models to ask, which entities to check, whether to fact-check, whether to correct, which evidence to pull — happens automatically. The user never fills in a second field, flips a setting, or clicks a second button to "turn on" checking. Any screen that currently makes the person choose a source, paste in entities, or press a separate "verify" / "fact-check" button after getting an answer is a bug, not a feature — see Phase 5.5.

---

## 1. Diagnosis — what is currently wrong

Run this audit first and record the findings at the top of your first commit:

| Symptom | Root cause | Fixed in phase |
|---|---|---|
| App just forwards the user's question to one model and prints the reply | No detector was ever wired in; `/v1/check` either doesn't exist or isn't called before rendering | Phase 2, 3, 6 |
| No visible verdict, confidence, or evidence anywhere in the UI | Dashboard renders the raw completion instead of the router's contract response | Phase 6 |
| "Fact-checking" is just the same LLM asked to double-check itself | Violates rule 3 above; no retrieval, no NLI, no SAE | Phase 2, 3, 4 |
| Nothing compares Gemma vs ChatGPT vs Claude side by side | The compare feature was never specified in the original 4 docs — it's new work, added below in Phase 5 | Phase 5 |
| Answers/verdicts look identical every time, or respond instantly with no model latency | Mock `/v1/check` response from Ahamed's week-1 scaffolding (`apps/web/app/api/check/route.ts`) is still live | Phase 6, Proof 6.3 |
| User has to pick a model/source, type entity names, or press a separate "check" / "fact-check" button after seeing the answer | Entity extraction, routing, and correction were designed as manual inputs instead of an automatic pipeline triggered by submit | Phase 5.5 |
| Knowledge base is empty or a 5-fact placeholder | Chandru's `embed_pipeline.py` was run on a toy seed list and never re-run on the real corpus | Phase 4 |
| UI looks like a single search box and a text block | No design system, no verdict states, no comparison layout, no charts | Phase 7 |

---

## 2. Target architecture (what "done" looks like)

```
                         ┌─────────────────────────────┐
                         │   apps/web  (Next.js)        │
 User question ───────▶  │   /api/check  (router)       │
                         │   /api/compare (NEW, §5)     │
                         └───────┬───────────┬──────────┘
                                 │           │
                 source=local-gemma     source=chatgpt|claude
                                 │           │
                         ┌───────▼───┐   ┌───▼──────────┐
                         │Interpret- │   │  Blackbox     │
                         │ability svc│   │  detector svc │
                         │(Gemma+SAE)│   │ (resample+NLI)│
                         └───────┬───┘   └───┬──────────┘
                                 │           │
                                 └─────┬─────┘
                                       │ needs_correction?
                                 ┌─────▼─────────┐
                                 │ Retrieval svc  │
                                 │ /retrieve      │
                                 │ /correct       │
                                 └─────┬──────────┘
                                       │
                              ┌────────▼────────┐
                              │ Neon/pgvector or │
                              │ local FAISS index│
                              │ (real corpus)    │
                              └──────────────────┘
```

Every arrow above must be a real HTTP call at request time. No arrow is a function call that returns a hardcoded dict.

---

## 3. Phase 0 — Repo scaffolding sanity check

**Goal:** confirm the monorepo skeleton matches what all four architecture docs assume, before any service logic is written.

**Do:**
```
services/interpretability/   (Darel — owns)
services/blackbox/           (Esha — owns)
services/retrieval/          (Chandru — owns)
apps/web/                    (Ahamed — owns)
apps/extension/              (Ahamed — owns)
eval/                        (Ahamed — owns)
infra/db/migrations/         (shared, append-only)
infra/db/schema_notes.md     (Chandru — owns)
docs/                        (architecture docs + saved transcripts live here)
```
Move the four root-level `ARCHITECTURE_*.md` files into `docs/architecture/` and leave a one-line pointer file at the root (`ARCHITECTURE.md`) linking to all four plus this fix plan. Copy each architecture file into its own service folder as `ARCHITECTURE.md` as the original docs instruct.

**Proof 0:** `tree -L 2` output showing the structure above, committed in the PR description.

---

## 4. Phase 1 — Local model service is real inference, not an API passthrough

**Goal:** `services/interpretability/` runs actual Gemma-2-2B-it inference locally and captures actual activations. This is the thing that was almost certainly faked or skipped in the current build — check first whether `model_loader.py` exists and actually loads weights, or whether the "local model" path is secretly just another API call.

**Do (in `services/interpretability/`):**
- `model_loader.py`: `load_model_and_sae(layer=20)` — loads `google/gemma-2-2b-it` through `transformer_lens.HookedTransformer` (fp16) and the matching Gemma Scope SAE through `sae_lens`. This must download real weights (≈5 GB) on first run. If the agent cannot download weights in its sandbox, it must still write the real loading code and clearly flag in the PR that weight download needs to happen in an environment with internet access — it must **not** silently fall back to calling the OpenAI/Anthropic API and labeling it "local."
- `sae_probe.py`: `known_ness_score(entity: str) -> float` per Darel's architecture doc §4 Week 2 — a real SAE feature extraction and threshold/logistic-regression score, not a `random.random()` placeholder.
- `app.py`: `POST /v1/check` exactly matching the contract in `docs/architecture/ARCHITECTURE_darel_interpretability.md` §3. Response `latency_ms` must be measured with `time.perf_counter()` around the actual inference call.

**Proof 1:**
```bash
curl -X POST localhost:8001/v1/check \
  -d '{"text":"Marie Curie discovered polonium in 1898.","source":"local-gemma","entities":["Marie Curie","polonium"]}'
```
Run it twice with two different entities (one obviously real, one invented, e.g. "Zelphrion Katt"). The two responses must differ in `confidence` and `evidence`, and `latency_ms` should reflect real GPU/CPU inference time (typically 200ms–2s on CPU for a 2B model), not a flat near-zero number.

---

## 5. Phase 2 — Black-box detector makes real resampled API calls

**Goal:** `services/blackbox/` genuinely calls OpenAI and Anthropic `n=10` times per check and computes semantic entropy over real responses — this is very likely the exact place where "just asking AI" crept in, because it's tempting to call the API once and call it done.

**Do (in `services/blackbox/`):**
- `resample_entropy.py`: `consistency_score(question, model, n=10)` — issues `n` real completions at `temperature=1.0`, embeds each with `sentence-transformers` (`all-MiniLM-L6-v2`), clusters by bidirectional NLI entailment (`cross-encoder/nli-deberta-v3-small`), computes entropy over clusters per Farquhar et al. — not an average embedding-distance shortcut, and not a single call repeated in a loop with the result cached and reused.
- `entailment_check.py`: `entailment(claim, reference_facts) -> "supported"|"contradicted"|"unrelated"` using the real NLI cross-encoder against facts pulled from `services/retrieval/`'s real `/retrieve` endpoint (never the week-1–4 stub, once Phase 3 is live).
- `decision_logic.py`: the rule table from the architecture doc — contradicted fact → `needs_correction` regardless of consistency; low consistency alone → `uncertain`; high consistency + supported/unrelated → `trustworthy`.
- Log real token usage and real per-check cost (input + output tokens × published price) — this number is required for the eval harness in Phase 6.

**Proof 2:**
```bash
curl -X POST localhost:8002/v1/check \
  -d '{"text":"The Eiffel Tower was completed in 1887.","source":"chatgpt"}'
```
Check server logs for 10 distinct completions actually received from the OpenAI API (distinct `response_id`s, not one ID repeated), and a non-zero token-cost figure in the response's debug log.

---

## 6. Phase 3 — Retrieval service runs a real, populated vector index

**Goal:** `services/retrieval/` is backed by a real corpus of at least 2,000 passages, not a demo list of 5–20 facts.

**Do (in `services/retrieval/`):**
- `embed_pipeline.py`: ingest a real Wikipedia summaries dump (e.g. the `wikimedia/wikipedia` 20231101 subset on Hugging Face Datasets, filtered to a manageable topic slice — general knowledge + the topics in your eval set is enough; 2,000–20,000 passages). Embed with `all-MiniLM-L6-v2`, apply int8 scalar quantization, store in Neon/pgvector per the schema in the architecture doc.
- `retrieve.py`: `search(query, k=5)` — real cosine-similarity search against the populated table.
- `correction.py`: `correct(original_question, flagged_answer, facts)` — calls the real model (local Gemma or the relevant closed API) with a grounding prompt, returns a corrected answer that visibly cites which retrieved fact(s) it used.

**Proof 3:**
```bash
curl -X POST localhost:8003/retrieve -d '{"query":"when was the Eiffel Tower completed","k":5}'
```
Must return 5 real passage strings pulled from the ingested corpus (not placeholders), and
```sql
SELECT COUNT(*) FROM knowledge_chunks;   -- must be ≥ 2000
```
Also report actual disk size before/after int8 quantization (Chandru's week-8 milestone number) in the PR.

---

## 7. Phase 4 — Router stops returning mock data, forwards for real

**Goal:** `apps/web/app/api/check/route.ts` branches on `source` and forwards to the real deployed service URLs from environment variables. This is the single most likely file still holding the week-1 hardcoded mock response — **check this file first.**

**Do:**
- Remove the hardcoded mock response entirely once `INTERPRETABILITY_SERVICE_URL` and `BLACKBOX_SERVICE_URL` are set.
- Keep a documented, clearly-labeled fallback only for the case where an env var is genuinely unset (service not deployed yet) — and make that fallback visibly say "service unavailable" in the UI, never a fake "trustworthy" verdict.
- Add timeout + error handling: a real network call can fail; the UI must show an explicit error state, never swallow the failure and show stale/fake data.

**Proof 4:** Delete your local `.env` service URLs temporarily and confirm the dashboard shows a clear "detector unavailable" state rather than any verdict at all. Then restore them and confirm a real verdict appears with a plausible non-zero latency.

---

## 8. Phase 5 — NEW: Multi-model Compare & Cross-Verification (this is the feature that was missing)

This is the part the current build never implemented and is the core of what you actually asked for: **put the same question to the local model and to ChatGPT/Claude, fact-check all of them against the same retrieved evidence, and show the user a real comparison, not a single answer.**

**New endpoint, add to the router contract:**
```
POST /api/compare
Request:  { "question": "string", "models": ["local-gemma","chatgpt","claude"] }
Response: {
  "question": "string",
  "results": [
    {
      "model": "local-gemma",
      "answer": "string",
      "verdict": "trustworthy"|"uncertain"|"needs_correction",
      "confidence": 0.0-1.0,
      "evidence": ["..."],
      "corrected_answer": "string | null",
      "latency_ms": 123
    },
    { "model": "chatgpt", ... },
    { "model": "claude", ... }
  ],
  "agreement": {
    "all_agree": true|false,
    "majority_answer_cluster": "string",
    "outliers": ["model names that disagree"]
  },
  "total_latency_ms": 456
}
```

**Do (in `apps/web/app/api/compare/route.ts`, new file, owned by Ahamed's existing folder):**
1. Fan out the question in parallel (`Promise.all`) to: local Gemma generation (interpretability service also needs a plain `/generate` helper if it doesn't have one — add it), ChatGPT, and Claude.
2. For each answer, run it through the correct detector (`/v1/check` with the right `source`) exactly as the router already does for single checks.
3. Independently of each model's own verdict, run a **cross-model entailment pass**: take each pair of answers and run them through the same NLI entailment model used in Phase 2 to detect disagreement between models, not just within one model's resamples. This is a second, genuinely new signal — two different closed models independently agreeing is stronger evidence than one model agreeing with itself.
4. Populate `agreement` from the cross-model entailment pass.
5. Every one of these calls is real: real local inference, two real API calls, real NLI comparisons. No shortcuts.

**Proof 5:**
```bash
curl -X POST localhost:3000/api/compare \
  -d '{"question":"Who won the Nobel Prize in Physics in 2019?","models":["local-gemma","chatgpt","claude"]}'
```
Inspect the response: three different `answer` strings (they should not be byte-identical — if they are, you are calling one model three times, not three distinct models), three different `latency_ms` values, and an `agreement` object that is computed, not hardcoded to `true`.

---

## 8.5. Phase 5.5 — NEW: Eliminate every manual step between "type a question" and "see a verified answer"

This phase exists because the biggest tell of a "dummy" project is a person having to operate it like a lab instrument — pick a model, list the entities by hand, click an extra "fact-check" button. A real product figures all of that out from one text box. Treat every manual input found below as a bug to remove, not a feature to document.

**5.5.1 — No manual entity list.** `entities` is currently specified as an optional field the caller supplies (see the `/v1/check` contract in Phase 1–2). In the app, the user never supplies it. Add a real Named Entity Recognition step that runs automatically, server-side, the instant a question or answer arrives:
- Use a small, fast NER model (`spaCy`'s `en_core_web_sm`, or the NLI cross-encoder's tokenizer-adjacent NER pipeline already in `services/blackbox/`) to extract people, places, organizations, dates, and numbers from both the question and the generated answer.
- Pass the extracted list into `entities` automatically before calling `/v1/check`. The field stays in the contract (so `eval/harness.py` and direct API callers can still override it), but the UI never shows a box for it.
- **Proof 5.5.1:** submit a plain question with no entities typed anywhere (e.g., "When did the Berlin Wall fall?") and confirm the service logs show a non-empty `entities` list that was extracted automatically, not received empty from the client.

**5.5.2 — No manual model/source picker as a precondition to getting checked.** Today the architecture assumes the caller already knows whether to send `source: "local-gemma"` or `"chatgpt"`/`"claude"`. In the product, the default action for *any* question typed into the main input is `/api/compare` (Phase 5) across all three models, run automatically — not a dropdown the user must set before anything happens. A source selector may still exist as an **advanced, collapsed option** for someone who explicitly wants a single-model check, but it must default to "compare all" and must never be a required step to get a result.
- **Proof 5.5.2:** a fresh user, with no settings touched, types a question and presses Enter (or the single submit action) exactly once. The result is a populated `/compare` view with three verdicts — not an empty state waiting on a second input.

**5.5.3 — No manual "fact-check" or "verify" button.** Fact-checking and correction are not a separate step the user triggers after reading the answer — they are part of the same request. The moment any model's detector returns `uncertain` or `needs_correction`, the router automatically calls `/retrieve` and `/correct` on the retrieval service (Phase 3) *before* the response reaches the browser, and the UI renders the corrected panel inline, already filled in. There is no second round trip initiated by a user click.
- **Proof 5.5.3:** ask a question you know will trigger `needs_correction` (e.g., a date you've verified is commonly misstated). Confirm the corrected answer and its cited source fact appear in the *same* response payload as the original flagged answer — check the network tab for exactly one request, not two.

**5.5.4 — No manual copy-paste between the browser extension and the app.** The extension (`apps/extension/`) must auto-detect a new AI message on `chatgpt.com` / `claude.ai` via a `MutationObserver` on `content.js` and automatically fire the check the moment the message finishes streaming (debounce until the DOM stops mutating for ~500ms, so it doesn't fire mid-stream). The user never selects text, never opens a popup to "run" anything, never clicks a browser-action icon to trigger a check — the badge simply appears next to the message a moment after it finishes, the same way a spell-checker underlines a typo without being asked.
- **Proof 5.5.4:** open a real ChatGPT or Claude conversation with the extension installed and idle. Send a message and wait. The verdict badge must appear next to the AI's reply with zero additional clicks from the point the reply finishes generating.

**5.5.5 — No manual retry/refresh on transient failures.** If a downstream service call times out or errors, the router retries automatically (one retry with backoff, per service call) before surfacing an error state to the user. The user is never the one who has to notice a failure and press "try again" for something that was simply a one-off network blip.
- **Proof 5.5.5:** simulate one dropped request to a detector service (e.g., temporarily block it for 2 seconds) and confirm the end-to-end request still succeeds without the user seeing an error or re-submitting.

**What stays manual, deliberately:** the person still has to type the question in the first place, and still has to explicitly open the "advanced" panel if they want to restrict the check to a single named model instead of the default compare-all. Those are the only two user-initiated actions anywhere in the critical path. Everything else — entity extraction, routing, detection, retrieval, correction, retrying on failure, badge placement in the extension — is automatic.

---

## 9. Phase 6 — Evaluation harness proves the numbers in the report are real

**Goal:** `eval/harness.py` runs the real pipeline end-to-end over `eval/datasets/test_questions.json` (minimum 100 questions pulled from TruthfulQA + SQuAD v2-derived + HaluEval, per the project's own literature review) and writes real results to `benchmark_runs`, not synthetic numbers typed into the dashboard.

**Do:**
- `harness.py` must call the real `/api/check` (or `/api/compare`) endpoint for every question — no shortcut that computes AUROC from a spreadsheet.
- `score_benchmark.py` computes precision/recall/F1/AUROC from the logged results and writes them where the dashboard reads them.

**Proof 6:** Run the harness, then
```sql
SELECT COUNT(*) FROM benchmark_runs;  -- must equal the number of eval questions actually run
```
and confirm the dashboard's numbers change if you delete and re-run the harness with a modified subset — if the dashboard number never changes no matter what you do to `benchmark_runs`, it's still hardcoded somewhere in the frontend.

---

## 10. Phase 7 — UI/UX: make it look and behave like a real engineering product

The current UI ("a search box and a paragraph of text") is replaced with the following. Build this with the project's existing `frontend-design` conventions: CSS variables for theming, dark/light support, responsive layout.

**Pages (`apps/web/app/`):**
- `/` (and `/check`, same component) — landing page and the single entry point: a short explainer (architecture diagram, the three verdicts explained) above the fold, then **one input box, one submit action, nothing else required.** Typing a question and pressing Enter runs the full automatic pipeline from Phase 5.5 and lands the user on the `/compare` result for that question — this is the default, zero-configuration path. A collapsed "Advanced" disclosure (closed by default) exposes the single-model source selector for a person who explicitly wants to restrict the check to one model; it is never shown or required before the first result appears.
- `/compare` — **the centerpiece, and the default outcome of every submitted question.** Three columns, one per model, each rendered as a **result card** showing: the answer, a colored verdict badge (green=trustworthy, amber=uncertain, red=needs_correction), a confidence meter (not just a number — a small horizontal gauge), an auto-extracted entity chip list (from Phase 5.5.1, shown read-only — never an editable field the user must fill in), an evidence list, and — when corrected — a clearly marked "Corrected" panel naming the source fact used, already populated inline (never behind a second button), visually distinct from the original answer. A header row shows the `agreement` summary ("All 3 models agree" / "2 of 3 agree, Claude is the outlier") and a highlighted diff when answers disagree.
- `/dashboard` — real benchmark results from `benchmark_runs`: an AUROC-by-method bar chart (recharts), a latency distribution chart, a cost-per-check table for the black-box path, filterable by dataset.
- `/status` — a green/red grid polling every service's real `/health` endpoint every few seconds. This is the page you open first during a live demo.

**Component states required everywhere a network call happens:** loading skeleton, error state with retry, empty state. A result card must never render with blank/undefined fields while still claiming a verdict — if data isn't back yet, show the loading skeleton, not a stale card.

**Design tokens:** define verdict colors once (`--verdict-trustworthy`, `--verdict-uncertain`, `--verdict-needs-correction`) and reuse everywhere; don't hardcode hex codes per component.

**Proof 7:** Record a short screen capture (or a sequence of screenshots) of submitting one real question on `/compare` end to end — input → three real loading states → three real distinct results → agreement summary — and attach it to the final PR.

---

## 11. Real-time performance budget (enforce, don't just hope)

| Path | Budget | How to hit it |
|---|---|---|
| Local Gemma generate + SAE score | < 1.5 s | Single forward pass only (Darel's §3 design), fp16, causally-selected feature subset only (not all 131k features) |
| Black-box check (10 resamples) | < 6 s | Parallelize the 10 completions (`asyncio.gather`), not sequential calls |
| Retrieval `/retrieve` | < 100 ms | In-memory cache keyed by query (Chandru's week-5 milestone); ivfflat index must actually be created, not just the table |
| `/api/compare` total | < 8 s | Fan out model calls and their detectors in parallel, not chained sequentially |

If any of these is blown by more than 2x in testing, that's a correctness-of-architecture issue (e.g., sequential instead of parallel calls) to fix before polishing UI — don't paper over slow real calls with a fake instant response.

---

## 12. Anti-patterns the agent must actively check for and remove

Search the codebase for each of these before declaring the project fixed:

- A detector endpoint that returns a verdict without ever calling the SAE, NLI, or embedding models — i.e., a function that just inspects string length or keyword matches and calls it "detection."
- A `/v1/check` implementation that internally just asks the same LLM "are you sure about this?" and parses the reply as the verdict. (Banned per Rule 3 — self-critique is not semantic entropy and not an SAE probe.)
- A `facts` array that is the same 3–5 strings regardless of the query (proves retrieval isn't actually searching).
- A compare view where two "different" model answers are identical strings (proves only one model is actually being called).
- `confidence` values that are always suspiciously round (`0.9`, `0.5`, `0.1`) across many different real queries — a sign the score is a static lookup rather than computed per request.
- Any API key committed to source control, or present in `apps/extension/` (the architecture doc explicitly bans this — extension code ships to users' browsers and is fully readable).
- Any required form field for entities, source model, or "run check" that sits between the user submitting a question and seeing a verified result — per Rule 7 and Phase 5.5, these must be automatic, not user-supplied.
- An extension popup or button the user must click to start a check on a page they're already viewing — detection must fire on its own once a reply finishes rendering.

---

## 13. Definition of done for this fix plan

- [ ] Every Proof step in Phases 0–7 has been run and its real output recorded in the PR/commit history.
- [ ] `grep -ri "mock\|stub\|fake\|hardcoded" services/ apps/web/app/api apps/extension` returns nothing in a path that executes during a normal user request.
- [ ] `/compare` produces three distinct, independently-sourced answers with a computed agreement summary on a live query.
- [ ] `knowledge_chunks` has ≥ 2,000 real rows and `/retrieve` demonstrably searches them.
- [ ] `/status` shows all services green from real `/health` calls, not a static page.
- [ ] `eval/harness.py` has been run end-to-end at least once against the real pipeline and `benchmark_runs` has rows to show for it.
- [ ] The dashboard's AUROC/latency numbers visibly change when the harness is re-run on a different question subset.
- [ ] UI shows all four states (loading / error / empty / populated) somewhere in a recorded demo.
- [ ] A person with no prior knowledge of the system can type one question, press submit once, and receive a fully fact-checked, three-model comparison with zero other clicks, fields, or settings touched (Proofs 5.5.1–5.5.3).
- [ ] The browser extension flags a live AI reply with no user action after the message finishes streaming (Proof 5.5.4).
- [ ] A single simulated transient failure does not surface an error to the user or require a manual retry (Proof 5.5.5).

Only once every box above is checked does this project match what the four architecture documents — and this plan — actually specify. Until then, it is a prototype of the UI shell, not the hallucination firewall described in the project's own literature review.