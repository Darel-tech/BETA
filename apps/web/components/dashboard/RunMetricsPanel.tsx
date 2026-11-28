"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BkNav } from "@/components/ui/BoldKit";

const STORAGE_KEY = "beta.chat.runs.v1";

type VerdictKey = "trustworthy" | "uncertain" | "needs_correction" | "unverified";

interface ChatRun {
  id: string;
  question: string;
  answer: string;
  createdAtMs: number;
  createdAtRaw: string | null;
  verdict: VerdictKey;
  confidence: number | null;
  latencyMs: number | null;
  source: string;
  mode: string;
}

interface BenchmarkSnapshot {
  questions_evaluated: number;
  accuracy: number;
  run_at?: string;
  note?: string;
}

interface VerdictMeta {
  label: string;
  short: string;
  color: string;
  tint: string;
}

const VERDICTS: Record<VerdictKey, VerdictMeta> = {
  trustworthy: {
    label: "Trustworthy",
    short: "Trustworthy",
    color: "var(--bk-success)",
    tint: "var(--bk-success-soft)",
  },
  uncertain: {
    label: "Uncertain",
    short: "Uncertain",
    color: "var(--bk-warning)",
    tint: "var(--bk-warning-soft)",
  },
  needs_correction: {
    label: "Needs correction",
    short: "Corrected",
    color: "var(--bk-risk)",
    tint: "var(--bk-risk-soft)",
  },
  unverified: {
    label: "No verdict",
    short: "No verdict",
    color: "var(--bk-muted)",
    tint: "var(--bk-paper)",
  },
};

const VERDICT_ORDER: VerdictKey[] = [
  "trustworthy",
  "uncertain",
  "needs_correction",
  "unverified",
];

// ── Parsing / aggregation ─────────────────────────────────────────────────────

