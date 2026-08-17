// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Re-records `fixtures/northwind.pages.baseline.json` from the CURRENT
 * generator output — a DELIBERATE act (see generate-baseline.test.ts: the
 * fixture pins crud byte-identity plus the last intended dashboard baseline,
 * so re-recording belongs in the same commit as the change that moves it).
 *
 *   pnpm --filter @adminium/engine build && node test/record-baseline.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { applyClassification, generatePages, parseDatabaseModel } from '../dist/index.js';

const modelPath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const baselinePath = fileURLToPath(
  new URL('./fixtures/northwind.pages.baseline.json', import.meta.url),
);

const model = applyClassification(parseDatabaseModel(readFileSync(modelPath, 'utf8')));
const CONN = 'conn_01HZX0000000000000000000';

const baseline = {};
for (const intent of ['full-admin', 'read-only-analytics', 'crud']) {
  const result = generatePages(model, { connectionId: CONN, intent });
  baseline[intent] = {
    // Archetype pages are pinned by generate-archetypes.test.ts, not here.
    pages: result.pages.filter(
      (page) => page.template === 'page-crud' || page.template === 'page-dashboard',
    ),
    warnings: result.warnings,
  };
}

writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`re-recorded ${baselinePath}`);
