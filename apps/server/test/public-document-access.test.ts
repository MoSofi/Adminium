// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which resources make a document a person's own, asked of the rule itself:
 * the cases no manifest can express (an entry with no claim cannot declare
 * documents) still have to answer "no", because an operator's hand-written
 * scope can.
 */
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applyMigrations, connectionsRepo, createSqliteMetaDb, documentsRepo, initMetaDb } from '@adminium/meta';

import type { PublicSessionContext } from '../src/public-api/claim.js';
import type { CompiledResource } from '../src/public-api/scope.js';
import { INTENT_SCAN_MAX, createDocumentAccess, decodeDocumentCursor, encodeDocumentCursor, recordKeyOf } from '../src/routes/public/documents.js';

const access = createDocumentAccess({ meta: {} as never, manager: {} as never, viewFor: () => Promise.resolve(null) });

const resource = (over: Partial<CompiledResource> = {}): CompiledResource =>
  ({
    ref: 'invoices_claimed',
    table: 'public.invoices',
    kind: 'records',
    actions: new Set(['read']),
    claim: { column: 'client_id', ref: 'clients_claimed' },
    level: 'lookup',
    ...over,
  }) as unknown as CompiledResource;

const session = (level: 'lookup' | 'verified' = 'lookup'): PublicSessionContext => ({
  id: 'pss_1',
  keyId: 'pbk_1',
  grant: { ref: 'clients_claimed', column: 'id', value: 7 },
  level,
});

describe('a person\'s own resource', () => {
  it('reads with a claim this session reaches', () => {
    expect(access.personal(resource(), session())).toBe(true);
  });

  it('is never a resource with no claim: its rows are everybody\'s', () => {
    expect(access.personal(resource({ claim: null }), session())).toBe(false);
  });

  it('is one visible with a parent, whose rows are the person\'s through it', () => {
    const child = resource({ ref: 'payments_claimed', claim: null, visibleWith: { ref: 'invoices_claimed', localColumn: 'invoice_id', foreignColumn: 'id' } as never });
    expect(access.personal(child, session())).toBe(true);
  });

  it('is not one opened through another identity', () => {
    expect(access.personal(resource({ claim: { column: 'client_id', ref: 'staff_claimed' } as never }), session())).toBe(false);
  });

  it('asks a confirmed session where the resource asks one', () => {
    expect(access.personal(resource({ level: 'verified' }), session('lookup'))).toBe(false);
    expect(access.personal(resource({ level: 'verified' }), session('verified'))).toBe(true);
  });

  it('is a readable resource of rows', () => {
    expect(access.personal(resource({ actions: new Set(['create']) as never }), session())).toBe(false);
    expect(access.personal(resource({ kind: 'availability' }), session())).toBe(false);
  });
});

describe('the list\'s cursor', () => {
  it('round-trips, and a cursor it never gave out is refused rather than read', () => {
    const cursor = encodeDocumentCursor({ createdAt: 1_790_000_000_000, id: 'doc_1' });
    expect(decodeDocumentCursor(cursor)).toEqual({ createdAt: 1_790_000_000_000, id: 'doc_1' });
    expect(decodeDocumentCursor(undefined)).toBeUndefined();
    expect(decodeDocumentCursor('bm90IGpzb24')).toBeNull();
    expect(decodeDocumentCursor(Buffer.from(JSON.stringify(['x', 1])).toString('base64url'))).toBeNull();
    // A time no column holds is no cursor either: never a query the database refuses.
    for (const time of [1.5, 1e21, 9.3e18, -1]) {
      expect(decodeDocumentCursor(Buffer.from(JSON.stringify([time, 'doc_1'])).toString('base64url')), String(time)).toBeNull();
    }
  });
});

