// Refreshes the market data (public/benchmarks.json) from the Capital Market Authority's open data
// on data.gov.il (datasets "gemelnet" and "pensia-net"; field MONTHLY_YIELD = nominal monthly
// return, gross of fees, in percent).
//
// Re-reads the last 6 months of every fund, so the regulator's revisions are picked up, and adds
// the new month. Resources are discovered through package_show every time, because the regulator
// splits the data into new files over time. The monthly GitHub job (.github/workflows) runs this
// and commits the file when it changed.
//   npm run benchmarks:sync

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { benchmarkFileSchema } from '../shared/benchmarkFile';
import { addMonths, currentMonth } from '../shared/months';
import type { FundType } from '../shared/types';

const FILE = resolve('public/benchmarks.json');
const API = 'https://data.gov.il/api/3/action';
const PACKAGES: Array<{ id: string; types: FundType[] }> = [
  { id: 'pensia-net', types: ['pension_comprehensive', 'pension_supplementary'] },
  { id: 'gemelnet', types: ['education_fund', 'provident_fund', 'investment_provident_fund'] },
];
const MONTHS_BACK = 6;

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

/** Recent monthly returns per regulator fund id. */
async function fetchRecent(ids: Map<FundType, string[]>, now: Date): Promise<Map<string, Map<string, number>>> {
  const periods = Array.from({ length: MONTHS_BACK }, (_, k) => Number(addMonths(currentMonth(now), -(k + 1)).replace('-', '')));
  const found = new Map<string, Map<string, number>>();

  for (const pkg of PACKAGES) {
    const fundIds = pkg.types.flatMap(t => ids.get(t) ?? []).map(Number);

    if (fundIds.length === 0) {
      continue;
    }

    const { resources } = await api<{ resources: Array<{ id: string; datastore_active: boolean }> }>(`package_show?id=${pkg.id}`);
    let answered = 0;

    // A package also holds non-data resources (e.g. format-change notes) that reject fund filters;
    // skip those, but fail if no resource of the package answered at all.
    for (const r of resources.filter(x => x.datastore_active)) {
      const filters = encodeURIComponent(JSON.stringify({ FUND_ID: fundIds, REPORT_PERIOD: periods }));
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
        // Percent to a fraction, rounded: 6.14 / 100 is 0.061399999999999996 in floating point, which
        // would look like a revision of the stored 0.0614 every month.
        const ret = row.MONTHLY_YIELD === null || row.MONTHLY_YIELD === undefined ? null : Math.round(Number(row.MONTHLY_YIELD) * 1e6) / 1e8;

        // Anything beyond ±50% in a month is a unit or data error.
        if (ret === null || Math.abs(ret) > 0.5) {
          continue;
        }

        const p = String(row.REPORT_PERIOD);
        const months = found.get(String(row.FUND_ID)) ?? new Map<string, number>();

        months.set(`${p.slice(0, 4)}-${p.slice(4, 6)}`, ret);
        found.set(String(row.FUND_ID), months);
      }
    }

    if (answered === 0) {
      throw new Error(`no data resource of ${pkg.id} answered`);
    }
  }

  return found;
}

async function main() {
  // The raw file keeps fields the app doesn't read (sources, notes); only `returns` is changed.
  const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Array<{ fundId: string | number; returns: Array<{ month: string; return: number }> }>;
  const file = benchmarkFileSchema.parse(raw);
  const ids = new Map<FundType, string[]>();

  file.filter(b => /^\d+$/.test(b.fundId)).forEach(b => ids.set(b.fundType, [...(ids.get(b.fundType) ?? []), b.fundId]));

  const recent = await fetchRecent(ids, new Date());
  let added = 0;
  let revised = 0;
  let latest = '';

  raw.forEach((series, i) => {
    const months = recent.get(file[i].fundId);

    if (!months) {
      return;
    }

    const byMonth = new Map(series.returns.map(r => [r.month, r.return]));

    for (const [month, ret] of months) {
      if (!byMonth.has(month)) {
        added++;
      } else if (byMonth.get(month) !== ret) {
        revised++;
      }

      byMonth.set(month, ret);
      latest = month > latest ? month : latest;
    }

    series.returns = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, return: r }));
  });

  // Validate what's about to be written, so a bad answer never reaches the app.
  benchmarkFileSchema.parse(raw);

  if (added || revised) {
    writeFileSync(FILE, `${JSON.stringify(raw, null, 2)}\n`);
  }

  console.log(`${file.length} funds checked: ${added} new months, ${revised} revised, latest ${latest || 'none'}.`);
}

main().catch(err => {
  console.error('Market data refresh failed:', err);
  process.exitCode = 1;
});
