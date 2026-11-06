"use client";

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ServiceStatus {
  name: string;
  label: string;
  status: "ok" | "degraded" | "unreachable" | "unconfigured";
  message: string;
  latency_ms?: number;
  details?: Record<string, unknown>;
}

interface StatusResponse {
  overall: "ok" | "degraded";
  services: ServiceStatus[];
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ServiceStatus["status"] }) {
  const map: Record<ServiceStatus["status"], { label: string; cls: string }> = {
    ok: { label: "● ONLINE", cls: "verdict-trustworthy" },
    degraded: { label: "~ DEGRADED", cls: "verdict-uncertain" },
    unreachable: { label: "✗ UNREACHABLE", cls: "verdict-needs-correction" },
    unconfigured: { label: "○ NOT CONFIGURED", cls: "" },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`${cls} text-xs font-bold px-3 py-1 rounded-full`}
      style={!cls ? { color: "#64748b", background: "var(--surface-2)", border: "1px solid var(--border-subtle)" } : undefined}
    >
      {label}
    </span>
  );
}

function ServiceCard({ svc }: { svc: ServiceStatus }) {
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-3"
      style={{
        background: "var(--surface-1)",
        borderColor:
          svc.status === "ok"
            ? "var(--verdict-trustworthy-border)"
            : svc.status === "degraded"
            ? "var(--verdict-uncertain-border)"
            : svc.status === "unreachable"
            ? "var(--verdict-needs-correction-border)"
            : "var(--border-subtle)",
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-sm">{svc.label}</span>
        <StatusBadge status={svc.status} />
      </div>
      <div className="text-xs" style={{ color: "#64748b" }}>
        {svc.message}
      </div>
      {svc.latency_ms !== undefined && svc.status === "ok" && (
        <div className="text-xs" style={{ color: "#475569" }}>
          Health ping: {svc.latency_ms}ms
        </div>
      )}
      {svc.details && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none" style={{ color: "#475569" }}>
            Details
          </summary>
          <pre
            className="mt-2 rounded-lg p-3 overflow-auto text-xs"
            style={{ background: "var(--surface-2)", color: "#94a3b8" }}
          >
            {JSON.stringify(svc.details, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function poll() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      }
    } catch {
      // Silently retry on next interval
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 5000); // poll every 5 s (Phase 7)
    return () => clearInterval(interval);
  }, []);

  const allOk = data?.overall === "ok";

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Nav */}
      <nav
        className="sticky top-0 flex items-center justify-between px-6 py-3 border-b z-50"
        style={{ background: "rgba(10,10,20,0.9)", borderColor: "var(--border-subtle)", backdropFilter: "blur(12px)" }}
      >
        <a href="/" className="font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>
          BETA
        </a>
        <div className="flex items-center gap-4 text-sm" style={{ color: "#94a3b8" }}>
          <a href="/compare" className="hover:text-white transition-colors">Compare</a>
          <a href="/dashboard" className="hover:text-white transition-colors">Dashboard</a>
          <a href="/status" className="hover:text-white transition-colors font-semibold" style={{ color: "var(--accent)" }}>
            Status
          </a>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8 flex-wrap">
          <h1 className="text-3xl font-bold">Service Status</h1>
          {!loading && data && (
            <span
              className={allOk ? "verdict-trustworthy" : "verdict-uncertain"}
              style={{
                fontWeight: 700,
                fontSize: "0.75rem",
                padding: "4px 12px",
                borderRadius: "9999px",
              }}
            >
              {allOk ? "ALL SYSTEMS OPERATIONAL" : "PARTIAL OUTAGE"}
            </span>
          )}
        </div>

        {lastUpdated && (
          <p className="text-xs mb-6" style={{ color: "#334155" }}>
            Last checked: {lastUpdated.toLocaleTimeString()} · auto-refreshes every 5 s
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-28 rounded-2xl" />
            ))}
          </div>
        )}

        {/* Service grid */}
        {!loading && data && (
          <div className="grid gap-4">
            {data.services.map((svc) => (
              <ServiceCard key={svc.name} svc={svc} />
            ))}
          </div>
        )}

        {/* Help text */}
        <div
          className="mt-10 rounded-xl border p-4 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "#475569" }}
        >
          <p className="font-semibold mb-1 text-sm" style={{ color: "#64748b" }}>
            Service URLs
          </p>
          <p>
            Set <code>INTERPRETABILITY_SERVICE_URL</code>, <code>BLACKBOX_SERVICE_URL</code>, and{" "}
            <code>RETRIEVAL_SERVICE_URL</code> in your <code>.env.local</code> to connect live
            services. This page polls each service&apos;s real <code>/health</code> endpoint —
            never a static response.
          </p>
        </div>
      </div>
    </main>
  );
}
