"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";

interface User {
  id: number;
  username: string;
  email: string;
  role: "user" | "admin";
  email_verified: number;
  is_active: number;
  created_at: string;
}

interface SystemLog {
  id: number;
  level: "info" | "warn" | "error" | "security";
  category: string;
  message: string;
  username?: string;
  ip_address?: string;
  created_at: string;
}

interface QueryLog {
  id: number;
  username?: string;
  question: string;
  source_model: string;
  verdict: "trustworthy" | "uncertain" | "needs_correction";
  confidence: number | null;
  evidence_count: number;
  latency_ms: number | null;
  was_corrected: number;
  corrected_answer?: string | null;
  created_at: string;
}

interface RateLimitConfig {
  action: string;
  max_attempts: number;
  window_seconds: number;
  description?: string;
}

interface ActiveBlock {
  key: string;
  action: string;
  attempts: number;
  window_start: string;
  reset_at: string;
}

type TabType = "users" | "telemetry" | "queries" | "ratelimits" | "logs";

export default function AdminPanel() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [queries, setQueries] = useState<QueryLog[]>([]);
  const [rateConfigs, setRateConfigs] = useState<RateLimitConfig[]>([]);
  const [activeBlocks, setActiveBlocks] = useState<ActiveBlock[]>([]);
  const [overviewMetrics, setOverviewMetrics] = useState<any>(null);

  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [updating, setUpdating] = useState<number | null>(null);

  // Edit modal for rate limits
  const [editingConfig, setEditingConfig] = useState<RateLimitConfig | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.push("/auth/login"); return; }
      if (user.role !== "admin") { router.push("/chat"); return; }
      loadTabData(activeTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, activeTab]);

  async function loadTabData(tab: TabType) {
    setFetching(true);
    setError("");
    try {
      if (tab === "users") {
        const res = await fetch("/api/admin/users", { credentials: "include" });
        const d = await res.json();
        setUsers(d.users || []);
      } else if (tab === "telemetry") {
        const res = await fetch("/api/admin/telemetry?type=overview", { credentials: "include" });
        const d = await res.json();
        setOverviewMetrics(d.metrics);
        setQueries(d.recentQueries || []);
        setLogs(d.recentLogs || []);
      } else if (tab === "queries") {
        const res = await fetch("/api/admin/telemetry?type=queries", { credentials: "include" });
        const d = await res.json();
        setQueries(d.queries || []);
      } else if (tab === "ratelimits") {
        const res = await fetch("/api/admin/telemetry?type=ratelimits", { credentials: "include" });
        const d = await res.json();
        setRateConfigs(d.configs || []);
        setActiveBlocks(d.activeBlocks || []);
      } else if (tab === "logs") {
        const res = await fetch("/api/admin/telemetry?type=logs", { credentials: "include" });
        const d = await res.json();
        setLogs(d.logs || []);
      }
    } catch {
      setError("Failed to load data.");
    } finally {
      setFetching(false);
    }
  }

  async function toggleActive(userId: number, current: number) {
    setUpdating(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, field: "is_active", value: current ? 0 : 1 }),
        credentials: "include",
      });
      if (res.ok) loadTabData("users");
    } finally {
      setUpdating(null);
    }
  }

  async function toggleRole(userId: number, currentRole: string) {
    setUpdating(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, field: "role", value: currentRole === "admin" ? "user" : "admin" }),
        credentials: "include",
      });
      if (res.ok) loadTabData("users");
    } finally {
      setUpdating(null);
    }
  }

  async function handleSaveRateConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!editingConfig) return;
    try {
      const res = await fetch("/api/admin/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingConfig),
        credentials: "include",
      });
      if (res.ok) {
        setSuccess(`Rate limit config for ${editingConfig.action} updated.`);
        setEditingConfig(null);
        loadTabData("ratelimits");
        setTimeout(() => setSuccess(""), 4000);
      }
    } catch {
      setError("Failed to update rate limit.");
    }
  }

  async function handleUnblock(key: string, action: string) {
    try {
      const res = await fetch(`/api/admin/telemetry?key=${encodeURIComponent(key)}&action=${action}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setSuccess(`Key ${key} unblocked.`);
        loadTabData("ratelimits");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch {
      setError("Failed to unblock key.");
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Authenticating…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* Top Navbar */}
      <nav
        style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 34, height: 34, borderRadius: 10,
              background: "var(--brand-grad)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <span style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>BETA Command Center</span>
            <span style={{ fontSize: 11, color: "var(--brand-500)", marginLeft: 8, fontWeight: 700 }}>Admin Portal</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Admin: <strong style={{ color: "var(--text)" }}>{user?.username}</strong>
          </span>
          <button
            onClick={logout}
            style={{
              padding: "7px 18px", borderRadius: 999,
              background: "rgba(229,72,77,0.08)",
              border: "1px solid rgba(229,72,77,0.2)",
              color: "#C0292D", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 20px" }}>
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 10, borderBottom: "1px solid var(--border)", paddingBottom: 14, marginBottom: 24, overflowX: "auto" }}>
          {[
            { id: "users", label: "👥 User Accounts" },
            { id: "telemetry", label: "📊 System Overview" },
            { id: "queries", label: "🛡️ Hallucination & Query Logs" },
            { id: "ratelimits", label: "⏱️ Rate Limit Controls" },
            { id: "logs", label: "📜 System Audit Logs" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              style={{
                padding: "8px 18px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: activeTab === tab.id ? "var(--brand-grad)" : "rgba(255,255,255,0.7)",
                color: activeTab === tab.id ? "#fff" : "var(--text-muted)",
                boxShadow: activeTab === tab.id ? "0 4px 12px rgba(47,107,255,0.3)" : "none",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {success && (
          <div style={{ background: "rgba(23,178,106,0.1)", border: "1px solid rgba(23,178,106,0.3)", color: "#17B26A", padding: "10px 16px", borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
            ✓ {success}
          </div>
        )}
        {error && (
          <div style={{ background: "rgba(229,72,77,0.1)", border: "1px solid rgba(229,72,77,0.3)", color: "#C0292D", padding: "10px 16px", borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── TAB 1: USERS ── */}
        {activeTab === "users" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              {[
                { label: "Total Users", val: users.length, col: "var(--brand-500)" },
                { label: "Admins", val: users.filter(u => u.role === "admin").length, col: "#F5A524" },
                { label: "Active", val: users.filter(u => u.is_active).length, col: "#17B26A" },
                { label: "Verified Emails", val: users.filter(u => u.email_verified).length, col: "#2F6BFF" },
              ].map((m) => (
                <div key={m.label} style={{ background: "rgba(255,255,255,0.85)", padding: 18, borderRadius: 16, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: m.col, marginTop: 4 }}>{m.val}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>Registered Users</h2>
                <button onClick={() => loadTabData("users")} style={{ padding: "6px 14px", borderRadius: 999, background: "rgba(47,107,255,0.08)", border: "1px solid rgba(47,107,255,0.2)", color: "var(--brand-500)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Refresh</button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["ID", "Username", "Email", "Role", "Verified", "Status", "Joined", "Actions"].map(h => (
                        <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: "1px solid var(--border)", background: !u.is_active ? "rgba(229,72,77,0.03)" : "transparent" }}>
                        <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{u.id}</td>
                        <td style={{ padding: "12px 18px", fontWeight: 700 }}>{u.username}</td>
                        <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{u.email}</td>
                        <td style={{ padding: "12px 18px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: u.role === "admin" ? "rgba(245,165,36,0.12)" : "rgba(47,107,255,0.08)", color: u.role === "admin" ? "#B07800" : "var(--brand-500)" }}>{u.role}</span>
                        </td>
                        <td style={{ padding: "12px 18px" }}>
                          <span style={{ color: u.email_verified ? "#17B26A" : "#E5484D", fontWeight: 600 }}>{u.email_verified ? "✓ Verified" : "✗ Pending"}</span>
                        </td>
                        <td style={{ padding: "12px 18px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: u.is_active ? "rgba(23,178,106,0.1)" : "rgba(229,72,77,0.08)", color: u.is_active ? "#17B26A" : "#E5484D" }}>{u.is_active ? "Active" : "Suspended"}</span>
                        </td>
                        <td style={{ padding: "12px 18px", color: "var(--text-muted)", fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: "12px 18px" }}>
                          {String(u.id) !== user?.id ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => toggleActive(u.id, u.is_active)} disabled={updating === u.id} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", background: u.is_active ? "rgba(229,72,77,0.08)" : "rgba(23,178,106,0.1)", color: u.is_active ? "#E5484D" : "#17B26A", border: "1px solid rgba(0,0,0,0.1)" }}>
                                {u.is_active ? "Suspend" : "Activate"}
                              </button>
                              <button onClick={() => toggleRole(u.id, u.role)} disabled={updating === u.id} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", background: "rgba(47,107,255,0.08)", color: "var(--brand-500)", border: "1px solid rgba(47,107,255,0.2)" }}>
                                {u.role === "admin" ? "Demote" : "Promote"}
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Current Session</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: OVERVIEW ── */}
        {activeTab === "telemetry" && overviewMetrics && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
              {[
                { label: "Total Inspected Queries", val: overviewMetrics.totalQueries, col: "var(--brand-500)" },
                { label: "Hallucinations Flagged", val: overviewMetrics.hallucinations, col: "#E5484D" },
                { label: "Security & Error Events", val: overviewMetrics.securityAlerts, col: "#F5A524" },
                { label: "Total Audit Logs", val: overviewMetrics.totalLogs, col: "#17B26A" },
              ].map((m) => (
                <div key={m.label} style={{ background: "rgba(255,255,255,0.85)", padding: 20, borderRadius: 16, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: m.col, marginTop: 6 }}>{m.val}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Recent Queries */}
              <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, padding: 20, border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Latest Firewall Queries</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {queries.slice(0, 5).map((q) => (
                    <div key={q.id} style={{ padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.02)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{q.question}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                        <span>Model: {q.source_model}</span>
                        <span style={{ color: q.verdict === "trustworthy" ? "#17B26A" : "#E5484D", fontWeight: 700 }}>{q.verdict}</span>
                      </div>
                    </div>
                  ))}
                  {queries.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No queries logged yet.</div>}
                </div>
              </div>

              {/* Recent Logs */}
              <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, padding: 20, border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Recent Security & System Logs</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {logs.slice(0, 5).map((l) => (
                    <div key={l.id} style={{ padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.02)", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: l.level === "security" || l.level === "error" ? "#E5484D" : "var(--brand-500)" }}>
                        <span>{l.category.toUpperCase()} [{l.level.toUpperCase()}]</span>
                        <span style={{ color: "var(--text-muted)" }}>{new Date(l.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{l.message}</div>
                    </div>
                  ))}
                  {logs.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No system logs yet.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: QUERIES & HALLUCINATIONS ── */}
        {activeTab === "queries" && (
          <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>Hallucination & Query Monitoring Log</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>Records all prompts inspected by the hallucination firewall across Gemma, ChatGPT, and Claude.</p>
              </div>
              <button onClick={() => loadTabData("queries")} style={{ padding: "6px 14px", borderRadius: 999, background: "rgba(47,107,255,0.08)", border: "1px solid rgba(47,107,255,0.2)", color: "var(--brand-500)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Refresh</button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["ID", "User", "Prompt / Question", "Model", "Verdict", "Confidence", "Latency", "Corrected?", "Timestamp"].map(h => (
                      <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q) => (
                    <tr key={q.id} style={{ borderBottom: "1px solid var(--border)", background: q.verdict === "needs_correction" ? "rgba(229,72,77,0.04)" : "transparent" }}>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{q.id}</td>
                      <td style={{ padding: "12px 18px", fontWeight: 600 }}>{q.username ?? "Anonymous"}</td>
                      <td style={{ padding: "12px 18px", maxWidth: 280 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
                      </td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{q.source_model}</td>
                      <td style={{ padding: "12px 18px" }}>
                        <span style={{
                          padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: q.verdict === "trustworthy" ? "rgba(23,178,106,0.1)" : q.verdict === "uncertain" ? "rgba(245,165,36,0.12)" : "rgba(229,72,77,0.1)",
                          color: q.verdict === "trustworthy" ? "#17B26A" : q.verdict === "uncertain" ? "#B07800" : "#E5484D",
                        }}>
                          {q.verdict}
                        </span>
                      </td>
                      <td style={{ padding: "12px 18px" }}>{q.confidence ? `${(q.confidence * 100).toFixed(0)}%` : "—"}</td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{q.latency_ms ? `${q.latency_ms}ms` : "—"}</td>
                      <td style={{ padding: "12px 18px" }}>
                        {q.was_corrected ? <span style={{ color: "#17B26A", fontWeight: 700 }}>✓ Yes</span> : <span style={{ color: "var(--text-muted)" }}>No</span>}
                      </td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)", fontSize: 11 }}>
                        {new Date(q.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                  {queries.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>No queries logged yet. Try querying in /chat or /compare!</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 4: RATE LIMITS ── */}
        {activeTab === "ratelimits" && (
          <div>
            {/* Configs Table */}
            <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 24 }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>Rate Limit Policies & Rules</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>Configure maximum allowed attempts and sliding window durations for each endpoint.</p>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Action / Endpoint", "Description", "Max Attempts", "Window", "Action"].map(h => (
                        <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rateConfigs.map(c => (
                      <tr key={c.action} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "14px 18px", fontWeight: 700, color: "var(--brand-500)" }}>{c.action}</td>
                        <td style={{ padding: "14px 18px", color: "var(--text-muted)" }}>{c.description}</td>
                        <td style={{ padding: "14px 18px", fontWeight: 700 }}>{c.max_attempts} attempts</td>
                        <td style={{ padding: "14px 18px", color: "var(--text-muted)" }}>{c.window_seconds}s ({Math.round(c.window_seconds / 60)} mins)</td>
                        <td style={{ padding: "14px 18px" }}>
                          <button
                            onClick={() => setEditingConfig(c)}
                            style={{ padding: "5px 12px", borderRadius: 999, background: "rgba(47,107,255,0.08)", color: "var(--brand-500)", border: "1px solid rgba(47,107,255,0.2)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          >
                            Edit Rule
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Active IP blocks */}
            <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>Currently Throttled / Blocked Clients</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>IP addresses or accounts currently hitting rate limits and being rejected by the server.</p>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Identifier / IP", "Endpoint", "Attempts", "Reset At", "Manage"].map((h) => (
                        <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeBlocks.map((b) => (
                      <tr key={b.key + b.action} style={{ borderBottom: "1px solid var(--border)", background: "rgba(229,72,77,0.04)" }}>
                        <td style={{ padding: "12px 18px", fontWeight: 600 }}>{b.key}</td>
                        <td style={{ padding: "12px 18px", color: "var(--brand-500)" }}>{b.action}</td>
                        <td style={{ padding: "12px 18px", color: "#E5484D", fontWeight: 700 }}>{b.attempts}</td>
                        <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{b.reset_at}</td>
                        <td style={{ padding: "12px 18px" }}>
                          <button
                            onClick={() => handleUnblock(b.key, b.action)}
                            style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(23,178,106,0.1)", color: "#17B26A", border: "1px solid rgba(23,178,106,0.3)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          >
                            Unblock IP
                          </button>
                        </td>
                      </tr>
                    ))}
                    {activeBlocks.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: 28, textAlign: "center", color: "#17B26A", fontWeight: 600 }}>✓ No IP addresses or users are currently blocked.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 5: AUDIT LOGS ── */}
        {activeTab === "logs" && (
          <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>System Security & Activity Audit Trail</h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>Immutable log of logins, logouts, privilege elevations, and security triggers.</p>
              </div>
              <button onClick={() => loadTabData("logs")} style={{ padding: "6px 14px", borderRadius: 999, background: "rgba(47,107,255,0.08)", border: "1px solid rgba(47,107,255,0.2)", color: "var(--brand-500)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Refresh</button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["ID", "Level", "Category", "Event Details", "User", "IP Address", "Timestamp"].map(h => (
                      <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{l.id}</td>
                      <td style={{ padding: "12px 18px" }}>
                        <span style={{
                          padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800,
                          background: l.level === "security" || l.level === "error" ? "rgba(229,72,77,0.12)" : l.level === "warn" ? "rgba(245,165,36,0.12)" : "rgba(47,107,255,0.08)",
                          color: l.level === "security" || l.level === "error" ? "#E5484D" : l.level === "warn" ? "#B07800" : "var(--brand-500)",
                        }}>
                          {l.level.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "12px 18px", fontWeight: 600, color: "var(--text-muted)" }}>{l.category}</td>
                      <td style={{ padding: "12px 18px" }}>{l.message}</td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)" }}>{l.username ?? "System"}</td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)", fontSize: 12 }}>{l.ip_address ?? "Local"}</td>
                      <td style={{ padding: "12px 18px", color: "var(--text-muted)", fontSize: 11 }}>
                        {new Date(l.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>No audit records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Edit Rate Limit Modal */}
      {editingConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", padding: 28, borderRadius: 20, width: "100%", maxWidth: 420, boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 6px" }}>Edit Rate Limit: {editingConfig.action}</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 18px" }}>Adjust limits applied to all incoming client traffic.</p>

            <form onSubmit={handleSaveRateConfig} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Maximum Attempts</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={editingConfig.max_attempts}
                  onChange={(e) => setEditingConfig({ ...editingConfig, max_attempts: Number(e.target.value) })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Window Duration (in seconds)</label>
                <input
                  type="number"
                  min="10"
                  max="86400"
                  value={editingConfig.window_seconds}
                  onChange={(e) => setEditingConfig({ ...editingConfig, window_seconds: Number(e.target.value) })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 14 }}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "block" }}>
                  ≈ {Math.round(editingConfig.window_seconds / 60)} minute(s)
                </span>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  type="submit"
                  style={{ flex: 1, padding: "10px", borderRadius: 999, background: "var(--brand-grad)", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer" }}
                >
                  Save Settings
                </button>
                <button
                  type="button"
                  onClick={() => setEditingConfig(null)}
                  style={{ padding: "10px 18px", borderRadius: 999, background: "rgba(0,0,0,0.06)", border: "none", fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
