import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/middleware";
import { dbAll, dbRun, dbGet } from "@/lib/db";
import { logSystemEvent } from "@/lib/audit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "overview";

  try {
    if (type === "logs") {
      const logs = await dbAll(
        `SELECT l.*, u.username 
         FROM system_logs l 
         LEFT JOIN users u ON l.user_id = u.id 
         ORDER BY l.created_at DESC LIMIT 100`
      );
      return NextResponse.json({ logs });
    }

    if (type === "queries") {
      const queries = await dbAll(
        `SELECT q.*, u.username 
         FROM query_logs q 
         LEFT JOIN users u ON q.user_id = u.id 
         ORDER BY q.created_at DESC LIMIT 100`
      );
      return NextResponse.json({ queries });
    }

    if (type === "ratelimits") {
      const configs = await dbAll(`SELECT * FROM rate_limit_configs`);
      const activeBlocks = await dbAll(
        `SELECT r.*, datetime(r.window_start, '+' || c.window_seconds || ' seconds') as reset_at
         FROM rate_limits r
         JOIN rate_limit_configs c ON r.action = c.action
         WHERE r.attempts >= c.max_attempts
         ORDER BY r.window_start DESC LIMIT 50`
      );
      return NextResponse.json({ configs, activeBlocks });
    }

    // Default: Overview Stats
    const totalQueries = (await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM query_logs"))?.count ?? 0;
    const hallucinations = (await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM query_logs WHERE verdict = 'needs_correction'"
    ))?.count ?? 0;
    const totalLogs = (await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM system_logs"))?.count ?? 0;
    const securityAlerts = (await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM system_logs WHERE level = 'security' OR level = 'error'"
    ))?.count ?? 0;

    const recentQueries = await dbAll("SELECT * FROM query_logs ORDER BY created_at DESC LIMIT 5");
    const recentLogs = await dbAll("SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 5");

    return NextResponse.json({
      metrics: {
        totalQueries,
        hallucinations,
        totalLogs,
        securityAlerts,
      },
      recentQueries,
      recentLogs,
    });
  } catch (error) {
    console.error("Admin telemetry error:", error);
    return NextResponse.json({ error: "Failed to fetch admin telemetry" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { action, max_attempts, window_seconds } = body;

    if (!action || !max_attempts || !window_seconds) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await dbRun(
      `UPDATE rate_limit_configs 
       SET max_attempts = ?, window_seconds = ? 
       WHERE action = ?`,
      [Number(max_attempts), Number(window_seconds), action]
    );

    await logSystemEvent({
      level: "info",
      category: "admin",
      message: `Admin ${auth.username} updated rate limit for "${action}": max ${max_attempts} in ${window_seconds}s`,
      userId: Number(auth.sub),
    });

    return NextResponse.json({ message: "Rate limit configuration updated successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const key = url.searchParams.get("key");

  if (action && key) {
    await dbRun("DELETE FROM rate_limits WHERE key = ? AND action = ?", [key, action]);
    await logSystemEvent({
      level: "warn",
      category: "admin",
      message: `Admin ${auth.username} unblocked rate limit key "${key}" for action "${action}"`,
      userId: Number(auth.sub),
    });
    return NextResponse.json({ message: "Rate limit unblocked" });
  }

  return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
}
