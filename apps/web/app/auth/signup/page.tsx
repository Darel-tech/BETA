"use client";

import React, { useState, useEffect, useCallback } from "react";
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

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
    { label: "Special character", ok: /[^a-zA-Z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const colors = ["#E5484D", "#F5A524", "#2F6BFF", "#17B26A"];
  const labels = ["Weak", "Fair", "Good", "Strong"];

  if (!password) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 99,
              background: i < score ? colors[score - 1] : "var(--border)",
              transition: "background 0.3s",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: score > 0 ? colors[score - 1] : "var(--text-muted)" }}>
          {score > 0 ? labels[score - 1] : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {checks.map((c) => (
            <span
              key={c.label}
              style={{
                fontSize: 10,
                color: c.ok ? "#17B26A" : "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              {c.ok ? "✓" : "·"} {c.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const setField = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: "" }));
  };

  // ── Real-time username check ────────────────────────────────────────────────
  const checkUsername = useCallback(async (username: string) => {
    if (username.length < 3) return;
    setUsernameStatus("checking");
    try {
      const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      setUsernameStatus(data.available ? "available" : "taken");
    } catch {
      setUsernameStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (!form.username) { setUsernameStatus("idle"); return; }
    const t = setTimeout(() => checkUsername(form.username), 500);
    return () => clearTimeout(t);
  }, [form.username, checkUsername]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const errs: Record<string, string> = {};

    if (!form.username || !/^[a-zA-Z0-9_.]{3,30}$/.test(form.username)) {
      errs.username = "3–30 chars: letters, numbers, _ or . only.";
    }
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = "Enter a valid email address.";
    }
    if (form.password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    }
    if (form.password !== form.confirmPassword) {
      errs.confirmPassword = "Passwords do not match.";
    }
    if (usernameStatus === "taken") {
      errs.username = "Username is already taken.";
    }

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }

      router.push(`/auth/verify-email?userId=${data.userId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const usernameHint =
    usernameStatus === "checking" ? "Checking…" :
    usernameStatus === "available" ? "✓ Available" :
    usernameStatus === "taken" ? "✗ Taken" : "";

  const usernameHintColor =
    usernameStatus === "available" ? "#17B26A" :
    usernameStatus === "taken" ? "#E5484D" : "var(--text-muted)";

  return (
    <AuthBackground>
      <AuthCard>
        <BrandLogo />
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "var(--text)",
            textAlign: "center",
            margin: "0 0 4px",
          }}
        >
          Create Account
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Join BETA to start monitoring AI truthfulness
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <ErrorBox message={error} />}

          <div>
            <AuthInput
              placeholder="Username"
              value={form.username}
              onChange={(v: string) => setField("username", v)}
              icon={<IconUser />}
              error={fieldErrors.username}
              disabled={loading}
            />
            {usernameHint && !fieldErrors.username && (
              <p style={{ fontSize: 11, color: usernameHintColor, marginTop: 3 }}>{usernameHint}</p>
            )}
          </div>

          <AuthInput
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={(v: string) => setField("email", v)}
            icon={<IconMail />}
            error={fieldErrors.email}
            disabled={loading}
          />

          <div>
            <AuthInput
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={form.password}
              onChange={(v: string) => setField("password", v)}
              icon={<IconLock />}
              right={
                <span onClick={() => setShowPw((p) => !p)}>
                  <IconEye open={showPw} />
                </span>
              }
              error={fieldErrors.password}
              disabled={loading}
            />
            <PasswordStrength password={form.password} />
          </div>

          <AuthInput
            type={showConfirm ? "text" : "password"}
            placeholder="Confirm Password"
            value={form.confirmPassword}
            onChange={(v: string) => setField("confirmPassword", v)}
            icon={<IconLock />}
            right={
              <span onClick={() => setShowConfirm((p) => !p)}>
                <IconEye open={showConfirm} />
              </span>
            }
            error={fieldErrors.confirmPassword}
            disabled={loading}
          />

          <div style={{ marginTop: 4 }}>
            <AuthButton type="submit" loading={loading}>
              <span>Create Account</span>
              <ArrowRight />
            </AuthButton>
          </div>
        </form>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            marginTop: 20,
          }}
        >
          Already have an account?{" "}
          <Link
            href="/auth/login"
            style={{ color: "var(--brand-500)", fontWeight: 600, textDecoration: "none" }}
          >
            Sign In
          </Link>
        </p>
      </AuthCard>
    </AuthBackground>
  );
}
