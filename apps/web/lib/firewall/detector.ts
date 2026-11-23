/**
 * In-process hallucination detector — REAL computation, no canned verdicts.
 *
 * Pipeline (mirrors the microservice design in fixplan Phase 4):
 *  1. Entity extraction (regex, server-side, automatic).
 *  2. Resample consistency: ask the live LLM the same question N times at a
 *     higher temperature, normalise each answer, cluster by token overlap,
 *     and measure how often the primary answer's claims recur. This is the
 *     behavioural equivalent of semantic entropy when the SAE service is down.
 *  3. NLI-style entailment: ask the live LLM to judge each atomic claim in the
 *     answer against the reference facts, returning SUPPORTED / CONTRADICTED /
 *     UNVERIFIABLE with a short reason.
 *  4. Decision rule: any CONTRADICTED claim => needs_correction; low
 *     consistency or mostly unverifiable => uncertain; otherwise trustworthy.
 *
 * Every stage emits timing + signals so the UI can show *why* a verdict was
 * reached. When a Python microservice is configured and reachable, the routes
 * use that service instead; this engine is the honest, real fallback.
 */

import { generateBlackboxAnswer } from "@/lib/llm";
import { selectReferenceFacts, toFactDetails, type ReferenceFact } from "./knowledge";
import type {
  DetectorResult,
  FirewallEvidence,
  FirewallSignal,
  FirewallStage,
  Verdict,
} from "./types";

const SAMPLE_COUNT = 3;

// ── helpers ────────────────────────────────────────────────────────────────────

export function extractEntities(question: string, answer: string): string[] {
  const combined = `${question} ${answer}`;
  const skip = new Set([
    "The", "A", "An", "In", "On", "At", "For", "And", "But", "Or", "With",
    "To", "Of", "By", "From", "That", "This", "These", "Those", "What",
    "When", "Where", "Who", "How", "Why", "Is", "Are", "Was", "Were", "Has",
    "Have", "Had", "Will", "Can", "Could", "Would", "Should", "Does", "Did",
  ]);
  const entities = new Set<string>();
  for (const match of combined.matchAll(/\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/g)) {
    const candidate = match[1].trim();
    if (!skip.has(candidate) && candidate.length > 2) entities.add(candidate);
  }
  for (const match of combined.matchAll(/\b(1[0-9]{3}|20[0-2][0-9])\b/g)) entities.add(match[1]);
  return [...entities].slice(0, 15);
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect model echoes of prompt/instruction text. Used at every parsing
 * boundary so a template line can never be promoted into a claim or evidence.
 */
export function isPromptEcho(text: string): boolean {
  return /reply with|one line per claim|no other text|copy the claim|one short sentence|citing a fact id|format\s*:|supported\s*\|\s*contradicted|answer\s*:\s*<|<\s*corrected answer/i.test(text);
}

/** Content words, dropping stopwords and very short tokens. */
function contentWords(text: string): Set<string> {
  const stop = new Set([
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "were",
    "has", "have", "had", "was", "were", "been", "being", "but", "not", "into",
    "its", "their", "they", "them", "then", "than", "also", "about", "over",
    "under", "after", "before", "which", "what", "when", "where", "who", "how",
    "does", "did", "can", "could", "would", "should", "will", "may", "might",
  ]);
  return new Set(
    normalise(text)
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stop.has(word))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Split an answer into short atomic claims (one sentence, or a clause). */
function atomicClaims(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((part) => part.trim().replace(/^[-•*\d.)]+\s*/, "").replace(/\*\*/g, ""))
    .filter((part) => {
      if (part.length < 15) return false;
      // Markdown table separators/headers and judge prompt echoes are not claims.
      if (/^\|?\s*[-:| ]+\|?$/.test(part)) return false;
      if (/^\|\s*(event|date|key details)\s*\|/i.test(part)) return false;
      if (isPromptEcho(part)) return false;
      return true;
    })
    .slice(0, 8);
}

type JudgeLabel = "SUPPORTED" | "CONTRADICTED" | "UNVERIFIABLE";

interface ParsedJudgeItem {
  claim: string;
  label: JudgeLabel;
  reason: string;
}

function parseJudgeLine(line: string): ParsedJudgeItem | null {
  if (isPromptEcho(line)) return null;
  const match = line.match(
    /^\s*(?:\d+[.)]?\s*)?claim\s*:\s*(.+?)\s*\|\s*label\s*:\s*(supported|contradicted|unverifiable)\s*\|\s*reason\s*:\s*(.+)$/i
  );
  if (!match) return null;
  const reason = match[3].trim();
  if (isPromptEcho(reason)) return null;
  return {
    claim: match[1].trim(),
    label: match[2].toUpperCase() as JudgeLabel,
    reason,
  };
}

