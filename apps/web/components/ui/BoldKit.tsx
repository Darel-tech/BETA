"use client";

/**
 * Local BoldKit-style primitives.
 * Neubrutalist structure (thick borders, hard shadows, square corners,
 * press-down interaction) with semantic color roles for each product use case.
 * No new runtime dependencies; styling lives in global `bk-*` utilities.
 */

import * as React from "react";
import Link from "next/link";
import { ProfileMenu } from "@/components/ui/ProfileMenu";

export type BkTone =
  | "brand"
  | "risk"
  | "success"
  | "warning"
  | "evidence"
  | "insight"
  | "paper";

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

const cardTone: Record<BkTone, string> = {
  brand: "bk-card--brand",
  risk: "bk-card--risk",
  success: "bk-card--success",
  warning: "bk-card--warning",
  evidence: "bk-card--evidence",
  insight: "bk-card--insight",
  paper: "",
};

const panelTone: Record<BkTone, string> = {
  brand: "",
  risk: "bk-panel--risk",
  success: "bk-panel--success",
  warning: "bk-panel--warning",
  evidence: "bk-panel--evidence",
  insight: "bk-panel--insight",
  paper: "",
};

const badgeTone: Record<BkTone, string> = {
  brand: "",
  risk: "bk-badge--risk",
  success: "bk-badge--success",
  warning: "bk-badge--warning",
  evidence: "bk-badge--evidence",
  insight: "bk-badge--insight",
  paper: "bk-badge--paper",
};

const buttonTone: Record<BkTone, string> = {
  brand: "",
  risk: "bk-btn--risk",
  success: "bk-btn--success",
  warning: "bk-btn--paper",
  evidence: "bk-btn--paper",
  insight: "bk-btn--paper",
  paper: "bk-btn--paper",
};

export function BkNav({ active }: { active: "chat" | "compare" | "dashboard" | "status" | "home" | "login" | "consent" }) {
  const links = [
    { key: "chat", href: "/chat", label: "Chat" },
    { key: "compare", href: "/compare", label: "Compare" },
    { key: "dashboard", href: "/dashboard", label: "Dashboard" },
    { key: "status", href: "/status", label: "Status" },
  ] as const;

  return (
    <nav className="bk-nav" aria-label="Primary navigation">
      <Link href="/" className="bk-brand bk-press">
        β BETA
      </Link>
      <div className="bk-nav-links flex items-center">
        <ProfileMenu />
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            aria-current={active === link.key ? "page" : undefined}
            className="bk-nav-link"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function BkCard({
  tone = "paper",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: BkTone }) {
  return (
    <div className={cx("bk-card bk-frame bk-press", cardTone[tone], className)} {...props}>
      {children}
    </div>
  );
}

export function BkPanel({
  tone = "brand",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: BkTone }) {
  return (
    <div className={cx("bk-panel", panelTone[tone], className)} {...props}>
      {children}
    </div>
  );
}

export function BkBadge({
  tone = "brand",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BkTone }) {
  return (
    <span className={cx("bk-badge", badgeTone[tone], className)} {...props}>
      {children}
    </span>
  );
}

export function BkButton({
  tone = "brand",
  size = "default",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: BkTone;
  size?: "default" | "sm";
}) {
  return (
    <button
      className={cx("bk-btn bk-press", buttonTone[tone], size === "sm" && "bk-btn--sm", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export const BkInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function BkInput({ className, ...props }, ref) {
    return <input ref={ref} className={cx("bk-input", className)} {...props} />;
  }
);

export function BkTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("bk-input", className)} {...props} />;
}

export function BkSkeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cx("bk-skeleton", className)} {...props} />;
}

export function BkStat({
  label,
  value,
  detail,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: BkTone;
}) {
  return (
    <BkCard tone={tone} className="min-w-0">
      <p className="bk-label">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      {detail && <p className="mt-2 text-xs font-semibold text-[var(--bk-muted)]">{detail}</p>}
    </BkCard>
  );
}

export function BkMeter({
  value,
  tone = "brand",
  label,
}: {
  value: number;
  tone?: Exclude<BkTone, "paper">;
  label?: string;
}) {
  const color: Record<Exclude<BkTone, "paper">, string> = {
    brand: "var(--bk-brand)",
    risk: "var(--bk-risk)",
    success: "var(--bk-success)",
    warning: "var(--bk-warning)",
    evidence: "var(--bk-evidence)",
    insight: "var(--bk-insight)",
  };
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-[11px] font-bold">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      )}
      <div className="bk-frame--thin border bg-[var(--bk-paper)] h-3 w-full overflow-hidden">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color[tone] }}
        />
      </div>
    </div>
  );
}
