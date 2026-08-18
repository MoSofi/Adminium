#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit `packages/ui/src/components/icon/icon-core.ts` — the lucide icons the
 * product itself renders, as named imports.
 *
 *   node scripts/gen-icon-core.mjs [--check]
 *
 * WHY. `packages/ui`'s `Icon` and the dashboard's `lucideByName` both resolved
 * an icon from a runtime name, and both did it by importing lucide's whole
 * `icons` map. A map lookup is opaque to a bundler, so all 1,611 icon modules
 * landed in the dashboard's ENTRY chunk — 112.6 KiB gzipped, measured, on every
 * cold load, for the ~90 icons the product actually draws. `sideEffects: false`
 * does not help: the import is genuinely of the whole object.
 *
 * So the names the product uses are collected here and emitted as named imports
 * that a bundler CAN shake, and the full catalogue moves behind a dynamic
 * import that only an icon outside this set pulls in (`icon-resolver.ts`).
 *
 * WHAT IS COLLECTED, and why each source is one:
 *
 *  - `<Icon name="X" />` literals — the design-system component's own callers;
 *  - `lucideByName('x')` literals — the same, by kebab name;
 *  - the two icon pickers' curated lists — everything an admin can choose
 *    WITHOUT searching, which is the common path and must not fetch a chunk;
 *  - the engine's archetype nav icons — what a freshly generated app renders
 *    before anyone has chosen anything.
 *
 * Anything else an admin picks by searching the full catalogue still works: it
 * misses this set, `icon-resolver.ts` loads lucide lazily, and the icon appears.
 * That is a chunk fetch on a page whose icon was hand-picked, not on boot.
 *
 * Names that are not real lucide icons are dropped rather than emitted — several
 * unrelated vocabularies in this repo also have an `icon:` field (activity-feed
 * kinds, widget config), and a fabricated import would not compile.
 *
 * `--check` fails when the committed file differs, same shape as
 * `openapi.mjs --check`. `packages/ui`'s `icon-core.test.ts` asserts the same
 * completeness from the other side.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(repoRoot, 'packages', 'ui', 'src', 'components', 'icon', 'icon-core.ts');

const check = process.argv.includes('--check');

const SCAN_ROOTS = [
  'apps/dashboard/src',
  'apps/desktop/src',
  'packages/ui/src',
  'packages/widgets/src',
  'packages/charts/src',
  'packages/engine/src',
];

/** Files whose curated arrays are icon vocabularies in full. */
const LIST_SOURCES = [
  ['apps/dashboard/src/studio/pages/IconPicker.tsx', /ICON_SHORTLIST[\s\S]*?\n\];/],
  ['apps/dashboard/src/studio/remap/IconPicker.tsx', /ICON_SUBSET[\s\S]*?\n\];/],
  ['packages/engine/src/generate/archetype.ts', /[\s\S]*/],
  ['packages/engine/src/generate/dashboard.ts', /[\s\S]*/],
];

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** `bar-chart-3` → `BarChart3`; lucide's `icons` map is keyed PascalCase. */
function pascalCase(kebab) {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * Always core, whatever the scan finds.
 *
 * The directional glyphs `Icon`'s own docblock names for `rtlMirror`. They are
 * the ones a caller reaches for by name when building chrome, they are tiny,
 * and an arrow that appears a frame after the row it belongs to is a visible
 * stutter in exactly the dense UI they are used in.
 */
const ALWAYS_CORE = [
  'ArrowLeft',
  'ArrowRight',
  'ChevronDown',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'CornerDownLeft',
  'CornerUpLeft',
  'LogIn',
  'LogOut',
  'Redo2',
  'Undo2',
];

const names = new Set(ALWAYS_CORE);

for (const root of SCAN_ROOTS) {
  for (const file of sourceFiles(join(repoRoot, root))) {
    const source = readFileSync(file, 'utf8');
    // `<Icon name="X" />`, `<Icon name={'X'} />`, `<Icon name={c ? 'A' : 'B'} />`
    for (const tag of source.matchAll(/<Icon\b[^>]*?\bname=(?:"([A-Za-z0-9]+)"|\{([^}]*)\})/g)) {
      if (tag[1] !== undefined) names.add(tag[1]);
      for (const literal of (tag[2] ?? '').matchAll(/'([A-Za-z0-9]+)'/g)) names.add(literal[1]);
    }
    // `icon: 'Database'` (an `IconName` field) and `icon: 'bar-chart-3'` (kebab,
    // resolved through `lucideByName`). Both shapes appear; both are filtered
    // against the real catalogue below, so over-collecting costs nothing.
    for (const match of source.matchAll(/\bicon:\s*['"]([A-Za-z][A-Za-z0-9-]*)['"]/g)) {
      names.add(match[1]);
      names.add(pascalCase(match[1]));
    }
    for (const match of source.matchAll(/lucideByName\(\s*'([a-z0-9-]+)'/g))
      names.add(pascalCase(match[1]));
  }
}

for (const [relative, section] of LIST_SOURCES) {
  const file = join(repoRoot, relative);
  if (!existsSync(file)) continue;
  const block = section.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
  for (const match of block.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/g))
    names.add(pascalCase(match[1]));
}

// Resolve against the real export list — the scans above deliberately over-collect.
// lucide is a dependency of `packages/ui`, not of the repo root, so resolve it
// from the package that owns it rather than from this script's own graph.
const requireFromUi = createRequire(join(repoRoot, 'packages', 'ui', 'package.json'));
const lucide = await import(pathToFileURL(requireFromUi.resolve('lucide-react')).href);
// A lucide icon is a `forwardRef` exotic component — an OBJECT, not a function.
const catalogue = lucide.icons ?? lucide.default?.icons ?? {};
const isIcon = (name) => Object.hasOwn(catalogue, name) && catalogue[name] != null;
const real = [...names].filter(isIcon).sort();
const dropped = [...names].filter((name) => !isIcon(name)).sort();

if (real.length < 60) {
  console.error(
    `Only ${String(real.length)} icons collected — the scan is broken, not the product. Refusing to write.`,
  );
  process.exit(1);
}

const serialized = `// SPDX-License-Identifier: AGPL-3.0-only
// GENERATED by scripts/gen-icon-core.mjs — do not edit.
//
// The lucide icons this product renders, as NAMED imports so a bundler can
// shake the other ~1,520. Importing lucide's \`icons\` map instead put all 1,611
// into the dashboard's entry chunk: 112.6 KiB gzipped, measured, for these ${String(real.length)}.
//
// An icon outside this set still resolves — \`icon-resolver.ts\` loads the full
// catalogue on demand — it just costs a chunk fetch the first time.
import {
${real.map((name) => `  ${name},`).join('\n')}
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const CORE_ICONS: Readonly<Record<string, LucideIcon>> = {
${real.map((name) => `  ${name},`).join('\n')}
};
`;

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(`${OUT_FILE} is missing.\nGenerate it: pnpm run icon-core`);
    process.exit(1);
  }
  if (readFileSync(OUT_FILE, 'utf8') !== serialized) {
    console.error(
      'packages/ui/src/components/icon/icon-core.ts is STALE — the product renders icons it does not statically import.\n' +
        'Re-generate it: pnpm run icon-core',
    );
    process.exit(1);
  }
  console.log(`ok — icon-core.ts covers all ${String(real.length)} product icons`);
  process.exit(0);
}

writeFileSync(OUT_FILE, serialized, 'utf8');
console.log(`Wrote ${OUT_FILE} (${String(real.length)} icons; dropped ${String(dropped.length)} non-lucide names)`);
