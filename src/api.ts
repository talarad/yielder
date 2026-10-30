// Everything the pages ask for, computed in the browser from the open data file. There is no
// server: the functions keep the async shape the pages (and React Query) already use.

import { z } from 'zod';

import { AppError, parse } from '../shared/errors';
import { normalizeName } from '../shared/fundTypes';
import { currentMonth } from '../shared/months';
import { entryBodySchema, fundCreateSchema, fundPatchSchema, importCommitSchema, monthSchema, periodSchema, rangeFlowSchema } from '../shared/schemas';
import type {
  CompareResult,
  Entry,
  FundDetail,
  FundInput,
  FundSummary,
  ImportCommitFund,
  ImportPreview,
  ImportResult,
  Period,
  Portfolio,
  User,
} from '../shared/types';
import { buildPortfolio, fundDetail, summarizeFund } from '../shared/yields';
import { loadBenchmarks } from './data/benchmarks';
import { compareFunds } from './data/compare';
import { currentWorkspace, replaceData, resumeWorkspace, workspace } from './data/workspace';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const notFound = () => new AppError('Fund not found', 'not_found');

function detail(id: number): FundDetail {
  const { repo } = workspace();
  const fund = repo.getFund(id);

  if (!fund) {
    throw notFound();
  }

  return fundDetail(fund, repo.entriesOf(id), currentMonth());
}

function userOf(ws = workspace()): User {
  const { account, kind } = ws.backend;

  return { email: account.email ?? '', displayName: ws.repo.getMeta('display_name') || account.name, storage: kind };
}

/** Hands a file to the browser's download. */
function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });

  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const today = () => new Date().toISOString().slice(0, 10);

