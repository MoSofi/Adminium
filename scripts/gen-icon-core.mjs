#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emit the two generated halves of `packages/ui/src/components/icon/`:
 *
 *   icon-core.ts   the lucide icons the product renders, as named imports
 *   icon-names.ts  every lucide name, as data (`LUCIDE_ICON_NAMES`)
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
 * `icon-names.ts` is the other half of the same idea: the validators that need
 * to know whether a string IS an icon (the LLM referential check, §7.3) need the
 * NAMES, never the components. Emitting them as data keeps that question
 * answerable without a single icon module being reachable from the importer.
 *
 * WHAT IS COLLECTED, and why each source is one:
 *
 *  - `<Icon name="X" />` literals — the design-system component's own callers;
 *  - `lucideByName('x')` literals — the same, by kebab name;
 *  - the two icon pickers' curated lists — everything an admin can choose
 *    WITHOUT searching, which is the common path and must not fetch a chunk;
 *  - the engine's + the LLM normalizer's nav icons — what a freshly generated
 *    app renders before anyone has chosen anything.
 *
 * Anything else an admin picks by searching the full catalogue still works: it
 * misses this set, `icon-resolver.ts` loads lucide lazily, and the icon appears.
 * That is a chunk fetch on a page whose icon was hand-picked, not on boot.
 *
 * ─── THE SCAN OVER-COLLECTS, AND THAT USED TO HIDE BUGS ─────────────────────
 *
 * Several unrelated vocabularies in this repo also have an `icon:` field
 * (activity-feed kinds, KPI tones, the page-builder's own local glyph map), so
 * a name that is not in lucide's catalogue is dropped rather than emitted — a
 * fabricated import would not compile. That drop was SILENT: the count appeared
 * in the write-mode log and nowhere else, never in `--check`, and never by name.
 *
 * `kanban-square` sat in the engine's nav vocabulary for the whole of M5 because
 * of it. lucide renamed that icon to `square-kanban`, and the old name survives
 * only as a deprecated named EXPORT — it is absent from the `icons` map, which
 * is the map `lucideByName`/`useLucideIcon` resolve through. So every generated
 * app with a workflow-shaped table drew the `File` fallback AND paid a 133.6 KiB
 * gzipped catalogue fetch on first paint to discover the name was dead.
 *
 * Hence {@link STRICT_SOURCES}: the sources whose every name is DECLARED to be a
 * lucide icon. A miss there is a bug and fails this script — by name, with the
 * file it came from, and with the canonical rename when lucide still carries the
 * old name as an alias. Everything else stays best-effort, as it must.
 *
 * `--check` fails when either committed file differs, same shape as
 * `openapi.mjs --check`. `packages/ui`'s `icon-core.test.ts` asserts the same
 * completeness from the other side.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(repoRoot, 'packages', 'ui', 'src', 'components', 'icon');
const OUT_FILE = join(ICON_DIR, 'icon-core.ts');
const NAMES_FILE = join(ICON_DIR, 'icon-names.ts');

const check = process.argv.includes('--check');

const SCAN_ROOTS = [
  'apps/dashboard/src',
  'apps/desktop/src',
  'packages/ui/src',
  'packages/widgets/src',
  'packages/charts/src',
  'packages/engine/src',
];

/**
 * Files the best-effort `icon:` sweep must SKIP — private vocabularies that are
 * resolved by a local map of static imports, never through `CORE_ICONS` or
 * `lucideByName`.
 *
 * The sweep's own comment used to say over-collecting costs nothing, because a
 * fabricated name is dropped against the catalogue below. That is true of a
 * WRONG name and false of a right one: a name lucide really has is emitted, and
 * an emitted name is a static import in the dashboard's ENTRY chunk whether or
 * not anything resolves it there.
 *
 * `page-builder`'s `BLOCK_KIND_META` is the case that proved it. Its `.icon`
 * slugs are read by one component — `BlockIcon` in `PageBuilder.tsx` — which
 * resolves them through the local `BLOCK_ICONS` map and falls back to a dashed
 * square, so the catalogue is never consulted. Attributing all 144 emitted
 * names to their collecting source found EIGHTEEN whose only origin was that
 * file — 1,574 bytes gz, measured, less than the ~2.1 KiB a sum-of-parts
 * estimate predicted — and its host `EmailTemplatesPage` is one of the eleven
 * routes deliberately behind `React.lazy` — so a lazy surface's private
 * vocabulary was riding in every user's cold boot.
 *
 * This skips the `icon:` sweep ONLY. `<Icon name>` and `lucideByName()` in the
 * same file would still be collected, because those genuinely do resolve here.
 */
const SWEEP_IGNORE = ['packages/widgets/src/templates/page-builder/builder-config.ts'];

/** Files whose curated arrays are icon vocabularies in full. */
const LIST_SOURCES = [
  ['apps/dashboard/src/studio/pages/IconPicker.tsx', /ICON_SHORTLIST[\s\S]*?\n\];/],
  ['apps/dashboard/src/studio/remap/IconPicker.tsx', /ICON_SUBSET[\s\S]*?\n\];/],
  ['packages/engine/src/generate/archetype.ts', /[\s\S]*/],
  ['packages/engine/src/generate/dashboard.ts', /[\s\S]*/],
];

