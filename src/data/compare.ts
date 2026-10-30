// Comparison: each of your funds against the market (real funds of the managing companies, same
// product type, same months).
//
// Everyone is measured over the same window. Each fund, and each product type of the market
// table, ends at the latest month your funds of it have; if the market data doesn't have that
// month yet, it steps back up to two months to the latest month it does have.

import { addMonths } from '../../shared/months';
import type { BenchmarkReturn, CompareResult, Entry, Fund, FundComparison, FundType, Period } from '../../shared/types';
import { chainReturns, computeYield, fundTrack, peerStats, periodStart, portfolioAsOf, type Track } from '../../shared/yields';
import type { BenchmarkWithReturns } from './benchmarks';

const FALLBACK_MONTHS = 2;

/** `latest`, then up to FALLBACK_MONTHS earlier: the months a comparison may end at. */
const recentMonths = (latest: string) => Array.from({ length: FALLBACK_MONTHS + 1 }, (_, k) => addMonths(latest, -k));

const lastMonth = (entries: Entry[]) => entries[entries.length - 1]?.month ?? null;

function benchmarkReturn(b: BenchmarkWithReturns, from: string | null, to: string | null): BenchmarkReturn {
  const { returns, fundCode: _code, ...meta } = b;

  return { ...meta, return: from && to ? chainReturns(returns, from, to) : null };
}

const byReturn = (a: BenchmarkReturn, b: BenchmarkReturn) => (b.return ?? -Infinity) - (a.return ?? -Infinity);

export function compareFunds(mine: Array<{ fund: Fund; entries: Entry[] }>, benchmarks: BenchmarkWithReturns[], period: Period): CompareResult {
  const marketThrough = benchmarks.reduce<string | null>((max, b) => {
    const last = [...b.returns.keys()].sort().at(-1) ?? null;

    return last && (!max || last > max) ? last : max;
  }, null);
  const asOf = portfolioAsOf(mine.map(m => ({ status: m.fund.status, entries: m.entries })));
  const marketAt = asOf ? (recentMonths(asOf).find(m => marketThrough !== null && marketThrough >= m) ?? asOf) : null;

  // Each fund: its own latest month (stepping back if the market doesn't have it yet), same window for all.
  const funds: FundComparison[] = mine.map(({ fund, entries }) => {
    const own: Track = fundTrack(entries);
    const sameTypeBench = benchmarks.filter(b => b.type === fund.type);
    const latest = lastMonth(entries);
    const marketEnd = latest ? (recentMonths(latest).find(m => own.balances.has(m) && sameTypeBench.some(b => b.returns.has(m))) ?? latest) : null;
    const y = computeYield(own, period, marketEnd);
    const bench = sameTypeBench.map(b => benchmarkReturn(b, y.startMonth, y.endMonth)).sort(byReturn);

    return {
      fundId: fund.id,
      name: fund.name,
      type: fund.type,
      provider: fund.provider,
      track: fund.track,
      from: y.startMonth,
      to: y.endMonth ?? marketEnd,
      mine: y.return,
      startBalance: y.startBalance,
      endBalance: y.endBalance,
      gain: y.gain,
      deposits: y.deposits,
      withdrawals: y.withdrawals,
      benchmarks: bench,
      market: peerStats(
        bench.map(b => b.return).filter((r): r is number => r !== null),
        y.return,
      ),
    };
  });

  // Market table, per product type: it ends at the last month all your funds of that type are
  // compared at (the market's month for types you don't hold), so each of them has a row in it.
  const first = mine.flatMap(m => m.entries.map(e => e.month)).sort()[0] ?? null;
  const marketWindows = [...new Set(benchmarks.map(b => b.type))].map(type => {
    const ends = funds.filter(f => f.type === type && f.mine !== null).map(f => f.to!).sort();
    const to = ends[0] ?? marketAt;

    return { type, from: to && first ? periodStart(period, to, first) : null, to };
  });
  const windowOf = (type: FundType) => marketWindows.find(w => w.type === type) ?? { from: null, to: marketAt };
  const market = benchmarks.map(b => benchmarkReturn(b, windowOf(b.type).from, windowOf(b.type).to)).sort(byReturn);
  const yours = mine.map(({ fund, entries }) => {
    const { to } = windowOf(fund.type);

    return { fundId: fund.id, name: fund.name, type: fund.type, return: to ? computeYield(fundTrack(entries), period, to).return : null };
  });

  return { period, asOf: marketAt, funds, market, marketWindows, yours, marketThrough };
}
