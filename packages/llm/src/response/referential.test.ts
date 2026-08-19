// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stage 6 referential cross-checks (06-llm-assist.md §7.3), row by row.
 *
 * `validate.test.ts` pins the fixture corpus — one file per documented code —
 * which proves each code is REACHABLE. This file covers the rows that corpus
 * does not: the second and third rejection inside a check that already has a
 * fixture for its first, and the exact repair each one performs.
 *
 * The repair is the part worth pinning. §7.3 rejections are per-item (§7.2): a
 * bad `displayColumn` nulls that one field and keeps the table, a bad enum drops
 * that one enum and keeps its table, a duplicate nav group drops the SECOND
 * claimant and keeps the first. A check that produced the right error code while
 * dropping the wrong thing — or the whole response — would satisfy the corpus
 * suite and still lose an operator's suggestions.
 *
 * Everything runs through `validateResponse` rather than `runReferentialChecks`
 * directly, so what is asserted is the pruned response a caller actually
 * receives.
 */
import { readFileSync } from 'node:fs';

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { validateResponse, type ValidationContext } from './validate.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`../../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const snapshot: DatabaseModel = parseDatabaseModel(fixture('demo-schema.json'));

const ALLOWED_TEMPLATES = ['page-dashboard', 'page-master-detail', 'page-directory'] as const;
const ALLOWED_WIDGETS = ['kpi-stat-card', 'chart-bar', 'chart-line-area'] as const;

const ctx: ValidationContext = {
  snapshot,
  locales: ['en_US'],
  allowedTemplates: ALLOWED_TEMPLATES,
  allowedWidgets: ALLOWED_WIDGETS,
};

/* ------------------------------------------------------------- builders */

type Json = Record<string, unknown>;

function ordersTable(overrides: Json = {}): Json {
  return {
    table: 'public.orders',
    confidence: 0.9,
    label: { en_US: 'Orders' },
    description: { en_US: 'Customer orders.' },
    icon: 'shopping-cart',
    displayColumn: null,
    naturalKey: null,
    ...overrides,
  };
}

/** The one declared enum in the demo schema, suggested correctly. */
function statusEnum(overrides: Json = {}): Json {
  return {
    table: 'public.orders',
    column: 'status',
    kind: 'workflow',
    order: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
    terminal: ['shipped', 'cancelled', 'refunded'],
    tones: {
      pending: 'warn',
      paid: 'accent',
      shipped: 'pos',
      cancelled: 'danger',
      refunded: 'muted',
    },
    reason: 'Lifecycle states of order fulfilment.',
    confidence: 0.95,
    ...overrides,
  };
}

function navGroup(overrides: Json = {}): Json {
  return {
    id: 'sales',
    label: { en_US: 'Sales' },
    icon: 'shopping-cart',
    order: 0,
    tables: ['public.orders'],
    confidence: 0.9,
    ...overrides,
  };
}

function widget(overrides: Json = {}): Json {
  return {
    widget: 'kpi-stat-card',
    rank: 1,
    span: 3,
    table: 'public.orders',
    titleEn: 'Total revenue',
    reason: 'The primary money measure.',
    confidence: 0.9,
    ...overrides,
  };
}

function dashboard(widgets: Json[]): Json {
  return {
    id: 'revenue',
    domain: 'Revenue',
    label: { en_US: 'Revenue' },
    order: 0,
    tables: ['public.orders'],
    widgets,
  };
}

function body(parts: Json): string {
  return JSON.stringify({ schema_version: 'adminium.llm/v1', ...parts });
}

/* ------------------------------------------------------ table key columns */

