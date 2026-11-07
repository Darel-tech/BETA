import { LLMProvider, ProviderStatus, GenerateResult, GenerateOptions } from "./types";
import { GroqProvider } from "./providers/groq";
import { OpenRouterProvider } from "./providers/openrouter";
import { DisabledOpenAIProvider, DisabledAnthropicProvider } from "./providers/legacy";

const groq = new GroqProvider();
const openRouter = new OpenRouterProvider();
const openai = new DisabledOpenAIProvider();
const anthropic = new DisabledAnthropicProvider();

const providers: Record<string, LLMProvider> = {
  groq,
  openrouter: openRouter,
  openai,
  anthropic,
};

export function getProvider(name: string): LLMProvider | undefined {
  return providers[name.toLowerCase()];
}

export function getAllProviderStatuses(): ProviderStatus[] {
  return Object.values(providers).map((p) => p.getStatus());
}

/**
 * Generate answer using Groq as the primary black-box provider,
 * falling back automatically to OpenRouter (:free tier).
 */
export async function generateBlackboxAnswer(
  prompt: string,
  options?: GenerateOptions
): Promise<GenerateResult> {
  // 1. Try Groq (Primary)
  if (groq.isConfigured()) {
    try {
      return await groq.generate(prompt, options);
    } catch (err) {
      console.warn("Primary blackbox provider Groq failed, attempting fallback:", err);
    }
  }

  // 2. Try OpenRouter (Fallback, free tier)
  if (openRouter.isConfigured()) {
    return await openRouter.generate(prompt, options);
  }

  throw new Error("No configured free LLM provider available (Groq / OpenRouter).");
}

export * from "./types";
export * from "./cache";

