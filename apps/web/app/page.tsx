"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BkNav, BkBadge, BkCard, BkButton } from "@/components/ui/BoldKit";

export default function Home() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [question]);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    // Navigate to /compare with the question as a URL param
    router.push(`/compare?q=${encodeURIComponent(question.trim())}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="bk-app">
      <BkNav active="home" />

      <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-20 pt-14 text-center sm:px-8">
        <div className="max-w-2xl w-full">
          <BkBadge tone="success" className="mb-6">
            AI HALLUCINATION FIREWALL
          </BkBadge>

          <h1 className="text-5xl font-black leading-tight tracking-tight text-[var(--bk-ink)] md:text-6xl">
            Ask once.{" "}
            <span className="text-[var(--bk-brand-text)]">Verify everything.</span>
          </h1>

          <p className="mt-5 text-base leading-relaxed text-[var(--bk-muted)]">
            BETA sends your question to Gemma, Groq, and OpenRouter — then
            fact-checks all three answers against a real knowledge base and shows
            you a side-by-side verdict.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
            <BkBadge tone="success">Trustworthy</BkBadge>
            <BkBadge tone="warning">Uncertain</BkBadge>
            <BkBadge tone="risk">Needs correction</BkBadge>
          </div>

          <form onSubmit={handleSubmit} className="mt-10">
            <div className="bk-frame bg-[var(--bk-paper)] p-2">
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything… e.g. When did the Berlin Wall fall?"
                rows={2}
                disabled={loading}
                className="bk-input min-h-14 max-h-52 w-full resize-none border-0 shadow-none focus:translate-x-0 focus:translate-y-0"
                style={{ minHeight: "56px", maxHeight: "200px" }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-1">
                <span className="text-[11px] text-[var(--bk-muted)]">
                  Press <kbd className="bk-badge bk-badge--paper mx-1">Enter</kbd> to compare all models
                </span>
                <BkButton type="submit" disabled={!question.trim() || loading}>
                  {loading ? "Sending…" : "Compare ↗"}
                </BkButton>
              </div>
            </div>
          </form>

          <p className="mt-4 text-[11px] text-[var(--bk-muted)]">
            No manual model selection · No entity list · No separate fact-check button
          </p>
        </div>

        <BkCard tone="insight" className="mt-16 w-full text-left">
          <p className="bk-eyebrow mb-5">HOW IT WORKS</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Multi-model generation",
                desc: "Your question is sent in parallel to Gemma-2-2B (local SAE inference), GPT-4o-mini, and Claude Haiku.",
                tone: "brand" as const,
              },
              {
                step: "02",
                title: "Hallucination detection",
                desc: "Each answer is scored — Gemma via SAE known-ness probes, ChatGPT/Claude via semantic-entropy resampling + NLI.",
                tone: "warning" as const,
              },
              {
                step: "03",
                title: "Grounded correction",
                desc: "Flagged answers are cross-checked against a 2 000+ passage Wikipedia knowledge base and corrected with citations.",
                tone: "evidence" as const,
              },
            ].map((card) => (
              <div key={card.step} className="bk-frame--thin border bg-[var(--bk-paper)] p-4">
                <div className={`bk-label mb-2 ${card.tone === "warning" ? "text-[var(--bk-warning-text)]" : card.tone === "evidence" ? "text-[var(--bk-evidence-text)]" : "text-[var(--bk-brand-text)]"}`}>
                  {card.step}
                </div>
                <div className="text-sm font-black text-[var(--bk-ink)]">{card.title}</div>
                <div className="mt-2 text-xs leading-relaxed text-[var(--bk-muted)]">{card.desc}</div>
              </div>
            ))}
          </div>
        </BkCard>
      </main>
    </div>
  );
}
