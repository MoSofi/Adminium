#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit `packages/engine/ir-v1.schema.json` from `databaseModelSchema`.
 *
 *   node scripts/ir-json-schema.mjs [--check]
 *
 * WHY THIS EXISTS. The JSON IR guide has published a `$schema` URL since the
 * page was written, telling readers to point their editor at it and validate
 * before importing. No such document was ever generated: the URL 404'd, and the
 * page's own worked example was rejected in full by the parser it documents —
 * wrong key names, a missing `dialect` and `name`, and a `foreignKeys` array the
 * model has never had. A hand-written schema would drift the same way. This one
 * is derived from the Zod schema that actually validates the import, so the
 * published contract cannot disagree with the code that enforces it.
 *
 * The document itself is built by `src/ir-json-schema.ts`, so this script and
 * the drift test in `test/ir-json-schema.test.ts` cannot disagree about it.
 *
 * `--check` regenerates into memory and fails when it differs from the
 * committed file — same shape as `openapi.mjs --check`.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const OUT_FILE = join(packageRoot, 'ir-v1.schema.json');
const DIST = join(packageRoot, 'dist');

const check = process.argv.includes('--check');

if (!existsSync(join(DIST, 'ir-json-schema.js'))) {
  console.error(
    `The engine build is missing at ${DIST}.\n` +
      'Build it first: pnpm --filter @adminium/engine build',
  );
  process.exit(1);
}

const { irJsonSchemaDocument } = await import(join(DIST, 'ir-json-schema.js'));
const serialized = irJsonSchemaDocument();

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(
      `${OUT_FILE} is missing.\nGenerate it: pnpm --filter @adminium/engine run ir-schema`,
    );
    process.exit(1);
  }
  const committed = await readFile(OUT_FILE, 'utf8');
  if (committed !== serialized) {
    console.error(
      `${OUT_FILE} is STALE — the IR model no longer matches the published JSON Schema.\n` +
        'Re-generate it: pnpm --filter @adminium/engine run ir-schema',
    );
    process.exit(1);
  }
  console.log('ok — ir-v1.schema.json matches the IR model');
  process.exit(0);
}

await writeFile(OUT_FILE, serialized, 'utf8');
console.log(`Wrote ${OUT_FILE}`);
