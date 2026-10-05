// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Entry-chunk size ratchet, run as the last step of `pnpm build`.
 *
 * Measures the synchronously-loaded set — every JS asset dist/index.html
 * references via <script src> or <link rel="modulepreload"> — gzipped with
 * node's own zlib so the number is identical on every platform. Fails the
 * build when the total exceeds `entryJsGzBytes` in chunk-budget.json.
 *
 * This is a RATCHET, not the goal: the baseline pins today's weight (with a
 * little minifier headroom) so the entry can only shrink, and `targetGzBytes`
 * records the real v1.0 budget (RELEASE-GATE.md, Performance). When a change
 * shrinks the entry, lower `entryJsGzBytes` in the same commit — the edit is
 * the reviewable ratchet click. Never raise it to make a red build green;
 * move the new code behind a dynamic import instead.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(join(root, 'chunk-budget.json'), 'utf8'));

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const refs = [
  ...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="(\/assets\/[^"]+\.js)"/g),
].map((m) => m[1]);

if (refs.length === 0) {
  console.error('check-entry-budget: dist/index.html references no JS assets — did the build run?');
  process.exit(1);
}

/*
 * The widget and template words (`ui.widgets.*`, `ui.templates.*`) are not in
 * the entry: en-US loads them on demand and widgets wait for them
 * (`UI_DEFERRED_GROUPS`, packages/i18n/src/resources/namespaces.ts). A module
 * on the first paint that names one would render before they are in, so an
 * entry that names one fails the build, whatever its size.
 */
const DEFERRED_KEY = /['"`]ui:(widgets|templates)\./;
const namers = refs.filter((ref) => DEFERRED_KEY.test(readFileSync(join(root, 'dist', ref), 'utf8')));
if (namers.length > 0) {
  console.error(`check-entry-budget: FAIL — the entry names a ui:widgets / ui:templates key (${namers.join(', ')}).`);
  console.error('Those words load after the first paint: read them in lazy code, or use a key the first paint has.');
  process.exit(1);
}

/*
 * The same for the four screens' groups of `common` (`COMMON_DEFERRED_GROUPS`):
 * the dashboard builder, the knowledge base, About and Team. A bare key
 * (`about.title`) reads `common`, so both spellings are refused.
 */
const DEFERRED_COMMON_KEY = /['"`](?:common:)?(builder|kb|about|team)\.[A-Za-z]/;
const commonNamers = refs.filter((ref) => DEFERRED_COMMON_KEY.test(readFileSync(join(root, 'dist', ref), 'utf8')));
if (commonNamers.length > 0) {
  console.error(`check-entry-budget: FAIL — the entry names a builder / kb / about / team key of common (${commonNamers.join(', ')}).`);
  console.error('Those words load with their screens: read them in lazy code that waits for them (i18n/commonWords.ts).');
  process.exit(1);
}

let total = 0;
for (const ref of refs) {
  const bytes = gzipSync(readFileSync(join(root, 'dist', ref))).byteLength;
  console.log(`  ${ref}  ${(bytes / 1024).toFixed(1)} KiB gz`);
  total += bytes;
}

const over = total > budget.entryJsGzBytes;
const line = `entry JS ${(total / 1024).toFixed(1)} KiB gz — ratchet ${(budget.entryJsGzBytes / 1024).toFixed(1)} KiB, v1.0 target ${(budget.targetGzBytes / 1024).toFixed(1)} KiB`;
if (over) {
  console.error(`check-entry-budget: FAIL — ${line}`);
  console.error('The entry set grew past the ratchet. Lazy-load the addition instead of raising the baseline.');
  process.exit(1);
}
console.log(`check-entry-budget: OK — ${line}`);
