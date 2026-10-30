// Types shared by the API server and the React client.

export const FUND_TYPES = [
  'pension_comprehensive',
  'pension_supplementary',
  'managers_insurance',
  'education_fund',
  'provident_fund',
  'investment_provident_fund',
  'self_managed',
  'savings',
  'other',
] as const;
export type FundType = (typeof FUND_TYPES)[number];

export const FUND_STATUSES = ['active', 'inactive', 'closed'] as const;
export type FundStatus = (typeof FUND_STATUSES)[number];

/** 1M = month over month, ALL = since the first recorded month. */
export const PERIODS = ['1M', 'YTD', '1Y', '3Y', '5Y', 'ALL'] as const;
export type Period = (typeof PERIODS)[number];

export interface User {
  id: number;
  username: string;
  displayName: string;
  shareAnonymously: boolean;
  createdAt: string;
}

export interface Fund {
  id: number;
  name: string;
  type: FundType;
  provider: string;
  track: string;
  status: FundStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FundInput {
  name: string;
  type: FundType;
  provider?: string;
  track?: string;
  status?: FundStatus;
  notes?: string;
}

/** One monthly statement line. `month` is YYYY-MM. */
export interface Entry {
  month: string;
  balance: number;
  deposit: number;
  withdrawal: number;
  comment: string;
}

export interface PeriodYield {
  period: Period;
  /** Time-weighted return as a fraction (0.05 = 5%), or null when history doesn't cover the period. */
  return: number | null;
  /** Annualized return, only for windows of 12 months or more. */
  annualized: number | null;
  /** Investment gain in currency: balance change minus net deposits. */
  gain: number | null;
  /** deposits - withdrawals in the window. */
  netFlow: number | null;
  /** Money that went in during the window (deposits, plus the first balance of funds opened in it). */
  deposits: number | null;
  /** Money that came out during the window. */
  withdrawals: number | null;
  startMonth: string | null;
  endMonth: string | null;
  startBalance: number | null;
  endBalance: number | null;
  months: number;
  /** True when the window started later than requested (e.g. YTD for a fund opened mid-year). */
  partial: boolean;
}

export type Yields = Record<Period, PeriodYield>;

export interface SeriesPoint {
  month: string;
  balance: number;
  netFlow: number;
  cumulativeFlow: number;
  /** Return of the step ending this month (null for the first month). */
  return: number | null;
  gain: number | null;
}

export interface YearlyYield {
  year: number;
  return: number | null;
  gain: number;
  netFlow: number;
  deposits: number;
  withdrawals: number;
  startBalance: number;
  endBalance: number;
  partial: boolean;
}

/** All money in and out over the whole history. Deposits include each fund's first tracked balance. */
export interface MoneyTotals {
  totalDeposits: number;
  totalWithdrawals: number;
}

export interface FundSummary extends Fund, MoneyTotals {
  asOf: string | null;
  firstMonth: string | null;
  balance: number | null;
  entryCount: number;
  netDeposits: number;
  totalGain: number;
  stale: boolean;
  yields: Yields;
}

/** Per period: the return from the period's start to each month, ending at the period's return. */
export type ReturnPaths = Record<Period, Array<{ month: string; return: number | null }>>;

export interface FundDetail extends FundSummary {
  entries: Entry[];
  series: SeriesPoint[];
  yearly: YearlyYield[];
  paths: ReturnPaths;
}

export interface Allocation {
  type: FundType;
  balance: number;
  share: number;
}

/** One fund's recorded month-end balances, for drawing funds side by side. */
export interface FundBalances {
  fundId: number;
  points: Array<{ month: string; balance: number }>;
  paths: ReturnPaths;
}

export interface Portfolio extends MoneyTotals {
  asOf: string | null;
  firstMonth: string | null;
  totalBalance: number;
  netDeposits: number;
  totalGain: number;
  yields: Yields;
  series: SeriesPoint[];
  yearly: YearlyYield[];
  paths: ReturnPaths;
  allocation: Allocation[];
  funds: FundSummary[];
  fundSeries: FundBalances[];
}

export interface PeerStats {
  count: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  mine: number | null;
  /** Share of peers you beat, 0–100. */
  percentile: number | null;
  /** 1 = best, out of count + 1. */
  rank: number | null;
}

/** A real fund of a managing company, used as a market benchmark. */
export interface Benchmark {
  id: number;
  provider: string;
  providerHe: string;
  type: FundType;
  track: string;
  trackHe: string;
  fundName: string;
}

export interface BenchmarkReturn extends Benchmark {
  /** Compounded monthly returns over the window, or null if the data doesn't cover it. */
  return: number | null;
}

export interface FundComparison {
  fundId: number;
  name: string;
  type: FundType;
  provider: string;
  track: string;
  /** The window your return and the benchmarks' returns are measured over. */
  from: string | null;
  to: string | null;
  mine: number | null;
  /** Your money over the same window: balances, gain, and what you put in / took out. */
  startBalance: number | null;
  endBalance: number | null;
  gain: number | null;
  deposits: number | null;
  withdrawals: number | null;
  /** Benchmarks of the same product type over the same window, best first. */
  benchmarks: BenchmarkReturn[];
  /** Your return against those benchmarks. */
  market: PeerStats;
  /** Your return against other users' funds of the same type (anonymous). */
  people: PeerStats;
}

export interface CompareResult {
  period: Period;
  /** Month the portfolio comparison ends at (and the market table, for types you don't hold). */
  asOf: string | null;
  /** Whether other users share anonymously (how many is never exposed in the UI). */
  hasPeople: boolean;
  portfolio: PeerStats;
  funds: FundComparison[];
  /** Every benchmark over its product type's window in `marketWindows`. */
  market: BenchmarkReturn[];
  /** Per product type: the months the market table covers, ending where your funds of that type do. */
  marketWindows: Array<{ type: FundType; from: string | null; to: string | null }>;
  /** Your funds over their type's window, to place them in the market table. */
  yours: Array<{ fundId: number; name: string; type: FundType; return: number | null }>;
  /** Last month of market data available. */
  marketThrough: string | null;
}

export interface ImportFund {
  name: string;
  type: FundType;
  provider: string;
  track: string;
  status: FundStatus;
  notes: string;
  entries: Entry[];
}

/** Import problems as data, so the UI can word them in the user's language. */
export type ImportWarning =
  | { code: 'duplicate_month'; month: string }
  | { code: 'skipped_row'; sheet: string; row: number }
  | { code: 'no_data' };

export interface ImportPreviewFund extends ImportFund {
  key: string;
  sheet: string;
  typeGuessed: boolean;
  firstMonth: string | null;
  lastMonth: string | null;
  existingFundId: number | null;
  newMonths: number;
  changedMonths: number;
  warnings: ImportWarning[];
}

export type ImportFormat = 'yielder' | 'per-fund-sheets' | 'unknown';

export interface ImportPreview {
  format: ImportFormat;
  funds: ImportPreviewFund[];
  warnings: ImportWarning[];
}

export interface ImportCommitFund extends ImportFund {
  /** Existing fund to merge into, or null to create a new fund. */
  targetFundId: number | null;
}

export interface ImportResult {
  createdFunds: number;
  updatedFunds: number;
  insertedMonths: number;
  updatedMonths: number;
}
