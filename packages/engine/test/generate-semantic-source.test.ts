import { describe, expect, it } from 'vitest';

import { generatePages, parseDatabaseModel, type PageEnvelope } from '../src/index.js';

/**
 * SEMANTIC SOURCE regression pins (archetype.ts `toClassifiedInput`).
 *
 * The template-pipeline migration unified the generator on the recomputed
 * classification of the model *as generated* — the bespoke dashboard builder
 * read full-model stamped semantics instead. Two consequences are deliberate
 * and pinned here:
 *
 *  1. Column stamps with `source: 'llm' | 'override'` still WIN over the
 *     recomputed tag (05 §7 "overrides always win") — in dashboards *and*
 *     crud bodies (the bespoke crud builder ignored them; that was the bug,
 *     not the contract).
 *  2. On an `includedTables`-filtered model, a stamped join table whose
 *     partner was excluded genuinely stops being a join table: it earns a
 *     `page-crud` (unchanged from the bespoke builder) AND becomes eligible
 *     for the dashboard's fallback KPI (changed — the bespoke builder read
 *     the stale full-model role and skipped it).
 */

const CONN = 'conn_01HZX0000000000000000000';

interface ColumnSpec {
  name: string;
  logicalType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  references?: { tableId: string; column: string } | null;
  semantics?: Record<string, unknown> | null;
}

function column(spec: ColumnSpec, ordinal: number): Record<string, unknown> {
  return {
    name: spec.name,
    ordinal,
    dbType: spec.logicalType,
    logicalType: spec.logicalType,
    nullable: spec.nullable ?? true,
    default: null,
    isPrimaryKey: spec.isPrimaryKey ?? false,
    isUnique: spec.isPrimaryKey ?? false,
    isGenerated: false,
    enumRef: null,
    maxLength: null,
    references: spec.references ?? null,
    semantics: spec.semantics ?? null,
  };
}

function table(
  name: string,
  columns: ColumnSpec[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `public.${name}`,
    schema: 'public',
    name,
    kind: 'table',
    columns: columns.map((spec, index) => column(spec, index + 1)),
    primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    rowCountEstimate: 100,
    system: false,
    semantics: null,
    ...overrides,
  };
}

function relation(fromTable: string, fromColumn: string, toTable: string, toColumn: string) {
  return {
    id: `fk:public.${fromTable}(${fromColumn})->public.${toTable}(${toColumn})`,
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: `public.${fromTable}`, columns: [fromColumn] },
    to: { tableId: `public.${toTable}`, columns: [toColumn] },
    through: null,
    selfReferential: false,
    confidence: 1,
  };
}

function makeModel(tables: Record<string, unknown>[], relations: Record<string, unknown>[]) {
  return parseDatabaseModel(
    JSON.stringify({
      irVersion: 1,
      dialect: 'postgres',
      source: { kind: 'live', connectionId: CONN },
      name: 'synthetic',
      defaultSchema: 'public',
      schemas: ['public'],
      tables,
      enums: [],
      relations,
      introspectedAt: '2026-07-01T00:00:00.000Z',
    }),
  );
}

function dashboardOf(pages: PageEnvelope[]): PageEnvelope {
  const dashboard = pages.find((p) => p.template === 'page-dashboard');
  if (dashboard === undefined) throw new Error('no dashboard emitted');
  return dashboard;
}

function layoutIds(dashboard: PageEnvelope): string[] {
  const layout = dashboard.config['layout'] as { items: { i: string }[] };
  return layout.items.map((item) => item.i);
}

describe('column stamps: override/llm beat the recomputed tag, heuristic stamps do not', () => {
  /** A float column no §7.1 name rule calls money — only the stamp says so. */
  const moneyStamp = (source: string) => ({
    primary: 'money',
    flags: { secret: false, pii: null, maskedByDefault: false },
    format: 'currency',
    pair: null,
    confidence: 1,
    source,
  });

  const build = (source: string) =>
    makeModel(
      [
        table('orders', [
          { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'xval', logicalType: 'float', semantics: moneyStamp(source) },
          { name: 'created_at', logicalType: 'timestamptz' },
          {
            name: 'customer_id',
            logicalType: 'integer',
            references: { tableId: 'public.customers', column: 'customer_id' },
          },
        ]),
        table('customers', [
          { name: 'customer_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', logicalType: 'varchar' },
        ]),
      ],
      [relation('orders', 'customer_id', 'customers', 'customer_id')],
    );

  it('an override-stamped money column drives the sum KPI, the money hero, and the crud cell', () => {
    const { pages } = generatePages(build('override'), { connectionId: CONN });

    const ids = layoutIds(dashboardOf(pages));
    expect(ids).toContain('kpi-sum-orders-xval');
    const hero = (dashboardOf(pages).config['layout'] as { items: { i: string; config: { title?: string } }[] })
      .items.find((item) => item.i === 'hero-line-orders');
    expect(hero?.config.title).toBe('Xval per Month');

    const crud = pages.find((p) => p.template === 'page-crud' && p.nav.slug === 'orders');
    const columns = crud?.config['columns'] as { name: string; align?: string; format?: string }[];
    expect(columns.find((c) => c.name === 'xval')).toMatchObject({ align: 'end', format: 'currency' });
  });

  it('the same stamp marked heuristic defers to the recomputed classification', () => {
    const { pages } = generatePages(build('heuristic'), { connectionId: CONN });

    expect(layoutIds(dashboardOf(pages))).not.toContain('kpi-sum-orders-xval');
    const crud = pages.find((p) => p.template === 'page-crud' && p.nav.slug === 'orders');
    const columns = crud?.config['columns'] as { name: string; format?: string }[];
    expect(columns.find((c) => c.name === 'xval')?.format).not.toBe('currency');
  });
});

describe('filtered model: a stamped join table with an excluded partner reclassifies', () => {
  // The `filterModelToIncludedTables` aftermath, built directly: order_tags
  // keeps its full-model `role: 'join-table'` stamp, but its FK to the
  // excluded public.tags is already nulled, so the recomputed role is entity.
  const filtered = makeModel(
    [
      table('orders', [
        { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
        { name: 'created_at', logicalType: 'timestamptz' },
      ]),
      table(
        'order_tags',
        [
          { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'order_id',
            logicalType: 'integer',
            nullable: false,
            references: { tableId: 'public.orders', column: 'order_id' },
          },
          { name: 'tag_id', logicalType: 'integer', nullable: false, references: null },
        ],
        { semantics: { role: 'join-table', hierarchy: null } },
      ),
    ],
    [relation('order_tags', 'order_id', 'orders', 'order_id')],
  );

  const result = generatePages(filtered, { connectionId: CONN });

  it('the table earns a page-crud, not the join-table skip (unchanged behavior)', () => {
    expect(result.warnings).not.toContain(
      'skipped join table public.order_tags — hidden from nav, relation still powers M2M (05 §8.2)',
    );
    expect(result.pages.some((p) => p.template === 'page-crud' && p.nav.slug === 'order-tags')).toBe(
      true,
    );
  });

  it('…and takes the dashboard fallback KPI (deliberate change from the bespoke builder)', () => {
    expect(layoutIds(dashboardOf(result.pages))).toContain('kpi-count-order_tags');
  });
});
