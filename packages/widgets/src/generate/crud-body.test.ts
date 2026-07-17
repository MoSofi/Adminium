import { describe, expect, it } from 'vitest';

import { gridColumnSpecSchema } from '../page-config/grid-column-spec.js';
import type {
  CandidateColumn,
  CandidateRelation,
  CandidateTable,
  ClassifiedColumnInput,
  ClassifiedTableInput,
} from '../registry/candidates.js';
import { composeCrudBody, enumTones, type CrudBodyContext } from './crud-body.js';

/**
 * `composeCrudBody` parity tests — the body-building rules ported verbatim
 * from the Engine's bespoke `generate/crud.ts` (the byte-identity itself is
 * pinned on the engine side by `generate-baseline.test.ts`; these tests pin
 * the rules against the leaf's own structural contract, the candidates.test.ts
 * idiom).
 */

interface ColumnSpec {
  name: string;
  logicalType: string;
  semantic: string;
  format?: string | null;
  secret?: boolean;
  maskedByDefault?: boolean;
  enumValues?: string[];
  references?: { tableId: string; column: string };
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  isGenerated?: boolean;
  nullable?: boolean;
  defaultKind?: string | null;
  maxLength?: number | null;
}

function build(
  id: string,
  specs: ColumnSpec[],
  overrides: {
    kind?: 'table' | 'view' | 'materialized-view';
    primaryKey?: string[];
    displayColumn?: string | null;
  } = {},
): { table: CandidateTable; classified: ClassifiedTableInput } {
  const columns: CandidateColumn[] = specs.map((spec, index) => ({
    name: spec.name,
    ordinal: index + 1,
    logicalType: spec.logicalType,
    nullable: spec.nullable ?? true,
    isPrimaryKey: spec.isPrimaryKey ?? false,
    isUnique: spec.isUnique ?? false,
    isGenerated: spec.isGenerated ?? false,
    defaultKind: spec.defaultKind ?? null,
    maxLength: spec.maxLength ?? null,
    ...(spec.enumValues === undefined ? {} : { enumValues: spec.enumValues }),
    references: spec.references ?? null,
  }));
  const classifiedColumns: ClassifiedColumnInput[] = specs.map((spec) => ({
    column: spec.name,
    semantic: spec.semantic,
    format: spec.format ?? null,
    secret: spec.secret ?? false,
    maskedByDefault: spec.maskedByDefault ?? false,
  }));
  return {
    table: {
      id,
      schema: 'public',
      name: id.split('.').pop() as string,
      kind: overrides.kind ?? 'table',
      primaryKey: overrides.primaryKey ?? specs.filter((s) => s.isPrimaryKey).map((s) => s.name),
      columns,
    },
    classified: {
      tableId: id,
      shape: 'generic',
      role: 'entity',
      displayColumn: overrides.displayColumn ?? null,
      columns: classifiedColumns,
    },
  };
}

const NO_RELATIONS: CandidateRelation[] = [];

function ctx(overrides: Partial<CrudBodyContext> = {}): CrudBodyContext {
  return {
    readOnly: false,
    includedTableIds: new Set<string>(),
    relations: NO_RELATIONS,
    ...overrides,
  };
}

