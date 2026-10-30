// Loads market benchmark returns from a JSON file (default: server/data/benchmarks.json).
//   npm run benchmarks:load [-- path/to/file.json]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { benchmarkFileSchema, saveBenchmarks } from '../benchmarks';

const file = resolve(process.argv[2] ?? 'server/data/benchmarks.json');
const data = benchmarkFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
const { series, monthsAdded } = saveBenchmarks(data);

console.log(`Loaded ${series} benchmark series from ${file} (${monthsAdded} new months).`);
