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

    // Check cache. Older runs could cache an empty reasoning-only response;
    // never reuse that as a successful answer. Live firewall calls opt out so
    // their measured timings reflect real network calls.
    const cached = options?.noCache ? null : getCachedPrompt(this.name, model, prompt);
    if (cached !== null && cached.trim()) {
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
        // Reasoning models (e.g. gpt-oss) consume tokens before emitting the
        // final message. A 512 cap can leave `content` empty and silently
        // destroy judge output, so allow a larger ceiling.
        max_tokens: Math.min(options?.maxTokens ?? 300, 2048),
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Groq call failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message ?? {};
    const content = typeof message.content === "string" ? message.content.trim() : "";
    // Fallback for reasoning-only responses: keep only the structured final
    // lines, never raw chain-of-thought.
    const reasoning = typeof message.reasoning === "string" ? message.reasoning : "";
    const structured = reasoning
      .split(/\r?\n/)
      .filter((line: string) => /^\s*(claim|answer)\s*:/i.test(line))
      .join("\n")
      .trim();
    const text = content || structured;
    if (!text) throw new Error("Groq returned an empty response.");
    setCachedPrompt(this.name, model, prompt, text);

    return { text, model, provider: this.name, cached: false };
  }
}

