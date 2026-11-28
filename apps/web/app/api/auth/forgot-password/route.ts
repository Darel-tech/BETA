import { NextRequest, NextResponse } from "next/server";
import { dbGet, dbRun } from "@/lib/db";
import {
  generateOTP,
  hashOTP,
  verifyOTP,
  hashToken,
  hashPassword,
  checkRateLimit,
  generateRefreshToken,
} from "@/lib/auth/utils";
import { sendPasswordResetEmail } from "@/lib/auth/email";
import { getClientIp } from "@/lib/auth/middleware";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "send";

  if (action === "send") {
    return handleSend(req, ip);
  } else if (action === "verify") {
    return handleVerify(req, ip);
  } else if (action === "reset") {
    return handleReset(req, ip);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function handleSend(req: NextRequest, ip: string): Promise<NextResponse> {
  const rl = await checkRateLimit(ip, "reset_send");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.resetInSeconds}s.` },
      { status: 429 }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await dbGet<{ id: number; username: string; email_verified: number }>(
    "SELECT id, username, email_verified FROM users WHERE email = ? COLLATE NOCASE",
    [email]
  );

  if (!user || !user.email_verified) {
    return NextResponse.json({
      message: "If that email is registered and verified, a reset code has been sent.",
    });
  }

  const last = await dbGet<{ created_at: string }>(
    `SELECT created_at FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );

  if (last) {
    const secondsAgo = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (secondsAgo < 60) {
      return NextResponse.json({
        message: "If that email is registered and verified, a reset code has been sent.",
      });
    }
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await dbRun("DELETE FROM password_resets WHERE user_id = ?", [user.id]);
  await dbRun(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [user.id, otpHash, expiresAt]
  );

  try {
    await sendPasswordResetEmail(email, user.username, otp);
  } catch (err) {
    console.error("Reset email failed:", err);
    return NextResponse.json({ error: "Failed to send email. Check SMTP config." }, { status: 500 });
  }

  return NextResponse.json({
    message: "If that email is registered and verified, a reset code has been sent.",
    userId: user.id,
  });
}

async function handleVerify(req: NextRequest, ip: string): Promise<NextResponse> {
  const rl = await checkRateLimit(ip, "reset_verify");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.resetInSeconds}s.` },
      { status: 429 }
    );
  }

  let body: { userId?: number; otp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, otp } = body;
  if (!userId || !otp) {
    return NextResponse.json({ error: "Missing userId or otp." }, { status: 400 });
  }

  const record = await dbGet<{ id: number; token_hash: string; expires_at: string; used: number }>(
    `SELECT id, token_hash, expires_at, used FROM password_resets
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (!record || record.used) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  }

  if (new Date(record.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code has expired. Request a new one." }, { status: 400 });
  }

  const valid = await verifyOTP(otp.trim(), record.token_hash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  const resetToken = generateRefreshToken();
  const resetHash = hashToken(resetToken);
  const resetExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await dbRun("UPDATE password_resets SET used = 1 WHERE id = ?", [record.id]);
  await dbRun(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, resetHash, resetExpiry]
  );

  return NextResponse.json({ message: "Code verified.", resetToken, userId });
}

async function handleReset(req: NextRequest, _ip: string): Promise<NextResponse> {
  let body: { userId?: number; resetToken?: string; password?: string; confirmPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, resetToken, password, confirmPassword } = body;

  if (!userId || !resetToken || !password || !confirmPassword) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const record = await dbGet<{ id: number; expires_at: string; used: number }>(
    `SELECT id, expires_at, used FROM password_resets
     WHERE user_id = ? AND token_hash = ? ORDER BY created_at DESC LIMIT 1`,
    [userId, hashToken(resetToken)]
  );

  if (!record || record.used) {
    return NextResponse.json({ error: "Invalid or expired reset token." }, { status: 400 });
  }

  if (new Date(record.expires_at) < new Date()) {
    return NextResponse.json({ error: "Reset token has expired. Start over." }, { status: 400 });
  }

  const newHash = await hashPassword(password);

  await dbRun("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [newHash, userId]);
  await dbRun("UPDATE password_resets SET used = 1 WHERE id = ?", [record.id]);
  await dbRun("DELETE FROM sessions WHERE user_id = ?", [userId]);

  return NextResponse.json({ message: "Password reset successfully. You can now sign in." });
}
