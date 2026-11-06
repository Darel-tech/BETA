# BETA — Antigravity Change Brief (UI/UX, Auth, Admin Monitoring, Live Showcase)

> **Project:** BETA — A Hallucination Firewall (SAE interpretability + semantic entropy)
> **Repo:** https://github.com/Darel-tech/BETA
> **Purpose of this file:** Instruct the coding agent to ADD a polished product layer on top of the existing BETA codebase **without deleting, renaming, or breaking anything that already exists** (APIs, services, migrations, extension, eval harness).
> **Method:** Written using the testing-strategy, user-research, code-review, architecture (ADR), design-system, ux-copy and tech-debt frameworks. Each is applied in its own section.

---

## 0. How to use this file

1. Save this file at the repo root as `ANTIGRAVITY_BRIEF.md` (do not overwrite `README.md` or any `ARCHITECTURE_*.md`).
2. Paste this into Antigravity as the first message:

   > Read `ANTIGRAVITY_BRIEF.md` fully before touching anything. Follow Section 1 (Preservation Protocol) exactly. Start with Phase 0 only, show me the audit and your plan, and wait for my approval before Phase 1. Never run destructive commands.

3. Work phase by phase (Section 15 for the plan, Part B Sections 18 to 20 for the exact task lists). Each phase ends with a green test run and a reviewable commit.
4. A ready-to-paste **master prompt** is in Part C at the end of this file.

**Interpretation notes (assumptions I made; correct them if wrong):**

| Your wording | How this brief interprets it |
|---|---|
| "auth path must be dynamic with all data in the backend" | Auth behaviour (enabled providers, signup mode, allowed domains, role-to-landing-route map, session TTL) is stored in the database and read server-side. No credentials or role logic hardcoded in the frontend. |
| "credentials must be given to me prior" | A seed script generates the first admin credentials, prints them **once** to the terminal for the owner, stores only a hash, and forces a password change on first login. Nothing is committed to Git. Section 16 lists what the owner must supply before work starts. |
| "Gmail passed to admins, usage monitored" | Sign-in with Google (Gmail) plus email/password. Admins can see each user's email, role, status and usage metrics. Users see a plain-language consent notice before this happens (Section 7.4). |
| "Black box vs semantic entropy" | Both are behaviour-based. The real contrast is **white-box** (SAE reads Gemma internals in one pass) vs **black-box** (resample and compare outputs). Naive string-entropy vs **semantic entropy** (entropy over meaning-clusters) is shown as a second comparison inside the black-box path. Details in Section 9. |

---

## 1. PRIME DIRECTIVE: Preservation Protocol (read twice)

The agent is **extending**, not rewriting. These rules override every other instruction in this file.

### 1.1 Before any change

```bash
git status                       # must be clean; if not, STOP and ask
git tag pre-overhaul-$(date +%Y%m%d)
git checkout -b feat/product-layer
```

Also produce `docs/overhaul/00_AUDIT.md` listing every existing file, every exported function/route, every env var, every DB table and migration. This is the "do not break" inventory.

### 1.2 Hard rules

1. **Never delete, rename, or move** an existing file, route, function, table, column, env var, or migration.
2. **Never edit an existing migration.** New schema = new numbered file in `infra/db/migrations/` (check the highest existing number; start after it, expected `0006+`).
3. **Frozen contracts** (changing any of these is a bug):
   - `POST /v1/check` request/response on both detector services.
   - `POST /retrieve` and `POST /correct` on the retrieval service.
   - `GET /health` on every service.
   - Existing `apps/web/app/api/check/route.ts` behaviour for current callers (the extension).
   - You may add **optional** response fields only (see 9.4).
4. **Existing files may be modified only for these reasons**, one at a time, each with a backup and a diff shown to the owner first:
   - Wiring a new component into an existing layout or navigation.
   - Replacing the landing page at `apps/web/app/page.tsx`: first copy the original to `apps/web/components/legacy/OriginalLanding.tsx`, then have `page.tsx` import the new landing.
   - Adding auth guards to *new* routes only. `app/api/check/route.ts` stays callable by the extension (see 8.3).
