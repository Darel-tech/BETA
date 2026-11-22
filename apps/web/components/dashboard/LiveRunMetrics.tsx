"use client";

import { useCallback, useEffect, useState } from "react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";

interface LiveRunMetric {
  source: string;
  run_count: number;
  trustworthy_count: number;
  uncertain_count: number;
  needs_correction_count: number;
  unavailable_count: number;
  avg_confidence: number | null;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_est_cost_usd: number | null;
  avg_input_tokens: number | null;
  avg_output_tokens: number | null;
  latest_at: Date;
}

async function fetchSealedRunMetrics(): Promise<SealedLiveQuery<LiveRunMetric>> {
  const response = await fetch("/api/metrics/live", { method: "POST", cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Live metrics failed (${response.status}).`);
  return data;
}

function LiveRunMetricsQuery({
  sealedQuery,
}: {
  sealedQuery: SealedLiveQuery<LiveRunMetric>;
}) {
  const refreshQuery = useCallback(() => fetchSealedRunMetrics(), []);
  const { data, status, error } = useLiveQuery(sealedQuery, { refreshQuery });

  if (status === "error") {
    return <p role="alert" className="text-xs font-bold text-[var(--bk-warning-text)]">Live run metrics stopped: {error.message}</p>;
  }
  if (data === undefined) {
    return <p role="status" className="text-xs text-[var(--bk-muted)]">Connecting to live run metrics…</p>;
  }

  return (
    <div>
      {status === "stale" && <p role="status" className="text-xs font-bold text-[var(--bk-warning-text)] mb-2">Reconnecting; displayed metrics may be stale.</p>}
      {data.length === 0 ? (
        <p className="text-sm text-[var(--bk-muted)]">No model runs yet. New attempts will appear here as they finish.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[var(--bk-muted)] border-b-[3px] border-[var(--bk-line)]">
              {["Model source", "Runs", "Trustworthy", "Uncertain", "Needs correction", "Unavailable", "Avg confidence", "Avg latency", "P50 latency", "P95 latency", "Avg input tokens", "Avg output tokens", "Avg cost / run", "Last run"].map((heading) => (
                <th key={heading} className="text-left px-3 py-3 font-semibold">{heading}</th>
              ))}
            </tr></thead>
            <tbody>{data.map((metric) => (
              <tr key={metric.source} className="border-b-[3px] border-[var(--bk-line)] text-[var(--bk-ink)]">
                <td className="px-3 py-3 font-medium">{metric.source}</td>
                <td className="px-3 py-3">{metric.run_count}</td>
                <td className="px-3 py-3">{metric.trustworthy_count}</td>
                <td className="px-3 py-3">{metric.uncertain_count}</td>
                <td className="px-3 py-3">{metric.needs_correction_count}</td>
                <td className="px-3 py-3">{metric.unavailable_count}</td>
                <td className="px-3 py-3">{metric.avg_confidence == null ? "—" : `${(metric.avg_confidence * 100).toFixed(1)}%`}</td>
                <td className="px-3 py-3">{metric.avg_latency_ms == null ? "—" : `${metric.avg_latency_ms.toFixed(0)}ms`}</td>
                <td className="px-3 py-3">{metric.p50_latency_ms == null ? "—" : `${metric.p50_latency_ms.toFixed(0)}ms`}</td>
                <td className="px-3 py-3">{metric.p95_latency_ms == null ? "—" : `${metric.p95_latency_ms.toFixed(0)}ms`}</td>
                <td className="px-3 py-3">{metric.avg_input_tokens == null ? "—" : metric.avg_input_tokens.toFixed(0)}</td>
                <td className="px-3 py-3">{metric.avg_output_tokens == null ? "—" : metric.avg_output_tokens.toFixed(0)}</td>
                <td className="px-3 py-3">{metric.avg_est_cost_usd == null ? "—" : `$${metric.avg_est_cost_usd.toFixed(6)}`}</td>
                <td className="px-3 py-3">{new Date(metric.latest_at).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--bk-muted)] mt-2">{status === "live" ? "Live · updates on committed model runs" : "Connecting to Neon Realtime"}</p>
      <p className="text-xs text-[var(--bk-muted)]">Cost estimates use reported tokens for supported models; they stay blank when cached or corrective usage cannot be priced.</p>
    </div>
  );
}

function LiveRunMetricsEnabled({ realtimeUrl }: { realtimeUrl: string }) {
  const [client] = useState(() => createRealtimeClient({ url: realtimeUrl }));
  const [sealedQuery, setSealedQuery] = useState<SealedLiveQuery<LiveRunMetric> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSealedRunMetrics()
      .then((query) => { if (!cancelled) setSealedQuery(query); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unable to connect to live metrics."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <RealtimeProvider client={client}>
      {loadError ? (
        <p role="alert" className="text-xs font-bold text-[var(--bk-warning-text)]">{loadError}</p>
      ) : sealedQuery ? (
        <LiveRunMetricsQuery sealedQuery={sealedQuery} />
      ) : (
        <p role="status" className="text-xs text-[var(--bk-muted)]">Preparing live run metrics…</p>
      )}
    </RealtimeProvider>
  );
}

export function LiveRunMetrics() {
  const realtimeUrl = process.env.NEXT_PUBLIC_NEON_REALTIME_URL;
  if (!realtimeUrl) {
    return <p className="text-xs text-[var(--bk-muted)]">Live metrics are not configured for this environment.</p>;
  }
  return <LiveRunMetricsEnabled realtimeUrl={realtimeUrl} />;
}
