import React from "react";

export function TactileButton({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  onClick,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center font-medium rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-98 disabled:opacity-50 disabled:pointer-events-none";

  const sizeClasses = {
    sm: "px-3.5 py-1.5 text-xs gap-1.5",
    md: "px-5 py-2.5 text-sm gap-2",
    lg: "px-7 py-3 text-base gap-2.5 shadow-lg",
  };

  const variants = {
    primary:
      "text-white shadow-md hover:opacity-95 focus:ring-blue-500",
    secondary:
      "bg-white/10 hover:bg-white/15 text-white border border-white/10 backdrop-blur-md",
    ghost: "text-slate-300 hover:text-white hover:bg-white/5",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  };

  const inlineStyles: React.CSSProperties =
    variant === "primary"
      ? { background: "var(--brand-grad, linear-gradient(135deg, #5B8CFF 0%, #2F6BFF 55%, #1E4FD8 100%))" }
      : {};

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      style={inlineStyles}
      className={`${base} ${sizeClasses[size]} ${variants[variant]} ${className}`}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
