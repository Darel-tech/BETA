/**
 * GET /api/status
 *
 * Polls all three real service /health endpoints and returns their live status.
 * Used by the /status page to show a green/red grid.
 */

import { NextResponse } from "next/server";

const SERVICES = [
  {
    name: "interpretability",
    label: "Interpretability (Gemma + SAE)",
    url: process.env.INTERPRETABILITY_SERVICE_URL ?? "",
    port: 8001,
  },
  {
    name: "blackbox",
    label: "Black-box Detector (ChatGPT/Claude)",
    url: process.env.BLACKBOX_SERVICE_URL ?? "",
    port: 8002,
  },
  {
    name: "retrieval",
    label: "Retrieval & Correction",
    url: process.env.RETRIEVAL_SERVICE_URL ?? "",
    port: 8003,
  },
];

const HEALTH_TIMEOUT_MS = 5_000;

async function checkService(service: (typeof SERVICES)[0]) {
  if (!service.url) {
    return {
      name: service.name,
      label: service.label,
      status: "unconfigured" as const,
      message: `${service.name.toUpperCase()}_SERVICE_URL not set`,
      latency_ms: 0,
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${service.url}/health`, {
      signal: controller.signal,
      headers: { "Cache-Control": "no-store" },
    });
    clearTimeout(timer);
    const latency_ms = Date.now() - start;
    const data = await res.json().catch(() => ({}));
    return {
      name: service.name,
      label: service.label,
      status: res.ok ? "ok" : ("degraded" as "ok" | "degraded"),
      message: data.status ?? (res.ok ? "ok" : `HTTP ${res.status}`),
      latency_ms,
      details: data,
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      name: service.name,
      label: service.label,
      status: "unreachable" as const,
      message: isTimeout ? "Timed out" : "Connection refused",
      latency_ms: Date.now() - start,
    };
  }
}

export async function GET() {
  const results = await Promise.all(SERVICES.map(checkService));
  const allOk = results.every((r) => r.status === "ok");
  return NextResponse.json(
    { overall: allOk ? "ok" : "degraded", services: results },
    {
      headers: {
        "Cache-Control": "no-store, no-cache",
      },
    }
  );
}
