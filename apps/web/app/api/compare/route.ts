/**
 * POST /api/compare
 *
 * Fan-out endpoint: sends the same question to all three models in parallel,
 * runs each answer through its detector, then performs a cross-model entailment
 * pass to compute inter-model agreement.
 *
 * Contract:
 *   Request:  { question: string, models?: ["local-gemma","chatgpt","claude"] }
 *   Response: { question, results: ModelResult[], agreement, total_latency_ms }
 *
 * All calls are real: real local inference via the interpretability service,
 * real API calls via the blackbox service. No pre-baked answers.
 */

import { NextResponse } from "next/server";

// ── Environment ───────────────────────────────────────────────────────────────
const INTERPRETABILITY_URL = process.env.INTERPRETABILITY_SERVICE_URL ?? "";
const BLACKBOX_URL = process.env.BLACKBOX_SERVICE_URL ?? "";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

const REQUEST_TIMEOUT_MS = 30_000; // compare takes longer — 3 parallel pipelines
const RETRY_DELAY_MS = 800;

// ── Types ─────────────────────────────────────────────────────────────────────
type Verdict = "trustworthy" | "uncertain" | "needs_correction";

interface ModelResult {
  model: string;
  answer: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  evidence: string[];
  corrected_answer: string | null;
  retrieved_facts: string[];
  entities: string[];
  latency_ms: number;
  error?: string;
}

interface Agreement {
  all_agree: boolean;
  majority_answer_cluster: string;
  outliers: string[];
}

interface CompareResponse {
  question: string;
  results: ModelResult[];
  agreement: Agreement;
  total_latency_ms: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_API_KEY) h["X-Internal-Api-Key"] = INTERNAL_API_KEY;
  return h;
}

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
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return attempt();
  }
}

/** Server-side NER approximation (mirrors the one in check/route.ts) */
function extractEntities(question: string, answer: string): string[] {
  const combined = `${question} ${answer}`;
  const entities = new Set<string>();
  const skip = new Set([
    "The","A","An","In","On","At","For","And","But","Or","With","To","Of",
    "By","From","That","This","These","Those","What","When","Where","Who",
    "How","Why","Is","Are","Was","Were","Has","Have","Had","Will","Can",
    "Could","Would","Should",
  ]);
  for (const m of combined.matchAll(/\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/g)) {
    const c = m[1].trim();
    if (!skip.has(c) && c.length > 2) entities.add(c);
  }
  for (const m of combined.matchAll(/\b(1[0-9]{3}|20[0-2][0-9])\b/g)) {
    entities.add(m[1]);
  }
  return [...entities].slice(0, 15);
}

// ── Step 1: generate answer from local Gemma via interpretability /generate ──

async function generateLocalAnswer(question: string): Promise<string> {
  if (!INTERPRETABILITY_URL) throw new Error("INTERPRETABILITY_SERVICE_URL not set");
  const res = await fetchWithRetry(`${INTERPRETABILITY_URL}/generate`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.detail ?? `Interpretability /generate returned ${res.status}`);
  }
  const data = await res.json();
  return data.answer ?? data.text ?? "";
}

// ── Step 2: generate answers from closed models via blackbox /generate ────────

async function generateClosedAnswer(
  question: string,
  source: "chatgpt" | "claude"
): Promise<string> {
  if (!BLACKBOX_URL) throw new Error("BLACKBOX_SERVICE_URL not set");
  const res = await fetchWithRetry(`${BLACKBOX_URL}/generate`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ question, source }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.detail ?? `Blackbox /generate returned ${res.status} for ${source}`);
  }
  const data = await res.json();
  return data.answer ?? data.text ?? "";
}

// ── Step 3: run a single-model check via /api/check (internal) ────────────────

