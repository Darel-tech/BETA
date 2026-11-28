"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BkNav } from "@/components/ui/BoldKit";

// ── Types ─────────────────────────────────────────────────────────────────────
type Verdict = "trustworthy" | "uncertain" | "needs_correction";
type StageStatus = "completed" | "skipped" | "unavailable";

interface ModelStage {
  name: string;
  status: StageStatus;
  latency_ms?: number;
  details?: Record<string, unknown>;
}

interface FactDetail {
  id: string;
  fact: string;
  source: string;
}

interface ModelResult {
  model: string;
  provider?: string | null;
  model_name?: string | null;
  answer: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  evidence: string[];
  corrected_answer: string | null;
  retrieved_facts: string[];
  retrieval_matches?: Array<{ id: number; score: number; source: string | null; entity_tag: string | null }>;
  entities: string[];
  signals: Record<string, unknown>;
  latency_ms: number;
  stages?: ModelStage[];
  retrieval_error?: string | null;
  verification_status?: "pending" | "complete" | "error";
  mode?: "microservice" | "inprocess" | "unavailable";
  evidenceItems?: Array<{ kind: string; statement: string; detail: string; supports: boolean }>;
  signalList?: Array<{ label: string; value?: number; detail: string; risk?: boolean }>;
  used_facts?: string[];
  used_fact_details?: FactDetail[];
  reference_facts?: string[];
  reference_fact_details?: FactDetail[];
  error?: string;
}

interface Agreement {
  available: boolean;
  method: "nli" | "lexical" | "unavailable";
  all_agree: boolean;
  majority_answer_cluster: string;
  outliers: string[];
  score: number | null;
}

interface CompareData {
  question: string;
  results: ModelResult[];
  agreement: Agreement | null;
  total_latency_ms?: number;
}

// ── Verdict helpers ───────────────────────────────────────────────────────────
const verdictMeta: Record<
  Verdict,
  { label: string; cssClass: string; icon: string }
> = {
  trustworthy: {
    label: "Trustworthy",
    cssClass: "bk-badge bk-badge--success",
    icon: "✓",
  },
  uncertain: { label: "Uncertain", cssClass: "bk-badge bk-badge--warning", icon: "~" },
  needs_correction: {
    label: "Needs Correction",
    cssClass: "bk-badge bk-badge--risk",
    icon: "✗",
  },
};

const modelMeta: Record<string, { label: string; color: string; provider?: string }> = {
  "local-gemma": { label: "Gemma 2-2B (White-box)", color: "var(--bk-insight)", provider: "Local SAE" },
  chatgpt: { label: "ChatGPT (OpenAI API)", color: "var(--bk-success)", provider: "OpenAI" },
  claude: { label: "Claude (Anthropic API)", color: "var(--bk-warning)", provider: "Anthropic" },
  groq: { label: "Groq", color: "var(--bk-success)", provider: "Groq API" },
  openrouter: { label: "OpenRouter", color: "var(--bk-evidence)", provider: "OpenRouter API" },
};

const stageLabels: Record<string, string> = {
  generation: "Answer generation",
  gemma_sae_check: "Gemma SAE check",
  blackbox_resampling_nli: "Resampling + NLI check",
  retrieval: "Evidence retrieval",
  grounded_correction: "Grounded correction",
  verification: "Answer verification",
};

// BoldKit primitives use the shared global bk-* system with semantic color roles.
const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

const bkPress = "bk-press";
const bkDarkFrame = "bk-card bk-frame bk-press";
const bkPanelFrame = "bk-panel";
const bkInset = "bk-input";

const bkLabel = "bk-label";
const bkPrimaryButton = "bk-btn bk-press";
const bkSecondaryButton = "bk-btn bk-btn--paper bk-press";

// ── Shared navigation ─────────────────────────────────────────────────────────

