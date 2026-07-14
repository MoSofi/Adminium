/**
 * Golden apply-plan (06-llm-assist.md §8.3 / acceptance criterion 3).
 *
 * Planning the Wave-1 valid-demo diff (§6.3) with EVERYTHING accepted yields the
 * criterion-3 write set: localized label overrides for all 3 tables and their
 * columns, 3 keys, 1 enum-semantics, 1 virtual relation, 2 PII overrides, 3
 * micro-copy blocks, 3 template pages, 2 nav groups, and 1 revenue dashboard
 * page whose layout carries 5 bound widgets. Focused tests then pin the two
 * provenance rules the golden demo does not exercise — a `user-locked` target is
 * excluded, and a `rejects-heuristic` acceptance becomes a suppression
 * descriptor (`pii: null` / `relation_suppressed`).
 */
import { readFileSync } from 'node:fs';

import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { LlmResponseV1 } from '../response/schema.js';
import {
  diffEnrichment,
  type SuggestionDiff,
} from './diff.js';
import { normalizeHeuristicBaseline, normalizeLlmResponse } from './normalize.js';
import {
  applyPlanSummary,
  buildApplyPlan,
  type DashboardPageWrite,
  type NavGroupWrite,
  type OverrideWrite,
  type TemplatePageWrite,
  type WriteDescriptor,
} from './plan.js';
import {
  columnLabelId,
  enumId,
  keyId,
  piiId,
  relationId,
  tableLabelId,
  templateId,
  widgetId,
} from './suggestion-id.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`../../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const model = parseDatabaseModel(fixture('demo-schema.json'));
const classified = classifyModel(model);
const response = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));

const llm = normalizeLlmResponse(response);
const heuristic = normalizeHeuristicBaseline(model, classified);
const diff = diffEnrichment(llm, heuristic);

const CONNECTION = 'demo-shop';
const RUN = '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A';

/** "Everything accepted": accept every diff row id. */
const acceptedIds = diff.map((d) => d.id);
const plan = buildApplyPlan(diff, acceptedIds, { connectionId: CONNECTION, llmRunId: RUN });

function overrides(): OverrideWrite[] {
  return plan.writes.filter((w): w is OverrideWrite => w.target === 'override');
}
function byField(field: OverrideWrite['field']): OverrideWrite[] {
  return overrides().filter((w) => w.field === field);
}
function pageKind<T extends WriteDescriptor & { target: 'page' }>(kind: T['kind']): T[] {
  return plan.writes.filter((w): w is T => w.target === 'page' && w.kind === kind);
}
function overrideById(id: string): OverrideWrite | undefined {
  return overrides().find((w) => w.suggestionId === id);
}

