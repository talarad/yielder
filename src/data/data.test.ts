import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import initSqlJs, { type SqlJsStatic } from 'sql.js';

import { AppError } from '../../shared/errors';
import { Repo } from './repo';
import { emptyDataFile, openDataFile, Sqlite } from './sqlite';

let SQL: SqlJsStatic;

before(async () => {
  SQL = await initSqlJs();
});

const fundInput = { name: 'Pension', type: 'pension_comprehensive' as const, provider: '', track: '', status: 'active' as const, notes: '' };

describe('data file', () => {
  it('keeps funds and months through save and reopen', () => {
    const db = emptyDataFile(SQL);
    const repo = new Repo(db);
    const fund = repo.createFund(fundInput);

    repo.upsertEntry(fund.id, { month: '2024-01', balance: 1000, deposit: 0, withdrawal: 0, comment: '' });
    repo.upsertEntry(fund.id, { month: '2024-02', balance: 1600, deposit: 500, withdrawal: 0, comment: 'bonus' });
    repo.setMeta('display_name', 'Tal');

    const { db: reopened, converted } = openDataFile(SQL, db.export());
    const again = new Repo(reopened);

    assert.equal(converted, false);
    assert.equal(again.getMeta('display_name'), 'Tal');
    assert.deepEqual(
      again.fundsWithEntries().map(f => [f.fund.name, f.entries.map(e => [e.month, e.balance, e.deposit, e.comment])]),
      [['Pension', [['2024-01', 1000, 0, ''], ['2024-02', 1600, 500, 'bonus']]]],
    );
  });

  it('deletes a fund with its months, also after saving (which reopens the database)', () => {
    const db = emptyDataFile(SQL);
    const repo = new Repo(db);
    const fund = repo.createFund(fundInput);

    repo.upsertEntry(fund.id, { month: '2024-01', balance: 1000, deposit: 0, withdrawal: 0, comment: '' });
    db.export();
    repo.deleteFund(fund.id);

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get()!.n, 0);
  });

  it('rolls back a change that fails halfway', () => {
    const db = emptyDataFile(SQL);
    const repo = new Repo(db);

    assert.throws(() =>
      db.transaction(() => {
        repo.createFund(fundInput);
        throw new Error('stop');
      }),
    );
    assert.equal(repo.listFunds().length, 0);
  });

  it('converts the old server database, keeping the person with the most months', () => {
    const old = new Sqlite(new SQL.Database());

    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT, share_anonymously INTEGER, created_at TEXT);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER);
      CREATE TABLE funds (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, type TEXT, provider TEXT, track TEXT, status TEXT, notes TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE entries (fund_id INTEGER, month TEXT, balance REAL, deposit REAL, withdrawal REAL, comment TEXT, PRIMARY KEY (fund_id, month));
      CREATE TABLE benchmarks (id INTEGER PRIMARY KEY, provider TEXT);
      INSERT INTO users VALUES (1, 'demo', 'Demo', 'x', 1, ''), (5, 'tal', 'Tal', 'y', 1, '');
      INSERT INTO funds VALUES (1, 1, 'Demo fund', 'savings', '', '', 'active', '', '2024', '2024');
      INSERT INTO funds VALUES (7, 5, 'Pension', 'pension_comprehensive', 'Meitav', '', 'active', 'n', '2023', '2024');
      INSERT INTO funds VALUES (9, 5, 'Education', 'education_fund', '', '', 'closed', '', '2023', '2024');
      INSERT INTO entries VALUES (1, '2024-01', 5, 0, 0, '');
      INSERT INTO entries VALUES (7, '2024-01', 100, 0, 0, ''), (7, '2024-02', 110, 5, 0, 'x'), (9, '2024-01', 50, 0, 0, '');
    `);

    const { db, converted } = openDataFile(SQL, old.export());
    const repo = new Repo(db);

    assert.equal(converted, true);
    assert.equal(repo.getMeta('display_name'), 'Tal');
    assert.deepEqual(
      repo.fundsWithEntries().map(f => [f.fund.id, f.fund.name, f.fund.provider, f.fund.status, f.entries.length]),
      [
        [7, 'Pension', 'Meitav', 'active', 2],
        [9, 'Education', '', 'closed', 1],
      ],
    );
    assert.equal(repo.entriesOf(7)[1].comment, 'x');
    // Nothing of the server's tables comes along.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('users', 'sessions', 'benchmarks')").get()!.n, 0);
  });

  it('refuses files that are not Yielder data', () => {
    const other = new Sqlite(new SQL.Database());

    other.exec('CREATE TABLE notes (id INTEGER)');

    for (const bytes of [new TextEncoder().encode('not a database at all, just text'), other.export()]) {
      assert.throws(
        () => openDataFile(SQL, bytes),
        (err: unknown) => err instanceof AppError && err.code === 'bad_data_file',
      );
    }
  });
});
