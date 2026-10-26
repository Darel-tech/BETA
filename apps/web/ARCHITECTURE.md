# BETA — Web Dashboard, Browser Extension & Evaluation
**Owner:** Ahamed Naseem
**Repo paths you own (and the only paths you touch):** `apps/web/`, `apps/extension/`, `eval/`
**Also allowed:** appending (never editing) new files under `infra/db/migrations/`

---

## 1. Read this first — what BETA is and where you fit

BETA watches an AI assistant's answer and decides whether it's **trustworthy**, **uncertain**, or **needs_correction**. Two teammates build the actual detection brains:

- Darel builds detection for our own local model (looks inside it).
- Esha builds detection for closed models like ChatGPT/Claude (can only see the text).

**You build everything the person and the team actually see and use:** the website that shows results, the browser extension that plugs into real ChatGPT/Claude conversations, and the scoring system that proves the whole project works. You are the glue — but importantly, you are *not* a bottleneck, because you build against a fixed, agreed-upon contract (§3) from day one, using fake data, before either detector is finished.

If you've never built something like this before: picture three separate pieces. First, a **website** (like a company's product page, but showing "here's how well our hallucination checker performs"). Second, a **browser extension** — a tiny program that lives inside someone's Chrome browser, reads what's on the current tab (a ChatGPT conversation, say), and can show extra information on top of it. Third, an **evaluation harness** — basically a report card generator: it runs a batch of test questions through the system and produces the accuracy/speed/cost numbers that go on the website.

---

## 2. Your folders — exact structure to create

```
apps/web/
├── ARCHITECTURE.md              # this file, copied here
├── package.json
├── app/
│   ├── page.tsx                  # landing / explainer page
│   ├── dashboard/page.tsx        # live benchmark results
│   └── api/
│       └── check/route.ts        # THE ROUTER — see §4 week 2
├── components/
├── lib/
│   └── neon.ts                    # Postgres client setup
└── public/

apps/extension/
├── manifest.json                  # Manifest V3
├── content.js                     # reads the AI chat page
├── background.js
├── popup.html
└── popup.js

eval/
├── harness.py
├── datasets/
│   └── test_questions.json
└── scripts/
    └── score_benchmark.py
```

**Rule: never create or edit any file outside these three folders.** If you need something from Darel's, Esha's, or Chandru's service, call their HTTP endpoint — never import or edit their code. This is what keeps merge conflicts at zero: Git only sees a conflict when two people edit the *same file*. Since these three folders belong only to you, nothing you do here can ever collide with a teammate's work.

---

## 3. The contract everyone else implements — you are the one who calls it

```
POST /v1/check   (on Darel's and Esha's services)

Request body:
{
  "text": "string",
  "source": "local-gemma" | "chatgpt" | "claude",
  "entities": ["optional"]
}

Response body:
{
  "verdict": "trustworthy" | "uncertain" | "needs_correction",
  "confidence": 0.0 to 1.0,
  "evidence": ["strings"],
  "latency_ms": 123
}
```

**Your `app/api/check/route.ts` is the router.** It receives requests from the extension or dashboard, looks at `source`, and forwards to Darel's URL (`source: "local-gemma"`) or Esha's URL (`source: "chatgpt" | "claude"`) — both stored as Vercel environment variables (`INTERPRETABILITY_SERVICE_URL`, `BLACKBOX_SERVICE_URL`), never hardcoded. This is also the *only* place that should ever hold a real OpenAI/Anthropic API key server-side — the browser extension must never hold one directly.

---

## 4. Task checklist — do these in order, each is a real milestone

