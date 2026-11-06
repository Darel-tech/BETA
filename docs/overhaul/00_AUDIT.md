# BETA — Phase 0 Audit & Repository Inventory

> Generated as part of Phase 0 according to the Preservation Protocol (`ANTIGRAVITY_BRIEF.md` Section 1.1 & 19).
> Tag: `pre-overhaul-20261106`
> Working Branch: `feat/product-layer`

---

## 1. Git Status & Safety Tag
- Working tree clean verified prior to tagging.
- Git tag `pre-overhaul-20261106` created.
- Working branch `feat/product-layer` checked out.

---

## 2. Inventory of Existing Routes & Endpoints

### 2.1 Next.js Web Application (`apps/web`)
- `GET /` (`app/page.tsx`): Main interactive query input & architecture overview.
- `GET /compare` (`app/compare/page.tsx`): 3-column multi-model parallel evaluation UI (Gemma, ChatGPT, Claude) with inline grounded correction, confidence meters, and agreement banner.
- `GET /dashboard` (`app/dashboard/page.tsx`): Benchmark results viewer (Accuracy, Precision, Recall, F1, confusion matrix) reading from `/api/benchmark`.
- `GET /status` (`app/status/page.tsx`): Real-time health monitoring page polling `/api/status`.
- `POST /api/check` (`app/api/check/route.ts`): Routing endpoint forwarding `local-gemma` to Interpretability service and `chatgpt`/`claude` to Blackbox service, with automatic NER and automatic retrieval-correction on `uncertain`/`needs_correction`.
- `POST /api/compare` (`app/api/compare/route.ts`): Parallel fan-out generation, cross-model agreement entailment (`/entail`), and per-model detection.
- `GET /api/status` (`app/api/status/route.ts`): Health aggregator for all three backend microservices.
- `GET /api/benchmark` (`app/api/benchmark/route.ts`): Serves `eval/results/benchmark_results.json` from disk.

### 2.2 Local Interpretability Service (`services/interpretability` & `interpretability`)
- `GET /health`: Health status, model load status, probe calibration status, device.
- `POST /v1/check`: SAE latent extraction at layer 20 + logistic probe known-ness scoring. (Frozen contract)
- `POST /generate`: Local Gemma greedy autoregressive answer generation for multi-model compare.

### 2.3 Black-box Service (`services/blackbox`)
- `GET /health`: Health check with detector status and model name.
- `POST /v1/check` / `POST /detect`: Resample consistency + NLI entailment check. (Frozen contract)
- `POST /generate`: Single answer generation via OpenAI/Anthropic SDK.
- `POST /entail`: Cross-model NLI entailment scoring for agreement computation.

### 2.4 Retrieval & Knowledge Service (`services/retrieval`)
- `GET /health` (`app/api/health.py`): DB ping, embedding model status, cache hit metrics.
- `POST /retrieve` (`app/api/retrieve.py`): Cosine similarity search over `knowledge_chunks` with entity boosting. (Frozen contract)
- `POST /correct` (`app/api/correct.py`): LLM-grounded answer correction using verified retrieved citations. (Frozen contract)

---

## 3. Database Schema & Migrations Inventory

Location: `infra/db/migrations/`
1. `0001_enable_pgvector.sql`: `CREATE EXTENSION IF NOT EXISTS vector;`
2. `0003_knowledge_chunks.sql`: Initial `knowledge_chunks` table definition with `embedding vector(384)`.
3. `0006_retrieval_knowledge_chunks_enhancements.sql`: Adds `content_hash VARCHAR(64) UNIQUE`, `embedding_model`, and `idx_knowledge_chunks_embedding_hnsw` (HNSW cosine index).

*Note on Numbering*: Migration numbers are currently non-sequential (`0001`, `0003`, `0006`). Existing migrations are strictly frozen per rule 1.2.2. All new migrations will start strictly above `0006` (e.g., `0007_...sql`).

---

## 4. Dependencies & Tooling

