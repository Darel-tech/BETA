import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/lib/db";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const username = new URL(req.url).searchParams.get("username") ?? "";

  if (!username || username.length < 3) {
    return NextResponse.json({ available: false, message: "Too short" });
  }

  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
    return NextResponse.json({ available: false, message: "Invalid characters" });
  }

  const existing = await dbGet("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);

  return NextResponse.json({
    available: !existing,
    message: existing ? "Username taken" : "Available",
  });
}
