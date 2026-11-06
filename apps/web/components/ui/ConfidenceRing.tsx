import React from "react";

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
      ? "var(--ok)"
      : clamped >= 0.45
      ? "var(--warn)"
      : "var(--danger)";

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-white/10"
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="transparent"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <span className="absolute text-xs font-mono font-bold" style={{ color }}>
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}
