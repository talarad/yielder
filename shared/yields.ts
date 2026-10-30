// Return math. Pure functions, no I/O.
//
// Period returns are money-weighted: the monthly IRR that grows the start balance plus each
// month's net deposit (assumed mid-month) into the end balance, compounded over the window.
// Deposits and withdrawals never count as gains, and the result only depends on the start
// and end balances and the dated cash flows - so a deposit recorded a month before it shows
// up in the balance (common in hand-kept statements) barely moves it. Chaining monthly
// returns (time-weighted) would turn that one-month mismatch into a large, wrong return.
//
// Single-month returns (for the monthly chart) use Modified Dietz:
//   gain = endBalance - startBalance - netFlow,  r = gain / (startBalance + netFlow / 2)

import {
  PERIODS,
  type Allocation,
  type Entry,
  type Fund,
  type FundDetail,
  type FundSummary,
  type FundType,
  type PeerStats,
  type Period,
  type PeriodYield,
  type Portfolio,
  type ReturnPaths,
  type SeriesPoint,
  type YearlyYield,
  type Yields,
} from './types';
import { addMonths, monthFromIndex, monthIndex, monthsBetween, yearOf } from './months';

export interface Step {
  gain: number;
  denom: number;
  /** Net cash flow: deposit - withdrawal. */
  flow: number;
  deposit: number;
  withdrawal: number;
  ret: number | null;
}

/** A balance history: recorded balances, the return steps ending at each month, and opening balances. */
export interface Track {
  months: string[];
  balances: Map<string, number>;
  steps: Map<string, Step>;
  /** Money that entered tracking without a prior balance (a fund's first recorded balance). */
  openings: Map<string, number>;
}

function stepReturn(gain: number, denom: number): number | null {
  if (denom > 0) {
    return gain / denom;
  }

  return gain === 0 ? 0 : null;
}

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.month.localeCompare(b.month));
}

export function fundTrack(entries: Entry[]): Track {
  const sorted = sortEntries(entries);
  const track: Track = { months: [], balances: new Map(), steps: new Map(), openings: new Map() };

  sorted.forEach((cur, i) => {
    track.months.push(cur.month);
    track.balances.set(cur.month, cur.balance);

    if (i === 0) {
      track.openings.set(cur.month, cur.balance);

      return;
    }

    const prev = sorted[i - 1];
    const flow = cur.deposit - cur.withdrawal;
    const gain = cur.balance - prev.balance - flow;
    const denom = prev.balance + flow / 2;

    track.steps.set(cur.month, { gain, denom, flow, deposit: cur.deposit, withdrawal: cur.withdrawal, ret: stepReturn(gain, denom) });
  });

  return track;
}

interface TrackedFund {
  status: Fund['status'];
  entries: Entry[];
}

/**
 * Combines funds into one track. Balances carry forward to `asOf` for funds that aren't closed,
 * so a fund that hasn't been updated this month doesn't look like a withdrawal. The monthly
 * return is the money-weighted sum of each fund's step: Σgain / Σdenom.
 */
export function portfolioTrack(funds: TrackedFund[], asOf: string): Track {
  const track: Track = { months: [], balances: new Map(), steps: new Map(), openings: new Map() };
  const tracks = funds
    .filter(f => f.entries.length > 0)
    .map(f => ({ status: f.status, track: fundTrack(f.entries) }));

  if (tracks.length === 0) {
    return track;
  }

  const first = tracks.reduce((min, t) => (t.track.months[0] < min ? t.track.months[0] : min), asOf);

  for (let i = monthIndex(first); i <= monthIndex(asOf); i++) {
    const month = monthFromIndex(i);
    let balance = 0;
    let gain = 0;
    let denom = 0;
    let flow = 0;
    let deposit = 0;
    let withdrawal = 0;
    let opening = 0;
    let hasStep = false;

    for (const { status, track: t } of tracks) {
      const last = t.months[t.months.length - 1];

      if (month < t.months[0] || (status === 'closed' && month > last)) {
        continue;
      }

      balance += t.balances.get(lastAtOrBefore(t, month)!)!;

      const step = t.steps.get(month);

      if (step) {
        hasStep = true;
        gain += step.gain;
        denom += step.denom;
        flow += step.flow;
        deposit += step.deposit;
        withdrawal += step.withdrawal;
      }

      opening += t.openings.get(month) ?? 0;
    }

    track.months.push(month);
    track.balances.set(month, balance);

    if (hasStep) {
      track.steps.set(month, { gain, denom, flow, deposit, withdrawal, ret: stepReturn(gain, denom) });
    }

    if (opening) {
      track.openings.set(month, opening);
    }
  }

  return track;
}