describe('golden apply-plan: valid-demo, everything accepted (criterion 3)', () => {
  it('produces exactly the §8.3 write set', () => {
    // 27 overrides + 6 page writes; the 5 widgets fold into the dashboard and the
    // 4 heuristic-only labels (surrogate ids/created_at) contribute nothing.
    expect(plan.writes).toHaveLength(33);
    expect(overrides()).toHaveLength(27);
    expect(plan.writes.filter((w) => w.target === 'page')).toHaveLength(6);
    expect(plan.excludedUserLocked).toEqual([]);
  });

  it('writes localized label overrides for all 3 tables and their columns', () => {
    const labels = byField('label');
    expect(labels).toHaveLength(17); // 3 tables + 14 columns (id / created_at omitted by the LLM)

    const tableLabels = labels.filter((w) => w.column === null);
    expect(tableLabels.map((w) => w.table).sort()).toEqual([
      'public.customers',
      'public.orders',
      'public.products',
    ]);

    // Table label bundle carries the localized label + description + folded icon.
    const orders = overrideById(tableLabelId('public.orders'));
    expect(orders?.value).toEqual({
      label: { en_US: 'Orders', de_DE: 'Bestellungen' },
      description: {
        en_US: "A customer's purchase of a product, tracked from placement to fulfilment.",
        de_DE: 'Der Kauf eines Produkts durch einen Kunden, von der Bestellung bis zur Lieferung.',
      },
      icon: 'shopping-cart',
    });

    // A column label is column-scoped and carries no icon.
    const total = overrideById(columnLabelId('public.orders', 'total_cents'));
    expect(total?.column).toBe('total_cents');
    expect(total?.value).toEqual({
      label: { en_US: 'Total', de_DE: 'Gesamtbetrag' },
      description: {
        en_US: 'Order total in cents; divide by 100 for display currency.',
        de_DE: 'Bestellsumme in Cent; für die Anzeige durch 100 teilen.',
      },
    });
    expect(total?.value && 'icon' in total.value).toBe(false);
  });

  it('writes 3 key, 1 enum-semantics, 1 virtual relation, 2 PII, 3 micro-copy overrides', () => {
    expect(byField('key')).toHaveLength(3);
    expect(byField('enum_semantics')).toHaveLength(1);
    expect(byField('virtual_relation')).toHaveLength(1);
    expect(byField('pii')).toHaveLength(2);
    expect(byField('copy')).toHaveLength(3);

    expect(overrideById(keyId('public.customers'))?.value).toEqual({
      displayColumn: 'full_name',
      naturalKey: ['email'],
    });

    expect(overrideById(enumId('public.orders', 'status'))?.value).toEqual({
      kind: 'workflow',
      order: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
      terminal: ['shipped', 'cancelled', 'refunded'],
      tones: { pending: 'warn', paid: 'accent', shipped: 'pos', cancelled: 'danger', refunded: 'muted' },
    });

    const relation = overrideById(
      relationId('public.orders', ['product_id'], 'public.products', ['id']),
    );
    expect(relation?.field).toBe('virtual_relation');
    expect(relation?.table).toBe('public.orders');
    expect(relation?.value).toEqual({
      fromColumns: ['product_id'],
      toTable: 'public.products',
      toColumns: ['id'],
      kind: 'many-to-one',
    });

    const email = overrideById(piiId('public.customers', 'email'));
    expect(email?.column).toBe('email');
    expect((email?.value as { masking: string }).masking).toBe('mask-email');
    expect(overrideById(piiId('public.customers', 'full_name'))?.column).toBe('full_name');
  });

  it('every override carries source llm + its suggestion confidence', () => {
    for (const w of overrides()) {
      expect(w.source).toBe('llm');
      expect(w.confidence).toBeGreaterThanOrEqual(0);
      expect(w.confidence).toBeLessThanOrEqual(1);
    }
    expect(overrideById(enumId('public.orders', 'status'))?.confidence).toBe(0.97);
  });

  it('creates 2 nav groups over the member tables', () => {
    const groups = pageKind<NavGroupWrite>('nav-group');
    expect(groups).toHaveLength(2);
    const sales = groups.find((g) => g.group === 'sales');
    expect(sales?.navOrder).toBe(0);
    expect(sales?.icon).toBe('shopping-cart');
    expect(sales?.tables).toEqual(['public.orders', 'public.customers']);
    expect(sales?.label).toEqual({ en_US: 'Sales', de_DE: 'Verkauf' });
    expect(groups.find((g) => g.group === 'catalog')?.tables).toEqual(['public.products']);
  });

  it('creates one template page per accepted template suggestion', () => {
    const templates = pageKind<TemplatePageWrite>('template-page');
    expect(templates).toHaveLength(3);
    const specs = templates.map((t) => `${t.table}:${t.template}`).sort();
    expect(specs).toEqual([
      'public.customers:page-directory',
      'public.orders:page-board',
      'public.orders:page-queue-inbox',
    ]);
    const queue = templates.find((t) => t.suggestionId === templateId('public.orders', 'page-queue-inbox'));
    expect(queue?.rank).toBe(1);
    expect(queue?.config).toEqual({ source: { connectionId: CONNECTION, table: 'public.orders' } });
  });

  it('creates 1 dashboard page whose layout carries 5 bound widgets', () => {
    const dashboards = pageKind<DashboardPageWrite>('dashboard-page');
    expect(dashboards).toHaveLength(1);
    const dash = dashboards[0]!;
    expect(dash.dashboard).toBe('revenue');
    expect(dash.domain).toBe('Revenue');
    expect(dash.label).toEqual({ en_US: 'Revenue', de_DE: 'Umsatz' });
    expect(dash.tables).toEqual(['public.orders', 'public.products']);

    expect(dash.layout.version).toBe(1);
    expect(dash.layout.items).toHaveLength(5);
    expect(dash.widgetIds).toHaveLength(5);

    // Widths follow the §5 span heuristic; KPIs are 3 half-rows tall, charts 8.
    const kpi = dash.layout.items[0]!;
    expect(kpi.i).toBe(widgetId('revenue', 'kpi-stat-card', 1));
    expect({ x: kpi.x, y: kpi.y, w: kpi.w, h: kpi.h }).toEqual({ x: 0, y: 0, w: 3, h: 3 });

    // A single-metric SUM KPI on orders.total_cents.
    expect(kpi.config.title).toBe('Total revenue');
    expect(kpi.config.binding).toEqual({
      kind: 'table-query',
      connectionId: CONNECTION,
      source: { schema: 'public', name: 'orders', type: 'table' },
      shape: 'single-metric',
      aggregations: [{ fn: 'sum', alias: 'value', column: 'total_cents' }],
    });

    // The line chart wraps to the second shelf and binds a monthly timeseries.
    const line = dash.layout.items[2]!;
    expect({ x: line.x, y: line.y, w: line.w, h: line.h }).toEqual({ x: 0, y: 3, w: 8, h: 8 });
    expect(line.config.binding).toEqual({
      kind: 'table-query',
      connectionId: CONNECTION,
      source: { schema: 'public', name: 'orders', type: 'table' },
      shape: 'timeseries',
      aggregations: [{ fn: 'sum', alias: 'value', column: 'total_cents' }],
      bucket: { column: 'placed_at', unit: 'month' },
    });

    // The donut is a categorical group-by over the status enum.
    const donut = dash.layout.items[3]!;
    expect(donut.config.binding).toMatchObject({
      shape: 'categorical',
      groupBy: ['status'],
      aggregations: [{ fn: 'count', alias: 'value' }],
    });
  });

  it('is a pure function of (diff, acceptedIds) — re-planning is identical', () => {
    const again = buildApplyPlan(diff, acceptedIds, { connectionId: CONNECTION, llmRunId: RUN });
    expect(again).toEqual(plan);
    // acceptedIds order is irrelevant (consumed as a set).
    const shuffled = buildApplyPlan(diff, [...acceptedIds].reverse(), {
      connectionId: CONNECTION,
      llmRunId: RUN,
    });
    expect(shuffled).toEqual(plan);
  });

  it('records the run id for provenance', () => {
    expect(plan.llmRunId).toBe(RUN);
  });
});

