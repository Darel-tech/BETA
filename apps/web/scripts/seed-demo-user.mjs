import bcrypt from "bcryptjs";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "beta_auth.db");

const db = new sqlite3.Database(DB_PATH);

async function createDemoUser() {
  const hash = await bcrypt.hash("UserPass123!", 12);
  db.run(
    `INSERT INTO users (username, email, password_hash, role, email_verified, is_active)
     VALUES (?, ?, ?, 'user', 1, 1)
     ON CONFLICT(username) DO UPDATE SET password_hash = ?, email_verified = 1`,
    ["demouser", "demouser@beta.app", hash, hash],
    (err) => {
      if (err) {
        console.error("Error creating demo user:", err);
      } else {
        console.log("✅ Verified test user ready: demouser / UserPass123!");
      }
      db.close();
    }
  );
}

createDemoUser();