/**
 * The vocabularies that are lucide names BY CONTRACT — every entry is fed to
 * `lucideByName`/`useLucideIcon`, which resolve through lucide's `icons` map and
 * fall back to a neutral `File` glyph on a miss. A name here that the catalogue
 * does not carry is therefore a wrong glyph plus a catalogue fetch, forever, and
 * this script is the only thing in the repo positioned to see it.
 *
 * Each entry is `[relative path, block regex, value regex]`. The block narrows
 * the file to the declaration (so neighbouring prose and non-icon literals are
 * out of scope) and the value regex picks the names out of it. Both must match,
 * and the pair must yield at least one name — a renamed constant that quietly
 * stops matching would turn this gate off, which is the one failure mode a gate
 * like this must not have.
 *
 * NOT strict, deliberately: every other `icon:` field the scan above sweeps up.
 * `packages/widgets/src/families/feeds` keys activity kinds (`created`,
 * `deployed`), `kpi` keys tones (`trend-up`), and the page-builder resolves its
 * `icon:` slugs through a LOCAL map of static imports (`PageBuilder.tsx`
 * `BLOCK_ICONS`) — deprecated lucide aliases are legal named imports, so those
 * render correctly and must not be forced onto the catalogue's spelling.
 */
const STRICT_SOURCES = [
  // The page-icon picker's grid: what an admin sees before typing anything.
  [
    'apps/dashboard/src/studio/pages/IconPicker.tsx',
    /ICON_SHORTLIST[\s\S]*?\n\];/,
    /'([a-z][a-z0-9-]*)'/g,
  ],
  // The remap picker's grid — same contract, separate list.
  [
    'apps/dashboard/src/studio/remap/IconPicker.tsx',
    /ICON_SUBSET[\s\S]*?\n\];/,
    /'([a-z][a-z0-9-]*)'/g,
  ],
  // The generated app's nav icon per table shape (09 §2.2) — first paint.
  [
    'packages/engine/src/generate/index.ts',
    /const SHAPE_ICONS[\s\S]*?\n\};/,
    /:\s*'([a-z][a-z0-9-]*)'/g,
  ],
  // The LLM normalizer's mirror of the same map: it writes the icon that ends up
  // on the table, so a typo here reaches the nav by a different road.
  [
    'packages/llm/src/apply/normalize.ts',
    /const SHAPE_ICONS[\s\S]*?\n\};/,
    /:\s*'([a-z][a-z0-9-]*)'/g,
  ],
  // The §14 archetype nav placements.
  [
    'packages/engine/src/generate/archetype.ts',
    /const ARCHETYPE_NAV[\s\S]*?\n\};/,
    /\bicon:\s*'([a-z][a-z0-9-]*)'/g,
  ],
  // The generated domain dashboards' nav icon.
  [
    'packages/engine/src/generate/dashboard.ts',
    /[\s\S]*/,
    /\bicon:\s*'([a-z][a-z0-9-]*)'/g,
  ],
  // The LLM review drawer's group headers, rendered by `CategorySection`.
  [
    'apps/dashboard/src/studio/llm-runs/model.ts',
    /REVIEW_GROUPS[\s\S]*?\n\];/,
    /\bicon:\s*'([a-z][a-z0-9-]*)'/g,
  ],
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
 * `SquareKanban` → `square-kanban`, but only when the answer round-trips
 * through {@link pascalCase} — lucide has names (`Grid2x2`) no simple rule
 * recovers, and a wrong suggestion is worse than none. Used for MESSAGES only;
 * the emitted manifest takes lucide's own spellings (`iconNames`).
 */
