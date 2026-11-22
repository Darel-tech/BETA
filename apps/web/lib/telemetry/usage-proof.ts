import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface GenerationUsageProof {
  model_name: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  issued_at_ms: number;
  question_sha256: string;
  answer_sha256: string;
  signature: string;
}

type UsageInput = Omit<GenerationUsageProof, "issued_at_ms" | "question_sha256" | "answer_sha256" | "signature">;
type UnsignedProof = Omit<GenerationUsageProof, "signature">;

const MAX_PROOF_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;

function signingSecret(): string {
  return process.env.USAGE_SIGNING_SECRET ?? process.env.INTERNAL_API_KEY ?? "";
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalPayload(proof: UnsignedProof): string {
  return JSON.stringify({
    model_name: proof.model_name,
    input_tokens: proof.input_tokens,
    output_tokens: proof.output_tokens,
    cached_input_tokens: proof.cached_input_tokens,
    issued_at_ms: proof.issued_at_ms,
    question_sha256: proof.question_sha256,
    answer_sha256: proof.answer_sha256,
  });
}

function isTokenCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

export function createGenerationUsageProof(
  usage: UsageInput,
  question: string,
  answer: string
): GenerationUsageProof | null {
  const secret = signingSecret();
  if (!secret || !usage.model_name || !isTokenCount(usage.input_tokens) || !isTokenCount(usage.output_tokens) || !isTokenCount(usage.cached_input_tokens)) {
    return null;
  }

  const unsigned: UnsignedProof = {
    ...usage,
    issued_at_ms: Date.now(),
    question_sha256: digest(question),
    answer_sha256: digest(answer),
  };
  const signature = createHmac("sha256", secret).update(canonicalPayload(unsigned), "utf8").digest("hex");
  return { ...unsigned, signature };
}

export function verifyGenerationUsageProof(
  value: unknown,
  question: string,
  answer: string
): GenerationUsageProof | null {
  const secret = signingSecret();
  if (!secret || !value || typeof value !== "object") return null;

  const proof = value as Partial<GenerationUsageProof>;
  if (
    typeof proof.model_name !== "string" || !proof.model_name ||
    !isTokenCount(proof.input_tokens) || !isTokenCount(proof.output_tokens) || !isTokenCount(proof.cached_input_tokens) ||
    !Number.isSafeInteger(proof.issued_at_ms) ||
    typeof proof.question_sha256 !== "string" || typeof proof.answer_sha256 !== "string" ||
    typeof proof.signature !== "string" || !/^[a-f0-9]{64}$/.test(proof.signature)
  ) return null;

  const now = Date.now();
  if (proof.issued_at_ms! > now + MAX_FUTURE_SKEW_MS || now - proof.issued_at_ms! > MAX_PROOF_AGE_MS) return null;
  if (proof.question_sha256 !== digest(question) || proof.answer_sha256 !== digest(answer)) return null;

  const unsigned: UnsignedProof = {
    model_name: proof.model_name,
    input_tokens: proof.input_tokens,
    output_tokens: proof.output_tokens,
    cached_input_tokens: proof.cached_input_tokens,
    issued_at_ms: proof.issued_at_ms!,
    question_sha256: proof.question_sha256,
    answer_sha256: proof.answer_sha256,
  };
  const expected = createHmac("sha256", secret).update(canonicalPayload(unsigned), "utf8").digest();
  const supplied = Buffer.from(proof.signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  return { ...unsigned, signature: proof.signature };
}
