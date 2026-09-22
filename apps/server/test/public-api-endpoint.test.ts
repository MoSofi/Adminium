// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `public-api/endpoint.ts` — the endpoint definition, its compile, and the
 * generated defaults.
 *
 * Two fixtures. Northwind is the real-world shape: every
 * generated default on it must compile, as a derived scope, with no `SCOPE_*`
 * issue and no secret or PII column. The small `shop` model carries what
 * Northwind lacks — database-filled and uuid keys, a view, a cascading
 * foreign key, a secret column, a second schema and a name with no ASCII.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { columnPolicyFor } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import {
  compileEndpoint,
  defaultDefinitionFor,
  definitionToResource,
  effectiveEndpoints,
  EndpointCompileError,
  endpointIssues,
  parseDefinition,
  printDefinition,
  PUBLIC_METHODS,
  slugFor,
  sourceTable,
  type PublicEndpointDefinition,
} from '../src/public-api/endpoint.js';
import { compileScope, type PublicScopeDocument } from '../src/public-api/scope.js';

function viewOf(model: unknown): SnapshotView {
  const parsed = applyClassification(parseDatabaseModel(model));
  return new SnapshotView('cnx_test', applyOverrides(parsed as DatabaseModel, []));
}

const northwind = viewOf(
  readFileSync(
    fileURLToPath(new URL('../../../packages/engine/test/fixtures/northwind.model.json', import.meta.url)),
    'utf8',
  ),
);

const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'text', ...extra });

const shop = viewOf({
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  schemas: ['public', 'billing'],
  tables: [
    {
      schema: 'public',
      name: 'users',
      primaryKey: ['id'],
      columns: [
        col('id', { logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } }),
        col('display_name'),
        col('email'),
        col('password_hash'),
        col('role'),
        col('created_at', { logicalType: 'timestamp', isGenerated: true }),
      ],
    },
    {
      schema: 'public',
      name: 'orders',
      primaryKey: ['id'],
      columns: [
        col('id', { logicalType: 'uuid', nullable: false, isPrimaryKey: true }),
        col('user_id', { logicalType: 'integer', references: { tableId: 'public.users', column: 'id' } }),
        col('status'),
        col('total', { logicalType: 'decimal' }),
      ],
    },
    {
      schema: 'public',
      name: 'order_lines',
      primaryKey: ['order_id', 'sku'],
      columns: [
        col('order_id', { logicalType: 'uuid', nullable: false, isPrimaryKey: true, references: { tableId: 'public.orders', column: 'id' } }),
        col('sku', { nullable: false, isPrimaryKey: true }),
        col('qty', { logicalType: 'integer' }),
      ],
    },
    {
      schema: 'public',
      name: 'tags',
      primaryKey: ['name'],
      columns: [col('name', { nullable: false, isPrimaryKey: true })],
    },
    { schema: 'public', name: 'audit_trail', primaryKey: [], columns: [col('event'), col('at', { logicalType: 'timestamp' })] },
    { schema: 'public', name: 'order_totals', kind: 'view', primaryKey: [], columns: [col('status'), col('total', { logicalType: 'decimal' })] },
    { schema: 'public', name: 'invoices', primaryKey: ['id'], columns: [col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } }), col('number')] },
    { schema: 'billing', name: 'invoices', primaryKey: ['id'], columns: [col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } }), col('amount')] },
    { schema: 'public', name: 'Invoices', primaryKey: ['id'], columns: [col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } })] },
    { schema: 'public', name: 'ümläut', primaryKey: ['id'], columns: [col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } })] },
    { schema: 'public', name: 'adminium_users', primaryKey: ['id'], system: true, columns: [col('id', { isPrimaryKey: true })] },
  ],
  relations: [
    {
      id: 'fk:orders-users',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.orders', columns: ['user_id'] },
      to: { tableId: 'public.users', columns: ['id'] },
      onDelete: 'set-null',
    },
    {
      id: 'fk:lines-orders',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.order_lines', columns: ['order_id'] },
      to: { tableId: 'public.orders', columns: ['id'] },
      onDelete: 'cascade',
    },
  ],
});

