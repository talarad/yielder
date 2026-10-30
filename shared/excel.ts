// Excel import/export.
//
// Import understands two layouts:
//  1. Yielder export / template: an entries sheet with Fund | Month | Balance | Deposit | Withdrawal | Comment
//     columns (one row per fund-month), plus an optional Funds sheet with metadata.
//  2. One sheet per fund (the first Yielder's export and the Hebrew spreadsheet): key/value rows
//     (name, type, status, description) above a date | balance | transaction | comment table, or
//     date | balance | deposit | withdrawal | comment.
// Headers are matched case-insensitively in English or Hebrew.

import ExcelJS from 'exceljs';

import { PERIODS, type Entry, type FundDetail, type FundType, type ImportFormat, type ImportFund, type ImportWarning } from './types';
import { inferFundType, normalizeName, normalizeStatus } from './fundTypes';
import { monthFromDate } from './months';

type CellValue = ExcelJS.CellValue;
type Field =
  | 'fund'
  | 'month'
  | 'balance'
  | 'deposit'
  | 'withdrawal'
  | 'transaction'
  | 'comment'
  | 'name'
  | 'type'
  | 'provider'
  | 'track'
  | 'status'
  | 'notes';

const ALIASES: Record<Field, string[]> = {
  fund: ['fund', 'fund name', 'קרן', 'שם הקרן', 'שם קרן', 'מוצר'],
  month: ['month', 'date', 'חודש', 'תאריך'],
  balance: ['balance', 'יתרה', 'צבירה', 'סכום צבירה'],
  deposit: ['deposit', 'deposits', 'הפקדה', 'הפקדות'],
  withdrawal: ['withdrawal', 'withdrawals', 'משיכה', 'משיכות'],
  transaction: ['transaction', 'net flow', 'cash flow', 'תנועה'],
  comment: ['comment', 'comments', 'הערה', 'הערות'],
  name: ['name', 'שם'],
  type: ['type', 'fund type', 'סוג', 'סוג מוצר'],
  provider: ['provider', 'company', 'manager', 'חברה', 'גוף מנהל', 'בית השקעות'],
  track: ['track', 'investment track', 'מסלול', 'מסלול השקעה'],
  status: ['status', 'סטטוס'],
  notes: ['notes', 'description', 'תיאור'],
};

const FIELD_BY_ALIAS = new Map<string, Field>(
  (Object.entries(ALIASES) as Array<[Field, string[]]>).flatMap(([field, names]) => names.map(n => [n, field] as const)),
);

const SKIP_SHEETS = new Set(['summary', 'about', 'סיכום']);
const MAX_ROWS = 5000;

export interface ParsedFund extends ImportFund {
  sheet: string;
  typeGuessed: boolean;
  warnings: ImportWarning[];
}

export interface ParseResult {
  format: ImportFormat;
  funds: ParsedFund[];
  warnings: ImportWarning[];
}

export function cellText(v: CellValue): string {
  if (v === null || v === undefined) {
    return '';
  }

  if (v instanceof Date) {
    return v.toISOString();
  }

  if (typeof v === 'object') {
    if ('richText' in v) {
      return v.richText.map(t => t.text).join('').trim();
    }

    if ('result' in v) {
      return cellText(v.result as CellValue);
    }

    if ('text' in v && typeof v.text === 'string') {
      return v.text.trim();
    }

    return '';
  }

  return String(v).trim();
}

