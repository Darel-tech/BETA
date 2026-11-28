import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/lib/db";
import {
  signAccessToken,
  validateRefreshToken,
  generateRefreshToken,
  saveRefreshToken,
  deleteRefreshToken,
} from "@/lib/auth/utils";
import { setAuthCookies, COOKIE_REFRESH } from "@/lib/auth/middleware";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const refreshToken = req.cookies.get(COOKIE_REFRESH)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token." }, { status: 401 });
  }

  const session = await validateRefreshToken(refreshToken);
  if (!session) {
    return NextResponse.json({ error: "Invalid or expired refresh token." }, { status: 401 });
  }

  const user = await dbGet<{ id: number; username: string; email: string; role: "user" | "admin"; is_active: number }>(
    `SELECT id, username, email, role, is_active FROM users WHERE id = ?`,
    [session.userId]
  );

  if (!user || !user.is_active) {
    return NextResponse.json({ error: "User not found or suspended." }, { status: 401 });
  }

  await deleteRefreshToken(refreshToken);
  const newRefreshToken = generateRefreshToken();
  await saveRefreshToken(user.id, newRefreshToken, session.rememberMe);

  const accessToken = await signAccessToken({
    sub: String(user.id),
    username: user.username,
    email: user.email,
    role: user.role,
  });

  const res = NextResponse.json({
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
  setAuthCookies(res, accessToken, newRefreshToken, session.rememberMe);
  return res;
}
