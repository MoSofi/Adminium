/**
 * gen-barrel — regenerates src/index.ts from the package's local barrels.
 *
 * Collected, in order: src/lib/index.ts, src/theme/index.ts, then every
 * src/components/<dir>/index.ts (sorted). Component agents add a local
 * index.ts inside their own directory and NEVER touch src/index.ts — this
 * script (run as part of `build`/`typecheck`, or manually via
 * `pnpm gen:barrel`) is the only writer.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** @type {string[]} module specifiers relative to src/, extensionless dir paths */
const entries = [];

for (const dir of ['lib', 'theme']) {
  if (existsSync(join(srcDir, dir, 'index.ts'))) entries.push(`./${dir}/index.js`);
}

const componentsDir = join(srcDir, 'components');
if (existsSync(componentsDir)) {
  const componentDirs = readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of componentDirs) {
    if (existsSync(join(componentsDir, name, 'index.ts'))) {
      entries.push(`./components/${name}/index.js`);
    }
  }
}

const banner =
  '// GENERATED — pnpm gen:barrel\n' +
  '// Do not edit by hand: scripts/gen-barrel.mjs rewrites this file on every build.\n' +
  '// Add exports via a local index.ts in your component directory instead.\n';
const body = entries.map((specifier) => `export * from '${specifier}';`).join('\n');
const next = `${banner}${body}\n`;

const barrelPath = join(srcDir, 'index.ts');
const current = existsSync(barrelPath) ? readFileSync(barrelPath, 'utf8') : null;
if (current !== next) {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(barrelPath, next);
}