export function cellNumber(v: CellValue): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }

  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) {
    return cellNumber(v.result as CellValue);
  }

  const s = cellText(v)
    .replace(/[₪$€,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');

  if (!s) {
    return null;
  }

  const n = Number(s);

  return Number.isFinite(n) ? n : null;
}

function toMonth(year: number, month: number): string | null {
  if (month < 1 || month > 12 || year < 1950 || year > 2100) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

export function cellMonth(v: CellValue): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : monthFromDate(v);
  }

  if (typeof v === 'number') {
    // Excel serial date
    return v > 20000 && v < 80000 ? monthFromDate(new Date(Math.round((v - 25569) * 86400000))) : null;
  }

  if (v && typeof v === 'object' && 'result' in v) {
    return cellMonth(v.result as CellValue);
  }

  const s = cellText(v);
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(T.*)?$/))) {
    if (m[4]) {
      const d = new Date(s);

      return Number.isNaN(d.getTime()) ? null : monthFromDate(d);
    }

    return toMonth(Number(m[1]), Number(m[2]));
  }

  // DD/MM/YYYY (day first, as in Israel)
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);

    return toMonth(year, Number(m[2]));
  }

  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) {
    return toMonth(Number(m[2]), Number(m[1]));
  }

  if ((m = s.match(/^(\d{4})[/.](\d{1,2})$/))) {
    return toMonth(Number(m[1]), Number(m[2]));
  }

  return null;
}

function fieldOf(v: CellValue): Field | null {
  const key = cellText(v)
    .toLowerCase()
    .replace(/\(.*?\)|[:*₪]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return FIELD_BY_ALIAS.get(key) ?? null;
}

function readRows(ws: ExcelJS.Worksheet): CellValue[][] {
  const rows: CellValue[][] = [];

  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= MAX_ROWS) {
      rows[n - 1] = (row.values as CellValue[]).slice(1);
    }
  });

  return rows;
}

function headerAt(row: CellValue[] | undefined): Map<Field, number> {
  const cols = new Map<Field, number>();

  row?.forEach((cell, i) => {
    const f = fieldOf(cell);

    if (f && !cols.has(f)) {
      cols.set(f, i);
    }
  });

  return cols;
}

function findHeader(rows: CellValue[][], test: (cols: Map<Field, number>) => boolean, within = 40) {
  for (let i = 0; i < Math.min(rows.length, within); i++) {
    const cols = headerAt(rows[i]);

    if (test(cols)) {
      return { index: i, cols };
    }
  }

  return null;
}

function readEntry(row: CellValue[], cols: Map<Field, number>): Entry | null {
  const get = (f: Field) => (cols.has(f) ? row[cols.get(f)!] : undefined);
  const month = cellMonth(get('month') ?? null);
  const balance = cellNumber(get('balance') ?? null);

  if (!month || balance === null) {
    return null;
  }

  let deposit = 0;
  let withdrawal = 0;
  const flow = (v: number | null) => {
    if (v !== null) {
      v >= 0 ? (deposit += v) : (withdrawal += -v);
    }
  };

  flow(cellNumber(get('deposit') ?? null));
  withdrawal += Math.abs(cellNumber(get('withdrawal') ?? null) ?? 0);
  flow(cellNumber(get('transaction') ?? null));

  return { month, balance, deposit, withdrawal, comment: cellText(get('comment') ?? null) };
}

interface Draft {
  name: string;
  sheet: string;
  /** True when the fund came from this version's layout, so its declared type is trusted. */
  ownFormat: boolean;
  declaredType: string;
  provider: string;
  track: string;
  status: string;
  notes: string;
  entries: Map<string, Entry>;
  warnings: ImportWarning[];
}

class FundCollector {
  private drafts = new Map<string, Draft>();

  get(name: string, sheet: string, ownFormat = false): Draft {
    const key = normalizeName(name);
    let d = this.drafts.get(key);

    if (!d) {
      d = {
        name: name.trim().replace(/\s+/g, ' '),
        sheet,
        ownFormat,
        declaredType: '',
        provider: '',
        track: '',
        status: '',
        notes: '',
        entries: new Map(),
        warnings: [],
      };
      this.drafts.set(key, d);
    }

    return d;
  }

  has(name: string): boolean {
    return this.drafts.has(normalizeName(name));
  }

  addEntry(d: Draft, e: Entry) {
    const prev = d.entries.get(e.month);

    if (prev && (prev.balance !== e.balance || prev.deposit !== e.deposit || prev.withdrawal !== e.withdrawal)) {
      d.warnings.push({ code: 'duplicate_month', month: e.month });
    }

    d.entries.set(e.month, e);
  }

