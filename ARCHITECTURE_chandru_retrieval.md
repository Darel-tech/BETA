# BETA — Knowledge Store & Retrieval-Grounded Correction
**Owner:** Chandru Lambani
**Repo path you own (and the only path you touch):** `services/retrieval/`
**Also allowed:** appending (never editing) new files under `infra/db/migrations/`; you additionally own `infra/db/schema_notes.md` since you're the database lead

---

## 1. Read this first — what BETA is and where you fit

BETA watches an AI assistant's answer and decides whether it's **trustworthy**, **uncertain**, or **needs_correction**. Darel and Esha build the two detectors that reach that verdict (one by reading model internals, one by checking closed-model behavior). **When either of them decides an answer needs correction, your system is what actually fixes it.**

Your job has two halves:

1. **The knowledge store** — a compact, searchable library of reference facts. Not a giant pile of raw text; a compressed set of "fingerprints" (embeddings) that can be searched in milliseconds even as the library grows large, without eating huge amounts of disk space.
2. **Retrieval-grounded correction** — when a claim is flagged, pull the most relevant facts from that library, hand them to the model along with the original question, and get back a corrected, source-grounded answer instead of a guess.

If you've never built anything like this before: imagine a librarian who, instead of reading every book cover to cover to find an answer, has already made a tiny searchable index card for every paragraph in the library. When someone asks a question, the librarian doesn't reread everything — they instantly pull the 3–5 most relevant index cards and hand them over. That's what your embedding search does. The "index cards" are called **vector embeddings**, and you're going to compress them so they take a fraction of the space raw text would.

---

## 2. Your folder — exact structure to create

```
services/retrieval/
├── ARCHITECTURE.md          # this file, copied here
├── requirements.txt
├── embed_pipeline.py         # turns raw facts into compressed embeddings
├── retrieve.py                # vector similarity search against Neon/pgvector
├── correction.py               # builds the re-prompt and gets a corrected answer
├── app.py                       # FastAPI service exposing /retrieve and /correct
├── Dockerfile
└── tests/
    └── test_retrieval.py

infra/db/
├── schema_notes.md            # you own this — plain-English description of every table
└── migrations/                # SHARED, append-only — see §5
```

**Rule: never create or edit any file outside `services/retrieval/` (plus the two exceptions above).** If you need something from Darel's or Esha's service, call their HTTP endpoint — never import or edit their code. This is what keeps merge conflicts at zero: Git only sees a conflict when two people edit the *same file*. Since this folder belongs only to you, nothing you do here can ever collide with a teammate's work.

---

## 3. The endpoints you expose — Darel and Esha both call these

You don't implement `/v1/check` (that's the detectors' job) — you implement the endpoints *they* call when a correction is needed:

```
POST /retrieve
Request:  { "query": "string", "entities": ["optional"], "k": 5 }
Response: { "facts": ["fact 1 text", "fact 2 text", ...], "latency_ms": 12 }

POST /correct
Request:  { "original_question": "string", "flagged_answer": "string", "facts": ["from /retrieve"] }
Response: { "corrected_answer": "string", "used_facts": ["subset actually cited"] }
```

Keep these two endpoints separate rather than merged — Esha's entailment check (§3 of her file) also calls `/retrieve` directly, without needing a correction, so it must work standalone.

---

## 4. Task checklist — do these in order, each is a real milestone