async function checkAnswer(
  answer: string,
  source: string,
  question: string,
  entities: string[]
): Promise<{
  verdict: Verdict;
  confidence: number;
  evidence: string[];
  latency_ms: number;
  corrected_answer: string | null;
  retrieved_facts: string[];
}> {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetchWithRetry(`${origin}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: answer, source, question, entities }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.message ?? `Check returned ${res.status} for ${source}`);
  }
  const data = await res.json();
  return {
    verdict: data.verdict,
    confidence: data.confidence,
    evidence: data.evidence ?? [],
    latency_ms: data.latency_ms ?? 0,
    corrected_answer: data.corrected_answer ?? null,
    retrieved_facts: data.retrieved_facts ?? [],
  };
}

// ── Step 4: cross-model NLI entailment agreement via blackbox /entail ─────────

async function computeCrossModelAgreement(
  answers: { model: string; answer: string }[]
): Promise<Agreement> {
  const validAnswers = answers.filter((a) => a.answer);
  if (validAnswers.length < 2) {
    return {
      all_agree: validAnswers.length <= 1,
      majority_answer_cluster: validAnswers[0]?.answer?.slice(0, 120) ?? "",
      outliers: [],
    };
  }

  // Try to call the blackbox /entail endpoint for real NLI cross-model comparison
  if (BLACKBOX_URL) {
    try {
      const res = await fetchWithRetry(
        `${BLACKBOX_URL}/entail`,
        {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({ answers: validAnswers }),
        },
        10_000
      );
      if (res.ok) {
        const data = await res.json();
        return {
          all_agree: data.all_agree ?? false,
          majority_answer_cluster: data.majority_cluster ?? validAnswers[0].answer.slice(0, 120),
          outliers: data.outliers ?? [],
        };
      }
    } catch {
      // Fall through to local heuristic
    }
  }

  // Fallback: simple lexical similarity heuristic when NLI service unavailable
  // Check whether all answers share enough overlapping content words
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

  const sets = validAnswers.map((a) => tokenize(a.answer));
  const pairwiseJaccard = (a: Set<string>, b: Set<string>) => {
    const intersection = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : intersection / union;
  };

  let minSim = 1;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      minSim = Math.min(minSim, pairwiseJaccard(sets[i], sets[j]));
    }
  }

  const AGREE_THRESHOLD = 0.25; // Jaccard ≥ 0.25 → "agree"
  const all_agree = minSim >= AGREE_THRESHOLD;

  // Identify outlier: the answer with lowest average similarity to others
  const avgSims = sets.map((s, i) => {
    const others = sets.filter((_, j) => j !== i);
    const avg = others.reduce((sum, o) => sum + pairwiseJaccard(s, o), 0) / others.length;
    return { model: validAnswers[i].model, avg };
  });
  avgSims.sort((a, b) => a.avg - b.avg);
  const outliers = all_agree
    ? []
    : avgSims.slice(0, 1).filter((x) => x.avg < AGREE_THRESHOLD).map((x) => x.model);

  return {
    all_agree,
    majority_answer_cluster: validAnswers[0].answer.slice(0, 120),
    outliers,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("question" in body)) {
    return NextResponse.json(
      { error: 'Required field: "question".' },
      { status: 400 }
    );
  }

  const { question, models = ["local-gemma", "chatgpt", "claude"] } = body as {
    question: string;
    models?: string[];
  };

  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json(
      { error: "question must be a non-empty string." },
      { status: 400 }
    );
  }

  const allowedModels = ["local-gemma", "chatgpt", "claude"];
  const requestedModels = (Array.isArray(models) ? models : allowedModels).filter((m) =>
    allowedModels.includes(m)
  );

  if (requestedModels.length === 0) {
    return NextResponse.json(
      { error: 'models must be a non-empty array of "local-gemma"|"chatgpt"|"claude".' },
      { status: 400 }
    );
  }

  const totalStart = Date.now();

  // ── Phase A: fan-out generation in parallel ────────────────────────────────
  const generationTasks = requestedModels.map(async (model) => {
    const start = Date.now();
    try {
      let answer: string;
      if (model === "local-gemma") {
        answer = await generateLocalAnswer(question);
      } else {
        answer = await generateClosedAnswer(question, model as "chatgpt" | "claude");
      }
      return { model, answer, latency_ms: Date.now() - start, error: null };
    } catch (err) {
      return {
        model,
        answer: "",
        latency_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const generated = await Promise.all(generationTasks);

  // ── Phase B: fan-out detection in parallel ────────────────────────────────
  const detectionTasks = generated.map(async (gen) => {
    if (gen.error || !gen.answer) {
      return {
        model: gen.model,
        answer: null as string | null,
        verdict: null as Verdict | null,
        confidence: null as number | null,
        evidence: [] as string[],
        corrected_answer: null as string | null,
        retrieved_facts: [] as string[],
        entities: [] as string[],
        latency_ms: gen.latency_ms,
        error: gen.error ?? "No answer generated",
      };
    }

    const entities = extractEntities(question, gen.answer);
    const checkStart = Date.now();
    try {
      const checkResult = await checkAnswer(gen.answer, gen.model, question, entities);
      return {
        model: gen.model,
        answer: gen.answer,
        verdict: checkResult.verdict,
        confidence: checkResult.confidence,
        evidence: checkResult.evidence,
        corrected_answer: checkResult.corrected_answer,
        retrieved_facts: checkResult.retrieved_facts,
        entities,
        latency_ms: gen.latency_ms + (Date.now() - checkStart),
        error: undefined,
      };
    } catch (err) {
      return {
        model: gen.model,
        answer: gen.answer,
        verdict: null as Verdict | null,
        confidence: null as number | null,
        evidence: [] as string[],
        corrected_answer: null as string | null,
        retrieved_facts: [] as string[],
        entities,
        latency_ms: gen.latency_ms + (Date.now() - checkStart),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const results: ModelResult[] = await Promise.all(detectionTasks);

  // ── Phase C: cross-model agreement ────────────────────────────────────────
  const answersForAgreement = results
    .filter((r) => r.answer)
    .map((r) => ({ model: r.model, answer: r.answer as string }));

  const agreement = await computeCrossModelAgreement(answersForAgreement);

  const response: CompareResponse = {
    question,
    results,
    agreement,
    total_latency_ms: Date.now() - totalStart,
  };

  return NextResponse.json(response);
}
