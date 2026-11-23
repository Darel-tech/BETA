import { LLMProvider, ProviderStatus, GenerateOptions, GenerateResult } from "../types";
import { getCachedPrompt, setCachedPrompt, checkAndIncrementDailyLimit } from "../cache";

export class OpenRouterProvider implements LLMProvider {
  name = "OpenRouter";

  private getApiKey(): string {
    return (process.env.OPENROUTER_API_KEY ?? "").trim();
  }

  getDefaultModel(): string {
    // Strictly :free models only
    const configured = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning:free";
    return configured.endsWith(":free") ? configured : "nvidia/nemotron-3.5-lightning:free";
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  getStatus(): ProviderStatus {
    const configured = this.isConfigured();
    return {
      name: this.name,
      configured,
      statusText: configured ? "Ready (:free tier)" : "Not configured",
      defaultModel: this.getDefaultModel(),
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(`${this.name} is not configured.`);
    }

    const freeCandidates = [
      "inclusionai/ling-3.2-flash:free",
      "nvidia/nemotron-3.5-lightning:free",
      "liquid/lfm-3-1.7b:free",
      "dots-studio/dots-3-note-preview:free",
    ];

    // Check cache unless this is a live firewall call.
    if (!options?.noCache) {
      for (const m of freeCandidates) {
        const cached = getCachedPrompt(this.name, m, prompt);
        if (cached !== null && cached.trim()) {
          return { text: cached, model: m, provider: this.name, cached: true };
        }
      }
    }

    // Check daily rate limit
    const limit = checkAndIncrementDailyLimit(this.name);
    if (!limit.allowed) {
      throw new Error(`Daily limit reached for ${this.name}.`);
    }

    let lastError: Error | null = null;
    for (const candidate of freeCandidates) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "BETA Hallucination Firewall",
          },
          body: JSON.stringify({
            model: candidate,
            messages: [{ role: "user", content: prompt }],
            temperature: options?.temperature ?? 0.7,
            max_tokens: Math.min(options?.maxTokens ?? 300, 2048),
          }),
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          lastError = new Error(`Model ${candidate} failed (${res.status}): ${err}`);
          continue;
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
        if (text) {
          setCachedPrompt(this.name, candidate, prompt, text);
          return { text, model: candidate, provider: this.name, cached: false };
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error("All OpenRouter free candidates failed.");
  }
}

