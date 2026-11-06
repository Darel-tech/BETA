"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

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
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16"
      style={{ background: "var(--background)" }}>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 flex items-center justify-between px-6 py-3 border-b z-50"
        style={{ background: "rgba(10,10,20,0.9)", borderColor: "var(--border-subtle)", backdropFilter: "blur(12px)" }}>
        <span className="font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>BETA</span>
        <div className="flex items-center gap-4 text-sm" style={{ color: "#94a3b8" }}>
          <a href="/compare" className="hover:text-white transition-colors">Compare</a>
          <a href="/dashboard" className="hover:text-white transition-colors">Dashboard</a>
          <a href="/status" className="hover:text-white transition-colors">Status</a>
        </div>
      </nav>

      <div className="max-w-2xl w-full text-center mt-10">
        {/* Badge */}
        <span className="inline-block text-xs font-semibold tracking-[0.3em] px-3 py-1 rounded-full mb-6"
          style={{ background: "var(--verdict-trustworthy-bg)", color: "var(--accent)", border: "1px solid var(--border-default)" }}>
          AI HALLUCINATION FIREWALL
        </span>

        <h1 className="text-5xl md:text-6xl font-bold mb-5 leading-tight">
          Ask once.{" "}
          <span style={{ color: "var(--accent)" }}>Verify everything.</span>
        </h1>

        <p className="text-lg mb-4" style={{ color: "#94a3b8" }}>
          BETA sends your question to Gemma, ChatGPT, and Claude — then
          fact-checks all three answers against a real knowledge base and shows
          you a side-by-side verdict.
        </p>

        {/* Verdict legend */}
        <div className="flex justify-center gap-4 flex-wrap mb-10 text-sm">
          {[
            { label: "Trustworthy", cls: "verdict-trustworthy" },
            { label: "Uncertain", cls: "verdict-uncertain" },
            { label: "Needs correction", cls: "verdict-needs-correction" },
          ].map((v) => (
            <span key={v.label} className={`${v.cls} px-3 py-1 rounded-full text-xs font-semibold`}>
              {v.label}
            </span>
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="relative">
          <div className="rounded-2xl border p-1"
            style={{ background: "var(--surface-1)", borderColor: "var(--border-default)" }}>
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything… e.g. When did the Berlin Wall fall?"
              rows={2}
              disabled={loading}
              className="w-full resize-none rounded-xl px-4 pt-3 pb-2 text-base outline-none disabled:opacity-60"
              style={{
                background: "transparent",
                color: "var(--foreground)",
                minHeight: "56px",
                maxHeight: "200px",
              }}
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <span className="text-xs" style={{ color: "#475569" }}>
                Press <kbd className="px-1 rounded text-xs"
                  style={{ background: "var(--surface-2)", color: "#94a3b8" }}>Enter</kbd> to compare all models
              </span>
              <button
                type="submit"
                disabled={!question.trim() || loading}
                className="rounded-xl px-5 py-2 text-sm font-bold disabled:opacity-40 transition-all"
                style={{ background: "var(--accent)", color: "#0a0a14" }}
              >
                {loading ? "Sending…" : "Compare ↗"}
              </button>
            </div>
          </div>
        </form>

        <p className="mt-4 text-xs" style={{ color: "#334155" }}>
          No manual model selection · No entity list · No separate fact-check button
        </p>

        {/* Architecture card */}
        <div className="mt-16 rounded-2xl border p-6 text-left"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#64748b" }}>HOW IT WORKS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: "01",
                title: "Multi-model generation",
                desc: "Your question is sent in parallel to Gemma-2-2B (local SAE inference), GPT-4o-mini, and Claude Haiku.",
              },
              {
                step: "02",
                title: "Hallucination detection",
                desc: "Each answer is scored — Gemma via SAE known-ness probes, ChatGPT/Claude via semantic-entropy resampling + NLI.",
              },
              {
                step: "03",
                title: "Grounded correction",
                desc: "Flagged answers are cross-checked against a 2 000+ passage Wikipedia knowledge base and corrected with citations.",
              },
            ].map((card) => (
              <div key={card.step} className="rounded-xl p-4"
                style={{ background: "var(--surface-2)" }}>
                <div className="text-xs font-mono mb-2" style={{ color: "var(--accent)" }}>{card.step}</div>
                <div className="font-semibold mb-1 text-sm">{card.title}</div>
                <div className="text-xs leading-relaxed" style={{ color: "#64748b" }}>{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
