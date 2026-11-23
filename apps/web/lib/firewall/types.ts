/** Shared types for the in-process hallucination firewall engine. */

export type Verdict = "trustworthy" | "uncertain" | "needs_correction";

export interface FirewallSignal {
  /** Human-readable label shown in the UI. */
  label: string;
  /** Numeric value where relevant. */
  value?: number;
  /** Short explanation of what this signal means. */
  detail: string;
  /** true when this signal argues against trusting the answer. */
  risk?: boolean;
}

export interface FirewallEvidence {
  kind: "consistency" | "entailment" | "knowledge" | "judge";
  statement: string;
  detail: string;
  supports: boolean;
}

/** Explicit provenance for one reference premise. */
export interface FactDetail {
  /** Citation label used in prompts and the UI (F1, F2, ...). */
  id: string;
  fact: string;
  source: string;
}

export interface FirewallStage {
  name: string;
  status: "completed" | "skipped" | "unavailable";
  latency_ms?: number;
  details?: Record<string, unknown>;
}

export interface DetectorResult {
  verdict: Verdict;
  confidence: number;
  evidence: string[];
  evidenceItems: FirewallEvidence[];
  signals: Record<string, unknown>;
  signalList: FirewallSignal[];
  stages: FirewallStage[];
  entities: string[];
  /** Legacy string view, kept for compatibility with existing clients. */
  referenceFacts: string[];
  /** Same premises with explicit source attribution. */
  reference_fact_details: FactDetail[];
}

export interface GenerationResult {
  answer: string;
  provider: string;
  model: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  usage_proof?: unknown;
}

export interface CheckResult extends DetectorResult {
  question: string;
  answer: string;
  corrected_answer: string | null;
  /** Legacy string view, kept for compatibility with existing clients. */
  used_facts: string[];
  /** Correction citations mapped back to curated/source-attributed premises. */
  used_fact_details: FactDetail[];
  source: string;
  generation?: GenerationResult;
  total_latency_ms: number;
  mode: "microservice" | "inprocess" | "unavailable";
}