/** A valid custom definition on `public.users`, to break one field at a time. */
function users(over: Partial<PublicEndpointDefinition> = {}): PublicEndpointDefinition {
  return {
    path: '/users',
    source: 'public.users',
    methods: ['GET', 'PATCH'],
    select: ['id', 'display_name', 'role'],
    filters: [{ column: 'role', op: 'eq', value: 'member' }],
    pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 120, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    ...over,
  };
}

const codes = (input: unknown, ref = 'users', view: SnapshotView | null = shop, appBound = false): string[] =>
  endpointIssues(input, { ref, view, grantedToAppBoundKey: appBound }).map((i) => i.code);

/** Every default of a view, compiled the way a key granted all of it would be. */
function derivedDocumentOf(view: SnapshotView): PublicScopeDocument {
  const { endpoints } = effectiveEndpoints(view, []);
  return {
    version: 1,
    side: 'customer',
    timezone: 'UTC',
    resources: endpoints.map((e) => {
      const def = e.definition as PublicEndpointDefinition;
      return definitionToResource(e.ref, def, PUBLIC_METHODS, sourceTable(view, def.source));
    }),
  };
}

describe('the definition document', () => {
  it('accepts the valid fixture with no issue', () => {
    expect(codes(users())).toEqual([]);
  });

  it('refuses an unknown key by name, and bad JSON as a shape issue', () => {
    const issues = endpointIssues({ ...users(), rls: true }, { ref: 'users', view: shop });
    expect(issues.map((i) => i.code)).toEqual(['ENDPOINT_SHAPE_INVALID']);
    expect(issues[0]?.message).toContain('rls');
    expect(codes('{ not json')).toEqual(['ENDPOINT_SHAPE_INVALID']);
    expect(codes({ ...users(), methods: ['GET', 'UPSERT'] })).toEqual(['ENDPOINT_SHAPE_INVALID']);
    expect(codes({ ...users(), methods: ['GET', 'GET'] })).toEqual(['ENDPOINT_SHAPE_INVALID']);
  });

  it('prints in D6 order with canonical methods, and an advanced key round-trips', () => {
    const def = users({
      methods: ['PATCH', 'GET'],
      writable: ['display_name'],
      defaults: { role: 'member' },
      searchable: ['display_name'],
      orderable: ['id'],
      sensitive: true,
      allow_cascade: true,
    });
    const text = printDefinition(def);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      'path', 'source', 'methods', 'select', 'filters', 'pagination', 'auth', 'rate_limit', 'response',
      'writable', 'defaults', 'searchable', 'orderable', 'sensitive', 'allow_cascade',
    ]);
    expect((JSON.parse(text) as { methods: string[] }).methods).toEqual(['GET', 'PATCH']);
    const reparsed = parseDefinition(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    // Printing what was parsed from the print changes nothing: the pane's
    // "synced" check compares text, so the round trip must be a fixed point.
    expect(printDefinition(reparsed.definition)).toBe(text);
    expect(reparsed.definition.writable).toEqual(['display_name']);
    expect(reparsed.definition.defaults).toEqual({ role: 'member' });
    expect(reparsed.definition.sensitive).toBe(true);
  });

  it('round-trips identity and claim keys', () => {
    const def = users({
      auth: { role: 'authenticated' },
      identity: { strategy: 'email-code', match: ['email'], column: 'id' },
    });
    const parsed = parseDefinition(printDefinition(def));
    expect(parsed.ok && parsed.definition.identity).toEqual({ strategy: 'email-code', match: ['email'], column: 'id' });
    const claimed = parseDefinition(printDefinition(users({ claim: { via: { ref: 'users', localColumn: 'id', foreignColumn: 'id' } } })));
    expect(claimed.ok && claimed.definition.claim).toEqual({ via: { ref: 'users', localColumn: 'id', foreignColumn: 'id' } });
  });
});