function normalizeVerdict(value: unknown): VerdictKey {
  if (typeof value !== "string") return "unverified";
  const key = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (key === "trustworthy" || key === "trusted") return "trustworthy";
  if (key === "uncertain") return "uncertain";
  if (
    key === "needs_correction" ||
    key === "needs_correction_required" ||
    key === "false" ||
    key === "incorrect"
  ) {
    return "needs_correction";
  }
  return "unverified";
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

function normalizeLatency(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseRuns(raw: unknown): ChatRun[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const runs: ChatRun[] = [];

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    const answer = typeof record.answer === "string" ? record.answer.trim() : "";
    if (!question && !answer) return;

    const id = typeof record.id === "string" && record.id ? record.id : `index-${index}`;
    if (seen.has(id)) return;
    seen.add(id);

    const createdAtRaw = typeof record.createdAt === "string" ? record.createdAt : null;
    const parsedTime = createdAtRaw ? Date.parse(createdAtRaw) : Number.NaN;

    runs.push({
      id,
      question,
      answer,
      createdAtMs: Number.isFinite(parsedTime) ? parsedTime : 0,
      createdAtRaw,
      verdict: normalizeVerdict(record.verdict),
      confidence: normalizeConfidence(record.confidence),
      latencyMs: normalizeLatency(record.latencyMs),
      source:
        typeof record.source === "string" && record.source.trim()
          ? record.source.trim()
          : "unknown",
      mode: typeof record.mode === "string" && record.mode.trim() ? record.mode.trim() : "unknown",
    });
  });

  return runs.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function readHistory(): { runs: ChatRun[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { runs: [], error: null };
    return { runs: parseRuns(JSON.parse(raw)), error: null };
  } catch (error) {
    return {
      runs: [],
      error: error instanceof Error ? error.message : "The stored history could not be read.",
    };
  }
}

function isBenchmarkSnapshot(value: unknown): value is BenchmarkSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.schema_version === 2 &&
    Array.isArray(snapshot.results) &&
    typeof snapshot.questions_evaluated === "number" &&
    Number.isFinite(snapshot.questions_evaluated) &&
    snapshot.questions_evaluated > 0 &&
    typeof snapshot.accuracy === "number" &&
    Number.isFinite(snapshot.accuracy)
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatLatency(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function formatWhen(run: ChatRun): string {
  if (!run.createdAtMs) return "Time unavailable";
  const elapsed = Date.now() - run.createdAtMs;
  if (elapsed >= 0 && elapsed < 60_000) return "just now";
  if (elapsed >= 60_000 && elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed >= 3_600_000 && elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(run.createdAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Small presentational pieces ───────────────────────────────────────────────

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Nav() {
  return <BkNav active="dashboard" />;
}

function SectionHeading({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="bk-eyebrow">{eyebrow}</p>
        <h2 className="mt-1.5 text-base font-semibold tracking-tight text-[var(--bk-ink)]">{title}</h2>
      </div>
      {aside && <span className="font-mono text-[11px] text-[var(--bk-muted)]">{aside}</span>}
    </div>
  );
}

function MetricCard({
  eyebrow,
  value,
  detail,
  icon,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="bk-card bk-frame bk-press p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="bk-eyebrow">{eyebrow}</p>
        <span className="text-[var(--bk-muted)]" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-5 text-[2.1rem] font-black leading-none text-[var(--bk-ink)]">{value}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--bk-muted)]">{detail}</p>
    </div>
  );
}

function VerdictChip({ verdict, confidence }: { verdict: VerdictKey; confidence: number | null }) {
  const meta = VERDICTS[verdict];
  return (
    <span
      className="bk-badge text-[11px]"
      style={{ color: meta.color, background: meta.tint, borderColor: "var(--bk-line)" }}
    >
      <span className="h-1.5 w-1.5 " style={{ background: meta.color }} />
      {meta.short}
      {confidence !== null && <span className="font-mono opacity-70">{formatPercent(confidence)}</span>}
    </span>
  );
}

function VerdictDistribution({
  counts,
  total,
}: {
  counts: Record<VerdictKey, number>;
  total: number;
}) {
  return (
    <section className="bk-card bk-frame p-6">
      <SectionHeading eyebrow="Outcomes" title="Verdict distribution" aside={`${total} checks`} />

      <div
        className="mt-6 flex h-3 gap-1 overflow-hidden bg-[var(--bk-paper)]"
        role="img"
        aria-label={VERDICT_ORDER.map((key) => `${VERDICTS[key].label}: ${counts[key]}`).join(", ")}
      >
        {VERDICT_ORDER.filter((key) => counts[key] > 0).map((key) => (
          <div
            key={key}
            className="h-full transition-all duration-500"
            style={{
              width: `${(counts[key] / total) * 100}%`,
              background: `linear-gradient(90deg, ${VERDICTS[key].color}, ${VERDICTS[key].color}aa)`,
              boxShadow: `0 0 12px ${VERDICTS[key].color}55`,
            }}
          />
        ))}
      </div>

      <div className="mt-7 space-y-5">
        {VERDICT_ORDER.map((key) => {
          const meta = VERDICTS[key];
          const count = counts[key];
          const share = total ? count / total : 0;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-[var(--bk-ink)]">
                  <span className="h-2 w-2 " style={{ background: meta.color }} />
                  {meta.label}
                </span>
                <span className="font-mono text-[var(--bk-muted)]">
                  <span className="text-[var(--bk-ink)]">{count}</span> · {(share * 100).toFixed(0)}%
                </span>
              </div>
              <div className="bk-frame--thin mt-2 h-2.5 overflow-hidden bg-[var(--bk-paper)]">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${share * 100}%`, background: meta.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PipelineMix({ runs }: { runs: ChatRun[] }) {
  const sources = useMemo(() => {
    const tally = new Map<string, number>();
    for (const run of runs) tally.set(run.source, (tally.get(run.source) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [runs]);

  const modes = useMemo(() => {
    const tally = new Map<string, number>();
    for (const run of runs) tally.set(run.mode, (tally.get(run.mode) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [runs]);

  const max = sources[0]?.[1] || 1;

  return (
    <section className="bk-card bk-frame p-6">
      <SectionHeading eyebrow="Traffic" title="Where checks came from" aside="this browser" />
      <div className="mt-6 space-y-4">
        {sources.map(([source, count]) => (
          <div key={source} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate font-mono text-[11px] text-[var(--bk-muted)]" title={source}>
              {source}
            </span>
            <div className="bk-frame--thin h-3 flex-1 overflow-hidden bg-[var(--bk-paper)]">
              <div
                className="h-full  bg-[var(--bk-brand)] transition-all duration-500"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-6 shrink-0 text-right font-mono text-[11px] text-[var(--bk-muted)]">{count}</span>
          </div>
        ))}
      </div>
      <div className="mt-7 bk-divider pt-5">
        <p className="bk-eyebrow">Check mode</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {modes.map(([mode, count]) => (
            <span
              key={mode}
              className="bk-badge bk-badge--paper font-mono text-[10px]"
            >
              {mode} <span className="text-[var(--bk-ink)]">{count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentChecks({
  runs,
  total,
  filter,
  onFilter,
  showAll,
  onShowAll,
  counts,
}: {
  runs: ChatRun[];
  total: number;
  filter: VerdictKey | "all";
  onFilter: (value: VerdictKey | "all") => void;
  showAll: boolean;
  onShowAll: () => void;
  counts: Record<VerdictKey, number>;
}) {
  const filters: Array<{ key: VerdictKey | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: total },
    ...VERDICT_ORDER.map((key) => ({ key, label: VERDICTS[key].short, count: counts[key] })),
  ];
  const visible = showAll ? runs : runs.slice(0, 8);

  return (
    <section className="bk-card bk-frame mt-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 bk-divider p-6">
        <SectionHeading eyebrow="Run log" title="Recent checks" aside={`${runs.length} shown`} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter recent checks by verdict">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => onFilter(item.key)}
              className={`bk-btn bk-btn--sm text-[11px] ${
                filter === item.key
                  ? "bk-btn--paper"
                  : "bk-btn--ghost"
              }`}
            >
              {item.label} <span className="font-mono opacity-70">{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-[var(--bk-muted)]">
          No checks match this filter.
        </div>
      ) : (
        <ul className="space-y-2.5 p-4 sm:p-5">
          {visible.map((run) => (
            <li
              key={run.id}
              className="bk-frame--thin bk-card bk-press p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-[var(--bk-muted)]">
                    <time dateTime={run.createdAtRaw ?? undefined}>{formatWhen(run)}</time>
                    <span className="text-[var(--bk-muted)]">/</span>
                    <span className="normal-case tracking-normal">{run.source}</span>
                    <span className="text-[var(--bk-muted)]">/</span>
                    <span className="normal-case tracking-normal">{run.mode}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-[var(--bk-ink)]">
                    {run.question || "(no question recorded)"}
                  </p>
                  {run.answer && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--bk-muted)]">{run.answer}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <VerdictChip verdict={run.verdict} confidence={null} />
                  <span className="font-mono text-[11px] text-[var(--bk-muted)]">{formatLatency(run.latencyMs)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {runs.length > 8 && (
        <div className="bk-divider px-5 py-3 text-center">
          <button
            type="button"
            onClick={onShowAll}
            className="text-xs font-semibold text-blue-300 transition-colors hover:text-blue-200"
          >
            {showAll ? "Show only the 8 most recent" : `Show all ${runs.length} matching checks`}
          </button>
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-busy="true" className="rise-in">
      <p className="bk-eyebrow mb-4">Reading local run history…</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="bk-card bk-frame h-36 p-5">
            <div className="bk-skeleton h-3 w-20" />
            <div className="bk-skeleton mt-6 h-8 w-24" />
            <div className="bk-skeleton mt-4 h-2.5 w-32" />
          </div>
        ))}
      </div>
      <div className="bk-card bk-frame mt-5 h-64 animate-pulse" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bk-card bk-frame rise-in px-6 py-14 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center bk-frame--thin border bg-[var(--bk-warning-soft)] text-lg text-[var(--bk-warning-text)]">
        !
      </div>
      <p className="bk-eyebrow mt-6">History unavailable</p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--bk-ink)]">This browser could not read its run history.</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[var(--bk-muted)]">
        Nothing has been invented to fill the gap. Your checks still run normally in chat; only this
        local readout is unavailable.
      </p>
      <p className="mx-auto mt-3 max-w-lg font-mono text-[11px] text-[var(--bk-muted)]">{message}</p>
      <Link href="/chat" className="bk-btn bk-press mt-7">
        Open chat <ArrowIcon />
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bk-card bk-frame rise-in overflow-hidden px-6 py-16 text-center sm:py-20">
      <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 -translate-y-1/2 bg-[var(--bk-brand-soft)] opacity-70" />
      <div className="relative mx-auto mb-8 h-24 w-24">
        <div className="absolute inset-0 border border-[var(--bk-line)]" />
        <div className="absolute inset-3 border border-[var(--bk-brand)]" />
        <div className="absolute inset-0 grid place-items-center">
          <div className="bk-frame grid h-12 w-12 place-items-center overflow-hidden bg-white">
            <img
              src="/beta-mark.png"
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-contain"
              aria-hidden="true"
            />
          </div>
        </div>
        <span className="absolute right-0 top-4 h-2.5 w-2.5 border-[2px] border-[var(--bk-line)] bg-[var(--bk-evidence)]" />
      </div>

      <p className="bk-eyebrow">No checks recorded yet</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--bk-ink)] sm:text-3xl">
        A clean slate for your firewall.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--bk-muted)]">
        Ask a question or paste a claim in chat. Every completed check writes a real record to this
        browser — verdict, confidence, latency, and the question behind it — and the numbers here
        build from those records. Nothing is pre-filled.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/chat" className="bk-btn bk-press">
          Run your first check <ArrowIcon />
        </Link>
        <Link href="/status" className="bk-btn bk-press">
          View pipeline status
        </Link>
      </div>
    </div>
  );
}

function BenchmarkNote({ snapshot }: { snapshot: BenchmarkSnapshot | null }) {
  if (!snapshot) return null;
  const runAt = snapshot.run_at ? Date.parse(snapshot.run_at) : Number.NaN;
  return (
    <aside className="bk-card bk-frame mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p className="bk-eyebrow">Optional reference snapshot</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--bk-muted)]">
          A separate harness run. It is not part of the live history above and does not affect it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-5 font-mono text-xs">
        <span className="text-[var(--bk-muted)]">
          accuracy <span className="text-[var(--bk-ink)]">{(snapshot.accuracy * 100).toFixed(1)}%</span>
        </span>
        <span className="text-[var(--bk-muted)]">
          n <span className="text-[var(--bk-ink)]">{snapshot.questions_evaluated}</span>
        </span>
        <span className="text-[var(--bk-muted)]">
          {Number.isFinite(runAt)
            ? new Date(runAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "date unavailable"}
        </span>
      </div>
    </aside>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function RunMetricsPanel() {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkSnapshot | null>(null);
  const [filter, setFilter] = useState<VerdictKey | "all">("all");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    const result = readHistory();
    setRuns(result.runs);
    setError(result.error);
    setPhase("ready");
  }, []);

  useEffect(() => {
    load();

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) load();
    };
    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // Optional snapshot: a stale or missing benchmark never blocks or blanks the page.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/benchmark", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (isBenchmarkSnapshot(payload)) setBenchmark(payload);
      })
      .catch(() => {
        // Intentionally silent — this is supplementary data only.
      });
    return () => controller.abort();
  }, []);

  const stats = useMemo(() => {
    const counts: Record<VerdictKey, number> = {
      trustworthy: 0,
      uncertain: 0,
      needs_correction: 0,
      unverified: 0,
    };
    const confidences: number[] = [];
    const latencies: number[] = [];

    for (const run of runs) {
      counts[run.verdict] += 1;
      if (run.confidence !== null) confidences.push(run.confidence);
      if (run.latencyMs !== null) latencies.push(run.latencyMs);
    }

    return {
      counts,
      total: runs.length,
      avgConfidence: mean(confidences),
      confidenceSample: confidences.length,
      avgLatency: mean(latencies),
      latencySample: latencies.length,
      trustShare: runs.length ? counts.trustworthy / runs.length : 0,
    };
  }, [runs]);

  const filteredRuns = useMemo(
    () => (filter === "all" ? runs : runs.filter((run) => run.verdict === filter)),
    [runs, filter]
  );

  return (
    <div className="bk-app text-[var(--bk-ink)]">
      <Nav />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <header className="rise-in flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="bk-eyebrow">Firewall analytics · this browser</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--bk-ink)] sm:text-[2.6rem]">
              Every check, at a glance.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--bk-muted)]">
              Live totals from the checks you run in BETA. No benchmark snapshot, database, or
              realtime credential is required for this page to work.
            </p>
          </div>
          <Link href="/chat" className="bk-btn bk-press">
            New check <ArrowIcon />
          </Link>
        </header>

        <div className="mt-9">
          {phase === "loading" ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : runs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="rise-in">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  eyebrow="Total checks"
                  value={String(stats.total)}
                  detail="Completed checks saved in this browser"
                  icon={
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <rect x="4" y="4" width="16" height="16" rx="4" />
                      <path d="M9 10h6M9 14h4" strokeLinecap="round" />
                    </svg>
                  }
                />
                <MetricCard
                  eyebrow="Trust rate"
                  value={formatPercent(stats.trustShare)}
                  detail={`${stats.counts.trustworthy} trustworthy of ${stats.total} checks`}
                  icon={
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z" strokeLinejoin="round" />
                    </svg>
                  }
                />
                <MetricCard
                  eyebrow="Avg confidence"
                  value={formatPercent(stats.avgConfidence)}
                  detail={
                    stats.confidenceSample
                      ? `Mean across ${stats.confidenceSample} measured check${stats.confidenceSample === 1 ? "" : "s"}`
                      : "No confidence values reported"
                  }
                  icon={
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 17h3l3-8 4 11 3-7h3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                />
                <MetricCard
                  eyebrow="Avg latency"
                  value={formatLatency(stats.avgLatency)}
                  detail={
                    stats.latencySample
                      ? `Mean across ${stats.latencySample} measured check${stats.latencySample === 1 ? "" : "s"}`
                      : "No latency values reported"
                  }
                  icon={
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                />
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <VerdictDistribution counts={stats.counts} total={stats.total} />
                </div>
                <div className="lg:col-span-2">
                  <PipelineMix runs={runs} />
                </div>
              </div>

              <RecentChecks
                runs={filteredRuns}
                total={stats.total}
                filter={filter}
                onFilter={(value) => {
                  setFilter(value);
                  setShowAll(false);
                }}
                showAll={showAll}
                onShowAll={() => setShowAll((value) => !value)}
                counts={stats.counts}
              />
            </div>
          )}
        </div>

        <BenchmarkNote snapshot={benchmark} />

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 bk-divider pt-5 text-[11px] text-[var(--bk-muted)]">
          <span>Runs are read from this browser only. No synthetic data is used.</span>
          <Link href="/status" className="text-[var(--bk-muted)] transition-colors hover:text-[var(--bk-ink)]">
            Check the active pipeline →
          </Link>
        </footer>
      </main>
    </div>
  );
}
