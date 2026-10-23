
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const text = body.text;
    const source = body.source;

    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "Please provide an AI answer to check." },
        { status: 400 }
      );
    }

    const allowedSources = ["local-gemma", "chatgpt", "claude"];

    if (!allowedSources.includes(source)) {
      return NextResponse.json(
        { error: "Invalid AI source." },
        { status: 400 }
      );
    }

    // MOCK RESULT: no real AI detection service is connected yet.
    return NextResponse.json({
      verdict: "uncertain",
      confidence: 0.5,
      evidence: [
        "This is a mock result for testing the BETA dashboard.",
        "A real detection service is not connected yet."
      ],
      latency_ms: 0
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request. Please try again." },
      { status: 400 }
    );
  }
}
