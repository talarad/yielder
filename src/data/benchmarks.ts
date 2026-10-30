// Market data: the static benchmarks.json the monthly GitHub job keeps up to date. Loaded once,
// the first time a comparison needs it.

import { benchmarkFileSchema, type BenchmarkFile } from '../../shared/benchmarkFile';
import type { Benchmark } from '../../shared/types';

export interface BenchmarkWithReturns extends Benchmark {
  /** Official fund id at the regulator (Gemel-Net / Pensya-Net). */
  fundCode: string;
  returns: Map<string, number>;
}

export function toBenchmarks(file: BenchmarkFile): BenchmarkWithReturns[] {
  return file.map((b, i) => ({
    id: i + 1,
    provider: b.provider,
    providerHe: b.providerHe,
    type: b.fundType,
    track: b.track,
    trackHe: b.trackHe,
    fundName: b.fundName,
    fundCode: b.fundId,
    returns: new Map(b.returns.map(r => [r.month, r.return])),
  }));
}

let loading: Promise<BenchmarkWithReturns[]> | null = null;

export function loadBenchmarks(): Promise<BenchmarkWithReturns[]> {
  loading ??= fetch(`${import.meta.env?.BASE_URL ?? '/'}benchmarks.json`)
    .then(res => {
      if (!res.ok) {
        throw new Error(`Market data: ${res.status}`);
      }

      return res.json();
    })
    .then(json => toBenchmarks(benchmarkFileSchema.parse(json)))
    .catch(err => {
      // Let the next comparison try again.
      loading = null;
      throw err;
    });

  return loading;
}