  result(): ParsedFund[] {
    return [...this.drafts.values()]
      .filter(d => d.entries.size > 0)
      .map(d => {
        const { type, guessed } = inferFundType(d.name, d.declaredType, d.ownFormat);

        return {
          name: d.name,
          type,
          typeGuessed: guessed,
          provider: d.provider,
          track: d.track,
          status: normalizeStatus(d.status),
          notes: d.notes,
          entries: [...d.entries.values()].sort((a, b) => a.month.localeCompare(b.month)),
          sheet: d.sheet,
          warnings: d.warnings,
        };
      });
  }
}

function applyMeta(d: Draft, meta: Partial<Record<Field, string>>) {
  d.declaredType ||= meta.type ?? '';
  d.provider ||= meta.provider ?? '';
  d.track ||= meta.track ?? '';
  d.status ||= meta.status ?? '';

  // Old exports repeat the name as the description; that's not a note worth keeping.
  if (meta.notes && normalizeName(meta.notes) !== normalizeName(d.name)) {
    d.notes ||= meta.notes;
  }
}

export async function parseWorkbook(data: ArrayBuffer | Uint8Array): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();

  await wb.xlsx.load(data as ArrayBuffer);

  const collector = new FundCollector();
  const warnings: ImportWarning[] = [];
  const metaRows: Array<Partial<Record<Field, string>>> = [];
  let format: ImportFormat = 'unknown';

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();

    if (SKIP_SHEETS.has(sheetName.toLowerCase())) {
      continue;
    }

    const rows = readRows(ws);
    const entriesHeader = findHeader(rows, c => c.has('month') && c.has('balance'));

    if (entriesHeader?.cols.has('fund')) {
      // Layout 1: one row per fund-month.
      format = 'yielder';
      const { cols } = entriesHeader;

      rows.slice(entriesHeader.index + 1).forEach((row, i) => {
        const name = cellText(row?.[cols.get('fund')!] ?? null);
        const entry = row && name ? readEntry(row, cols) : null;

        if (!entry) {
          if (row?.some(c => cellText(c))) {
            warnings.push({ code: 'skipped_row', sheet: sheetName, row: entriesHeader.index + i + 2 });
          }

          return;
        }

        const draft = collector.get(name, sheetName, true);

        if (cols.has('type')) {
          applyMeta(draft, { type: cellText(row[cols.get('type')!]) });
        }

        collector.addEntry(draft, entry);
      });
      continue;
    }

    if (entriesHeader) {
      // Layout 2: one sheet per fund, key/value details above the table.
      if (format === 'unknown') {
        format = 'per-fund-sheets';
      }

      const meta: Partial<Record<Field, string>> = {};

      rows.slice(0, entriesHeader.index).forEach(row => {
        const f = row ? fieldOf(row[0]) : null;
        const value = row ? cellText(row[1]) : '';

        if (f && value) {
          meta[f] = value;
        }
      });

      const draft = collector.get(meta.name || sheetName, sheetName);

      applyMeta(draft, meta);
      rows.slice(entriesHeader.index + 1).forEach(row => {
        const entry = row ? readEntry(row, entriesHeader.cols) : null;

        if (entry) {
          collector.addEntry(draft, entry);
        }
      });
      continue;
    }

    const metaHeader = findHeader(rows, c => c.has('name') && (c.has('type') || c.has('provider') || c.has('track')), 10);

    if (metaHeader) {
      rows.slice(metaHeader.index + 1).forEach(row => {
        const meta: Partial<Record<Field, string>> = {};

        metaHeader.cols.forEach((col, f) => (meta[f] = cellText(row?.[col] ?? null)));

        if (meta.name) {
          metaRows.push(meta);
        }
      });
    }
  }

  // Metadata rows (Funds sheet) only enrich funds that have data.
  for (const meta of metaRows) {
    if (collector.has(meta.name!)) {
      applyMeta(collector.get(meta.name!, ''), meta);
    }
  }

  const funds = collector.result();

  if (funds.length === 0) {
    warnings.push({ code: 'no_data' });
  }

  return { format, funds, warnings };
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

