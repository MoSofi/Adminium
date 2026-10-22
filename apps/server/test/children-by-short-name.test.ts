// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAVE'S CHILD ROWS NAMED BY THE APP'S SHORT TABLE NAME, on SQLite,
 * Postgres and MySQL.
 *
 * The desk's door (the data routes, as an app's own screens call them): a
 * quote saved with its lines in one write, its lines named `quote_lines` (or
 * `crm:quote_lines`) rather than by the id of the relation that ties them to
 * the quote. The name is turned into that relation before anything else is
 * judged, so the lines meet everything a list named by its relation meets:
 * the line's link may name only a product still offered (`linkable`), a new
 * line only the columns the role may create with and a changed one only
 * those it may write (`creatable`, `writable`), and only the rows the person
 * reaches. A name no app gives, and one for a table with two links to the
 * quote, are refused as a relation that is not there.
 *
 * The public door: a create's lists are the ones its entry declares, by the
 * app's short name already; a list naming any other child table — by its
 * short name or by its relation — is refused as not offered, nothing read.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, invoicingManifest, LEGS as INSTALL_LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const offered = { linkable: { where: [{ column: 'active', eq: true }] } };

function tables(): Record<string, unknown>[] {
  return [
    { ref: 'products', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'active', type: 'bool', default: true }] },
    {
      ref: 'quotes',
      belongs: [{ column: 'owner_id', set: 'anyone' }],
      columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }],
    },
    {
      ref: 'quote_lines',
      belongs: [{ via: 'quote_id' }],
      columns: [
        id,
        { ref: 'quote_id', type: 'fk', references: 'quotes' },
        { ref: 'product_id', type: 'fk', references: 'products', nullable: true, rules: offered },
        { ref: 'qty', type: 'int', default: 1 },
        { ref: 'discount', type: 'int', default: 0 },
      ],
    },
    { ref: 'quote_notes', columns: [id, { ref: 'quote_id', type: 'fk', references: 'quotes' }, { ref: 'note', type: 'text', maxLength: 200 }] },
    // Two links to a quote: a short name cannot say which one a list is of.
    { ref: 'quote_links', columns: [id, { ref: 'from_quote_id', type: 'fk', references: 'quotes' }, { ref: 'to_quote_id', type: 'fk', references: 'quotes' }] },
  ];
}

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Quotes.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { prefixed: true, tables: tables() },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@products:read', 'table:@quotes:read', 'table:@quotes:create', 'table:@quotes:update', 'table:@quote_lines:read', 'table:@quote_lines:create', 'table:@quote_lines:update', 'table:@quote_lines:delete', 'table:@quote_links:read', 'table:@quote_links:create'],
        limits: {
          quotes: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } },
          quote_lines: { creatable: ['product_id', 'qty'], writable: ['qty'], rows: { read: { reach: 'own' }, update: { reach: 'own' }, delete: { reach: 'own' } } },
        },
      },
    ],
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'crm', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const errorOf = (res: Reply): { code?: string; message?: string; details?: { fields?: Record<string, { code: string }> } } => (res.json() as { error?: Record<string, never> }).error ?? {};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a save's child rows by the app's short table name [${dialect}]`, () => {
    let s: WholeServer;
    const lines = async (quote: number) => (await s.rows(`select id, product_id, qty, discount from crm_quote_lines where quote_id = ${String(quote)} order by id`)).map((row) => ({ id: Number(row['id']), product: Number(row['product_id']), qty: Number(row['qty']), discount: Number(row['discount']) }));
    const quotes = async () => Number((await s.rows('select count(*) as n from crm_quotes'))[0]!['n']);
    const save = (who: string, values: Record<string, unknown>, children: Record<string, unknown[]>) => s.send(who, 'POST', `/api/v1/data/${s.connectionId}/${s.t('quotes')}`, { values, children });
    const patch = (who: string, key: number, children: Record<string, unknown[]>) => s.send(who, 'PATCH', `/api/v1/data/${s.connectionId}/${s.t('quotes')}/${String(key)}`, { values: {}, children });

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], omar: ['rep'] } });
      await s.rows(`insert into crm_products (id, name, active) values (1, 'Survey', ${dialect === 'postgres' ? 'true' : '1'}), (2, 'Refit', ${dialect === 'postgres' ? 'true' : '1'}), (3, 'Old refit', ${dialect === 'postgres' ? 'false' : '0'})`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('saves a quote with its lines in one write, its lines named by the short name', async () => {
      const made = await save('dana', { id: 1, title: 'Harbour Hotels', owner_id: s.ids['dana'] }, { quote_lines: [{ values: { product_id: 1, qty: 2 } }, { values: { product_id: 2, qty: 1 } }] });
      expect(said(made), made.body).toBe('ok');
      expect(await lines(1)).toMatchObject([
        { product: 1, qty: 2 },
        { product: 2, qty: 1 },
      ]);
      // The name another manifest would use for it: the same list.
      const named = await save('dana', { id: 2, title: 'Mill Cottages', owner_id: s.ids['dana'] }, { 'crm:quote_lines': [{ values: { product_id: 2, qty: 3 } }] });
      expect(said(named), named.body).toBe('ok');
      expect(await lines(2)).toMatchObject([{ product: 2, qty: 3 }]);
    });

    it('holds a line so named to the products still offered: nothing of the quote is written', async () => {
      const before = await quotes();
      const retired = await save('dana', { id: 3, title: 'Quay Lofts', owner_id: s.ids['dana'] }, { quote_lines: [{ values: { product_id: 1 } }, { values: { product_id: 3 } }] });
      expect(said(retired)).toBe('422 VALIDATION_FAILED');
      expect(errorOf(retired).details?.fields).toMatchObject({ product_id: { code: 'not-allowed' } });
      expect(await quotes()).toBe(before);
    });

    it('holds a new line to what the role may create with, and a changed one to what it may write', async () => {
      const before = await quotes();
      const discounted = await save('dana', { id: 4, title: 'Dune House', owner_id: s.ids['dana'] }, { quote_lines: [{ values: { product_id: 1, discount: 50 } }] });
      expect(said(discounted)).not.toBe('ok');
      expect(await quotes()).toBe(before);
      const [first, second] = await lines(1);
      // Their quantity is theirs to change; their discount is not.
      expect(said(await patch('dana', 1, { quote_lines: [{ key: { id: first!.id }, values: { qty: 5 } }, { key: { id: second!.id }, values: {} }] }))).toBe('ok');
      expect(said(await patch('dana', 1, { quote_lines: [{ key: { id: first!.id }, values: { discount: 50 } }, { key: { id: second!.id }, values: {} }] }))).not.toBe('ok');
      expect(await lines(1)).toMatchObject([
        { qty: 5, discount: 0 },
        { qty: 1, discount: 0 },
      ]);
    });

    it("reaches only the person's own quote's lines", async () => {
      const held = await lines(1);
      const theirs = await patch('omar', 1, { quote_lines: [{ values: { product_id: 2, qty: 9 } }] });
      expect(said(theirs)).not.toBe('ok');
      expect(await lines(1)).toEqual(held);
    });

    it('refuses a name no app gives, and a short name for a table with two links to the quote', async () => {
      const before = await quotes();
      const nope = await save('owner', { id: 5, title: 'Nope' }, { quote_lines_typo: [{ values: { product_id: 1 } }] });
      expect(said(nope)).toBe('422 VALIDATION_FAILED');
      expect(errorOf(nope).message).toContain('has no relation called "quote_lines_typo"');
      const two = await save('owner', { id: 5, title: 'Two links' }, { quote_links: [{ values: { to_quote_id: 1 } }] });
      expect(said(two)).toBe('422 VALIDATION_FAILED');
      expect(errorOf(two).message).toContain('has no relation called "quote_links"');
      expect(await quotes()).toBe(before);
    });
  });
}

/** The same tables, with a guest's create of a quote and its lines on the public door. */
function shop(): Record<string, unknown> {
  const manifest = invoicingManifest(tables());
  manifest['key'] = 'shop';
  manifest['compatibility'] = { minAdminiumVersion: '0.3.28' };
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'quotes' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'products', methods: ['GET'], select: ['id', 'name'] },
    { table: 'quotes', methods: ['POST'], humanCheck: true, writable: ['title'], select: ['id'], children: { quote_lines: { via: 'quote_id', writable: ['product_id', 'qty'], select: ['id'], max: 10 } } },
  ];
  return manifest;
}

describe.each(INSTALL_LEGS)('a public create names only the lists its entry declares — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let served: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    await h.rows(`insert into shop_products (id, name, active) values (1, 'Survey', ${dialect === 'postgres' ? 'true' : '1'})`);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });
  /** A guest's create, with the human check the entry asks once for the whole write. */
  const post = async (payload: Record<string, unknown>) => {
    ip += 1;
    const remoteAddress = `10.9.0.${String(ip)}`;
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/shop_quotes', remoteAddress, headers, payload });
  };
  const count = async (ref: string) => Number((await h!.rows(`select count(*) as n from ${h!.real(ref)}`))[0]!['n']);

  it.runIf(available)('takes the declared lines by their short name, and refuses an undeclared child by short name or by relation', async () => {
    const taken = await post({ values: { title: 'Web quote' }, children: { quote_lines: [{ values: { product_id: 1, qty: 2 } }] } });
    expect(taken.statusCode, taken.body).toBe(201);
    expect(await count('quote_lines')).toBe(1);
    const before = await count('quotes');
    const notes = await post({ values: { title: 'Sneaky' }, children: { quote_notes: [{ values: { note: 'hello' } }] } });
    expect(notes.statusCode, notes.body).toBe(400);
    expect(notes.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { child: 'quote_notes', reason: 'not-offered' } } });
    const model = parseDatabaseModel((await snapshotsRepo(h!.meta).latest(h!.connectionId))!.schema);
    const notesTable = model.tables.find((table) => table.name === h!.real('quote_notes'))!;
    const relation = model.relations.find((r) => r.through === null && r.from.tableId === notesTable.id)!.id;
    for (const name of [relation, 'shop:quote_notes', h!.real('quote_notes')]) {
      const res = await post({ values: { title: 'Sneaky' }, children: { [name]: [{ values: { note: 'hello' } }] } });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
      // Refused before anything is read: as not offered, or (a relation id that is no list name at all, as MySQL's are) as a request the door does not take.
      const error = (res.json() as { error: { code: string; params?: { reason?: string } } }).error;
      if (error.code === 'PUBLIC_WRITE_REFUSED') expect(error.params?.reason, name).toBe('not-offered');
      else expect(error.code, `${name}: ${res.body}`).toMatch(/VALIDATION|BAD_REQUEST|INVALID|PUBLIC_QUERY_REFUSED/);
    }
    expect(await count('quotes')).toBe(before);
    expect(await count('quote_notes')).toBe(0);
  });
});
