/**
 * Firewall orchestrator.
 *
 * Strategy: prefer the original microservices when configured AND reachable.
 * Otherwise run the real in-process LLM-backed detector so the product works
 * today without pretend data. Every response declares its `mode` so the UI
 * can be honest about which pipeline produced the verdict.
 */

import { correctAnswer } from "./correction";
import { detectHallucination, extractEntities } from "./detector";
import { toFactDetails } from "./knowledge";
import type { CheckResult, DetectorResult, FactDetail, GenerationResult } from "./types";

export * from "./types";
export { extractEntities, isPromptEcho } from "./detector";
export { selectReferenceFacts, toFactDetails } from "./knowledge";

const INTERPRETABILITY_URL = process.env.INTERPRETABILITY_SERVICE_URL ?? "";
const BLACKBOX_URL = process.env.BLACKBOX_SERVICE_URL ?? "";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

const SERVICE_TIMEOUT_MS = 4_000;

function serviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_API_KEY) headers["X-Internal-Api-Key"] = INTERNAL_API_KEY;
  return headers;
}

export async function serviceReachable(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      headers: serviceHeaders(),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return false;

    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return true;
    const reported = (body as Record<string, unknown>).status;
    if (typeof reported !== "string") return true;
    return ["ok", "healthy", "up"].includes(reported.trim().toLowerCase());
  } catch {
    return false;
  }
}

/** Which detector service, if any, should handle this source. */
export async function activeDetector(source: string): Promise<"microservice" | "inprocess"> {
  if (source === "local-gemma" && INTERPRETABILITY_URL && await serviceReachable(INTERPRETABILITY_URL)) {
    return "microservice";
  }
  if (source !== "local-gemma" && BLACKBOX_URL && await serviceReachable(BLACKBOX_URL)) {
    return "microservice";
  }
  return "inprocess";
}

/** Fetch extra premise facts from the real retrieval service when it is up. */
export async function retrievalFacts(question: string, entities: string[]): Promise<string[]> {
  if (!RETRIEVAL_URL || !(await serviceReachable(RETRIEVAL_URL))) return [];
  try {
    const res = await fetch(`${RETRIEVAL_URL.replace(/\/$/, "")}/retrieve`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ query: question, entities, k: 5 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.facts)
      ? data.facts.filter((fact: unknown): fact is string => typeof fact === "string" && Boolean(fact.trim()))
      : [];
  } catch {
    return [];
  }
}

/** Map correction citations (strings) back to source-attributed premises. */
export function mapUsedFactDetails(usedFacts: string[], referenceDetails: FactDetail[]): FactDetail[] {
  const detailsByFact = new Map(referenceDetails.map((detail) => [detail.fact, detail]));
  return usedFacts.map((fact, index) =>
    detailsByFact.get(fact) ?? toFactDetails([fact], index)[0]
  );
}

/** Run the in-process real detector + grounded correction for one answer. */
export async function runFirewallCheck(options: {
  question: string;
  answer: string;
  source: string;
  generation?: GenerationResult;
}): Promise<CheckResult> {
  const started = Date.now();
  const { question, answer, source, generation } = options;

  const extraFacts = await retrievalFacts(question, extractEntities(question, answer));
  const detection: DetectorResult = await detectHallucination({
    question,
    answer,
    source,
    retrievalFacts: extraFacts,
  });

  const correction = await correctAnswer({ question, answer, detection });
  const used_fact_details = mapUsedFactDetails(correction.used_facts, detection.reference_fact_details);

  return {
    ...detection,
    question,
    answer,
    source,
    corrected_answer: correction.corrected_answer,
    used_facts: correction.used_facts,
    used_fact_details,
    reference_fact_details: detection.reference_fact_details,
    total_latency_ms: Date.now() - started,
    mode: "inprocess",
    generation,
    stages: [...detection.stages, ...correction.stages],
  };
}
