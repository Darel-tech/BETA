import React from "react";

/** BoldKit stage timeline. Status branching and payload display are unchanged. */
export function StageStepper({
  stages,
}: {
  stages: Array<{
    name: string;
    label: string;
    status: "idle" | "running" | "done" | "error" | "skipped";
    ms?: number;
    payload?: Record<string, unknown>;
  }>;
}) {
  const tone = {
    running: { shell: "bk-panel", dot: "var(--bk-brand)" },
    done: { shell: "bk-panel bk-panel--success", dot: "var(--bk-success)" },
    error: { shell: "bk-panel bk-panel--risk", dot: "var(--bk-risk)" },
    skipped: { shell: "bk-panel bk-panel--warning opacity-70", dot: "var(--bk-warning)" },
    idle: { shell: "bk-panel bk-panel--paper", dot: "var(--bk-muted)" },
  } as const;

  return (
    <div className="space-y-3 font-sans">
      {stages.map((st, i) => {
        const meta = tone[st.status];
        return (
          <div key={st.name} className={`${meta.shell} flex items-start gap-3 p-3`}>
            <span
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center border-[2px] border-[var(--bk-line)] bg-[var(--bk-paper)] font-mono text-[10px] font-black text-[var(--bk-ink)]"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wide text-[var(--bk-ink)]">
                  {st.label}
                </span>
                {st.ms != null && (
                  <span className="font-mono text-[10px] text-[var(--bk-muted)]">{st.ms}ms</span>
                )}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.dot }}>
                {st.status}
              </span>
              {st.payload && (
                <span className="mt-1 block break-words font-mono text-[10px] text-[var(--bk-muted)]">
                  {JSON.stringify(st.payload)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
