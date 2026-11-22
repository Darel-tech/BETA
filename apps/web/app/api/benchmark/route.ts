/**
 * GET /api/benchmark
 *
 * Serves the benchmark results produced by eval/harness.py from disk.
 * The dashboard treats this as optional: when no valid snapshot exists the
 * route answers 200 with `available: false` so the browser console stays clean
 * and no stale/fake data is shown.
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET() {
  // The harness writes to eval/results/benchmark_results.json at the repo root
  const resultsPath = path.join(process.cwd(), "..", "..", "eval", "results", "benchmark_results.json");

  try {
    const raw = await readFile(resultsPath, "utf-8");
    const data = JSON.parse(raw);
    if (data.schema_version !== 2 || !Array.isArray(data.results) || !data.run_at || data.questions_evaluated < 1) {
      return NextResponse.json(
        {
          available: false,
          error: "Benchmark snapshot is stale or incomplete. Run eval/harness.py against the live API.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { available: false, error: "No benchmark results found. Run eval/harness.py first." },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
