#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit `apps/server/schemas/{page,schema,config}.json`: the JSON Schemas a
 * project's files point at with `$schema`, so an editor can complete them.
 *
 *   node scripts/project-schemas.mjs [--check]
 *
 * They are derived from the Zod schemas the server validates project files
 * with (`src/project/file-schemas.ts`), so the published contract cannot
 * disagree with the code. They ship in the npm package, which is where
 * `node_modules/@adminiumjs/adminium/schemas/page.json` resolves.
 *
 * `--check` regenerates in memory and fails when a committed file differs,
 * the same shape as `openapi.mjs --check`.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(packageRoot, 'schemas');
const BUILT = join(packageRoot, 'dist', 'project', 'file-schemas.js');
const check = process.argv.includes('--check');

if (!existsSync(BUILT)) {
  console.error(`The server build is missing at ${BUILT}.\nBuild it first: pnpm --filter @adminium/server build`);
  process.exit(1);
}

const { projectJsonSchemaDocuments } = await import(BUILT);
const documents = projectJsonSchemaDocuments();

if (check) {
  const stale = [];
  for (const [name, text] of Object.entries(documents)) {
    const file = join(OUT_DIR, name);
    const committed = existsSync(file) ? await readFile(file, 'utf8') : null;
    if (committed !== text) stale.push(name);
  }
  if (stale.length > 0) {
    console.error(
      `schemas/${stale.join(', schemas/')} no longer match the project file schemas.\n` +
        'Re-generate them: pnpm --filter @adminium/server run project-schemas',
    );
    process.exit(1);
  }
  console.log(`ok — ${String(Object.keys(documents).length)} project file schemas are current`);
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
for (const [name, text] of Object.entries(documents)) {
  await writeFile(join(OUT_DIR, name), text, 'utf8');
  console.log(`Wrote schemas/${name}`);
}