### Week 1 — Scaffolding, against fake data
- [ ] `npx create-next-app@latest` inside `apps/web/`, Tailwind enabled. Add `shadcn/ui` components as needed.
- [ ] Build `app/api/check/route.ts` returning a **hardcoded mock response** matching the contract exactly — don't call anyone's real service yet. This unblocks you completely for weeks 1–4.
- [ ] Build a bare `app/dashboard/page.tsx` that calls your own mock route and displays the verdict. This proves the full loop works before any real detector exists.
- [ ] `apps/extension/manifest.json` (Manifest V3) + `content.js` that just detects it's running on `chatgpt.com` or `claude.ai` and logs the page's latest message to the console. No detection logic yet — just prove the extension can read the page.
- [ ] Push to GitHub, connect the repo to Vercel, confirm auto-deploy works on every push. Set up the **Neon + Vercel integration** (Neon's Vercel marketplace integration) so every pull request automatically gets its own preview deployment *and* its own isolated database branch — this is what keeps four people's database work from colliding.

### Week 2 — Real router logic
- [ ] Update `app/api/check/route.ts` to actually branch on `source` and forward to the right service URL — but keep returning the mock if the environment variable for that service isn't set yet, so you're never blocked if Darel or Esha isn't deployed yet.
- [ ] Add a loading state and an error state to the dashboard — real API calls fail sometimes; the UI should never just hang or crash blank.

### Weeks 2–4 — Extension goes real
- [ ] `content.js`: extract the AI's latest visible message from the DOM (this will need small, separate selectors for chatgpt.com vs claude.ai — expect to maintain these, chat UIs change their HTML over time).
- [ ] Send the extracted text to your `/api/check` route (your own Vercel backend — the extension never calls OpenAI/Anthropic or Darel/Esha directly).
- [ ] `popup.js` / a small injected badge: show the verdict visibly next to the AI's message — green/amber/red, matching `trustworthy` / `uncertain` / `needs_correction`. Never silently change anything the user didn't ask for; always show what happened.

### Weeks 2–4 — Evaluation harness (parallel track)
- [ ] `eval/datasets/test_questions.json`: a set of test questions with known-correct answers, covering both local-model and closed-model paths.
- [ ] `eval/harness.py`: runs every question through `/v1/check` (via your router), logs `{question, verdict, confidence, latency_ms, expected}` — write results into the `benchmark_runs` table (see §5).
- [ ] `eval/scripts/score_benchmark.py`: computes precision/recall/F1 for hallucination detection, plus average latency and (for the black-box path) estimated API cost.

### Weeks 5–6 — Wire in the real services
- [ ] Once Darel's and Esha's services are deployed, set `INTERPRETABILITY_SERVICE_URL` and `BLACKBOX_SERVICE_URL` as real Vercel environment variables. Your router now forwards for real — you should not need to change any router code, only the environment variables, because you built against the contract from week 1.
- [ ] Build `app/dashboard/page.tsx` out fully: a results table/chart (use `recharts`, works cleanly in Next.js) showing the `eval/` harness's real output pulled from `benchmark_runs`.
- [ ] Add a `/status` page that calls every service's `/health` endpoint and shows a simple green/red grid — this is your demo-day lifesaver.

### Week 7 — Production hardening
- [ ] Promote the Vercel project from preview to a production domain.
- [ ] Add basic rate limiting on `/api/check` (a simple in-memory or Vercel KV-based limiter) — protects Esha's paid API budget from being drained by traffic spikes.
- [ ] Confirm no API keys or secrets ever appear in `apps/extension/` code (it ships to users' browsers and is fully inspectable) — audit this explicitly before submitting the extension anywhere.

### Week 8 — Polish and demo prep
- [ ] Add Vercel Analytics and a free-tier error tracker (Sentry) to the web app only.
- [ ] Rehearse the live demo against the real production URL, not localhost — confirm the whole loop (extension → router → real detector → real verdict) works end to end, live.

---

## 5. Database — tables you own

You own `queries_log` and `benchmark_runs`. Add them as new, appended migration files (never edit existing ones):

- [ ] `infra/db/migrations/0004_queries_log.sql`
- [ ] `infra/db/migrations/0005_benchmark_runs.sql`

Check with the team for the next free migration number before creating a file — this is the one point of light coordination needed, and it's a 10-second Slack message, not a merge conflict.

## 6. How to develop without waiting on anyone else

You are structurally never blocked: build the entire dashboard, extension, and eval harness against your own mock `/v1/check` response from week 1, and only swap in real service URLs once they exist. The mock and the real response are the same shape, so nothing downstream needs to change.

## 7. Definition of done

- Dashboard is live on a production Vercel URL, showing real benchmark numbers
- Extension correctly flags a live ChatGPT or Claude conversation with a visible, honest indicator
- `/status` page shows all four services' health at a glance
- Eval harness produces the precision/recall/latency/cost table used in the final report
- No file outside `apps/web/`, `apps/extension/`, or `eval/` was ever modified by you
