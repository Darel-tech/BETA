import React from "react";

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
    trustworthy: {
      label: "Trustworthy",
      icon: "✓",
      bg: "var(--ok-bg)",
      border: "var(--ok-border)",
      color: "var(--ok)",
    },
    uncertain: {
      label: "Uncertain",
      icon: "~",
      bg: "var(--warn-bg)",
      border: "var(--warn-border)",
      color: "var(--warn)",
    },
    needs_correction: {
      label: "Needs correction",
      icon: "✗",
      bg: "var(--danger-bg)",
      border: "var(--danger-border)",
      color: "var(--danger)",
    },
  };

  const cfg = configs[verdict] || configs.uncertain;

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-xs",
    lg: "px-4 py-1.5 text-sm font-semibold",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition-all ${sizeStyles[size]}`}
      style={{
        backgroundColor: cfg.bg,
        borderColor: cfg.border,
        color: cfg.color,
      }}
    >
      <span className="font-bold">{cfg.icon}</span>
      <span>{cfg.label}</span>
      {confidence != null && (
        <span className="ml-1 opacity-75 font-mono">
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </span>
  );
}
