// Data access. All fund queries are scoped by user id.

import type { Benchmark, Entry, Fund, FundInput, FundStatus, FundType, User } from '../shared/types';
import { db } from './db';

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: Number(r.id),
  username: String(r.username),
  displayName: String(r.display_name),
  shareAnonymously: Number(r.share_anonymously) === 1,
  createdAt: String(r.created_at),
});

const toFund = (r: Row): Fund => ({
  id: Number(r.id),
  name: String(r.name),
  type: r.type as FundType,
  provider: String(r.provider),
  track: String(r.track),
  status: r.status as FundStatus,
  notes: String(r.notes),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toEntry = (r: Row): Entry => ({
  month: String(r.month),
  balance: Number(r.balance),
  deposit: Number(r.deposit),
  withdrawal: Number(r.withdrawal),
  comment: String(r.comment),
});

// Users

export function findUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const r = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Row | undefined;

  return r ? { ...toUser(r), passwordHash: String(r.password_hash) } : null;
}

export function getUser(id: number): User | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;

  return r ? toUser(r) : null;
}

export function getPasswordHash(id: number): string {
  return String((db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as Row).password_hash);
}

export function createUser(username: string, displayName: string, passwordHash: string, share = true): User {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, display_name, password_hash, share_anonymously) VALUES (?, ?, ?, ?)')
    .run(username, displayName, passwordHash, share ? 1 : 0);

  return getUser(Number(lastInsertRowid))!;
}

export function updateUser(id: number, patch: { displayName?: string; shareAnonymously?: boolean }): User {
  if (patch.displayName !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName, id);
  }

  if (patch.shareAnonymously !== undefined) {
    db.prepare('UPDATE users SET share_anonymously = ? WHERE id = ?').run(patch.shareAnonymously ? 1 : 0, id);
  }

  return getUser(id)!;
}

