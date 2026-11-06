import React from "react";

export function StageStepper({
  stages,
}: {
  stages: Array<{
    name: string;
    label: string;
    status: "idle" | "running" | "done" | "error";
    ms?: number;
    payload?: Record<string, unknown>;
  }>;
}) {
  return (
    <div className="space-y-3 font-sans">
      {stages.map((st, i) => {
        const isRunning = st.status === "running";
        const isDone = st.status === "done";
        const isError = st.status === "error";

        return (
          <div
            key={st.name}
            className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all ${
              isRunning
                ? "border-blue-500/50 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                : isDone
                ? "border-emerald-500/30 bg-emerald-500/5"
                : isError
                ? "border-red-500/30 bg-red-500/5"
                : "border-white/5 bg-white/2 opacity-60"
            }`}
          >
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  isRunning
                    ? "bg-blue-500 text-white animate-pulse"
                    : isDone
                    ? "bg-emerald-500 text-white"
                    : isError
                    ? "bg-red-500 text-white"
                    : "bg-white/10 text-slate-400"
                }`}
              >
                {isDone ? "✓" : isError ? "✗" : i + 1}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">
                  {st.label}
                </span>
                {st.ms != null && (
                  <span className="text-[10px] font-mono text-slate-400">
                    {st.ms}ms
                  </span>
                )}
              </div>
              {st.payload && (
                <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
                  {JSON.stringify(st.payload)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