5. **No `rm -rf`, `git reset --hard`, `git push --force`, `git clean -fd`, `DROP`, `TRUNCATE`, or `DELETE` without a `WHERE` clause.** If a step seems to need one, stop and ask.
6. **No fake data in production paths.** `Math.random()`, hardcoded accuracy numbers, or placeholder charts must never appear in a non-demo path. Mock mode is allowed only when the env var for a service is unset, and the UI must then show a visible **"Demo data"** badge (matches Ahamed's week-2 mock-fallback design).
7. **No secrets in code, logs, commits, or the extension bundle.** `.env*` stays git-ignored; commit `.env.example` with names only.
8. **Ownership boundaries.** The team docs assign folders per person (Darel `services/interpretability/`, Esha `services/blackbox/`, Chandru `services/retrieval/` + `infra/db/schema_notes.md`, Ahamed `apps/web/`, `apps/extension/`, `eval/`). This overhaul deliberately crosses them. To keep merges clean:
   - **One commit per owner folder**, prefixed e.g. `web:`, `interp:`, `blackbox:`, `retrieval:`, `db:`.
   - Service changes are **additive endpoints/fields only**.
   - Never import code across service folders. Call HTTP only.
9. **Every phase ends with**: `lint`, `typecheck`, unit + contract tests green, and an updated `docs/overhaul/CHANGELOG.md`.

### 1.3 Rollback

`git checkout pre-overhaul-<date>` restores the prior state. Migrations added by this work must each have a matching `*_down.sql` kept **outside** `infra/db/migrations/` (in `infra/db/rollbacks/`), never auto-run.

---

## 2. Ground truth: what exists today

**Observed on GitHub (main branch, 2 commits):** `README.md`, `ARCHITECTURE_ahamed_web_eval.md`, `ARCHITECTURE_chandru_retrieval.md`, `ARCHITECTURE_darel_interpretability.md`, `ARCHITECTURE_esha_blackbox.md`. **No application code is visible in the public repo yet.** If code exists only on the team's machines, the agent must audit the local working tree in Phase 0 and treat the architecture docs as the specification for anything not yet built.

### 2.1 System recap (from the architecture docs and the pipeline diagram)

```
Browser Extension ─┐
Web Dashboard/Chat ┴─► apps/web  /api/check  (ROUTER, Next.js on Vercel)
                          │  source = local-gemma ─► services/interpretability  (Darel, HF Spaces GPU)
                          │  source = chatgpt|claude ─► services/blackbox        (Esha, HF Spaces CPU / Railway)
                          │                                   │
                          │                                   └─► services/retrieval /retrieve (Chandru)
                          └─► verdict needs_correction ─► services/retrieval /correct
Neon Postgres (+pgvector): entity_labels, knowledge_chunks, queries_log, benchmark_runs
```

**Interpretability pipeline (7 steps, image 3):** (1) load Gemma-2-2B-it via Hugging Face Transformers + TransformerLens → (2) load Gemma Scope SAE via SAELens at a chosen residual-stream layer → (3) build known/unknown entity dataset (Wikipedia frequency + synthetic fake names) in Neon `entity_labels` → (4) extract SAE latent at the entity token → known-ness score 0–1 → (5) causal verification (boost/suppress the direction) → (6) real-time inference hook reads known-ness live during generation → (7) expose as FastAPI service (`POST /v1/check`, `GET /health`) and call from the Detection Router.

**Black-box pipeline:** resample N times → embed → disagreement = consistency score; plus NLI entailment (`cross-encoder/nli-deberta-v3-small`) of the claim against retrieved facts; `decision_logic.decide(...)` combines them.

### 2.2 Frozen contract (do not deviate)

```jsonc
// POST /v1/check
// request
{ "text": "string", "source": "local-gemma" | "chatgpt" | "claude", "entities": ["optional"] }
// response
{ "verdict": "trustworthy" | "uncertain" | "needs_correction",
  "confidence": 0.0,            // 0..1
  "evidence": ["short strings"],
  "latency_ms": 123 }
```

---

## 3. Goals and non-goals

**Goals**
1. A premium, consistent, animated product UI (landing, auth, chat workspace, live inspector, admin console) in the style of the supplied references (Section 10.1).
2. Real authentication (Google/Gmail + email/password), roles (`user`, `admin`), and a DB-driven auth configuration.
3. A ChatGPT/Claude-style chat where every assistant answer carries a BETA verdict, evidence, and a one-click grounded correction.
4. A **live computation showcase** for judges: stage-by-stage pipeline trace, white-box vs black-box vs semantic-entropy comparison, all from real runs.
5. Admin monitoring of users and usage, with privacy-respecting defaults.
6. Independent, working sections, each degrading gracefully when a backend service is down.

**Non-goals (do not do these)**
- Do not retrain or modify the SAE, Gemma, or detector decision logic.
- Do not change the frozen contracts.
- Do not add a new database engine, or move hosting platforms.
- Do not invent benchmark numbers. Empty states are acceptable; fabricated states are not.

---

## 4. Architecture Decision Records

### ADR-001: Authentication library

**Status:** Proposed. **Deciders:** Ahamed (web owner), Darel (project lead).

**Context.** Next.js on Vercel, Neon Postgres already in the stack, need Google OAuth + email/password, roles, DB-backed sessions, admin-visible user list, and a configurable (dynamic) auth policy.

| Option | Complexity | Fit | Notes |
|---|---|---|---|
| A. Better Auth (+ admin plugin) | Low–Med | **High** | Email/password, Google OAuth, roles and admin features, DB sessions in one library; works with Postgres. |
| B. Auth.js v5 (NextAuth) | Med | Med | Very common, but Credentials provider forces JWT sessions, which complicates server-side revocation and admin session control. |
| C. Custom (Argon2 + cookies) | High | Low | Most security risk for a student team. Avoid. |
| D. Managed (Clerk/Auth0) | Low | Med | Fast, but user data lives off-DB, conflicting with "all data in the backend", and adds cost/vendor lock-in. |

**Decision.** Option A. Fallback: Option B if a blocking issue appears. **Verify the current library version and its docs before installing; do not rely on memory of the API.**

**Consequences.** Easier: one auth system, admin tooling, revocable sessions. Harder: library-owned tables must be created via its migration tool; capture the generated SQL as a numbered migration so the repo stays the source of truth. Revisit if the library cannot satisfy ADR-004.

### ADR-002: Real-time transport for the live showcase

| Option | Complexity | Notes |
|---|---|---|
| A. Server-Sent Events (SSE) | Low | One-way server→client, works on Vercel/Next route handlers, ideal for stage events and token streams. **Chosen.** |
| B. WebSocket | Med–High | Needs a persistent server; poor fit for Vercel serverless. |
| C. Polling | Low | Not truly "real-time"; visibly laggy in a demo. |

**Decision.** SSE for streaming chat + pipeline trace. Events are typed (`stage_started`, `stage_done`, `token`, `score`, `verdict`, `error`). **Consequence:** serverless time limits apply; keep each stream short and cap sample counts (Section 9.3).

### ADR-003: Additive endpoints only on detector services

**Decision.** New capabilities (generation streaming, trace output, entropy clusters) are exposed as **new endpoints** (`/v1/generate`, `/v1/trace/...`) or **optional** response fields. `/v1/check` remains byte-compatible for existing callers. **Consequence:** the old extension and eval harness keep working unchanged; the new UI opts into richer data.

### ADR-004: User data capture and monitoring

**Context.** Admins must see who uses the system and how. Chat prompts can contain personal information.

**Decision.**
- Always log: user id, email, timestamp, route, source model, verdict, confidence, latency, token/cost estimate.
- Prompt/answer **text** is stored only in the user's own `chat_messages` and is visible to admins only through an explicit "Review" action that writes to `audit_log`. Default admin views show metrics, not content.
- A consent screen at first login states exactly this (copy in 10.8).
- Provide user-facing "Export my data" and "Delete my account" actions.

**Consequence.** Slightly more work, but defensible to judges and compatible with India's DPDP Act expectations (notice + consent + purpose limitation). Not legal advice; the team should confirm with their institution's guidelines.

### ADR-005: UI stack

**Decision.** Keep the stack already specified by the web owner: Next.js (App Router) + Tailwind + `shadcn/ui` + `recharts`. Add `motion` (Framer Motion successor) for UI animation and **React Bits** components copied in via their CLI/registry (they are copy-in components, not a locked dependency). Verify each component's current name and install command at reactbits.com before use. **Consequence:** zero new framework risk; animation is opt-in per component and must honour `prefers-reduced-motion`.

---

## 5. Target structure (new files only; nothing below replaces an existing file)

```
apps/web/
├── app/
│   ├── (marketing)/            # new landing sections live here as components
│   ├── (auth)/login/ signup/ forgot-password/ verify-email/ consent/
│   ├── (app)/chat/ chat/[id]/ lab/ settings/ benchmarks-link/   # authenticated workspace
│   ├── admin/                  # overview, users, usage, services, audit, config
│   ├── api/auth/[...all]/      # auth handler
│   ├── api/chat/stream/        # SSE: generate + check + trace
│   ├── api/lab/entropy/        # SSE: semantic-entropy run
│   ├── api/admin/*             # admin-only JSON APIs
│   └── (existing)  page.tsx  dashboard/  status/  api/check/       # KEEP; see 1.2
├── components/
│   ├── ui/                     # design-system primitives (Section 10)
│   ├── motion/                 # wrappers around React Bits pieces
│   ├── chat/ inspector/ admin/ landing/
│   └── legacy/OriginalLanding.tsx   # backup of replaced landing
├── lib/
│   ├── auth/ (server config, guards, policy loader)
│   ├── telemetry/ (event writer)   ├── contracts/ (zod types)
│   └── neon.ts                  # existing, reused
├── styles/tokens.css            # design tokens (Section 10.2)
└── tests/ (unit, contract, e2e)

services/interpretability/   # additive: generate_stream.py (new), app.py gets NEW routes only
services/blackbox/          # additive: entropy_clusters.py (new), optional response fields
contracts/                  # NEW at repo root: JSON Schema for /v1/check, /retrieve, /correct
infra/db/migrations/        # NEW numbered files only
infra/db/rollbacks/         # NEW: manual down scripts, never auto-run
scripts/seed-admin.ts       # NEW
docs/overhaul/              # NEW: AUDIT, CHANGELOG, ADRs, research, test plan
```

---

## 6. Data model (new migrations, append-only)

Start numbering after the highest existing file. Names below are logical; adapt numbers.

```sql
-- app_profiles: extends the auth library's user table (do not alter library tables)
CREATE TABLE app_profiles (
  user_id        TEXT PRIMARY KEY,           -- FK to auth user id (type per library)
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','invited')),
  consent_at     TIMESTAMPTZ,
  consent_version TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  daily_check_limit INT NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_config (                    -- the "dynamic auth path"
  key        TEXT PRIMARY KEY,                -- e.g. 'signup_mode','allowed_domains','providers','landing_route.admin'
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, title TEXT, source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  verdict TEXT, confidence REAL, evidence JSONB, check_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE check_runs (                     -- one row per live pipeline execution (the judge-facing trace)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT, source TEXT NOT NULL,
  verdict TEXT, confidence REAL, latency_ms INT,
  stages JSONB NOT NULL,                      -- [{name, started_ms, ended_ms, payload}]
  est_cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT, event TEXT NOT NULL,          -- 'login','chat_message','check','correction','export'
  meta JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON usage_events (user_id, created_at DESC);

CREATE TABLE audit_log (                      -- append-only; admin actions and content reviews
  id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, meta JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rate_counters (                  -- DB-backed limiter (see tech-debt TD-02)
  bucket TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
```

Document every new table in `infra/db/schema_notes.md` by **appending** a section (Chandru owns that file; tell him).

---

## 7. Authentication, roles, and admin (spec)

### 7.1 Flows
Sign up (email+password or "Continue with Google") → email verification (password signups) → consent screen (first login) → role-based landing route from `auth_config` → app. Also: forgot/reset password, sign out, session list with "sign out everywhere", account deletion.

### 7.2 Dynamic behaviour (all server-side, from `auth_config`)
| Key | Example value | Effect |
|---|---|---|
| `signup_mode` | `"open" \| "invite" \| "closed"` | Controls whether `/signup` works. |
| `allowed_domains` | `["gmail.com", "college.edu"]` or `null` | Restricts who can register. |
| `providers` | `{"google": true, "password": true}` | Login page renders only enabled providers. |
| `landing_route.user` / `landing_route.admin` | `"/chat"`, `"/admin"` | Post-login destination per role. |
| `session_ttl_hours` | `168` | Session lifetime. |

The login page fetches a **public, non-sensitive subset** from a server route. Route guards run in server components/layouts (Postgres cannot be queried from Edge middleware; middleware may only do a cheap cookie-presence redirect).

### 7.3 Admin credential handling ("credentials given to me prior")
- `scripts/seed-admin.ts` creates the first admin from `BOOTSTRAP_ADMIN_EMAIL`, generates a random 20+ character password with `crypto.randomBytes`, **prints it once to the terminal**, stores only the hash, and sets `must_change_password = true`.
- If `BOOTSTRAP_ADMIN_EMAIL` is a Gmail address, the owner can alternatively log in via Google and be promoted by the seed script.
- The agent must **not** write the password to any file, commit, log, or chat message. If the terminal output is lost, re-run the script with `--reset`, which rotates the password.

### 7.4 Gmail and monitoring (consent notice, shown once and versioned)
Admins can see: email, name, role, status, sign-up date, last active, and usage counts. Admins **cannot** read chat content unless they click "Review", which requires a reason and is written to `audit_log`. Users can see this notice in Settings → Privacy at any time.

### 7.5 Admin console (each page independent; loading, empty and error states required)
| Page | Shows (real data) | Actions |
|---|---|---|
| Overview | Active users, checks today, verdict mix, p50/p95 latency, est. cost | — |
| Users | Email, role, status, last active, usage | Suspend, restore, change role, set daily limit |
| Usage | Per-user and per-source charts from `usage_events` / `check_runs` | Export CSV |
| Services | Live `/health` of all four services (reuse the existing status logic) | — |
| Audit | `audit_log` stream | — |
| Config | `auth_config` editor with validation | Save (audited) |

Guard rule: **admin APIs verify the role server-side on every request**. Hiding a button is never an authorization check.

---

## 8. Backend additions (all additive)

### 8.1 Web (Next.js route handlers)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/chat/stream` | POST (SSE) | user | Generate, check, and stream trace events; persists message + `check_runs` row |
| `/api/chat/correct` | POST | user | Calls retrieval `/retrieve` then `/correct`; returns corrected answer and `used_facts` |
| `/api/lab/entropy` | POST (SSE) | user | Semantic-entropy run (Section 9) |
| `/api/admin/*` | GET/POST | admin | Section 7.5 |
| `/api/me/export`, `/api/me/delete` | POST | user | Data portability and erasure |

### 8.2 Service-to-service security (fixes a real gap, see TD-01)
Detector and retrieval services are public HF Spaces URLs. Add an **optional** shared-secret header check (`X-BETA-Service-Key`) enforced **only when** the env var `SERVICE_SHARED_SECRET` is set, so nothing breaks before the secret is rolled out. The router adds the header when it has the secret.

### 8.3 Existing router stays open to the extension
`/api/check` keeps working for the extension as today. Add: per-IP and per-key rate limiting via `rate_counters`, and `usage_events` logging. If an authenticated session is present, attribute the call to the user. Do not require login for the extension path unless the owner decides so later.

### 8.4 Cost and abuse controls
Per-user `daily_check_limit`, hard caps on samples per entropy run, and a global kill switch (`auth_config.checks_enabled`) so a demo-day spike cannot drain API credit.

---

## 9. The live showcase: computation that judges can watch

This is the centrepiece. Every number must come from a real run and be stored in `check_runs.stages`.

### 9.1 Correct framing (so the demo is scientifically honest)
- **White-box (Darel):** reads Gemma's internal state. One forward pass; the SAE latent at the entity token yields a known-ness score. Near-zero marginal cost. Works only for the local model.
- **Black-box (Esha):** sees only text. Needs several sampled generations (paid for closed models) plus NLI against retrieved facts.
- **Semantic entropy** (a black-box-compatible method): sample N answers, group those that mean the same thing (bidirectional NLI entailment), then compute entropy over the **groups**. High entropy means the model keeps changing its story, a sign of confabulation.
- **Naive entropy** (for contrast): entropy over distinct strings. It over-counts paraphrases, which is exactly why semantic entropy is better.

```
Semantic entropy   H_sem = − Σ_c p(c) · log p(c)       c = meaning-cluster, p(c) = share of samples in c
Naive entropy      H_str = − Σ_s p(s) · log p(s)       s = distinct string
Example: "Paris", "It's Paris", "The capital is Paris"  → H_str high (3 strings), H_sem = 0 (1 cluster)
```

Reuse Esha's existing NLI model for the clustering. Do not add a new large model.

### 9.2 Pages
**Live Inspector (right panel in Chat).** Renders the 7-step pipeline from image 3 as an animated vertical stepper. Each stage shows status, elapsed ms, and a small payload (e.g., entity extracted, SAE top latents, known-ness score, NLI result, retrieved facts). Stages light up as SSE events arrive.

**Entropy Lab (`/lab`).** One prompt in, three live lanes out:
1. White-box lane (local Gemma): known-ness score per detected entity, latency, cost ≈ compute only.
2. Black-box lane: N samples streaming in, consistency score, NLI verdict, latency, estimated API cost.
3. Semantic-entropy lane: samples appear, then **animate into clusters** (cards merging), then naive vs semantic entropy values side by side.
A summary strip compares latency, cost, and agreement between lanes. If a lane's service is unreachable, that lane shows its own error state; the others continue.

**Causal proof viewer.** Replay saved before/after transcripts from Darel's week-3 boost/suppress experiment. Label clearly as "recorded experiment", not live. If a live endpoint exists it may be offered separately.

**Benchmarks.** Keep the existing `/dashboard`; link to it. Numbers come from `benchmark_runs` only.

### 9.3 Streaming event schema (SSE)
```jsonc
{ "type": "stage_started", "stage": "sae_extract", "t": 1234 }
{ "type": "stage_done",    "stage": "sae_extract", "ms": 41, "payload": { "entity": "Paris", "known_ness": 0.93 } }
{ "type": "token", "text": " Paris" }
{ "type": "sample", "index": 3, "text": "…" }
{ "type": "cluster", "members": [1,3,4], "label": "Paris" }
{ "type": "verdict", "verdict": "trustworthy", "confidence": 0.91, "evidence": ["…"], "latency_ms": 812 }
{ "type": "error", "stage": "nli", "message": "…", "recoverable": true }
```
Caps: N ≤ 6 samples per web run (configurable by admin up to 10); abort on client disconnect.

### 9.4 Additive service changes
- `services/interpretability`: new `POST /v1/generate` (streams tokens plus per-token known-ness) and optional `trace` field in `/v1/check` responses.
- `services/blackbox`: optional `clusters`, `entropy_semantic`, `entropy_naive`, `samples_used`, `est_cost_usd` fields in `/v1/check` responses.
- Both: never rename or remove an existing field.

---

## 10. Frontend design system (design-system framework)

### 10.1 Reference extraction from the supplied images
**Image 1 (Welcome Back login) and Image 2 ("Neo-Tactile" UI kit)** define the visual language: soft light-lavender canvas, frosted-glass and soft-extruded surfaces, large rounded corners, deep-navy text, one saturated electric-blue accent with a gradient, pill buttons, glowing ring for active or loading controls, tactile toggles and sliders, inset search fields, and a dark segmented control as contrast. Image 1 also fixes the auth layout: centered logo tile, "Welcome Back" heading with a small-caps sub-label, icon-led inputs, show/hide password eye, remember-me checkbox, "Forgot Password?" link, full-width gradient Login button with an arrow chip, then an "or continue with" divider.

> Image 2 contains garbled AI-rendered labels (for example "Defart", "Colded", "Disanner"). Treat it as a **style and component-state reference only**; do not copy its text.

**Image 3 (pipeline poster)** defines the information architecture of the landing "How it works" section and the Inspector stepper (7 steps, 3 weekly bands, a "why it matters" strip).

**Brand:** use the blue flame/"S"-ribbon mark visible in image 1 as the logo tile; recreate it as an SVG (do not rasterise screenshots).

### 10.2 Tokens (`apps/web/styles/tokens.css`; all components consume these, no raw hex in components)

```css
:root {
  /* color: brand + neutral + semantic */
  --bg:            #EEF2FB;   --surface:   rgba(255,255,255,.72);
  --surface-solid: #F7F9FF;   --border:    rgba(30,60,140,.10);
  --text:          #0F1B3D;   --text-muted:#5B6890;
  --brand-500:     #2F6BFF;   --brand-600: #1F54E0;   --brand-300:#7FA6FF;
  --brand-grad:    linear-gradient(135deg,#5B8CFF 0%,#2F6BFF 55%,#1E4FD8 100%);
  --ok:#17B26A;  --warn:#F5A524;  --danger:#E5484D;       /* = trustworthy / uncertain / needs_correction */
  /* radius, spacing, elevation, motion */
  --r-sm:12px; --r-md:20px; --r-lg:28px; --r-pill:999px;
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px; --space-8:32px; --space-12:48px;
  --shadow-1:0 1px 2px rgba(20,40,100,.06), 0 6px 16px rgba(20,40,100,.06);
  --shadow-2:0 10px 30px rgba(20,40,100,.12);
  --inset:   inset 0 2px 6px rgba(20,40,100,.10);
  --glass-blur: 18px;
  --ease: cubic-bezier(.2,.8,.2,1);  --dur-1:120ms; --dur-2:220ms; --dur-3:420ms;
}
[data-theme="dark"] {
  --bg:#0A0F1F; --surface:rgba(20,28,56,.62); --surface-solid:#121A33;
  --border:rgba(160,190,255,.12); --text:#EAF0FF; --text-muted:#9AA8D0;
}
@media (prefers-reduced-motion: reduce) { :root { --dur-1:1ms; --dur-2:1ms; --dur-3:1ms; } }
```
Typography: one sans family (Geist or Inter via `next/font`), scale 12/14/16/18/24/32/48/64, headings 600, body 400, tight tracking on display sizes, mono (Geist Mono / JetBrains Mono) for scores and traces.

### 10.3 Component inventory and required states
Every component below must implement **default, hover, focus-visible, active, disabled, loading, error** where applicable, and be documented in `docs/overhaul/design-system.md` using the document template (variants, props, states, accessibility, do/don't).

| Component | Variants | Notes |
|---|---|---|
| Button | primary (gradient), secondary (soft), ghost, danger; sm/md/lg; with trailing arrow chip | Loading = glowing ring spinner; keep width stable |
| Input / PasswordInput / Select / Textarea | default, error, success | Icon-led, inset focus ring; password eye toggle |
| Checkbox, Switch, Slider, Segmented control | — | Tactile, large hit areas (≥44px) |
| Card / GlassPanel | flat, elevated, interactive | `backdrop-filter` with solid fallback |
| VerdictChip | trustworthy / uncertain / needs_correction | Colour **plus** icon and text (never colour alone) |
| ConfidenceRing | 0–1 | Animated stroke; numeric label always visible |
| StageStepper | idle / running / done / error | Used in Inspector and landing |
| ChatBubble, Composer, ModelPicker | user / assistant / streaming | Composer: Enter sends, Shift+Enter newline |
| Toast, Dialog, Tooltip, Skeleton, EmptyState, ErrorState | — | Copy per 10.8 |
| DataTable, StatCard, Chart wrappers (recharts) | — | Tokenised chart colours |
| CommandPalette (⌘K) | — | Navigate, new chat, switch model |

### 10.4 Motion rules
Purposeful only: entrances (fade/translate ≤ 16px), stage progress, cluster merge, verdict reveal, hover lift. Durations from tokens. Respect `prefers-reduced-motion`. **At most one WebGL/canvas background per page, lazy-loaded, disabled on small screens and low-power devices.** No animation on data-dense admin tables.

### 10.5 React Bits selection map (verify names/installs on https://www.reactbits.com first)
| Where | Component idea | Why |
|---|---|---|
| Landing hero background | Aurora or Silk / Iridescence (tuned to brand blues) | Soft, premium, matches the pastel-glass references |
| Hero headline / badge | BlurText or SplitText; ShinyText for the "Hallucination Firewall" badge; GradientText on one key phrase | Readable, restrained |
| Landing feature grid | MagicBento or SpotlightCard | Communicates 4 pillars (White-box, Black-box, Retrieval, Dashboard) |
| Landing "How it works" | Stepper or ScrollStack driven by the 7-step pipeline | Mirrors image 3 |
| Landing metrics | CountUp fed by **real** `benchmark_runs` aggregates; hide the section if empty | Honesty |
| Landing tech strip | LogoLoop (Hugging Face, Gemma Scope, Neon, Vercel, FastAPI) | Credibility |
| Auth pages | GlassSurface card, Magnet on primary CTA, ClickSpark on submit success | Matches image 1 |
| Chat | TextType for streaming feel only if real tokens drive it; AnimatedList for message and event lists; Orb as "model thinking" indicator | Real-time feel |
| Inspector | StarBorder or ElectricBorder around the **active** stage only | Focus attention |
| Admin | None (use plain tables and charts) | Density over decoration |

**Dribbble** is a mood reference only. Use it to study layout and hierarchy for: "AI chat app", "LLM observability dashboard", "glassmorphism login", "analytics admin 2026". Do not copy shots, assets, or logos.

### 10.6 Patterns to emulate from current best AI products (2026)
Streaming responses with stable layout; a collapsible side panel for "how this was produced" (inspector/trace); inline trust indicators rather than modal warnings; a ⌘K command palette; sensible keyboard shortcuts; model picker in the composer; optimistic UI with visible failure recovery; usage and cost transparency; first-class dark mode.

### 10.7 Page map (consistent shell)
`/` landing · `/login` `/signup` `/forgot-password` `/verify-email` `/consent` · `/chat` `/chat/[id]` · `/lab` · `/dashboard` (existing benchmarks) · `/status` (existing health grid) · `/settings` (profile, privacy, sessions, export/delete) · `/admin/*`.
Shared app shell: left rail (new chat, history, Lab, Benchmarks, Status, Settings), top bar (model picker, theme, user menu), optional right Inspector panel. Mobile: bottom sheet for the Inspector.

### 10.8 UX copy (ux-copy framework; single source in `apps/web/lib/copy.ts`, no hardcoded strings in components)

| Element | Copy |
|---|---|
| Landing H1 | "Know when your AI is making things up." |
| Landing sub | "BETA checks every answer as it is written, using the model's own internals or its behaviour, and shows you the proof." |
| Primary CTA / secondary | "Start checking free" / "See how it works" |
| Login heading / sub | "Welcome back" / "Sign in to continue" |
| Login button / Google | "Sign in" / "Continue with Google" |
| Signup button | "Create account" |
| Forgot link | "Forgot password?" |
| Wrong credentials | "That email or password doesn't match. Check them and try again, or reset your password." |
| Consent title | "Before you start" |
| Consent body | "We record your email and how you use BETA (which checks you run, and when) so admins can keep the service running and fair. Your chat text stays private unless an admin reviews it for a stated reason, and every review is logged. You can export or delete your data in Settings." |
| Consent buttons | "Agree and continue" / "Not now" |
| Composer placeholder | "Ask anything. BETA will check the answer." |
| Verdict labels | "Trustworthy" / "Uncertain" / "Needs correction" |
| Correct button | "Correct with sources" |
| Correction result | "Answer updated using 3 sources. See what changed." |
| Checking state | "Checking this answer…" |
| Empty chat | "No messages yet. Ask a question to see BETA check the answer live." |
| Empty admin usage | "No activity yet. Usage appears here once people start chatting." |
| Service down | "The white-box service isn't responding. Other checks still work. Retry or see status." |
| Rate limit | "You've reached today's check limit. It resets at midnight, or ask an admin to raise it." |
| Suspended | "This account is paused. Contact an admin to restore access." |
| Delete account dialog | Title "Delete your account?" Body "This permanently removes your chats and usage history. It can't be undone." Buttons "Delete account" / "Keep account" |
| Demo-data badge | "Demo data. Connect a service to see live results." |

Voice: clear, calm, no jargon in primary UI (put "SAE", "NLI" in tooltips and the Inspector). Errors follow *what happened + why + how to fix*. Localisation: avoid idioms, allow ~30% text expansion.

### 10.9 Accessibility baseline (WCAG 2.1 AA)
Contrast ≥ 4.5:1 for text (verify glass surfaces against real backgrounds); visible focus rings; full keyboard operation; ARIA live region for streaming and verdict updates; verdicts never colour-only; touch targets ≥ 44px; respects reduced motion; all forms labelled with inline errors.

---

## 11. User research plan (lightweight, college-appropriate)

**Goal:** confirm that the UI makes a verdict understandable in under 10 seconds and that judges can follow the live demo.

| Method | Sample | When | Output |
|---|---|---|---|
| Moderated usability test of chat + verdict + correction | 5–8 (students, non-technical) | After Phase 3 | Task success, time-to-understand, confusion points |
| Demo walkthrough with 2–3 evaluators/mentors | 3 | After Phase 5 | Narrative gaps, jargon list |
| 5-question post-test survey | all participants | Same sessions | Trust and clarity ratings |

**Personas (hypotheses to test):** *Student/Researcher* (checks AI answers for assignments), *Judge/Evaluator* (wants proof quickly), *Admin* (runs the service, watches cost and abuse).
**Jobs-to-be-done:** "When an AI gives me a confident answer, help me decide whether to trust it"; "When I demo this, show the mechanism, not just the result."
**Interview guide (30 min):** warm-up (5) → how they verify AI answers today (10) → task: ask a question and interpret the verdict (10) → reaction to Inspector and Lab (5).
**Tasks and success criteria:** (1) sign up and find a model, ≥ 90% unaided; (2) explain what "Uncertain" means, ≥ 80% correct; (3) find the corrected answer and what changed, ≥ 80%.
**Synthesis:** affinity map, impact/effort matrix; record findings in `docs/overhaul/research.md` and feed changes to copy and layout.

---

## 12. Code review (apply to every PR; also run once over existing code in Phase 0)

**Security:** secrets never client-side or in the extension; authorization checked server-side per request; parameterised SQL only; CSRF protection on cookie-authenticated mutations; SSRF guard on any URL the server fetches (service URLs come only from env); output encoding of model text (never `dangerouslySetInnerHTML` on model output); password hashing handled by the auth library (no custom crypto); rate limits on auth endpoints; email enumeration avoided on login/reset.
**Performance:** no N+1 in admin lists (aggregate in SQL); indexes on `usage_events(user_id, created_at)`; bounded queries and pagination; SSE streams close on disconnect; lazy-load WebGL and charts; Lighthouse performance ≥ 85 on landing.
**Correctness:** empty/null input; service timeouts with per-lane isolation; idempotent migrations; race conditions on rate counters (use atomic `INSERT … ON CONFLICT DO UPDATE`); consistent time zones (store UTC).
**Maintainability:** one contract type source (`contracts/` JSON Schema, zod generated or mirrored); copy in one file; components under ~200 lines; no raw hex in components.

**Review output format for each PR:** Summary → Critical issues table (# / file / line / issue / severity) → Suggestions → What looks good → Verdict (Approve / Request changes / Needs discussion).

---

## 13. Tech-debt register (priority = (Impact + Risk) × (6 − Effort), each 1–5)

Scored from the architecture docs; **re-score after the Phase 0 audit of real code.**

| ID | Item | Type | I | R | E | Priority | Plan |
|---|---|---|---|---|---|---|---|
| TD-06 | Secrets hygiene: confirm `.gitignore`, `.env.example` for every service, no keys in extension | Infra/Sec | 2 | 5 | 1 | **35** | Phase 0 |
| TD-01 | Detector and retrieval endpoints unauthenticated on public Spaces; API budget can be drained | Architecture/Sec | 3 | 5 | 2 | **32** | Phase 1 (8.2) |
| TD-02 | Specified "in-memory" rate limiter does not work across serverless instances | Code | 3 | 4 | 2 | **28** | Phase 1 (`rate_counters`) |
| TD-04 | Migration numbers are assigned by hand (0002–0005), collision risk | Process | 2 | 3 | 1 | **25** | Phase 0: verify numbering; add a CI check for duplicates |
| TD-07 | `ivfflat` index created on an empty table gives poor recall; build after data load or use HNSW; also confirm pgvector's quantisation options (it offers half-precision and binary types; **verify "int8" and the "4x" claim before quoting it in the report**) | Code/Doc | 2 | 3 | 1 | **25** | Phase 0 (flag to Chandru), do not alter existing migration; fix via a new migration |
| TD-03 | No contract/router tests | Test | 4 | 4 | 3 | **24** | Phase 1–2 |
| TD-08 | Contract shapes duplicated across TS and Python, can drift | Code | 3 | 3 | 2 | **24** | `contracts/` JSON Schema + contract tests |
| TD-09 | No tracing or structured logging across services | Infra | 3 | 3 | 2 | **24** | Add optional `X-Request-Id` propagation + `check_runs` |
| TD-05 | Extension DOM selectors for chatgpt.com/claude.ai are brittle | Code | 3 | 3 | 3 | **18** | Out of scope; add selector smoke test and a "last verified" note |
| TD-10 | Documentation: four architecture files not yet copied into service folders | Doc | 1 | 2 | 1 | **15** | Append-only doc task |

**Phased remediation alongside features:** TD-06, TD-04, TD-07 in Phase 0; TD-01, TD-02, TD-08 with Phase 1; TD-03, TD-09 across Phases 2–5; TD-05 and TD-10 as time allows.

---

## 14. Testing strategy (pyramid)

```
        E2E (Playwright)          few, slow, user journeys
     Integration / Contract       router ↔ services, DB, auth
   Unit (Vitest / pytest)         many, fast, pure logic
```

| Area | Test type | Coverage target | Example cases |
|---|---|---|---|
| Contract (`/v1/check`, `/retrieve`, `/correct`, `/health`) | Contract (JSON Schema) against **both** real and mocked services | 100% of fields | Old request shape still accepted; unknown `source` returns 400; added optional fields do not break a strict old-client parser |
| Router `/api/check` | Integration | Branches: local-gemma, chatgpt/claude, env unset → mock + demo flag | Service down returns graceful error; rate limit returns 429 with retry-after |
| Auth guards and roles | Unit + integration | 100% of guard branches | User hitting `/api/admin/*` gets 403; suspended user blocked; closed signup mode rejects; domain allow-list enforced |
| Dynamic auth config | Unit + integration | All keys | Changing `landing_route.admin` changes post-login redirect without redeploy |
| Seed admin script | Unit | Happy + rerun | Password printed once, only hash stored, `--reset` rotates, not written to disk |
| Entropy / clustering | Unit | ≥ 90% | Three paraphrases → 1 cluster, H_sem = 0, H_str > 0; two contradictory answers → 2 clusters; N=1 edge case; empty sample list |
| Usage metering | Unit + DB integration | ≥ 80% | One event per action; daily limit enforced atomically under concurrent requests |
| SSE stream | Integration | Lifecycle | Stage order correct; client disconnect aborts upstream; error event is recoverable |
| UI components | Component tests (Testing Library) | States per component | Button loading keeps width; VerdictChip shows icon + text |
| Accessibility | axe in CI on key pages + keyboard walkthrough | 0 serious violations | Login, chat, admin users |
| E2E journeys | Playwright | 5 journeys | (1) sign up with consent → chat → verdict → correct; (2) Google login (mocked provider in CI); (3) admin sees new user and usage within 5 s; (4) service outage shows per-lane error, app stays usable; (5) suspended user cannot chat |
| Security checks | Targeted tests + dependency audit | — | No secret strings in the extension bundle (grep test); no `dangerouslySetInnerHTML` on model text; cookies are `HttpOnly`, `Secure`, `SameSite` |
| Load (light) | k6 or autocannon | — | 50 concurrent checks do not exceed rate-limit or cost caps |
| Visual regression (optional) | Playwright screenshots | Landing, login, chat | Detect accidental style drift |

**Gaps to close first:** no router/contract tests exist (TD-03). **Rule:** a phase is not done until its tests are in CI and green. Do not delete or weaken existing tests.

---

## 15. Phased execution plan

| Phase | Deliverable | Acceptance criteria |
|---|---|---|
| **0. Audit and safety net** | Tag, branch, `00_AUDIT.md`, inventory of routes/tables/env, baseline test run, TD re-score | Nothing changed except new docs; owner approves the plan |
| **1. Foundations** | `tokens.css`, UI primitives, contracts folder, migrations, rate counters, service-key check (optional mode), auth library wired, seed-admin script | Existing `/api/check`, `/dashboard`, `/status` still work; contract tests green |
| **2. Auth and consent** | Login/signup/reset/verify/consent pages in the image-1 style; Google sign-in; dynamic `auth_config`; role redirects | Journey 1 and 2 pass; guards tested; no secrets in repo |
| **3. Chat workspace** | Shell, history, composer, model picker, SSE streaming, VerdictChip, correction flow with "what changed" | Verdict appears on real runs; correction shows `used_facts`; Demo badge only when mocked |
| **4. Live Inspector and Entropy Lab** | Stage stepper, three-lane lab, cluster animation, white-box vs black-box comparison, recorded causal viewer | All values traceable to `check_runs`; per-lane failure isolation; reduced-motion works |
| **5. Admin console** | Overview, Users, Usage, Services, Audit, Config | Server-side role checks; content review is audited; CSV export |
| **6. Landing page** | Hero, pillars, How-it-works (7 steps), real metrics, tech strip, CTA, footer | Lighthouse perf ≥ 85, a11y ≥ 95; metrics hidden when no data |
| **7. Hardening and polish** | Usability findings applied, axe clean, load test, docs, demo script | Definition of done below |

### Definition of done
- Every existing route, API and migration behaves as before (regression suite green, compared to the `pre-overhaul` tag).
- No fabricated metrics anywhere; demo data is always labelled.
- Admin can see users and usage; users have seen and accepted consent; admin content review is audited.
- Auth behaviour changes from the DB without redeploy.
- Each page works independently when other services are down.
- Design tokens used everywhere; no raw hex in components; documented components.
- `docs/overhaul/CHANGELOG.md`, `design-system.md`, `research.md`, `test-plan.md`, and a 5-minute `DEMO_SCRIPT.md` exist.

---

## 16. What the owner must provide before Phase 1

The agent must **stop and ask** rather than invent any of these.

| Item | Used for |
|---|---|
| `DATABASE_URL` (Neon, preview/dev branch, not production) | All persistence |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Google Cloud OAuth client; redirect URIs for localhost and the Vercel domain) | Gmail sign-in |
| `AUTH_SECRET` (random 32+ bytes) and `APP_BASE_URL` | Session security |
| `BOOTSTRAP_ADMIN_EMAIL` | First admin; password is generated and shown once |
| Email provider key (for verify/reset), e.g. Resend or SMTP | Verification and reset mail |
| `INTERPRETABILITY_SERVICE_URL`, `BLACKBOX_SERVICE_URL`, `RETRIEVAL_SERVICE_URL` | Real calls (otherwise the demo badge shows) |
| `SERVICE_SHARED_SECRET` (optional until rolled out on all services) | Section 8.2 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (server-side only) and model names as env vars | Black-box generation and correction |
| Decision: signup mode (open / invite / closed) and allowed email domains | `auth_config` seed |

Commit `.env.example` listing these **names only**.

---

## 17. Final guardrails for the agent

1. When unsure, **ask**; do not guess and do not "clean up" unrelated code.
2. Show a diff plan before modifying any existing file; prefer creating new files.
3. Verify library versions and component names against their current official docs before installing or using them.
4. Keep commits small, per owner folder, with clear messages.
5. If any instruction here conflicts with Section 1, Section 1 wins.
6. Report at the end of each phase: what changed, what was tested, what remains, and any assumption that needs the owner's confirmation.

---

# PART B: AGENT EXECUTION PLAYBOOK (everything the agent must do, in order)

> Part A (Sections 0 to 17) is the specification. Part B is the work order. Follow it literally. Tick every checkbox in `docs/overhaul/PROGRESS.md` as you go (create that file in Phase 0 and keep it current).

## 18. Operating rules for the agent

### 18.1 Work loop (repeat for every task)
1. **Read** the relevant spec section and the existing files you will touch.
2. **Plan** in 3 to 6 lines: files to create, files to modify (with reason), tests to add.
3. **Check Section 1** (Preservation Protocol). If the plan touches an existing file, show the diff plan to the owner and wait.
4. **Implement** the smallest working slice.
5. **Test**: run lint, typecheck, unit and contract tests. Fix failures before moving on.
6. **Commit** with a prefixed message (`web:`, `interp:`, `blackbox:`, `retrieval:`, `db:`, `docs:`, `test:`), one owner folder per commit.
7. **Update** `PROGRESS.md` and `CHANGELOG.md`.

### 18.2 Stop-and-ask conditions (do not proceed, do not guess)
- Working tree is not clean at start, or the `pre-overhaul` tag cannot be created.
- A required value from Section 16 is missing.
- A task requires editing or deleting an existing file beyond what Section 1.2 allows.
- A frozen contract appears to need a breaking change.
- A test that existed before your changes now fails and the cause is unclear.
- A library's current docs disagree with this brief (report the difference and propose a fix).
- Any command would be destructive (see 1.2 rule 5).

### 18.3 Phase report template (post at the end of every phase)
```
PHASE N REPORT
Done:        [list with file paths]
Tested:      [commands run + results]
Not done:    [list + reason]
Assumptions: [need owner confirmation]
Risks:       [new issues found, with severity]
Existing behaviour verified unchanged: [routes/tests checked]
Next:        [Phase N+1 first 3 tasks]  -> waiting for approval
```

### 18.4 Quality bars (apply to every phase)
- No `any` in new TypeScript unless commented why. Validate all external input with zod.
- No raw hex colours or magic spacing in components; tokens only.
- Every async UI has loading, empty and error states using strings from `lib/copy.ts`.
- Every new endpoint has: input validation, auth check, error handling, a test.
- No `console.log` of secrets, tokens, passwords, or full prompts.
- Commit hooks or CI must run lint and tests; do not bypass with `--no-verify`.

## 19. Phase-by-phase task lists

### Phase 0: Audit and safety net (change nothing except new docs)
- [ ] Run the commands in 1.1 (clean status, tag, branch).
- [ ] Create `docs/overhaul/` with `00_AUDIT.md`, `PROGRESS.md`, `CHANGELOG.md`.
- [ ] Inventory in `00_AUDIT.md`: all files (tree), Next.js routes, API handlers, Python endpoints, env vars used (names only), DB tables and migrations (with numbers), npm and pip dependencies with versions, existing tests, CI config.
- [ ] Check `.gitignore` covers `.env*`, `node_modules`, `__pycache__`, model caches, and each service's `.env`. If not, report; add a new ignore line only after owner approval.
- [ ] Confirm `.env.example` exists per service (names only). Report gaps.
- [ ] Grep the extension folder for anything resembling a secret or API key. Report results.
- [ ] Check migration numbering for duplicates or gaps. Report.
- [ ] Review `knowledge_chunks` index creation (TD-07) and report only; do not edit existing migrations.
- [ ] Run the existing build and tests; record the **baseline** (pass/fail counts, build time) in the audit.
- [ ] Re-score the tech-debt table (Section 13) from real code and add any new items.
- [ ] Write `docs/overhaul/PLAN.md`: confirmed phase list, risks, questions for the owner.
- [ ] **STOP.** Post the Phase 0 report and wait for approval.

### Phase 1: Foundations
**Database (`db:` commits)**
- [ ] Create new migrations for Section 6 tables, numbered after the highest existing. Each idempotent (`IF NOT EXISTS`). Matching manual down scripts in `infra/db/rollbacks/`.
- [ ] Generate the auth library's schema SQL and save it as its own migration. Do not alter the library's tables afterwards.
- [ ] Append the new tables to `infra/db/schema_notes.md` (append only; notify Chandru in the report).
- [ ] Add a CI script that fails on duplicate or non-sequential migration numbers.

**Contracts (`docs:`/`web:`)**
- [ ] Create `contracts/` with JSON Schema for `/v1/check`, `/retrieve`, `/correct`, `/health`, generated from the architecture docs, plus the new SSE event schema (9.3).
- [ ] Create `apps/web/lib/contracts/` zod types mirroring them, plus a test proving both agree.

**Design system (`web:`)**
- [ ] Add `styles/tokens.css` (10.2), wire into the global stylesheet via import only.
- [ ] Add `next/font` for the chosen sans and mono fonts.
- [ ] Build primitives from 10.3 in `components/ui/` with all states, then `docs/overhaul/design-system.md` using the component documentation template.
- [ ] Build a private `/dev/components` gallery route (disabled in production via env flag) showing every component and state.
- [ ] Add `lib/copy.ts` with all strings from 10.8.

**Platform (`web:`)**
- [ ] Install and configure the auth library per ADR-001 (verify current docs). Server config in `lib/auth/`.
- [ ] Implement `lib/auth/policy.ts` that loads `auth_config` with a short in-memory cache (30 s) and safe defaults.
- [ ] Implement guards: `requireUser()`, `requireAdmin()`, `requireActive()` for server components and route handlers.
- [ ] Implement `lib/telemetry/` event writer (`usage_events`, `check_runs`) with failure-safe behaviour (telemetry errors must never break the user request).
- [ ] Implement DB-backed rate limiter using `rate_counters` with atomic upsert; apply to `/api/check` **without changing its response shape** (add 429 only when over limit).
- [ ] Write `scripts/seed-admin.ts` exactly per 7.3, plus `.env.example` additions.
- [ ] Optional service key: add header check in each service **only if** `SERVICE_SHARED_SECRET` is set (`interp:` and `blackbox:` and `retrieval:` commits, each tiny and additive). Router sends the header when it has the secret.
- [ ] Tests: contract tests, guard unit tests, limiter concurrency test, seed script test.
- [ ] Verify: existing `/dashboard`, `/status`, `/api/check` unchanged. Post report.

### Phase 2: Authentication and consent
- [ ] `/login` matching image 1: logo tile, heading, sub-label, icon inputs, password eye, remember-me, forgot link, gradient button with arrow chip, "or continue with" divider, Google button. Providers rendered from the public auth config.
- [ ] `/signup` (respects `signup_mode` and `allowed_domains`), `/forgot-password`, `/reset-password`, `/verify-email`.
- [ ] `/consent` gate: users without `consent_at` for the current `consent_version` are redirected here after login. Copy from 10.8.
- [ ] Post-login redirect by role from `landing_route.*`.
- [ ] Force password change page when `must_change_password` is true.
- [ ] Suspended users see the suspended screen and cannot call any API.
- [ ] Settings: profile, privacy notice, active sessions with "sign out everywhere", export data, delete account (with the confirmation dialog copy).
- [ ] Security checks: rate limit auth endpoints, generic error messages (no email enumeration), secure cookie flags, CSRF verified.
- [ ] Tests: E2E journeys 1, 2 and 5 (Section 14); a11y scan of auth pages.
- [ ] Post report.

### Phase 3: Chat workspace
- [ ] App shell (10.7): left rail, top bar with model picker and theme toggle, optional right panel, mobile bottom sheet.
- [ ] `/api/chat/stream` (SSE): validate input, check auth and daily limit, create or reuse session, stream tokens, call the router for a verdict, persist `chat_messages` and a `check_runs` row, emit events from 9.3. Abort upstream on disconnect.
- [ ] Generation source:
  - `local-gemma`: call the interpretability service's new `/v1/generate` (Phase 4 adds it; until then, show an honest "local model not connected" state, never a fake answer).
  - `chatgpt`/`claude`: server-side call with env-configured model names. Keys never reach the browser.
- [ ] Message UI: streaming bubble, VerdictChip, ConfidenceRing, expandable evidence, copy button, regenerate.
- [ ] "Correct with sources": calls `/api/chat/correct`, shows the corrected answer **with a visible diff and the `used_facts`**. Never silently replace the original.
- [ ] Chat history list, rename, delete (soft delete or user-confirmed hard delete of the user's own data only).
- [ ] ⌘K command palette.
- [ ] Mock behaviour: when a service URL env var is unset, return a clearly labelled demo response and show the Demo data badge.
- [ ] Tests: SSE lifecycle, limit enforcement, correction flow, E2E journey 1, outage handling.
- [ ] Run usability test round 1 (Section 11) if participants are available; record findings.
- [ ] Post report.

### Phase 4: Live Inspector and Entropy Lab
**Interpretability service (`interp:` commits, additive only)**
- [ ] Add `generate_stream.py` and a new `POST /v1/generate` route: stream tokens and, per detected entity, the known-ness score and top SAE latents. Reuse existing functions from `model_loader.py` and `sae_probe.py` by importing within the same folder only.
- [ ] Add an **optional** `trace` field to the `/v1/check` response (stage timings and payloads). Existing fields unchanged.
- [ ] Add tests in the service's `tests/` folder for the new route and for backward compatibility of `/v1/check`.

**Black-box service (`blackbox:` commits, additive only)**
- [ ] Add `entropy_clusters.py`: bidirectional-entailment clustering using the existing NLI model; compute `entropy_semantic` and `entropy_naive` (formulas in 9.1).
- [ ] Add **optional** response fields (`clusters`, `entropy_semantic`, `entropy_naive`, `samples_used`, `est_cost_usd`) to `/v1/check`.
- [ ] Cap samples; cache repeated dev calls to protect API budget.
- [ ] Unit tests for the clustering edge cases listed in Section 14.

**Web (`web:` commits)**
- [ ] Inspector panel: StageStepper wired to SSE events for the 7 pipeline stages, each with elapsed ms and payload summary.
- [ ] `/lab`: three lanes (white-box, black-box, semantic entropy) driven by `/api/lab/entropy`, per-lane error isolation, summary comparison strip (latency, cost, agreement).
- [ ] Cluster animation (samples merging into clusters) respecting reduced motion.
- [ ] Recorded causal-proof viewer, clearly labelled "recorded experiment", sourced from saved transcripts stored as data (ask Darel for the file; if absent, hide the viewer and note it).
- [ ] Persist every run to `check_runs.stages`; add "Replay this run".
- [ ] Tests: stage ordering, lane isolation, entropy display matches service output exactly, E2E journey 4.
- [ ] Post report.

### Phase 5: Admin console
- [ ] `/admin` layout with server-side `requireAdmin()`.
- [ ] Overview, Users, Usage, Services, Audit, Config pages per 7.5, each independent with loading, empty and error states.
- [ ] Users actions (suspend, restore, role change, set daily limit) each write to `audit_log` and cannot remove the last active admin.
- [ ] Content review: requires a reason, shows content, writes to `audit_log` before returning the content.
- [ ] Config editor validates against a schema per key; changes are audited and take effect within the cache window (30 s).
- [ ] CSV export of usage (metrics only, no content).
- [ ] Aggregations in SQL, paginated; verify no N+1 with query logging in tests.
- [ ] Tests: 403 for non-admins on every admin API, last-admin protection, audit writes, E2E journey 3.
- [ ] Post report.

### Phase 6: Landing page
Sections in order: sticky nav (Login, Sign up) → hero (H1, sub, CTAs, soft animated background, live mini-demo of a verdict chip) → four pillars (White-box, Black-box, Retrieval correction, Live dashboard) → How it works (7-step stepper from image 3) → Live proof (real metrics from `benchmark_runs` via CountUp; hide if empty) → White-box vs Black-box vs Semantic entropy explainer with a small interactive cluster demo using a static, labelled example → Trust and privacy (what is monitored, consent summary) → Tech strip → Final CTA → footer.
- [ ] Back up the original landing, then switch `app/page.tsx` to the new landing (Section 1.2 rule 4).
- [ ] React Bits components per 10.5, copied in and verified; one canvas background max, lazy-loaded.
- [ ] SEO: title, description, Open Graph image, sitemap, robots.
- [ ] Performance and a11y budgets met (Section 15, Phase 6).
- [ ] Post report.

### Phase 7: Hardening and handover
- [ ] Apply usability findings (round 2 if possible); update copy and layout.
- [ ] Full E2E, axe, load test, dependency audit (`npm audit`, `pip-audit`); fix or document each finding.
- [ ] Secret scan of the repo and the built extension (no keys).
- [ ] Confirm every tech-debt item marked for these phases is resolved or documented.
- [ ] Write `docs/overhaul/test-plan.md`, finalise `design-system.md`, `research.md`, `CHANGELOG.md`.
- [ ] Write `docs/overhaul/DEMO_SCRIPT.md`: a 5-minute narrative (landing, signup and consent, chat with a trustworthy and a hallucinated answer, Inspector, Entropy Lab comparison, correction, admin view, status page) with exact prompts to type and the expected behaviour of each, plus a fallback plan if a service is down.
- [ ] Final regression against the `pre-overhaul` tag behaviour. Post the final report.

## 20. Environment and tooling notes
- Use the package manager already present in the repo (check lockfile). Do not switch managers.
- Pin new dependency versions exactly; prefer versions released more than two weeks ago.
- Python services: keep each service's own `requirements.txt` and virtualenv; do not share dependencies across services.
- Local dev: provide `docs/overhaul/RUNBOOK.md` with the commands to start the web app, each service (or its mock), and the test suites.
- CI (GitHub Actions): add a new workflow file; do not modify existing workflows. Jobs: lint, typecheck, unit, contract, migration-number check, e2e (on PRs only), secret scan.

---

# PART C: MASTER PROMPT (paste into Antigravity)

```text
ROLE
You are a senior full-stack engineer extending an existing college project called BETA (a hallucination firewall using SAE interpretability and semantic entropy). Repo: https://github.com/Darel-tech/BETA

SOURCE OF TRUTH
Read ANTIGRAVITY_BRIEF.md in the repo root completely before doing anything, then read the four ARCHITECTURE_*.md files and the README. Part A is the specification, Part B is your work order. If anything conflicts, Section 1 (Preservation Protocol) wins.

NON-NEGOTIABLE RULES
1. You ADD to this codebase. You never delete, rename, move or break existing files, routes, functions, tables, migrations, env vars or APIs.
2. Frozen contracts: POST /v1/check, POST /retrieve, POST /correct, GET /health. Only optional fields may be added.
3. Existing migrations are never edited. New schema goes in new, higher-numbered migration files with manual rollback scripts outside the migrations folder.
4. No destructive commands (rm -rf, git reset --hard, force push, git clean, DROP, TRUNCATE, unscoped DELETE).
5. No fake data in production paths. Mock data only when a service env var is unset, always with a visible "Demo data" badge.
6. No secrets in code, logs, commits or the browser extension. Never write the generated admin password anywhere except the one-time terminal print.
7. If you must edit an existing file, show the diff plan first and wait for approval. Prefer new files.
8. If unsure, stop and ask. Do not guess and do not tidy unrelated code.
9. Verify current library versions and React Bits component names against their official docs before using them.

WHAT TO BUILD (summary of the brief)
- Aesthetic, consistent UI (tokens, components, states, accessibility) in the style of the supplied references: pastel glass/neo-tactile, electric blue accent, rounded surfaces, animated but purposeful.
- Authentication: Google (Gmail) and email/password, roles (user, admin), consent screen, DB-driven dynamic auth config, seeded admin whose credentials are printed once to me.
- ChatGPT/Claude-style chat where every answer carries a BETA verdict, evidence, and a source-grounded correction with a visible diff.
- Live Inspector (7-step pipeline trace) and an Entropy Lab comparing white-box (SAE), black-box (resampling + NLI) and semantic entropy vs naive entropy, all from real runs.
- Admin console: users, usage, services health, audit log, config, with privacy-respecting monitoring.
- Landing page with real metrics only.
- Tests (pyramid, contract, E2E, a11y), a tech-debt remediation, docs, and a 5-minute demo script.

HOW TO WORK
- Follow Part B phase by phase. Start with Phase 0 ONLY.
- Use the work loop in Section 18.1 and the report template in Section 18.3.
- At the end of each phase, post the phase report and WAIT for my approval before starting the next.
- Commit per owner folder with prefixes (web:, interp:, blackbox:, retrieval:, db:, docs:, test:).
- Keep docs/overhaul/PROGRESS.md and CHANGELOG.md current.

BEFORE PHASE 1, ASK ME FOR (do not invent): DATABASE_URL (dev branch), Google OAuth client id/secret, AUTH_SECRET, BOOTSTRAP_ADMIN_EMAIL, email provider key, the three service URLs, optional SERVICE_SHARED_SECRET, OpenAI/Anthropic keys and model names, signup mode and allowed email domains.

START NOW
Execute Phase 0 exactly as written in Section 19. Change nothing except new documentation files. Finish with the Phase 0 report and your proposed plan, then stop.
```