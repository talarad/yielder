// Portfolio, comparison and Excel import/export.

import express, { Router } from 'express';

import type { ImportPreview, ImportResult } from '../../shared/types';
import { currentUser } from '../auth';
import { compareUser } from '../compare';
import { transaction } from '../db';
import { HttpError, parse } from '../http';
import { buildExport, buildTemplate, parseWorkbook } from '../lib/excel';
import { normalizeName } from '../lib/fundTypes';
import { currentMonth } from '../../shared/months';
import { buildPortfolio, fundDetail } from '../lib/yields';
import { createFund, fundsWithEntries, getFund, touchFund, upsertEntry } from '../repo';
import { importCommitSchema, periodSchema } from '../schemas';

export const dataRouter = Router();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

dataRouter.get('/portfolio', (_req, res) => {
  res.json(buildPortfolio(fundsWithEntries(currentUser(res).id), currentMonth()));
});

dataRouter.get('/compare', (req, res) => {
  res.json(compareUser(currentUser(res).id, parse(periodSchema, req.query.period ?? '1Y')));
});

dataRouter.post('/import/preview', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new HttpError(400, 'Upload an Excel file (.xlsx)', 'no_file');
  }

  let parsed;

  try {
    parsed = await parseWorkbook(req.body);
  } catch {
    throw new HttpError(400, "Couldn't read this file. Save it as .xlsx and try again.", 'bad_file');
  }

  const existing = new Map(fundsWithEntries(currentUser(res).id).map(f => [normalizeName(f.fund.name), f]));
  const preview: ImportPreview = {
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

  res.json(preview);
});

dataRouter.post('/import/commit', (req, res) => {
  const userId = currentUser(res).id;
  const { funds } = parse(importCommitSchema, req.body);
  const result: ImportResult = { createdFunds: 0, updatedFunds: 0, insertedMonths: 0, updatedMonths: 0 };

  transaction(() => {
    for (const { targetFundId, entries, ...input } of funds) {
      let fundId: number;

      if (targetFundId !== null) {
        if (!getFund(userId, targetFundId)) {
          throw new HttpError(404, `Fund ${targetFundId} not found`, 'not_found');
        }

        fundId = targetFundId;
        result.updatedFunds++;
      } else {
        fundId = createFund(userId, input).id;
        result.createdFunds++;
      }

      for (const e of entries) {
        const outcome = upsertEntry(fundId, e);

        if (outcome === 'inserted') {
          result.insertedMonths++;
        } else if (outcome === 'updated') {
          result.updatedMonths++;
        }
      }

      touchFund(fundId);
    }
  });

  res.json(result);
});

function sendXlsx(res: express.Response, filename: string, data: Buffer) {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(data);
}

dataRouter.get('/export', async (_req, res) => {
  const today = currentMonth();
  const details = fundsWithEntries(currentUser(res).id).map(({ fund, entries }) => fundDetail(fund, entries, today));

  sendXlsx(res, `yielder-export-${new Date().toISOString().slice(0, 10)}.xlsx`, await buildExport(details));
});

dataRouter.get('/template', async (_req, res) => {
  sendXlsx(res, 'yielder-template.xlsx', await buildTemplate());
});