function CompareNav() {
  return <BkNav active="compare" />;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.7
      ? { bar: "bg-[var(--bk-success)]", text: "text-[var(--bk-success-text)]" }
      : value >= 0.45
      ? { bar: "bg-[var(--bk-warning)]", text: "text-[var(--bk-warning-text)]" }
      : { bar: "bg-[var(--bk-risk)]", text: "text-[var(--bk-risk-text)]" };

  return (
    <div className="mt-2">
      <div className="mb-1 flex justify-between text-xs font-bold uppercase tracking-wide text-[var(--bk-muted)]">
        <span>Confidence</span>
        <span className={tone.text}>{pct}%</span>
      </div>
      <div className="h-3 w-full overflow-hidden border-[2px] border-[var(--bk-line)] bg-[var(--bk-paper)]">
        <div
          className={cx("h-full transition-all duration-700", tone.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className={cx(bkDarkFrame, "flex flex-col gap-3 p-5")}>
      <div className="h-5 w-24 animate-pulse border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)]" />
      <div className="h-4 w-full animate-pulse border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)]" />
      <div className="h-4 w-5/6 animate-pulse border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)]" />
      <div className="h-4 w-4/6 animate-pulse border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)]" />
      <div className="mt-2 h-2 w-full animate-pulse border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)]" />
    </div>
  );
}

function ErrorCard({ model, message }: { model: string; message: string }) {
  const meta = modelMeta[model] ?? { label: model, color: "var(--bk-muted)" };
  return (
    <div className={cx(bkDarkFrame, "p-5")}>
      <div className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-[var(--bk-ink)]">
        <span className="h-3 w-3 border-2 border-[var(--bk-line)]" style={{ background: meta.color }} />
        {meta.label}
      </div>
      <div className="border-[3px] border-[var(--bk-line)] bg-[var(--bk-risk)] p-3 text-xs font-bold text-white shadow-[2px_2px_0_0_var(--bk-shadow)]">
        ✗ {message}
      </div>
    </div>
  );
}

function EntityChips({ entities }: { entities: string[] }) {
  if (!entities?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {entities.map((e) => (
        <span
          key={e}
          className="border-2 border-[var(--bk-line)] bg-[var(--bk-brand-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--bk-ink)]"
        >
          {e}
        </span>
      ))}
    </div>
  );
}

function FactProvenanceList({
  label,
  details,
  fallbackFacts = [],
  limit = 5,
  inverted = false,
}: {
  label: string;
  details?: FactDetail[];
  fallbackFacts?: string[];
  limit?: number;
  inverted?: boolean;
}) {
  const items: FactDetail[] = details?.length
    ? details
    : fallbackFacts.map((fact, index) => ({
        id: `F${index + 1}`,
        fact,
        source: "Source not available",
      }));
  if (!items.length) return null;

  return (
    <div>
      <div
        className={cx(
          "mb-2 text-[10px] font-black uppercase tracking-[0.16em]",
          inverted ? "text-[var(--bk-risk-text)]" : "text-[var(--bk-evidence-text)]"
        )}
      >
        {label}
      </div>
      <ul className="space-y-2">
        {items.slice(0, limit).map((detail, index) => (
          <li
            key={`${detail.id}-${index}`}
            className={cx(
              "border-2 px-2.5 py-2",
              inverted
                ? "border-[var(--bk-line)] bg-[var(--bk-paper)]"
                : "border-[var(--bk-line)] bg-[var(--bk-evidence-soft)]"
            )}
          >
            <div className="flex gap-2 text-[11px] leading-relaxed">
              <span
                className={cx(
                  "h-fit shrink-0 px-1.5 py-0.5 font-mono text-[9px] font-bold",
                  inverted ? "bg-[var(--bk-risk)] text-white" : "bg-[var(--bk-evidence)] text-white"
                )}
              >
                {detail.id}
              </span>
              <span className={inverted ? "text-[var(--bk-risk-text)]" : "text-[var(--bk-ink)]"}>
                <span className={inverted ? "text-[var(--bk-risk-text)]" : "text-[var(--bk-evidence-text)]"}>
                  · {detail.source} —{" "}
                </span>
                {detail.fact}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const detectorStageLabels: Record<string, string> = {
  generation: "1 · Real model generation",
  semantic_resampling: "2 · Self-consistency resampling",
  nli_entailment: "3 · NLI claim entailment",
  retrieval: "4 · Evidence retrieval",
  grounded_correction: "5 · Grounded correction",
  gemma_sae_check: "2 · Gemma SAE probe",
  blackbox_resampling_nli: "2 · Black-box resample + NLI",
};

const detectorStatusMeta: Record<string, { icon: string; className: string }> = {
  completed: { icon: "✓", className: "text-[var(--bk-success-text)]" },
  running: { icon: "•", className: "text-[var(--bk-brand-text)]" },
  skipped: { icon: "–", className: "text-[var(--bk-muted)]" },
  unavailable: { icon: "!", className: "text-[var(--bk-warning-text)]" },
};

/** BoldKit replacement for the detector analysis panel — same measurements, new shell. */
function DetectorAnalysis({
  stages = [],
  signalList = [],
  mode,
}: {
  stages?: ModelStage[];
  signalList?: Array<{ label: string; value?: number; detail: string; risk?: boolean }>;
  mode?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!stages.length && !signalList.length) return null;

  return (
    <div className="border-[3px] border-[var(--bk-line)] bg-[var(--bk-paper)] shadow-[4px_4px_0_0_var(--bk-shadow)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 border-b-[3px] border-[var(--bk-line)] bg-[var(--bk-brand)] px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-white"
      >
        <span>
          ⚙ DETECTOR ANALYSIS {mode ? `· ${mode === "inprocess" ? "live NLI engine" : mode}` : ""}
        </span>
        <span className="border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] px-2 py-0.5 text-[10px] text-[var(--bk-brand-text)]">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 bg-[var(--bk-paper)] p-3">
          {stages.length > 0 && (
            <ol className="space-y-2">
              {stages.map((stage, index) => {
                const meta = detectorStatusMeta[stage.status] ?? detectorStatusMeta.skipped;
                return (
                  <li key={`${stage.name}-${index}`} className="flex items-start gap-2 text-xs">
                    <span className={cx("w-3 shrink-0 font-black", meta.className)}>
                      {meta.icon}
                    </span>
                    <span className="flex-1 text-[var(--bk-ink)]">
                      {detectorStageLabels[stage.name] ?? stage.name.replaceAll("_", " ")}
                      {stage.details && (
                        <span className="mt-0.5 block font-mono text-[10px] text-[var(--bk-muted)]">
                          {Object.entries(stage.details)
                            .filter(([, value]) => value !== null && value !== undefined)
                            .map(([key, value]) =>
                              `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`
                            )
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    {stage.latency_ms != null && (
                      <span className="font-mono text-[10px] text-[var(--bk-muted)]">
                        {stage.latency_ms}ms
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {signalList.length > 0 && (
            <div className="border-t-[2px] border-[var(--bk-line)] pt-2">
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--bk-muted)]">
                MEASURED SIGNALS
              </div>
              <dl className="space-y-1">
                {signalList.map((signal) => (
                  <div key={signal.label} className="flex items-start justify-between gap-2 text-[11px]">
                    <dt
                      className={cx(
                        "font-semibold",
                        signal.risk ? "text-[var(--bk-risk-text)]" : "text-[var(--bk-ink)]"
                      )}
                    >
                      {signal.risk ? "▲" : "·"} {signal.label}
                    </dt>
                    <dd className="text-right font-mono text-[var(--bk-muted)]">
                      {signal.value != null && (
                        <span className="mr-1">
                          {typeof signal.value === "number" && signal.value < 1
                            ? signal.value.toFixed(2)
                            : signal.value}
                        </span>
                      )}
                      <span className="mt-0.5 block font-sans text-[10px] text-[var(--bk-muted)]">
                        {signal.detail}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: ModelResult }) {
  const meta = modelMeta[result.model] ?? { label: result.model, color: "var(--bk-muted)" };
  const vm = result.verdict ? verdictMeta[result.verdict] : null;
  const referenceFallback = result.reference_facts ?? result.retrieved_facts ?? [];
  const hasReferenceProvenance = Boolean(result.reference_fact_details?.length || referenceFallback.length);

  return (
    <div className={cx(bkDarkFrame, "flex h-full flex-col gap-4 p-5", bkPress)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-[var(--bk-ink)]">
            <span className="h-3 w-3 shrink-0 border-2 border-[var(--bk-line)]" style={{ background: meta.color }} />
            <span className="truncate">{meta.label}</span>
          </div>
          {(result.provider ?? meta.provider) && (
            <div className="mt-1 font-mono text-[10px] text-[var(--bk-muted)]">
              Provider: {result.provider ?? meta.provider}
            </div>
          )}
          {result.model_name && (
            <div className="font-mono text-[10px] text-[var(--bk-muted)]">Model: {result.model_name}</div>
          )}
        </div>
        <div className="shrink-0 border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--bk-brand-text)]">
          {result.latency_ms}ms
        </div>
      </div>

      {result.verification_status === "pending" && (
        <p role="status" className="border-l-[3px] border-[var(--bk-line)] pl-3 text-xs font-bold text-[var(--bk-brand-text)]">
          Answer received; verification is running…
        </p>
      )}
      {result.verification_status === "error" && result.error && (
        <p role="alert" className="border-l-[3px] border-[var(--bk-risk)] pl-3 text-xs font-bold text-[var(--bk-risk-text)]">
          Verification failed: {result.error}
        </p>
      )}

      {/* Verdict badge */}
      {vm && (
        <div
          className={cx(
            vm.cssClass,
            "inline-flex w-fit items-center gap-1 border-2 border-[var(--bk-line)] px-3 py-1 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0_0_var(--bk-shadow)]"
          )}
        >
          <span>{vm.icon}</span> {vm.label}
        </div>
      )}

      {/* Confidence meter */}
      {result.confidence !== null && (
        <ConfidenceMeter value={result.confidence} />
      )}

      {/* Answer */}
      {result.answer && (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={bkLabel}>ANSWER</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--bk-ink)]">
            {result.answer}
          </p>
        </div>
      )}

      {result.error && (
        <div
          role="alert"
          className="border-[3px] border-[var(--bk-line)] bg-[var(--bk-risk)] p-3 text-xs font-bold text-white shadow-[2px_2px_0_0_var(--bk-shadow)]"
        >
          {result.error}
        </div>
      )}

      {result.stages?.length ? (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={cx(bkLabel, "mb-1")}>PIPELINE TIMING</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {result.stages.map((stage, index) => (
              <div key={`${stage.name}-${index}`} className="contents">
                <dt className="text-[var(--bk-muted)]">
                  {stageLabels[stage.name] ?? stage.name.replaceAll("_", " ")}
                </dt>
                <dd className="text-right font-mono text-[var(--bk-ink)]">
                  {stage.latency_ms == null ? stage.status : `${stage.latency_ms}ms · ${stage.status}`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {Object.keys(result.signals ?? {}).length > 0 && (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={cx(bkLabel, "mb-1")}>DETECTOR METRICS</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {Object.entries(result.signals).filter(([, value]) => value !== null && typeof value !== "object").map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-[var(--bk-muted)]">{key.replaceAll("_", " ")}</dt>
                <dd className="text-right font-mono text-[var(--bk-ink)]">
                  {typeof value === "number"
                    ? key.includes("tokens")
                      ? value.toLocaleString()
                      : value.toFixed(3)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Auto-extracted entities */}
      {result.entities?.length > 0 && (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={cx(bkLabel, "mb-1")}>ENTITIES DETECTED</div>
          <EntityChips entities={result.entities} />
        </div>
      )}

      {/* Detector analysis: stage timeline + measured signals */}
      <DetectorAnalysis
        stages={result.stages}
        signalList={result.signalList}
        mode={result.mode}
      />

      {/* Evidence */}
      {result.retrieval_error && (
        <p role="status" className="border-l-[3px] border-[var(--bk-warning)] pl-3 text-xs font-bold text-[var(--bk-warning-text)]">
          Evidence lookup unavailable: {result.retrieval_error}
        </p>
      )}
      {result.retrieval_matches?.length ? (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={cx(bkLabel, "mb-1")}>RETRIEVAL EVIDENCE</div>
          <ul className="space-y-2 text-xs text-[var(--bk-ink)]">
            {result.retrieval_matches.slice(0, 3).map((match, index) => (
              <li key={match.id} className="border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] p-2">
                <div className="flex justify-between gap-2 font-mono text-[10px] text-[var(--bk-muted)]">
                  <span>{match.source ?? match.entity_tag ?? "Knowledge store"}</span>
                  <span title="Cosine similarity, not a probability">cosine {match.score.toFixed(3)}</span>
                </div>
                {result.retrieved_facts[index] && (
                  <p className="mt-1 text-[var(--bk-ink)]">{result.retrieved_facts[index]}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.verdict && !result.retrieval_error && (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <FactProvenanceList
            label={`REFERENCE PREMISES · PROVENANCE${
              Number(result.signals?.reference_premises ?? 0) > 0
                ? ` (${Number(result.signals?.reference_premises)})`
                : ""
            }`}
            details={result.reference_fact_details}
            fallbackFacts={referenceFallback}
            limit={4}
          />
        </div>
      )}
      {result.verdict && !result.retrieval_error && !hasReferenceProvenance && (
        <p role="status" className="text-xs text-[var(--bk-muted)]">
          No reference premises were available for this check.
        </p>
      )}
      {result.evidence?.length > 0 && (
        <div className="border-t-[2px] border-[var(--bk-line)] pt-3">
          <div className={cx(bkLabel, "mb-1")}>EVIDENCE</div>
          <ul className="space-y-1 text-xs text-[var(--bk-ink)]">
            {result.evidence.map((ev, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-black text-[var(--bk-brand-text)]">•</span>
                <span>{ev}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Corrected answer — always inline, never behind a button */}
      {result.corrected_answer && (
        <div className="bk-panel bk-panel--risk p-3">
          <div className="mb-1 text-xs font-black uppercase tracking-wide text-[var(--bk-risk-text)]">
            ✓ CORRECTED ANSWER
          </div>
          <p className="text-sm font-semibold leading-relaxed text-[var(--bk-risk-text)]">
            {result.corrected_answer}
          </p>
          <div className="mt-3 border-t-2 border-[var(--bk-line)] pt-3">
            <FactProvenanceList
              label="SOURCES USED BY CORRECTION"
              details={result.used_fact_details}
              fallbackFacts={result.used_facts ?? []}
              limit={4}
              inverted
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgreementBanner({ agreement, results }: { agreement: Agreement; results: ModelResult[] }) {
  const verdictCounts = results.reduce<Record<string, number>>((acc, r) => {
    if (r.verdict) acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const topVerdict = Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as Verdict | undefined;

  return (
    <div className={cx(bkPanelFrame, "p-5", bkPress)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-black uppercase tracking-wide">
          {!agreement.available
            ? "Agreement unavailable"
            : agreement.method === "nli"
              ? agreement.all_agree ? "✓ Models agree (NLI)" : "~ Models differ (NLI)"
              : agreement.all_agree ? "✓ Lexical overlap suggests agreement" : "~ Low lexical overlap"}
        </span>
        {agreement.method === "lexical" && agreement.score != null && (
          <span className="border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--bk-brand-text)]">
            Jaccard overlap: {(agreement.score * 100).toFixed(1)}%
          </span>
        )}
        {topVerdict && (
          <span
            className={cx(
              verdictMeta[topVerdict].cssClass,
              "border-2 border-[var(--bk-line)] px-3 py-1 text-xs font-black uppercase shadow-[2px_2px_0_0_var(--bk-shadow)]"
            )}
          >
            Majority: {verdictMeta[topVerdict].label}
          </span>
        )}
        {agreement.outliers.length > 0 && (
          <span className="text-xs font-bold text-[var(--bk-muted)]">
            Outlier: {agreement.outliers.map((o) => modelMeta[o]?.label ?? o).join(", ")}
          </span>
        )}
      </div>
      {agreement.available && agreement.majority_answer_cluster && !agreement.all_agree && (
        <p className="mt-2 text-xs font-semibold text-[var(--bk-muted)]">
          Majority cluster: &quot;{agreement.majority_answer_cluster}&quot;
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function CompareContent() {
  const searchParams = useSearchParams();
  const queryFromUrl = searchParams.get("q");
  const [question, setQuestion] = useState("");
  const [inputQuestion, setInputQuestion] = useState(() => queryFromUrl ?? "");
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const autoRunQueryRef = useRef<string | null>(null);

  const runCompare = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setQuestion(q);
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    setProgress("Starting model requests…");
    setData(null);

    const updateResult = (result: ModelResult) => {
      setData((current) => {
        const previous = current?.results ?? [];
        const results = previous.filter((item) => item.model !== result.model);
        results.push(result);
        return { question: q, results, agreement: current?.agreement ?? null, total_latency_ms: current?.total_latency_ms };
      });
    };

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        setData(await res.json() as CompareData);
        return;
      }

      if (!res.body) throw new Error("The comparison stream did not include a response body.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleFrame = (frame: string) => {
        const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:"));
        if (!line) return;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === "started") {
          setData({ question: event.question, results: [], agreement: null });
          setProgress("Generating answers in parallel…");
        } else if (event.type === "generated" || event.type === "result") {
          updateResult(event.result as ModelResult);
          setProgress(event.type === "generated" ? "Answers are arriving; verification is running…" : "A model result is ready…");
        } else if (event.type === "checking") {
          setProgress(`Verifying ${modelMeta[event.model]?.label ?? event.model}…`);
        } else if (event.type === "complete") {
          setData((current) => current
            ? { ...current, agreement: event.agreement, total_latency_ms: event.total_latency_ms }
            : current);
          setProgress("Agreement analysis complete.");
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Comparison failed.");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          handleFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) {
          if (buffer.trim()) handleFrame(buffer);
          break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (controllerRef.current === controller) {
        setLoading(false);
        setProgress("");
      }
    }
  }, []);

  // Auto-run when navigated from the landing page with ?q=
  useEffect(() => {
    const q = queryFromUrl;
    if (!q || q === autoRunQueryRef.current) return;
    autoRunQueryRef.current = q;
    const initialRun = window.setTimeout(() => { void runCompare(q); }, 0);
    return () => window.clearTimeout(initialRun);
  }, [queryFromUrl, runCompare]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputQuestion.trim()) return;
    const q = inputQuestion.trim();
    autoRunQueryRef.current = q;
    runCompare(q);
    // Update URL without navigation
    const url = new URL(window.location.href);
    url.searchParams.set("q", q);
    window.history.replaceState({}, "", url.toString());
  }

  const models = ["local-gemma", "groq", "openrouter"];

  return (
    <div className="bk-app">
      <CompareNav />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Question input */}
        <form
          onSubmit={handleSubmit}
          className={cx(bkDarkFrame, "mb-9 flex gap-3 p-3")}
        >
          <input
            type="text"
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            placeholder="Ask a question to compare all three models…"
            className={cx(
              bkInset,
              "min-w-0 flex-1 px-4 py-3 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-[var(--bk-muted)] focus:translate-x-1 focus:translate-y-1 focus:shadow-none transition-transform duration-150"
            )}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!inputQuestion.trim() || loading}
            className={cx(
              bkPrimaryButton,
              "shrink-0 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0_0_var(--bk-shadow)]"
            )}
          >
            {loading ? "Comparing…" : "Compare"}
          </button>
        </form>

        {/* Error state */}
        {error && (
          <div className="mb-6 border-[3px] border-[var(--bk-line)] bg-[var(--bk-risk)] p-5 text-white shadow-[4px_4px_0_0_var(--bk-shadow)]">
            <div className="font-black uppercase tracking-wide">Error</div>
            <p className="mt-1 text-sm font-bold">{error}</p>
            <button
              onClick={() => runCompare(question)}
              className={cx(bkSecondaryButton, "mt-3")}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && !data && (
          <>
            <div className="mb-6 h-16 w-full animate-pulse border-[3px] border-[var(--bk-line)] bg-[var(--bk-brand-soft)] shadow-[4px_4px_0_0_var(--bk-shadow)]" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {models.map((m) => <SkeletonCard key={m} />)}
            </div>
          </>
        )}

        {/* How real-time correction works — always visible once a comparison starts */}
        {(loading || data) && (
          <div className={cx(bkPanelFrame, "mb-6 p-4")}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm">🛡️</span>
              <span className="text-xs font-black uppercase tracking-wide text-[var(--bk-ink)]">
                REAL-TIME HALLUCINATION FIREWALL · LIVE PIPELINE
              </span>
              <span className="ml-auto border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--bk-brand-text)]">
                NO MANUAL STEPS
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[11px] md:grid-cols-4">
              {[
                { n: "1", title: "Generate", desc: "Real model answers, in parallel." },
                { n: "2", title: "Resample", desc: "3 independent samples → meaning clusters." },
                { n: "3", title: "Entail", desc: "Each claim checked against reference facts." },
                { n: "4", title: "Correct", desc: "Flagged answers rewritten with cited sources." },
              ].map((step) => (
                <div
                  key={step.n}
                  className="border-2 border-[var(--bk-line)] bg-[var(--bk-paper)] p-2 text-[var(--bk-ink)]"
                >
                  <div className="mb-0.5 font-mono font-black text-[var(--bk-brand-text)]">{step.n}</div>
                  <div className="mb-0.5 font-black uppercase tracking-wide">{step.title}</div>
                  <div className="text-[var(--bk-muted)]">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {data && (
          <>
            {/* Question */}
            <div className="mb-5 border-l-[3px] border-[var(--bk-line)] pl-3 text-sm font-semibold text-[var(--bk-muted)]">
              Comparing answers for:{" "}
              <span className="font-black text-[var(--bk-ink)]">
                &quot;{data.question}&quot;
              </span>
              {data.total_latency_ms != null && (
                <span className="ml-3 font-mono text-xs text-[var(--bk-muted)]">
                  ({data.total_latency_ms}ms total)
                </span>
              )}
            </div>

            {loading && progress && (
              <p role="status" className="mb-4 text-xs font-black uppercase tracking-wide text-[var(--bk-brand-text)]">
                {progress}
              </p>
            )}

            {/* Agreement banner */}
            {data.agreement ? (
              <div className="mb-6"><AgreementBanner agreement={data.agreement} results={data.results} /></div>
            ) : loading ? (
              <div
                role="status"
                className={cx(bkDarkFrame, "mb-6 p-5 text-sm font-semibold text-[var(--bk-ink)]")}
              >
                Agreement analysis will appear after the available answers finish verification.
              </div>
            ) : null}

            {/* Three-column result cards */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {models.map((model) => {
                const result = data.results.find((item) => item.model === model);
                return !result ? <SkeletonCard key={model} /> : result.error && !result.answer ? (
                  <ErrorCard key={model} model={model} message={result.error} />
                ) : (
                  <ResultCard key={model} result={result} />
                );
              })}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !data && !error && (
          <div className={cx(bkDarkFrame, "py-24 text-center")}>
            <div
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center overflow-hidden border-[3px] border-[var(--bk-line)] bg-white shadow-[4px_4px_0_0_var(--bk-shadow)]"
            >
              <img
                src="/beta-mark.png"
                alt=""
                width={56}
                height={56}
                className="h-full w-full object-contain"
                aria-hidden="true"
              />
            </div>
            <p className="mb-2 text-lg font-black uppercase tracking-wide text-[var(--bk-ink)]">
              Enter a question above to begin.
            </p>
            <p className="text-sm text-[var(--bk-muted)]">
              All three models will be queried in parallel and fact-checked automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="bk-app">
          <CompareNav />
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="mb-8 h-12 w-full animate-pulse border-[3px] border-[var(--bk-line)] bg-[var(--bk-brand-soft)] shadow-[4px_4px_0_0_var(--bk-shadow)]" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