function normaliseClaim(text: string): string {
  return normalise(text).replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

/** Accept a judge claim only when it refers to a claim the judge was given. */
function matchExpectedClaimIndex(claim: string, expectedClaims: string[]): number {
  const target = normaliseClaim(claim);
  if (!target) return -1;

  const exact = expectedClaims.findIndex((item) => normaliseClaim(item) === target);
  if (exact >= 0) return exact;

  const targetWords = new Set(target.split(/\s+/));
  let bestIndex = -1;
  let bestScore = 0;
  expectedClaims.forEach((item, index) => {
    const score = jaccard(targetWords, new Set(normaliseClaim(item).split(/\s+/)));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 0.8 ? bestIndex : -1;
}

function labelFromLine(line: string): JudgeLabel | null {
  if (/\bcontradicted\b/i.test(line)) return "CONTRADICTED";
  if (/\bunverifiable\b/i.test(line)) return "UNVERIFIABLE";
  if (/\bsupported\b/i.test(line) && !/\bnot supported\b/i.test(line)) return "SUPPORTED";
  return null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ── stage 1: resample consistency ─────────────────────────────────────────────

interface ConsistencyResult {
  score: number;
  samples: string[];
  uniqueClusters: number;
  latency_ms: number;
}

async function resampleConsistency(question: string, primary: string): Promise<ConsistencyResult> {
  const started = Date.now();
  const primaryWords = contentWords(primary);

  const requests = Array.from({ length: SAMPLE_COUNT }, () =>
    generateBlackboxAnswer(
      `Answer this factual question in one or two short sentences. Do not hedge or add commentary.\n\nQuestion: ${question}`,
      { temperature: 0.9, maxTokens: 160 }
    ).then((result) => result.text).catch(() => null)
  );
  const samples = (await Promise.all(requests)).filter((value): value is string => Boolean(value));

  if (samples.length === 0) {
    return { score: 0.5, samples: [], uniqueClusters: 0, latency_ms: Date.now() - started };
  }

  const similarities = samples.map((sample) => jaccard(primaryWords, contentWords(sample)));
  const similaritiesWithPrimary = [...similarities, 1]; // primary is trivially consistent with itself
  const mean =
    similaritiesWithPrimary.reduce((sum, value) => sum + value, 0) /
    similaritiesWithPrimary.length;

  // Cluster samples by pairwise similarity >= 0.4.
  const clusters: number[][] = [];
  const words = samples.map(contentWords);
  for (let i = 0; i < words.length; i++) {
    let placed = false;
    for (const cluster of clusters) {
      if (jaccard(words[i], words[cluster[0]]) >= 0.4) {
        cluster.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }

  return {
    // Mean overlap of the primary answer with all samples; higher = more stable.
    score: clamp(mean),
    samples,
    uniqueClusters: clusters.length,
    latency_ms: Date.now() - started,
  };
}

// ── stage 2: NLI-style entailment judge ───────────────────────────────────────

interface JudgeResult {
  items: ParsedJudgeItem[];
  latency_ms: number;
  usedFacts: ReferenceFact[];
  available: boolean;
  error?: string;
}

async function judgeClaims(
  question: string,
  answer: string,
  facts: ReferenceFact[],
  extraFacts: string[] = []
): Promise<JudgeResult> {
  const started = Date.now();
  const claims = atomicClaims(answer);
  const usedFacts = facts;
  if (claims.length === 0) {
    return { items: [], latency_ms: 0, usedFacts, available: true };
  }

  const premises = [
    ...facts.map((fact, index) => `[F${index + 1}] ${fact.fact} (Source: ${fact.source})`),
    ...extraFacts.map((fact, index) => `[E${index + 1}] ${fact}`),
  ].join("\n");

  const prompt = `You are a strict fact-checking NLI judge. Decide whether each CLAIM is supported, contradicted, or unverifiable by the REFERENCE FACTS. Use only the reference facts as evidence. A statement that matches a reference fact is SUPPORTED, even if the question was about a different topic. Never call such a statement unverifiable. Treat an unsupported confident assertion as UNVERIFIABLE, never SUPPORTED. Do not echo or quote these instructions in your output.

QUESTION: ${question}

REFERENCE FACTS:
${premises}

CLAIMS:
${claims.map((claim, i) => `${i + 1}. ${claim}`).join("\n")}

Reply with exactly one line per claim in this format (no other text):
claim: <copy the claim> | label: supported|contradicted|unverifiable | reason: <one short sentence citing a fact id like F1, or say no supporting fact>`;

  try {
    const result = await generateBlackboxAnswer(prompt, { temperature: 0, maxTokens: 1200 });
    const lines = result.text.split(/\r?\n/);
    const accepted = new Map<number, ParsedJudgeItem>();

    // Only accept lines whose claim matches a claim we actually submitted.
    for (const item of lines.map(parseJudgeLine).filter((value): value is ParsedJudgeItem => value !== null)) {
      const index = matchExpectedClaimIndex(item.claim, claims);
      if (index >= 0 && !accepted.has(index)) accepted.set(index, item);
    }

    // Fallback for formatting drift: require an explicit claim number or the
    // claim text itself, plus a real verdict label. Prompt echoes are rejected.
    if (accepted.size === 0) {
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || isPromptEcho(line)) continue;
        const label = labelFromLine(line);
        if (!label) continue;
        const ordinal = line.match(/^\s*(\d+)[.)]/);
        const index = ordinal
          ? Number(ordinal[1]) - 1
          : matchExpectedClaimIndex(line, claims);
        if (index < 0 || index >= claims.length || accepted.has(index)) continue;
        accepted.set(index, { claim: claims[index], label, reason: line.slice(0, 160) });
      }
    }

    const items = [...accepted.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => item)
      .filter((item) => !isPromptEcho(item.reason));

    return { items, latency_ms: Date.now() - started, usedFacts, available: true };
  } catch (err) {
    return {
      items: [],
      latency_ms: Date.now() - started,
      usedFacts,
      available: false,
      error: err instanceof Error ? err.message : "Judge call failed.",
    };
  }
}

// ── main detector ─────────────────────────────────────────────────────────────

export interface DetectOptions {
  question: string;
  answer: string;
  source: string;
  /** Reference facts from the real retrieval service, when available. */
  retrievalFacts?: string[];
  /** Skip resampling (used when speed matters and consistency is not needed). */
  skipResampling?: boolean;
}

export async function detectHallucination(options: DetectOptions): Promise<DetectorResult> {
  const { question, answer, source, retrievalFacts = [] } = options;
  const started = Date.now();
  const entities = extractEntities(question, answer);
  const referenceFacts = selectReferenceFacts(question, answer);
  const stages: FirewallStage[] = [];

  const consistency = options.skipResampling
    ? { score: 0.5, samples: [] as string[], uniqueClusters: 0, latency_ms: 0 }
    : await resampleConsistency(question, answer);
  stages.push({
    name: "semantic_resampling",
    status: consistency.samples.length ? "completed" : "unavailable",
    latency_ms: consistency.latency_ms,
    details: {
      samples: consistency.samples.length,
      semantic_clusters: consistency.uniqueClusters,
      consistency: Number(consistency.score.toFixed(3)),
    },
  });

  const judge = await judgeClaims(question, answer, referenceFacts, retrievalFacts);
  stages.push({
    name: "nli_entailment",
    status: judge.available ? "completed" : "unavailable",
    latency_ms: judge.latency_ms,
    details: {
      claims_checked: judge.items.length,
      contradicted: judge.items.filter((item) => item.label === "CONTRADICTED").length,
      unverifiable: judge.items.filter((item) => item.label === "UNVERIFIABLE").length,
      ...(judge.error ? { error: judge.error } : {}),
    },
  });

  const contradicted = judge.items.filter((item) => item.label === "CONTRADICTED");
  const supported = judge.items.filter((item) => item.label === "SUPPORTED");
  const unverifiable = judge.items.filter((item) => item.label === "UNVERIFIABLE");

  const evidenceItems: FirewallEvidence[] = [
    ...judge.items.map((item) => ({
      kind: "entailment" as const,
      statement: item.claim,
      detail: item.reason,
      supports: item.label === "SUPPORTED",
    })),
  ];

  if (!options.skipResampling) {
    evidenceItems.push({
      kind: "consistency",
      statement: `Answer recurred across ${consistency.samples.length} independent samples`,
      detail: `${consistency.uniqueClusters} distinct meaning cluster(s); mean content overlap ${(consistency.score * 100).toFixed(0)}%.`,
      supports: consistency.score >= 0.45,
    });
  }

  // Decision rule — matches the project's documented rule table.
  let verdict: Verdict;
  let confidence: number;

  if (!judge.available) {
    // Never invent a verdict when the judge itself failed.
    verdict = "uncertain";
    confidence = 0.3;
  } else if (contradicted.length > 0) {
    verdict = "needs_correction";
    confidence = clamp(0.55 + (contradicted.length / Math.max(judge.items.length, 1)) * 0.4);
  } else if (judge.items.length === 0) {
    verdict = "uncertain";
    confidence = 0.4;
  } else {
    const supportRatio = supported.length / judge.items.length;
    const unverifiableRatio = unverifiable.length / judge.items.length;
    const stability = options.skipResampling ? 0.7 : consistency.score;

    if (supportRatio >= 0.6 && stability >= 0.4 && unverifiableRatio <= 0.34) {
      verdict = "trustworthy";
      confidence = clamp(0.5 + supportRatio * 0.3 + stability * 0.2);
    } else {
      verdict = "uncertain";
      confidence = clamp(0.35 + supportRatio * 0.25 + stability * 0.2);
    }
  }

  const signalList: FirewallSignal[] = [
    {
      label: "Resample consistency",
      value: Number(consistency.score.toFixed(3)),
      detail: options.skipResampling
        ? "Skipped for this check."
        : `${consistency.samples.length} samples · ${consistency.uniqueClusters} meaning cluster(s)`,
      risk: consistency.score < 0.45,
    },
    {
      label: "Contradicted claims",
      value: contradicted.length,
      detail: `${contradicted.length} of ${judge.items.length} atomic claims contradict reference evidence`,
      risk: contradicted.length > 0,
    },
    {
      label: "Supported claims",
      value: supported.length,
      detail: `${supported.length} of ${judge.items.length} atomic claims are entailed by reference evidence`,
    },
    {
      label: "Unverifiable claims",
      value: unverifiable.length,
      detail: "Claims with no supporting reference fact (not treated as truth).",
      risk: unverifiable.length > 0,
    },
    {
      label: "Entities extracted",
      value: entities.length,
      detail: entities.slice(0, 6).join(", ") || "No named entities found",
    },
    {
      label: "Reference premises",
      value: referenceFacts.length + retrievalFacts.length,
      detail: "Independent facts used as NLI premises",
    },
  ];

  const signals: Record<string, unknown> = {
    detector_mode: "inprocess_llm_nli",
    source,
    resample_consistency: Number(consistency.score.toFixed(3)),
    resample_samples: consistency.samples.length,
    meaning_clusters: consistency.uniqueClusters,
    claims_checked: judge.items.length,
    contradicted_claims: contradicted.length,
    supported_claims: supported.length,
    unverifiable_claims: unverifiable.length,
    reference_premises: referenceFacts.length + retrievalFacts.length,
    entity_count: entities.length,
  };

  const referenceFactStrings = [...referenceFacts.map((fact) => fact.fact), ...retrievalFacts];

  return {
    verdict,
    confidence,
    evidence: evidenceItems.map((item) =>
      `${item.supports ? "✓" : "✗"} ${item.statement} — ${item.detail}`
    ),
    evidenceItems,
    signals,
    signalList,
    stages,
    entities,
    referenceFacts: referenceFactStrings,
    reference_fact_details: toFactDetails(referenceFactStrings),
  };
}
