# BETA — Overhaul Execution Plan (Phases 1 - 7)

This plan operationalizes `ANTIGRAVITY_BRIEF.md` according to the Preservation Protocol (Section 1).

---

## 1. Architectural Guardrails & Frozen Surface
1. **Additive Schema**: All new schema lives in `infra/db/migrations/0007_product_layer_tables.sql` and higher. Existing migrations `0001`, `0003`, `0006` are never altered.
2. **Frozen APIs**: `POST /v1/check`, `POST /retrieve`, `POST /correct`, `GET /health` remain strictly backward-compatible. Only optional response fields are added.
3. **Existing Web Routes Preserved**: Existing `/api/check`, `/compare`, `/dashboard`, `/status` remain accessible. `/api/check` continues to support extension callers without requiring interactive session authentication.
4. **Zero Client Secrets**: All external model keys (OpenAI, Anthropic) and internal service secrets remain strictly on the backend.
5. **No Synthetic Production Data**: In development or when external service URLs are unset, components degrade gracefully and display the explicit **"Demo data"** badge.

---

## 2. Immediate Next Steps: Phase 1 Foundations
1. **Database Layer (`db:`)**:
   - Write `infra/db/migrations/0007_product_layer_tables.sql` (`app_profiles`, `auth_config`, `chat_sessions`, `chat_messages`, `check_runs`, `usage_events`, `audit_log`, `rate_counters`).
   - Write rollback script `infra/db/rollbacks/0007_product_layer_tables_down.sql`.
   - Append documentation to `infra/db/schema_notes.md`.
2. **Contracts Layer (`docs:`, `web:`)**:
   - Create `contracts/` with JSON Schema definitions for microservice contracts and SSE event specifications.
   - Create `apps/web/lib/contracts/` with Zod schemas and parity tests.
3. **Design System & Styling (`web:`)**:
   - Create `apps/web/styles/tokens.css` with the pastel glass and neo-tactile token palette.
   - Wire `tokens.css` into `globals.css` via clean `@import`.
   - Implement base UI primitives in `apps/web/components/ui/`.
   - Centralize all user-facing copy in `apps/web/lib/copy.ts`.
4. **Auth & Platform (`web:`)**:
   - Configure Better-Auth with Neon PostgreSQL session adapter.
   - Implement dynamic policy loader in `apps/web/lib/auth/policy.ts` with 30s in-memory caching.
   - Implement server route guards: `requireUser()`, `requireAdmin()`, `requireActive()`.
   - Implement telemetry logger in `apps/web/lib/telemetry/`.
   - Write `scripts/seed-admin.ts` with secure one-time terminal password display.

---

## 3. Required Inputs from the Project Owner (Section 16)
Before Phase 1 implementation begins, the following real configuration parameters or defaults must be confirmed:
1. `DATABASE_URL`: Neon connection string for development/preview branch.
2. `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: OAuth credentials for Gmail login.
3. `AUTH_SECRET`: Random 32+ byte string for session encryption.
4. `BOOTSTRAP_ADMIN_EMAIL`: Email address for the initial seeded administrator.
5. Email Provider Configuration: Resend or SMTP credentials for password reset and email verification.
6. Service URLs: `INTERPRETABILITY_SERVICE_URL`, `BLACKBOX_SERVICE_URL`, `RETRIEVAL_SERVICE_URL`.
7. `SERVICE_SHARED_SECRET`: (Optional) Shared secret for service-to-service header authentication.
8. `OPENAI_API_KEY` & `ANTHROPIC_API_KEY`: Server-side model credentials for blackbox generation.
9. Initial `auth_config` policy decisions:
   - `signup_mode`: `"open"` | `"invite"` | `"closed"`
   - `allowed_domains`: `["gmail.com"]` or `null` (allow all).
