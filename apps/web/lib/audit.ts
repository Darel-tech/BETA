import { dbRun, dbAll } from "@/lib/db";

export async function logSystemEvent(params: {
  level?: "info" | "warn" | "error" | "security";
  category: "auth" | "rate_limit" | "admin" | "api";
  message: string;
  userId?: number | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await dbRun(
      `INSERT INTO system_logs (level, category, message, user_id, ip_address, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.level ?? "info",
        params.category,
        params.message,
        params.userId ?? null,
        params.ipAddress ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );
  } catch (e) {
    console.error("Failed to write system log:", e);
  }
}

export async function logQueryCheck(params: {
  userId?: number | null;
  question: string;
  sourceModel: string;
  verdict: string;
  confidence?: number | null;
  evidenceCount?: number;
  latencyMs?: number | null;
  wasCorrected?: boolean;
  correctedAnswer?: string | null;
}) {
  try {
    await dbRun(
      `INSERT INTO query_logs (user_id, question, source_model, verdict, confidence, evidence_count, latency_ms, was_corrected, corrected_answer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.userId ?? null,
        params.question,
        params.sourceModel,
        params.verdict,
        params.confidence ?? null,
        params.evidenceCount ?? 0,
        params.latencyMs ?? null,
        params.wasCorrected ? 1 : 0,
        params.correctedAnswer ?? null,
      ]
    );
  } catch (e) {
    console.error("Failed to write query log:", e);
  }
}
