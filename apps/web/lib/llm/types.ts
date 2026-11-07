export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  cached?: boolean;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  statusText: string;
  defaultModel: string;
}

export interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  getStatus(): ProviderStatus;
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
}