function kebabCase(pascal) {
  const kebab = pascal
    .replace(/([A-Z])(?=[A-Z])/g, '$1-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
  return pascalCase(kebab) === pascal ? kebab : null;
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
/** {@link SWEEP_IGNORE} path → how many `icon:` literals it actually hid. */
const sweepIgnoreHits = new Map();
/** PascalCase name → the declared vocabularies that spelled it, for the report. */
const strict = new Map();
const declare = (pascal, origin) => {
  names.add(pascal);
  const seen = strict.get(pascal);
  if (seen === undefined) strict.set(pascal, new Set([origin]));
  else seen.add(origin);
};

for (const root of SCAN_ROOTS) {
  for (const file of sourceFiles(join(repoRoot, root))) {
    const relative = file.slice(repoRoot.length + 1);
    const source = readFileSync(file, 'utf8');
    // `<Icon name="X" />`, `<Icon name={'X'} />`, `<Icon name={c ? 'A' : 'B'} />`
    for (const tag of source.matchAll(/<Icon\b[^>]*?\bname=(?:"([A-Za-z0-9]+)"|\{([^}]*)\})/g)) {
      if (tag[1] !== undefined) declare(tag[1], `<Icon name> in ${relative}`);
      for (const literal of (tag[2] ?? '').matchAll(/'([A-Za-z0-9]+)'/g))
        declare(literal[1], `<Icon name> in ${relative}`);
    }
    // `icon: 'Database'` (an `IconName` field) and `icon: 'bar-chart-3'` (kebab,
    // resolved through `lucideByName`). Both shapes appear, and a name lucide
    // does not carry is dropped against the catalogue below — but one it DOES
    // carry is emitted regardless of whether anything resolves it through this
    // set, which is the cost {@link SWEEP_IGNORE} exists to stop paying.
    const swept = [...source.matchAll(/\bicon:\s*['"]([A-Za-z][A-Za-z0-9-]*)['"]/g)];
    if (SWEEP_IGNORE.includes(relative)) {
      sweepIgnoreHits.set(relative, (sweepIgnoreHits.get(relative) ?? 0) + swept.length);
    } else {
      for (const match of swept) {
        names.add(match[1]);
        names.add(pascalCase(match[1]));
      }
    }
    for (const match of source.matchAll(/lucideByName\(\s*'([a-z0-9-]+)'/g))
      declare(pascalCase(match[1]), `lucideByName() in ${relative}`);
  }
}

for (const [relative, section] of LIST_SOURCES) {
  const file = join(repoRoot, relative);
  if (!existsSync(file)) continue;
  const block = section.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
  for (const match of block.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/g))
    names.add(pascalCase(match[1]));
}

/** A strict source that matches nothing has been renamed out from under us. */
const blindSources = [];

// The same failure from the other side: an ignore entry that stops matching
// stops excluding, and the names it was hiding return to the entry chunk with
// nothing in the log to say why. The chunk-budget gate would go red eventually;
// this says which line did it.
for (const relative of SWEEP_IGNORE) {
  if (!existsSync(join(repoRoot, relative))) blindSources.push(`${relative} (SWEEP_IGNORE: file is gone)`);
  else if ((sweepIgnoreHits.get(relative) ?? 0) === 0)
    blindSources.push(`${relative} (SWEEP_IGNORE: no \`icon:\` literals left to skip)`);
}
for (const [relative, block, value] of STRICT_SOURCES) {
  const file = join(repoRoot, relative);
  if (!existsSync(file)) {
    blindSources.push(`${relative} (file is gone)`);
    continue;
  }
  const section = block.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
  let found = 0;
  for (const match of section.matchAll(value)) {
    declare(pascalCase(match[1]), relative);
    found += 1;
  }
  if (found === 0) blindSources.push(`${relative} (declaration matched, 0 names)`);
}

if (blindSources.length > 0) {
  console.error(
    'The icon-vocabulary gate has gone blind — a source matched nothing:\n' +
      blindSources.map((line) => `  - ${line}`).join('\n') +
      '\nFix its STRICT_SOURCES or SWEEP_IGNORE entry in scripts/gen-icon-core.mjs.\n' +
      'A blind STRICT_SOURCES entry stops CHECKING names; a blind SWEEP_IGNORE entry\n' +
      'stops EXCLUDING them, and they go back into the dashboard entry chunk.',
  );
  process.exit(1);
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

// Every catalogue name in kebab — the form every runtime vocabulary in the
// product stores (09 §2.2) and the form the LLM contract validates. Taken from
// lucide's own `iconNames` rather than back-derived from the PascalCase keys,
// because a name like `grid-2x2` is not recoverable by any casing rule.
//
// FILTERED to the names that actually RESOLVE: `iconNames` also carries the
// deprecated aliases (211 of its 1,826, `kanban-square` among them), and an
// alias is a legal named import but NOT a key of the `icons` map — which is the
// map `icon-resolver.ts` looks a runtime name up in. Listing one would tell the
// LLM validator that a name it can never draw is fine.
const dynamic = await import(
  pathToFileURL(requireFromUi.resolve('lucide-react/dynamic.mjs')).href
);
const iconNames = dynamic.iconNames ?? dynamic.default?.iconNames;
if (!Array.isArray(iconNames)) {
  console.error(
    "lucide-react no longer exports `iconNames` from ./dynamic.mjs — icon-names.ts has no source.\n" +
      'Point this script at whatever replaced it before regenerating.',
  );
  process.exit(1);
}
const allKebab = [...new Set(iconNames.filter((name) => isIcon(pascalCase(name))))].sort();

/* ------------------------------------------------- the declared-name gate */

const invalid = [...strict.keys()].filter((name) => !isIcon(name)).sort();
if (invalid.length > 0) {
  console.error(
    `${String(invalid.length)} declared icon name(s) are not in lucide's catalogue.\n` +
      'Each one renders the neutral `File` fallback AND makes the first paint that\n' +
      'draws it fetch the whole icon catalogue to discover the name is dead.\n',
  );
  for (const name of invalid) {
    // lucide keeps renamed icons as deprecated named exports, so an alias tells
    // us exactly what the name became. `displayName` is the canonical spelling.
    const alias = lucide[name] ?? lucide.default?.[name];
    const canonical = typeof alias?.displayName === 'string' ? alias.displayName : null;
    const suggestion =
      canonical === null
        ? ''
        : ` — renamed to '${kebabCase(canonical) ?? canonical}' (${canonical})`;
    console.error(`  ${kebabCase(name) ?? name} (${name})${suggestion}`);
    for (const origin of [...strict.get(name)].sort()) console.error(`      ${origin}`);
  }
  process.exit(1);
}

if (real.length < 60) {
  console.error(
    `Only ${String(real.length)} icons collected — the scan is broken, not the product. Refusing to write.`,
  );
  process.exit(1);
}
if (allKebab.length < 1000) {
  console.error(
    `Only ${String(allKebab.length)} catalogue names read from lucide — refusing to write a truncated manifest.`,
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

const serializedNames = `// SPDX-License-Identifier: AGPL-3.0-only
// GENERATED by scripts/gen-icon-core.mjs — do not edit.
//
// Every lucide icon name, kebab-cased — DATA, with no import of lucide at all,
// so asking "is this string an icon?" costs a string array and never reaches an
// icon module. That question has one production caller today: the LLM response
// validator (06-llm-assist.md §7.3), which warns and falls back to \`table\` when
// a model invents a name. It reaches the server as a snapshot of this list,
// because the server tree may not import @adminium/ui (01 §2.3).
//
// Deprecated lucide aliases are deliberately absent (${String(iconNames.length - allKebab.length)} of lucide's ${String(iconNames.length)}
// names — \`kanban-square\`, \`bar-chart-3\`, \`sort-desc\`, …). They are legal named
// imports, but they are NOT keys of the \`icons\` map, which is what
// \`icon-resolver.ts\` resolves a runtime name through: a nav row carrying one
// draws the neutral fallback and fetches the whole catalogue to find that out.
export const LUCIDE_ICON_NAMES: readonly string[] = [
${allKebab.map((name) => `  '${name}',`).join('\n')}
];
`;

if (check) {
  const stale = [];
  for (const [path, want, label] of [
    [OUT_FILE, serialized, 'icon-core.ts'],
    [NAMES_FILE, serializedNames, 'icon-names.ts'],
  ]) {
    if (!existsSync(path)) stale.push(`${label} is missing`);
    else if (readFileSync(path, 'utf8') !== want) stale.push(`${label} is STALE`);
  }
  if (stale.length > 0) {
    console.error(
      `packages/ui/src/components/icon: ${stale.join(', ')} — the product renders icons it does not statically import.\n` +
        'Re-generate: pnpm run icon-core',
    );
    process.exit(1);
  }
  console.log(
    `ok — icon-core.ts covers all ${String(real.length)} product icons ` +
      `(${String(strict.size)} declared by contract); ` +
      `icon-names.ts carries ${String(allKebab.length)} catalogue names`,
  );
  process.exit(0);
}

writeFileSync(OUT_FILE, serialized, 'utf8');
writeFileSync(NAMES_FILE, serializedNames, 'utf8');
const skipped = [...sweepIgnoreHits.values()].reduce((sum, n) => sum + n, 0);
console.log(
  `Wrote ${OUT_FILE} (${String(real.length)} icons; ` +
    `${String(strict.size)} declared by contract, all valid; ` +
    `dropped ${String(dropped.length)} non-lucide names from the best-effort scan; ` +
    `skipped ${String(skipped)} \`icon:\` literal(s) in ${String(SWEEP_IGNORE.length)} local-map file(s))`,
);
console.log(`Wrote ${NAMES_FILE} (${String(allKebab.length)} catalogue names)`);
