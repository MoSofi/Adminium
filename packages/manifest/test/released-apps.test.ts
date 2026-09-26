// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Released apps and add-ons still validate and plan, unchanged.
 *
 * Every manifest under `fixtures/released/` is a byte-exact copy of one that
 * shipped (see its README and `index.json`). A change to the schema, the
 * checks or the planner that stops one of them validating, or planning as
 * installable, breaks an install people already run — so the fixtures are
 * never edited to pass; the change is.
 *
 * The asserts are "still valid, still installable, no problems", never a
 * snapshot of the plan, so the planner may grow fields.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  planInstall,
  prefixFor,
  sampleBundleIssues,
  sampleBundleSchema,
  shapeConformanceIssues,
  shapeDefinitionSchema,
  shapeKey,
  tableShapeIssues,
  validateManifest,
  type Manifest,
  type PlanContext,
  type SchemaModelView,
  type ShapeDefinitionView,
} from '../src/index.js';

interface IndexEntry {
  repo: string;
  tag: string;
  commit: string;
  source: string;
  file: string;
  sha256: string;
}

const dir = new URL('./fixtures/released/', import.meta.url);
const bytesOf = (file: string): Buffer => readFileSync(new URL(file, dir));
const INDEX = JSON.parse(bytesOf('index.json').toString('utf8')) as IndexEntry[];

type Doc = Record<string, unknown>;
const docOf = (file: string): Doc => JSON.parse(bytesOf(file).toString('utf8')) as Doc;

const MANIFESTS = INDEX.filter((entry) => entry.file.endsWith('.manifest.json'));
const SAMPLES = INDEX.filter((entry) => entry.file.endsWith('.sample.json'));
const APPS = MANIFESTS.filter((entry) => docOf(entry.file)['kind'] === 'app');
const ADD_ONS = MANIFESTS.filter((entry) => docOf(entry.file)['kind'] === 'add-on');

/** The typed manifest of a fixture; the validity test says why when this throws. */
function manifestOf(file: string): Manifest {
  const result = validateManifest(docOf(file));
  if (!result.ok) throw new Error(`${file} does not validate`);
  return result.manifest;
}

const byKey = (key: string): IndexEntry => {
  const entry = MANIFESTS.find((candidate) => docOf(candidate.file)['key'] === key);
  if (entry === undefined) throw new Error(`no released manifest for "${key}"`);
  return entry;
};

const DIALECTS = ['sqlite', 'postgres', 'mysql'] as const;
const EMPTY: SchemaModelView = { tables: [] };

/** The prefix the server gives an app: its own when its tables are prefixed, else none. */
const prefixOf = (m: Manifest): string | null => (m.kind === 'app' && m.requiredSchema?.prefixed === true ? prefixFor(m.key) : null);

