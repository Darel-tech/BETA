import { NextRequest, NextResponse } from "next/server";
import { dbGet, dbRun } from "@/lib/db";
import {
  hashPassword,
  generateOTP,
  hashOTP,
  checkRateLimit,
} from "@/lib/auth/utils";
import { sendVerificationEmail } from "@/lib/auth/email";
import { getClientIp } from "@/lib/auth/middleware";
import { logSystemEvent } from "@/lib/audit";

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const PASSWORD_MIN = 8;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, "otp_send");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.resetInSeconds}s.` },
      { status: 429 }
    );
  }

  let body: { username?: string; email?: string; password?: string; confirmPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, email, password, confirmPassword } = body;

  if (!username || !USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3–30 characters: letters, numbers, _ or . only." },
      { status: 400 }
    );
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }
  if (!password || password.length < PASSWORD_MIN) {
    return NextResponse.json(
      { error: `Password must be at least ${PASSWORD_MIN} characters.` },
      { status: 400 }
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const existingUser = await dbGet("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);
  if (existingUser) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
  }

  const existingEmail = await dbGet("SELECT id FROM users WHERE email = ? COLLATE NOCASE", [email]);
  if (existingEmail) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const result = await dbRun(
    `INSERT INTO users (username, email, password_hash, role, email_verified)
     VALUES (?, ?, ?, 'user', 0)`,
    [username.toLowerCase(), email.toLowerCase(), passwordHash]
  );

  const userId = result.lastID;

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [userId]);
  await dbRun(
    `INSERT INTO email_verifications (user_id, code_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, otpHash, expiresAt]
  );

  try {
    await sendVerificationEmail(email, username, otp);
  } catch (err) {
    console.error("Email send failed:", err);
    return NextResponse.json(
      {
        error:
          "Account created but we could not send the verification email. " +
          "Check your SMTP configuration in .env.local.",
      },
      { status: 500 }
    );
  }

  await logSystemEvent({
    level: "info",
    category: "auth",
    message: `New account registered: "${username}" (${email}) from IP ${ip}`,
    userId,
    ipAddress: ip,
  });

  return NextResponse.json(
    { message: "Account created. Check your email for the verification code.", userId },
    { status: 201 }
  );
}