describe('§7.3 — key columns are repaired, not dropped with their table', () => {
  it('nulls a displayColumn that does not exist and keeps everything else', () => {
    const result = validateResponse(
      body({
        tables: [
          ordersTable({
            displayColumn: 'customer_name',
            naturalKey: ['order_number'],
            columns: [{ column: 'status', label: { en_US: 'Status' } }],
          }),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_UNKNOWN_COLUMN');
    expect(error?.path).toBe('tables[0].displayColumn');
    expect(error?.severity).toBe('item');
    expect(error?.message).toContain('customer_name');

    // The repair: one field nulled, the table and its other suggestions intact.
    const table = result.response?.tables[0];
    expect(table?.table).toBe('public.orders');
    expect(table?.displayColumn).toBeNull();
    expect(table?.naturalKey).toEqual(['order_number']);
    expect(table?.columns.map((c) => c.column)).toEqual(['status']);
  });

  it('nulls a naturalKey containing an unknown column, naming the offending member', () => {
    // Partial repair is not an option: a natural key is a tuple, and keeping
    // the members that do exist would silently change which rows it identifies.
    const result = validateResponse(
      body({
        tables: [
          ordersTable({
            displayColumn: 'order_number',
            naturalKey: ['order_number', 'invoice_ref'],
          }),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.path === 'tables[0].naturalKey');
    expect(error?.code).toBe('LLM_UNKNOWN_COLUMN');
    expect(error?.message).toContain('invoice_ref');
    expect(error?.message).not.toContain('order_number does not exist');

    const table = result.response?.tables[0];
    expect(table?.naturalKey).toBeNull();
    // The display column was fine and survives the naturalKey rejection.
    expect(table?.displayColumn).toBe('order_number');
  });

  it('counts the dependent widgets a hallucinated table takes with it, in singular', () => {
    // The count is the operator-facing part of the message: it is how they know
    // a dashboard came back smaller than the model proposed.
    const result = validateResponse(
      body({
        tables: [ordersTable({ table: 'public.invoices' })],
        dashboards: [
          dashboard([
            widget({ table: 'public.invoices', metricColumn: undefined }),
            widget({ rank: 2, table: 'public.orders', metricColumn: 'total_cents', agg: 'sum' }),
          ]),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_UNKNOWN_TABLE');
    expect(error?.message).toContain('1 dependent widget suggestion');
    expect(error?.message).toContain('was also dropped');
    expect(error?.message).not.toContain('were also dropped');

    // And it really did drop exactly that one — the sibling widget survives.
    expect(result.response?.tables).toEqual([]);
    expect(result.response?.dashboards[0]?.widgets.map((w) => w.table)).toEqual(['public.orders']);
  });
});

/* ------------------------------------------------------------------ enums */

describe('§7.3 row 4 — enum suggestions', () => {
  it('drops an enum whose column does not exist on a table that does', () => {
    const result = validateResponse(
      body({ tables: [ordersTable()], enums: [statusEnum({ column: 'state' })] }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_NOT_AN_ENUM');
    expect(error?.path).toBe('enums[0].column');
    expect(error?.message).toContain('"state" does not exist on "public.orders"');
    expect(result.response?.enums).toEqual([]);
    // The table it named is real and keeps its own suggestion.
    expect(result.response?.tables).toHaveLength(1);
  });

  it('drops an enum whose order is not a permutation of the declared values', () => {
    // `order` drives the workflow rendering; an order that omits or invents a
    // value would render a lifecycle the database cannot produce.
    const missingOne = validateResponse(
      body({ enums: [statusEnum({ order: ['pending', 'paid', 'shipped', 'cancelled'] })] }),
      ctx,
    );
    expect(missingOne.errors.find((e) => e.path === 'enums[0].order')?.code).toBe('LLM_ENUM_VALUES');
    expect(missingOne.response?.enums).toEqual([]);

    const invented = validateResponse(
      body({
        enums: [
          statusEnum({ order: ['pending', 'paid', 'shipped', 'cancelled', 'returned'] }),
        ],
      }),
      ctx,
    );
    const error = invented.errors.find((e) => e.path === 'enums[0].order');
    expect(error?.code).toBe('LLM_ENUM_VALUES');
    // The message quotes the real value set so a human can see the difference.
    expect(error?.message).toContain('pending, paid, shipped, cancelled, refunded');
    expect(invented.response?.enums).toEqual([]);

    // A different ORDER of the same values is exactly what this suggestion is
    // for, and must be accepted.
    const reordered = validateResponse(
      body({
        enums: [statusEnum({ order: ['pending', 'paid', 'cancelled', 'refunded', 'shipped'] })],
      }),
      ctx,
    );
    expect(reordered.errors).toEqual([]);
    expect(reordered.response?.enums[0]?.order).toEqual([
      'pending',
      'paid',
      'cancelled',
      'refunded',
      'shipped',
    ]);
  });

  it('drops an enum whose terminal list names a value the type does not have', () => {
    const result = validateResponse(
      body({ enums: [statusEnum({ terminal: ['shipped', 'archived'] })] }),
      ctx,
    );
    const error = result.errors.find((e) => e.path === 'enums[0].terminal');
    expect(error?.code).toBe('LLM_ENUM_VALUES');
    expect(error?.message).toContain('"archived"');
    expect(result.response?.enums).toEqual([]);
  });

  it('rejects an enum on a plain text column that nothing marks as enum-like', () => {
    // `products.category` is plain text with no declared enum, no CHECK and —
    // absent a `stats` array flagging it — no low-cardinality signal. The value
    // checks below it never get the chance to run.
    const result = validateResponse(
      body({
        enums: [
          statusEnum({ table: 'public.products', column: 'category', order: null, tones: {} }),
        ],
      }),
      ctx,
    );
    const error = result.errors.find((e) => e.code === 'LLM_NOT_AN_ENUM');
    expect(error?.path).toBe('enums[0].column');
    expect(error?.message).toContain('not enum-like');
  });
});

/* -------------------------------------------------------------- relations */

describe('§7.3 rows 2–3 — inferred relations', () => {
  it('rejects an inferred relation that merely restates a declared foreign key', () => {
    // `orders.customer_id → customers.id` IS a declared FK in the snapshot.
    // Listing it as inferred is not harmless: `confirmed` and `inferred` land in
    // different halves of the review diff, and an operator accepting an
    // "inferred" relation believes they are adding one the schema lacks.
    const result = validateResponse(
      body({
        relations: {
          inferred: [
            {
              fromTable: 'public.orders',
              fromColumns: ['customer_id'],
              toTable: 'public.customers',
              toColumns: ['id'],
              kind: 'many-to-one',
              evidence: 'Name pattern and matching uuid types.',
              confidence: 0.9,
            },
          ],
        },
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.path === 'relations.inferred[0]');
    expect(error?.code).toBe('LLM_RELATION_INVALID');
    expect(error?.message).toContain('confirmed, not inferred');
    expect(result.response?.relations.inferred).toEqual([]);
  });

  it('rejects a join between columns whose types cannot be compared', () => {
    const result = validateResponse(
      body({
        relations: {
          inferred: [
            {
              fromTable: 'public.orders',
              fromColumns: ['order_number'],
              toTable: 'public.products',
              toColumns: ['price_cents'],
              kind: 'many-to-one',
              evidence: 'Both look like identifiers.',
              confidence: 0.6,
            },
          ],
        },
      }),
      ctx,
    );
    const error = result.errors.find((e) => e.path === 'relations.inferred[0]');
    expect(error?.code).toBe('LLM_RELATION_INVALID');
    expect(error?.message).toContain('incompatible types');
    expect(result.response?.relations.inferred).toEqual([]);
  });

  it('accepts a text ↔ uuid join, which is a real un-declared FK shape', () => {
    // The check is compatibility, not identity: a `text` column holding uuids
    // joins a `uuid` primary key every day in schemas migrated from a legacy
    // store, and rejecting it would drop the relations most worth inferring.
    const result = validateResponse(
      body({
        relations: {
          inferred: [
            {
              fromTable: 'public.orders',
              fromColumns: ['order_number'],
              toTable: 'public.customers',
              toColumns: ['id'],
              kind: 'many-to-one',
              evidence: 'order_number holds the customer uuid in the legacy export.',
              confidence: 0.6,
            },
          ],
        },
      }),
      ctx,
    );
    expect(result.errors).toEqual([]);
    expect(result.response?.relations.inferred).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- navGroups */

describe('§7.3 row 6 — nav groups', () => {
  it('drops the second group claiming an id, never the first', () => {
    // Order matters: the first claimant is the one the rest of the response
    // (dashboards, table→group mapping) was written against.
    const result = validateResponse(
      body({
        navGroups: [
          navGroup({ tables: ['public.orders'] }),
          navGroup({ label: { en_US: 'Sales duplicate' }, tables: ['public.products'] }),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_GROUP_INVALID');
    expect(error?.path).toBe('navGroups[1].id');
    expect(error?.message).toContain('Duplicate nav-group id "sales"');
    expect(result.response?.navGroups).toHaveLength(1);
    expect(result.response?.navGroups[0]?.tables).toEqual(['public.orders']);
  });

  it('drops the second group claiming a table, and names the group that holds it', () => {
    // Every table appears in exactly one group — the nav tree is a tree, and a
    // table in two groups would render twice under different headings.
    const result = validateResponse(
      body({
        navGroups: [
          navGroup({ id: 'sales', tables: ['public.orders', 'public.customers'] }),
          navGroup({ id: 'crm', label: { en_US: 'CRM' }, tables: ['public.customers'] }),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_GROUP_INVALID');
    expect(error?.path).toBe('navGroups[1].tables');
    expect(error?.message).toContain('"public.customers" already belongs to nav group "sales"');
    expect(result.response?.navGroups.map((g) => g.id)).toEqual(['sales']);
  });

  it('falls a nav group back to the table icon when its icon is not in the manifest', () => {
    // `allowedIcons` is optional, and for the whole of M6 nothing in apps/server
    // supplied it — the manifest it names (`@adminium/ui` `LUCIDE_ICON_NAMES`)
    // did not exist, so this path never ran in the shipped product. It does now:
    // `compose.ts` and `cli/commands/apply-llm-response.ts` pass the snapshot
    // `cli/allowlist.ts` loads. This still asserts the contract, not the wiring.
    const result = validateResponse(
      body({ navGroups: [navGroup({ icon: 'not-a-real-lucide-icon' })] }),
      { ...ctx, allowedIcons: ['shopping-cart', 'package', 'table'] },
    );

    // A warning, not an error: the group is still useful with a generic icon.
    expect(result.errors).toEqual([]);
    const warning = result.warnings.find((w) => w.code === 'LLM_UNKNOWN_ICON');
    expect(warning?.path).toBe('navGroups[0].icon');
    expect(result.response?.navGroups[0]?.icon).toBe('table');
    expect(result.response?.navGroups[0]?.id).toBe('sales');
  });

  it('leaves every icon alone when no manifest is injected', () => {
    // The default. Zod has already proved the icon is kebab-case, and guessing
    // without the manifest would replace icons that are perfectly valid.
    const result = validateResponse(body({ navGroups: [navGroup({ icon: 'wallet-cards' })] }), ctx);
    expect(result.warnings).toEqual([]);
    expect(result.response?.navGroups[0]?.icon).toBe('wallet-cards');
  });
});

/* ------------------------------------------------------------- dashboards */

describe('§7.3 row 7 — dashboard widget bindings', () => {
  it('rejects a numeric aggregation over a non-numeric metric column', () => {
    // `sum(order_number)` is not a query that fails at review time — it fails at
    // render time, on the operator's dashboard, after everything was applied.
    const result = validateResponse(
      body({
        dashboards: [dashboard([widget({ metricColumn: 'order_number', agg: 'sum' })])],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_WIDGET_BINDING');
    expect(error?.path).toBe('dashboards[0].widgets[0].metricColumn');
    expect(error?.message).toContain('needs a numeric metric column');
    expect(error?.message).toContain('text');
    expect(result.response?.dashboards[0]?.widgets).toEqual([]);
  });

  it('accepts count over a non-numeric column, which needs no numeric metric', () => {
    const result = validateResponse(
      body({ dashboards: [dashboard([widget({ metricColumn: 'order_number', agg: 'count' })])] }),
      ctx,
    );
    expect(result.errors).toEqual([]);
    expect(result.response?.dashboards[0]?.widgets).toHaveLength(1);
  });

  it('rejects a time axis bound to a column that is not a date/time type', () => {
    const result = validateResponse(
      body({
        dashboards: [
          dashboard([
            widget({
              widget: 'chart-line-area',
              span: 6,
              metricColumn: 'total_cents',
              agg: 'sum',
              timeColumn: 'total_cents',
            }),
          ]),
        ],
      }),
      ctx,
    );

    const error = result.errors.find((e) => e.code === 'LLM_WIDGET_BINDING');
    expect(error?.path).toBe('dashboards[0].widgets[0].timeColumn');
    expect(error?.message).toContain('not a date/time type');
    expect(result.response?.dashboards[0]?.widgets).toEqual([]);
  });

  it('checks every bound column, not just the metric', () => {
    // dimensionColumn and timeColumn are separate binding sites; a check that
    // only validated `metricColumn` would ship a chart grouped by a column that
    // does not exist.
    const dimension = validateResponse(
      body({
        dashboards: [
          dashboard([
            widget({ widget: 'chart-bar', span: 6, dimensionColumn: 'region', agg: 'count' }),
          ]),
        ],
      }),
      ctx,
    );
    expect(dimension.errors.find((e) => e.code === 'LLM_WIDGET_BINDING')?.path).toBe(
      'dashboards[0].widgets[0].dimensionColumn',
    );

    const time = validateResponse(
      body({
        dashboards: [
          dashboard([
            widget({ widget: 'chart-line-area', span: 6, timeColumn: 'ordered_on', agg: 'count' }),
          ]),
        ],
      }),
      ctx,
    );
    expect(time.errors.find((e) => e.code === 'LLM_WIDGET_BINDING')?.path).toBe(
      'dashboards[0].widgets[0].timeColumn',
    );
  });

  it('keeps the sibling widgets a rejected binding does not touch', () => {
    const result = validateResponse(
      body({
        dashboards: [
          dashboard([
            widget({ rank: 1, metricColumn: 'total_cents', agg: 'sum' }),
            widget({ rank: 2, metricColumn: 'order_number', agg: 'avg' }),
            widget({ rank: 3, agg: 'count' }),
          ]),
        ],
      }),
      ctx,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.response?.dashboards).toHaveLength(1);
    expect(result.response?.dashboards[0]?.widgets.map((w) => w.rank)).toEqual([1, 3]);
  });
});
