import { Router } from 'express';

import { currentUser } from '../auth';
import { HttpError, idParam, parse } from '../http';
import { currentMonth } from '../../shared/months';
import { fundDetail, summarizeFund } from '../lib/yields';
import {
  createFund,
  deleteEntry,
  deleteFund,
  entriesByFund,
  fundsWithEntries,
  getFund,
  setFlowsInRange,
  touchFund,
  updateFund,
  upsertEntry,
} from '../repo';
import { entryBodySchema, fundCreateSchema, fundPatchSchema, monthSchema, rangeFlowSchema } from '../schemas';

export const fundsRouter = Router();

function detailFor(userId: number, id: number) {
  const fund = getFund(userId, id);

  if (!fund) {
    throw new HttpError(404, 'Fund not found', 'not_found');
  }

  return fundDetail(fund, entriesByFund([id]).get(id)!, currentMonth());
}

fundsRouter.get('/', (_req, res) => {
  const today = currentMonth();

  res.json(fundsWithEntries(currentUser(res).id).map(({ fund, entries }) => summarizeFund(fund, entries, today)));
});

fundsRouter.post('/', (req, res) => {
  const fund = createFund(currentUser(res).id, parse(fundCreateSchema, req.body));

  res.status(201).json(summarizeFund(fund, [], currentMonth()));
});

fundsRouter.get('/:id', (req, res) => {
  res.json(detailFor(currentUser(res).id, idParam(req.params.id)));
});

fundsRouter.patch('/:id', (req, res) => {
  const userId = currentUser(res).id;
  const id = idParam(req.params.id);

  if (!updateFund(userId, id, parse(fundPatchSchema, req.body))) {
    throw new HttpError(404, 'Fund not found', 'not_found');
  }

  res.json(detailFor(userId, id));
});

fundsRouter.delete('/:id', (req, res) => {
  if (!deleteFund(currentUser(res).id, idParam(req.params.id))) {
    throw new HttpError(404, 'Fund not found', 'not_found');
  }

  res.status(204).end();
});

fundsRouter.put('/:id/entries/:month', (req, res) => {
  const userId = currentUser(res).id;
  const id = idParam(req.params.id);
  const month = parse(monthSchema, req.params.month);

  if (!getFund(userId, id)) {
    throw new HttpError(404, 'Fund not found', 'not_found');
  }

  upsertEntry(id, { month, ...parse(entryBodySchema, req.body) });
  touchFund(id);
  res.json(detailFor(userId, id));
});

// Sets the same deposit and/or withdrawal on every existing month in a range ("I deposit 5,000 every month").
fundsRouter.patch('/:id/entries', (req, res) => {
  const userId = currentUser(res).id;
  const id = idParam(req.params.id);
  const body = parse(rangeFlowSchema, req.body);

  if (!getFund(userId, id)) {
    throw new HttpError(404, 'Fund not found', 'not_found');
  }

  const [from, to] = body.from <= body.to ? [body.from, body.to] : [body.to, body.from];

  setFlowsInRange(id, from, to, { deposit: body.deposit, withdrawal: body.withdrawal });
  touchFund(id);
  res.json(detailFor(userId, id));
});

fundsRouter.delete('/:id/entries/:month', (req, res) => {
  const userId = currentUser(res).id;
  const id = idParam(req.params.id);

  if (!getFund(userId, id) || !deleteEntry(id, parse(monthSchema, req.params.month))) {
    throw new HttpError(404, 'Entry not found', 'not_found');
  }

  touchFund(id);
  res.json(detailFor(userId, id));
});
