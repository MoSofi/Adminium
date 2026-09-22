// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `public-api/derive.ts` and `endpoint-service.ts` — derived scope documents
 * and the endpoint save that regenerates them.
 *
 * The pure half pins what a key's grants add up to. The service half runs the
 * save against a real (in-memory) meta store, because what matters there is
 * what gets COMMITTED: a refused save must leave every row as it was, a save
 * must reach every live key that grants the endpoint and no other, and two
 * keys broken by drift in two endpoints must be repairable one save at a time.
 */

import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import {
  connectionsRepo,
  publicApiStateRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  publicScopesRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import {
  deriveScopeDocument,
  derivedDocumentIssues,
  endpointMap,
  introducedIssues,
  parseAccess,
  type AccessMap,
  type DeriveEndpoint,
} from '../src/public-api/derive.js';
import {
  createEndpointService,
  EndpointSaveRefused,
  PublicApiContended,
} from '../src/public-api/endpoint-service.js';
import { printDefinition, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { compileScope, ScopeCompileError } from '../src/public-api/scope.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'text', ...extra });

const view = new SnapshotView(
  'cnx',
  applyOverrides(
    applyClassification(
      parseDatabaseModel({
        dialect: 'postgres',
        name: 'shop',
        tables: [
          {
            schema: 'public',
            name: 'customers',
            primaryKey: ['id'],
            columns: [
              col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } }),
              col('ref_no'),
              col('display_name'),
              col('email'),
            ],
          },
          {
            schema: 'public',
            name: 'orders',
            primaryKey: ['id'],
            columns: [
              col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } }),
              col('customer_id', { logicalType: 'integer' }),
              col('status'),
              col('total', { logicalType: 'decimal' }),
            ],
          },
          {
            schema: 'public',
            name: 'products',
            primaryKey: ['id'],
            columns: [
              col('id', { logicalType: 'integer', isPrimaryKey: true, default: { kind: 'autoincrement' } }),
              col('name'),
              col('price', { logicalType: 'decimal' }),
            ],
          },
        ],
      }),
    ) as DatabaseModel,
    [],
  ),
);

function def(ref: string, source: string, select: string[], over: Partial<PublicEndpointDefinition> = {}): PublicEndpointDefinition {
  return {
    path: `/${ref}`,
    source,
    methods: ['GET', 'POST', 'PATCH'],
    select,
    filters: [],
    pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 120, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    ...over,
  };
}

const products = (over: Partial<PublicEndpointDefinition> = {}) => def('products', 'public.products', ['id', 'name', 'price'], over);
const orders = (over: Partial<PublicEndpointDefinition> = {}) => def('orders', 'public.orders', ['id', 'status', 'total'], over);

const map = (...endpoints: DeriveEndpoint[]) => new Map(endpoints.map((e) => [e.id, e]));

