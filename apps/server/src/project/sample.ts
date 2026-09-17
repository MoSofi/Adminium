// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sample database `adminium new --sample` creates.
 *
 * It is the desktop app's demo company: a deterministic SQLite seed that
 * exercises every page type the generator makes. The seed script ships inside
 * the published package (`samples/`, copied there at pack time by
 * `scripts/bundle-samples.mjs`); in a checkout it is read from the desktop app.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import { CliError } from '../cli/exit.js';

export const SAMPLE_SEED_FILE = 'demo-seed.mjs';

/** Where the seed script can be, most specific first. */
export function sampleSeedCandidates(moduleUrl: string = import.meta.url): string[] {
  const packageRoot = resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
  return [
    join(packageRoot, 'samples', SAMPLE_SEED_FILE),
    join(packageRoot, '..', 'desktop', 'resources', 'demo', SAMPLE_SEED_FILE),
  ];
}

interface DemoSeeder {
  createDemoDatabase(opts: { file: string; Database: typeof Database }): Record<string, number>;
}

/** Create the sample database at `file` (a new file). Returns row counts by table. */
export async function createSampleDatabase(
  file: string,
  candidates: readonly string[] = sampleSeedCandidates(),
): Promise<Record<string, number>> {
  const script = candidates.find((candidate) => existsSync(candidate));
  if (script === undefined) {
    throw new CliError('The sample database is not included in this Adminium build.', {
      hint: 'Create the project without --sample and point DATABASE_URL at your own database.',
    });
  }
  const seeder = (await import(pathToFileURL(script).href)) as Partial<DemoSeeder>;
  if (typeof seeder.createDemoDatabase !== 'function') {
    throw new CliError(`${script} does not export createDemoDatabase().`);
  }
  mkdirSync(dirname(file), { recursive: true });
  return seeder.createDemoDatabase({ file, Database });
}
