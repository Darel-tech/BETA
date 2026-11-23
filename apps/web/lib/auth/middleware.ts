/**
 * Auth middleware for Next.js App Router.
 * Reads JWT from HTTP-only cookie and attaches user to request.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, type JWTPayload } from "@/lib/auth/utils";

export const COOKIE_ACCESS = "beta_access";
export const COOKIE_REFRESH = "beta_refresh";

export async function getSession(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get(COOKIE_ACCESS)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export function setAuthCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean
): void {
  const maxAgeAccess = 15 * 60; // 15 minutes
  const maxAgeRefresh = rememberMe ? 30 * 86400 : 7 * 86400;

  res.cookies.set(COOKIE_ACCESS, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeAccess,
  });

  res.cookies.set(COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeRefresh,
  });
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(COOKIE_ACCESS, "", { maxAge: 0, path: "/" });
  res.cookies.set(COOKIE_REFRESH, "", { maxAge: 0, path: "/" });
}

/** Require a valid session — returns 401 JSON if missing */
export async function requireAuth(
  req: NextRequest
): Promise<JWTPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

/** Require admin role */
export async function requireAdmin(
  req: NextRequest
): Promise<JWTPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

/** Get caller IP for rate-limiting */
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