describe('deriveScopeDocument', () => {
  const eps = map(
    { id: 'pep_p', ref: 'products', definition: products() },
    { id: 'pep_o', ref: 'orders', definition: orders() },
  );

  it('side follows the key kind: a browser key is customer-side, a server key staff-side', () => {
    expect(deriveScopeDocument({ kind: 'browser', access: { pep_p: ['GET'] } }, eps, view).document.side).toBe('customer');
    expect(deriveScopeDocument({ kind: 'server', access: { pep_p: ['GET'] } }, eps, view).document.side).toBe('staff');
  });

  it('one key, several endpoints, different methods on each — sorted by ref', () => {
    const { document, issues, suspended } = deriveScopeDocument(
      { kind: 'browser', access: { pep_p: ['GET'], pep_o: ['GET', 'PATCH'] } },
      eps,
      view,
    );
    expect(issues).toEqual([]);
    expect(suspended).toEqual([]);
    expect(document.resources.map((r) => [r.ref, r.actions])).toEqual([
      ['orders', ['read', 'update']],
      ['products', ['read']],
    ]);
    // No time zone: it inherits from the connection.
    expect(document.timezone).toBeUndefined();
    expect(() => compileScope(document, undefined, { timezone: 'UTC' }, { derived: true })).not.toThrow();
  });

  it('a method the endpoint no longer offers is suspended, not granted; nothing left drops the resource', () => {
    const narrowed = map({ id: 'pep_p', ref: 'products', definition: products({ methods: ['GET'] }) });
    const one = deriveScopeDocument({ kind: 'browser', access: { pep_p: ['GET', 'PATCH'] } }, narrowed, view);
    expect(one.document.resources[0]?.actions).toEqual(['read']);
    expect(one.suspended).toEqual([{ endpointId: 'pep_p', ref: 'products', methods: ['PATCH'] }]);

    const off = map({ id: 'pep_p', ref: 'products', definition: products({ methods: [] }) });
    const none = deriveScopeDocument({ kind: 'browser', access: { pep_p: ['GET'] } }, off, view);
    expect(none.document.resources).toEqual([]);
    // A derived document may be empty; a hand-written one may not.
    expect(() => compileScope(none.document, undefined, { timezone: 'UTC' }, { derived: true })).not.toThrow();
    expect(() => compileScope(none.document, undefined, { timezone: 'UTC' })).toThrow(ScopeCompileError);

    const gone = deriveScopeDocument({ kind: 'browser', access: { pep_gone: ['GET'] } }, eps, view);
    expect(gone.suspended).toEqual([{ endpointId: 'pep_gone', ref: null, methods: ['GET'] }]);
  });

  it('a browser key granted a service-role endpoint is refused and never carries it', () => {
    const staff = map({ id: 'pep_o', ref: 'orders', definition: orders({ auth: { role: 'service_role' } }) });
    const browser = deriveScopeDocument({ kind: 'browser', access: { pep_o: ['GET'] } }, staff, view);
    expect(browser.issues.map((i) => i.code)).toEqual(['KEY_SERVICE_ROLE_BROWSER']);
    expect(browser.document.resources).toEqual([]);
    const server = deriveScopeDocument({ kind: 'server', access: { pep_o: ['GET'] } }, staff, view);
    expect(server.issues).toEqual([]);
    expect(server.document.resources.map((r) => r.ref)).toEqual(['orders']);
  });

  it('the identity endpoint becomes the document claim; missing, doubled or unreadable identities are refused', () => {
    const identity = def('customers', 'public.customers', ['id', 'ref_no', 'display_name'], {
      methods: ['GET'],
      auth: { role: 'authenticated' },
      identity: { strategy: 'lookup', match: ['ref_no'], column: 'id' },
    });
    const mine = orders({ auth: { role: 'authenticated' }, claim: { column: 'customer_id' } });
    const eps2 = map(
      { id: 'pep_c', ref: 'customers', definition: identity },
      { id: 'pep_o', ref: 'orders', definition: mine },
      { id: 'pep_c2', ref: 'customers2', definition: { ...identity, path: '/customers2' } },
    );
    const ok = deriveScopeDocument({ kind: 'browser', access: { pep_c: ['GET'], pep_o: ['GET'] } }, eps2, view);
    expect(ok.issues).toEqual([]);
    expect(ok.document.claim).toEqual({ strategy: 'lookup', ref: 'customers', match: ['ref_no'] });
    expect(ok.document.resources.find((r) => r.ref === 'customers')?.claim).toEqual({ column: 'id' });
    expect(() => compileScope(ok.document, undefined, { timezone: 'UTC' }, { derived: true })).not.toThrow();

    const missing = deriveScopeDocument({ kind: 'browser', access: { pep_o: ['GET'] } }, eps2, view);
    expect(missing.issues.map((i) => i.code)).toEqual(['KEY_IDENTITY_MISSING']);
    const twice = deriveScopeDocument({ kind: 'browser', access: { pep_c: ['GET'], pep_c2: ['GET'] } }, eps2, view);
    expect(twice.issues.map((i) => i.code)).toEqual(['KEY_IDENTITY_AMBIGUOUS']);
    const writeOnly = map({ id: 'pep_c', ref: 'customers', definition: { ...identity, methods: ['GET', 'PATCH'] } });
    const noRead = deriveScopeDocument({ kind: 'browser', access: { pep_c: ['PATCH'] } }, writeOnly, view);
    expect(noRead.issues.map((i) => i.code)).toContain('KEY_IDENTITY_NEEDS_GET');
  });

  it('parseAccess keeps known methods in canonical order and reads garbage as no grant', () => {
    expect(parseAccess('{"pep_a":["PATCH","GET","NOPE"]}')).toEqual({ pep_a: ['GET', 'PATCH'] });
    expect(parseAccess(null)).toEqual({});
    expect(parseAccess('[1]')).toEqual({});
    expect(parseAccess('{bad')).toEqual({});
  });

  it('introducedIssues compares by code, ref and column', () => {
    const a = { code: 'X', message: 'one', ref: 'r', column: 'c' };
    expect(introducedIssues([a], [{ ...a, message: 'reworded' }])).toEqual([]);
    expect(introducedIssues([a], [{ ...a, column: 'd' }])).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ service */

let meta: MetaDb;
let connectionId: string;
let invalidated: string[];

/*
 * One store per dialect for the whole block; every test gets a connection of
 * its own, and every query here is scoped by connection, so tests never see
 * each other's rows. The revision is global, and tests only read it relative.
 */
async function freshConnection(): Promise<void> {
  const conn = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({
    name: 'Shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/shop',
  });
  connectionId = conn.id;
  invalidated = [];
}

function service(over: { viewFor?: () => Promise<SnapshotView | null>; maxAttempts?: number } = {}) {
  return createEndpointService({
    meta,
    viewFor: over.viewFor ?? (async () => Promise.resolve(view)),
    tenantConfigOf: async () => Promise.resolve({ timezone: 'UTC' }),
    invalidate: (id) => invalidated.push(id),
    ...(over.maxAttempts === undefined ? {} : { maxAttempts: over.maxAttempts }),
  });
}

async function storeEndpoint(ref: string, definition: PublicEndpointDefinition) {
  return publicEndpointsRepo(meta).create({ connectionId, ref, origin: 'custom', definition: printDefinition(definition) });
}

let seq = 0;
/** A key minted the way key create will: derive, then scope, then key. */
async function derivedKey(access: AccessMap, opts: { kind?: 'browser' | 'server'; revoked?: boolean } = {}) {
  seq += 1;
  const id = `pbk_test${String(seq)}`;
  const eps = endpointMap(await publicEndpointsRepo(meta).listByConnection(connectionId));
  const { document } = deriveScopeDocument({ kind: opts.kind ?? 'browser', access }, eps, view);
  const scope = await publicScopesRepo(meta).create({
    connectionId,
    side: document.side,
    name: id,
    timezone: 'UTC',
    document: JSON.stringify(document),
    derivedForKey: id,
  });
  await publicKeysRepo(meta).create({
    id,
    name: id,
    prefix: `adm_pub_${String(seq).padStart(8, '0')}`,
    tokenHash: 'h'.repeat(64),
    tokenEncrypted: 'sealed',
    scopeId: scope.id,
    side: document.side,
    access,
    kind: opts.kind ?? 'browser',
  });
  if (opts.revoked === true) await publicKeysRepo(meta).revoke(id);
  return { id, scopeId: scope.id };
}

async function documentOf(scopeId: string): Promise<{ resources: { ref: string; expose: string[]; actions: string[] }[] }> {
  return JSON.parse((await publicScopesRepo(meta).findById(scopeId))?.document ?? 'null') as never;
}

for (const engine of META_ENGINES) {
describe.skipIf(!engine.available)(`saving an endpoint [${engine.name}]`, () => {
  let handle: MetaHandle;
  beforeAll(async () => {
    handle = await engine.make();
    meta = handle.meta;
  }, 60_000);
  afterAll(async () => {
    await handle.destroy();
  });
  beforeEach(freshConnection);

  it('stores a new endpoint in canonical text, advancing the revision', async () => {
    const before = await publicApiStateRepo(meta).read();
    const out = await service().saveEndpoint({ connectionId, ref: 'products', definition: products(), origin: 'generated' });
    expect(out.endpoint.definition).toBe(printDefinition(products()));
    expect(out.endpoint.origin).toBe('generated');
    expect(out.regenerated).toEqual([]);
    expect(await publicApiStateRepo(meta).read()).toBe(before + 1);
  });

  it('regenerates every LIVE key that grants it, and invalidates each — inert keys keep their document', async () => {
    const ep = await storeEndpoint('products', products());
    const live = await derivedKey({ [ep.id]: ['GET'] });
    const other = await derivedKey({ [ep.id]: ['GET', 'PATCH'] });
    const revoked = await derivedKey({ [ep.id]: ['GET'] }, { revoked: true });
    const unrelated = await derivedKey({});
    const frozen = await documentOf(revoked.scopeId);

    const out = await service().saveEndpoint({ connectionId, ref: 'products', definition: products({ select: ['id', 'name'] }) });
    expect(out.regenerated.map((k) => k.id).sort()).toEqual([live.id, other.id].sort());
    expect(invalidated.sort()).toEqual([live.id, other.id].sort());
    expect((await documentOf(live.scopeId)).resources[0]?.expose).toEqual(['id', 'name']);
    expect((await documentOf(other.scopeId)).resources[0]?.actions).toEqual(['read', 'update']);
    expect(await documentOf(revoked.scopeId)).toEqual(frozen);
    expect((await documentOf(unrelated.scopeId)).resources).toEqual([]);
  });

  it('an edit that would break a key is refused, names the key, and changes nothing', async () => {
    const ep = await storeEndpoint('orders', orders());
    const key = await derivedKey({ [ep.id]: ['GET'] });
    const docBefore = await documentOf(key.scopeId);
    const revisionBefore = await publicApiStateRepo(meta).read();

    const refusal = await service()
      .saveEndpoint({ connectionId, ref: 'orders', definition: orders({ auth: { role: 'service_role' } }) })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(EndpointSaveRefused);
    const { issues, keys } = refusal as EndpointSaveRefused;
    expect(issues.map((i) => i.code)).toEqual(['KEY_SERVICE_ROLE_BROWSER']);
    expect(keys.map((k) => k.id)).toEqual([key.id]);

    expect((await publicEndpointsRepo(meta).findById(ep.id))?.definition).toBe(printDefinition(orders()));
    expect(await documentOf(key.scopeId)).toEqual(docBefore);
    expect(await publicApiStateRepo(meta).read()).toBe(revisionBefore);
    expect(invalidated).toEqual([]);
  });

  it("refuses the definition's own issues before looking at any key", async () => {
    const refusal = await service()
      .saveEndpoint({ connectionId, ref: 'products', definition: products({ select: ['id', 'nope'] }) })
      .catch((error: unknown) => error);
    expect((refusal as EndpointSaveRefused).issues.map((i) => i.code)).toContain('ENDPOINT_SELECT_UNKNOWN_COLUMN');
    expect(await publicEndpointsRepo(meta).listByConnection(connectionId)).toEqual([]);
  });

  it('two drifted endpoints on one key are repaired by two saves', async () => {
    // Stored as they were before the columns went: both now name a missing one.
    const a = await storeEndpoint('products', products({ select: ['id', 'name', 'sku'] }));
    const b = await storeEndpoint('orders', orders({ select: ['id', 'status', 'channel'] }));
    const key = await derivedKey({ [a.id]: ['GET'], [b.id]: ['GET'] });
    const broken = derivedDocumentIssues(await documentOf(key.scopeId), view, { timezone: 'UTC' });
    expect(broken.filter((i) => i.code === 'SCOPE_EXPOSE_UNKNOWN_COLUMN').map((i) => i.ref).sort()).toEqual([
      'orders',
      'products',
    ]);

    const first = await service().saveEndpoint({ connectionId, ref: 'products', definition: products() });
    expect(first.keysStillBroken.map((k) => k.id)).toEqual([key.id]);
    const second = await service().saveEndpoint({ connectionId, ref: 'orders', definition: orders() });
    expect(second.keysStillBroken).toEqual([]);
    expect(derivedDocumentIssues(await documentOf(key.scopeId), view, { timezone: 'UTC' })).toEqual([]);
  });

  it('switching an endpoint off while a key grants it is allowed, and empties that key', async () => {
    const ep = await storeEndpoint('products', products());
    const key = await derivedKey({ [ep.id]: ['GET'] });
    const out = await service().saveEndpoint({ connectionId, ref: 'products', definition: products({ methods: [] }) });
    expect(out.keysStillBroken).toEqual([]);
    expect((await documentOf(key.scopeId)).resources).toEqual([]);
    // The grant itself is never rewritten: offering GET again restores it.
    await service().saveEndpoint({ connectionId, ref: 'products', definition: products() });
    expect((await documentOf(key.scopeId)).resources.map((r) => r.ref)).toEqual(['products']);
    expect(parseAccess((await publicKeysRepo(meta).findById(key.id))?.access ?? null)).toEqual({ [ep.id]: ['GET'] });
  });

  it('reports what live browser keys GAIN, and nothing for a server key', async () => {
    const ep = await storeEndpoint('orders', orders({ select: ['id', 'status'], filters: [{ column: 'status', op: 'eq', value: 'paid' }] }));
    const browser = await derivedKey({ [ep.id]: ['GET', 'PATCH'] });
    await derivedKey({ [ep.id]: ['GET'] }, { kind: 'server' });
    const out = await service().saveEndpoint({ connectionId, ref: 'orders', definition: orders() });
    expect(out.widened).toEqual([
      expect.objectContaining({ id: browser.id, gains: [{ ref: 'orders', methods: [], columns: ['total'], rows: true }] }),
    ]);
  });

  it('a revision that moved under the save makes it derive again, then commit', async () => {
    const ep = await storeEndpoint('products', products());
    const key = await derivedKey({ [ep.id]: ['GET'] });
    let calls = 0;
    const racing = service({
      viewFor: async () => {
        calls += 1;
        // Another writer commits between this save's read and its commit.
        if (calls === 1) await publicApiStateRepo(meta).bump();
        return view;
      },
    });
    await racing.saveEndpoint({ connectionId, ref: 'products', definition: products({ select: ['id', 'name'] }) });
    expect(calls).toBe(2);
    expect((await documentOf(key.scopeId)).resources[0]?.expose).toEqual(['id', 'name']);
  });

  it('two saves of two endpoints one key grants, at once, lose neither update', async () => {
    const a = await storeEndpoint('products', products());
    const b = await storeEndpoint('orders', orders());
    const key = await derivedKey({ [a.id]: ['GET'], [b.id]: ['GET'] });
    const svc = createEndpointService({
      meta,
      viewFor: async () => Promise.resolve(view),
      tenantConfigOf: async () => Promise.resolve({ timezone: 'UTC' }),
      maxAttempts: 20,
    });
    await Promise.all([
      svc.saveEndpoint({ connectionId, ref: 'products', definition: products({ select: ['id', 'name'] }) }),
      svc.saveEndpoint({ connectionId, ref: 'orders', definition: orders({ select: ['id', 'status'] }) }),
    ]);
    const doc = await documentOf(key.scopeId);
    expect(doc.resources.map((r) => [r.ref, r.expose])).toEqual([
      ['orders', ['id', 'status']],
      ['products', ['id', 'name']],
    ]);
  });

  it('gives up after repeated contention, having written nothing', async () => {
    await storeEndpoint('products', products());
    const racing = service({
      maxAttempts: 2,
      viewFor: async () => {
        await publicApiStateRepo(meta).bump();
        return view;
      },
    });
    const error = await racing
      .saveEndpoint({ connectionId, ref: 'products', definition: products({ select: ['id', 'name'] }) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicApiContended);
    const stored = await publicEndpointsRepo(meta).findByRef(connectionId, 'products');
    expect(stored?.definition).toBe(printDefinition(products()));
  });
});
}
