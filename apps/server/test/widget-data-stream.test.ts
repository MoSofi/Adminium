// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime `stream` bindings — server half (04-widget-registry.md §5.3, 04-T11).
 * Offline units (no DB): the `widget-data:*` channel grammar + subscription
 * auth, the `stream`-shape compiler/shaper (server-authoritative channel +
 * PII-masked snapshot), and the CRUD/job stream publisher (never streams a
 * forbidden column).
 */

import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';

import { queryDescriptorSchema, type QueryDescriptor } from '@adminium/engine/config';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import {
  authorizeChannel,
  parseChannel,
  RealtimeHub,
  widgetDataChannel,
  type RealtimeEvent,
} from '../src/realtime/hub.js';
import { compileWidgetQuery, type CompiledWidgetQuery } from '../src/widget-data/compiler.js';
import { shapeRows, type ShapedStream } from '../src/widget-data/shapers.js';
import { publishWidgetDataStream } from '../src/widget-data/stream-publisher.js';

function sem(overrides: Record<string, unknown>) {
  return {
    primary: 'plain',
    flags: { secret: false, pii: null, maskedByDefault: false },
    format: null,
    pair: null,
    confidence: 1,
    source: 'heuristic',
    ...overrides,
  };
}

/** customers: a PII-masked `email`, a `secret` api_token, plain id/name/date. */
const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.customers',
      schema: 'public',
      name: 'customers',
      kind: 'table',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, semantics: null },
        {
          name: 'email',
          logicalType: 'varchar',
          nullable: true,
          isPrimaryKey: false,
          semantics: sem({ primary: 'email', flags: { secret: false, pii: 'email', maskedByDefault: true } }),
        },
        {
          name: 'api_token',
          logicalType: 'varchar',
          nullable: true,
          isPrimaryKey: false,
          semantics: sem({ primary: 'secret', flags: { secret: true, pii: null, maskedByDefault: false } }),
        },
        { name: 'name', logicalType: 'varchar', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'created_at', logicalType: 'timestamp', nullable: true, isPrimaryKey: false, semantics: null },
      ],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);
const customers = view.table('public.customers');

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function descriptor(input: Record<string, unknown>): QueryDescriptor {
  return queryDescriptorSchema.parse({
    connectionId: 'conn_1',
    source: { name: 'customers', schema: 'public' },
    ...input,
  });
}

function compileStream(input: Record<string, unknown> = {}, canReadPii = false): CompiledWidgetQuery {
  return compileWidgetQuery({
    db,
    view,
    descriptor: descriptor({ shape: 'stream', orderBy: [{ column: 'created_at', dir: 'desc' }], ...input }),
    canReadPii,
    dialect: 'postgres',
  });
}

describe('parseChannel — widget-data', () => {
  it('parses widget-data:{connectionId}:{qualifiedTable}', () => {
    expect(parseChannel('widget-data:conn_1:public.customers')).toEqual({
      kind: 'widget-data',
      connectionId: 'conn_1',
      table: 'public.customers',
    });
    // Bare-name (MySQL/SQLite) table.
    expect(parseChannel('widget-data:conn_2:events')).toEqual({
      kind: 'widget-data',
      connectionId: 'conn_2',
      table: 'events',
    });
  });

  it('rejects malformed widget-data channels', () => {
    expect(parseChannel('widget-data:conn_1')).toBeNull(); // no table segment
    expect(parseChannel('widget-data:conn_1:')).toBeNull(); // empty table
    expect(parseChannel('widget-data::public.orders')).toBeNull(); // empty connection id
  });
});

describe('authorizeChannel — widget-data', () => {
  it('grants on table read permission and denies otherwise (deny-by-default)', async () => {
    const deps = { can: (_u: { id: string }, p: string) => p === 'table:conn_1:public.customers:read' };
    expect(await authorizeChannel({ id: 'u1' }, 'widget-data:conn_1:public.customers', deps)).toBe(true);
    // A different table the caller lacks read on.
    expect(await authorizeChannel({ id: 'u1' }, 'widget-data:conn_1:public.orders', deps)).toBe(false);
    // No read grant at all.
    expect(await authorizeChannel({ id: 'u1' }, 'widget-data:conn_1:public.customers', { can: () => false })).toBe(false);
  });
});

