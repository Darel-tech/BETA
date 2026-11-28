/**
 * Email delivery for BETA auth system.
 * Uses Nodemailer with SMTP or Gmail.
 * Configure via environment variables.
 */

import nodemailer from "nodemailer";

function createTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);

  if (!user || !pass) {
    throw new Error(
      "Email not configured. Set SMTP_USER and SMTP_PASS in your .env.local file."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM = process.env.SMTP_FROM ?? `"BETA" <noreply@beta.app>`;
const APP_NAME = "BETA";
const BRAND_COLOR = "#2F6BFF";

// ── Email templates ───────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; background: #EEF2FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrap { max-width: 520px; margin: 40px auto; }
    .card { background: #fff; border-radius: 20px; padding: 40px 36px; box-shadow: 0 10px 30px rgba(20,40,100,.10); }
    .logo { text-align: center; margin-bottom: 28px; }
    .logo-icon { display: inline-block; width: 56px; height: 56px; background: linear-gradient(135deg,#5B8CFF,#1E4FD8); border-radius: 16px; }
    .logo-text { font-size: 22px; font-weight: 800; color: ${BRAND_COLOR}; letter-spacing: 3px; margin-top: 10px; }
    h1 { font-size: 22px; font-weight: 700; color: #0F1B3D; text-align: center; margin: 0 0 8px; }
    p { font-size: 14px; color: #5B6890; line-height: 1.6; margin: 0 0 20px; text-align: center; }
    .otp { font-size: 36px; font-weight: 800; letter-spacing: 10px; color: ${BRAND_COLOR}; text-align: center;
           background: #EEF2FB; border-radius: 12px; padding: 18px 24px; margin: 24px 0; }
    .btn { display: block; background: linear-gradient(135deg,#5B8CFF,#1E4FD8); color: #fff;
           text-decoration: none; text-align: center; padding: 14px 28px; border-radius: 999px;
           font-size: 15px; font-weight: 600; margin: 24px auto; max-width: 220px; }
    .note { font-size: 12px; color: #9AA8D0; text-align: center; margin-top: 24px; }
    .footer { text-align: center; font-size: 11px; color: #9AA8D0; margin-top: 24px; }
    hr { border: none; border-top: 1px solid #E8EDF5; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo">
        <div class="logo-icon"></div>
        <div class="logo-text">${APP_NAME}</div>
      </div>
      ${content}
    </div>
    <div class="footer">© ${new Date().getFullYear()} ${APP_NAME} · AI Hallucination Firewall<br/>
    You received this because you registered or requested a password reset.</div>
  </div>
</body>
</html>`;
}

export async function sendVerificationEmail(
  to: string,
  username: string,
  otp: string
): Promise<void> {
  const transport = createTransport();
  const html = baseTemplate(`
    <h1>Verify your email</h1>
    <p>Hi <strong>${username}</strong>, thanks for signing up!<br/>
    Enter the code below to verify your email address. It expires in <strong>15 minutes</strong>.</p>
    <div class="otp">${otp}</div>
    <p class="note">If you didn't create an account, you can safely ignore this email.</p>
    <hr/>
    <p style="font-size:12px">Never share this code with anyone. ${APP_NAME} will never ask for it.</p>
  `);

  await transport.sendMail({
    from: FROM,
    to,
    subject: `${otp} is your ${APP_NAME} verification code`,
    html,
    text: `Your ${APP_NAME} verification code is: ${otp}\n\nExpires in 15 minutes. Do not share this code.`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  username: string,
  otp: string
): Promise<void> {
  const transport = createTransport();
  const html = baseTemplate(`
    <h1>Reset your password</h1>
    <p>Hi <strong>${username}</strong>, we received a request to reset your password.<br/>
    Enter the code below on the reset page. It expires in <strong>15 minutes</strong>.</p>
    <div class="otp">${otp}</div>
    <p class="note">If you didn't request a password reset, you can safely ignore this email.<br/>
    Your password will not change.</p>
    <hr/>
    <p style="font-size:12px">Never share this code with anyone.</p>
  `);

  await transport.sendMail({
    from: FROM,
    to,
    subject: `${otp} is your ${APP_NAME} password reset code`,
    html,
    text: `Your ${APP_NAME} password reset code is: ${otp}\n\nExpires in 15 minutes. Do not share this code.`,
  });
}
