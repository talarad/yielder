// Market benchmark data: validation and saving. The fetcher (benchmarkSync.ts) and the manual
// loader script both go through saveBenchmarks().

import { z } from 'zod';

import { FUND_TYPES } from '../shared/types';
import { isMonth } from '../shared/months';
import { transaction } from './db';
import { saveBenchmark } from './repo';

export const benchmarkFileSchema = z.array(
  z.object({
    provider: z.string().min(1),
    providerHe: z.string().default(''),
    fundType: z.enum(FUND_TYPES),
    track: z.string().min(1),
    trackHe: z.string().default(''),
    fundId: z.union([z.string(), z.number()]).transform(String).default(''),
    fundName: z.string().default(''),
    source: z.string().default(''),
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

export function saveBenchmarks(data: BenchmarkFile): { series: number; monthsAdded: number } {
  let monthsAdded = 0;

  transaction(() => {
    for (const b of data) {
      const { added } = saveBenchmark(
        {
          provider: b.provider,
          providerHe: b.providerHe,
          type: b.fundType,
          track: b.track,
          trackHe: b.trackHe,
          fundCode: b.fundId,
          fundName: b.fundName,
          source: b.source,
        },
        b.returns,
      );

      monthsAdded += added;
    }
  });

  return { series: data.length, monthsAdded };
}
