"use client";

/**
 * Shows the *measurements* behind a verdict: pipeline stage timings and the
 * numeric detector signals (resample consistency, contradicted claims, etc.).
 * This is the "analysis" panel that makes the anti-hallucination work visible.
 */

import { useState } from "react";

interface Stage {
  name: string;
  status: "completed" | "skipped" | "unavailable" | "running";
  latency_ms?: number;
  details?: Record<string, unknown>;
}

interface Signal {
  label: string;
  value?: number;
  detail: string;
  risk?: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  generation: "1 · Real model generation",
  semantic_resampling: "2 · Self-consistency resampling",
  nli_entailment: "3 · NLI claim entailment",
  retrieval: "4 · Evidence retrieval",
  grounded_correction: "5 · Grounded correction",
  gemma_sae_check: "2 · Gemma SAE probe",
  blackbox_resampling_nli: "2 · Black-box resample + NLI",
};

const STATUS_META: Record<string, { icon: string; color: string }> = {
  completed: { icon: "✓", color: "var(--bk-success-text)" },
  running: { icon: "•", color: "var(--bk-brand-text)" },
  skipped: { icon: "–", color: "var(--bk-muted)" },
  unavailable: { icon: "!", color: "var(--bk-warning-text)" },
};

export function FirewallTelemetry({
  stages = [],
  signalList = [],
  mode,
  compact = false,
}: {
  stages?: Stage[];
  signalList?: Signal[];
  mode?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  if (!stages.length && !signalList.length) return null;

  return (
    <div className="bk-frame--thin border bg-[var(--bk-paper)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 border-b-[2px] border-[var(--bk-line)] bg-[var(--bk-brand-soft)] px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-[var(--bk-brand-text)] bk-press"
      >
        <span>⚙ DETECTOR ANALYSIS {mode ? `· ${mode === "inprocess" ? "live NLI engine" : mode}` : ""}</span>
        <span className="bk-badge bk-badge--paper">{open ? "hide" : "show"}</span>
      </button>

      {open && (
        <div className="space-y-3 p-3">
          {stages.length > 0 && (
            <ol className="space-y-1.5">
              {stages.map((stage, index) => {
                const meta = STATUS_META[stage.status] ?? STATUS_META.skipped;
                return (
                  <li key={`${stage.name}-${index}`} className="flex items-start gap-2 text-xs">
                    <span className="w-3 shrink-0 font-black" style={{ color: meta.color }}>{meta.icon}</span>
                    <span className="flex-1 text-[var(--bk-ink)]">
                      {STAGE_LABELS[stage.name] ?? stage.name.replaceAll("_", " ")}
                      {stage.details && (
                        <span className="mt-0.5 block font-mono text-[10px] text-[var(--bk-muted)]">
                          {Object.entries(stage.details)
                            .filter(([, value]) => value !== null && value !== undefined)
                            .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    {stage.latency_ms != null && (
                      <span className="font-mono text-[10px] text-[var(--bk-muted)]">{stage.latency_ms}ms</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {signalList.length > 0 && (
            <div className="border-t-[2px] border-[var(--bk-line)] pt-2">
              <div className="bk-label mb-1.5">MEASURED SIGNALS</div>
              <dl className="space-y-1">
                {signalList.map((signal) => (
                  <div key={signal.label} className="flex items-start justify-between gap-2 text-[11px]">
                    <dt
                      className={signal.risk ? "font-bold text-[var(--bk-risk-text)]" : "text-[var(--bk-ink)]"}
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
