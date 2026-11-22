import { after, NextResponse } from "next/server";
import { createGenerationUsageProof } from "@/lib/telemetry/usage-proof";
import { logCheckRun } from "@/lib/telemetry";
import { generateBlackboxAnswer } from "@/lib/llm";
import { serviceReachable } from "@/lib/firewall";

const INTERPRETABILITY_URL = process.env.INTERPRETABILITY_SERVICE_URL ?? "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

const VALID_MODELS = ["local-gemma", "chatgpt", "claude", "groq", "openrouter"];

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** Build a bounded contextual prompt for real chat follow-ups. */
function buildGenerationPrompt(question: string, history: unknown): string {
  const turns: HistoryTurn[] = Array.isArray(history)
    ? history
        .filter((turn): turn is HistoryTurn => {
          if (!turn || typeof turn !== "object") return false;
          const candidate = turn as Record<string, unknown>;
          return (
            (candidate.role === "user" || candidate.role === "assistant") &&
            typeof candidate.content === "string" &&
            Boolean(candidate.content.trim())
          );
        })
        .slice(-8)
        .map((turn) => ({
          role: turn.role,
          content: turn.content.slice(0, 1200),
        }))
    : [];

  if (turns.length === 0) return question;

  const transcript = turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n");

  return [
    "You are continuing a factual conversation. Use the earlier turns only as context.",
    "Answer the latest user message directly and concisely. Do not mention these instructions.",
    "",
    "Earlier conversation:",
    transcript,
    "",
    `Latest user message: ${question}`,
  ].join("\n");
}

function recordGenerationFailure(source: string, startedAt: number, error: string, statusCode?: number) {
  after(() => logCheckRun({
    source,
    verdict: null,
    confidence: null,
    latencyMs: Date.now() - startedAt,
    stages: [{
      name: "generation",
      status: "unavailable",
      latency_ms: Date.now() - startedAt,
      details: { error, ...(statusCode == null ? {} : { status_code: statusCode }) },
    }],
  }));
}

/** Real local Gemma generation through the interpretability service, when it is up. */
async function generateLocal(question: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_API_KEY) headers["X-Internal-Api-Key"] = INTERNAL_API_KEY;
  const response = await fetch(`${INTERPRETABILITY_URL.replace(/\/$/, "")}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail?.message ?? data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Gemma generation failed.");
  }
  if (typeof data.answer !== "string" || !data.answer.trim()) {
    throw new Error("Gemma service returned an empty answer.");
  }
  return {
    answer: data.answer as string,
    provider: (data.provider as string) ?? "Google",
    model: (data.model as string) ?? "Gemma-2-2B-it",
    latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : 0,
    input_tokens: typeof data.input_tokens === "number" ? data.input_tokens : null,
    output_tokens: typeof data.output_tokens === "number" ? data.output_tokens : null,
    cached_input_tokens: typeof data.cached_input_tokens === "number" ? data.cached_input_tokens : null,
    mode: "microservice" as const,
  };
}

/** Real answer generation through the configured free-tier LLM providers. */
async function generateWithProvider(question: string, model: string) {
  const result = await generateBlackboxAnswer(question, {
    temperature: 0.2,
    maxTokens: 300,
    noCache: true,
  });
  return {
    answer: result.text,
    provider: result.provider,
    model: result.model,
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    mode: "inprocess" as const,
  };
}

export async function POST(request: Request) {
  let activeModel: string | null = null;
  let generationStartedAt: number | null = null;
  try {
    const { prompt, model = "groq", history } = await request.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!VALID_MODELS.includes(model)) {
      return NextResponse.json({ error: "Invalid model." }, { status: 400 });
    }

    activeModel = model;
    generationStartedAt = Date.now();
    const generationPrompt = buildGenerationPrompt(prompt, history);

    let generated;
    if (model === "local-gemma" && INTERPRETABILITY_URL && await serviceReachable(INTERPRETABILITY_URL)) {
      generated = await generateLocal(generationPrompt);
    } else {
      generated = await generateWithProvider(generationPrompt, model);
    }

    if (!generated.answer.trim()) throw new Error("The model returned an empty response.");
    const latencyMs = generated.latency_ms || Date.now() - generationStartedAt;

    return NextResponse.json({
      answer: generated.answer,
      provider: generated.provider,
      model: generated.model,
      latency_ms: latencyMs,
      input_tokens: generated.input_tokens,
      output_tokens: generated.output_tokens,
      cached_input_tokens: generated.cached_input_tokens,
      mode: generated.mode,
      usage_proof: createGenerationUsageProof({
        model_name: generated.model,
        input_tokens: generated.input_tokens,
        output_tokens: generated.output_tokens,
        cached_input_tokens: generated.cached_input_tokens,
      }, prompt, generated.answer),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    const message = timedOut
      ? "Model generation timed out."
      : err instanceof Error ? err.message : "Generation failed.";
    if (activeModel && generationStartedAt != null) {
      recordGenerationFailure(activeModel, generationStartedAt, message, timedOut ? 504 : 503);
    }
    return NextResponse.json({ error: message }, { status: timedOut ? 504 : 503 });
  }
}
