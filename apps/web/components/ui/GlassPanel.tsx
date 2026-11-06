import React from "react";

export function GlassPanel({
  children,
  className = "",
  elevated = false,
  inset = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  inset?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border transition-all ${
        elevated
          ? "shadow-2xl border-white/15 bg-slate-900/60 backdrop-blur-xl"
          : inset
          ? "border-white/5 bg-slate-950/40 shadow-inner"
          : "border-white/10 bg-slate-900/40 backdrop-blur-md"
      } ${className}`}
    >
      {children}
    </div>
  );
}
