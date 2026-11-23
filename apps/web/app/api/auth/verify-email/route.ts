import { NextRequest, NextResponse } from "next/server";
import { dbGet, dbRun } from "@/lib/db";
import { verifyOTP, checkRateLimit, generateOTP, hashOTP } from "@/lib/auth/utils";
import { sendVerificationEmail } from "@/lib/auth/email";
import { getClientIp } from "@/lib/auth/middleware";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, "otp_verify");
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

  const record = await dbGet<{ id: number; code_hash: string; expires_at: string; used: number }>(
    `SELECT id, code_hash, expires_at, used FROM email_verifications
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (!record) {
    return NextResponse.json({ error: "No pending verification found." }, { status: 400 });
  }

  if (record.used) {
    return NextResponse.json({ error: "Code already used." }, { status: 400 });
  }

  if (new Date(record.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Code has expired. Please request a new one." },
      { status: 400 }
    );
  }

  const valid = await verifyOTP(otp.trim(), record.code_hash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect verification code." }, { status: 400 });
  }

  await dbRun("UPDATE email_verifications SET used = 1 WHERE id = ?", [record.id]);
  await dbRun("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?", [userId]);

  return NextResponse.json({ message: "Email verified successfully. You can now sign in." });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, "otp_send");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many resend requests. Try again in ${rl.resetInSeconds}s.` },
      { status: 429 }
    );
  }

  let body: { userId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId } = body;
  if (!userId) {
    return NextResponse.json({ error: "Missing userId." }, { status: 400 });
  }

  const user = await dbGet<{ id: number; email: string; username: string; email_verified: number }>(
    "SELECT id, email, username, email_verified FROM users WHERE id = ?",
    [userId]
  );

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (user.email_verified) {
    return NextResponse.json({ error: "Email already verified." }, { status: 400 });
  }

  const last = await dbGet<{ created_at: string }>(
    `SELECT created_at FROM email_verifications
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (last) {
    const secondsAgo = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (secondsAgo < 60) {
      return NextResponse.json(
        { error: `Please wait ${Math.ceil(60 - secondsAgo)}s before requesting another code.` },
        { status: 429 }
      );
    }
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [userId]);
  await dbRun(
    `INSERT INTO email_verifications (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, otpHash, expiresAt]
  );

  try {
    await sendVerificationEmail(user.email, user.username, otp);
  } catch {
    return NextResponse.json({ error: "Failed to send email. Check SMTP config." }, { status: 500 });
  }

  return NextResponse.json({ message: "New verification code sent." });
}
