// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generator's icon vocabulary, held against lucide's REAL catalogue.
 *
 * Nothing checked these names. `SHAPE_ICONS` carried `kanban-square` for the
 * whole of M5 — lucide renamed that icon to `square-kanban` and kept the old
 * spelling only as a deprecated named EXPORT, so it is absent from the `icons`
 * MAP, and the map is what the dashboard resolves a nav row through
 * (`@adminium/ui` `icon-resolver.ts`, `apps/dashboard` `lib/lucide.ts`).
 *
 * The cost is not cosmetic. A miss draws the neutral `File` glyph AND triggers
 * the lazy catalogue import — 133.6 KiB gzipped — on the FIRST PAINT of any
 * generated app with a workflow-shaped table, because `SidebarNav` renders every
 * nav row through `lucideByName`. That chunk is precisely what the lucide split
 * exists to avoid, so one wrong string in this file undoes it.
 *
 * WHY THE LIVE CATALOGUE AND NOT THE GENERATED MANIFEST. `@adminium/ui` ships a
 * name list (`icon-names.ts`), but it is a generated snapshot: checking against
 * it would pass for as long as both were wrong together. lucide is a dependency
 * of `packages/ui`, not of this package or of the repo root, so it is resolved
 * from the package that owns it — the same thing `scripts/gen-icon-core.mjs`
 * does, and for the same reason.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { ARCHETYPE_NAV } from '../src/generate/archetype.js';
import { generatePages, SHAPE_ICONS } from '../src/generate/index.js';
import { ARCHETYPE_CONNECTION, archetypeModel } from './fixtures/archetypes-model.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `square-kanban` → `SquareKanban` — the exact transform `pascalCaseIconName` applies. */
function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1)))
    .join('');
}

let catalogue: Record<string, unknown> = {};

/** The names that would resolve at runtime, i.e. the keys of lucide's `icons`. */
function unresolvable(names: readonly string[]): string[] {
  return [...new Set(names)]
    .filter((name) => {
      const pascal = pascalCase(name);
      return !Object.hasOwn(catalogue, pascal) || catalogue[pascal] == null;
    })
    .sort();
}

beforeAll(async () => {
  const requireFromUi = createRequire(join(repoRoot, 'packages', 'ui', 'package.json'));
  const lucide = (await import(pathToFileURL(requireFromUi.resolve('lucide-react')).href)) as {
    icons?: Record<string, unknown>;
    default?: { icons?: Record<string, unknown> };
  };
  catalogue = lucide.icons ?? lucide.default?.icons ?? {};
});

describe('generated nav icons', () => {
  it('loaded the real catalogue, so nothing below can pass vacuously', () => {
    // A resolution that silently produced `{}` would make every assertion in
    // this file fail; one that produced a catalogue of everything would make
    // them all pass. Pin the shape before trusting either.
    expect(Object.keys(catalogue).length).toBeGreaterThan(1000);
    expect(Object.hasOwn(catalogue, 'SquareKanban')).toBe(true);
    // The deprecated alias is a real lucide EXPORT but not a key of this map —
    // the exact gap that hid `kanban-square`.
    expect(Object.hasOwn(catalogue, 'KanbanSquare')).toBe(false);
  });

  it('SHAPE_ICONS names an icon lucide can resolve for every table shape', () => {
    expect(unresolvable(Object.values(SHAPE_ICONS))).toEqual([]);
    // The map is the nav vocabulary in full — every shape the classifier emits
    // has to land somewhere, or a table gets no icon at all.
    expect(Object.keys(SHAPE_ICONS).sort()).toEqual([
      'catalog',
      'events',
      'generic',
      'geo',
      'join',
      'log',
      'people',
      'settings',
      'workflow',
    ]);
  });

  it('ARCHETYPE_NAV names an icon lucide can resolve for every §14 archetype', () => {
    const icons = Object.values(ARCHETYPE_NAV).map((nav) => nav.icon);
    expect(icons.length).toBeGreaterThanOrEqual(9);
    expect(unresolvable(icons)).toEqual([]);
  });

  it('emits no unresolvable icon on any page it actually generates', () => {
    // The two maps above are what a reader would think to check; this catches
    // whatever else learns to stamp a nav icon (`generate/dashboard.ts` already
    // does, with a literal neither map holds).
    const model = applyClassification(archetypeModel);
    const { pages } = generatePages(model, { connectionId: ARCHETYPE_CONNECTION });
    const icons = pages
      .map((page) => page.nav?.icon)
      .filter((icon): icon is string => typeof icon === 'string');

    expect(icons.length).toBeGreaterThan(0);
    expect(unresolvable(icons)).toEqual([]);
  });
});
