// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  FAMILY_CAPS,
  candidateRules,
  emitCandidates,
  emitModelCandidates,
  type CandidateColumn,
  type CandidateContext,
  type CandidateTable,
  type CandidateTableInput,
  type ClassifiedColumnInput,
  type ClassifiedTableInput,
  type WidgetCandidate,
} from './candidates.js';
import { validateConfigAgainst, widgetRegistry } from './index.js';

/**
 * H1/H2 rule tests (04-widget-registry.md §8; research/widget-registry.md
 * §1–§13 auto-instantiation triggers).
 *
 * The fixtures are hand-written `CandidateTable` / `ClassifiedTableInput`
 * literals rather than engine output on purpose: this package cannot import
 * `@adminium/engine` (01 §2.3), and the rules must be provable against their own
 * declared contract. That the Engine's real classifier produces these shapes is
 * proven on the other side of the boundary, by
 * `packages/engine/test/generate-archetypes.test.ts`.
 */

const CONN = 'conn_01HZX0000000000000000000';
const ctx: CandidateContext = { connectionId: CONN };

interface ColumnSpec {
  name: string;
  logicalType: string;
  semantic: string;
  enumValues?: string[];
  references?: { tableId: string; column: string };
  pair?: { role: string; partner: string };
  isPrimaryKey?: boolean;
}

function build(
  id: string,
  specs: ColumnSpec[],
  overrides: {
    shape?: string;
    role?: string;
    displayColumn?: string | null;
    hierarchyColumn?: string | null;
    rowCountEstimate?: number | null;
    writeVelocity?: number | null;
  } = {},
): CandidateTableInput {
  const columns: CandidateColumn[] = specs.map((spec) => ({
    name: spec.name,
    logicalType: spec.logicalType,
    nullable: true,
    isPrimaryKey: spec.isPrimaryKey ?? false,
    isUnique: false,
    ...(spec.enumValues === undefined ? {} : { enumValues: spec.enumValues }),
    references: spec.references ?? null,
  }));
  const classifiedColumns: ClassifiedColumnInput[] = specs.map((spec) => ({
    column: spec.name,
    semantic: spec.semantic,
    pair: spec.pair ?? null,
  }));
  const table: CandidateTable = {
    id,
    schema: 'public',
    name: id.split('.').pop() as string,
    kind: 'table',
    rowCountEstimate: overrides.rowCountEstimate ?? 5_000,
    writeVelocity: overrides.writeVelocity ?? null,
    columns,
  };
  const classified: ClassifiedTableInput = {
    tableId: id,
    shape: overrides.shape ?? 'generic',
    role: overrides.role ?? 'entity',
    displayColumn: overrides.displayColumn ?? null,
    hierarchyColumn: overrides.hierarchyColumn ?? null,
    columns: classifiedColumns,
  };
  return { table, classified };
}