export const api = {
  /** The person whose file is open; after a reload, reopens the same storage when that needs no click. */
  me: async (): Promise<User | null> => {
    const ws = currentWorkspace() ?? (await resumeWorkspace());

    return ws ? userOf(ws) : null;
  },
  updateMe: async (patch: { displayName: string }): Promise<User> => {
    const name = parse(z.string().trim().max(60), patch.displayName);

    workspace().change(repo => repo.setMeta('display_name', name));

    return userOf();
  },

  funds: async (): Promise<FundSummary[]> =>
    workspace()
      .repo.fundsWithEntries()
      .map(({ fund, entries }) => summarizeFund(fund, entries, currentMonth())),
  fund: async (id: number): Promise<FundDetail> => detail(id),
  createFund: async (input: FundInput): Promise<FundSummary> => {
    const fields = parse(fundCreateSchema, input);
    const fund = workspace().change(repo => repo.createFund(fields));

    return summarizeFund(fund, [], currentMonth());
  },
  updateFund: async (id: number, patch: Partial<FundInput>): Promise<FundDetail> => {
    const fields = parse(fundPatchSchema, patch);

    workspace().change(repo => {
      if (!repo.updateFund(id, fields)) {
        throw notFound();
      }
    });

    return detail(id);
  },
  deleteFund: async (id: number): Promise<void> => {
    workspace().change(repo => {
      if (!repo.deleteFund(id)) {
        throw notFound();
      }
    });
  },
  saveEntry: async (id: number, { month, ...body }: Entry): Promise<FundDetail> => {
    const entry = { month: parse(monthSchema, month), ...parse(entryBodySchema, body) };

    workspace().change(repo => {
      if (!repo.getFund(id)) {
        throw notFound();
      }

      repo.upsertEntry(id, entry);
      repo.touchFund(id);
    });

    return detail(id);
  },
  deleteEntry: async (id: number, month: string): Promise<FundDetail> => {
    workspace().change(repo => {
      if (!repo.getFund(id) || !repo.deleteEntry(id, month)) {
        throw new AppError('Entry not found', 'not_found');
      }

      repo.touchFund(id);
    });

    return detail(id);
  },
  /** Sets the same deposit and/or withdrawal on every existing month in a range ("I deposit 5,000 every month"). */
  setRangeFlows: async (id: number, body: { from: string; to: string; deposit?: number; withdrawal?: number }): Promise<FundDetail> => {
    const range = parse(rangeFlowSchema, body);
    const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];

    workspace().change(repo => {
      if (!repo.getFund(id)) {
        throw notFound();
      }

      repo.setFlowsInRange(id, from, to, { deposit: range.deposit, withdrawal: range.withdrawal });
      repo.touchFund(id);
    });

    return detail(id);
  },
  /** Every fund with its months, for filling in one month across all funds. */
  monthSheet: async (): Promise<Array<{ fund: FundSummary; entries: Entry[] }>> =>
    workspace()
      .repo.fundsWithEntries()
      .map(({ fund, entries }) => ({ fund: summarizeFund(fund, entries, currentMonth()), entries })),
  /** Saves one month for several funds at once. An existing month keeps its comment. */
  saveMonth: async (month: string, rows: Array<{ fundId: number; balance: number; deposit: number; withdrawal: number }>): Promise<void> => {
    const m = parse(monthSchema, month);
    const bodies = rows.map(({ fundId, ...body }) => ({ fundId, ...parse(entryBodySchema.omit({ comment: true }), body) }));

    workspace().change(repo => {
      for (const { fundId, ...body } of bodies) {
        if (!repo.getFund(fundId)) {
          throw notFound();
        }

        const comment = repo.entriesOf(fundId).find(e => e.month === m)?.comment ?? '';

        repo.upsertEntry(fundId, { month: m, ...body, comment });
        repo.touchFund(fundId);
      }
    });
  },

  portfolio: async (): Promise<Portfolio> => buildPortfolio(workspace().repo.fundsWithEntries(), currentMonth()),
  compare: async (period: Period): Promise<CompareResult> =>
    compareFunds(workspace().repo.fundsWithEntries(), await loadBenchmarks(), parse(periodSchema, period)),

  importPreview: async (file: File): Promise<ImportPreview> => {
    // The Excel library is big: it loads only when someone imports or exports.
    const { parseWorkbook } = await import('../shared/excel');
    let parsed;

    try {
      parsed = await parseWorkbook(await file.arrayBuffer());
    } catch {
      throw new AppError("Couldn't read this file. Save it as .xlsx and try again.", 'bad_file');
    }

    const existing = new Map(workspace().repo.fundsWithEntries().map(f => [normalizeName(f.fund.name), f]));

    return {
      format: parsed.format,
      warnings: parsed.warnings,
      funds: parsed.funds.map((f, i) => {
        const match = existing.get(normalizeName(f.name));
        const current = new Map(match?.entries.map(e => [e.month, e]));
        let newMonths = 0;
        let changedMonths = 0;

        for (const e of f.entries) {
          const prev = current.get(e.month);

          if (!prev) {
            newMonths++;
          } else if (prev.balance !== e.balance || prev.deposit !== e.deposit || prev.withdrawal !== e.withdrawal) {
            changedMonths++;
          }
        }

        return {
          ...f,
          key: String(i),
          firstMonth: f.entries[0]?.month ?? null,
          lastMonth: f.entries[f.entries.length - 1]?.month ?? null,
          existingFundId: match?.fund.id ?? null,
          newMonths,
          changedMonths,
        };
      }),
    };
  },
  importCommit: async (funds: ImportCommitFund[]): Promise<ImportResult> => {
    const { funds: list } = parse(importCommitSchema, { funds });
    const result: ImportResult = { createdFunds: 0, updatedFunds: 0, insertedMonths: 0, updatedMonths: 0 };

    workspace().change(repo => {
      for (const { targetFundId, entries, ...input } of list) {
        let fundId: number;

        if (targetFundId !== null) {
          if (!repo.getFund(targetFundId)) {
            throw notFound();
          }

          fundId = targetFundId;
          result.updatedFunds++;
        } else {
          fundId = repo.createFund(input).id;
          result.createdFunds++;
        }

        for (const e of entries) {
          const outcome = repo.upsertEntry(fundId, e);

          if (outcome === 'inserted') {
            result.insertedMonths++;
          } else if (outcome === 'updated') {
            result.updatedMonths++;
          }
        }

        repo.touchFund(fundId);
      }
    });

    return result;
  },

  downloadExport: async () => {
    const { buildExport } = await import('../shared/excel');
    const { repo } = workspace();
    const details = repo.fundsWithEntries().map(({ fund, entries }) => fundDetail(fund, entries, currentMonth()));

    download(`yielder-export-${today()}.xlsx`, await buildExport(details), XLSX);
  },
  downloadTemplate: async () => {
    const { buildTemplate } = await import('../shared/excel');

    download('yielder-template.xlsx', await buildTemplate(), XLSX);
  },
  /** The whole data file, to keep as a backup or open again later. */
  downloadData: async () => download(`yielder-data-${today()}.db`, workspace().db.export(), 'application/x-sqlite3'),
  /** Replaces all data with a Yielder file (also the old server database). */
  openDataFile: async (file: File) => replaceData(new Uint8Array(await file.arrayBuffer())),
};
