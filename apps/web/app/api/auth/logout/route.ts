import { NextRequest, NextResponse } from "next/server";
import { deleteRefreshToken } from "@/lib/auth/utils";
import { clearAuthCookies, COOKIE_REFRESH, getSession } from "@/lib/auth/middleware";
import { logSystemEvent } from "@/lib/audit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req);
  const refreshToken = req.cookies.get(COOKIE_REFRESH)?.value;

  if (refreshToken) {
    await deleteRefreshToken(refreshToken);
  }

  if (session) {
    await logSystemEvent({
      level: "info",
      category: "auth",
      message: `User "${session.username}" logged out`,
      userId: Number(session.sub),
    });
  }

  const res = NextResponse.json({ message: "Logged out successfully." });
  clearAuthCookies(res);
  return res;
}
