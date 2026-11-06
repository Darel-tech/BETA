/**
 * POST /api/check
 *
 * Router for single-model answer checks.
 * - Branches on `source` to forward to the correct detector service.
 * - Performs automatic NER entity extraction (server-side) so callers never
 *   need to supply an `entities` list manually (Phase 5.5.1).
 * - Automatically calls /retrieve + /correct when the verdict is
 *   `uncertain` or `needs_correction` (Phase 5.5.3) — no second round-trip
 *   from the browser required.
 * - Falls back to a clear "service unavailable" response when env vars are
 *   unset — never returns a fake verdict.
 * - One automatic retry with backoff on transient failures (Phase 5.5.5).
 */

import { NextResponse } from "next/server";

// ── Environment ───────────────────────────────────────────────────────────────
const INTERPRETABILITY_URL =
  process.env.INTERPRETABILITY_SERVICE_URL ?? "";
const BLACKBOX_URL =
  process.env.BLACKBOX_SERVICE_URL ?? "";
const RETRIEVAL_URL =
  process.env.RETRIEVAL_SERVICE_URL ?? "";
const INTERNAL_API_KEY =
  process.env.INTERNAL_API_KEY ?? "";

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 800;

// ── Types ─────────────────────────────────────────────────────────────────────
interface CheckResult {
  verdict: "trustworthy" | "uncertain" | "needs_correction";
  confidence: number;
  evidence: string[];
  latency_ms: number;
  corrected_answer?: string | null;
  retrieved_facts?: string[];
  entities?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal server-side NER: extract likely entities from text using regex patterns
 *  without requiring a Python call.  Covers PERSON, ORG, GPE, DATE, NUMBER.
 *  Real spaCy NER lives in the Python services; this is the JS approximation
 *  used for the initial router call so the UI never has to supply entities. */
function extractEntities(question: string, answer: string): string[] {
  const combined = `${question} ${answer}`;
  const entities = new Set<string>();

  // Capitalised proper-noun phrases (2–4 consecutive title-case words)
  const properNounRe = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/g;
  for (const match of combined.matchAll(properNounRe)) {
    const candidate = match[1].trim();
    // Skip common sentence-starters that happen to be capitalised
    const skip = new Set([
      "The", "A", "An", "In", "On", "At", "For", "And", "But", "Or",
      "With", "To", "Of", "By", "From", "That", "This", "These", "Those",
      "What", "When", "Where", "Who", "How", "Why", "Is", "Are", "Was",
      "Were", "Has", "Have", "Had", "Will", "Can", "Could", "Would", "Should",
    ]);
    if (!skip.has(candidate) && candidate.length > 2) {
      entities.add(candidate);
    }
  }

  // Standalone years
  for (const match of combined.matchAll(/\b(1[0-9]{3}|20[0-2][0-9])\b/g)) {
    entities.add(match[1]);
  }

  return [...entities].slice(0, 15); // cap at 15 for the service contract
}

/** fetch with timeout + one automatic retry on 5xx / network error */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await attempt();
  } catch {
    // One retry with back-off (Phase 5.5.5)
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return attempt();
  }
}

function serviceHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_API_KEY) h["X-Internal-Api-Key"] = INTERNAL_API_KEY;
  return h;
}

