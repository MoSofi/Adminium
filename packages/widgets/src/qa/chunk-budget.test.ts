/**
 * CI chunk-budget gate — 04-widget-registry.md acceptance #3 / 04-T17 (5):
 * the default `page-dashboard` bundle must pull only the kpi/charts/tables/feeds
 * family chunks, and the heavy per-family dependencies (Leaflet for `map-bubble`,
 * dnd-kit for the boards family) must stay out of the eager graph — acceptance
 * #3's "Leaflet code is absent unless `map-bubble` is placed".
 *
 * A real bundler split is verified in CI's build step; what is checkable at the
 * source level (and enforced here) is:
 *   - the charts package depends on d3-scale + d3-shape only (also acc #8);
 *   - the widgets package declares Leaflet and no rival map stack;
 *   - no family source names a heavy dep it does not own (dnd-kit stays confined
 *     to `boards`; Leaflet stays confined to `geo/MapBubble.tsx`, and even there
 *     is reached only by a dynamic `import()`);
 *   - no module transitively reachable by STATIC imports from any family's
 *     definitions module — i.e. the registry's eager graph — names either;
 *   - every widget component is a `React.lazy` ref (⇒ one lazy chunk per family,
 *     04 §2.3) so families are never eagerly pulled into a sibling's chunk;
 *   - no family's definitions module statically imports a component (`.tsx`)
 *     module — the leak that makes a `lazy()` ref decorative, see that test;
 *   - the default page-dashboard layout references only Wave-1 families.
 *
 * The static-import checks run over EVERY family: acceptance #3 is a
 * whole-registry property, and `registry/index.ts` statically imports every
 * family's definitions module, so one leaky family is enough to defeat the
 * split. Only the demo-layout check stays scoped to the Wave-1 families.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANNEX_CATALOG } from './annex-catalog.js';
import { deliveredDefinitions } from './delivered.js';
import { demoDashboardLayout } from '../templates/page-dashboard/demo-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const widgetsRoot = join(here, '..'); // packages/widgets/src
const pkgRoot = join(widgetsRoot, '..'); // packages/widgets

/**
 * Leaflet powers `map-bubble` (annex §7, shipped in M7 Wave 4) — a legitimate
 * dependency now, but the ONLY one of these: the alternatives were evaluated and
 * not adopted, so any of them appearing means a second map stack crept in.
 */
const SHIPPED_MAP_DEP = 'leaflet';
const UNSHIPPED_MAP_DEPS = ['react-leaflet', 'maplibre-gl', 'mapbox-gl'];
const MAP_DEPS = [SHIPPED_MAP_DEP, ...UNSHIPPED_MAP_DEPS];
/**
 * dnd-kit powers the `boards` family (Wave 2, shipped) — it is now a legitimate
 * dependency, but must stay CONFINED to families/boards so it never lands in a
 * sibling family's chunk (04 §2.3). `@dnd-kit/sortable` is NOT used (boards
 * drives its own drag layer), so it must stay absent too.
 */
const BOARD_DEPS = ['@dnd-kit/core', '@dnd-kit/sortable'];
/** Everything a family source must never statically import (bar its owner). */
const HEAVY_DEPS = [...MAP_DEPS, ...BOARD_DEPS];

/**
 * The families the default `page-dashboard` template is allowed to reference.
 * Scopes the demo-layout check ONLY — the static-import checks below run over
 * every family (`ALL_FAMILY_DIRS`), since acceptance #3 is a whole-registry
 * property: any family that leaks component code into the metadata graph
 * defeats the split for the pages that *do* use it.
 */
const WAVE1_FAMILY_DIRS = ['kpi', 'charts', 'tables', 'feeds'];
/** The only family allowed to import dnd-kit. */
const BOARD_FAMILY_DIR = 'boards';
/** The only family allowed to name Leaflet at all (annex §7). */
const GEO_FAMILY_DIR = 'geo';

const familiesRoot = join(widgetsRoot, 'families');

/**
 * And within that family, the only MODULE allowed to name Leaflet:
 * `map-bubble`'s component. Its familymate `map-choropleth-grid` renders an SVG
 * tilegram and must not drag a map engine along, so acceptance #3's "Leaflet
 * code is absent unless map-bubble is placed" holds at FILE granularity, not
 * merely family granularity.
 */
const LEAFLET_OWNER = join(familiesRoot, GEO_FAMILY_DIR, 'MapBubble.tsx');

