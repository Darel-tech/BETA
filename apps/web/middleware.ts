/**
 * Next.js Edge Middleware — route protection.
 * Runs on every request before rendering.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "CHANGE_ME_in_production_min_32_chars!!"
);

// Routes that require authentication
const PROTECTED = ["/chat", "/compare", "/status"];
// Routes that require admin role
const ADMIN_ONLY = ["/admin"];
// Routes only for unauthenticated users (redirect to /chat if signed in)
const AUTH_ONLY = ["/auth/login", "/auth/signup", "/auth/forgot-password"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const accessToken = req.cookies.get("beta_access")?.value;

  let payload: { role?: string } | null = null;
  if (accessToken) {
    try {
      const { payload: p } = await jwtVerify(accessToken, JWT_SECRET, {
        issuer: "beta-auth",
      });
      payload = p as { role?: string };
    } catch {
      payload = null;
    }
  }

  const isAuthenticated = !!payload;
  const isAdmin = payload?.role === "admin";

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && AUTH_ONLY.some((p) => pathname.startsWith(p))) {
    const dest = isAdmin ? "/admin" : "/chat";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // Protect routes requiring authentication
  if (PROTECTED.some((p) => pathname.startsWith(p)) && !isAuthenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Protect admin routes
  if (ADMIN_ONLY.some((p) => pathname.startsWith(p))) {
    if (!isAuthenticated) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/chat", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/compare/:path*",
    "/status/:path*",
    "/admin/:path*",
    "/auth/:path*",
  ],
};
