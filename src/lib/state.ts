// Persistent scrape state (SQLite), so an interrupted run resumes where it
// stopped: each product's status and failed attempts, plus the scraped
// record once done (output.json is rebuilt from it at the end).
// Initialized explicitly via initState(); importing has no side effects.

import fs from "node:fs";
import path from "node:path";
import Sqlite, { type Database } from "better-sqlite3";
import { OUTPUT_DIR } from "../config.js";
import type { Product } from "../types.js";

// Internal state, kept apart from the results.
export const DB_PATH = path.join(OUTPUT_DIR, "state", "scraper.db");

// Bump when the Product record changes: a state saved in an older format is
// dropped instead of mixing old records into the output.
const STATE_VERSION = 2;

type ProductState = { status: "pending" | "done" | "failed"; attempts: number };

let db: Database;

export function initState(dbPath: string = DB_PATH): void {
  // better-sqlite3 refuses to open a database whose folder doesn't exist.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Sqlite(dbPath);
  db.pragma("journal_mode = WAL");
  if (db.pragma("user_version", { simple: true }) !== STATE_VERSION) {
    db.exec("DROP TABLE IF EXISTS products");
    db.pragma(`user_version = ${STATE_VERSION}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    data TEXT
  )`);
}

export const markDone = (product: Product): void => {
  db.prepare(
    `INSERT INTO products (id, status, data) VALUES (?, 'done', ?)
     ON CONFLICT(id) DO UPDATE SET status = 'done', data = excluded.data`,
  ).run(product.sku, JSON.stringify(product));
};

export const markFailed = (sku: string): void => {
  db.prepare(
    `INSERT INTO products (id, status, attempts) VALUES (?, 'failed', 1)
     ON CONFLICT(id) DO UPDATE SET status = 'failed', attempts = attempts + 1`,
  ).run(sku);
};

export const productState = (sku: string): ProductState =>
  (db.prepare("SELECT status, attempts FROM products WHERE id = ?").get(sku) as ProductState | undefined) ?? {
    status: "pending",
    attempts: 0,
  };

export const doneProducts = (): Product[] =>
  (db.prepare("SELECT data FROM products WHERE status = 'done'").all() as { data: string }[]).map((row) =>
    JSON.parse(row.data),
  );

// Checkpoints the WAL and releases the file. Safe to call twice.
export const closeState = (): void => {
  if (db?.open) db.close();
};