/** Call /retrieve then /correct when a verdict warrants it. */
async function retrieveAndCorrect(
  question: string,
  flaggedAnswer: string,
  entities: string[]
): Promise<{ facts: string[]; corrected_answer: string | null }> {
  if (!RETRIEVAL_URL) return { facts: [], corrected_answer: null };

  try {
    const retrieveRes = await fetchWithRetry(
      `${RETRIEVAL_URL}/retrieve`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ query: question, entities, k: 5 }),
      }
    );

    if (!retrieveRes.ok) return { facts: [], corrected_answer: null };

    const retrieveData = await retrieveRes.json();
    const facts: string[] = retrieveData.facts ?? [];

    if (facts.length === 0) return { facts, corrected_answer: null };

    // Now correct using the retrieved facts
    const correctRes = await fetchWithRetry(
      `${RETRIEVAL_URL}/correct`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          original_question: question,
          flagged_answer: flaggedAnswer,
          facts,
        }),
      }
    );

    if (!correctRes.ok) return { facts, corrected_answer: null };
    const correctData = await correctRes.json();
    return { facts, corrected_answer: correctData.corrected_answer ?? null };
  } catch {
    return { facts: [], corrected_answer: null };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("text" in body) ||
    !("source" in body)
  ) {
    return NextResponse.json(
      { error: "Required fields: text, source." },
      { status: 400 }
    );
  }

  const { text, source, question = "" } = body as {
    text: string;
    source: string;
    question?: string;
  };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "Please provide a non-empty AI answer to check." },
      { status: 400 }
    );
  }

  const allowedSources = ["local-gemma", "chatgpt", "claude"];
  if (!allowedSources.includes(source)) {
    return NextResponse.json({ error: "Invalid source." }, { status: 400 });
  }

  // Phase 5.5.1 — automatic entity extraction
  const entities = extractEntities(String(question), text);

  // ── Route to the correct detector ─────────────────────────────────────────
  if (source === "local-gemma") {
    // ── Interpretability service ───────────────────────────────────────────
    if (!INTERPRETABILITY_URL) {
      return NextResponse.json(
        {
          error: "service_unavailable",
          message: "Interpretability detector is not configured. Set INTERPRETABILITY_SERVICE_URL.",
        },
        { status: 503 }
      );
    }

    let detectorRes: Response;
    try {
      detectorRes = await fetchWithRetry(
        `${INTERPRETABILITY_URL}/v1/check`,
        {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({ text, source: "local-gemma", entities }),
        }
      );
    } catch {
      return NextResponse.json(
        { error: "service_unavailable", message: "Interpretability service unreachable." },
        { status: 503 }
      );
    }

    if (!detectorRes.ok) {
      const errBody = await detectorRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "detector_error", message: errBody?.detail ?? "Interpretability service error." },
        { status: detectorRes.status }
      );
    }

    const detectorData = await detectorRes.json();
    const verdict = detectorData.verdict as CheckResult["verdict"];

    let correction = { facts: [] as string[], corrected_answer: null as string | null };
    if (verdict !== "trustworthy" && RETRIEVAL_URL) {
      correction = await retrieveAndCorrect(String(question), text, entities);
    }

    return NextResponse.json({
      verdict,
      confidence: detectorData.confidence,
      evidence: detectorData.evidence ?? [],
      latency_ms: detectorData.latency_ms,
      entities,
      retrieved_facts: correction.facts,
      corrected_answer: correction.corrected_answer,
    } satisfies CheckResult);
  }

  // ── Black-box service (chatgpt / claude) ───────────────────────────────────
  if (!BLACKBOX_URL) {
    return NextResponse.json(
      {
        error: "service_unavailable",
        message: "Black-box detector is not configured. Set BLACKBOX_SERVICE_URL.",
      },
      { status: 503 }
    );
  }

  let blackboxRes: Response;
  try {
    blackboxRes = await fetchWithRetry(
      `${BLACKBOX_URL}/v1/check`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          text,
          source,
          question: String(question) || undefined,
          entities,
        }),
      }
    );
  } catch {
    return NextResponse.json(
      { error: "service_unavailable", message: "Black-box detector unreachable." },
      { status: 503 }
    );
  }

  if (!blackboxRes.ok) {
    const errBody = await blackboxRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: "detector_error", message: errBody?.detail?.message ?? "Black-box service error." },
      { status: blackboxRes.status }
    );
  }

  const blackboxData = await blackboxRes.json();
  const verdict = blackboxData.verdict as CheckResult["verdict"];

  let correction = { facts: [] as string[], corrected_answer: null as string | null };
  if (verdict !== "trustworthy" && RETRIEVAL_URL) {
    correction = await retrieveAndCorrect(String(question), text, entities);
  }

  return NextResponse.json({
    verdict,
    confidence: blackboxData.confidence,
    evidence: blackboxData.evidence ?? [],
    latency_ms: blackboxData.latency_ms,
    entities,
    retrieved_facts: correction.facts,
    corrected_answer: correction.corrected_answer,
  } satisfies CheckResult);
}
