import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ExcelJS from 'exceljs';

import type { Fund } from './types';
import { buildExport, buildTemplate, cellMonth, parseWorkbook } from './excel';
import { fundDetail } from './yields';

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Mirrors the first Yielder's export: Summary, All Funds, then one sheet per fund. */
function legacyWorkbook(flowColumns: 'transaction' | 'deposit-withdrawal') {
  const wb = new ExcelJS.Workbook();

  wb.addWorksheet('Summary').addRows([['Funds Export Summary'], ['Total Funds', 2]]);
  wb.addWorksheet('All Funds').addRows([
    ['id', 'name', 'type', 'description', 'status'],
    ['a1', 'פנסיה מקיפה', 'retirement', 'קרן פנסיה מקיפה', 'active'],
    ['a2', 'פנסיה מקיפה', 'retirement', 'קרן פנסיה מקיפה', 'active'],
  ]);

  const sheet = (name: string, type: string, rows: unknown[][]) => {
    wb.addWorksheet(name).addRows([
      ['Fund Details'],
      ['id', 'x'],
      ['name', name.trim()],
      ['type', type],
      ['description', name.trim()],
      ['status', 'active'],
      [],
      ['Historical Data'],
      flowColumns === 'transaction'
        ? ['date', 'balance', 'transaction', 'comment']
        : ['date', 'balance', 'deposit', 'withdrawal', 'comment'],
      ...rows,
    ]);
  };

  if (flowColumns === 'transaction') {
    sheet('פנסיה מקיפה', 'retirement', [
      ['2020-06-01T00:00:00.000Z', 20000, 0],
      ['2020-07-01T00:00:00.000Z', 23000, 2500],
    ]);
    sheet('תיק מנוהל ', 'savings', [
      ['2023-09-01T00:00:00.000Z', 100000, 0],
      ['2023-10-01T00:00:00.000Z', 86000, -15000],
      ['2023-11-01T00:00:00.000Z', 92000, 5000, 'העברה 5000'],
    ]);
  } else {
    sheet('קרן השתלמות עצמאיים', 'savings', [
      [new Date(Date.UTC(2024, 0, 1)), 10000, 0, 0],
      [new Date(Date.UTC(2024, 0, 31, 22)), 10500, 400, ''], // Feb 1st local time stored as UTC
      [new Date(Date.UTC(2024, 2, 1)), 10300, '', 300, 'משיכה'],
    ]);
  }

  return wb;
}

describe('parseWorkbook', () => {
  it('reads the first Yielder export (signed transaction column)', async () => {
    const { format, funds } = await parseWorkbook(await toBuffer(legacyWorkbook('transaction')));

    assert.equal(format, 'per-fund-sheets');
    assert.deepEqual(
      funds.map(f => [f.name, f.type, f.entries.length]),
      [
        ['פנסיה מקיפה', 'pension_comprehensive', 2],
        ['תיק מנוהל', 'self_managed', 3],
      ],
    );

    const savings = funds[1].entries;

    assert.deepEqual(savings[1], { month: '2023-10', balance: 86000, deposit: 0, withdrawal: 15000, comment: '' });
    assert.equal(savings[2].comment, 'העברה 5000');
    assert.equal(funds[0].notes, 'קרן פנסיה מקיפה');
  });

  it('reads deposit and withdrawal columns and real dates', async () => {
    const { funds } = await parseWorkbook(await toBuffer(legacyWorkbook('deposit-withdrawal')));

    assert.equal(funds[0].type, 'education_fund');
    assert.deepEqual(
      funds[0].entries.map(e => [e.month, e.deposit, e.withdrawal]),
      [
        ['2024-01', 0, 0],
        ['2024-02', 400, 0],
        ['2024-03', 0, 300],
      ],
    );
  });

  it('round-trips the Yielder export', async () => {
    const fund: Fund = {
      id: 7,
      name: 'Hishtalmut',
      type: 'education_fund',
      provider: 'Meitav',
      track: 'Equities',
      status: 'active',
      notes: 'Work fund',
      createdAt: '',
      updatedAt: '',
    };
    const detail = fundDetail(
      fund,
      [
        { month: '2024-01', balance: 1000, deposit: 0, withdrawal: 0, comment: '' },
        { month: '2024-02', balance: 1300, deposit: 250, withdrawal: 0, comment: 'bonus' },
      ],
      '2024-02',
    );
    const { format, funds } = await parseWorkbook(await buildExport([detail]));

    assert.equal(format, 'yielder');
    assert.equal(funds.length, 1);
    assert.equal(funds[0].type, 'education_fund');
    assert.equal(funds[0].typeGuessed, false);
    assert.equal(funds[0].provider, 'Meitav');
    assert.equal(funds[0].track, 'Equities');
    assert.deepEqual(funds[0].entries[1], { month: '2024-02', balance: 1300, deposit: 250, withdrawal: 0, comment: 'bonus' });
  });

  it('parses the blank template', async () => {
    const { funds } = await parseWorkbook(await buildTemplate());

    assert.equal(funds.length, 2);
    assert.equal(funds[0].provider, 'Altshuler Shaham');
  });

  it('warns when nothing is found', async () => {
    const wb = new ExcelJS.Workbook();

    wb.addWorksheet('Sheet1').addRows([['hello', 'world']]);

    const { funds, warnings } = await parseWorkbook(await toBuffer(wb));

    assert.equal(funds.length, 0);
    assert.deepEqual(warnings, [{ code: 'no_data' }]);
  });

  it('reports duplicate months and skipped rows as structured warnings', async () => {
    const wb = new ExcelJS.Workbook();

    wb.addWorksheet('Monthly data').addRows([
      ['Fund', 'Month', 'Balance'],
      ['A', '2024-01', 100],
      ['A', '2024-01', 120],
      ['A', 'oops', 130],
    ]);

    const { funds, warnings } = await parseWorkbook(await toBuffer(wb));

    assert.deepEqual(funds[0].warnings, [{ code: 'duplicate_month', month: '2024-01' }]);
    assert.deepEqual(warnings, [{ code: 'skipped_row', sheet: 'Monthly data', row: 4 }]);
  });
});

describe('cellMonth', () => {
  it('accepts common month formats', () => {
    assert.equal(cellMonth('2024-03'), '2024-03');
    assert.equal(cellMonth('15/03/2024'), '2024-03');
    assert.equal(cellMonth('3/2024'), '2024-03');
    assert.equal(cellMonth(45352), '2024-03'); // Excel serial for 2024-03-01
    assert.equal(cellMonth('2024-02-29T22:00:00.000Z'), '2024-03');
    assert.equal(cellMonth('not a date'), null);
  });
});
