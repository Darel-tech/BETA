/**
 * Auth utilities: hashing, JWT, OTP, rate-limiting helpers.
 */

import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { dbGet, dbRun } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "CHANGE_ME_in_production_min_32_chars!!"
);
const JWT_ISSUER = "beta-auth";
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_REMEMBER_TTL_DAYS = 30;

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── JWT (access tokens) ───────────────────────────────────────────────────────

export interface JWTPayload {
  sub: string; // user id
  username: string;
  email: string;
  role: "user" | "admin";
}

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET);
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { issuer: JWT_ISSUER });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// ── Refresh tokens (opaque, stored in DB) ─────────────────────────────────────

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function saveRefreshToken(
  userId: number,
  token: string,
  rememberMe: boolean
): Promise<void> {
  const days = rememberMe ? REFRESH_REMEMBER_TTL_DAYS : REFRESH_TOKEN_TTL_DAYS;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await dbRun(
    `INSERT INTO sessions (user_id, token_hash, remember_me, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, hashToken(token), rememberMe ? 1 : 0, expiresAt]
  );
}

export async function validateRefreshToken(
  token: string
): Promise<{ userId: number; rememberMe: boolean } | null> {
  const row = await dbGet<{ user_id: number; remember_me: number; expires_at: string }>(
    `SELECT user_id, remember_me, expires_at FROM sessions
     WHERE token_hash = ? AND expires_at > datetime('now')`,
    [hashToken(token)]
  );

  if (!row) return null;
  return { userId: row.user_id, rememberMe: row.remember_me === 1 };
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await dbRun("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

// ── OTP ───────────────────────────────────────────────────────────────────────

export function generateOTP(): string {
  return String(crypto.randomInt(100_000, 999_999));
}

export async function hashOTP(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function verifyOTP(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

const RATE_LIMITS: Record<string, { max: number; windowSeconds: number }> = {
  login: { max: 5, windowSeconds: 300 },       // 5 attempts per 5 minutes
  otp_send: { max: 3, windowSeconds: 600 },    // 3 sends per 10 minutes
  otp_verify: { max: 10, windowSeconds: 300 }, // 10 verify attempts per 5 minutes
  reset_send: { max: 3, windowSeconds: 600 },
  reset_verify: { max: 10, windowSeconds: 300 },
};

export async function checkRateLimit(
  key: string,
  action: string
): Promise<{ allowed: boolean; remaining: number; resetInSeconds: number }> {
  // Fetch dynamic config from database or fall back to defaults
  let limit = RATE_LIMITS[action] ?? { max: 10, windowSeconds: 60 };
  try {
    const customConfig = await dbGet<{ max_attempts: number; window_seconds: number }>(
      "SELECT max_attempts, window_seconds FROM rate_limit_configs WHERE action = ?",
      [action]
    );
    if (customConfig) {
      limit = { max: customConfig.max_attempts, windowSeconds: customConfig.window_seconds };
    }
  } catch {
    // fallback to static
  }

  const compositeKey = `${action}:${key}`;

  const row = await dbGet<{ attempts: number; window_start: string }>(
    `SELECT attempts, window_start FROM rate_limits WHERE key = ? AND action = ?`,
    [compositeKey, action]
  );

  const now = Date.now();

  if (!row) {
    await dbRun(
      `INSERT INTO rate_limits (key, action, attempts, window_start) VALUES (?, ?, 1, datetime('now'))`,
      [compositeKey, action]
    );
    return { allowed: true, remaining: limit.max - 1, resetInSeconds: limit.windowSeconds };
  }

  const windowStart = new Date(row.window_start).getTime();
  const elapsed = (now - windowStart) / 1000;

  if (elapsed > limit.windowSeconds) {
    await dbRun(
      `UPDATE rate_limits SET attempts = 1, window_start = datetime('now') WHERE key = ? AND action = ?`,
      [compositeKey, action]
    );
    return { allowed: true, remaining: limit.max - 1, resetInSeconds: limit.windowSeconds };
  }

  if (row.attempts >= limit.max) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.ceil(limit.windowSeconds - elapsed),
    };
  }

  await dbRun(
    `UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ? AND action = ?`,
    [compositeKey, action]
  );

  return {
    allowed: true,
    remaining: limit.max - row.attempts - 1,
    resetInSeconds: Math.ceil(limit.windowSeconds - elapsed),
  };
}
