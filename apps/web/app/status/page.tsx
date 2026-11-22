"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BkNav } from "@/components/ui/BoldKit";

type ServiceStatus = "ok" | "degraded" | "unreachable" | "unconfigured";
type Tone = "ok" | "attention" | "muted";

interface ServiceEntry {
  name: string;
  label: string;
  group: "pipeline" | "microservice";
  status: ServiceStatus;
  headline: string;
  detail: string;
  meta: string;
  optional: boolean;
  port?: number;
  latencyMs?: number;
}

interface StatusPayload {
  overall: "ok" | "degraded";
  title: string;
  reason: string;
  checkedAt: string;
  providers: { groq: boolean; openrouter: boolean };
  verification: "configuration-only";
  pipeline: ServiceEntry[];
  microservices: ServiceEntry[];
}

const REFRESH_MS = 10_000;

function toneFor(status: ServiceStatus): Tone {
  if (status === "ok") return "ok";
  if (status === "unconfigured") return "muted";
  return "attention";
}

function pillLabel(status: ServiceStatus): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "unconfigured":
      return "Not configured";
    case "unreachable":
      return "Unreachable";
    case "degraded":
      return "Not healthy";
  }
}

function pillClasses(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "bk-badge bk-badge--success";
    case "attention":
      return "bk-badge bk-badge--warning";
    case "muted":
      return "bk-badge bk-badge--paper";
  }
}

function toneText(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "text-[var(--bk-success-text)]";
    case "attention":
      return "text-[var(--bk-warning-text)]";
    case "muted":
      return "text-[var(--bk-muted)]";
  }
}

function ledClasses(tone: Tone): string {
  const color =
    tone === "ok"
      ? "bg-[var(--bk-success)]"
      : tone === "attention"
        ? "bg-[var(--bk-warning)]"
        : "bg-[var(--bk-muted)]";
  return `inline-block shrink-0 border-[2px] border-[var(--bk-line)] ${color}`;
}

