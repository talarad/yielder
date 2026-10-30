// Monthly refresh of market data from the Capital Market Authority's open data on data.gov.il
// (datasets "gemelnet" and "pensia-net"; field MONTHLY_YIELD = nominal monthly return, gross of
// fees, in percent).
//
// Runs on SYNC_DAY of every month (default the 20th, when the previous month is published) and on
// any later day if that run hasn't succeeded yet (server was down, network failed). Each run
// re-reads the last 6 months so the regulator's revisions are picked up. Resources are discovered
// through package_show every time, because the regulator splits the data into new files over time.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { addMonths, currentMonth } from '../shared/months';
import type { FundType } from '../shared/types';
import { benchmarkFileSchema, saveBenchmarks } from './benchmarks';
import { transaction } from './db';
import { countBenchmarks, listBenchmarks, recordSync, saveBenchmarkReturns, syncedFor } from './repo';

const API = 'https://data.gov.il/api/3/action';
const PACKAGES: Array<{ id: string; types: FundType[] }> = [
  { id: 'pensia-net', types: ['pension_comprehensive', 'pension_supplementary'] },
  { id: 'gemelnet', types: ['education_fund', 'provident_fund', 'investment_provident_fund'] },
];
const MONTHS_BACK = 6;
const HOUR = 60 * 60 * 1000;

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`data.gov.il ${res.status} for ${path.split('?')[0]}`);
  }

  const body = (await res.json()) as { success: boolean; result: T };

  if (!body.success) {
    throw new Error(`data.gov.il refused ${path.split('?')[0]}`);
  }

  return body.result;
}

interface Row {
  FUND_ID: number;
  REPORT_PERIOD: number;
  MONTHLY_YIELD: number | null;
}

/** Fetches recent months for every benchmark and saves them. Returns a one-line summary. */
export async function syncBenchmarks(now = new Date()): Promise<string> {
  const benchmarks = listBenchmarks().filter(b => /^\d+$/.test(b.fundCode));
  const periods = Array.from({ length: MONTHS_BACK }, (_, k) => Number(addMonths(currentMonth(now), -(k + 1)).replace('-', '')));
  const found = new Map<string, Array<{ month: string; return: number }>>();

  for (const pkg of PACKAGES) {
    const ids = benchmarks.filter(b => pkg.types.includes(b.type)).map(b => Number(b.fundCode));

    if (ids.length === 0) {
      continue;
    }

    const { resources } = await api<{ resources: Array<{ id: string; datastore_active: boolean }> }>(`package_show?id=${pkg.id}`);
    let answered = 0;

    // A package also holds non-data resources (e.g. format-change notes) that reject fund filters;
    // skip those, but fail if no resource of the package answered at all.
    for (const r of resources.filter(x => x.datastore_active)) {
      const filters = encodeURIComponent(JSON.stringify({ FUND_ID: ids, REPORT_PERIOD: periods }));
      let records: Row[];

      try {
        ({ records } = await api<{ records: Row[] }>(
          `datastore_search?resource_id=${r.id}&filters=${filters}&fields=FUND_ID,REPORT_PERIOD,MONTHLY_YIELD&limit=5000`,
        ));
        answered++;
      } catch {
        continue;
      }

      for (const row of records) {
        if (row.MONTHLY_YIELD === null || row.MONTHLY_YIELD === undefined) {
          continue;
        }

        const p = String(row.REPORT_PERIOD);
        const list = found.get(String(row.FUND_ID)) ?? [];

        list.push({ month: `${p.slice(0, 4)}-${p.slice(4, 6)}`, return: Number(row.MONTHLY_YIELD) / 100 });
        found.set(String(row.FUND_ID), list);
      }
    }

    if (answered === 0) {
      throw new Error(`no data resource of ${pkg.id} answered`);
    }
  }

  let added = 0;
  let latest = '';

  transaction(() => {
    for (const b of benchmarks) {
      const rows = (found.get(b.fundCode) ?? []).filter(r => Math.abs(r.return) <= 0.5);

      added += saveBenchmarkReturns(b.id, rows);
      rows.forEach(r => (latest = r.month > latest ? r.month : latest));
    }
  });

  return `${benchmarks.length} funds checked, ${added} new months, latest ${latest || 'none'}`;
}

/** First start: seed from the bundled file so comparisons work before the first refresh. */
export function seedBenchmarksIfEmpty() {
  const file = resolve('server/data/benchmarks.json');

  if (countBenchmarks() === 0 && existsSync(file)) {
    const { series, monthsAdded } = saveBenchmarks(benchmarkFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));

    console.log(`Market data: loaded ${series} funds (${monthsAdded} months) from ${file}`);
  }
}

let running = false;

async function tick(day: number) {
  const now = new Date();
  // From the sync day on, this month's refresh must have run; before it, last month's (catch-up).
  const due = now.getDate() >= day ? currentMonth(now) : addMonths(currentMonth(now), -1);

  if (running || syncedFor(due)) {
    return;
  }

  running = true;

  try {
    const detail = await syncBenchmarks(now);

    recordSync(due, true, detail);
    console.log(`Market data refreshed (${due}): ${detail}`);
  } catch (err) {
    recordSync(due, false, String(err));
    console.warn(`Market data refresh failed (${due}), will retry within the hour:`, String(err));
  } finally {
    running = false;
  }
}

/** Starts the monthly refresh. Disable with YIELDER_SYNC=off; change the day with YIELDER_SYNC_DAY. */
export function startBenchmarkSchedule() {
  seedBenchmarksIfEmpty();

  if (process.env.YIELDER_SYNC === 'off') {
    return;
  }

  const day = Math.min(28, Math.max(1, Number(process.env.YIELDER_SYNC_DAY ?? 20)));

  setTimeout(() => void tick(day), 15_000).unref();
  setInterval(() => void tick(day), HOUR).unref();
}