describe('widget-data compiler/shaper — stream shape', () => {
  it('compiles like record-list: selects non-secret snapshot columns, DESC, capped, no count twin', () => {
    const compiled = compileStream({ limit: 20 });
    const q = compiled.query.compile();
    expect(q.sql).toContain('select "id", "email", "name", "created_at"'); // api_token (secret) excluded
    expect(q.sql).toContain('from "public"."customers"');
    expect(q.sql).toContain('order by "created_at" desc');
    expect(q.parameters).toContain(20);
    expect(compiled.count).toBeNull();
    expect(compiled.selectedColumns.map((c) => c.name)).toEqual(['id', 'email', 'name', 'created_at']);
  });

  it('shapes a server-authoritative channel + a PII-masked snapshot', () => {
    const shaped = shapeRows({
      compiled: compileStream(),
      rows: [{ id: 1, email: 'ada@x.com', name: 'Ada', created_at: '2026-07-14T00:00:00.000Z' }],
      canReadPii: false,
      connectionId: 'conn_1',
    }) as ShapedStream;
    expect(shaped.shape).toBe('stream');
    expect(shaped.channel).toBe('widget-data:conn_1:public.customers');
    expect(shaped.snapshot).toEqual([
      { id: 1, email: null, name: 'Ada', created_at: '2026-07-14T00:00:00.000Z', _masked: ['email'] },
    ]);
    expect(shaped.columns.map((c) => c.name)).toEqual(['id', 'email', 'name', 'created_at']);
  });

  it('leaves the snapshot unmasked for a caller with the unmask grant', () => {
    const shaped = shapeRows({
      compiled: compileStream({}, true),
      rows: [{ id: 1, email: 'ada@x.com', name: 'Ada', created_at: '2026-07-14T00:00:00.000Z' }],
      canReadPii: true,
      connectionId: 'conn_1',
    }) as ShapedStream;
    expect(shaped.snapshot[0]).toMatchObject({ email: 'ada@x.com' });
  });

  it('throws when connectionId is missing (route contract)', () => {
    expect(() =>
      shapeRows({ compiled: compileStream(), rows: [], canReadPii: false }),
    ).toThrow(/connectionId/);
  });
});

describe('publishWidgetDataStream (CRUD write path)', () => {
  function capture(): { hub: RealtimeHub; seen: RealtimeEvent[] } {
    const hub = new RealtimeHub();
    const seen: RealtimeEvent[] = [];
    hub.subscribe(widgetDataChannel('conn_1', 'public.customers'), (e) => seen.push(e));
    return { hub, seen };
  }

  it('emits the masked row to widget-data:{conn}:{table} — never a forbidden column', () => {
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, {
      connectionId: 'conn_1',
      table: customers,
      type: 'record.create',
      pk: { id: 1 },
      row: { id: 1, email: 'ada@x.com', api_token: 'sk_secret', name: 'Ada' },
      at: 1_750_000_000_000,
    });
    expect(seen).toEqual([
      {
        channel: 'widget-data:conn_1:public.customers',
        type: 'record.create',
        data: {
          type: 'record.create',
          pk: { id: 1 },
          // api_token (secret) stripped; email (PII) masked to null.
          row: { id: 1, email: null, name: 'Ada', _masked: ['email'] },
        },
        ts: new Date(1_750_000_000_000).toISOString(),
      },
    ]);
  });

  it('publishes row: null for a delete (buffer removes by pk client-side)', () => {
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, {
      connectionId: 'conn_1',
      table: customers,
      type: 'record.delete',
      pk: { id: 9 },
      row: null,
    });
    expect(seen[0]?.data).toEqual({ type: 'record.delete', pk: { id: 9 }, row: null });
  });

  it('is a silent no-op with no subscribers', () => {
    const hub = new RealtimeHub();
    expect(() =>
      publishWidgetDataStream(hub, { connectionId: 'conn_x', table: customers, type: 'record.update' }),
    ).not.toThrow();
  });

  it('masks a PII natural-key primary key — never streams the raw PK value', () => {
    // A table keyed by a PII column (email as the natural PK, masked-by-default):
    // the pk must be masked at publish just like the row, or a read-only
    // subscriber would receive the plaintext email in `data.pk` (acceptance #5).
    const naturalKeyModel = {
      ...model,
      tables: [
        {
          id: 'public.contacts',
          schema: 'public',
          name: 'contacts',
          kind: 'table',
          primaryKey: ['email'],
          columns: [
            {
              name: 'email',
              logicalType: 'varchar',
              nullable: false,
              isPrimaryKey: true,
              semantics: sem({ primary: 'email', flags: { secret: false, pii: 'email', maskedByDefault: true } }),
            },
            { name: 'name', logicalType: 'varchar', nullable: true, isPrimaryKey: false, semantics: null },
          ],
        },
      ],
    } as unknown as EffectiveModel;
    const contacts = new SnapshotView('conn_1', naturalKeyModel).table('public.contacts');

    const hub = new RealtimeHub();
    const seen: RealtimeEvent[] = [];
    hub.subscribe(widgetDataChannel('conn_1', 'public.contacts'), (e) => seen.push(e));
    publishWidgetDataStream(hub, {
      connectionId: 'conn_1',
      table: contacts,
      type: 'record.delete',
      pk: { email: 'ada@x.com' },
      row: null,
    });
    expect(seen[0]?.data).toEqual({
      type: 'record.delete',
      pk: { email: null, _masked: ['email'] },
      row: null,
    });
  });

  it('the job-completion path reuses the same masked publisher', () => {
    // A data-producing job would call the exact same helper with the row it
    // wrote and the worker clock — masking and channel are identical.
    const { hub, seen } = capture();
    publishWidgetDataStream(hub, {
      connectionId: 'conn_1',
      table: customers,
      type: 'record.create',
      pk: { id: 42 },
      row: { id: 42, email: 'import@x.com', api_token: 'leak', name: 'Imported' },
      at: 1_760_000_000_000,
    });
    const event = seen[0]!;
    expect(event.channel).toBe('widget-data:conn_1:public.customers');
    expect(event.ts).toBe(new Date(1_760_000_000_000).toISOString());
    expect((event.data as { row: Record<string, unknown> }).row).not.toHaveProperty('api_token');
    expect((event.data as { row: Record<string, unknown> }).row.email).toBeNull();
  });
});
