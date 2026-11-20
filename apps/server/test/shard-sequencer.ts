// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI's server shards, balanced by how long each file takes.
 *
 * vitest's own `--shard=i/n` sorts the files by a hash of their path and cuts
 * the list into equal COUNTS. Counts are not time here: one email suite takes
 * six minutes and most files take seconds. On 2026-11-20, with MySQL on, the
 * hash gave one of four shards the heaviest email suites — 3,681 s of tests
 * against 2,005-2,277 s for the others — and that shard was cut at its
 * 40-minute limit while the rest finished in 27-29.
 *
 * So each file is weighed by its measured duration in `shard-timings.json`
 * plus a fixed cost for importing and collecting it, and the files are dealt
 * heaviest first to the lightest shard so far (longest-processing-time first).
 * Every shard computes the same deal from the same list, so together they run
 * each file exactly once. A file the timings do not know yet weighs the median.
 *
 * The timings are refreshed from a run: `suite (server)` uploads a
 * `server-shard-timings` artifact (see scripts/shard-timings.mjs).
 */
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Import + collect per file, measured on a runner: 755 s of collect, transform
 * and prepare over 321 files in one shard on 2026-11-20.
 */
export const PER_FILE_MS = 2_400;

const TIMINGS = fileURLToPath(new URL('./shard-timings.json', import.meta.url));

export function readTimings(path: string = TIMINGS): Record<string, number> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  } catch {
    // No timings is no reason to stop a run: every file then weighs the same.
    return {};
  }
}

/**
 * Which of `count` shards each path goes to (0-based), dealt heaviest first.
 * Ties break on the path, so the deal never depends on the order of `paths`.
 */
export function balance(paths: readonly string[], timings: Record<string, number>, count: number): Map<string, number> {
  const known = Object.values(timings).sort((a, b) => a - b);
  const fallback = known.length === 0 ? 0 : known[Math.floor(known.length / 2)]!;
  const weighed = [...new Set(paths)]
    .map((path) => ({ path, weight: (timings[path] ?? fallback) + PER_FILE_MS }))
    .sort((a, b) => b.weight - a.weight || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const loads = new Array<number>(count).fill(0);
  const dealt = new Map<string, number>();
  for (const { path, weight } of weighed) {
    let lightest = 0;
    for (let i = 1; i < count; i++) if (loads[i]! < loads[lightest]!) lightest = i;
    loads[lightest]! += weight;
    dealt.set(path, lightest);
  }
  return dealt;
}

export class ShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { shard, root } = this.ctx.config;
    if (!shard) return files;
    const pathOf = (spec: TestSpecification) => relative(root, spec.moduleId).split(sep).join('/');
    const dealt = balance(files.map(pathOf), readTimings(), shard.count);
    return files.filter((spec) => dealt.get(pathOf(spec)) === shard.index - 1);
  }
}
