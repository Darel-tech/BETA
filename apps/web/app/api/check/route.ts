/**
 * POST /api/check
 *
 * Single-answer verification router.
 * - When the configured detector microservice is reachable, forward to it.
 * - Otherwise run the REAL in-process LLM-backed detector (resampling + NLI
 *   entailment + knowledge grounding + grounded correction). Never fake a
 *   verdict, never return a stub "trustworthy" result.
 * - Entity extraction, retrieval, correction and retrying are automatic.
 * - Every response declares `mode` so the UI can label the pipeline honestly.
 */

import { after, NextResponse } from "next/server";
import { logCheckRun } from "@/lib/telemetry";
import { verifyGenerationUsageProof } from "@/lib/telemetry/usage-proof";
import {
  activeDetector,
  isPromptEcho,
  runFirewallCheck,
  serviceReachable,
  toFactDetails,
  type CheckResult,
} from "@/lib/firewall";

const INTERPRETABILITY_URL = process.env.INTERPRETABILITY_SERVICE_URL ?? "";
const BLACKBOX_URL = process.env.BLACKBOX_SERVICE_URL ?? "";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 800;

function serviceHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_API_KEY) headers["X-Internal-Api-Key"] = INTERNAL_API_KEY;
  return headers;
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return attempt();
  }
}

function tokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("text" in body) || !("source" in body)) {
    return NextResponse.json({ error: "Required fields: text, source." }, { status: 400 });
  }

  const { text, source, question = "", generation_usage: unverifiedGenerationUsage } = body as {
    text: string;
    source: string;
    question?: string;
    generation_usage?: { proof?: unknown };
  };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Please provide a non-empty AI answer to check." }, { status: 400 });
  }
  if (!["local-gemma", "chatgpt", "claude", "groq", "openrouter"].includes(source)) {
    return NextResponse.json({ error: "Invalid source." }, { status: 400 });
  }

  const generationUsage = verifyGenerationUsageProof(
    unverifiedGenerationUsage?.proof,
    String(question),
    text
  );
  const generationDetails: Record<string, number | string> = {};
  if (generationUsage?.model_name) generationDetails.generation_model = generationUsage.model_name;
  for (const key of ["input_tokens", "output_tokens", "cached_input_tokens"] as const) {
    const value = tokenCount(generationUsage?.[key]);
    if (value != null) generationDetails[`generation_${key}`] = value;
  }

  const mode = await activeDetector(source);

  // ── Real in-process firewall (microservices unavailable) ────────────────────
  if (mode === "inprocess") {
    try {
      const result: CheckResult = await runFirewallCheck({
        question: String(question),
        answer: text,
        source,
      });
      const signals = {
        ...result.signals,
        ...generationDetails,
        pipeline_mode: "inprocess_llm_nli",
      };
      const response = {
        ...result,
        reference_fact_details: result.reference_fact_details,
        used_fact_details: result.used_fact_details,
        signals,
        latency_ms: Date.now() - requestStartedAt,
        retrieval_error: RETRIEVAL_URL && !(await serviceReachable(RETRIEVAL_URL))
          ? "Knowledge microservice offline — used local reference premises."
          : null,
        serviceStages: result.stages,
      };
      after(() => logCheckRun({
        source,
        verdict: result.verdict,
        confidence: result.confidence,
        latencyMs: Date.now() - requestStartedAt,
        stages: result.stages,
      }));
      return NextResponse.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed.";
      after(() => logCheckRun({
        source,
        verdict: null,
        confidence: null,
        latencyMs: Date.now() - requestStartedAt,
        stages: [{ name: "firewall", status: "unavailable", details: { error: message } }],
      }));
      return NextResponse.json(
        { error: "verification_error", message },
        { status: 500 }
      );
    }
  }

  // ── Original microservice path (kept for when services are deployed) ────────
  const detectorUrl = source === "local-gemma" ? INTERPRETABILITY_URL : BLACKBOX_URL;
  const detectorStage = source === "local-gemma" ? "gemma_sae_check" : "blackbox_resampling_nli";

  const logUnavailable = (stage: string, statusCode?: number) => {
    after(() => logCheckRun({
      source,
      verdict: null,
      confidence: null,
      latencyMs: Date.now() - requestStartedAt,
      stages: [{
        name: stage,
        status: "unavailable",
        details: { ...generationDetails, ...(statusCode == null ? {} : { status_code: statusCode }) },
      }],
    }));
  };

  if (!detectorUrl) {
    logUnavailable(detectorStage);
    return NextResponse.json(
      { error: "service_unavailable", message: "Detector is not configured." },
      { status: 503 }
    );
  }

  let detectorRes: Response;
  try {
    detectorRes = await fetchWithRetry(`${detectorUrl.replace(/\/$/, "")}/v1/check`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        text,
        source,
        question: String(question) || undefined,
      }),
    });
  } catch {
    logUnavailable(detectorStage);
    return NextResponse.json(
      { error: "service_unavailable", message: "Detector is unreachable." },
      { status: 503 }
    );
  }
  if (!detectorRes.ok) {
    logUnavailable(detectorStage, detectorRes.status);
    const errBody = await detectorRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: "detector_error", message: errBody?.detail ?? "Detector error." },
      { status: detectorRes.status }
    );
  }

  const detectorData = await detectorRes.json();
  const verdict = detectorData.verdict as CheckResult["verdict"];
  const extraFacts = RETRIEVAL_URL && verdict !== "trustworthy" && await serviceReachable(RETRIEVAL_URL)
    ? await fetch(`${RETRIEVAL_URL.replace(/\/$/, "")}/retrieve`, {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ query: String(question), entities: detectorData.entities ?? [], k: 5 }),
        signal: AbortSignal.timeout(8_000),
      }).then((res) => res.ok ? res.json() : { facts: [] }).catch(() => ({ facts: [] }))
    : { facts: [] };
  const facts: string[] = Array.isArray(extraFacts.facts) ? extraFacts.facts : [];
  const factDetails = toFactDetails(facts);
  const evidence: string[] = Array.isArray(detectorData.evidence)
    ? detectorData.evidence.filter(
        (item: unknown): item is string => typeof item === "string" && !isPromptEcho(item)
      )
    : [];

  let correctedAnswer: string | null = null;
  if (facts.length && verdict !== "trustworthy" && RETRIEVAL_URL) {
    correctedAnswer = await fetch(`${RETRIEVAL_URL.replace(/\/$/, "")}/correct`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        original_question: String(question),
        flagged_answer: text,
        facts,
      }),
      signal: AbortSignal.timeout(10_000),
    }).then((res) => res.ok ? res.json().catch(() => ({})) : {}).then((data: Record<string, unknown>) =>
      typeof data.corrected_answer === "string" ? data.corrected_answer : null
    ).catch(() => null);
  }

  const stages = [
    { name: detectorStage, status: "completed" as const, latency_ms: detectorData.latency_ms },
    { name: "retrieval", status: facts.length ? ("completed" as const) : ("skipped" as const), details: { facts_found: facts.length } },
    { name: "grounded_correction", status: correctedAnswer ? ("completed" as const) : ("skipped" as const) },
  ];
  after(() => logCheckRun({
    source,
    verdict,
    confidence: detectorData.confidence,
    latencyMs: Date.now() - requestStartedAt,
    stages,
  }));

  return NextResponse.json({
    verdict,
    confidence: detectorData.confidence,
    evidence,
    evidenceItems: [],
    signalList: [],
    signals: { ...(detectorData.signals ?? {}), ...generationDetails, pipeline_mode: "microservice" },
    entities: detectorData.entities ?? [],
    retrieved_facts: facts,
    corrected_answer: correctedAnswer,
    used_facts: correctedAnswer ? facts : [],
    used_fact_details: correctedAnswer ? factDetails : [],
    referenceFacts: facts,
    reference_fact_details: factDetails,
    retrieval_error: null,
    stages,
    latency_ms: Date.now() - requestStartedAt,
    mode: "microservice",
    question: String(question),
    answer: text,
    source,
    correctedAnswer,
    total_latency_ms: Date.now() - requestStartedAt,
  });
}