### Week 1 — Neon setup and the core schema
- [ ] Create the Neon project, enable the `pgvector` extension.
- [ ] Write `infra/db/migrations/0001_enable_pgvector.sql` (`CREATE EXTENSION IF NOT EXISTS vector;`) and `infra/db/migrations/0003_knowledge_chunks.sql` defining:
  ```sql
  CREATE TABLE knowledge_chunks (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    embedding vector(384),
    source TEXT,
    entity_tag TEXT
  );
  CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops);
  ```
  (Number 0002 is reserved for Darel's `entity_labels` table — check with the team for whichever number is actually next free before you create yours; this is a 10-second coordination, not a conflict.)
- [ ] Set up the **Neon + Vercel integration** with Ahamed so every PR gets an isolated database branch automatically — do this together in week 1, it's foundational for the whole team.
- [ ] Document every table in `infra/db/schema_notes.md`, in plain English, as they're added — this file is your responsibility to keep current.

### Week 2 — Build the embedding pipeline
- [ ] `pip install sentence-transformers` inside `services/retrieval/`.
- [ ] In `embed_pipeline.py`: use `all-MiniLM-L6-v2` (384-dimension — deliberately small; do not reach for a 1536-dimension model, it's 4x the storage for negligible quality gain here) to turn a seed set of reference facts into embeddings.
- [ ] Apply **int8 scalar quantization** to the embeddings before storing — this is what actually delivers on "store more, use less space." Roughly a 4x storage reduction versus raw float32, with negligible accuracy loss. `pgvector` supports this natively; document exactly how you configured it in `schema_notes.md` so the team understands the tradeoff you made.
- [ ] Milestone: embed and store at least 200 reference facts (can start with a curated set on your project's topic area, or general Wikipedia summaries) and confirm you can measure actual disk usage before/after quantization — you'll want this number for the final report.

### Week 3 — Retrieval
- [ ] In `retrieve.py`: write `search(query: str, k: int = 5) -> list[str]` that embeds the query the same way (same model, same quantization) and runs a cosine-similarity search against `knowledge_chunks` via `pgvector`.
- [ ] Milestone: for a handful of test questions, confirm the top-5 retrieved facts are actually relevant — this is a manual spot-check, not an automated test yet.

### Week 4 — Correction logic
- [ ] In `correction.py`: write `correct(original_question: str, flagged_answer: str, facts: list[str]) -> str` that builds a prompt like: *"You previously answered [question] with [flagged_answer]. Here are verified facts: [facts]. Give a corrected answer using only these facts, and say so if they don't fully answer the question."* — then calls the model (your own choice: local Gemma-2-2B for local-model corrections, or the relevant API for closed-model ones) and returns the corrected text.
- [ ] Be explicit in the output about what changed — never silently swap the answer with no trace; `used_facts` in the response should show exactly what grounded the correction.

### Weeks 5–6 — Turn it into a live service
- [ ] In `app.py`: FastAPI app exposing `POST /retrieve` and `POST /correct` matching §3 exactly.
- [ ] Add `GET /health` returning `{"status": "ok", "knowledge_chunks_count": N}`.
- [ ] Add basic caching (even an in-memory dict keyed by query is fine) so repeated identical queries during a demo don't hit the database every time.

### Week 7 — Deploy
- [ ] `Dockerfile` installing `requirements.txt`, running `app.py` with `uvicorn`.
- [ ] Deploy as its own small service — Vercel serverless functions are a genuinely good fit for this piece specifically, since retrieval is just a database query with no GPU need (unlike Darel's service). If you deploy on Vercel, do it as a **separate Vercel project pointed at `services/retrieval/` as its root directory**, not inside Ahamed's `apps/web/` project — keeps ownership boundaries clean even at the hosting level.
- [ ] Give the deployed URL to Darel, Esha, and Ahamed as an environment variable name they should expect (`RETRIEVAL_SERVICE_URL`).

### Week 8 — Tests and polish
- [ ] `tests/test_retrieval.py`: a test that a known fact is retrievable by a semantically related (not exact-match) query, and a test that `/correct` produces a response referencing at least one supplied fact.
- [ ] Final disk-usage comparison: raw text size vs. quantized embedding size for your full knowledge base — this is your single most quotable number for the report ("we store N facts in X MB, roughly a 4x reduction versus unquantized embeddings").

---

## 5. Database migrations — shared, but append-only, so it's conflict-free

`infra/db/migrations/` is touched by all four of you, but the rule that makes this safe: **you only ever add a new, uniquely-numbered file — you never edit a file someone else created.** Git cannot produce a conflict from two people adding two different new files. As the database lead, you're the natural person to keep `schema_notes.md` up to date whenever someone adds a table, but the migration files themselves stay untouched once written.

## 6. How to develop without waiting on anyone else

You need real reference facts, but you don't need Darel's or Esha's services running to build or test retrieval and correction — stub the "flagged answer" input with a hardcoded example during weeks 1–4, and connect to their real `/v1/check` output only once you're wiring the full pipeline together in weeks 5–6.

## 7. Definition of done

- `/retrieve` returns genuinely relevant facts for a range of test queries
- `/correct` produces a source-grounded correction that visibly cites what changed
- Quantized storage size is measured and documented against the unquantized baseline
- Service is deployed, reachable, and cached for repeated queries
- `/health` responds
- No file outside `services/retrieval/` (and your two named exceptions) was ever modified by you
