// The data file: one person's SQLite database, opened in the browser with sql.js.
//
// Sqlite wraps sql.js in the same prepare().all/get/run shape as node:sqlite, so the data code
// reads like the server code it came from. openDataFile() accepts a file in this format, or the
// old multi-user server database, which it converts.

import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

import { AppError } from '../../shared/errors';

export type Row = Record<string, SqlValue>;

export const FILE_FORMAT = 'yielder-personal';
export const FILE_VERSION = '1';

export class Sqlite {
  constructor(readonly raw: Database) {
    this.exec('PRAGMA foreign_keys = ON');
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    const raw = this.raw;
    const all = (...params: SqlValue[]): Row[] => {
      const st = raw.prepare(sql);

      try {
        st.bind(params);

        const rows: Row[] = [];

        while (st.step()) {
          rows.push(st.getAsObject());
        }

        return rows;
      } finally {
        st.free();
      }
    };

    return {
      all,
      get: (...params: SqlValue[]): Row | undefined => all(...params)[0],
      run: (...params: SqlValue[]) => {
        raw.run(sql, params);

        return { changes: raw.getRowsModified(), lastInsertRowid: Number(raw.exec('SELECT last_insert_rowid()')[0].values[0][0]) };
      },
    };
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN');

    try {
      const result = fn();

      this.exec('COMMIT');

      return result;
    } catch (err) {
      this.exec('ROLLBACK');
      throw err;
    }
  }

  /** The whole file, ready to save. */
  export(): Uint8Array {
    const bytes = this.raw.export();

    // export() reopens the database, which resets pragmas.
    this.exec('PRAGMA foreign_keys = ON');

    return bytes;
  }

  close() {
    this.raw.close();
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    track TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
`;

function createSchema(db: Sqlite) {
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('format', FILE_FORMAT);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('version', FILE_VERSION);
}

const tablesOf = (db: Sqlite) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => String(r.name)));

/** A new, empty data file. */
export function emptyDataFile(SQL: SqlJsStatic): Sqlite {
  const db = new Sqlite(new SQL.Database());

  createSchema(db);

  return db;
}

/**
 * Opens a data file's bytes. The old server database (with users, sessions and market data) is
 * converted: the person with the most recorded months is kept, everything else is dropped.
 */
export function openDataFile(SQL: SqlJsStatic, bytes: Uint8Array): { db: Sqlite; converted: boolean } {
  let file: Sqlite;
  let tables: Set<string>;

  try {
    file = new Sqlite(new SQL.Database(bytes));
    tables = tablesOf(file);
  } catch {
    throw new AppError('This is not a database file.', 'bad_data_file');
  }

  if (tables.has('users') && tables.has('funds') && tables.has('entries')) {
    const db = fromServerDatabase(SQL, file);

    file.close();

    return { db, converted: true };
  }

  const format = tables.has('meta') ? file.prepare("SELECT value FROM meta WHERE key = 'format'").get()?.value : undefined;

  if (format !== FILE_FORMAT) {
    file.close();
    throw new AppError('This file is not Yielder data.', 'bad_data_file');
  }

  createSchema(file);

  return { db: file, converted: false };
}

function fromServerDatabase(SQL: SqlJsStatic, old: Sqlite): Sqlite {
  const db = emptyDataFile(SQL);
  const owner = old
    .prepare(
      `SELECT u.id, u.display_name FROM users u
       JOIN funds f ON f.user_id = u.id JOIN entries e ON e.fund_id = f.id
       GROUP BY u.id ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .get();

  if (!owner) {
    return db;
  }

  db.transaction(() => {
    const addFund = db.prepare(
      'INSERT INTO funds (id, name, type, provider, track, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const addEntry = db.prepare('INSERT INTO entries (fund_id, month, balance, deposit, withdrawal, comment) VALUES (?, ?, ?, ?, ?, ?)');

    for (const f of old.prepare('SELECT * FROM funds WHERE user_id = ? ORDER BY id').all(owner.id)) {
      addFund.run(f.id, f.name, f.type, f.provider, f.track, f.status, f.notes, f.created_at, f.updated_at);

      for (const e of old.prepare('SELECT * FROM entries WHERE fund_id = ? ORDER BY month').all(f.id)) {
        addEntry.run(e.fund_id, e.month, e.balance, e.deposit, e.withdrawal, e.comment);
      }
    }

    if (owner.display_name) {
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('display_name', owner.display_name);
    }
  });

  return db;
}
