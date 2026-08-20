// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Claims and the predicate they buy (28-public-surface.md §3.4, 28-T19).
 *
 * The interesting tests are all refusals. A claim endpoint is an identity
 * check, and every way of making one slightly more helpful — telling the caller
 * which factor was wrong, accepting a partial match, letting an extra field
 * through — turns it into a search over the reference space.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { compileScope, type CompiledResource } from '../src/public-api/scope.js';
import {
  claimPredicateFor,
  combinePredicates,
  parseGrant,
  type PublicSessionContext,
} from '../src/public-api/claim.js';

function col(name: string, logicalType = 'varchar', isPrimaryKey = false) {
  return { name, logicalType, nullable: false, isPrimaryKey, semantics: null };
}

const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.orders',
      schema: 'public',
      name: 'orders',
      kind: 'table',
      primaryKey: ['id'],
      columns: [col('id', 'int4', true), col('ref'), col('email'), col('customer_id'), col('status')],
    },
    {
      id: 'public.order_lines',
      schema: 'public',
      name: 'order_lines',
      kind: 'table',
      primaryKey: ['id'],
      columns: [col('id', 'int4', true), col('order_id'), col('qty', 'int4')],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);
const columnsOf = (t: string): Set<string> | null => {
  try {
    return new Set(view.table(t).columns.keys());
  } catch {
    return null;
  }
};

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function scopeDoc(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    side: 'customer',
    timezone: 'Europe/London',
    claim: { strategy: 'lookup', ref: 'orders', match: ['ref', 'email'] },
    resources: [
      {
        ref: 'orders',
        table: 'public.orders',
        actions: ['read'],
        expose: ['id', 'ref', 'status'],
        claim: { column: 'customer_id' },
      },
      {
        ref: 'lines',
        table: 'public.order_lines',
        actions: ['read'],
        expose: ['id', 'qty'],
        claim: { via: { ref: 'orders', localColumn: 'order_id', foreignColumn: 'id' } },
      },
      {
        // Open to everyone — no claim declared.
        ref: 'statuses',
        table: 'public.orders',
        actions: ['read'],
        expose: ['status'],
      },
    ],
    ...over,
  };
}

const scope = compileScope(scopeDoc(), columnsOf);
const res = (ref: string): CompiledResource => scope.byRef.get(ref) as CompiledResource;

const SESSION: PublicSessionContext = {
  id: 'pss_1',
  keyId: 'pbk_1',
  grant: { ref: 'orders', column: 'customer_id', value: 41 },
};

describe('a claim-gated resource is UNREACHABLE without a session', () => {
  it('reports not-reachable rather than simply unfiltered', () => {
    // "Unfiltered" would mean the scoping silently evaporates when a session
    // expires — the exact failure this design exists to make impossible.
    expect(claimPredicateFor(res('orders'), null)).toEqual({ reachable: false });
    expect(claimPredicateFor(res('lines'), null)).toEqual({ reachable: false });
  });

  it('leaves a resource with no claim open to everyone', () => {
    expect(claimPredicateFor(res('statuses'), null)).toEqual({ reachable: true, predicate: null });
  });
});

describe('a session pins the claim column', () => {
  it('produces an equality predicate on the declared column', () => {
    const out = claimPredicateFor(res('orders'), SESSION);
    expect(out).toEqual({
      reachable: true,
      predicate: { column: 'customer_id', op: 'eq', value: 41 },
    });
  });

  it('follows ONE hop via the referencing column', () => {
    const out = claimPredicateFor(res('lines'), SESSION);
    expect(out).toEqual({ reachable: true, predicate: { column: 'order_id', op: 'eq', value: 41 } });
  });

  it('adds nothing to a resource that declared no claim', () => {
    expect(claimPredicateFor(res('statuses'), SESSION)).toEqual({ reachable: true, predicate: null });
  });
});

describe('the scope predicate and the session predicate are BOTH mandatory', () => {
  it('ANDs them, and neither survives alone', () => {
    const withWhere = compileScope(
      scopeDoc({
        resources: [
          {
            ref: 'orders',
            table: 'public.orders',
            actions: ['read'],
            expose: ['id', 'ref', 'status'],
            where: [{ column: 'status', op: 'neq', value: 'draft' }],
            claim: { column: 'customer_id' },
          },
        ],
        claim: { strategy: 'lookup', ref: 'orders', match: ['ref', 'email'] },
      }),
      columnsOf,
    );
    const r = withWhere.byRef.get('orders') as CompiledResource;
    const claim = claimPredicateFor(r, SESSION);
    expect(claim.reachable).toBe(true);
    const combined = combinePredicates(
      r.mandatory,
      claim.reachable ? claim.predicate : null,
    );
    expect(combined).toEqual({
      and: [
        { column: 'status', op: 'neq', value: 'draft' },
        { column: 'customer_id', op: 'eq', value: 41 },
      ],
    });
  });

  it('returns whichever exists when only one does', () => {
    expect(combinePredicates(null, { column: 'a', op: 'eq', value: 1 })).toEqual({
      column: 'a',
      op: 'eq',
      value: 1,
    });
    expect(combinePredicates({ column: 'b', op: 'eq', value: 2 }, null)).toEqual({
      column: 'b',
      op: 'eq',
      value: 2,
    });
    expect(combinePredicates(null, null)).toBeNull();
  });
});

describe('resolveClaim — every failure is the same failure', () => {
  // `resolveClaim` runs a query, so these exercise the pre-query refusals,
  // which are the ones that decide whether the endpoint is an oracle.
  const run = async (match: Record<string, unknown>) => {
    const { resolveClaim } = await import('../src/public-api/claim.js');
    return resolveClaim({ db, table: view.table('public.orders'), resource: res('orders'), scope, match });
  };

  it('refuses a MISSING factor', async () => {
    // Otherwise a two-factor lookup is two one-factor lookups.
    expect(await run({ ref: 'RH-1' })).toBeNull();
  });

  it('refuses an EXTRA field', async () => {
    // Otherwise the caller chooses what to search on.
    expect(await run({ ref: 'RH-1', email: 'a@b.c', status: 'paid' })).toBeNull();
  });

  it('refuses a field the scope never declared', async () => {
    expect(await run({ ref: 'RH-1', status: 'paid' })).toBeNull();
  });

  it('refuses when the scope declares no claim at all', async () => {
    const { resolveClaim } = await import('../src/public-api/claim.js');
    const noClaim = compileScope(
      {
        version: 1,
        side: 'customer',
        timezone: 'UTC',
        resources: [
          { ref: 'orders', table: 'public.orders', actions: ['read'], expose: ['id'] },
        ],
      },
      columnsOf,
    );
    expect(
      await resolveClaim({
        db,
        table: view.table('public.orders'),
        resource: noClaim.byRef.get('orders') as CompiledResource,
        scope: noClaim,
        match: { ref: 'x' },
      }),
    ).toBeNull();
  });
});

describe('parseGrant', () => {
  it('accepts a well-formed grant and rejects anything else', () => {
    expect(parseGrant('{"ref":"orders","column":"customer_id","value":41}')).toEqual({
      ref: 'orders',
      column: 'customer_id',
      value: 41,
    });
    expect(parseGrant('not json')).toBeNull();
    expect(parseGrant('{"ref":"orders"}')).toBeNull();
    expect(parseGrant('null')).toBeNull();
  });
});