describe('every ENDPOINT_* refusal', () => {
  it('ENDPOINT_REF_INVALID and ENDPOINT_PATH_MISMATCH', () => {
    expect(codes(users({ path: '/Users' }), 'Users')).toContain('ENDPOINT_REF_INVALID');
    expect(codes(users({ path: '/members' }))).toEqual(['ENDPOINT_PATH_MISMATCH']);
  });

  it('ENDPOINT_SOURCE_UNKNOWN — a missing table, a system table, and no snapshot at all', () => {
    expect(codes(users({ source: 'public.nope' }))).toEqual(['ENDPOINT_SOURCE_UNKNOWN']);
    expect(codes(users(), 'users', null)).toEqual(['ENDPOINT_SOURCE_UNKNOWN']);
  });

  it('ENDPOINT_SOURCE_META_NAMESPACE, refused by name before the snapshot is asked', () => {
    expect(codes(users({ source: 'public.adminium_users' }))).toEqual(['ENDPOINT_SOURCE_META_NAMESPACE']);
    expect(codes(users({ source: 'adminium_sessions' }), 'users', null)).toEqual(['ENDPOINT_SOURCE_META_NAMESPACE']);
  });

  it('ENDPOINT_SELECT_EMPTY and ENDPOINT_SELECT_UNKNOWN_COLUMN (a secret column counts as absent)', () => {
    expect(codes(users({ select: [], pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' } }))).toContain(
      'ENDPOINT_SELECT_EMPTY',
    );
    expect(codes(users({ select: ['id', 'role', 'nickname'] }))).toContain('ENDPOINT_SELECT_UNKNOWN_COLUMN');
    const secret = endpointIssues(users({ select: ['id', 'role', 'password_hash'] }), { ref: 'users', view: shop });
    expect(secret.find((i) => i.code === 'ENDPOINT_SELECT_UNKNOWN_COLUMN')?.column).toBe('password_hash');
  });

  it('ENDPOINT_ORDER_NOT_SELECTED', () => {
    expect(codes(users({ pagination: { default_limit: 20, max_limit: 200, order: 'email.asc' } }))).toContain(
      'ENDPOINT_ORDER_NOT_SELECTED',
    );
  });

  it('ENDPOINT_LIMIT_ORDER — a default above the maximum, and a maximum above 200', () => {
    expect(codes(users({ pagination: { default_limit: 50, max_limit: 20, order: 'id.desc' } }))).toEqual([
      'ENDPOINT_LIMIT_ORDER',
    ]);
    expect(codes(users({ pagination: { default_limit: 20, max_limit: 500, order: 'id.desc' } }))).toEqual([
      'ENDPOINT_LIMIT_ORDER',
    ]);
  });

  it('ENDPOINT_RATE_RANGE — measured as a minute-equivalent across all three windows', () => {
    expect(codes(users({ rate_limit: { requests: 10_000, window: '1m' } }))).toEqual([]);
    expect(codes(users({ rate_limit: { requests: 10_001, window: '1m' } }))).toEqual(['ENDPOINT_RATE_RANGE']);
    expect(codes(users({ rate_limit: { requests: 167, window: '1s' } }))).toEqual(['ENDPOINT_RATE_RANGE']);
    expect(codes(users({ rate_limit: { requests: 600_000, window: '1h' } }))).toEqual([]);
    expect(codes(users({ rate_limit: { requests: 0, window: '1m' } }))).toEqual(['ENDPOINT_SHAPE_INVALID']);
  });

  it('ENDPOINT_SOURCE_READ_ONLY — a view answers GET only; a table with no key cannot be addressed', () => {
    const view = { source: 'public.order_totals', path: '/order_totals', select: ['status', 'total'], filters: [] };
    const pag = { default_limit: 20, max_limit: 200, order: 'status.asc' };
    expect(codes(users({ ...view, pagination: pag, methods: ['GET'] }), 'order_totals')).toEqual([]);
    expect(codes(users({ ...view, pagination: pag, methods: ['GET', 'POST'] }), 'order_totals')).toContain(
      'ENDPOINT_SOURCE_READ_ONLY',
    );
    const keyless = { source: 'public.audit_trail', path: '/audit_trail', select: ['event', 'at'], filters: [] };
    const pag2 = { default_limit: 20, max_limit: 200, order: 'at.desc' };
    expect(codes(users({ ...keyless, pagination: pag2, methods: ['GET', 'POST', 'BATCH'] }), 'audit_trail')).toEqual([]);
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      expect(codes(users({ ...keyless, pagination: pag2, methods: ['GET', method] }), 'audit_trail')).toContain(
        'ENDPOINT_SOURCE_READ_ONLY',
      );
    }
  });

  it('ENDPOINT_WRITABLE_PRIMARY_KEY — a key, a generated column and an identity column', () => {
    const on = (writable: string[]) =>
      codes(users({ methods: ['GET', 'POST'], select: ['id', 'display_name', 'role', 'created_at'], filters: [], writable }));
    expect(on(['display_name'])).toEqual([]);
    expect(on(['id', 'display_name'])).toContain('ENDPOINT_WRITABLE_PRIMARY_KEY');
    expect(on(['created_at'])).toContain('ENDPOINT_WRITABLE_PRIMARY_KEY');
    // A natural key with no default is refused the same way.
    const tags = { source: 'public.tags', path: '/tags', select: ['name'], filters: [], pagination: { default_limit: 20, max_limit: 200, order: 'name.asc' } };
    expect(codes(users({ ...tags, methods: ['GET', 'PATCH'], writable: ['name'] }), 'tags')).toContain(
      'ENDPOINT_WRITABLE_PRIMARY_KEY',
    );
  });

  it('ENDPOINT_DELETE_CASCADES unless allow_cascade is set (SET NULL counts)', () => {
    expect(codes(users({ methods: ['GET', 'DELETE'] }))).toEqual(['ENDPOINT_DELETE_CASCADES']);
    expect(codes(users({ methods: ['GET', 'DELETE'], allow_cascade: true }))).toEqual([]);
    const orders = {
      source: 'public.orders', path: '/orders', select: ['id', 'status'], filters: [],
      pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
    };
    const issue = endpointIssues(users({ ...orders, methods: ['DELETE'] }), { ref: 'orders', view: shop });
    expect(issue.map((i) => i.code)).toEqual(['ENDPOINT_DELETE_CASCADES']);
    expect(issue[0]?.message).toContain('public.order_lines');
  });

  it('ENDPOINT_PII_ON_ANON — only for an endpoint anyone can call', () => {
    const masked = columnPolicyFor(shop.table('public.users').table).masked;
    expect(masked.has('email')).toBe(true);
    const withEmail = users({ select: ['id', 'display_name', 'role', 'email'] });
    expect(codes(withEmail)).toEqual(['ENDPOINT_PII_ON_ANON']);
    expect(codes({ ...withEmail, auth: { role: 'service_role' } })).toEqual([]);
  });

  it('ENDPOINT_AUTHENTICATED_WITHOUT_CLAIM, ENDPOINT_IDENTITY_NEEDS_GET, ENDPOINT_IDENTITY_WITH_CLAIM', () => {
    expect(codes(users({ auth: { role: 'authenticated' } }))).toEqual(['ENDPOINT_AUTHENTICATED_WITHOUT_CLAIM']);
    expect(codes(users({ auth: { role: 'authenticated' }, claim: { column: 'id' } }))).toEqual([]);
    const identity = { strategy: 'email-code' as const, match: ['email'], column: 'id' };
    expect(codes(users({ auth: { role: 'authenticated' }, identity }))).toEqual([]);
    expect(codes(users({ auth: { role: 'authenticated' }, identity, methods: ['PATCH'] }))).toContain(
      'ENDPOINT_IDENTITY_NEEDS_GET',
    );
    expect(codes(users({ auth: { role: 'authenticated' }, identity, claim: { column: 'id' } }))).toContain(
      'ENDPOINT_IDENTITY_WITH_CLAIM',
    );
  });

  it('ENDPOINT_SHAPE_APP_BOUND — only while an app-bound key is granted the endpoint', () => {
    expect(codes(users({ response: { shape: 'array' } }))).toEqual([]);
    expect(codes(users({ response: { shape: 'array' } }), 'users', shop, true)).toEqual(['ENDPOINT_SHAPE_APP_BOUND']);
    expect(codes(users(), 'users', shop, true)).toEqual([]);
  });

  it('reports what the derived scope would refuse, before anything is stored', () => {
    // A writable column the filter pins: a caller could write itself out of scope.
    expect(codes(users({ writable: ['role'] }))).toContain('SCOPE_WHERE_COLUMN_WRITABLE');
    // A searchable column that is not selected.
    expect(codes(users({ searchable: ['email'] }))).toContain('SCOPE_SEARCHABLE_NOT_EXPOSED');
    // A writable secret column is an unknown column, not a quiet grant.
    expect(codes(users({ writable: ['password_hash'] }))).toContain('SCOPE_WRITABLE_UNKNOWN_COLUMN');
    // A filter with no value.
    expect(codes(users({ filters: [{ column: 'role', op: 'eq' }] }))).toContain('SCOPE_WHERE_VALUE_MISSING');
  });

  it('a switched-off endpoint (no methods) is not checked against its columns, so drift cannot pin it', () => {
    expect(codes(users({ methods: [], select: ['id', 'gone_column'] }))).toEqual([]);
    // …but its path and its source still are: a tombstone names a real table.
    expect(codes(users({ methods: [], source: 'public.gone' }))).toEqual(['ENDPOINT_SOURCE_UNKNOWN']);
  });

  it('compileEndpoint throws every issue at once, and returns the definition when clean', () => {
    expect(compileEndpoint(printDefinition(users()), { ref: 'users', view: shop }).source).toBe('public.users');
    try {
      compileEndpoint(users({ path: '/x', select: [] }), { ref: 'users', view: shop });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointCompileError);
      expect((error as EndpointCompileError).issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['ENDPOINT_PATH_MISMATCH', 'ENDPOINT_SELECT_EMPTY', 'ENDPOINT_ORDER_NOT_SELECTED']),
      );
    }
  });
});