function formatTime(iso: string): string {
  const value = Date.parse(iso);
  return Number.isFinite(value)
    ? new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "time unavailable";
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M20 11a8 8 0 1 0-2.3 6.2M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Nav() {
  return <BkNav active="status" />;
}

function ServiceCard({ entry }: { entry: ServiceEntry }) {
  const tone = toneFor(entry.status);

  return (
    <li className="bk-card bk-frame bk-press flex items-start gap-3 p-5">
      <span className={`${ledClasses(tone)} mt-1.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-[var(--bk-ink)]">{entry.label}</p>
            <p className="mt-1 font-mono text-[10px] text-[var(--bk-muted)]">{entry.meta}</p>
          </div>
          <span
            className={`shrink-0 ${pillClasses(tone)}`}
          >
            {pillLabel(entry.status)}
          </span>
        </div>
        <p className={`mt-4 text-sm font-medium ${toneText(tone)}`}>{entry.headline}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--bk-muted)]">{entry.detail}</p>
        {entry.latencyMs !== undefined && (
          <p className="mt-3 font-mono text-[10px] text-[var(--bk-muted)]">health ping · {entry.latencyMs}ms</p>
        )}
      </div>
    </li>
  );
}

function StatusGroup({
  eyebrow,
  title,
  description,
  entries,
  columns,
}: {
  eyebrow: string;
  title: string;
  description: string;
  entries: ServiceEntry[];
  columns: string;
}) {
  return (
    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bk-eyebrow">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-[var(--bk-ink)]">{title}</h2>
        </div>
        <p className="max-w-lg text-xs leading-relaxed text-[var(--bk-muted)]">{description}</p>
      </div>
      <ul className={`mt-5 grid gap-4 ${columns}`}>
        {entries.map((entry) => (
          <ServiceCard key={entry.name} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-busy="true" className="rise-in space-y-5">
      <div className="bk-card bk-frame h-44 p-8">
        <div className="bk-skeletonh-3 w-24" />
        <div className="bk-skeletonmt-6 h-7 w-64" />
        <div className="bk-skeletonmt-4 h-3 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="bk-card bk-frame h-40 p-5">
            <div className="bk-skeletonh-3 w-32" />
            <div className="bk-skeletonmt-6 h-3 w-20" />
            <div className="bk-skeletonmt-3 h-2.5 w-full" />
            <div className="bk-skeletonmt-2 h-2.5 w-3/4" />
          </div>
        ))}
      </div>
      <p className="sr-only">Checking the active pipeline…</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bk-card bk-frame rise-in px-6 py-14 text-center">
      <div className="bk-frame--thin mx-auto grid h-14 w-14 place-items-center border bg-[var(--bk-warning-soft)] text-lg text-[var(--bk-warning-text)]">
        !
      </div>
      <p className="bk-eyebrow mt-6">Status unavailable</p>
      <h2 className="mt-2 text-xl font-black text-[var(--bk-ink)]">The status endpoint did not respond.</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[var(--bk-muted)]">
        This is a status-readout failure, not proof that the firewall is down. The page will retry
        automatically.
      </p>
      <p className="mx-auto mt-3 max-w-lg font-mono text-[11px] text-[var(--bk-muted)]">{message}</p>
    </div>
  );
}

function Explanation({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-xs leading-relaxed text-[var(--bk-muted)]">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 border-[2px] border-[var(--bk-line)] bg-[var(--bk-brand)]" />
      <span>{children}</span>
    </li>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const poll = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);

    try {
      const response = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `Status request failed (${response.status}).`;
        throw new Error(message);
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray((payload as StatusPayload).pipeline) ||
        !Array.isArray((payload as StatusPayload).microservices)
      ) {
        throw new Error("Status response was incomplete.");
      }
      setData(payload as StatusPayload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the status endpoint.");
    } finally {
      inFlight.current = false;
      if (manual) setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [poll]);

  const overallTone: Tone = data?.overall === "ok" ? "ok" : "attention";

  return (
    <div className="bk-app text-[var(--bk-ink)]">
      <Nav />
      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <header className="rise-in flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="bk-eyebrow">System telemetry · live</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--bk-ink)] sm:text-[2.6rem]">
              Is BETA actually running?
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--bk-muted)]">
              The active pipeline and its optional fallbacks, reported separately. Refreshes every 10
              seconds.
            </p>
          </div>
          <Link href="/chat" className="bk-btn bk-press">
            Open chat →
          </Link>
        </header>

        {loading ? (
          <div className="mt-9">
            <LoadingState />
          </div>
        ) : !data ? (
          <div className="mt-9">
            <ErrorState message={error ?? "Unknown status error."} />
          </div>
        ) : (
          <div className="rise-in mt-9">
            {error && (
              <div
                role="alert"
                className="mb-5 bk-panel bk-panel--warning px-4 py-3 text-xs"
              >
                Refresh failed; showing the last successful check. {error}
              </div>
            )}

            <section className="bk-card bk-frame relative overflow-hidden p-6 sm:p-8">
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 bg-[var(--bk-brand-soft)] opacity-70" />
              <div className="relative flex flex-wrap items-start gap-5">
                <span className={`${ledClasses(overallTone)} mt-2 h-3 w-3`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="bk-eyebrow">Overall</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--bk-ink)] sm:text-3xl">
                    {data.title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--bk-muted)]">{data.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void poll(true)}
                  disabled={refreshing}
                  className="bk-btn bk-press shrink-0"
                >
                  <RefreshIcon spinning={refreshing} />
                  {refreshing ? "Refreshing…" : "Refresh now"}
                </button>
              </div>

              <div className="relative mt-7 flex flex-wrap gap-x-7 gap-y-2 bk-divider pt-5 font-mono text-[11px] text-[var(--bk-muted)]">
                <span>Checked {formatTime(data.checkedAt)}</span>
                <span>Auto-refresh {REFRESH_MS / 1000}s</span>
                <span>Provider check: configuration only</span>
              </div>
            </section>

            <StatusGroup
              eyebrow="What powers a check"
              title="Active pipeline"
              description="Generation and the firewall engine. This is the path chat actually uses; it does not depend on Python services."
              entries={data.pipeline}
              columns="sm:grid-cols-2"
            />

            <StatusGroup
              eyebrow="Not required to run"
              title="Optional microservices"
              description="Legacy Python fallbacks on ports 8001–8003. They are probed for information only — unreachable here does not mean the app is down."
              entries={data.microservices}
              columns="md:grid-cols-3"
            />

            <aside className="bk-card bk-frame mt-9 p-6">
              <p className="bk-eyebrow">How to read this</p>
              <ul className="mt-4 space-y-3">
                <Explanation>
                  Overall is &ldquo;ready&rdquo; when at least one of{" "}
                  <code className="font-mono text-[var(--bk-muted)]">GROQ_API_KEY</code> or{" "}
                  <code className="font-mono text-[var(--bk-muted)]">OPENROUTER_API_KEY</code> is present on the
                  server. With neither, it is correctly shown as degraded.
                </Explanation>
                <Explanation>
                  Credential values are never returned or printed. This endpoint checks presence only;
                  it does not spend tokens on test generations. Failures of real calls surface directly
                  in chat.
                </Explanation>
                <Explanation>
                  The in-process detector performs resampling, NLI-style entailment and grounded
                  correction on the Next.js server. Offline microservices are optional fallbacks, so
                  they cannot take the active pipeline down.
                </Explanation>
              </ul>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
