"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AuthBackground,
  AuthCard,
  BrandLogo,
  AuthButton,
  ErrorBox,
} from "@/app/auth/login/page";
import Link from "next/link";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = Number(searchParams?.get("userId") ?? "0");
  const autoResend = searchParams?.get("resend") === "1";

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [countdown, setCountdown] = useState(0);

  // Auto-resend if coming from login with unverified email
  useEffect(() => {
    if (autoResend && userId) {
      handleResend();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) {
      document.getElementById(`otp-${idx + 1}`)?.focus();
    }
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) {
      document.getElementById(`otp-${idx - 1}`)?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length) {
      setOtp(text.padEnd(6, "").split("").slice(0, 6));
      document.getElementById(`otp-${Math.min(text.length - 1, 5)}`)?.focus();
      e.preventDefault();
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        return;
      }
      setSuccess("Email verified! Redirecting to sign in…");
      setTimeout(() => router.push("/auth/login?verified=1"), 2000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (countdown > 0 || resending) return;
    setResending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to resend.");
        return;
      }
      setSuccess("New code sent! Check your email.");
      setCountdown(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthBackground>
      <AuthCard>
        <BrandLogo />

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {/* Email icon */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgba(47,107,255,.12), rgba(47,107,255,.06))",
              border: "1.5px solid rgba(47,107,255,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 6px" }}>
            Verify your email
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            We sent a 6-digit code to your email address.<br />
            Enter it below — it expires in 15 minutes.
          </p>
        </div>

        {success ? (
          <div
            style={{
              background: "rgba(23,178,106,0.10)",
              border: "1px solid rgba(23,178,106,0.25)",
              borderRadius: "var(--r-sm)",
              padding: "16px",
              textAlign: "center",
              color: "#17B26A",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            ✓ {success}
          </div>
        ) : (
          <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {error && <ErrorBox message={error} />}

            {/* OTP input boxes */}
            <div
              style={{ display: "flex", gap: 10, justifyContent: "center" }}
              onPaste={handleOtpPaste}
            >
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  id={`otp-${idx}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  disabled={loading}
                  style={{
                    width: 46,
                    height: 54,
                    textAlign: "center",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text)",
                    background: "rgba(255,255,255,0.90)",
                    border: `2px solid ${digit ? "var(--brand-500)" : "var(--border)"}`,
                    borderRadius: "var(--r-sm)",
                    outline: "none",
                    boxShadow: digit ? "0 0 0 3px rgba(47,107,255,0.12)" : "var(--inset)",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                    caretColor: "var(--brand-500)",
                  }}
                />
              ))}
            </div>

            <AuthButton type="submit" loading={loading}>
              Verify Email
            </AuthButton>

            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0 || resending}
                style={{
                  background: "none",
                  border: "none",
                  cursor: countdown > 0 ? "default" : "pointer",
                  fontSize: 13,
                  color: countdown > 0 ? "var(--text-muted)" : "var(--brand-500)",
                  fontWeight: 500,
                }}
              >
                {resending
                  ? "Sending…"
                  : countdown > 0
                  ? `Resend code in ${countdown}s`
                  : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <p
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 20,
          }}
        >
          <Link href="/auth/login" style={{ color: "var(--brand-500)", textDecoration: "none" }}>
            ← Back to Sign In
          </Link>
        </p>
      </AuthCard>
    </AuthBackground>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