/** Every family directory on disk — a new family is gated the day it lands. */
const ALL_FAMILY_DIRS: string[] = readdirSync(familiesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

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

/** Every family's registry-metadata modules (`*definitions*.ts`, never `.tsx`). */
function definitionFiles(dir: string): string[] {
  return sourceFiles(dir).filter((file) => file.endsWith('.ts') && /definitions/.test(basename(file)));
}

/**
 * Specifiers of a module's STATIC, VALUE-carrying `import …` / `export … from …`
 * statements.
 *
 * Two deliberate exclusions, both because they carry no runtime edge:
 *   - dynamic `import('…')` — precisely the lazy boundary this gate exists to
 *     protect, so a `lazy(() => import('./x.js'))` ref must never be reported;
 *   - `import type` / `export type` — erased at compile time, so they cannot
 *     pull a component into a chunk. (Inline `import { type A, B }` still
 *     matches: `B` is a value, so the module IS loaded.)
 *
 * Anchoring at a line start and excluding `(`/`;` from the pre-`from` run keeps
 * a match inside one statement, so an `export const x = lazy(() => import(…))`
 * line cannot be misread as a static re-export.
 */
function staticSpecifiers(text: string): string[] {
  const re = /^[ \t]*(?:import|export)\s+(?:[^'"();]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  return [...text.matchAll(re)]
    .filter((match) => !/^[ \t]*(?:import|export)\s+type\s/.test(match[0]))
    .map((match) => match[1] as string);
}

/** Specifiers of a module's DYNAMIC `import('…')` calls. */
function dynamicSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1] as string);
}

/**
 * Every module specifier a file imports, statically or dynamically.
 *
 * Used by the confinement checks in place of a raw `text.includes("'leaflet")`:
 * a substring scan cannot tell an import from PROSE, so the moment a file
 * explains *why* it must not import Leaflet — which every module around this
 * boundary does — the scan fires on the explanation. (It did: this test's first
 * run flagged `geo-track.definitions.ts` for a comment reading "never reaches
 * 'leaflet'".) Matching specifiers keeps the gate honest about imports and lets
 * the code document itself.
 */
function importsDep(text: string, dep: string): boolean {
  return [...staticSpecifiers(text), ...dynamicSpecifiers(text)].some(
    (spec) => spec === dep || spec.startsWith(`${dep}/`),
  );
}

/**
 * Resolve a relative specifier to the file TypeScript/Vite actually load.
 * Under NodeNext the source is written `./Foo.js` but resolves to `Foo.ts`
 * when present, else `Foo.tsx` — so a `.js` specifier is how a component
 * module gets pulled in without ever naming `.tsx`. Returns undefined when
 * nothing on disk matches (an external/unresolvable specifier).
 */
