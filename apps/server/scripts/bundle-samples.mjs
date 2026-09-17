#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copy the sample database seed into the published package.
 *
 *   node scripts/bundle-samples.mjs
 *
 * `adminium new --sample` builds its SQLite database with the desktop app's
 * demo seed (apps/desktop/resources/demo/demo-seed.mjs). apps/desktop is not
 * published, so the seed is copied to apps/server/samples/, which is on the
 * `files` allow-list and the first place `src/project/sample.ts` looks. In a
 * checkout nothing needs to run this: the second place it looks is the
 * desktop app itself.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(serverRoot, '..', 'desktop', 'resources', 'demo', 'demo-seed.mjs');
const target = join(serverRoot, 'samples', 'demo-seed.mjs');

if (!existsSync(source)) {
  console.error(`The demo seed is missing: ${source}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Bundled the sample database seed → ${target}`);