/** The §15 archetypal table: pk + display + money + status + created-at. */
const orders = build(
  'public.orders',
  [
    { name: 'order_id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'autoincrement' },
    { name: 'order_ref', logicalType: 'varchar', semantic: 'plain', maxLength: 24 },
    {
      name: 'customer_id',
      logicalType: 'integer',
      semantic: 'fk',
      references: { tableId: 'public.customers', column: 'customer_id' },
    },
    { name: 'total_amount', logicalType: 'decimal', semantic: 'money', format: 'currency' },
    {
      name: 'status',
      logicalType: 'enum',
      semantic: 'status-workflow',
      enumValues: ['open', 'paid', 'refunded'],
    },
    { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at', defaultKind: 'now' },
  ],
  { displayColumn: 'order_ref' },
);

describe('enumTones — §7.1 rule-7 heuristic tone map', () => {
  it('maps the pos/warn/danger vocabularies and defaults to muted', () => {
    expect(enumTones(['paid', 'pending', 'failed', 'refunded'])).toEqual({
      paid: 'pos',
      pending: 'warn',
      failed: 'danger',
      refunded: 'muted',
    });
  });
});

describe('composeCrudBody — column selection (05 §7.1)', () => {
  const body = composeCrudBody(orders.table, orders.classified, ctx());

  it('orders the visible list: display column, status, money, dates, fk, rest', () => {
    expect(body.columns.filter((c) => c.hidden !== true).map((c) => c.name)).toEqual([
      'order_ref',
      'status',
      'total_amount',
      'created_at',
      'customer_id',
    ]);
  });

  it('re-appends the excluded pk as a hidden spec (row identity + form key)', () => {
    const pk = body.columns.find((c) => c.name === 'order_id');
    expect(pk).toMatchObject({ hidden: true, primaryKey: true, mono: true, semantic: 'pk-id' });
    // Hidden means appended after every visible column, never dropped.
    expect(body.columns[body.columns.length - 1]?.name).toBe('order_id');
  });

  it('stamps tones on status enums and cell facts on the rest', () => {
    const status = body.columns.find((c) => c.name === 'status');
    expect(status?.enumValues).toEqual(['open', 'paid', 'refunded']);
    expect(status?.enumTones).toEqual({ open: 'warn', paid: 'pos', refunded: 'muted' });
    const money = body.columns.find((c) => c.name === 'total_amount');
    expect(money).toMatchObject({ align: 'end', format: 'currency' });
    const fk = body.columns.find((c) => c.name === 'customer_id');
    expect(fk?.fk).toEqual({ table: 'public.customers', column: 'customer_id' });
  });

  it('emits specs gridColumnSpecSchema accepts — muted fallback tones included', () => {
    for (const column of body.columns) {
      const parsed = gridColumnSpecSchema.safeParse(column);
      expect(parsed.error?.issues ?? [], String(column.name)).toEqual([]);
    }
    // The out-of-keyword enum value earns the 'muted' fallback and still parses.
    const status = body.columns.find((c) => c.name === 'status');
    expect(status?.enumTones?.['refunded']).toBe('muted');
  });

  it('hard-excludes secrets, payloads and free text from the visible set', () => {
    const { table, classified } = build('public.tokens', [
      { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'autoincrement' },
      { name: 'api_key', logicalType: 'text', semantic: 'plain', secret: true },
      { name: 'payload', logicalType: 'json', semantic: 'json-config' },
      { name: 'notes', logicalType: 'text', semantic: 'free-text' },
      { name: 'label', logicalType: 'varchar', semantic: 'plain' },
    ]);
    const names = composeCrudBody(table, classified, ctx()).columns.map((c) => c.name);
    expect(names).toEqual(['label', 'id']); // id only as the hidden pk re-append
  });
});

describe('composeCrudBody — sort, key field, read-only derivation', () => {
  it('sorts by created-at desc when present, else pk desc, else nothing', () => {
    expect(composeCrudBody(orders.table, orders.classified, ctx()).defaultSort).toEqual([
      { column: 'created_at', dir: 'desc' },
    ]);

    const noTs = build('public.tags', [
      { name: 'tag_id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'autoincrement' },
      { name: 'label', logicalType: 'varchar', semantic: 'plain' },
    ]);
    expect(composeCrudBody(noTs.table, noTs.classified, ctx()).defaultSort).toEqual([
      { column: 'tag_id', dir: 'desc' },
    ]);

    const bare = build('public.v_stats', [{ name: 'total', logicalType: 'integer', semantic: 'plain' }], {
      kind: 'view',
    });
    expect(composeCrudBody(bare.table, bare.classified, ctx()).defaultSort).toEqual([]);
  });

  it('keyField prefers the display column over the pk', () => {
    expect(composeCrudBody(orders.table, orders.classified, ctx()).keyField).toBe('order_ref');
    const noDisplay = build('public.tags', [
      { name: 'tag_id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true },
    ]);
    expect(composeCrudBody(noDisplay.table, noDisplay.classified, ctx()).keyField).toBe('tag_id');
  });

  it('derives read-only from intent, missing pk, or non-table kind — and drops the form', () => {
    expect(composeCrudBody(orders.table, orders.classified, ctx()).readOnly).toBe(false);
    expect(composeCrudBody(orders.table, orders.classified, ctx({ readOnly: true }))).not.toHaveProperty('form');

    const view = build('public.v_orders', [{ name: 'n', logicalType: 'integer', semantic: 'plain' }], {
      kind: 'view',
    });
    expect(composeCrudBody(view.table, view.classified, ctx()).readOnly).toBe(true);

    const noPk = build('public.log_lines', [{ name: 'line', logicalType: 'text', semantic: 'plain' }]);
    const body = composeCrudBody(noPk.table, noPk.classified, ctx());
    expect(body.readOnly).toBe(true);
    expect(body.form).toBeUndefined();
  });
});

describe('composeCrudBody — form fields (09 §7.1)', () => {
  const body = composeCrudBody(orders.table, orders.classified, ctx());
  const fields = body.form?.fields ?? [];
  const byColumn = new Map(fields.map((f) => [f.column, f]));

  it('skips auto pks, auto-managed timestamps, secrets and generated columns', () => {
    expect(fields.map((f) => f.column)).toEqual([
      'order_ref',
      'customer_id',
      'total_amount',
      'status',
    ]);

    const tricky = build('public.docs', [
      { name: 'id', logicalType: 'uuid', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'uuid' },
      { name: 'secret_ref', logicalType: 'text', semantic: 'plain', secret: true },
      { name: 'search_tsv', logicalType: 'text', semantic: 'plain', isGenerated: true },
      { name: 'title', logicalType: 'varchar', semantic: 'plain', nullable: false },
    ]);
    expect(
      (composeCrudBody(tricky.table, tricky.classified, ctx()).form?.fields ?? []).map((f) => f.column),
    ).toEqual(['title']);
  });

  it('keeps a natural pk with a literal default as a create input', () => {
    const natural = build('public.countries', [
      { name: 'code', logicalType: 'varchar', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'literal' },
      { name: 'name', logicalType: 'varchar', semantic: 'plain' },
    ]);
    const naturalFields = composeCrudBody(natural.table, natural.classified, ctx()).form?.fields ?? [];
    expect(naturalFields.map((f) => f.column)).toEqual(['code', 'name']);
    // …but a default still makes it optional.
    expect(naturalFields[0]?.required).toBe(false);
  });

  it('maps inputs: fk-combobox, segmented (≤3 values), switch, datetime, currency number, text+maxLength', () => {
    expect(byColumn.get('customer_id')).toMatchObject({ input: 'fk-combobox', ref: 'public.customers' });
    expect(byColumn.get('status')).toMatchObject({ input: 'segmented', options: ['open', 'paid', 'refunded'] });
    expect(byColumn.get('total_amount')).toMatchObject({ input: 'number', format: 'currency' });
    expect(byColumn.get('order_ref')).toMatchObject({ input: 'text', maxLength: 24 });

    const wide = build('public.tickets', [
      { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'autoincrement' },
      { name: 'state', logicalType: 'enum', semantic: 'status-workflow', enumValues: ['a', 'b', 'c', 'd'] },
      { name: 'is_open', logicalType: 'boolean', semantic: 'boolean-flag' },
      { name: 'due_on', logicalType: 'date', semantic: 'event-timestamp' },
      { name: 'seen_at', logicalType: 'timestamptz', semantic: 'event-timestamp' },
      { name: 'meta', logicalType: 'json', semantic: 'json-config' },
      { name: 'body', logicalType: 'text', semantic: 'free-text' },
    ]);
    const wideFields = composeCrudBody(wide.table, wide.classified, ctx()).form?.fields ?? [];
    const wideBy = new Map(wideFields.map((f) => [f.column, f]));
    expect(wideBy.get('state')?.input).toBe('select'); // 4 values > segmented cap
    expect(wideBy.get('is_open')?.input).toBe('switch');
    expect(wideBy.get('due_on')?.input).toBe('date');
    expect(wideBy.get('seen_at')?.input).toBe('datetime');
    expect(wideBy.get('meta')?.input).toBe('json');
    expect(wideBy.get('body')?.input).toBe('textarea');
  });

  it('marks required = not-null without default, unique off the index', () => {
    const strict = build('public.users', [
      { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true, nullable: false, defaultKind: 'autoincrement' },
      { name: 'email', logicalType: 'varchar', semantic: 'email', nullable: false, isUnique: true },
      { name: 'bio', logicalType: 'text', semantic: 'free-text' },
    ]);
    const strictFields = composeCrudBody(strict.table, strict.classified, ctx()).form?.fields ?? [];
    expect(strictFields.find((f) => f.column === 'email')).toMatchObject({ required: true, unique: true });
    expect(strictFields.find((f) => f.column === 'bio')).toMatchObject({ required: false });
  });
});

describe('composeCrudBody — detail tabs from inbound FKs', () => {
  const relations: CandidateRelation[] = [
    {
      id: 'r1',
      from: { tableId: 'public.order_items', columns: ['order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 1,
    },
    {
      id: 'r2',
      from: { tableId: 'public.shipments', columns: ['order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 0.9,
    },
    // Below the 0.8 acceptance threshold — never a tab.
    {
      id: 'r3',
      from: { tableId: 'public.refunds', columns: ['order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 0.5,
    },
    // Self-FK → hierarchy, not a tab.
    {
      id: 'r4',
      from: { tableId: 'public.orders', columns: ['parent_order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 1,
    },
    // Duplicate of r1 (same table + columns) under another id — deduped.
    {
      id: 'r5',
      from: { tableId: 'public.order_items', columns: ['order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 1,
    },
    // Excluded table — not in this generation run.
    {
      id: 'r6',
      from: { tableId: 'public.audit_rows', columns: ['order_id'] },
      to: { tableId: 'public.orders' },
      confidence: 1,
    },
  ];

  it('links only included, confident, non-self referencing tables — deduped, sorted by relation id', () => {
    const body = composeCrudBody(
      orders.table,
      orders.classified,
      ctx({
        relations,
        includedTableIds: new Set(['public.orders', 'public.order_items', 'public.shipments']),
      }),
    );
    expect(body.detail).toEqual({
      template: 'page-record',
      tabsFromInboundFks: true,
      tabs: [
        { table: 'public.order_items', fkColumn: 'order_id', label: 'Order Items' },
        { table: 'public.shipments', fkColumn: 'order_id', label: 'Shipments' },
      ],
    });
  });

  it('keeps the stable body shell around the tabs', () => {
    const body = composeCrudBody(orders.table, orders.classified, ctx());
    expect(body.pageSize).toBe(50);
    expect(body.detail.tabs).toEqual([]);
  });
});
