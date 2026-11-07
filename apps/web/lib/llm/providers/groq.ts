import { LLMProvider, ProviderStatus, GenerateOptions, GenerateResult } from "../types";
import { getCachedPrompt, setCachedPrompt, checkAndIncrementDailyLimit } from "../cache";

export class GroqProvider implements LLMProvider {
  name = "Groq";

  private getApiKey(): string {
    return (process.env.GROQ_API_KEY ?? "").trim();
  }

  getDefaultModel(): string {
    return process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  getStatus(): ProviderStatus {
    const configured = this.isConfigured();
    return {
      name: this.name,
      configured,
      statusText: configured ? "Ready" : "Not configured",
      defaultModel: this.getDefaultModel(),
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(`${this.name} is not configured.`);
    }

    const model = options?.model || this.getDefaultModel();

    // Check cache
    const cached = getCachedPrompt(this.name, model, prompt);
    if (cached !== null) {
      return { text: cached, model, provider: this.name, cached: true };
    }

    // Check daily rate limit
    const limit = checkAndIncrementDailyLimit(this.name);
    if (!limit.allowed) {
      throw new Error(`Daily limit reached for ${this.name}.`);
    }

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature ?? 0.7,
        max_tokens: Math.min(options?.maxTokens ?? 300, 512),
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Groq call failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
    setCachedPrompt(this.name, model, prompt, text);

    return { text, model, provider: this.name, cached: false };
  }
}

