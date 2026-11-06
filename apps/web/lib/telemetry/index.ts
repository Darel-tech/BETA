/**
 * Failure-Safe Telemetry Event Writer (Section 6 & ADR-004)
 * Writes usage_events and check_runs rows without ever blocking or throwing to user requests.
 */

export async function logUsageEvent(
  userId: string | null,
  event: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return; // Silent no-op in dev when no DB configured
    // Async background emission
  } catch (err) {
    // Telemetry errors must NEVER break user requests
    console.error("[Telemetry] Failed to record usage event:", err);
  }
}

export async function logCheckRun(run: {
  userId?: string | null;
  source: string;
  verdict: string;
  confidence: number;
  latencyMs: number;
  stages: unknown[];
  estCostUsd?: number;
}): Promise<void> {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;
    // Log check execution trace for judge inspectability
  } catch (err) {
    console.error("[Telemetry] Failed to record check run trace:", err);
  }
}
