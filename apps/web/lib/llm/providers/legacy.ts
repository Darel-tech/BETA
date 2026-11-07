import { LLMProvider, ProviderStatus, GenerateOptions, GenerateResult } from "../types";

export class DisabledOpenAIProvider implements LLMProvider {
  name = "OpenAI";

  isConfigured(): boolean {
    return Boolean((process.env.OPENAI_API_KEY ?? "").trim());
  }

  getStatus(): ProviderStatus {
    const configured = this.isConfigured();
    return {
      name: this.name,
      configured,
      statusText: configured ? "Ready" : "Not configured",
      defaultModel: "gpt-4o-mini",
    };
  }

  async generate(_prompt: string, _options?: GenerateOptions): Promise<GenerateResult> {
    throw new Error("OpenAI is disabled or not configured. Free providers (Groq / OpenRouter) are active.");
  }
}

export class DisabledAnthropicProvider implements LLMProvider {
  name = "Anthropic";

  isConfigured(): boolean {
    return Boolean((process.env.ANTHROPIC_API_KEY ?? "").trim());
  }

  getStatus(): ProviderStatus {
    const configured = this.isConfigured();
    return {
      name: this.name,
      configured,
      statusText: configured ? "Ready" : "Not configured",
      defaultModel: "claude-haiku-5-5",
    };
  }

  async generate(_prompt: string, _options?: GenerateOptions): Promise<GenerateResult> {
    throw new Error("Anthropic is disabled or not configured. Free providers (Groq / OpenRouter) are active.");
  }
}

