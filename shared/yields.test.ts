import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Entry, Fund } from './types';
import { addMonths } from './months';
import { buildPortfolio, chainReturns, computeYearly, computeYield, fundTrack, peerStats, summarizeFund } from './yields';

const close = (actual: number | null, expected: number, eps = 1e-9) => {
  assert.ok(actual !== null, 'expected a number, got null');
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
};

/** `count` months starting at `start`, growing `rate` per month with no cash flows. */
function growing(start: string, count: number, rate: number, balance = 1000): Entry[] {
  return Array.from({ length: count }, (_, i) => ({
    month: addMonths(start, i),
    balance: balance * (1 + rate) ** i,
    deposit: 0,
    withdrawal: 0,
    comment: '',
  }));
}

const fund = (over: Partial<Fund> = {}): Fund => ({
  id: 1,
  name: 'Test',
  type: 'pension_comprehensive',
  provider: '',
  track: '',
  status: 'active',
  notes: '',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('fund yields', () => {
  const track = fundTrack(growing('2023-01', 24, 0.01));

  it('chains monthly returns for each period', () => {
    close(computeYield(track, '1M', '2024-12').return, 0.01);
    close(computeYield(track, '1Y', '2024-12').return, 1.01 ** 12 - 1);
    close(computeYield(track, 'ALL', '2024-12').return, 1.01 ** 23 - 1);
  });

  it('YTD starts from December of the previous year', () => {
    close(computeYield(track, 'YTD', '2024-03').return, 1.01 ** 3 - 1);
    assert.equal(computeYield(track, 'YTD', '2024-03').startMonth, '2023-12');
  });

  it('returns null when history is shorter than the period', () => {
    assert.equal(computeYield(track, '3Y', '2024-12').return, null);
    assert.equal(computeYield(track, '5Y', '2024-12').return, null);
  });

  it('returns null when there is no balance in the end month', () => {
    assert.equal(computeYield(track, '1M', '2025-01').return, null);
  });

  it('annualizes windows longer than a year', () => {
    const long = fundTrack(growing('2019-01', 61, 0.01));
    const y5 = computeYield(long, '5Y', '2024-01');

    close(y5.return, 1.01 ** 60 - 1);
    close(y5.annualized, 1.01 ** 12 - 1);
  });

  it('marks YTD partial for a fund opened mid-year', () => {
    const y = computeYield(fundTrack(growing('2024-05', 3, 0.02)), 'YTD', '2024-07');

    assert.equal(y.partial, true);
    close(y.return, 1.02 ** 2 - 1);
  });
});

describe('cash flows', () => {
  it('does not count deposits as gains', () => {
    const entries: Entry[] = [
      { month: '2024-01', balance: 1000, deposit: 0, withdrawal: 0, comment: '' },
      { month: '2024-02', balance: 1500, deposit: 500, withdrawal: 0, comment: '' },
    ];
    const y = computeYield(fundTrack(entries), '1M', '2024-02');

    close(y.return, 0);
    close(y.gain, 0);
    close(y.netFlow, 500);
    close(y.deposits, 500);
    close(y.withdrawals, 0);
  });

  it('uses mid-month timing for withdrawals', () => {
    const entries: Entry[] = [
      { month: '2024-01', balance: 1000, deposit: 0, withdrawal: 0, comment: '' },
      { month: '2024-02', balance: 810, deposit: 0, withdrawal: 200, comment: '' },
    ];
    const y = computeYield(fundTrack(entries), '1M', '2024-02');
    // 1000·(1+r) − 200·(1+r)^½ = 810
    const x = (200 + Math.sqrt(200 ** 2 + 4 * 1000 * 810)) / 2000;

    close(y.gain, 10);
    close(y.withdrawals, 200);
    // start + deposits − withdrawals + gain = end
    close(y.startBalance! + y.deposits! - y.withdrawals! + y.gain!, y.endBalance!);
    close(y.return, x * x - 1, 1e-9);
  });

  it('is robust to a deposit recorded a month before it reaches the balance', () => {
    const entries: Entry[] = [
      { month: '2024-11', balance: 20400, deposit: 0, withdrawal: 0, comment: '' },
      { month: '2024-12', balance: 20565, deposit: 20520, withdrawal: 0, comment: '' },
      { month: '2025-01', balance: 41995, deposit: 0, withdrawal: 0, comment: '' },
    ];
    const y = computeYield(fundTrack(entries), 'ALL', '2025-01');

    close(y.gain, 1075);
    assert.ok(y.return! > 0.02 && y.return! < 0.04, `return ${y.return}`);
  });

  it('treats the first balance as invested money', () => {
    const s = summarizeFund(fund(), growing('2024-01', 2, 0.1), '2024-02');

    close(s.netDeposits, 1000);
    close(s.totalGain, 100);
  });
});

describe('yearly', () => {
  it('splits by calendar year and flags the first partial year', () => {
    const yearly = computeYearly(fundTrack(growing('2023-07', 18, 0.01)), '2024-12');

    assert.deepEqual(
      yearly.map(y => [y.year, y.partial]),
      [
        [2023, true],
        [2024, false],
      ],
    );
    close(yearly[0].return, 1.01 ** 5 - 1);
    close(yearly[1].return, 1.01 ** 12 - 1);
  });
});

describe('portfolio', () => {
  it('carries forward funds not updated this month', () => {
    const a = growing('2024-01', 3, 0.01, 1000);
    const b = growing('2024-01', 2, 0.03, 3000); // missing 2024-03
    const p = buildPortfolio(
      [
        { fund: fund({ id: 1 }), entries: a },
        { fund: fund({ id: 2 }), entries: b },
      ],
      '2024-03',
    );

    assert.equal(p.asOf, '2024-03');
    close(p.totalBalance, 1000 * 1.01 ** 2 + 3000 * 1.03);
    // Only fund A reported March; B is assumed unchanged until its statement arrives.
    close(p.yields['1M'].return, (1000 * 1.01 ** 2 - 1010) / (1010 + 3090));
    close(p.series.find(s => s.month === '2024-02')!.return, (10 + 90) / 4000);
  });

  it('ignores closed funds after their last month', () => {
    const p = buildPortfolio(
      [
        { fund: fund({ id: 1 }), entries: growing('2024-01', 3, 0) },
        { fund: fund({ id: 2, status: 'closed' }), entries: growing('2024-01', 1, 0, 500) },
      ],
      '2024-03',
    );

    close(p.totalBalance, 1000);
  });
});

describe('return paths', () => {
  it('start at 0 and end at the period return, deposits excluded', () => {
    const entries = growing('2023-01', 30, 0.01, 1000).map((e, i) => (i % 6 === 3 ? { ...e, balance: e.balance + 500, deposit: 500 } : e));
    const p = buildPortfolio([{ fund: fund({ id: 1 }), entries }], '2025-06');

    for (const period of ['YTD', '1Y', 'ALL'] as const) {
      const path = p.fundSeries[0].paths[period];

      assert.equal(path[0].return, 0);
      assert.equal(path[0].month, p.funds[0].yields[period].startMonth);
      assert.equal(path[path.length - 1].month, p.funds[0].yields[period].endMonth);
      close(path[path.length - 1].return, p.funds[0].yields[period].return!);
    }
  });
});

describe('chainReturns (market benchmarks)', () => {
  const returns = new Map([
    ['2024-01', 0.01],
    ['2024-02', 0.01],
    ['2024-03', 0.01],
  ]);

  it('compounds the months after `from` up to `to`', () => {
    close(chainReturns(returns, '2023-12', '2024-03'), 1.01 ** 3 - 1);
    close(chainReturns(returns, '2024-01', '2024-02'), 0.01);
  });

  it('is null when a month is missing or the window is empty', () => {
    assert.equal(chainReturns(returns, '2023-11', '2024-03'), null);
    assert.equal(chainReturns(returns, '2024-03', '2024-03'), null);
  });
});

describe('peerStats', () => {
  it('computes median, percentile and rank', () => {
    const s = peerStats([0.01, 0.02, 0.03, 0.04], 0.035);

    close(s.median, 0.025);
    close(s.percentile, 75);
    assert.equal(s.rank, 2);
  });

  it('handles no peers', () => {
    assert.equal(peerStats([], 0.1).median, null);
  });
});
