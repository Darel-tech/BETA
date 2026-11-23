/**
 * GET /api/status
 *
 * Reports the pipeline that actually serves a BETA check:
 *   1. LLM generation (Groq primary, OpenRouter fallback) — env presence only.
 *   2. In-process LLM/NLI firewall — available when a provider is configured.
 *   3. Python microservices on 8001/8002/8003 — optional fallbacks, probed for
 *      information but never used to mark the application unhealthy.
 *
 * Key values are never read into the response; only booleans are exposed.
 */

type ServiceStatus = "ok" | "degraded" | "unreachable" | "unconfigured";

interface ServiceEntry {
  name: string;
  label: string;
  group: "pipeline" | "microservice";
  status: ServiceStatus;
  headline: string;
  detail: string;
  meta: string;
  optional: boolean;
  port?: number;
  latencyMs?: number;
}

interface StatusPayload {
  overall: "ok" | "degraded";
  title: string;
  reason: string;
  checkedAt: string;
  providers: { groq: boolean; openrouter: boolean };
  verification: "configuration-only";
  pipeline: ServiceEntry[];
  microservices: ServiceEntry[];
  /** Flattened view kept for any existing consumer of the old response shape. */
  services: ServiceEntry[];
}

const HEALTH_TIMEOUT_MS = 2_500;

const MICROSERVICES = [
  {
    name: "interpretability",
    label: "Interpretability / SAE latents",
    port: 8001,
    envKey: "INTERPRETABILITY_SERVICE_URL",
  },
  {
    name: "blackbox",
    label: "Black-box resampling + NLI",
    port: 8002,
    envKey: "BLACKBOX_SERVICE_URL",
  },
  {
    name: "retrieval",
    label: "Retrieval + fact correction",
    port: 8003,
    envKey: "RETRIEVAL_SERVICE_URL",
  },
] as const;

function hasCredential(name: string): boolean {
  return Boolean((process.env[name] ?? "").trim());
}

function endpointFor(urlFromEnv: string | undefined, port: number) {
  const configured = Boolean(urlFromEnv?.trim());
  const base = configured ? urlFromEnv!.trim() : `http://127.0.0.1:${port}`;
  return {
    url: base.replace(/\/+$/, ""),
    meta: configured ? "URL set in environment" : `Default local port ${port}`,
  };
}

async function probeMicroservice(
  service: (typeof MICROSERVICES)[number],
  internalKey: string
): Promise<ServiceEntry> {
  const { url, meta } = endpointFor(process.env[service.envKey], service.port);
  const startedAt = Date.now();

  const offline = (status: Extract<ServiceStatus, "unreachable" | "degraded">, headline: string): ServiceEntry => ({
    name: service.name,
    label: service.label,
    group: "microservice",
    status,
    headline,
    detail:
      "Optional fallback only. The in-process LLM/NLI firewall continues to serve checks without this service.",
    meta,
    optional: true,
    port: service.port,
    latencyMs: Date.now() - startedAt,
  });

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (internalKey) headers["X-Internal-Api-Key"] = internalKey;

    const response = await fetch(`${url}/health`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - startedAt;
    const body: unknown = await response.json().catch(() => null);
    const reported =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).status === "string"
        ? String((body as Record<string, unknown>).status).toLowerCase()
        : null;
    const healthy =
      response.ok && (reported === null || ["ok", "healthy", "up"].includes(reported));

    return {
      name: service.name,
      label: service.label,
      group: "microservice",
      status: healthy ? "ok" : "degraded",
      headline: healthy ? "Reachable" : `Reported ${reported ?? `HTTP ${response.status}`}`,
      detail: healthy
        ? "Optional fallback is online and can be selected when a check asks for it."
        : "Optional fallback responded but is not healthy. Checks still run through the in-process firewall.",
      meta,
      optional: true,
      port: service.port,
      latencyMs,
    };
  } catch {
    return offline("unreachable", "Unreachable");
  }
}

export async function GET() {
  const groq = hasCredential("GROQ_API_KEY");
  const openrouter = hasCredential("OPENROUTER_API_KEY");
  const anyProvider = groq || openrouter;
  const internalKey = (process.env.INTERNAL_API_KEY ?? "").trim();

  const primary = groq ? "Groq" : openrouter ? "OpenRouter" : "none";
  const fallback = groq && openrouter ? "OpenRouter" : "none";

  const providerEntry = (
    name: string,
    label: string,
    configured: boolean,
    envKey: string,
    role: string
  ): ServiceEntry => ({
    name,
    label,
    group: "pipeline",
    status: configured ? "ok" : "unconfigured",
    headline: configured ? "Credential present" : "Credential missing",
    detail: configured
      ? `${role}. Only the presence of the environment variable is checked — no key value is read or shown.`
      : `Set ${envKey} in the server environment to enable ${role.toLowerCase()}.`,
    meta: `env: ${envKey}`,
    optional: false,
  });

  const pipeline: ServiceEntry[] = [
    providerEntry("groq", "Groq", groq, "GROQ_API_KEY", "Primary answer generation provider"),
    providerEntry(
      "openrouter",
      "OpenRouter",
      openrouter,
      "OPENROUTER_API_KEY",
      "Fallback answer generation provider"
    ),
    {
      name: "inprocess-firewall",
      label: "In-process LLM / NLI firewall",
      group: "pipeline",
      status: anyProvider ? "ok" : "unconfigured",
      headline: anyProvider ? "Available" : "Unavailable",
      detail: anyProvider
        ? "Resampling, claim entailment and grounded correction run inside this Next.js server. No Python service or realtime credential is required."
        : "Needs at least one LLM credential. Without one the firewall cannot make real verification calls.",
      meta: "server-side engine · no external service required",
      optional: false,
    },
    {
      name: "generation-route",
      label: "Answer generation route",
      group: "pipeline",
      status: anyProvider ? "ok" : "unconfigured",
      headline: anyProvider ? `Primary: ${primary} · Fallback: ${fallback}` : "No route available",
      detail: anyProvider
        ? "Chat uses this order when it needs to generate an answer for a question."
        : "Questions that require generation will fail until a provider credential is added.",
      meta: "automatic routing",
      optional: false,
    },
  ];

  const microservices = await Promise.all(
    MICROSERVICES.map((service) => probeMicroservice(service, internalKey))
  );

  const payload: StatusPayload = {
    overall: anyProvider ? "ok" : "degraded",
    title: anyProvider ? "Active pipeline ready" : "No LLM provider configured",
    reason: anyProvider
      ? "Generation and the in-process NLI firewall are available. Unreachable Python services are optional and do not affect this status."
      : "Add GROQ_API_KEY or OPENROUTER_API_KEY to enable generation and verification. Offline Python services are not the cause.",
    checkedAt: new Date().toISOString(),
    providers: { groq, openrouter },
    verification: "configuration-only",
    pipeline,
    microservices,
    services: [...pipeline, ...microservices],
  };

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store, no-cache, max-age=0" },
  });
}
