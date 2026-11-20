// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write test/shard-timings.json from a vitest JSON report: each test file's
 * duration in milliseconds, keyed by its path from apps/server. The CI shards
 * are dealt by these numbers (test/shard-sequencer.ts).
 *
 * `suite (server)` runs this over the merged report of every shard and
 * uploads the result as the `server-shard-timings` artifact. To refresh the
 * committed file, take it from a run that had MySQL on (the nightly, or a
 * dispatch with `mysql`), since those are the runs the limit has to fit:
 *
 *   gh run download <run id> -n server-shard-timings -D apps/server/test
 *
 * Usage (from apps/server): node scripts/shard-timings.mjs <report.json> [out]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import process from 'node:process';

const [report, out = 'test/shard-timings.json'] = process.argv.slice(2);
if (!report) {
  process.stderr.write('usage: node scripts/shard-timings.mjs <vitest json report> [out]\n');
  process.exit(2);
}

const { testResults } = JSON.parse(readFileSync(report, 'utf8'));
const timings = {};
for (const file of testResults) {
  const path = relative(process.cwd(), file.name).split(sep).join('/');
  // Rounded to a tenth of a second, so a refresh does not rewrite every line.
  timings[path] = Math.round(Math.max(0, file.endTime - file.startTime) / 100) * 100;
}
const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
process.stdout.write(`${Object.keys(sorted).length} files timed into ${out}\n`);