export function setPasswordHash(id: number, hash: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

export function deleteUser(id: number) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// Funds

export function listFunds(userId: number): Fund[] {
  return (db.prepare('SELECT * FROM funds WHERE user_id = ? ORDER BY id').all(userId) as Row[]).map(toFund);
}

export function getFund(userId: number, id: number): Fund | null {
  const r = db.prepare('SELECT * FROM funds WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;

  return r ? toFund(r) : null;
}

export function createFund(userId: number, input: Required<FundInput>): Fund {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO funds (user_id, name, type, provider, track, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, input.name, input.type, input.provider, input.track, input.status, input.notes);

  return getFund(userId, Number(lastInsertRowid))!;
}

export function updateFund(userId: number, id: number, patch: Partial<FundInput>): Fund | null {
  const fields = (['name', 'type', 'provider', 'track', 'status', 'notes'] as const).filter(k => patch[k] !== undefined);

  if (fields.length) {
    db.prepare(
      `UPDATE funds SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    ).run(...fields.map(f => patch[f] as string), id, userId);
  }

  return getFund(userId, id);
}

export function deleteFund(userId: number, id: number): boolean {
  return Number(db.prepare('DELETE FROM funds WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
}

export function touchFund(id: number) {
  db.prepare("UPDATE funds SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
}

// Entries

export function entriesByFund(fundIds: number[]): Map<number, Entry[]> {
  const map = new Map<number, Entry[]>(fundIds.map(id => [id, []]));

  if (fundIds.length === 0) {
    return map;
  }

  const rows = db
    .prepare(`SELECT * FROM entries WHERE fund_id IN (${fundIds.map(() => '?').join(',')}) ORDER BY month`)
    .all(...fundIds) as Row[];

  for (const r of rows) {
    map.get(Number(r.fund_id))!.push(toEntry(r));
  }

  return map;
}

export function fundsWithEntries(userId: number): Array<{ fund: Fund; entries: Entry[] }> {
  const funds = listFunds(userId);
  const entries = entriesByFund(funds.map(f => f.id));

  return funds.map(fund => ({ fund, entries: entries.get(fund.id)! }));
}

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged';

export function upsertEntry(fundId: number, e: Entry): UpsertOutcome {
  const prev = db.prepare('SELECT * FROM entries WHERE fund_id = ? AND month = ?').get(fundId, e.month) as Row | undefined;

  if (prev) {
    const p = toEntry(prev);

    if (p.balance === e.balance && p.deposit === e.deposit && p.withdrawal === e.withdrawal && p.comment === e.comment) {
      return 'unchanged';
    }

    db.prepare('UPDATE entries SET balance = ?, deposit = ?, withdrawal = ?, comment = ? WHERE fund_id = ? AND month = ?').run(
      e.balance,
      e.deposit,
      e.withdrawal,
      e.comment,
      fundId,
      e.month,
    );

    return 'updated';
  }

  db.prepare('INSERT INTO entries (fund_id, month, balance, deposit, withdrawal, comment) VALUES (?, ?, ?, ?, ?, ?)').run(
    fundId,
    e.month,
    e.balance,
    e.deposit,
    e.withdrawal,
    e.comment,
  );

  return 'inserted';
}

/** Sets deposit and/or withdrawal on every existing month of a fund within [from, to]. Returns rows changed. */
export function setFlowsInRange(fundId: number, from: string, to: string, flows: { deposit?: number; withdrawal?: number }): number {
  let changed = 0;

  if (flows.deposit !== undefined) {
    changed = Number(db.prepare('UPDATE entries SET deposit = ? WHERE fund_id = ? AND month BETWEEN ? AND ?').run(flows.deposit, fundId, from, to).changes);
  }

  if (flows.withdrawal !== undefined) {
    changed = Number(db.prepare('UPDATE entries SET withdrawal = ? WHERE fund_id = ? AND month BETWEEN ? AND ?').run(flows.withdrawal, fundId, from, to).changes);
  }

  return changed;
}

export function deleteEntry(fundId: number, month: string): boolean {
  return Number(db.prepare('DELETE FROM entries WHERE fund_id = ? AND month = ?').run(fundId, month).changes) > 0;
}

/** Funds of every other user who opted in to anonymous comparison. Never exposes who owns them. */
export function peerFunds(excludeUserId: number): Array<{ userId: number; fund: Fund; entries: Entry[] }> {
  const rows = db
    .prepare(
      `SELECT f.* FROM funds f JOIN users u ON u.id = f.user_id
       WHERE u.share_anonymously = 1 AND u.id != ?`,
    )
    .all(excludeUserId) as Row[];
  const entries = entriesByFund(rows.map(r => Number(r.id)));

  return rows.map(r => ({ userId: Number(r.user_id), fund: toFund(r), entries: entries.get(Number(r.id))! }));
}

// Benchmarks (market data)

export interface BenchmarkInput {
  provider: string;
  providerHe: string;
  type: FundType;
  track: string;
  trackHe: string;
  fundCode: string;
  fundName: string;
  source: string;
}

export interface BenchmarkWithReturns extends Benchmark {
  /** Official fund id at the regulator (Gemel-Net / Pensya-Net), used by the monthly refresh. */
  fundCode: string;
  returns: Map<string, number>;
}

export function listBenchmarks(): BenchmarkWithReturns[] {
  const rows = db.prepare('SELECT * FROM benchmarks ORDER BY fund_type, provider, track').all() as Row[];
  const byId = new Map<number, BenchmarkWithReturns>(
    rows.map(r => [
      Number(r.id),
      {
        id: Number(r.id),
        provider: String(r.provider),
        providerHe: String(r.provider_he),
        type: r.fund_type as FundType,
        track: String(r.track),
        trackHe: String(r.track_he),
        fundName: String(r.fund_name),
        fundCode: String(r.fund_code),
        returns: new Map(),
      },
    ]),
  );

  for (const r of db.prepare('SELECT benchmark_id, month, ret FROM benchmark_returns').all() as Row[]) {
    byId.get(Number(r.benchmark_id))?.returns.set(String(r.month), Number(r.ret));
  }

  return [...byId.values()];
}

/** Creates or updates a benchmark (keyed by provider + type + track) and upserts its monthly returns. */
export function saveBenchmark(b: BenchmarkInput, returns: Array<{ month: string; return: number }>): { id: number; added: number } {
  db.prepare(
    `INSERT INTO benchmarks (provider, provider_he, fund_type, track, track_he, fund_code, fund_name, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, fund_type, track) DO UPDATE SET
       provider_he = excluded.provider_he, track_he = excluded.track_he, fund_code = excluded.fund_code,
       fund_name = excluded.fund_name, source = excluded.source`,
  ).run(b.provider, b.providerHe, b.type, b.track, b.trackHe, b.fundCode, b.fundName, b.source);

  const id = Number((db.prepare('SELECT id FROM benchmarks WHERE provider = ? AND fund_type = ? AND track = ?').get(b.provider, b.type, b.track) as Row).id);

  return { id, added: saveBenchmarkReturns(id, returns) };
}

/** Upserts monthly returns (revisions overwrite); returns how many months are new. */
export function saveBenchmarkReturns(benchmarkId: number, returns: Array<{ month: string; return: number }>): number {
  const count = () => Number((db.prepare('SELECT COUNT(*) AS n FROM benchmark_returns WHERE benchmark_id = ?').get(benchmarkId) as Row).n);
  const before = count();
  const upsert = db.prepare(
    'INSERT INTO benchmark_returns (benchmark_id, month, ret) VALUES (?, ?, ?) ON CONFLICT (benchmark_id, month) DO UPDATE SET ret = excluded.ret',
  );

  for (const r of returns) {
    upsert.run(benchmarkId, r.month, r.return);
  }

  return count() - before;
}

export function countBenchmarks(): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as Row).n);
}

export function lastBenchmarkMonth(): string | null {
  const r = db.prepare('SELECT MAX(month) AS m FROM benchmark_returns').get() as Row;

  return r.m ? String(r.m) : null;
}

export function recordSync(forMonth: string, ok: boolean, detail: string) {
  db.prepare('INSERT INTO benchmark_syncs (for_month, ok, detail) VALUES (?, ?, ?)').run(forMonth, ok ? 1 : 0, detail.slice(0, 2000));
}

export function syncedFor(forMonth: string): boolean {
  return !!db.prepare('SELECT 1 FROM benchmark_syncs WHERE for_month = ? AND ok = 1').get(forMonth);
}
