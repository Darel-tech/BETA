import React from "react";

/**
 * BoldKit panel wrapper. Keeps the original props so existing callers do not
 * need to change; only the visual shell is replaced.
 */
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
  const tone = elevated ? "bk-frame bk-card bk-press" : inset ? "bk-frame bk-frame--thin" : "bk-frame";
  return (
    <div onClick={onClick} className={`${tone} ${className}`}>
      {children}
    </div>
  );
}
