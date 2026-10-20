
"use client";

import { useState } from "react";

export default function Dashboard() {
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("chatgpt");
  const [verdict, setVerdict] = useState("");
  const [loading, setLoading] = useState(false);

  async function checkAnswer() {
    if (!answer.trim()) {
      setVerdict("Please enter an AI answer first.");
      return;
    }

    setLoading(true);
    setVerdict("");

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: answer,
          source: source,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setVerdict(
        `${data.verdict}\nConfidence: ${Math.round(
          data.confidence * 100
        )}%\nEvidence: ${(data.evidence || []).join(", ")}`
      );
    } catch {
      setVerdict(
        "The check could not be completed. We will connect the checking API in the next step."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <a href="/" className="text-cyan-400 hover:underline">
          ← Back to Home
        </a>

        <h1 className="mt-8 text-4xl font-bold">BETA Dashboard</h1>

        <p className="mt-3 text-slate-300">
          Paste an AI answer below to start an evaluation.
        </p>
        
<label htmlFor="source" className="mt-8 block font-semibold">
  AI source
</label>

<select
  id="source"
  value={source}
  onChange={(event) => setSource(event.target.value)}
  className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"
>
  <option value="chatgpt">ChatGPT</option>
  <option value="claude">Claude</option>
  <option value="local-gemma">Local Gemma</option>
</select>


        <label
          htmlFor="answer"
          className="mt-8 block font-semibold"
        >
          AI answer
        </label>

        <textarea
          id="answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Paste an AI-generated answer here..."
          rows={7}
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-white outline-none focus:border-cyan-400"
        />

        <button
          onClick={checkAnswer}
          disabled={loading}
          className="mt-4 rounded-xl bg-cyan-400 px-6 py-3 font-bold text-slate-950 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Check Answer"}
        </button>

        {verdict && (
          <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900 p-5">
            <h2 className="text-xl font-bold">Evaluation Result</h2>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-slate-200">
              {verdict}
            </pre>
            <p className="mt-4 text-xs text-amber-300">
              DEMO MODE: This is a simulated result, not a real fact-check. Do not rely on it to determine whether an answer is true.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
