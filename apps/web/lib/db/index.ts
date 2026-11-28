/**
 * Database singleton for BETA auth system.
 * Uses sqlite3 with a clean Promise-based helper layer.
 */

import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "beta_auth.db");
const SCHEMA_PATH = path.join(process.cwd(), "lib/db/schema.sql");

let _db: sqlite3.Database | null = null;
let _initPromise: Promise<sqlite3.Database> | null = null;

export function getRawDb(): Promise<sqlite3.Database> {
  if (_db) return Promise.resolve(_db);
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;", (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);

        const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
        db.exec(schema, (schemaErr) => {
          if (schemaErr) return reject(schemaErr);
          _db = db;
          resolve(db);
        });
      });
    });
  });

  return _initPromise;
}

export async function dbGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const db = await getRawDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
}

export async function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getRawDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []) as T[]);
    });
  });
}

export async function dbRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  const db = await getRawDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export default { getRawDb, dbGet, dbAll, dbRun };
