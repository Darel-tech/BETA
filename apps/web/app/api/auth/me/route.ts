/**
 * GET /api/auth/me
 * Returns current user info from access token.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/middleware";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    id: session.sub,
    username: session.username,
    email: session.email,
    role: session.role,
  });
}