describe('documents drawn from values, through an operator\'s key', () => {
  const T0 = 1_790_000_000_000;
  const meta = async () => {
    const db = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(db);
    await applyMigrations(db.db, { dialect: db.dialect });
    const connectionId = (await connectionsRepo(db, { encrypt: (v) => v, decrypt: (v) => v }).create({ name: 'c', engine: 'postgres', introspectDsn: 'postgres://ro@db/c' })).id;
    return { db, connectionId };
  };
  type Meta = Awaited<ReturnType<typeof meta>>['db'];
  const keyOf = (connectionId: string, over: { create?: boolean; managedBy?: string | null } = {}) =>
    ({
      keyId: 'pbk_operator',
      connectionId,
      managedBy: over.managedBy ?? null,
      scope: { documents: { create: over.create ?? true }, byRef: new Map(), timezone: 'UTC' },
    }) as never;
  const ann: PublicSessionContext = { id: 'pss_ann', keyId: 'pbk_operator', grant: { ref: 'customers', column: 'email', value: 'ann@x.test' }, level: 'lookup' };
  const intent = async (db: Meta, connectionId: string, claim: Record<string, string>, at: number) => {
    const register = documentsRepo(db);
    const row = await register.create({ profileId: null, addOnKey: 'invoices', kind: 'invoice', connectionId, entity: null, subject: {}, locale: 'en-US', format: 'html', claim: claim as never }, at);
    await register.markRendered(row.id, { number: '1', fileId: null, htmlFileId: null, format: 'html' }, at);
    return row.id;
  };
  const accessOn = (db: Meta) => createDocumentAccess({ meta: db, manager: {} as never, viewFor: () => Promise.resolve(null) });

  it('shows one only through a key whose documents door is open, and only to the identity that asked', async () => {
    const { db, connectionId } = await meta();
    const access = accessOn(db);
    const own = await intent(db, connectionId, { column: 'email', value: 'ann@x.test', keyId: 'pbk_operator', ref: 'customers' }, T0);
    const legacy = await intent(db, connectionId, { column: 'email', value: 'ann@x.test' }, T0 + 1);
    const otherIdentity = await intent(db, connectionId, { column: 'email', value: 'ann@x.test', keyId: 'pbk_operator', ref: 'staff' }, T0 + 2);

    const open = { key: keyOf(connectionId), session: ann };
    expect(await access.visibleDocument(open, own)).not.toBeNull();
    expect(await access.visibleDocument(open, legacy)).not.toBeNull();
    expect(await access.visibleDocument(open, otherIdentity)).toBeNull();

    // The door shut: none of them, the old one included.
    const shut = { key: keyOf(connectionId, { create: false }), session: ann };
    expect(await access.visibleDocument(shut, own)).toBeNull();
    expect(await access.visibleDocument(shut, legacy)).toBeNull();
    // An app's key never reads a claim from before keys were recorded.
    expect(await access.visibleDocument({ key: keyOf(connectionId, { managedBy: 'studio' }), session: ann }, legacy)).toBeNull();
  });

  it('reads at most a bounded number of them per list request', async () => {
    const { db, connectionId } = await meta();
    // Hers is the oldest; everybody else's are newer, past the bound.
    const hers = await intent(db, connectionId, { column: 'email', value: 'ann@x.test', keyId: 'pbk_operator', ref: 'customers' }, T0);
    for (let n = 1; n <= INTENT_SCAN_MAX + 50; n += 1) {
      await intent(db, connectionId, { column: 'email', value: `x${String(n)}@x.test`, keyId: 'pbk_operator', ref: 'customers' }, T0 + n);
    }
    const page = await accessOn(db).listVisible({ key: keyOf(connectionId), session: ann }, { limit: 50 });
    expect(page.rows.map((r) => r.id)).not.toContain(hers);
    expect(page.next).toBeNull();
    // Within the bound it is found.
    const small = await meta();
    const near = await intent(small.db, small.connectionId, { column: 'email', value: 'ann@x.test', keyId: 'pbk_operator', ref: 'customers' }, T0);
    for (let n = 1; n <= 20; n += 1) await intent(small.db, small.connectionId, { column: 'email', value: `x${String(n)}@x.test` }, T0 + n);
    expect((await accessOn(small.db).listVisible({ key: keyOf(small.connectionId), session: ann }, { limit: 50 })).rows.map((r) => r.id)).toEqual([near]);
  }, 60_000);
});

describe('a row key from what a caller sent', () => {
  const table = (types: Record<string, string>, pk: string[]) =>
    ({ primaryKey: pk, columns: new Map(Object.entries(types).map(([name, logicalType]) => [name, { name, logicalType }])) }) as never;

  it('holds only what the key column can', () => {
    const ints = table({ id: 'integer' }, ['id']);
    expect(recordKeyOf(ints, '42')).toEqual({ id: 42 });
    expect(recordKeyOf(ints, 42)).toEqual({ id: 42 });
    for (const bad of ['abc', '1.5', 1.5, '99999999999999999999', '1e400', '', ' ', '0x10', null]) expect(recordKeyOf(ints, bad), String(bad)).toBeNull();
    const uuids = table({ id: 'uuid' }, ['id']);
    expect(recordKeyOf(uuids, 'not-a-uuid')).toBeNull();
    expect(recordKeyOf(uuids, '0f8fad5b-d9cb-469f-a165-70867728950e')).toEqual({ id: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    const pair = table({ a: 'integer', b: 'text' }, ['a', 'b']);
    expect(recordKeyOf(pair, '{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
    expect(recordKeyOf(pair, '[1,"x"]')).toEqual({ a: 1, b: 'x' });
    expect(recordKeyOf(pair, '{"a":"one","b":"x"}')).toBeNull();
    expect(recordKeyOf(pair, 'nope')).toBeNull();
  });
});
