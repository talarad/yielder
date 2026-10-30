// Months are stored as 'YYYY-MM' strings; arithmetic goes through a month index.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

export function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number);

  return y * 12 + (m - 1);
}

export function monthFromIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;

  return `${y}-${String(m).padStart(2, '0')}`;
}

export function addMonths(month: string, n: number): string {
  return monthFromIndex(monthIndex(month) + n);
}

export function monthsBetween(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from);
}

export function yearOf(month: string): number {
  return Number(month.slice(0, 4));
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Converts a Date to its statement month. Statement dates are usually the 1st of the month,
 * but some exports store local midnight in UTC (e.g. 2023-07-31T21:00Z for Aug 1st in Israel),
 * so shift by 12h before reading the month.
 */
export function monthFromDate(date: Date): string {
  const shifted = new Date(date.getTime() + 12 * 60 * 60 * 1000);

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}