describe('definitionToResource', () => {
  const table = shop.table('public.users');

  it('grants only the methods the endpoint ALSO offers, mapped one to one', () => {
    const r = definitionToResource('users', users({ methods: ['GET', 'PATCH', 'DELETE'] }), ['GET', 'DELETE', 'BATCH'], table);
    expect(r.actions).toEqual(['read', 'delete']);
    expect(definitionToResource('users', users(), ['BATCH'], table).actions).toEqual([]);
  });

  it('defaults writable to select minus key, database-filled, filtered and claim columns', () => {
    const def = users({
      methods: ['GET', 'POST'],
      select: ['id', 'display_name', 'role', 'created_at'],
      filters: [{ column: 'role', op: 'eq', value: 'member' }],
    });
    expect(definitionToResource('users', def, ['POST'], table).writable).toEqual(['display_name']);
    const claimed = users({ select: ['id', 'display_name', 'role'], filters: [], claim: { column: 'display_name' } });
    expect(definitionToResource('users', claimed, ['PATCH'], table).writable).toEqual(['role']);
  });

  it('carries pagination, rate and response into the resource', () => {
    const r = definitionToResource(
      'users',
      users({ rate_limit: { requests: 5, window: '1s' }, response: { shape: 'single' } }),
      ['GET'],
      table,
    );
    expect(r).toMatchObject({
      limit: 200,
      defaultLimit: 20,
      defaultOrder: 'id.desc',
      rate: { max: 5, windowMs: 1_000 },
      response: { shape: 'single' },
      where: [{ column: 'role', op: 'eq', value: 'member' }],
    });
  });

  it('an identity becomes the resource claim column', () => {
    const def = users({ auth: { role: 'authenticated' }, identity: { strategy: 'email-code', match: ['email'], column: 'id' } });
    expect(definitionToResource('users', def, ['GET'], table).claim).toEqual({ column: 'id' });
  });
});

