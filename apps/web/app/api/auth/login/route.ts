import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/lib/db";
import {
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  checkRateLimit,
} from "@/lib/auth/utils";
import { setAuthCookies, getClientIp } from "@/lib/auth/middleware";
import { logSystemEvent } from "@/lib/audit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, "login");
  if (!rl.allowed) {
    await logSystemEvent({
      level: "security",
      category: "rate_limit",
      message: `Rate limit exceeded on login for IP ${ip}`,
      ipAddress: ip,
    });
    return NextResponse.json(
      { error: `Too many login attempts. Try again in ${rl.resetInSeconds}s.` },
      { status: 429 }
    );
  }

  let body: { username?: string; password?: string; rememberMe?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, rememberMe = false } = body;

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const user = await dbGet<{
    id: number;
    username: string;
    email: string;
    password_hash: string;
    role: "user" | "admin";
    email_verified: number;
    is_active: number;
  }>(
    `SELECT id, username, email, password_hash, role, email_verified, is_active
     FROM users
     WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
     LIMIT 1`,
    [username, username]
  );

  const dummyHash = "$2b$12$invalidhashfortimingnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn";
  const passwordOk = await verifyPassword(password, user?.password_hash ?? dummyHash);

  if (!user || !passwordOk) {
    await logSystemEvent({
      level: "warn",
      category: "auth",
      message: `Failed login attempt for identifier "${username}" from IP ${ip}`,
      ipAddress: ip,
    });
    return NextResponse.json(
      { error: "Incorrect username or password." },
      { status: 401 }
    );
  }

  if (!user.is_active) {
    return NextResponse.json(
      { error: "This account has been suspended. Contact support." },
      { status: 403 }
    );
  }

  if (!user.email_verified) {
    return NextResponse.json(
      {
        error: "Please verify your email before signing in.",
        code: "EMAIL_NOT_VERIFIED",
        userId: user.id,
      },
      { status: 403 }
    );
  }

  const accessToken = await signAccessToken({
    sub: String(user.id),
    username: user.username,
    email: user.email,
    role: user.role,
  });

  const refreshToken = generateRefreshToken();
  await saveRefreshToken(user.id, refreshToken, rememberMe);

  await logSystemEvent({
    level: "info",
    category: "auth",
    message: `User "${user.username}" (${user.role}) logged in successfully from IP ${ip}`,
    userId: user.id,
    ipAddress: ip,
  });

  const redirectTo = user.role === "admin" ? "/admin" : "/chat";

  const res = NextResponse.json({
    message: "Login successful.",
    role: user.role,
    redirectTo,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });

  setAuthCookies(res, accessToken, refreshToken, rememberMe);
  return res;
}