describe('the released fixtures are the bytes that shipped', () => {
  it('lists every fixture file once, with the version its tag names', () => {
    expect(new Set(INDEX.map((entry) => entry.file)).size).toBe(INDEX.length);
    for (const entry of MANIFESTS) {
      const doc = docOf(entry.file);
      expect(entry.tag, entry.file).toBe(`v${String(doc['version'])}`);
      expect(entry.file, entry.file).toContain(`-${String(doc['version'])}.manifest.json`);
    }
    for (const entry of SAMPLES) {
      expect(MANIFESTS.map((m) => m.file), entry.file).toContain(entry.file.replace(/\.sample\.json$/, '.manifest.json'));
    }
  });

  it.each(INDEX.map((entry) => [entry.file, entry] as const))('%s hashes to its recorded sha256', (file, entry) => {
    expect(createHash('sha256').update(bytesOf(file)).digest('hex')).toBe(entry.sha256);
    expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe.each(MANIFESTS.map((entry) => [entry.file] as const))('released manifest %s', (file) => {
  it('validates with no issues', () => {
    const result = validateManifest(docOf(file));
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('plans as installable against an empty database, with no context', () => {
    const plan = planInstall(manifestOf(file), EMPTY);
    expect(plan.problems).toEqual([]);
    expect(plan.installable).toBe(true);
  });

  it.each(DIALECTS.map((dialect) => [dialect] as const))('plans as installable on an empty %s database, prefixed and not', (dialect) => {
    const m = manifestOf(file);
    const prefixes = new Set([prefixOf(m), prefixFor(m.key), null]);
    for (const prefix of prefixes) {
      const plan = planInstall(m, { tables: [], dialect }, { prefix, records: {}, others: [], dialect });
      expect(plan.problems, `prefix ${String(prefix)}`).toEqual([]);
      expect(plan.installable, `prefix ${String(prefix)}`).toBe(true);
      for (const table of plan.tables ?? []) expect(table.class, `${table.ref}, prefix ${String(prefix)}`).toBe('new');
    }
  });
});

describe.each(SAMPLES.map((entry) => [entry.file] as const))('released sample bundle %s', (file) => {
  it('parses and fits its release’s manifest', () => {
    const parsed = sampleBundleSchema.safeParse(docOf(file));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    const m = manifestOf(file.replace(/\.sample\.json$/, '.manifest.json'));
    expect(sampleBundleIssues(parsed.data!, m)).toEqual([]);
  });
});

describe('released apps built on a released add-on’s shapes', () => {
  /** Every shape the released add-ons define, by `<addOn>/<name>@<version>`. */
  const shapesOf = (entries: readonly IndexEntry[]): Map<string, ShapeDefinitionView> => {
    const out = new Map<string, ShapeDefinitionView>();
    for (const entry of entries) {
      const doc = docOf(entry.file);
      const shapes = ((doc['addOn'] as { shapes?: unknown[] } | undefined)?.shapes ?? []);
      for (const candidate of shapes) {
        const parsed = shapeDefinitionSchema.parse(candidate);
        out.set(shapeKey(String(doc['key']), parsed), parsed as unknown as ShapeDefinitionView);
      }
    }
    return out;
  };

  it('Client Portal conforms to the Invoices shapes it requires', () => {
    const portal = manifestOf(byKey('clients').file);
    const invoices = byKey('invoices');
    const shapes = shapesOf([invoices]);
    const builtOn = (portal.requiredSchema?.tables ?? []).flatMap((table) => ('builtOn' in table && typeof table.builtOn === 'string' ? [table.builtOn] : []));
    expect(builtOn.length).toBeGreaterThan(0);
    for (const shape of builtOn) expect([...shapes.keys()], shape).toContain(shape);
    expect(shapeConformanceIssues(portal as never, shapes)).toEqual([]);
  });

  it.each(APPS.map((entry) => [entry.file] as const))('%s conforms to every released add-on’s shapes it is built on', (file) => {
    expect(shapeConformanceIssues(manifestOf(file) as never, shapesOf(ADD_ONS))).toEqual([]);
  });
});

describe('Point of Sale’s core-shaped menu tables', () => {
  it.each(APPS.map((entry) => [entry.file] as const))('%s is what every core table shape it claims says', (file) => {
    expect(tableShapeIssues(manifestOf(file))).toEqual([]);
  });
});

describe('another released app planned beside an installed Point of Sale', () => {
  const pos = manifestOf(byKey('pos').file);
  const posPrefix = prefixOf(pos);

  /** The database and table records Point of Sale leaves on a connection it is installed on. */
  const installedPos = (dialect: PlanContext['dialect']) => {
    const tables = (pos.requiredSchema?.tables ?? []).map((table) => ({
      ref: posPrefix === null ? table.ref : `${posPrefix}${table.ref}`,
      shape: 'shape' in table && typeof table.shape === 'string' ? table.shape : null,
      columns: table.columns.map((column) => ({ ref: column.ref })),
    }));
    return {
      model: { tables: tables.map(({ ref, columns }) => ({ ref, columns })), dialect } satisfies SchemaModelView,
      others: tables.map((table) => ({ appKey: pos.key, table: table.ref, shape: table.shape, state: 'created' })),
    };
  };

  it('Point of Sale’s own tables are the prefixed ones', () => {
    expect(posPrefix).toBe('pos_');
  });

  const rest = APPS.filter((entry) => docOf(entry.file)['key'] !== 'pos');
  it.each(rest.flatMap((entry) => DIALECTS.map((dialect) => [entry.file, dialect] as const)))(
    '%s on %s installs with its own tables, colliding with none of Point of Sale’s',
    (file, dialect) => {
      const m = manifestOf(file);
      const { model, others } = installedPos(dialect);
      const plan = planInstall(m, model, { prefix: prefixOf(m), records: {}, others, dialect });
      expect(plan.problems.filter((p) => p.code === 'PREFIX_COLLISION')).toEqual([]);
      expect(plan.problems).toEqual([]);
      expect(plan.installable).toBe(true);
      for (const table of plan.tables ?? []) {
        expect(table.class, table.ref).toBe('new');
        expect(table.offers, table.ref).toEqual([]);
        expect(table.table.startsWith('pos_'), table.table).toBe(false);
      }
    },
  );

  it('Online Ordering 0.1.3 keeps its own menu (it declares no shape, so nothing is offered)', () => {
    const ordering = manifestOf(byKey('ordering').file);
    const { model, others } = installedPos('postgres');
    const plan = planInstall(ordering, model, { prefix: prefixOf(ordering), records: {}, others, dialect: 'postgres' });
    const menu = (plan.tables ?? []).find((table) => table.ref === 'menu_items');
    expect(menu).toMatchObject({ table: 'menu_items', class: 'new', action: 'create', offers: [] });
    expect(menu?.sharedWith).toBeUndefined();
  });
});
