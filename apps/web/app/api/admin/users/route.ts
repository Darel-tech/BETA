import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/middleware";
import { dbAll, dbRun } from "@/lib/db";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const users = await dbAll(
    `SELECT id, username, email, role, email_verified, is_active, created_at
     FROM users ORDER BY created_at DESC`
  );

  return NextResponse.json({ users });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: { userId?: number; field?: "is_active" | "role"; value?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, field, value } = body;

  if (!userId || !field) {
    return NextResponse.json({ error: "Missing userId or field" }, { status: 400 });
  }

  if (field === "role" && !["user", "admin"].includes(String(value))) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (field === "is_active" && ![0, 1].includes(Number(value))) {
    return NextResponse.json({ error: "Invalid is_active value" }, { status: 400 });
  }

  if (field === "role" && String(userId) === auth.sub) {
    return NextResponse.json({ error: "Cannot change your own role." }, { status: 403 });
  }

  await dbRun(`UPDATE users SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`, [value, userId]);

  return NextResponse.json({ message: "Updated successfully." });
}
