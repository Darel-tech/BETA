import { createRealtime, rawSql } from "@neon/realtime/server";
import { NextResponse } from "next/server";

interface LiveRunMetric {
  source: string;
  run_count: number;
  trustworthy_count: number;
  uncertain_count: number;
  needs_correction_count: number;
  unavailable_count: number;
  avg_confidence: number | null;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_est_cost_usd: number | null;
  avg_input_tokens: number | null;
  avg_output_tokens: number | null;
  latest_at: Date;
}

const LIVE_RUNS_QUERY = rawSql<LiveRunMetric>(`
  SELECT
    source,
    COUNT(*)::int AS run_count,
    COUNT(*) FILTER (WHERE verdict = 'trustworthy')::int AS trustworthy_count,
    COUNT(*) FILTER (WHERE verdict = 'uncertain')::int AS uncertain_count,
    COUNT(*) FILTER (WHERE verdict = 'needs_correction')::int AS needs_correction_count,
    COUNT(*) FILTER (WHERE verdict IS NULL)::int AS unavailable_count,
    AVG(confidence)::float8 AS avg_confidence,
    AVG(latency_ms)::float8 AS avg_latency_ms,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::float8 AS p50_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::float8 AS p95_latency_ms,
    AVG(NULLIF(est_cost_usd, 0))::float8 AS avg_est_cost_usd,
    AVG((SELECT SUM(COALESCE(NULLIF(stage->'details'->>'input_tokens', '')::numeric, 0) + COALESCE(NULLIF(stage->'details'->>'generation_input_tokens', '')::numeric, 0)) FROM jsonb_array_elements(stages) AS entries(stage) WHERE NULLIF(stage->'details'->>'input_tokens', '') IS NOT NULL OR NULLIF(stage->'details'->>'generation_input_tokens', '') IS NOT NULL))::float8 AS avg_input_tokens,
    AVG((SELECT SUM(COALESCE(NULLIF(stage->'details'->>'output_tokens', '')::numeric, 0) + COALESCE(NULLIF(stage->'details'->>'generation_output_tokens', '')::numeric, 0)) FROM jsonb_array_elements(stages) AS entries(stage) WHERE NULLIF(stage->'details'->>'output_tokens', '') IS NOT NULL OR NULLIF(stage->'details'->>'generation_output_tokens', '') IS NOT NULL))::float8 AS avg_output_tokens,
    MAX(created_at) AS latest_at
  FROM check_runs
  GROUP BY source
  ORDER BY source
`);

export async function POST() {
  const secret = process.env.NEON_REALTIME_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  if (!secret || !databaseUrl) {
    return NextResponse.json(
      { error: "Live run metrics are not configured for this environment." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    const realtime = createRealtime({ secret, db: database });
    const sealedQuery = await realtime.seal({ query: LIVE_RUNS_QUERY });
    return NextResponse.json(sealedQuery, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not prepare live run metrics." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
