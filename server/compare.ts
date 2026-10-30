// Comparison: each of your funds against the market (real funds of managing companies, same
// product type, same months) and, when other users share anonymously, against them.
//
// Everyone is measured over the same window. The portfolio ends at your latest month, each fund
// and each product type of the market table at the latest month your funds of it have; if the
// market data or other users don't have that month yet, it steps back up to two months to the
// latest month they do have.

import { addMonths } from '../shared/months';
import type { BenchmarkReturn, CompareResult, Entry, FundComparison, FundType, Period } from '../shared/types';
import { chainReturns, computeYield, fundTrack, peerStats, periodStart, portfolioAsOf, portfolioTrack, type Track } from './lib/yields';
import { fundsWithEntries, lastBenchmarkMonth, listBenchmarks, peerFunds, type BenchmarkWithReturns } from './repo';

const FALLBACK_MONTHS = 2;

/** `latest`, then up to FALLBACK_MONTHS earlier: the months a comparison may end at. */
const recentMonths = (latest: string) => Array.from({ length: FALLBACK_MONTHS + 1 }, (_, k) => addMonths(latest, -k));

const lastMonth = (entries: Entry[]) => entries[entries.length - 1]?.month ?? null;

function benchmarkReturn(b: BenchmarkWithReturns, from: string | null, to: string | null): BenchmarkReturn {
  const { returns, ...meta } = b;

  return { ...meta, return: from && to ? chainReturns(returns, from, to) : null };
}

const byReturn = (a: BenchmarkReturn, b: BenchmarkReturn) => (b.return ?? -Infinity) - (a.return ?? -Infinity);

export function compareUser(userId: number, period: Period): CompareResult {
  const mine = fundsWithEntries(userId);
  const peers = peerFunds(userId);
  const benchmarks = listBenchmarks();
  const marketThrough = lastBenchmarkMonth();
  const myTracked = mine.map(m => ({ status: m.fund.status, entries: m.entries }));
  const asOf = portfolioAsOf(myTracked);

  // Other users, grouped per person (never identified)
  const peerUsers = new Map<number, typeof myTracked>();

  for (const p of peers) {
    const list = peerUsers.get(p.userId) ?? [];

    list.push({ status: p.fund.status, entries: p.entries });
    peerUsers.set(p.userId, list);
  }

  const users = [...peerUsers.values()];
  const peerTracks = peers.map(p => ({ type: p.fund.type, t: fundTrack(p.entries) }));

  // The market and other users are each compared at the latest month *they* have (up to two
  // months before yours), so one being ahead of the other never empties the comparison.
  const marketAt = asOf ? (recentMonths(asOf).find(m => marketThrough !== null && marketThrough >= m) ?? asOf) : null;
  const peopleAt = asOf ? (recentMonths(asOf).find(m => users.some(funds => (portfolioAsOf(funds) ?? '') >= m)) ?? asOf) : null;

  // Portfolio vs. other people's portfolios
  const peerPortfolioReturns: number[] = [];
  let myPortfolioReturn: number | null = null;

  if (peopleAt) {
    myPortfolioReturn = computeYield(portfolioTrack(myTracked, peopleAt), period, peopleAt).return;

    for (const funds of users) {
      if ((portfolioAsOf(funds) ?? '') >= peopleAt) {
        const r = computeYield(portfolioTrack(funds, peopleAt), period, peopleAt).return;

        if (r !== null) {
          peerPortfolioReturns.push(r);
        }
      }
    }
  }

  // Each fund: its own latest month (stepping back if nobody else has it yet), same window for all.
  const funds: FundComparison[] = mine.map(({ fund, entries }) => {
    const own: Track = fundTrack(entries);
    const sameTypeBench = benchmarks.filter(b => b.type === fund.type);
    const sameTypePeers = peerTracks.filter(p => p.type === fund.type);
    const latest = lastMonth(entries);
    const endWhere = (has: (m: string) => boolean) => (latest ? (recentMonths(latest).find(m => own.balances.has(m) && has(m)) ?? latest) : null);
    const marketEnd = endWhere(m => sameTypeBench.some(b => b.returns.has(m)));
    const peopleEnd = endWhere(m => sameTypePeers.some(p => computeYield(p.t, period, m).return !== null));
    const y = computeYield(own, period, marketEnd);
    const bench = sameTypeBench.map(b => benchmarkReturn(b, y.startMonth, y.endMonth)).sort(byReturn);
    const peopleReturns = sameTypePeers.map(p => computeYield(p.t, period, peopleEnd).return).filter((r): r is number => r !== null);

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
      people: peerStats(peopleReturns, computeYield(own, period, peopleEnd).return),
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

  return {
    period,
    asOf: marketAt,
    hasPeople: users.length > 0,
    portfolio: peerStats(peerPortfolioReturns, myPortfolioReturn),
    funds,
    market,
    marketWindows,
    yours,
    marketThrough,
  };
}
