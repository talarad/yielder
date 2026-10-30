// Refreshes market data from data.gov.il right now (the server also does this every month).
//   npm run benchmarks:sync
import { currentMonth } from '../../shared/months';
import { seedBenchmarksIfEmpty, syncBenchmarks } from '../benchmarkSync';
import { recordSync } from '../repo';

seedBenchmarksIfEmpty();

try {
  const detail = await syncBenchmarks();

  recordSync(currentMonth(), true, detail);
  console.log(detail);
} catch (err) {
  recordSync(currentMonth(), false, String(err));
  console.error('Refresh failed:', err);
  process.exitCode = 1;
}
