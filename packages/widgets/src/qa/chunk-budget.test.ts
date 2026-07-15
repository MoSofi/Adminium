/**
 * CI chunk-budget gate — 04-widget-registry.md acceptance #3 / 04-T17 (5):
 * the default `page-dashboard` bundle must pull only the kpi/charts/tables/feeds
 * family chunks, and heavy Wave-2/3 dependencies (Leaflet for `map-bubble`,
 * dnd-kit for the boards family, maplibre) must stay out of the Wave-1 graph.
 *
 * A real bundler split is verified in CI's build step; what is checkable at the
 * source level (and enforced here) is:
 *   - the charts package depends on d3-scale + d3-shape only (also acc #8);
 *   - the widgets package declares no heavy Wave-2/3 map/board deps;
 *   - no Wave-1 family source statically imports those heavy deps;
 *   - every widget component is a `React.lazy` ref (⇒ one lazy chunk per family,
 *     04 §2.3) so families are never eagerly pulled into a sibling's chunk;
 *   - the default page-dashboard layout references only Wave-1 families.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANNEX_CATALOG } from './annex-catalog.js';
import { deliveredDefinitions } from './delivered.js';
import { demoDashboardLayout } from '../templates/page-dashboard/demo-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const widgetsRoot = join(here, '..'); // packages/widgets/src
const pkgRoot = join(widgetsRoot, '..'); // packages/widgets

/** Heavy deps that belong to Wave-2/3 families and must stay out of the Wave-1 graph. */
const HEAVY_DEPS = ['leaflet', 'react-leaflet', 'maplibre-gl', 'mapbox-gl', '@dnd-kit/core', '@dnd-kit/sortable'];

const WAVE1_FAMILY_DIRS = ['kpi', 'charts', 'tables', 'feeds'];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function familyToId(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [family, ids] of Object.entries(ANNEX_CATALOG)) {
    for (const id of ids) map.set(id, family);
  }
  return map;
}

/** Recursively collect source (non-test, non-story) files under a dir. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('chunk budget — dependency graph (acceptance #3, #8)', () => {
  it('@adminium/charts depends on d3-scale + d3-shape only', () => {
    const deps = (readJson(join(pkgRoot, '..', 'charts', 'package.json')).dependencies ?? {}) as Record<string, string>;
    const thirdParty = Object.keys(deps).filter((name) => !name.startsWith('@adminium/') && name !== 'react');
    expect(thirdParty.sort()).toEqual(['d3-scale', 'd3-shape']);
  });

  it('@adminium/widgets declares no heavy Wave-2/3 map/board dependencies', () => {
    const pkg = readJson(join(pkgRoot, 'package.json'));
    const deps = { ...((pkg.dependencies ?? {}) as object), ...((pkg.peerDependencies ?? {}) as object) };
    const present = HEAVY_DEPS.filter((name) => name in deps);
    expect(present).toEqual([]);
  });

  it('no Wave-1 family source statically imports a heavy Wave-2/3 dep', () => {
    const offenders: string[] = [];
    for (const family of WAVE1_FAMILY_DIRS) {
      for (const file of sourceFiles(join(widgetsRoot, 'families', family))) {
        const text = readFileSync(file, 'utf8');
        for (const dep of HEAVY_DEPS) {
          if (text.includes(`'${dep}'`) || text.includes(`"${dep}"`)) {
            offenders.push(`${file} → ${dep}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('chunk budget — per-family lazy split (acceptance #3)', () => {
  const LAZY = Symbol.for('react.lazy');

  it('every delivered widget component is a React.lazy ref (one chunk per family)', () => {
    const eager = deliveredDefinitions
      .filter((d) => (d.component as { $$typeof?: symbol }).$$typeof !== LAZY)
      .map((d) => d.id);
    expect(eager).toEqual([]);
  });

  it('no family source uses lazy(() => Promise.resolve(...)) — a same-module ref defeats the split', () => {
    // `lazy(() => Promise.resolve({ default: X }))` is still a React.lazy ref
    // (so the guard above passes), but it introduces NO dynamic import()
    // boundary: X is a same-module binding, so the component (and its
    // @adminium/ui deps) gets pulled into whatever chunk statically imports the
    // definition. Every family must lazy-load its components via a cross-module
    // `import('./…')` instead (the kpi/charts convention, 04 §2.3).
    const offenders: string[] = [];
    for (const family of WAVE1_FAMILY_DIRS) {
      for (const file of sourceFiles(join(widgetsRoot, 'families', family))) {
        const text = readFileSync(file, 'utf8');
        if (/lazy\(\s*\(\)\s*=>\s*Promise\.resolve/.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('chunk budget — default page-dashboard only pulls Wave-1 families (acceptance #3)', () => {
  const idToFamily = familyToId();
  const allowed = new Set(WAVE1_FAMILY_DIRS);

  it('every widget in the default demo layout belongs to a Wave-1 family', () => {
    const outside: string[] = [];
    for (const item of demoDashboardLayout.items) {
      const family = idToFamily.get(item.widget);
      // Unknown ids (e.g. a not-yet-registered slot) render widget-missing —
      // not a heavy chunk; only fail on a *known* Wave-2/3 family reference.
      if (family !== undefined && !allowed.has(family)) outside.push(`${item.widget} (${family})`);
    }
    expect(outside).toEqual([]);
  });
});

/*
 * WAVE-2/3 FOLLOW-UP (not yet checkable — implement when the families land):
 *   - when `map-bubble` (geo) ships, assert Leaflet is dynamically imported by
 *     that widget's chunk only and is ABSENT from the default page-dashboard
 *     entry bundle (needs the CI Vite build's chunk manifest);
 *   - when the boards family ships, assert dnd-kit is confined to its chunk;
 *   - assert loading a `communication` page fetches the communication chunk on
 *     demand (dynamic import boundary), per acceptance #3.
 */
