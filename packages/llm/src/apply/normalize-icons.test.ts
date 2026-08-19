// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The heuristic baseline's icon vocabulary — against lucide, and against the map
 * it claims to mirror.
 *
 * `normalize.ts`'s `SHAPE_ICONS` is a hand-copied mirror of the engine's
 * (`@adminium/engine` `generate/index.ts`), duplicated because this package must
 * not import engine RUNTIME — the dashboard consumes it (01 §2.3). A mirror kept
 * by hand needs a test or it is a coincidence, and this one was neither: both
 * copies said `kanban-square`, which lucide renamed to `square-kanban` and kept
 * only as a deprecated export. It is not a key of the `icons` map, and that map
 * is what the dashboard resolves a stored table icon through — so the icon this
 * normalizer writes onto a workflow-shaped table drew the neutral fallback and
 * made the sidebar's first paint fetch the whole 133.6 KiB catalogue.
 *
 * Two assertions, because either alone is insufficient: lucide validity catches
 * a name that cannot render, and mirror equality catches the two maps disagreeing
 * about what a shape looks like (the heuristic baseline and the generator write
 * the same nav, so a divergence is visible as an icon that changes when an LLM
 * run is applied).
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SHAPE_ICONS as ENGINE_SHAPE_ICONS } from '@adminium/engine';
import { beforeAll, describe, expect, it } from 'vitest';

import { SHAPE_ICONS } from './normalize.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** `square-kanban` → `SquareKanban` — the exact transform `pascalCaseIconName` applies. */
function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1)))
    .join('');
}

let catalogue: Record<string, unknown> = {};

beforeAll(async () => {
  // lucide belongs to `packages/ui`, not to this package or the repo root, so
  // resolve it from the package that owns it — as `scripts/gen-icon-core.mjs`
  // does. A computed file URL, so no import edge to `@adminium/ui` is created.
  const requireFromUi = createRequire(join(repoRoot, 'packages', 'ui', 'package.json'));
  const lucide = (await import(pathToFileURL(requireFromUi.resolve('lucide-react')).href)) as {
    icons?: Record<string, unknown>;
    default?: { icons?: Record<string, unknown> };
  };
  catalogue = lucide.icons ?? lucide.default?.icons ?? {};
});

describe('heuristic baseline icons', () => {
  it('loaded the real catalogue, so nothing below can pass vacuously', () => {
    expect(Object.keys(catalogue).length).toBeGreaterThan(1000);
    expect(Object.hasOwn(catalogue, 'SquareKanban')).toBe(true);
    // A real lucide export, but NOT a key of this map — the gap that hid the bug.
    expect(Object.hasOwn(catalogue, 'KanbanSquare')).toBe(false);
  });

  it('names an icon lucide can resolve for every table shape', () => {
    const unresolvable = Object.values(SHAPE_ICONS)
      .filter((name) => {
        const pascal = pascalCase(name);
        return !Object.hasOwn(catalogue, pascal) || catalogue[pascal] == null;
      })
      .sort();
    expect(unresolvable).toEqual([]);
  });

  it('is the engine map exactly, key for key', () => {
    expect(SHAPE_ICONS).toEqual(ENGINE_SHAPE_ICONS);
  });
});