export function lastAtOrBefore(track: Track, month: string): string | null {
  for (let i = track.months.length - 1; i >= 0; i--) {
    if (track.months[i] <= month) {
      return track.months[i];
    }
  }

  return null;
}

function emptyYield(period: Period): PeriodYield {
  return {
    period,
    return: null,
    annualized: null,
    gain: null,
    netFlow: null,
    deposits: null,
    withdrawals: null,
    startMonth: null,
    endMonth: null,
    startBalance: null,
    endBalance: null,
    months: 0,
    partial: false,
  };
}

interface Flow {
  /** Months after the window start. */
  t: number;
  amount: number;
}

/**
 * Monthly rate r solving  start·(1+r)^n + Σ amount·(1+r)^(n−t) = end  (bisection).
 * Null when there's no sign change in the search range (e.g. contradictory data).
 */
export function monthlyIrr(start: number, flows: Flow[], end: number, n: number): number | null {
  if (start === 0 && flows.every(f => f.amount === 0)) {
    return end === 0 ? 0 : null;
  }

  const f = (r: number) => start * (1 + r) ** n + flows.reduce((s, x) => s + x.amount * (1 + r) ** (n - x.t), 0) - end;
  let lo = -0.95;
  let hi = 1;
  let flo = f(lo);

  if (flo * f(hi) > 0) {
    return null;
  }

  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);

    if (fm * flo <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }

  return (lo + hi) / 2;
}

function windowYield(track: Track, period: Period, base: string, end: string, partial: boolean): PeriodYield {
  const baseIdx = monthIndex(base);
  const n = monthsBetween(base, end);
  const flows: Flow[] = [];
  let deposits = 0;
  let withdrawals = 0;

  for (const month of track.months) {
    if (month <= base || month > end) {
      continue;
    }

    const t = monthIndex(month) - baseIdx;
    const step = track.steps.get(month);
    const opening = track.openings.get(month);

    if (step?.flow) {
      flows.push({ t: t - 0.5, amount: step.flow });
    }

    deposits += step?.deposit ?? 0;
    withdrawals += step?.withdrawal ?? 0;

    // A fund that starts inside the window brings its first balance at the end of that month.
    if (opening) {
      flows.push({ t, amount: opening });
      deposits += opening;
    }
  }

  const startBalance = track.balances.get(base)!;
  const endBalance = track.balances.get(end)!;
  const netFlow = flows.reduce((s, x) => s + x.amount, 0);
  const gain = endBalance - startBalance - netFlow;
  let r = monthlyIrr(startBalance, flows, endBalance, n);
  let ret: number | null;

  if (r !== null) {
    ret = (1 + r) ** n - 1;
  } else {
    // Fall back to Modified Dietz over the whole window.
    const weighted = startBalance + flows.reduce((s, x) => s + (x.amount * (n - x.t)) / n, 0);

    ret = weighted > 0 ? gain / weighted : null;
    r = ret !== null && ret > -1 ? (1 + ret) ** (1 / n) - 1 : null;
  }

  return {
    period,
    return: ret,
    annualized: n > 12 && r !== null ? (1 + r) ** 12 - 1 : null,
    gain,
    netFlow,
    deposits,
    withdrawals,
    startMonth: base,
    endMonth: end,
    startBalance,
    endBalance,
    months: n,
    partial,
  };
}

/**
 * Compounds monthly returns over (from, to]: the months after `from` up to and including `to`.
 * Null when any month is missing, so a benchmark is never compared over a shorter window.
 */
export function chainReturns(returns: Map<string, number>, from: string, to: string): number | null {
  if (from >= to) {
    return null;
  }

  let growth = 1;

  for (let i = monthIndex(from) + 1; i <= monthIndex(to); i++) {
    const r = returns.get(monthFromIndex(i));

    if (r === undefined) {
      return null;
    }

    growth *= 1 + r;
  }

  return growth - 1;
}

