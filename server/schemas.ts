import { z } from 'zod';

import { FUND_STATUSES, FUND_TYPES, PERIODS } from '../shared/types';
import { isMonth } from '../shared/months';

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Use only letters, numbers, dot, dash or underscore');

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);

const fundFields = {
  name: z.string().trim().min(1, 'Name is required').max(80),
  type: z.enum(FUND_TYPES),
  provider: z.string().trim().max(60),
  track: z.string().trim().max(60),
  status: z.enum(FUND_STATUSES),
  notes: z.string().trim().max(500),
};

export const fundCreateSchema = z.object({
  ...fundFields,
  provider: fundFields.provider.default(''),
  track: fundFields.track.default(''),
  status: fundFields.status.default('active'),
  notes: fundFields.notes.default(''),
});

// No defaults here: a PATCH must only touch the fields it sends.
export const fundPatchSchema = z.object(fundFields).partial();

export const monthSchema = z.string().refine(isMonth, 'Month must be YYYY-MM');

const money = z.number().min(0, 'Must be zero or more').max(1e11);

export const entryBodySchema = z.object({
  balance: money,
  deposit: money.default(0),
  withdrawal: money.default(0),
  comment: z.string().trim().max(300).default(''),
});

// A deposit and/or withdrawal applied to every existing month from..to.
export const rangeFlowSchema = z
  .object({ from: monthSchema, to: monthSchema, deposit: money.optional(), withdrawal: money.optional() })
  .refine(b => b.deposit !== undefined || b.withdrawal !== undefined, 'Give a deposit or a withdrawal');

export const importCommitSchema = z.object({
  funds: z
    .array(
      fundCreateSchema.extend({
        targetFundId: z.number().int().positive().nullable(),
        entries: z.array(entryBodySchema.extend({ month: monthSchema })).max(2400),
      }),
    )
    .min(1, 'Nothing to import')
    .max(100),
});

export const periodSchema = z.enum(PERIODS);
