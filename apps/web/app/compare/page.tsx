"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

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

interface CompareData {
  question: string;
  results: ModelResult[];
  agreement: Agreement;
  total_latency_ms: number;
}

// ── Verdict helpers ───────────────────────────────────────────────────────────
const verdictMeta: Record<
  Verdict,
  { label: string; cssClass: string; icon: string }
> = {
  trustworthy: {
    label: "Trustworthy",
    cssClass: "verdict-trustworthy",
    icon: "✓",
  },
  uncertain: { label: "Uncertain", cssClass: "verdict-uncertain", icon: "~" },
  needs_correction: {
    label: "Needs Correction",
    cssClass: "verdict-needs-correction",
    icon: "✗",
  },
};

const modelMeta: Record<string, { label: string; color: string; provider?: string }> = {
  "local-gemma": { label: "Gemma 2-2B (White-box)", color: "#a855f7", provider: "Local SAE" },
  chatgpt: { label: "ChatGPT (via Groq / OpenRouter)", color: "#22c55e", provider: "Groq (Primary)" },
  claude: { label: "Claude (via OpenRouter)", color: "#f59e0b", provider: "OpenRouter (:free)" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7
      ? "var(--verdict-trustworthy)"
      : value >= 0.45
      ? "var(--verdict-uncertain)"
      : "var(--verdict-needs-correction)";
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1" style={{ color: "#64748b" }}>
        <span>Confidence</span>
        <span style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-0)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-3"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
      <div className="skeleton h-5 w-24 rounded" />
      <div className="skeleton h-4 w-full rounded" />
      <div className="skeleton h-4 w-5/6 rounded" />
      <div className="skeleton h-4 w-4/6 rounded" />
      <div className="skeleton h-2 w-full rounded mt-2" />
    </div>
  );
}

function ErrorCard({ model, message }: { model: string; message: string }) {
  const meta = modelMeta[model] ?? { label: model, color: "#64748b" };
  return (
    <div className="rounded-2xl border p-5"
      style={{ background: "var(--surface-1)", borderColor: "var(--verdict-needs-correction-border)" }}>
      <div className="font-bold text-sm mb-2" style={{ color: meta.color }}>
        {meta.label}
      </div>
      <div className="text-xs rounded-lg p-3"
        style={{ background: "var(--verdict-needs-correction-bg)", color: "var(--verdict-needs-correction)" }}>
        ✗ {message}
      </div>
    </div>
  );
}

function EntityChips({ entities }: { entities: string[] }) {
  if (!entities?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {entities.map((e) => (
        <span key={e}
          className="text-xs px-2 py-0.5 rounded-full border"
          style={{
            background: "var(--surface-2)",
            color: "#94a3b8",
            borderColor: "var(--border-subtle)",
          }}>
          {e}
        </span>
      ))}
    </div>
  );
}

