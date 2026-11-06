/**
 * GET /api/benchmark
 *
 * Serves the benchmark results produced by eval/harness.py from disk.
 * The dashboard reads this route — if no results exist yet, it returns a 404
 * so the dashboard can show "run harness first" rather than stale/fake data.
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
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "No benchmark results found. Run eval/harness.py first." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
}
