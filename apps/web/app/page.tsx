
export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-3xl text-center">
        <p className="text-cyan-400 font-semibold tracking-[0.3em] mb-4">
          BETA PROJECT
        </p>

        <h1 className="text-5xl md:text-7xl font-bold mb-6">
          Trust AI.
          <span className="text-cyan-400"> Verify Answers.</span>
        </h1>

        <p className="text-lg md:text-xl text-slate-300 mb-10">
          BETA helps evaluate AI answers and identify responses that may need
          further checking.
        </p>

        <a
          href="/dashboard"
          className="inline-block rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950 hover:bg-cyan-300"
        >
          Open Dashboard
        </a>

        <p className="mt-8 text-sm text-slate-500">
          College Mini Project · AI Answer Evaluation
        </p>
      </div>
    </main>
  );
}
