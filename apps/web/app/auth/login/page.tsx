"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/context";

// ── Shared Auth Layout ────────────────────────────────────────────────────────

function AuthBackground({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg)" }}
    >
      {/* Decorative circles matching the reference image */}
      <div
        className="fixed top-[-80px] left-[-80px] w-[280px] h-[280px] rounded-full pointer-events-none"
        style={{ background: "rgba(47,107,255,0.10)", filter: "blur(40px)" }}
      />
      <div
        className="fixed bottom-[-60px] right-[-60px] w-[220px] h-[220px] rounded-full pointer-events-none"
        style={{ background: "rgba(47,107,255,0.08)", filter: "blur(50px)" }}
      />
      <div
        className="fixed top-[40%] right-[-30px] w-[160px] h-[160px] rounded-full pointer-events-none"
        style={{ background: "rgba(91,140,255,0.07)", filter: "blur(30px)" }}
      />
      {children}
    </main>
  );
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative w-full max-w-sm"
      style={{
        background: "rgba(255,255,255,0.80)",
        backdropFilter: "blur(var(--glass-blur))",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-2)",
        border: "1px solid var(--border)",
        padding: "32px 28px",
      }}
    >
      {children}
    </div>
  );
}

function BrandLogo() {
  return (
    <div className="flex flex-col items-center mb-6 text-center">
      {/* Circular neumorphic logo matching the reference image */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "linear-gradient(145deg, #EEF2FB, #FFFFFF)",
          boxShadow: "8px 8px 20px rgba(20,40,100,0.12), -4px -4px 12px rgba(255,255,255,0.9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #5B8CFF 0%, #2F6BFF 55%, #1E4FD8 100%)",
            boxShadow: "0 4px 14px rgba(47,107,255,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Flame/wave icon similar to reference */}
          <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
            <path
              d="M11 2C11 2 7 7 7 12C7 14.2 8.1 16.1 9.8 17.3C9.3 16.3 9 15.2 9 14C9 11 11.5 8.5 11.5 8.5C11.5 8.5 14 12 14 15C14 16.7 13.2 18.2 12 19.1C13.5 18.5 15.5 16.7 15.5 14C15.5 10.5 14 7 14 7C16.5 9 18 12 18 15C18 19.4 14.9 23 11 23C7.1 23 4 19.4 4 15C4 9 11 2 11 2Z"
              fill="white"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function AuthInput({
  id,
  type = "text",
  placeholder,
  value,
  onChange,
  icon,
  right,
  error,
  disabled,
}: {
  id?: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          position: "relative",
          background: "rgba(255,255,255,0.90)",
          border: `1.5px solid ${error ? "#E5484D" : "var(--border)"}`,
          borderRadius: "var(--r-sm)",
          boxShadow: "var(--inset)",
          transition: "border-color 0.2s, box-shadow 0.2s",
        }}
      >
        {icon && (
          <span
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              display: "flex",
            }}
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            padding: icon ? "13px 44px 13px 44px" : "13px 16px",
            paddingRight: right ? 44 : icon ? 44 : 16,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 14,
            color: "var(--text)",
            borderRadius: "inherit",
            boxSizing: "border-box",
          }}
        />
        {right && (
          <span
            style={{
              position: "absolute",
              right: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              display: "flex",
              cursor: "pointer",
            }}
          >
            {right}
          </span>
        )}
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "#E5484D", marginTop: 4 }}>{error}</p>
      )}
    </div>
  );
}

export function AuthButton({
  children,
  onClick,
  type = "button",
  loading = false,
  disabled = false,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: "100%",
        padding: "14px",
        borderRadius: 999,
        border: "none",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        fontSize: 15,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "all 0.2s var(--ease)",
        background: isPrimary
          ? "var(--brand-grad)"
          : "rgba(255,255,255,0.7)",
        color: isPrimary ? "#fff" : "var(--text)",
        boxShadow: isPrimary
          ? "var(--shadow-glow), var(--shadow-1)"
          : "var(--shadow-1)",
        opacity: disabled || loading ? 0.6 : 1,
        transform: "translateY(0)",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = isPrimary
            ? "0 0 32px rgba(47,107,255,0.5), 0 8px 24px rgba(20,40,100,.15)"
            : "0 8px 24px rgba(20,40,100,.12)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = isPrimary
          ? "var(--shadow-glow), var(--shadow-1)"
          : "var(--shadow-1)";
      }}
    >
      {loading ? (
        <>
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Please wait…
        </>
      ) : children}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      style={{
        background: "rgba(229,72,77,0.08)",
        border: "1px solid rgba(229,72,77,0.25)",
        borderRadius: "var(--r-sm)",
        padding: "10px 14px",
        fontSize: 13,
        color: "#C0292D",
      }}
    >
      {message}
    </div>
  );
}

// ── LOGIN PAGE ────────────────────────────────────────────────────────────────

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const redirectTo = searchParams?.get("redirect") ?? null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, rememberMe }),
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          router.push(`/auth/verify-email?userId=${data.userId}&resend=1`);
          return;
        }
        setError(data.error ?? "Login failed.");
        return;
      }

      await refresh();
      router.push(redirectTo ?? data.redirectTo ?? "/chat");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthBackground>
      <AuthCard>
        <BrandLogo />

        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "var(--text)",
            textAlign: "center",
            margin: "0 0 4px",
          }}
        >
          Welcome Back
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Sign in to continue
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <ErrorBox message={error} />}

          <AuthInput
            placeholder="Username or Email"
            value={username}
            onChange={setUsername}
            icon={<IconUser />}
            disabled={loading}
          />

          <AuthInput
            type={showPw ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={setPassword}
            icon={<IconLock />}
            right={
              <span onClick={() => setShowPw((p) => !p)}>
                <IconEye open={showPw} />
              </span>
            }
            disabled={loading}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-muted)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{
                  width: 16,
                  height: 16,
                  accentColor: "var(--brand-500)",
                  borderRadius: 4,
                }}
              />
              Remember Me
            </label>
            <Link
              href="/auth/forgot-password"
              style={{
                fontSize: 13,
                color: "var(--brand-500)",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              Forgot Password?
            </Link>
          </div>

          <div style={{ marginTop: 4 }}>
            <AuthButton type="submit" loading={loading}>
              <span>Login</span>
              <ArrowRight />
            </AuthButton>
          </div>
        </form>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "20px 0",
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em" }}>
            OR CONTINUE WITH
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            marginTop: 8,
          }}
        >
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/signup"
            style={{ color: "var(--brand-500)", fontWeight: 600, textDecoration: "none" }}
          >
            Sign Up
          </Link>
        </p>
      </AuthCard>
    </AuthBackground>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

// ── Re-exports for other auth pages ──────────────────────────────────────────
export { AuthBackground, AuthCard, BrandLogo, IconUser, IconLock, IconEye, ArrowRight, ErrorBox };