export function periodStart(period: Period, end: string, first: string): string {
  switch (period) {
    case '1M':
      return addMonths(end, -1);
    case 'YTD':
      return `${yearOf(end) - 1}-12`;
    case '1Y':
      return addMonths(end, -12);
    case '3Y':
      return addMonths(end, -36);
    case '5Y':
      return addMonths(end, -60);
    case 'ALL':
      return first;
  }
}

/** Return for `period` ending at `end`. Null when there's no balance at `end` or history is too short. */
export function computeYield(track: Track, period: Period, end: string | null): PeriodYield {
  if (!end || !track.balances.has(end) || track.months.length < 2) {
    return emptyYield(period);
  }

  const first = track.months[0];
  let base = lastAtOrBefore(track, periodStart(period, end, first));
  let partial = false;

  if (!base && period === 'YTD' && yearOf(first) === yearOf(end)) {
    base = first;
    partial = true;
  }

  if (!base || base >= end) {
    return emptyYield(period);
  }

  return windowYield(track, period, base, end, partial);
}

export function computeYields(track: Track, end: string | null): Yields {
  return Object.fromEntries(PERIODS.map(p => [p, computeYield(track, p, end)])) as Yields;
}

/**
 * How each period's return built up: the return from the period's start to every recorded month
 * up to its end, measured the same way, so the last point is the period's return.
 */
export function computeReturnPaths(track: Track, yields: Yields): ReturnPaths {
  return Object.fromEntries(
    PERIODS.map(p => {
      const { startMonth: base, endMonth: end } = yields[p];

      if (!base || !end) {
        return [p, []];
      }

      const later = track.months.filter(m => m > base && m <= end);

      return [p, [{ month: base, return: 0 }, ...later.map(m => ({ month: m, return: windowYield(track, p, base, m, false).return }))]];
    }),
  ) as ReturnPaths;
}

export function computeYearly(track: Track, end: string | null): YearlyYield[] {
  if (!end || track.months.length < 2) {
    return [];
  }

  const first = track.months[0];
  const result: YearlyYield[] = [];

  for (let year = yearOf(first); year <= yearOf(end); year++) {
    const yearEnd = lastAtOrBefore(track, `${year}-12` < end ? `${year}-12` : end);

    if (!yearEnd || yearOf(yearEnd) !== year) {
      continue;
    }

    let base = lastAtOrBefore(track, `${year - 1}-12`);
    const partial = !base;

    base ??= first;

    if (base >= yearEnd) {
      continue;
    }

    const w = windowYield(track, 'ALL', base, yearEnd, partial);

    result.push({
      year,
      return: w.return,
      gain: w.gain ?? 0,
      netFlow: w.netFlow ?? 0,
      deposits: w.deposits ?? 0,
      withdrawals: w.withdrawals ?? 0,
      startBalance: w.startBalance ?? 0,
      endBalance: w.endBalance ?? 0,
      partial,
    });
  }

  return result;
}

export function computeSeries(track: Track): SeriesPoint[] {
  let cumulative = 0;

  return track.months.map(month => {
    const step = track.steps.get(month);
    const netFlow = (step?.flow ?? 0) + (track.openings.get(month) ?? 0);

    cumulative += netFlow;

    return {
      month,
      balance: track.balances.get(month) ?? 0,
      netFlow,
      cumulativeFlow: cumulative,
      return: step?.ret ?? null,
      gain: step?.gain ?? null,
    };
  });
}

/** All money that went in (first tracked balances + deposits) and came out, over the whole history. */
function moneyInOut(track: Track): { deposits: number; withdrawals: number } {
  let deposits = 0;
  let withdrawals = 0;

  track.openings.forEach(v => (deposits += v));
  track.steps.forEach(s => {
    deposits += s.deposit;
    withdrawals += s.withdrawal;
  });

  return { deposits, withdrawals };
}

const totals = (track: Track) => {
  const { deposits, withdrawals } = moneyInOut(track);

  return { totalDeposits: deposits, totalWithdrawals: withdrawals };
};

function netInvested(track: Track): number {
  const { deposits, withdrawals } = moneyInOut(track);

  return deposits - withdrawals;
}

export function isStale(fund: Fund, asOf: string | null, today: string): boolean {
  return fund.status === 'active' && asOf !== null && monthsBetween(asOf, today) > 2;
}

