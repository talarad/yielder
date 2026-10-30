// Market data file (public/benchmarks.json): real monthly returns of the managing companies'
// funds, from the Capital Market Authority's open data. The monthly GitHub job updates it; the
// app reads it as a static file.

import { z } from 'zod';

import { isMonth } from './months';
import { FUND_TYPES } from './types';

export const benchmarkFileSchema = z.array(
  z.object({
    provider: z.string().min(1),
    providerHe: z.string().default(''),
    fundType: z.enum(FUND_TYPES),
    track: z.string().min(1),
    trackHe: z.string().default(''),
    /** Official fund id at the regulator (Gemel-Net / Pensya-Net), used by the monthly refresh. */
    fundId: z.union([z.string(), z.number()]).transform(String).default(''),
    fundName: z.string().default(''),
    source: z.string().default(''),
    note: z.string().optional(),
    returns: z.array(
      z.object({
        month: z.string().refine(isMonth, 'month must be YYYY-MM'),
        // Monthly returns as fractions; anything beyond ±50% in a month is a unit or data error.
        return: z.number().min(-0.5).max(0.5),
      }),
    ),
  }),
);

export type BenchmarkFile = z.infer<typeof benchmarkFileSchema>;
