/**
 * Real grounded correction: when the detector flags an answer, ask the live
 * model to rewrite it using ONLY the supplied reference facts, then verify the
 * rewrite did not introduce a new contradiction. No canned corrections.
 */

import { generateBlackboxAnswer } from "@/lib/llm";
import { isPromptEcho } from "./detector";
import { selectReferenceFacts } from "./knowledge";
import type { DetectorResult } from "./types";

export interface CorrectionResult {
  corrected_answer: string | null;
  used_facts: string[];
  stages: Array<{
    name: string;
    status: "completed" | "skipped" | "unavailable";
    latency_ms?: number;
    details?: Record<string, unknown>;
  }>;
}

export async function correctAnswer(options: {
  question: string;
  answer: string;
  detection: DetectorResult;
}): Promise<CorrectionResult> {
  const { question, answer, detection } = options;
  if (detection.verdict === "trustworthy") {
    return { corrected_answer: null, used_facts: [], stages: [] };
  }

  const facts = detection.referenceFacts.length
    ? detection.referenceFacts
    : selectReferenceFacts(question, answer).map((fact) => fact.fact);
  if (!facts.length) {
    return {
      corrected_answer: null,
      used_facts: [],
      stages: [{ name: "grounded_correction", status: "skipped" }],
    };
  }

  const started = Date.now();
  const contradicted = detection.evidenceItems
    .filter((item) => !item.supports && item.kind === "entailment")
    .map((item) => `- ${item.statement} (${item.detail})`)
    .join("\n");

  const prompt = `You are a careful factual editor. Rewrite the ANSWER so that every factual claim is consistent with the VERIFIED FACTS. These facts are already verified: never say a statement is "not verified" or "unverifiable" when it matches one of them. If a claim has no supporting fact, omit it rather than adding a disclaimer. Cite only the fact numbers you actually rely on inline like [F1]. Do not invent any new fact, number, date, name, or source. Do not echo these instructions. Answer in at most 3 sentences.

QUESTION: ${question}

ORIGINAL ANSWER:
${answer.length > 1200 ? `${answer.slice(0, 1200)}…` : answer}

FLAGGED CLAIMS:
${contradicted || "No directly contradicted claim; answer is uncertain or unverifiable."}

VERIFIED FACTS:
${facts.map((fact, index) => `[F${index + 1}] ${fact}`).join("\n")}

Reply with exactly one line in this format (no other text):
answer: <corrected answer with [F#] citations>`;

  try {
    const result = await generateBlackboxAnswer(prompt, { temperature: 0, maxTokens: 1200 });
    // The provider can recover an `answer:` line from a reasoning-only response.
    const corrected = result.text.replace(/^\s*answer\s*:\s*/i, "").trim();
    if (!corrected) throw new Error("Correction model returned an empty answer.");
    if (isPromptEcho(corrected)) throw new Error("Correction model echoed its instructions.");

    // Only claim a fact was used when the model actually cited it.
    const usedFacts = facts.filter((_, index) => corrected.includes(`[F${index + 1}]`));

    return {
      corrected_answer: corrected,
      used_facts: usedFacts,
      stages: [{
        name: "grounded_correction",
        status: "completed",
        latency_ms: Date.now() - started,
      }],
    };
  } catch (err) {
    return {
      corrected_answer: null,
      used_facts: [],
      stages: [{
        name: "grounded_correction",
        status: "unavailable",
        latency_ms: Date.now() - started,
        details: {
          error: err instanceof Error ? err.message : "Correction model call failed.",
        },
      }],
    };
  }
}