describe('generated defaults', () => {
  it('slugs by table ID: default schema bare, others prefixed; none when empty or too long', () => {
    expect(slugFor({ schema: 'public', name: 'order_details' }, 'public')).toBe('order_details');
    expect(slugFor({ schema: 'billing', name: 'invoices' }, 'public')).toBe('billing_invoices');
    expect(slugFor({ schema: 'public', name: 'Order Items' }, 'public')).toBe('order_items');
    expect(slugFor({ schema: 'public', name: 'ümläut' }, 'public')).toBe('ml_ut');
    expect(slugFor({ schema: 'public', name: '日本' }, 'public')).toBeNull();
    expect(slugFor({ schema: 'public', name: '2024_sales' }, 'public')).toBeNull();
    expect(slugFor({ schema: 'public', name: 'x'.repeat(65) }, 'public')).toBeNull();
  });

  it('Northwind: every default compiles as a derived scope with no SCOPE_* issue', () => {
    const doc = derivedDocumentOf(northwind);
    expect(doc.resources).toHaveLength(14);
    expect(() => compileScope(doc, (t) => {
      const table = sourceTable(northwind, t);
      return table === null ? null : new Set([...table.columns.values()].filter((c) => !c.secret).map((c) => c.name));
    })).not.toThrow();
  });

  it('Northwind and shop: every default passes its own compile with no issue at all', () => {
    for (const view of [northwind, shop]) {
      for (const e of effectiveEndpoints(view, []).endpoints) {
        expect([e.ref, endpointIssues(e.definition, { ref: e.ref, view })]).toEqual([e.ref, []]);
      }
    }
  });

  it('no default selects a secret or a PII-masked column', () => {
    for (const view of [northwind, shop]) {
      for (const e of effectiveEndpoints(view, []).endpoints) {
        const def = e.definition as PublicEndpointDefinition;
        const table = sourceTable(view, def.source);
        if (table === null) throw new Error(def.source);
        const policy = columnPolicyFor(table.table);
        for (const c of def.select) {
          expect(policy.secret.has(c), `${e.ref}.${c} secret`).toBe(false);
          expect(policy.masked.has(c), `${e.ref}.${c} masked`).toBe(false);
        }
      }
    }
    const users = effectiveEndpoints(shop, []).endpoints.find((e) => e.ref === 'users');
    expect(users?.definition?.select).toEqual(['id', 'display_name', 'role', 'created_at']);
  });

  it('offers every method the source supports, and no method it cannot honour', () => {
    const methodsOf = (view: SnapshotView, ref: string) =>
      effectiveEndpoints(view, []).endpoints.find((e) => e.ref === ref)?.definition?.methods;
    // A database-filled key, no cascade into it from anything… but orders → users is SET NULL.
    expect(methodsOf(shop, 'users')).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'BATCH']);
    // A uuid key the server mints; order_lines cascades from it, so no DELETE.
    expect(methodsOf(shop, 'orders')).toEqual(['GET', 'POST', 'PATCH', 'PUT', 'BATCH']);
    expect(effectiveEndpoints(shop, []).endpoints.find((e) => e.ref === 'orders')?.definition?.defaults).toEqual({
      id: { $generate: 'uuid' },
    });
    // A natural composite key: no insert, but rows can be edited and removed.
    expect(methodsOf(shop, 'order_lines')).toEqual(['GET', 'PATCH', 'PUT', 'DELETE']);
    // All key, nothing to write.
    expect(methodsOf(shop, 'tags')).toEqual(['GET', 'DELETE']);
    // No key: a row cannot be addressed.
    expect(methodsOf(shop, 'audit_trail')).toEqual(['GET', 'POST', 'BATCH']);
    expect(methodsOf(shop, 'order_totals')).toEqual(['GET']);
    // Northwind's integer keys have no database default, so nothing inserts.
    expect(methodsOf(northwind, 'categories')).toEqual(['GET', 'PATCH', 'PUT', 'DELETE']);
  });

  it('D5 values: 20 / 200, key descending, anon, 120 a minute, wrapped', () => {
    const def = defaultDefinitionFor(shop, shop.table('public.users'), 'users');
    expect(def).toMatchObject({
      path: '/users',
      source: 'public.users',
      filters: [],
      pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 120, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
    });
    expect(defaultDefinitionFor(shop, shop.table('public.audit_trail'), 'audit_trail')?.pagination.order).toBe('event.desc');
  });
});