function styleHeader(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);

  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function addFundsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Funds');

  ws.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Type', key: 'type', width: 26 },
    { header: 'Provider', key: 'provider', width: 18 },
    { header: 'Track', key: 'track', width: 18 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  styleHeader(ws);

  return ws;
}

function addEntriesSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Monthly data');

  ws.columns = [
    { header: 'Fund', key: 'fund', width: 28 },
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Balance', key: 'balance', width: 14, style: { numFmt: '#,##0' } },
    { header: 'Deposit', key: 'deposit', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Withdrawal', key: 'withdrawal', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Comment', key: 'comment', width: 30 },
  ];
  styleHeader(ws);

  return ws;
}

export async function buildExport(funds: FundDetail[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  wb.creator = 'Yielder';

  const fundsWs = addFundsSheet(wb);
  const entriesWs = addEntriesSheet(wb);
  const yieldsWs = wb.addWorksheet('Yields');

  yieldsWs.columns = [
    { header: 'Fund', key: 'fund', width: 28 },
    { header: 'As of', key: 'asOf', width: 10 },
    { header: 'Balance', key: 'balance', width: 14, style: { numFmt: '#,##0' } },
    ...PERIODS.map(p => ({ header: p, key: p, width: 9, style: { numFmt: '0.00%' } })),
  ];
  styleHeader(yieldsWs);

  for (const f of funds) {
    fundsWs.addRow({ name: f.name, type: f.type, provider: f.provider, track: f.track, status: f.status, notes: f.notes });

    for (const e of [...f.entries].sort((a, b) => a.month.localeCompare(b.month))) {
      entriesWs.addRow({ fund: f.name, ...e });
    }

    yieldsWs.addRow({
      fund: f.name,
      asOf: f.asOf,
      balance: f.balance,
      ...Object.fromEntries(PERIODS.map(p => [p, pct(f.yields[p].return)])),
    });
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function buildTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const fundsWs = addFundsSheet(wb);
  const entriesWs = addEntriesSheet(wb);
  const example: Array<[string, FundType]> = [
    ['פנסיה מקיפה', 'pension_comprehensive'],
    ['קרן השתלמות', 'education_fund'],
  ];

  example.forEach(([name, type]) => fundsWs.addRow({ name, type, provider: 'Altshuler Shaham', track: 'S&P 500', status: 'active' }));
  entriesWs.addRows([
    { fund: example[0][0], month: '2025-01', balance: 100000, deposit: 0, withdrawal: 0 },
    { fund: example[0][0], month: '2025-02', balance: 103500, deposit: 2500, withdrawal: 0, comment: 'Monthly deposit' },
    { fund: example[1][0], month: '2025-01', balance: 50000, deposit: 0, withdrawal: 0 },
    { fund: example[1][0], month: '2025-02', balance: 50600, deposit: 0, withdrawal: 0 },
  ]);

  const about = wb.addWorksheet('About');

  about.getColumn(1).width = 100;
  [
    'How to fill this template',
    'Monthly data: one row per fund per month. Month as YYYY-MM (or a date). Balance is the statement balance at month end.',
    'Deposit / Withdrawal: money you put in or took out that month (not gains or fees).',
    'Funds (optional): fund details. Type must be one of: ' + [
      'pension_comprehensive',
      'pension_supplementary',
      'managers_insurance',
      'education_fund',
      'provident_fund',
      'investment_provident_fund',
      'self_managed',
      'savings',
      'other',
    ].join(', '),
    'Hebrew headers also work (קרן, חודש, יתרה, הפקדה, משיכה, הערה).',
  ].forEach((line, i) => (about.getCell(i + 1, 1).value = line));
  about.getRow(1).font = { bold: true };

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