function resolveRelative(fromFile: string, spec: string): string | undefined {
  const abs = resolve(dirname(fromFile), spec);
  const stem = abs.replace(/\.js$/, '');
  const candidates = [
    ...(abs.endsWith('.js') ? [`${stem}.ts`, `${stem}.tsx`] : []),
    `${abs}.ts`,
    `${abs}.tsx`,
    abs,
    join(abs, 'index.ts'),
    join(abs, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Transitive closure of a module's STATIC, value-carrying imports, following
 * only specifiers that resolve to a file in this package (an external
 * specifier — 'react', '@adminium/ui', 'leaflet' — is a leaf: we assert on
 * whether a reachable module NAMES it, not on walking into node_modules).
 *
 * Returns `[absoluteFile, humanReadableImportPath]` pairs INCLUDING the entry
 * itself, so a definitions module that names a heavy dep directly is reported
 * too. Cycle-safe via the visited set (barrels re-export each other freely).
 */
function reachableFrom(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue: { file: string; path: string }[] = [{ file: entry, path: basename(entry) }];
  while (queue.length > 0) {
    const next = queue.shift() as { file: string; path: string };
    if (seen.has(next.file)) continue;
    seen.set(next.file, next.path);
    for (const spec of staticSpecifiers(readFileSync(next.file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const resolved = resolveRelative(next.file, spec);
      if (resolved !== undefined && !seen.has(resolved)) {
        queue.push({ file: resolved, path: `${next.path} → ${basename(resolved)}` });
      }
    }
  }
  return seen;
}

describe('chunk budget — dependency graph (acceptance #3, #8)', () => {
  it('@adminium/charts depends on d3-scale + d3-shape only', () => {
    const deps = (readJson(join(pkgRoot, '..', 'charts', 'package.json')).dependencies ?? {}) as Record<string, string>;
    const thirdParty = Object.keys(deps).filter((name) => !name.startsWith('@adminium/') && name !== 'react');
    expect(thirdParty.sort()).toEqual(['d3-scale', 'd3-shape']);
  });

  it('@adminium/widgets declares leaflet and no other map stack (geo shipped in Wave 4)', () => {
    const pkg = readJson(join(pkgRoot, 'package.json'));
    const deps = { ...((pkg.dependencies ?? {}) as object), ...((pkg.peerDependencies ?? {}) as object) };
    // `map-bubble` ships, so Leaflet is now a real dependency (this used to
    // assert the opposite). What must stay false is a SECOND map stack: the
    // React wrapper (react-leaflet) is deliberately not used — the widget drives
    // the imperative API inside one effect, which is what lets it be loaded by a
    // dynamic import — and maplibre/mapbox were not adopted at all.
    expect(SHIPPED_MAP_DEP in deps).toBe(true);
    expect(UNSHIPPED_MAP_DEPS.filter((name) => name in deps)).toEqual([]);
  });

  it('declares @dnd-kit/core but never @dnd-kit/sortable (boards drives its own drag layer)', () => {
    const pkg = readJson(join(pkgRoot, 'package.json'));
    const deps = { ...((pkg.dependencies ?? {}) as object), ...((pkg.peerDependencies ?? {}) as object) };
    expect('@dnd-kit/core' in deps).toBe(true);
    expect('@dnd-kit/sortable' in deps).toBe(false);
  });

  it('no family source names a heavy dep it does not own', () => {
    // Every family: `boards` legitimately owns dnd-kit and `geo` owns Leaflet,
    // so each is exempted from its OWN dep only — the confinement tests below
    // are what keep each one inside its family.
    const offenders: string[] = [];
    for (const family of ALL_FAMILY_DIRS) {
      const forbidden = HEAVY_DEPS.filter(
        (dep) =>
          !(family === BOARD_FAMILY_DIR && BOARD_DEPS.includes(dep)) &&
          !(family === GEO_FAMILY_DIR && dep === SHIPPED_MAP_DEP),
      );
      for (const file of sourceFiles(join(familiesRoot, family))) {
        const text = readFileSync(file, 'utf8');
        for (const dep of forbidden) {
          if (text.includes(`'${dep}'`) || text.includes(`"${dep}"`)) {
            offenders.push(`${relative(widgetsRoot, file)} → ${dep}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dnd-kit is confined to families/boards (never imported by another family)', () => {
    const offenders: string[] = [];
    for (const family of ALL_FAMILY_DIRS) {
      if (family === BOARD_FAMILY_DIR) continue;
      for (const file of sourceFiles(join(familiesRoot, family))) {
        const text = readFileSync(file, 'utf8');
        for (const dep of BOARD_DEPS) {
          if (text.includes(`'${dep}`) || text.includes(`"${dep}`)) {
            offenders.push(`${relative(widgetsRoot, file)} → ${dep}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaflet is confined to families/geo/MapBubble.tsx (acceptance #3)', () => {
    // The file-granular half of "Leaflet code is absent unless map-bubble is
    // placed". `map-bubble`'s component is the sole module in the whole package
    // permitted to name Leaflet — including its stylesheet, which is why the
    // match is on the `leaflet` PREFIX (`leaflet/dist/leaflet.css` counts).
    // Anything else importing it — the family's config/lib/barrel, the
    // choropleth twin, another family — puts the map engine on a page that never
    // asked for one.
    const offenders: string[] = [];
    for (const family of ALL_FAMILY_DIRS) {
      for (const file of sourceFiles(join(familiesRoot, family))) {
        if (file === LEAFLET_OWNER) continue;
        if (importsDep(readFileSync(file, 'utf8'), SHIPPED_MAP_DEP)) {
          offenders.push(`${relative(widgetsRoot, file)} → ${SHIPPED_MAP_DEP}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('map-bubble reaches leaflet ONLY through a dynamic import (never a static one)', () => {
    // Guards the guard above: the owner file is exempt from the confinement
    // check, so this is what stops that exemption from being used for a static
    // `import * as L from 'leaflet'`. A static import would put Leaflet in the
    // geo family's own chunk — shipped to any page placing `map-choropleth-grid`
    // — and would evaluate Leaflet's `window`-touching module scope during SSR.
    const text = readFileSync(LEAFLET_OWNER, 'utf8');
    const statics = staticSpecifiers(text).filter((spec) => spec.startsWith(SHIPPED_MAP_DEP));
    expect(statics).toEqual([]);
    // …and it really is loaded, dynamically, so this pair can't both pass on a
    // file that simply dropped the map.
    expect(/await import\(\s*'leaflet'\s*\)/.test(text)).toBe(true);
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
    for (const family of ALL_FAMILY_DIRS) {
      for (const file of sourceFiles(join(familiesRoot, family))) {
        const text = readFileSync(file, 'utf8');
        if (/lazy\(\s*\(\)\s*=>\s*Promise\.resolve/.test(text)) offenders.push(relative(widgetsRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no family definitions module statically imports a component (.tsx) module', () => {
    // THE leak this gate exists for. `registry/index.ts` statically imports
    // every family's definitions module, so anything a definitions module
    // statically imports lands in the registry's EAGER graph. A definitions
    // module that reaches into a component file — even only for a
    // `configSchema` or a `demoData` generator — therefore drags that
    // component and its @adminium/ui/dnd-kit deps into the eager chunk, and
    // the sibling `lazy(() => import('./…-components.js'))` ref buys nothing:
    // the module it names is already loaded.
    //
    // The fix is the `<family>-config.ts` convention (boards, domain, media,
    // communication, forms, chrome, system): schemas + demo generators live in
    // a PURE module the definitions may import, leaving components reachable
    // only through the lazy barrel. Metadata only — 04 §2.3 acceptance #3.
    const offenders: string[] = [];
    for (const family of ALL_FAMILY_DIRS) {
      for (const file of definitionFiles(join(familiesRoot, family))) {
        for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
          if (!spec.startsWith('.')) continue;
          const resolved = resolveRelative(file, spec);
          if (resolved !== undefined && resolved.endsWith('.tsx')) {
            offenders.push(`${relative(widgetsRoot, file)} → ${spec} (${basename(resolved)})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no heavy dep is reachable from the registry metadata graph (acceptance #3)', () => {
    // THE acceptance-#3 assertion, now that geo ships. The checks above are
    // per-file; this one walks the TRANSITIVE static-import closure from every
    // family's definitions module — exactly the graph `registry/index.ts` pulls
    // eagerly — and fails if any module in it names Leaflet or dnd-kit.
    //
    // It closes the gap the per-file checks leave: `geo/MapBubble.tsx` is
    // legitimately allowed to name Leaflet, so the only thing keeping Leaflet
    // out of the eager bundle is that NO STATIC PATH runs from
    // `geo-track.definitions.ts` to that file. The moment someone imports
    // `MapBubble.js` from `geo-config.ts` (say, to reuse a type or a demo
    // helper), every per-file check still passes and the whole split silently
    // collapses — a map engine on every page in the product. This walk is what
    // catches that.
    //
    // Dynamic `import()` is excluded by `staticSpecifiers`, which is the point:
    // the lazy component barrel and MapBubble's own `await import('leaflet')`
    // are the sanctioned boundaries, and crossing them costs a chunk fetch,
    // never a byte of the eager graph.
    const offenders: string[] = [];
    for (const family of ALL_FAMILY_DIRS) {
      for (const entry of definitionFiles(join(familiesRoot, family))) {
        for (const [file, path] of reachableFrom(entry)) {
          const specs = staticSpecifiers(readFileSync(file, 'utf8'));
          for (const dep of [SHIPPED_MAP_DEP, ...BOARD_DEPS]) {
            if (specs.some((spec) => spec === dep || spec.startsWith(`${dep}/`))) {
              offenders.push(`${dep} reachable from ${relative(widgetsRoot, entry)} via ${path}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every family that ships widgets has a definitions module the check above sees', () => {
    // Guards the guard: if a family's metadata module were ever renamed out of
    // the `*definitions*.ts` convention, the .tsx check would silently scan
    // nothing and pass. Families are registered in `registry/index.ts` via
    // their definitions modules, so each family dir must own at least one.
    const missing = ALL_FAMILY_DIRS.filter((family) => definitionFiles(join(familiesRoot, family)).length === 0);
    expect(missing).toEqual([]);
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
 * DONE SINCE (the Wave-2/3 follow-up this file used to carry):
 *   - `map-bubble` (geo) shipped in M7 Wave 4, so Leaflet is asserted at three
 *     levels above: confined to `MapBubble.tsx`, reached from it only by a
 *     dynamic import, and unreachable from the transitive metadata graph;
 *   - dnd-kit is confined to `families/boards` by the same means.
 *
 * STILL NEEDS THE CI VITE BUILD'S CHUNK MANIFEST (not checkable from source):
 *   - that the emitted Leaflet chunk is absent from the `page-dashboard` ENTRY
 *     bundle, and that a `communication` page fetches its family chunk on demand.
 *     The source-level checks here prove no static edge exists to make either
 *     eager, which is the precondition; the manifest proves the bundler agreed.
 */
