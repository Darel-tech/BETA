import React from "react";

/** BoldKit confidence ring. Clamping and thresholds are unchanged. */
export function ConfidenceRing({
  value,
  size = 48,
  strokeWidth = 4,
}: {
  value: number; // 0..1
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - clamped * circumference;

  const color =
    clamped >= 0.75
      ? "var(--bk-success)"
      : clamped >= 0.45
        ? "var(--bk-warning)"
        : "var(--bk-risk)";

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--bk-paper)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-black text-[var(--bk-ink)]">
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}