export function summarizeFund(fund: Fund, entries: Entry[], today: string): FundSummary {
  const track = fundTrack(entries);
  const asOf = track.months[track.months.length - 1] ?? null;
  const balance = asOf ? track.balances.get(asOf)! : null;
  const netDeposits = netInvested(track);

  return {
    ...fund,
    asOf,
    firstMonth: track.months[0] ?? null,
    balance,
    entryCount: entries.length,
    netDeposits,
    ...totals(track),
    totalGain: balance === null ? 0 : balance - netDeposits,
    stale: isStale(fund, asOf, today),
    yields: computeYields(track, asOf),
  };
}

export function fundDetail(fund: Fund, entries: Entry[], today: string): FundDetail {
  const track = fundTrack(entries);
  const summary = summarizeFund(fund, entries, today);

  return {
    ...summary,
    entries: sortEntries(entries).reverse(),
    series: computeSeries(track),
    yearly: computeYearly(track, summary.asOf),
    paths: computeReturnPaths(track, summary.yields),
  };
}

/** The month a set of funds is "as of": latest month among non-closed funds (or any fund). */
export function portfolioAsOf(funds: Array<{ status: Fund['status']; entries: Entry[] }>): string | null {
  const lastOf = (f: { entries: Entry[] }) =>
    f.entries.reduce<string | null>((max, e) => (max === null || e.month > max ? e.month : max), null);
  const open = funds.filter(f => f.status !== 'closed').map(lastOf).filter((m): m is string => !!m);
  const all = funds.map(lastOf).filter((m): m is string => !!m);
  const pool = open.length ? open : all;

  return pool.length ? pool.reduce((a, b) => (a > b ? a : b)) : null;
}

export function buildPortfolio(funds: Array<{ fund: Fund; entries: Entry[] }>, today: string): Portfolio {
  const summaries = funds.map(f => summarizeFund(f.fund, f.entries, today));
  const tracked = funds.map(f => ({ status: f.fund.status, entries: f.entries }));
  const asOf = portfolioAsOf(tracked);
  const track = asOf ? portfolioTrack(tracked, asOf) : portfolioTrack([], '0000-01');
  const totalBalance = asOf ? (track.balances.get(asOf) ?? 0) : 0;
  const netDeposits = netInvested(track);
  const yields = computeYields(track, asOf);

  const byType = new Map<FundType, number>();

  for (const s of summaries) {
    if (s.status !== 'closed' && s.balance) {
      byType.set(s.type, (byType.get(s.type) ?? 0) + s.balance);
    }
  }

  const allocTotal = [...byType.values()].reduce((a, b) => a + b, 0);
  const allocation: Allocation[] = [...byType.entries()]
    .map(([type, balance]) => ({ type, balance, share: allocTotal ? balance / allocTotal : 0 }))
    .sort((a, b) => b.balance - a.balance);

  return {
    asOf,
    firstMonth: track.months[0] ?? null,
    totalBalance,
    netDeposits,
    ...totals(track),
    totalGain: totalBalance - netDeposits,
    yields,
    series: computeSeries(track),
    yearly: computeYearly(track, asOf),
    paths: computeReturnPaths(track, yields),
    allocation,
    funds: summaries,
    fundSeries: funds.map((f, i) => ({
      fundId: f.fund.id,
      points: f.entries.map(e => ({ month: e.month, balance: e.balance })),
      paths: computeReturnPaths(fundTrack(f.entries), summaries[i].yields),
    })),
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);

  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function peerStats(peers: number[], mine: number | null): PeerStats {
  const sorted = [...peers].sort((a, b) => a - b);
  const count = sorted.length;

  if (count === 0) {
    return { count, mean: null, median: null, p25: null, p75: null, min: null, max: null, mine, percentile: null, rank: null };
  }

  const below = mine === null ? 0 : sorted.filter(v => v < mine).length;
  const equal = mine === null ? 0 : sorted.filter(v => v === mine).length;
  const above = mine === null ? 0 : sorted.filter(v => v > mine).length;

  return {
    count,
    mean: sorted.reduce((a, b) => a + b, 0) / count,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[count - 1],
    mine,
    percentile: mine === null ? null : ((below + equal / 2) / count) * 100,
    rank: mine === null ? null : above + 1,
  };
}