describe('applyPlanSummary (review confirmation modal)', () => {
  it('counts the golden plan by target', () => {
    const s = applyPlanSummary(plan);
    expect(s).toMatchObject({
      totalWrites: 33,
      overrides: 27,
      pages: 6,
      labels: 17,
      keys: 3,
      pii: 2,
      enums: 1,
      relations: 1,
      microcopy: 3,
      navGroups: 2,
      templatePages: 3,
      dashboardPages: 1,
      widgets: 5,
    });
    expect(s.text).toContain('1 dashboard page (5 widgets)');
    expect(s.text).toContain('3 template pages');
    expect(s.text).toContain('17 labels');
  });

  it('reports no changes for an empty plan', () => {
    const empty = buildApplyPlan(diff, [], { connectionId: CONNECTION });
    expect(applyPlanSummary(empty).text).toBe('No changes to apply.');
    expect(empty.writes).toEqual([]);
  });
});

describe('provenance: user-locked targets are excluded (§8.3 user > llm)', () => {
  const rows: SuggestionDiff[] = [
    {
      id: tableLabelId('public.orders'),
      category: 'label',
      table: 'public.orders',
      status: 'user-locked',
      llmValue: { label: { en_US: 'Orders' } },
      heuristicValue: { label: { en_US: 'Orders' } },
      currentValue: { label: { en_US: 'Sales orders' } },
      confidence: 0.95,
    },
    {
      id: columnLabelId('public.orders', 'total_cents'),
      category: 'label',
      table: 'public.orders',
      status: 'conflict',
      llmValue: { label: { en_US: 'Total' } },
      heuristicValue: { label: { en_US: 'Total Cents' } },
      confidence: 0.9,
    },
  ];

  it('drops the locked suggestion even when it is accepted, and records it', () => {
    const p = buildApplyPlan(rows, [tableLabelId('public.orders'), columnLabelId('public.orders', 'total_cents')], {
      connectionId: CONNECTION,
    });
    expect(p.writes).toHaveLength(1);
    expect((p.writes[0] as OverrideWrite).column).toBe('total_cents');
    expect(p.excludedUserLocked).toEqual([tableLabelId('public.orders')]);
  });
});