### Web (`apps/web`)
- Package manager: `pnpm` (lockfile present: `pnpm-lock.yaml`, also `package-lock.json`)
- Framework: Next.js `16.4.0` (Turbopack, App Router)
- React: `19.3.0`
- Styling: Tailwind CSS `v4` (`@tailwindcss/turbopack`)
- Linting: ESLint `9.x` with `eslint-config-next`

### Python Services
- Global/System Python: `3.11.9`
- Interpretability: `torch`, `transformer_lens`, `sae_lens`, `fastapi`, `pydantic`, `pydantic-settings`
- Blackbox: `fastapi`, `pydantic`, `sentence-transformers`, `transformers`, `torch`, `openai`, `anthropic`, `pytest`
- Retrieval: `fastapi`, `psycopg[binary,pool]`, `sentence-transformers`, `pydantic-settings`

---

## 5. Security & Secret Hygiene Audit
1. `.gitignore`: Verified covers `.env`, `.env.*`, `!.env.example`, `__pycache__`, `venv`, `.venv`.
2. `.env.example` status:
   - Root: `.env.example` exists.
   - `services/blackbox/.env.example`: exists.
   - `services/retrieval/.env.example`: exists.
   - `interpretability` / `services/interpretability`: needs `.env.example` documenting `INTERNAL_API_KEY`, `DEVICE`, etc.
   - `apps/web`: `.env.local.example` needed documenting `INTERPRETABILITY_SERVICE_URL`, `BLACKBOX_SERVICE_URL`, `RETRIEVAL_SERVICE_URL`, `INTERNAL_API_KEY`, `AUTH_SECRET`, etc.
3. Extension secret scan:
   - Grepped `apps/extension/*` for `key|secret|token|password|auth|bearer`.
   - Result: Clean. Extension calls web app (`http://localhost:3000/api/check`) and holds zero API keys or secrets in browser code.

---

## 6. Baseline Test & Build Status

| Test Suite / Build | Command | Result | Notes |
|---|---|---|---|
| Blackbox Unit Tests | `pytest services/blackbox/tests` | **213 passed** (1.47s) | Clean pass |
| Next.js Web Build | `cd apps/web; npm run build` | **Successful** (Compiled in 1.4s) | Prerendered static & dynamic routes clean. Security advisory noted for Next.js 16.4.0. |
| Retrieval Tests | `pytest services/retrieval/tests` | 18 collected; 1 collection error on unit test requiring live `DATABASE_URL` | Integration tests expect live DB |

---

## 7. Tech-Debt Re-Score (Section 13)

| ID | Item | Original Priority | Re-scored Priority | Notes from Code Audit |
|---|---|---|---|---|
| TD-06 | Secrets hygiene: confirm `.gitignore`, `.env.example` per service, no keys in extension | 35 | **35** | Extension verified clean. Need `.env.example` in web and interpretability. |
| TD-01 | Detector & retrieval endpoints unauthenticated on public spaces | 32 | **32** | `X-Internal-Api-Key` used in code, will add optional `SERVICE_SHARED_SECRET` header check. |
| TD-02 | In-memory rate limiter does not scale serverless | 28 | **28** | To be implemented with `rate_counters` table in Phase 1. |
| TD-04 | Migration numbering gaps (`0001`, `0003`, `0006`) | 25 | **25** | Frozen existing migrations; next new migration is `0007`. |
| TD-07 | `knowledge_chunks` index review: HNSW index already created in `0006` | 25 | **Resolved** | Migration `0006` already uses `hnsw (embedding vector_cosine_ops)` with `m=16, ef_construction=64`. |
| TD-03 | Missing contract/router tests | 24 | **24** | Scheduled for Phase 1 contracts. |
| TD-08 | Contract shapes duplicated across TS/Python | 24 | **24** | Scheduled for Phase 1 (`contracts/` JSON Schema). |
| TD-09 | Structured tracing across services | 24 | **24** | Scheduled for Phase 1 `check_runs`. |
| TD-05 | Extension DOM selectors brittle | 18 | **18** | Extension now uses MutationObserver + debounce. |
| TD-10 | Architecture files in service folders | 15 | **Resolved** | Architecture files copied into service directories. |
