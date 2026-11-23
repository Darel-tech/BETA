import bcrypt from "bcryptjs";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const DB_PATH = process.env.DB_PATH ?? path.join(root, "beta_auth.db");
const SCHEMA_PATH = path.join(root, "lib/db/schema.sql");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@beta.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPass123!";

const db = new sqlite3.Database(DB_PATH, async (err) => {
  if (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }

  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema, async (schemaErr) => {
    if (schemaErr) {
      console.error("Schema error:", schemaErr);
      process.exit(1);
    }

    db.get(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE",
      [ADMIN_USERNAME, ADMIN_EMAIL],
      async (getErr, row) => {
        if (row) {
          console.log(`ℹ️ Admin user already exists (username="${ADMIN_USERNAME}"). Skipping.`);
          db.close();
          process.exit(0);
        }

        const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
        db.run(
          `INSERT INTO users (username, email, password_hash, role, email_verified, is_active)
           VALUES (?, ?, ?, 'admin', 1, 1)`,
          [ADMIN_USERNAME.toLowerCase(), ADMIN_EMAIL.toLowerCase(), hash],
          (insertErr) => {
            if (insertErr) {
              console.error("Insert error:", insertErr);
              process.exit(1);
            }
            console.log(`✅ Admin user created:
   Username : ${ADMIN_USERNAME}
   Email    : ${ADMIN_EMAIL}
   Password : ${ADMIN_PASSWORD}
   Role     : admin
   Database : ${DB_PATH}`);
            db.close();
            process.exit(0);
          }
        );
      }
    );
  });
});