/** The §15 archetypal table: timestamps + money + a status enum. */
const orders = build(
  'public.orders',
  [
    { name: 'order_id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
    { name: 'order_ref', logicalType: 'varchar', semantic: 'plain' },
    {
      name: 'customer_id',
      logicalType: 'integer',
      semantic: 'fk',
      references: { tableId: 'public.customers', column: 'customer_id' },
    },
    { name: 'total_amount', logicalType: 'decimal', semantic: 'money' },
    {
      name: 'status',
      logicalType: 'enum',
      semantic: 'status-workflow',
      enumValues: ['open', 'paid', 'refunded'],
    },
    { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
  ],
  { displayColumn: 'order_ref', shape: 'catalog' },
);

function byFamily(candidates: WidgetCandidate[], family: string): WidgetCandidate[] {
  return candidates.filter((c) => c.family === family);
}

function widgets(candidates: WidgetCandidate[]): string[] {
  return candidates.map((c) => c.widget);
}

describe('emitCandidates — §15 step 3 on a timestamped money table', () => {
  const result = emitCandidates(orders.table, orders.classified, ctx);

  it('opens the dashboard with a 4-card KPI row (annex §1, H2 cap)', () => {
    const kpis = byFamily(result, 'kpi');
    expect(kpis).toHaveLength(4);
    expect(kpis.every((c) => c.widget === 'kpi-stat-card')).toBe(true);
    expect(kpis.map((c) => c.rule).sort()).toEqual([
      'kpi.count-total',
      'kpi.money-sum',
      'kpi.new-this-period',
      'kpi.status-count',
    ]);
  });

  it('binds each KPI to a descriptor the server can compile (04 §5.1)', () => {
    const total = result.find((c) => c.rule === 'kpi.count-total') as WidgetCandidate;
    expect(total.binding).toEqual({
      kind: 'table-query',
      connectionId: CONN,
      source: { schema: 'public', name: 'orders', type: 'table' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'value' }],
    });
    expect(total.config).toEqual({ title: 'Total Orders' });

    const money = result.find((c) => c.rule === 'kpi.money-sum') as WidgetCandidate;
    expect(money.binding.aggregations).toEqual([
      { fn: 'sum', column: 'total_amount', alias: 'value' },
    ]);
    // `metricFormat`, not `format`. This assertion pinned the broken value for as
    // long as it existed: the shared `format` key is an object, so the string
    // never parsed and KpiStatCard rendered every money total unformatted.
    expect(money.config).toEqual({ title: 'Total Total Amount', metricFormat: 'currency' });

    const fresh = result.find((c) => c.rule === 'kpi.new-this-period') as WidgetCandidate;
    expect(fresh.shape).toBe('metric+delta');
    expect(fresh.binding.window).toEqual({
      column: 'created_at',
      last: 30,
      unit: 'day',
      compareToPrior: true,
    });

    const status = result.find((c) => c.rule === 'kpi.status-count') as WidgetCandidate;
    expect(status.binding.filters).toEqual([{ column: 'status', op: 'eq', value: 'open' }]);
  });

  it('picks chart-line-area as the hero, bucketed by month over the money column', () => {
    const charts = byFamily(result, 'charts');
    const hero = charts[0] as WidgetCandidate;
    expect(hero.widget).toBe('chart-line-area');
    expect(hero.shape).toBe('timeseries');
    expect(hero.binding.bucket).toEqual({ column: 'created_at', unit: 'month' });
    expect(hero.binding.aggregations).toEqual([
      { fn: 'sum', column: 'total_amount', alias: 'value' },
    ]);
    expect(hero.config['title']).toBe('Total Amount per Month');
    // …and it outranks every other candidate on the table.
    expect(result[0]?.widget).toBe('chart-line-area');
  });

  it('adds the categorical donut and drops the timestamp-only heatmap', () => {
    expect(widgets(byFamily(result, 'charts'))).toEqual(['chart-line-area', 'chart-donut']);
    const donut = result.find((c) => c.widget === 'chart-donut') as WidgetCandidate;
    expect(donut.binding.groupBy).toEqual(['status']);
    expect(donut.shape).toBe('categorical');
  });

  it('scores every candidate in [0,1] at 1e-3 resolution, sorted descending', () => {
    for (const candidate of result) {
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
      expect(candidate.score).toBe(Math.round(candidate.score * 1000) / 1000);
    }
    const scores = result.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('explains itself — every candidate carries a reason and its rule id', () => {
    for (const candidate of result) {
      expect(candidate.reason.length).toBeGreaterThan(0);
      expect(candidateRules.some((rule) => rule.id === candidate.rule)).toBe(true);
    }
  });
});

describe('emitCandidates — H2 caps and pruning', () => {
  it('caps every family at FAMILY_CAPS', () => {
    // A table triggering more KPI rules than the row can hold.
    const kitchenSink = build(
      'public.projects',
      [
        { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
        { name: 'name', logicalType: 'varchar', semantic: 'plain' },
        { name: 'budget', logicalType: 'decimal', semantic: 'money' },
        { name: 'spend', logicalType: 'decimal', semantic: 'money' },
        { name: 'health_score', logicalType: 'integer', semantic: 'score' },
        { name: 'file_size', logicalType: 'bigint', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['open', 'done'],
        },
        { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
      ],
      { displayColumn: 'name' },
    );
    const result = emitCandidates(kitchenSink.table, kitchenSink.classified, ctx);
    // 6 KPI rules fire (count, 2× money, new, status, gauge, usage) — 4 survive.
    expect(byFamily(result, 'kpi')).toHaveLength(FAMILY_CAPS.kpi);
    for (const family of Object.keys(FAMILY_CAPS) as (keyof typeof FAMILY_CAPS)[]) {
      expect(byFamily(result, family).length).toBeLessThanOrEqual(FAMILY_CAPS[family]);
    }
  });

  it('drops candidates the live registry does not know (04 §10)', () => {
    const withoutHero: CandidateContext = {
      connectionId: CONN,
      isRegistered: (id) => id !== 'chart-line-area',
    };
    const result = emitCandidates(orders.table, orders.classified, withoutHero);
    expect(widgets(result)).not.toContain('chart-line-area');
    expect(widgets(result)).toContain('chart-donut');
  });

  it('emits nothing for system and join tables (05 §8.2)', () => {
    const join = build('public.order_tags', [
      { name: 'order_id', logicalType: 'integer', semantic: 'fk' },
      { name: 'tag_id', logicalType: 'integer', semantic: 'fk' },
    ]);
    join.classified = { ...join.classified, role: 'join-table', shape: 'join' };
    expect(emitCandidates(join.table, join.classified, ctx)).toEqual([]);

    const system = build('public.adminium_pages', [
      { name: 'id', logicalType: 'varchar', semantic: 'pk-id' },
    ]);
    system.classified = { ...system.classified, role: 'system' };
    expect(emitCandidates(system.table, system.classified, ctx)).toEqual([]);
  });

  it('down-weights empty tables and up-weights busy ones (H2 row-count modifier)', () => {
    const empty = build(
      'public.orders',
      orders.table.columns.map((c) => ({
        name: c.name,
        logicalType: c.logicalType,
        semantic:
          orders.classified.columns.find((s) => s.column === c.name)?.semantic ?? 'plain',
      })),
      { rowCountEstimate: 0, displayColumn: 'order_ref' },
    );
    const emptyTotal = emitCandidates(empty.table, empty.classified, ctx).find(
      (c) => c.rule === 'kpi.count-total',
    ) as WidgetCandidate;
    const busyTotal = emitCandidates(orders.table, orders.classified, ctx).find(
      (c) => c.rule === 'kpi.count-total',
    ) as WidgetCandidate;
    expect(emptyTotal.score).toBeLessThan(busyTotal.score);
    expect(emptyTotal.score).toBe(0.54); // 0.9 × 0.6
    expect(busyTotal.score).toBe(0.9);
  });
});

describe('emitCandidates — determinism (H5 regeneration must be byte-identical)', () => {
  it('is a pure function of its inputs', () => {
    const a = emitCandidates(orders.table, orders.classified, ctx);
    const b = emitCandidates(orders.table, orders.classified, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('breaks a same-rule, same-widget tie on emission order', () => {
    // Two money columns → two identical-score `kpi-stat-card`s from one rule;
    // only the caller's column order can separate them.
    const invoices = build(
      'public.invoices',
      [
        { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
        { name: 'budget', logicalType: 'decimal', semantic: 'money' },
        { name: 'revenue', logicalType: 'decimal', semantic: 'money' },
      ],
      { displayColumn: null },
    );
    const money = emitCandidates(invoices.table, invoices.classified, ctx).filter(
      (c) => c.rule === 'kpi.money-sum',
    );
    expect(money.map((c) => c.score)).toEqual([0.935, 0.935]);
    expect(money.map((c) => c.config['title'])).toEqual(['Total Budget', 'Total Revenue']);
  });
});

describe('emitCandidates — slot-fit ordering invariants', () => {
  /**
   * `page-master-detail` fills its `required` `master` slot from **any**
   * record-list candidate before it fills `detail`. If anything outranked
   * `master-list` there, the rail would eat the detail pane's widget and the
   * page would fail to compose (regression: the `gantt-chart` landed in a
   * 4-column master rail and `page-master-detail` disappeared).
   */
  it('master-list outranks every other record-list candidate on its table', () => {
    const tables = [
      // enum-heavy split view
      build(
        'public.tickets',
        [
          { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
          { name: 'subject', logicalType: 'varchar', semantic: 'plain' },
          {
            name: 'priority',
            logicalType: 'enum',
            semantic: 'category-enum',
            enumValues: ['low', 'high'],
          },
        ],
        { displayColumn: 'subject' },
      ),
      // §13 domain-card split view (gantt in the detail pane)
      build(
        'public.project_tasks',
        [
          { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
          { name: 'name', logicalType: 'varchar', semantic: 'plain' },
          {
            name: 'start_date',
            logicalType: 'date',
            semantic: 'date-range',
            pair: { role: 'start', partner: 'end_date' },
          },
          {
            name: 'end_date',
            logicalType: 'date',
            semantic: 'date-range',
            pair: { role: 'end', partner: 'start_date' },
          },
          { name: 'progress', logicalType: 'integer', semantic: 'percent' },
        ],
        { displayColumn: 'name' },
      ),
    ];
    for (const input of tables) {
      const result = emitCandidates(input.table, input.classified, ctx);
      const rail = result.find((c) => c.widget === 'master-list') as WidgetCandidate;
      expect(rail, `master-list on ${input.table.id}`).toBeDefined();
      const rivals = result.filter((c) => c.shape === 'record-list' && c.widget !== 'master-list');
      for (const rival of rivals) {
        expect(rival.score, `${rival.widget} must not outrank master-list`).toBeLessThan(rail.score);
      }
    }
  });
});

describe('emitModelCandidates — cross-table rules (annex §9)', () => {
  const conversations = build(
    'public.conversations',
    [
      { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
      { name: 'subject', logicalType: 'varchar', semantic: 'plain' },
      { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
    ],
    { displayColumn: 'subject' },
  );
  const messages = build(
    'public.messages',
    [
      { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
      {
        name: 'conversation_id',
        logicalType: 'integer',
        semantic: 'fk',
        references: { tableId: 'public.conversations', column: 'id' },
      },
      {
        name: 'sender_id',
        logicalType: 'integer',
        semantic: 'fk',
        references: { tableId: 'public.users', column: 'id' },
      },
      { name: 'body', logicalType: 'text', semantic: 'free-text' },
      { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
    ],
    { role: 'messages' },
  );

  it('emits conversation-inbox + chat-thread on the conversation side only', () => {
    const model = emitModelCandidates([conversations, messages], ctx);
    const onConversations = model.get('public.conversations') as WidgetCandidate[];
    expect(widgets(onConversations)).toContain('conversation-inbox');
    expect(widgets(onConversations)).toContain('chat-thread');

    // The thread binds to the *messages* table, oldest-first.
    const thread = onConversations.find((c) => c.widget === 'chat-thread') as WidgetCandidate;
    expect(thread.binding.source.name).toBe('messages');
    expect(thread.binding.orderBy).toEqual([{ column: 'created_at', dir: 'asc' }]);

    const onMessages = model.get('public.messages') as WidgetCandidate[];
    expect(widgets(onMessages)).not.toContain('conversation-inbox');
  });

  it('needs the pair — a lone conversation table emits no chat widgets', () => {
    const model = emitModelCandidates([conversations], ctx);
    expect(widgets(model.get('public.conversations') as WidgetCandidate[])).not.toContain(
      'chat-thread',
    );
  });
});

/**
 * Every emitted config must PARSE against the widget it is emitted for.
 *
 * This gate exists because the failure mode is silent. `validateConfigAgainst`
 * degrades gracefully by design — an unparseable key is pruned, a warning goes
 * to the console, and the widget renders with schema defaults. That is right at
 * runtime and disastrous for authoring: `kpi.money-sum` emitted
 * `format: 'currency'` against a `format` key that is an OBJECT, so every money
 * KPI on every generated dashboard rendered unformatted, and nothing failed.
 * The drawer could not repair it either, because `format` is a composite key it
 * deliberately skips.
 *
 * Asserting zero warnings — not merely "no throw" — is the whole point.
 */
describe('emitted candidate configs are valid against their own widget schema', () => {
  // Fixtures are rebuilt here rather than reused: the richer ones live inside
  // other describe blocks, and this gate wants BREADTH of rules fired, not the
  // specific shapes those blocks assert on.
  const chatPair = [
    build('public.conversations', [
      { name: 'id', logicalType: 'varchar', semantic: 'pk-id' },
      { name: 'subject', logicalType: 'text', semantic: 'title' },
      { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
    ]),
    build(
      'public.messages',
      [
        { name: 'id', logicalType: 'varchar', semantic: 'pk-id' },
        {
          name: 'conversation_id',
          logicalType: 'varchar',
          semantic: 'fk',
          references: { tableId: 'public.conversations', column: 'id' },
        },
        { name: 'body', logicalType: 'text', semantic: 'free-text' },
        { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
      ],
      { role: 'messages' },
    ),
  ];
  const storage = build('public.assets', [
    { name: 'id', logicalType: 'varchar', semantic: 'pk-id' },
    { name: 'name', logicalType: 'text', semantic: 'title' },
    { name: 'size_bytes', logicalType: 'bigint', semantic: 'size' },
    { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
  ]);

  const everyCandidate = (): WidgetCandidate[] => {
    const model = emitModelCandidates([orders, storage, ...chatPair], ctx);
    return [...model.values()].flat();
  };

  it('covers a meaningful number of rules', () => {
    expect(everyCandidate().length).toBeGreaterThan(5);
  });

  it('emits no config a widget would prune', () => {
    const offenders: string[] = [];
    for (const candidate of everyCandidate()) {
      const definition = widgetRegistry.get(candidate.widget);
      if (definition === undefined) {
        offenders.push(`${candidate.rule} → unregistered widget '${candidate.widget}'`);
        continue;
      }
      const { warnings } = validateConfigAgainst(definition, candidate.config);
      for (const warning of warnings) {
        offenders.push(
          `${candidate.rule} → ${candidate.widget}.${warning.path || '(root)'}: ${warning.code}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
