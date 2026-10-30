// Data access on the open data file. The file holds one person's data, so nothing is scoped by user.

import type { Entry, Fund, FundInput, FundStatus, FundType } from '../../shared/types';
import type { Row, Sqlite } from './sqlite';

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

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged';

export class Repo {
  constructor(private db: Sqlite) {}

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);

    return r ? String(r.value) : null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  // Funds

  listFunds(): Fund[] {
    return this.db.prepare('SELECT * FROM funds ORDER BY id').all().map(toFund);
  }

  getFund(id: number): Fund | null {
    const r = this.db.prepare('SELECT * FROM funds WHERE id = ?').get(id);

    return r ? toFund(r) : null;
  }

  createFund(input: Required<FundInput>): Fund {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO funds (name, type, provider, track, status, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.name, input.type, input.provider, input.track, input.status, input.notes);

    return this.getFund(lastInsertRowid)!;
  }

  updateFund(id: number, patch: Partial<FundInput>): Fund | null {
    const fields = (['name', 'type', 'provider', 'track', 'status', 'notes'] as const).filter(k => patch[k] !== undefined);

    if (fields.length) {
      this.db
        .prepare(`UPDATE funds SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(...fields.map(f => patch[f] as string), id);
    }

    return this.getFund(id);
  }

  deleteFund(id: number): boolean {
    return this.db.prepare('DELETE FROM funds WHERE id = ?').run(id).changes > 0;
  }

  touchFund(id: number) {
    this.db.prepare("UPDATE funds SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
  }

  // Entries

  entriesOf(fundId: number): Entry[] {
    return this.db.prepare('SELECT * FROM entries WHERE fund_id = ? ORDER BY month').all(fundId).map(toEntry);
  }

  fundsWithEntries(): Array<{ fund: Fund; entries: Entry[] }> {
    const byFund = new Map<number, Entry[]>();

    for (const r of this.db.prepare('SELECT * FROM entries ORDER BY month').all()) {
      const list = byFund.get(Number(r.fund_id)) ?? [];

      list.push(toEntry(r));
      byFund.set(Number(r.fund_id), list);
    }

    return this.listFunds().map(fund => ({ fund, entries: byFund.get(fund.id) ?? [] }));
  }

  upsertEntry(fundId: number, e: Entry): UpsertOutcome {
    const prev = this.db.prepare('SELECT * FROM entries WHERE fund_id = ? AND month = ?').get(fundId, e.month);

    if (prev) {
      const p = toEntry(prev);

      if (p.balance === e.balance && p.deposit === e.deposit && p.withdrawal === e.withdrawal && p.comment === e.comment) {
        return 'unchanged';
      }

      this.db
        .prepare('UPDATE entries SET balance = ?, deposit = ?, withdrawal = ?, comment = ? WHERE fund_id = ? AND month = ?')
        .run(e.balance, e.deposit, e.withdrawal, e.comment, fundId, e.month);

      return 'updated';
    }

    this.db
      .prepare('INSERT INTO entries (fund_id, month, balance, deposit, withdrawal, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fundId, e.month, e.balance, e.deposit, e.withdrawal, e.comment);

    return 'inserted';
  }

  /** Sets deposit and/or withdrawal on every existing month of a fund within [from, to]. Returns rows changed. */
  setFlowsInRange(fundId: number, from: string, to: string, flows: { deposit?: number; withdrawal?: number }): number {
    let changed = 0;

    if (flows.deposit !== undefined) {
      changed = this.db.prepare('UPDATE entries SET deposit = ? WHERE fund_id = ? AND month BETWEEN ? AND ?').run(flows.deposit, fundId, from, to).changes;
    }

    if (flows.withdrawal !== undefined) {
      changed = this.db
        .prepare('UPDATE entries SET withdrawal = ? WHERE fund_id = ? AND month BETWEEN ? AND ?')
        .run(flows.withdrawal, fundId, from, to).changes;
    }

    return changed;
  }

  deleteEntry(fundId: number, month: string): boolean {
    return this.db.prepare('DELETE FROM entries WHERE fund_id = ? AND month = ?').run(fundId, month).changes > 0;
  }
}
