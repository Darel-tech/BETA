# BETA Overhaul — Execution Progress

> Authoritative tracker for all deliverables in `ANTIGRAVITY_BRIEF.md`.

---

## Phase 0: Audit & Safety Net
- [x] Run Git commands in 1.1 (clean status check, tag `pre-overhaul-20261106`, branch `feat/product-layer`).
- [x] Create `docs/overhaul/` with `00_AUDIT.md`, `PROGRESS.md`, `CHANGELOG.md`, `PLAN.md`.
- [x] Complete inventory of files, routes, tables, env vars, dependencies, and test suites.
- [x] Audit `.gitignore` and `.env.example` across services.
- [x] Scan browser extension for secrets (clean).
- [x] Audit migration sequence and index configurations (`0006` HNSW verified).
- [x] Run baseline build and tests (blackbox 213 passed, Next.js build clean).
- [x] Re-score tech-debt register with real findings.
- [x] Deliver Phase 0 Report and request Phase 1 configuration inputs.

---

## Phase 1: Foundations
- [ ] DB: Create `0007_product_layer_tables.sql` (`app_profiles`, `auth_config`, `chat_sessions`, `chat_messages`, `check_runs`, `usage_events`, `audit_log`, `rate_counters`) + manual down rollback script in `infra/db/rollbacks/`.
- [ ] DB: Append schema details to `infra/db/schema_notes.md`.
- [ ] Contracts: Add `contracts/` JSON Schemas for `/v1/check`, `/retrieve`, `/correct`, `/health`, and SSE events.
- [ ] Contracts: Add `apps/web/lib/contracts/` Zod definitions & synchronization tests.
- [ ] Design System: Add `apps/web/styles/tokens.css` (pastel glass/neo-tactile tokens) and font configuration.
- [ ] Design System: Add UI primitives in `components/ui/` with full states.
- [ ] Design System: Add `apps/web/lib/copy.ts` with all centralized copy strings.
- [ ] Platform: Configure Better-Auth in `apps/web/lib/auth/` with dynamic DB policy loader (`lib/auth/policy.ts`).
- [ ] Platform: Add server guards `requireUser()`, `requireAdmin()`, `requireActive()`.
- [ ] Platform: Add `lib/telemetry/` failure-safe event writer.
- [ ] Platform: Add atomic DB rate limiter using `rate_counters`.
- [ ] Platform: Write `scripts/seed-admin.ts`.
- [ ] Platform: Add optional `X-BETA-Service-Key` header check across services.
- [ ] Tests: Contract & guard tests passing; regression checks verified.

---

## Phase 2: Authentication & Consent
- [ ] Pages: Implement `/login` matching Image 1 (Welcome Back, logo tile, tactile inputs, gradient button).
- [ ] Pages: Implement `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`.
- [ ] Consent: Implement `/consent` gate with versioned acceptance tracking.
- [ ] Routing: Dynamic post-login role redirection from `auth_config`.
- [ ] Security: Force password change on seeded credentials (`must_change_password`).
- [ ] Security: User suspension enforcement, account deletion & data export endpoints.
- [ ] Tests: E2E auth journeys, security audit, and a11y compliance.

---

## Phase 3: Chat Workspace
- [ ] Shell: Consistent app shell (left rail navigation, model picker, theme controls).
- [ ] Streaming: `/api/chat/stream` SSE handler connecting generation, routing, and live trace.
- [ ] Message UI: Animated chat bubble, VerdictChip, ConfidenceRing, evidence drawer.
- [ ] Grounded Correction: Source-grounded correction drawer with diff viewer and `used_facts`.
- [ ] Session Management: Chat session history, renaming, deletion.
- [ ] Navigation: ⌘K command palette.
- [ ] Graceful degradation: Service outage isolation and "Demo data" badging when env vars are unset.

---

## Phase 4: Live Inspector & Entropy Lab
- [ ] Interpretability: Streamed generation endpoint (`POST /v1/generate`) with live entity known-ness scores.
- [ ] Blackbox: `entropy_clusters.py` computing semantic vs. naive entropy over meaning clusters via NLI.
- [ ] Inspector UI: 7-stage vertical stepper lighting up in real time from SSE events.
- [ ] Entropy Lab UI: 3-lane comparative interface (White-box, Black-box, Semantic Entropy).
- [ ] Visualization: Animated cluster-merging cards with reduced-motion support.
- [ ] Trace: Persist stage timings and payloads to `check_runs.stages` with replay capability.

---

## Phase 5: Admin Console
- [ ] Admin Shell: `/admin` layout with server-side role verification (`requireAdmin()`).
- [ ] Overview: Active users, daily check volume, latency distributions, cost estimates.
- [ ] Users: User management table with suspension, role modification, daily limit controls.
- [ ] Usage: Metrics visualization and CSV export.
- [ ] Services: Live health indicators.
- [ ] Audit Log: Append-only view of admin operations.
- [ ] Config: Dynamic `auth_config` editor.
- [ ] Privacy: Content review strictly logged with mandatory reason.

---

## Phase 6: Landing Page
- [ ] Hero: Headline, CTA, subtle animated background, interactive verdict demo.
- [ ] Pillars: Four pillars showcasing White-box, Black-box, Retrieval, and Dashboard.
- [ ] Mechanism: 7-stage interactive stepper explaining the pipeline.
- [ ] Proof: Dynamic metric counters connected to `benchmark_runs` (hidden if empty).
- [ ] Explainer: Interactive semantic vs naive entropy cluster card.
- [ ] Trust: Transparency and privacy architecture explainer.
- [ ] Tech Strip: Ecosystem badges and footer.

---

## Phase 7: Hardening & Handover
- [ ] Usability updates from test sessions.
- [ ] Accessibility (WCAG 2.1 AA) and security scan cleanups.
- [ ] Documentation: `docs/overhaul/test-plan.md`, `design-system.md`, `research.md`.
- [ ] 5-minute judge demo script: `docs/overhaul/DEMO_SCRIPT.md`.
- [ ] Final regression verification against `pre-overhaul-20261106`.
