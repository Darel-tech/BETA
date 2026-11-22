/**
 * Failure-Safe Telemetry Event Writer (Section 6 & ADR-004)
 * Writes usage_events and check_runs rows without ever blocking or throwing to user requests.
 */

import { neon } from "@neondatabase/serverless";

let sqlClient: ReturnType<typeof neon> | null = null;

function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  sqlClient ??= neon(databaseUrl);
  return sqlClient;
}

export async function logUsageEvent(
  userId: string | null,
  event: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const sql = getSqlClient();
    if (!sql) return;
    await sql`
      INSERT INTO usage_events (user_id, event, meta)
      VALUES (${userId}, ${event}, ${JSON.stringify(meta ?? {})}::jsonb)
    `;
  } catch (err) {
    // Telemetry errors must NEVER break user requests
    console.error("[Telemetry] Failed to record usage event:", err);
  }
}

export async function logCheckRun(run: {
  userId?: string | null;
  source: string;
  verdict: string | null;
  confidence: number | null;
  latencyMs: number;
  stages: unknown[];
  estCostUsd?: number | null;
}): Promise<void> {
  try {
    const sql = getSqlClient();
    if (!sql) return;
    await sql`
      INSERT INTO check_runs (user_id, source, verdict, confidence, latency_ms, stages, est_cost_usd)
      VALUES (
        ${run.userId ?? null},
        ${run.source},
        ${run.verdict},
        ${run.confidence},
        ${Math.round(run.latencyMs)},
        ${JSON.stringify(run.stages)}::jsonb,
        ${run.estCostUsd ?? null}
      )
    `;
  } catch (err) {
    console.error("[Telemetry] Failed to record check run trace:", err);
  }
}