function ResultCard({ result }: { result: ModelResult }) {
  const meta = modelMeta[result.model] ?? { label: result.model, color: "#64748b" };
  const vm = result.verdict ? verdictMeta[result.verdict] : null;

  return (
    <div className="rounded-2xl border flex flex-col gap-4 p-5 h-full"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-default)" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-sm" style={{ color: meta.color }}>
            {meta.label}
          </div>
          {meta.provider && (
            <div className="text-[10px] text-slate-400 font-mono">
              Provider: {meta.provider}
            </div>
          )}
        </div>
        <div className="text-xs" style={{ color: "#475569" }}>
          {result.latency_ms}ms
        </div>
      </div>

      {/* Verdict badge */}
      {vm && (
        <div className={`${vm.cssClass} inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold w-fit`}>
          <span>{vm.icon}</span> {vm.label}
        </div>
      )}

      {/* Confidence meter */}
      {result.confidence !== null && (
        <ConfidenceMeter value={result.confidence} />
      )}

      {/* Answer */}
      {result.answer && (
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: "#475569" }}>ANSWER</div>
          <p className="text-sm leading-relaxed" style={{ color: "#cbd5e1" }}>
            {result.answer}
          </p>
        </div>
      )}

      {/* Auto-extracted entities */}
      {result.entities?.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: "#475569" }}>ENTITIES DETECTED</div>
          <EntityChips entities={result.entities} />
        </div>
      )}

      {/* Evidence */}
      {result.evidence?.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: "#475569" }}>EVIDENCE</div>
          <ul className="text-xs space-y-1" style={{ color: "#94a3b8" }}>
            {result.evidence.map((ev, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: "#334155" }}>•</span>
                <span>{ev}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Corrected answer (Phase 5.5.3 — always inline, never behind a button) */}
      {result.corrected_answer && (
        <div className="rounded-xl border p-3"
          style={{
            background: "var(--verdict-trustworthy-bg)",
            borderColor: "var(--verdict-trustworthy-border)",
          }}>
          <div className="text-xs font-bold mb-1" style={{ color: "var(--verdict-trustworthy)" }}>
            ✓ CORRECTED ANSWER
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "#d1fae5" }}>
            {result.corrected_answer}
          </p>
          {result.retrieved_facts?.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold mb-1" style={{ color: "#166534" }}>SOURCE FACTS USED</div>
              <ul className="text-xs space-y-1" style={{ color: "#86efac" }}>
                {result.retrieved_facts.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span>›</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
    <div className="rounded-2xl border p-5"
      style={{
        background: agreement.all_agree ? "var(--verdict-trustworthy-bg)" : "var(--verdict-uncertain-bg)",
        borderColor: agreement.all_agree ? "var(--verdict-trustworthy-border)" : "var(--verdict-uncertain-border)",
      }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-bold">
          {agreement.all_agree ? "✓ All models agree" : "~ Models disagree"}
        </span>
        {topVerdict && (
          <span className={`${verdictMeta[topVerdict].cssClass} px-3 py-1 rounded-full text-xs font-semibold`}>
            Majority: {verdictMeta[topVerdict].label}
          </span>
        )}
        {agreement.outliers.length > 0 && (
          <span className="text-xs" style={{ color: "#94a3b8" }}>
            Outlier: {agreement.outliers.map((o) => modelMeta[o]?.label ?? o).join(", ")}
          </span>
        )}
      </div>
      {agreement.majority_answer_cluster && !agreement.all_agree && (
        <p className="mt-2 text-xs" style={{ color: "#94a3b8" }}>
          Majority cluster: &quot;{agreement.majority_answer_cluster}&quot;
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function CompareContent() {
  const searchParams = useSearchParams();
  const [question, setQuestion] = useState("");
  const [inputQuestion, setInputQuestion] = useState("");
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const runCompare = useCallback(async (q: string) => {
    if (!q.trim()) return;
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controllerRef.current.signal,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      setData(json as CompareData);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run when navigated from the landing page with ?q=
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setInputQuestion(q);
      setQuestion(q);
      runCompare(q);
    }
  }, [searchParams, runCompare]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputQuestion.trim()) return;
    setQuestion(inputQuestion.trim());
    runCompare(inputQuestion.trim());
    // Update URL without navigation
    const url = new URL(window.location.href);
    url.searchParams.set("q", inputQuestion.trim());
    window.history.replaceState({}, "", url.toString());
  }

  const models = ["local-gemma", "chatgpt", "claude"];

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Nav */}
      <nav className="sticky top-0 flex items-center justify-between px-6 py-3 border-b z-50"
        style={{ background: "rgba(10,10,20,0.9)", borderColor: "var(--border-subtle)", backdropFilter: "blur(12px)" }}>
        <a href="/" className="font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>BETA</a>
        <div className="flex items-center gap-4 text-sm" style={{ color: "#94a3b8" }}>
          <a href="/compare" className="hover:text-white transition-colors font-semibold" style={{ color: "var(--accent)" }}>Compare</a>
          <a href="/dashboard" className="hover:text-white transition-colors">Dashboard</a>
          <a href="/status" className="hover:text-white transition-colors">Status</a>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Question input */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              placeholder="Ask a question to compare all three models…"
              className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2"
              style={{
                background: "var(--surface-1)",
                borderColor: "var(--border-default)",
                color: "var(--foreground)",
              }}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!inputQuestion.trim() || loading}
              className="rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#0a0a14" }}
            >
              {loading ? "Comparing…" : "Compare"}
            </button>
          </div>
        </form>

        {/* Error state */}
        {error && (
          <div className="rounded-2xl border p-5 mb-6"
            style={{ background: "var(--verdict-needs-correction-bg)", borderColor: "var(--verdict-needs-correction-border)" }}>
            <div className="font-bold mb-1" style={{ color: "var(--verdict-needs-correction)" }}>Error</div>
            <p className="text-sm" style={{ color: "#fca5a5" }}>{error}</p>
            <button
              onClick={() => runCompare(question)}
              className="mt-3 text-xs underline"
              style={{ color: "var(--verdict-needs-correction)" }}>
              Retry
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <>
            <div className="skeleton h-16 w-full rounded-2xl mb-6" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {models.map((m) => <SkeletonCard key={m} />)}
            </div>
          </>
        )}

        {/* Results */}
        {!loading && data && (
          <>
            {/* Question */}
            <div className="mb-5 text-sm" style={{ color: "#64748b" }}>
              Comparing answers for:{" "}
              <span className="font-semibold" style={{ color: "#cbd5e1" }}>
                &quot;{data.question}&quot;
              </span>
              <span className="ml-3 text-xs">({data.total_latency_ms}ms total)</span>
            </div>

            {/* Agreement banner */}
            <div className="mb-6">
              <AgreementBanner agreement={data.agreement} results={data.results} />
            </div>

            {/* Three-column result cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.results.map((result) =>
                result.error && !result.answer ? (
                  <ErrorCard key={result.model} model={result.model} message={result.error} />
                ) : (
                  <ResultCard key={result.model} result={result} />
                )
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !data && !error && (
          <div className="text-center py-24" style={{ color: "#334155" }}>
            <p className="text-lg mb-2">Enter a question above to begin.</p>
            <p className="text-sm">
              All three models will be queried in parallel and fact-checked automatically.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen" style={{ background: "var(--background)" }}>
          <div className="max-w-6xl mx-auto px-4 py-8">
            <div className="skeleton h-12 w-full rounded-xl mb-8" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </main>
      }
    >
      <CompareContent />
    </Suspense>
  );
}

