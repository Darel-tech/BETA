"use client";

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BenchmarkRow {
  id: number;
  question: string;
  source: string;
  expected: string;
  predicted: string;
  confidence: number | null;
  latency_ms: number | null;
  correct: boolean;
}

interface BenchmarkData {
  questions_evaluated: number;
  correct_matches: number;
  accuracy: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  results: BenchmarkRow[];
  note?: string;
  run_at?: string;
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function BarChart({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 0.001);
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-xs mb-1" style={{ color: "#64748b" }}>
            <span>{item.label}</span>
            <span style={{ color: "#cbd5e1" }}>{(item.value * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-0)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(item.value / max) * 100}%`, background: item.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="text-xs font-semibold mb-1" style={{ color: "#475569" }}>
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: "#334155" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    chatgpt: "#22c55e",
    claude: "#f59e0b",
    "local-gemma": "#a855f7",
  };
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-semibold"
      style={{
        color: colors[source] ?? "#94a3b8",
        background: `${colors[source] ?? "#94a3b8"}20`,
      }}
    >
      {source}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const cls: Record<string, string> = {
    trustworthy: "verdict-trustworthy",
    uncertain: "verdict-uncertain",
    needs_correction: "verdict-needs-correction",
  };
  return (
    <span className={`${cls[verdict] ?? ""} text-xs px-2 py-0.5 rounded-full font-semibold`}>
      {verdict}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState("all");
  const [filterCorrect, setFilterCorrect] = useState("all");

  useEffect(() => {
    // Load from the benchmark_results.json that harness.py writes
    fetch("/api/benchmark")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--background)" }}>
        <div className="max-w-5xl mx-auto px-4 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
          <div className="skeleton h-48 rounded-2xl" />
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="text-center max-w-md">
          <p className="text-xl font-bold mb-3">No benchmark data yet</p>
          <p className="text-sm mb-6" style={{ color: "#64748b" }}>
            Run <code className="px-2 py-1 rounded" style={{ background: "var(--surface-2)" }}>python eval/harness.py</code> against
            the live API to generate real results.
          </p>
          <a href="/" className="text-sm underline" style={{ color: "var(--accent)" }}>
            ← Back to Home
          </a>
        </div>
      </main>
    );
  }

  const sources = ["all", ...new Set(data.results.map((r) => r.source))];
  const filtered = data.results.filter((r) => {
    if (filterSource !== "all" && r.source !== filterSource) return false;
    if (filterCorrect === "correct" && !r.correct) return false;
    if (filterCorrect === "wrong" && r.correct) return false;
    return true;
  });

  const latencies = data.results
    .map((r) => r.latency_ms)
    .filter((l): l is number => l !== null);
  const avgLatency = latencies.length
    ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)
    : "N/A";

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Nav */}
      <nav className="sticky top-0 flex items-center justify-between px-6 py-3 border-b z-50"
        style={{ background: "rgba(10,10,20,0.9)", borderColor: "var(--border-subtle)", backdropFilter: "blur(12px)" }}>
        <a href="/" className="font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>BETA</a>
        <div className="flex items-center gap-4 text-sm" style={{ color: "#94a3b8" }}>
          <a href="/compare" className="hover:text-white transition-colors">Compare</a>
          <a href="/dashboard" className="hover:text-white transition-colors font-semibold" style={{ color: "var(--accent)" }}>Dashboard</a>
          <a href="/status" className="hover:text-white transition-colors">Status</a>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-2">Benchmark Dashboard</h1>
        {data.run_at && (
          <p className="text-xs mb-6" style={{ color: "#334155" }}>
            Last run: {new Date(data.run_at).toLocaleString()}
          </p>
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Accuracy"
            value={`${(data.accuracy * 100).toFixed(1)}%`}
            sub={`${data.correct_matches} / ${data.questions_evaluated}`}
          />
          <MetricCard
            label="F1 Score"
            value={`${(data.f1_score * 100).toFixed(1)}%`}
            sub={`P: ${(data.precision * 100).toFixed(1)}% R: ${(data.recall * 100).toFixed(1)}%`}
          />
          <MetricCard
            label="Questions"
            value={String(data.questions_evaluated)}
            sub="evaluated end-to-end"
          />
          <MetricCard
            label="Avg Latency"
            value={avgLatency === "N/A" ? "N/A" : `${avgLatency}ms`}
            sub="per check"
          />
        </div>

        {/* Bar chart */}
        <div className="rounded-2xl border p-6 mb-8"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#64748b" }}>
            PERFORMANCE BREAKDOWN
          </h2>
          <BarChart
            items={[
              { label: "Accuracy", value: data.accuracy, color: "var(--verdict-trustworthy)" },
              { label: "Precision", value: data.precision, color: "var(--accent)" },
              { label: "Recall", value: data.recall, color: "#a855f7" },
              { label: "F1 Score", value: data.f1_score, color: "var(--verdict-uncertain)" },
            ]}
          />
        </div>

        {/* Confusion counts */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "True Positives", value: data.true_positives, color: "var(--verdict-trustworthy)" },
            { label: "False Positives", value: data.false_positives, color: "var(--verdict-uncertain)" },
            { label: "False Negatives", value: data.false_negatives, color: "var(--verdict-needs-correction)" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border p-4 text-center"
              style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
              <div className="text-3xl font-bold" style={{ color: item.color }}>{item.value}</div>
              <div className="text-xs mt-1" style={{ color: "#475569" }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* Results table */}
        <div className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 p-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ background: "var(--surface-2)", borderColor: "var(--border-default)", color: "#cbd5e1" }}
            >
              {sources.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All sources" : s}</option>
              ))}
            </select>
            <select
              value={filterCorrect}
              onChange={(e) => setFilterCorrect(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ background: "var(--surface-2)", borderColor: "var(--border-default)", color: "#cbd5e1" }}
            >
              <option value="all">All results</option>
              <option value="correct">Correct only</option>
              <option value="wrong">Wrong only</option>
            </select>
            <span className="text-xs self-center" style={{ color: "#475569" }}>
              Showing {filtered.length} of {data.results.length}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "#475569" }}>
                  {["#", "Question", "Source", "Expected", "Predicted", "Conf", "Latency", "Match"].map(
                    (h) => (
                      <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: row.correct ? "transparent" : "rgba(239,68,68,0.04)",
                    }}>
                    <td className="px-4 py-3" style={{ color: "#475569" }}>{row.id}</td>
                    <td className="px-4 py-3 max-w-xs" style={{ color: "#cbd5e1" }}>
                      <span className="line-clamp-2">{row.question}</span>
                    </td>
                    <td className="px-4 py-3"><SourceBadge source={row.source} /></td>
                    <td className="px-4 py-3"><VerdictBadge verdict={row.expected} /></td>
                    <td className="px-4 py-3"><VerdictBadge verdict={row.predicted} /></td>
                    <td className="px-4 py-3" style={{ color: "#94a3b8" }}>
                      {row.confidence !== null ? `${(row.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "#94a3b8" }}>
                      {row.latency_ms !== null ? `${row.latency_ms}ms` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.correct ? (
                        <span style={{ color: "var(--verdict-trustworthy)" }}>✓</span>
                      ) : (
                        <span style={{ color: "var(--verdict-needs-correction)" }}>✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {data.note && (
          <p className="mt-4 text-xs" style={{ color: "#334155" }}>
            Note: {data.note}
          </p>
        )}
      </div>
    </main>
  );
}
