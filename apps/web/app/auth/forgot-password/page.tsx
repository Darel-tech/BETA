"use client";

/**
 * Forgot Password — 4-step flow:
 * Step 1: Enter email
 * Step 2: Enter OTP
 * Step 3: New password
 * Step 4: Success
 */

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AuthBackground,
  AuthCard,
  BrandLogo,
  AuthInput,
  AuthButton,
  IconLock,
  IconEye,
  ArrowRight,
  ErrorBox,
} from "@/app/auth/login/page";

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

type Step = 1 | 2 | 3 | 4;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password?action=send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send code.");
        return;
      }
      if (data.userId) setUserId(data.userId);
      setCountdown(60);
      setStep(2);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────
  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) {
      document.getElementById(`rotp-${idx + 1}`)?.focus();
    }
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) {
      document.getElementById(`rotp-${idx - 1}`)?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length) {
      setOtp(text.padEnd(6, "").split("").slice(0, 6));
      document.getElementById(`rotp-${Math.min(text.length - 1, 5)}`)?.focus();
      e.preventDefault();
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password?action=verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid code.");
        return;
      }
      setResetToken(data.resetToken);
      if (data.userId) setUserId(data.userId);
      setStep(3);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (countdown > 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password?action=send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed."); return; }
      if (data.userId) setUserId(data.userId);
      setCountdown(60);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: Reset password ──────────────────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password?action=reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, resetToken, password: newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Reset failed.");
        return;
      }
      setStep(4);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step indicator ──────────────────────────────────────────────────────────
  function StepDots() {
    return (
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            style={{
              width: s <= step ? 24 : 8,
              height: 8,
              borderRadius: 99,
              background: s < step ? "var(--brand-500)" : s === step ? "var(--brand-grad)" : "var(--border)",
              transition: "all 0.3s var(--ease)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <AuthBackground>
      <AuthCard>
        <BrandLogo />

        {/* ── Step 1 ── */}
        {step === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", textAlign: "center", margin: "0 0 6px" }}>
              Forgot Password?
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginBottom: 24 }}>
              Enter your registered email and we&apos;ll send you a reset code.
            </p>
            <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {error && <ErrorBox message={error} />}
              <AuthInput
                type="email"
                placeholder="Your registered email"
                value={email}
                onChange={setEmail}
                icon={<IconMail />}
                disabled={loading}
              />
              <AuthButton type="submit" loading={loading}>
                <span>Send Reset Code</span>
                <ArrowRight />
              </AuthButton>
            </form>
          </>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <>
            <StepDots />
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", textAlign: "center", margin: "0 0 6px" }}>
              Enter Reset Code
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginBottom: 24 }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
            <form onSubmit={handleVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {error && <ErrorBox message={error} />}
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }} onPaste={handleOtpPaste}>
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`rotp-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    disabled={loading}
                    style={{
                      width: 46, height: 54, textAlign: "center", fontSize: 22, fontWeight: 700,
                      color: "var(--text)", background: "rgba(255,255,255,0.90)",
                      border: `2px solid ${digit ? "var(--brand-500)" : "var(--border)"}`,
                      borderRadius: "var(--r-sm)", outline: "none",
                      boxShadow: digit ? "0 0 0 3px rgba(47,107,255,0.12)" : "var(--inset)",
                      transition: "border-color 0.2s, box-shadow 0.2s",
                    }}
                  />
                ))}
              </div>
              <AuthButton type="submit" loading={loading}>
                <span>Verify Code</span>
                <ArrowRight />
              </AuthButton>
              <div style={{ textAlign: "center" }}>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0 || loading}
                  style={{
                    background: "none", border: "none",
                    cursor: countdown > 0 ? "default" : "pointer",
                    fontSize: 13,
                    color: countdown > 0 ? "var(--text-muted)" : "var(--brand-500)",
                    fontWeight: 500,
                  }}
                >
                  {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <>
            <StepDots />
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", textAlign: "center", margin: "0 0 6px" }}>
              Set New Password
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginBottom: 24 }}>
              Choose a strong password for your account.
            </p>
            <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {error && <ErrorBox message={error} />}
              <AuthInput
                type={showPw ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={setNewPassword}
                icon={<IconLock />}
                right={<span onClick={() => setShowPw((p) => !p)}><IconEye open={showPw} /></span>}
                disabled={loading}
              />
              <AuthInput
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                icon={<IconLock />}
                right={<span onClick={() => setShowConfirm((p) => !p)}><IconEye open={showConfirm} /></span>}
                disabled={loading}
              />
              <AuthButton type="submit" loading={loading}>
                <span>Reset Password</span>
                <ArrowRight />
              </AuthButton>
            </form>
          </>
        )}

        {/* ── Step 4: Success ── */}
        {step === 4 && (
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "rgba(23,178,106,0.12)",
                border: "2px solid rgba(23,178,106,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#17B26A" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>
              Password Reset!
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
              Your password has been updated successfully.<br />
              Sign in with your new password.
            </p>
            <AuthButton onClick={() => router.push("/auth/login")}>
              Go to Sign In
            </AuthButton>
          </div>
        )}

        {step !== 4 && (
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginTop: 20 }}>
            <Link href="/auth/login" style={{ color: "var(--brand-500)", textDecoration: "none" }}>
              ← Back to Sign In
            </Link>
          </p>
        )}
      </AuthCard>
    </AuthBackground>
  );
}
