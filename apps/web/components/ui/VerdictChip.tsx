import React from "react";

/** BoldKit verdict badge. Verdict logic and confidence formatting are unchanged. */
export function VerdictChip({
  verdict,
  confidence,
  size = "md",
}: {
  verdict: "trustworthy" | "uncertain" | "needs_correction";
  confidence?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const configs = {
    trustworthy: { label: "Trustworthy", icon: "✓", tone: "bk-badge--success" },
    uncertain: { label: "Uncertain", icon: "~", tone: "bk-badge--warning" },
    needs_correction: { label: "Needs correction", icon: "✗", tone: "bk-badge--risk" },
  } as const;

  const cfg = configs[verdict] ?? configs.uncertain;
  const sizeClass = size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm px-4 py-2" : "";

  return (
    <span className={`bk-badge ${cfg.tone} ${sizeClass}`}>
      <span aria-hidden="true">{cfg.icon}</span>
      <span>{cfg.label}</span>
      {confidence != null && (
        <span className="font-mono opacity-80">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