describe('provenance: rejects-heuristic acceptances become suppression descriptors (§8.3)', () => {
  it('an explicit pii: null over a heuristic flag writes a pii clear', () => {
    const row: SuggestionDiff = {
      id: piiId('public.users', 'last_ip'),
      category: 'pii',
      table: 'public.users',
      status: 'rejects-heuristic',
      llmValue: null,
      heuristicValue: { kind: 'ip', masking: 'mask-partial', reason: 'x', confidence: 0.99 },
      confidence: 0.99,
    };
    const p = buildApplyPlan([row], [row.id], { connectionId: CONNECTION });
    expect(p.writes).toHaveLength(1);
    expect(p.writes[0]).toEqual({
      target: 'override',
      suggestionId: piiId('public.users', 'last_ip'),
      field: 'pii',
      table: 'public.users',
      column: 'last_ip',
      value: null,
      source: 'llm',
      confidence: 0.99,
    });
  });

  it('a rejected declared relation (correct: false) writes relation_suppressed', () => {
    const id = relationId('public.orders', ['customer_id'], 'public.customers', ['id']);
    const row: SuggestionDiff = {
      id,
      category: 'relation',
      table: 'public.orders',
      status: 'rejects-heuristic',
      llmValue: {
        fromTable: 'public.orders',
        fromColumns: ['customer_id'],
        toTable: 'public.customers',
        toColumns: ['id'],
        semantics: 'orders belong to customers',
        correct: false,
        confidence: 0.99,
      },
      heuristicValue: undefined,
      confidence: 0.99,
    };
    const p = buildApplyPlan([row], [id], { connectionId: CONNECTION });
    expect(p.writes).toHaveLength(1);
    const w = p.writes[0] as OverrideWrite;
    expect(w.field).toBe('relation_suppressed');
    expect(w.table).toBe('public.orders');
    expect(w.column).toBe('customer_id->public.customers.id');
    expect(w.value).toEqual({
      fromColumns: ['customer_id'],
      toTable: 'public.customers',
      toColumns: ['id'],
    });
  });
});

describe('multiple relations on one fromTable stay distinct (no override-key collision)', () => {
  // A junction table with two undeclared FKs yields two accepted `relation`
  // suggestions; both share field=virtual_relation, table, and (before the fix)
  // column=null — the override upsert key `(connection, op, table, column)` would
  // then collapse them, dropping all but the last. Each must carry a distinct
  // per-relation `column` discriminator so they persist as two rows.
  function inferred(fromColumn: string, toTable: string): SuggestionDiff {
    return {
      id: relationId('public.order_items', [fromColumn], toTable, ['id']),
      category: 'relation',
      table: 'public.order_items',
      status: 'llm-new',
      llmValue: {
        fromTable: 'public.order_items',
        fromColumns: [fromColumn],
        toTable,
        toColumns: ['id'],
        kind: 'many-to-one',
        evidence: 'name pattern + type match',
        confidence: 0.8,
      },
      heuristicValue: undefined,
      confidence: 0.8,
    };
  }

  it('emits one descriptor per relation with a unique column discriminator', () => {
    const rows = [inferred('order_id', 'public.orders'), inferred('product_id', 'public.products')];
    const p = buildApplyPlan(rows, rows.map((r) => r.id), { connectionId: CONNECTION });
    const rels = p.writes.filter(
      (w): w is OverrideWrite => w.target === 'override' && w.field === 'virtual_relation',
    );
    expect(rels).toHaveLength(2);
    const keys = rels.map((w) => `${w.field}|${w.table}|${w.column ?? ''}`);
    // Distinct upsert keys → both survive the write layer.
    expect(new Set(keys).size).toBe(2);
    expect(rels.map((w) => w.column).sort()).toEqual([
      'order_id->public.orders.id',
      'product_id->public.products.id',
    ]);
  });
});

describe('widgets fold into their dashboard, not standalone descriptors', () => {
  it('an accepted widget with no accepted dashboard produces nothing', () => {
    const widget: SuggestionDiff = {
      id: widgetId('revenue', 'kpi-stat-card', 1),
      category: 'widget',
      table: 'public.orders',
      status: 'llm-new',
      llmValue: { widget: 'kpi-stat-card', rank: 1, span: 3, table: 'public.orders', agg: 'count', titleEn: 'Orders' },
      heuristicValue: undefined,
      confidence: 0.94,
    };
    const p = buildApplyPlan([widget], [widget.id], { connectionId: CONNECTION });
    expect(p.writes).toEqual([]);
  });
});