describe('effectiveEndpoints', () => {
  it('keeps system tables out, and gives colliding or unslugable tables no default', () => {
    const { endpoints, unaddressable } = effectiveEndpoints(shop, []);
    const refs = endpoints.map((e) => e.ref);
    expect(refs).not.toContain('adminium_users');
    expect(refs).toContain('billing_invoices');
    // `public.invoices` and `public.Invoices` both slug to `invoices`.
    expect(refs).not.toContain('invoices');
    expect(unaddressable.filter((u) => u.reason === 'slug-collision').map((u) => u.tableId).sort()).toEqual([
      'public.Invoices',
      'public.invoices',
    ]);
    expect(unaddressable.find((u) => u.tableId === 'public.invoices')?.collidesWith).toEqual(['public.Invoices']);
    expect(refs).toContain('ml_ut');
    expect(endpoints.every((e) => !e.stored && e.id === null && e.origin === 'generated')).toBe(true);
  });

  it('a stored row owns its ref — its own table is not reported, a foreign one is', () => {
    const narrowed = users({ methods: ['GET'] });
    const { endpoints, unaddressable } = effectiveEndpoints(shop, [
      { id: 'pep_1', ref: 'users', origin: 'generated', definition: printDefinition(narrowed) },
      { id: 'pep_2', ref: 'orders', origin: 'custom', definition: printDefinition(users({ path: '/orders' })) },
    ]);
    const users1 = endpoints.find((e) => e.ref === 'users');
    expect(users1).toMatchObject({ id: 'pep_1', stored: true, origin: 'generated', issues: [] });
    expect(users1?.definition?.methods).toEqual(['GET']);
    expect(endpoints.filter((e) => e.ref === 'orders')).toHaveLength(1);
    expect(unaddressable.find((u) => u.tableId === 'public.orders')?.reason).toBe('ref-taken');
    expect(unaddressable.find((u) => u.tableId === 'public.users')).toBeUndefined();
  });

  it('a tombstone keeps the virtual default from coming back', () => {
    const { endpoints } = effectiveEndpoints(shop, [
      { id: 'pep_1', ref: 'users', origin: 'generated', definition: printDefinition(users({ methods: [] })) },
    ]);
    const row = endpoints.filter((e) => e.ref === 'users');
    expect(row).toHaveLength(1);
    expect(row[0]?.definition?.methods).toEqual([]);
  });

  it('a stored row that drifted or no longer parses carries its issues', () => {
    const { endpoints } = effectiveEndpoints(shop, [
      { id: 'pep_1', ref: 'users', origin: 'custom', definition: printDefinition(users({ source: 'public.gone' })) },
      { id: 'pep_2', ref: 'broken', origin: 'custom', definition: '{"path": "/broken"' },
    ]);
    expect(endpoints.find((e) => e.ref === 'users')?.issues.map((i) => i.code)).toEqual(['ENDPOINT_SOURCE_UNKNOWN']);
    const broken = endpoints.find((e) => e.ref === 'broken');
    expect(broken?.definition).toBeNull();
    expect(broken?.issues.map((i) => i.code)).toEqual(['ENDPOINT_SHAPE_INVALID']);
  });

  it('with no snapshot, stored rows are listed and nothing is generated', () => {
    const { endpoints, unaddressable } = effectiveEndpoints(null, [
      { id: 'pep_1', ref: 'users', origin: 'custom', definition: printDefinition(users()) },
    ]);
    expect(endpoints.map((e) => e.ref)).toEqual(['users']);
    expect(endpoints[0]?.issues.map((i) => i.code)).toEqual(['ENDPOINT_SOURCE_UNKNOWN']);
    expect(unaddressable).toEqual([]);
  });
});
