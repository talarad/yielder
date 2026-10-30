import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DB_PATH = resolve(process.env.YIELDER_DB ?? 'data/yielder.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    share_anonymously INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    track TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS funds_by_user ON funds(user_id);

  -- Market benchmarks: real monthly returns of providers' funds (Gemel-Net / Pensya-Net).
  CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_he TEXT NOT NULL DEFAULT '',
    fund_type TEXT NOT NULL,
    track TEXT NOT NULL,
    track_he TEXT NOT NULL DEFAULT '',
    fund_code TEXT NOT NULL DEFAULT '',
    fund_name TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    UNIQUE (provider, fund_type, track)
  );

  CREATE TABLE IF NOT EXISTS benchmark_returns (
    benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    ret REAL NOT NULL,
    PRIMARY KEY (benchmark_id, month)
  );

  -- One row per refresh attempt of the market data.
  CREATE TABLE IF NOT EXISTS benchmark_syncs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    for_month TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 0,
    detail TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS entries (
    fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    balance REAL NOT NULL,
    deposit REAL NOT NULL DEFAULT 0,
    withdrawal REAL NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (fund_id, month)
  );
`);

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');

  try {
    const result = fn();

    db.exec('COMMIT');

    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
