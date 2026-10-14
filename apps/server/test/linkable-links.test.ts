// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `linkable`: a foreign key that may name only a row meeting some conditions
 * — a quote line names a price-list line still offered. On every engine,
 * through every door, by everybody.
 *
 * What each case holds:
 *  - the rule is stored at install, whole, against the real table, and an
 *    operator's own rule is checked against the columns by Studio's door;
 *  - a create naming a row that does not meet the conditions is refused `422`
 *    `VALIDATION_FAILED`, the field's code `not-allowed`, and nothing is
 *    written; a row that meets them, and an empty link, are taken;
 *  - a change that moves the link is judged the same way; a change that
 *    leaves it (not sent, or sent back as the row holds it) is not, so a line
 *    naming a price retired since keeps it while its other columns change;
 *  - the same on an automation, a record's action, an import (a new line, and
 *    a matched line's change), a bulk edit, the dashboard's form, and the
 *    public API (whose refusal names no column); an undo puts a row back;
 *  - a row an effect moves keeps the link it holds;
 *  - a rule whose link or column is gone refuses every new link (fails
 *    closed), and leaves rows that hold one alone.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { connectionTenantConfig, overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const offered = { linkable: { where: [{ column: 'active', eq: true }] } };

/** A price list, the quotes whose lines name its lines, and rooms a stay's arrival moves. */
function manifest(): Record<string, unknown> {
  const m = invoicingManifest([
    {
      ref: 'price_list',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 120 },
        { ref: 'list_rate', type: 'decimal', scale: 2 },
        { ref: 'active', type: 'bool', default: true },
        { ref: 'kind', type: 'enum', enum: ['service', 'goods'], default: 'service' },
      ],
    },
    { ref: 'quotes', columns: [id, { ref: 'title', type: 'text', maxLength: 120, nullable: true }] },
    {
      ref: 'quote_lines',
      columns: [
        id,
        { ref: 'quote_id', type: 'fk', references: 'quotes' },
        { ref: 'price_id', type: 'fk', references: 'price_list', nullable: true, rules: offered },
        { ref: 'list_rate', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'price_id', from: 'list_rate', mode: 'always' } } },
        { ref: 'qty', type: 'int', default: 1 },
      ],
    },
    {
      // A room is priced by a line of the list, offered when it was given one.
      ref: 'rooms',
      columns: [
        id,
        { ref: 'status', type: 'enum', enum: ['free', 'occupied'], default: 'free' },
        { ref: 'price_id', type: 'fk', references: 'price_list', nullable: true, rules: { linkable: { where: [{ column: 'active', eq: true }, { column: 'kind', in: ['service'] }] } } },
      ],
      states: { column: 'status', initial: 'free', moves: { free: ['occupied'], occupied: ['free'] } },
    },
    {
      // A guest arriving takes the room: an effect moves it.
      ref: 'stays',
      columns: [id, { ref: 'room_id', type: 'fk', references: 'rooms' }, { ref: 'status', type: 'enum', enum: ['booked', 'in_house'], default: 'booked' }],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: ['in_house'] },
        effects: [{ on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } }],
      },
    },
  ]);
  // The word asks for the release that runs it.
  m['compatibility'] = { minAdminiumVersion: '0.3.28' };
  return m;
}

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
let served: Served | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

const refused = { code: 'VALIDATION_FAILED', details: { fields: { price_id: { code: 'not-allowed' } } } };
const importer: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };
const automation: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'aut_1', label: 'Rule' }, request: null };
const action: WriteContext = { origin: 'action', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
const undo: WriteContext = { origin: 'undo', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a link that may name only some rows, on ${dialect}`, () => {
    async function harness() {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      const w = await writerFor(h);
      const offeredLine = await w.create('price_list', { name: 'Refit', list_rate: 1900 });
      const cheaper = await w.create('price_list', { name: 'Refit, cheaper', list_rate: 1200 });
      const retired = await w.create('price_list', { name: 'Refit, old', list_rate: 900, active: false });
      const quote = await w.create('quotes', { title: 'Harbour Hotels' });
      const row = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;
      const count = async (ref: string) => Number((await h.rows(`select count(*) as n from ${h.real(ref)}`))[0]!['n']);
      const retire = async (key: unknown) => h.rows(`update ${h.real('price_list')} set active = ${dialect === 'postgres' ? 'false' : '0'} where id = ${String(key)}`);
      return { h, w, row, count, retire, offeredLine, cheaper, retired, quote };
    }

    it('is stored at install against the real table, and an operator\'s rule is checked against the columns', async () => {
      const { h } = await harness();
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.linkable');
      expect(stored.map((o) => [o.tableName.endsWith(h.real('quote_lines')) || o.tableName.endsWith(h.real('rooms')), o.columnName, o.origin])).toEqual([
        [true, 'price_id', 'app'],
        [true, 'price_id', 'app'],
      ]);
      expect(stored.find((o) => o.tableName.endsWith(h.real('quote_lines')))!.value).toEqual({ where: [{ column: 'active', eq: true }] });
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const lines = model.tables.find((t) => t.name === h.real('quote_lines'))!;
      const column = (name: string) => lines.columns.find((c) => c.name === name)!;
      const issue = (value: unknown, on = 'price_id') => columnRuleIssue('column.linkable', value, column(on), model);
      expect(issue({ where: [{ column: 'active', eq: true }] })).toBeNull();
      expect(issue({ where: [{ column: 'list_rate', gt: 0 }] })).toBeNull();
      expect(issue({ where: [{ column: 'nope', eq: true }] })).toBe(`${h.real('price_list')} has no column "nope".`);
      expect(issue({ where: [{ column: 'name', gt: 1 }] })).toBe('"name" is not a number, so it cannot be compared.');
      expect(issue({ where: [] })).toBe('Say which rows "price_id" may name.');
      expect(issue({ where: [{ column: 'active', eq: true }] }, 'qty')).toBe('Only a foreign key names a row; "qty" is not one.');
    });

    it('refuses a new row naming a row that does not meet the conditions, and takes one that does', async () => {
      const { w, row, count, offeredLine, retired, quote } = await harness();
      await expect(w.create('quote_lines', { quote_id: quote['id'], price_id: retired['id'] })).rejects.toMatchObject(refused);
      expect(await count('quote_lines')).toBe(0);
      const line = await w.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'], qty: 2 });
      expect(Number((await row('quote_lines', line['id']))['list_rate'])).toBe(1900);
      // An empty link names nothing: taken.
      const free = await w.create('quote_lines', { quote_id: quote['id'], price_id: null });
      expect((await row('quote_lines', free['id']))['price_id']).toBeNull();
      // A key that names no row is the foreign key's to refuse, never this rule's.
      const missing = await w.create('quote_lines', { quote_id: quote['id'], price_id: 9999 }).then(
        () => null,
        (error: unknown) => error as { details?: { fields?: Record<string, unknown> } },
      );
      expect(missing?.details?.fields?.['price_id']).toBeUndefined();
      // A value that could never be a key is refused as a link with no rule refuses it, never by an error from the rule's read.
      const codeOf = (made: Promise<unknown>) => made.then(
        () => null,
        (error: unknown) => (error as { code?: string }).code ?? null,
      );
      // (A stay's room is a link with no rule and no copy; a room's line has the rule and no copy.)
      const plain = await codeOf(w.create('stays', { room_id: 'a-word' }));
      expect(plain).not.toBeNull();
      expect(await codeOf(w.create('rooms', { price_id: 'a-word' }))).toBe(plain);
      // Every condition is held: a room's line is offered AND a service.
      const goods = await w.create('price_list', { name: 'Chairs', list_rate: 40, kind: 'goods' });
      await expect(w.create('rooms', { price_id: goods['id'] })).rejects.toMatchObject(refused);
      await expect(w.create('rooms', { price_id: offeredLine['id'] })).resolves.toBeDefined();
    });

    it('judges a change that moves the link, and leaves a link the row already holds as it is', async () => {
      const { w, row, retire, offeredLine, cheaper, retired, quote } = await harness();
      const line = await w.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'] });
      // Moved to a retired line: refused, and the line keeps what it had.
      await expect(w.update('quote_lines', line['id'], { price_id: retired['id'] })).rejects.toMatchObject(refused);
      expect(Number((await row('quote_lines', line['id']))['price_id'])).toBe(Number(offeredLine['id']));
      // The line it names is retired since: its other columns still change, and its link sent back as it stands is no change.
      await retire(offeredLine['id']);
      await w.update('quote_lines', line['id'], { qty: 3 });
      await w.update('quote_lines', line['id'], { price_id: offeredLine['id'], qty: 4 });
      await w.update('quote_lines', line['id'], { price_id: String(offeredLine['id']), qty: 5 });
      expect(await row('quote_lines', line['id'])).toMatchObject({ qty: 5 });
      // Moved to a line still offered: taken, and the list price copied from it.
      await w.update('quote_lines', line['id'], { price_id: cheaper['id'] });
      expect(Number((await row('quote_lines', line['id']))['list_rate'])).toBe(1200);
      // Once it has let the retired line go, it cannot take it back.
      await expect(w.update('quote_lines', line['id'], { price_id: offeredLine['id'] })).rejects.toMatchObject(refused);
      // Emptied: taken.
      await w.update('quote_lines', line['id'], { price_id: null });
      expect((await row('quote_lines', line['id']))['price_id']).toBeNull();
    });

    it('holds for an automation, a record\'s action and an import, and lets an undo put a row back', async () => {
      const { w, row, retire, offeredLine, cheaper, retired, quote } = await harness();
      const lines = w.targetOf('quote_lines');
      await expect(w.create('quote_lines', { quote_id: quote['id'], price_id: retired['id'] }, automation)).rejects.toMatchObject(refused);
      await expect(w.create('quote_lines', { quote_id: quote['id'], price_id: retired['id'] }, action)).rejects.toMatchObject(refused);
      const line = await w.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'] }, action);
      await expect(w.update('quote_lines', line['id'], { price_id: retired['id'] }, automation)).rejects.toMatchObject(refused);
      // An import's new lines, checked a chunk at a time: the one naming a retired line is that line's own refusal.
      const checked = await w.writes.check('create', lines, importer, [
        { quote_id: quote['id'], price_id: retired['id'] },
        { quote_id: quote['id'], price_id: cheaper['id'] },
      ]);
      expect(checked.issues).toEqual([{ price_id: { code: 'not-allowed' } }, null]);
      // …and a line matched to a row already here: sent back as it stands it is no change, moved it is judged.
      await retire(offeredLine['id']);
      const [kept] = await w.writes.beforeEach('update', lines, importer, [{ match: { id: line['id'] }, values: { price_id: offeredLine['id'], qty: 7 } }]);
      expect(kept!.issues).toBeNull();
      const [moved] = await w.writes.beforeEach('update', lines, importer, [{ match: { id: line['id'] }, values: { price_id: retired['id'] } }]);
      expect(moved!.issues).toEqual({ price_id: { code: 'not-allowed' } });
      // An import's preview of a change, judged against the row it matched.
      const previewed = await w.writes.check('update', lines, importer, [{ price_id: offeredLine['id'], qty: 8 }, { price_id: retired['id'] }], { quote: true, stored: [await row('quote_lines', line['id']), await row('quote_lines', line['id'])] });
      expect(previewed.issues).toEqual([null, { price_id: { code: 'not-allowed' } }]);
      // An undo puts back what the row held, whatever the line is now.
      await w.update('quote_lines', line['id'], { price_id: cheaper['id'] });
      await w.update('quote_lines', line['id'], { price_id: offeredLine['id'] }, undo);
      expect(Number((await row('quote_lines', line['id']))['price_id'])).toBe(Number(offeredLine['id']));
    });

    it('lets an effect move a row that names a line retired since', async () => {
      const { w, row, retire, offeredLine } = await harness();
      const room = await w.create('rooms', { price_id: offeredLine['id'] });
      const stay = await w.create('stays', { room_id: room['id'] });
      await retire(offeredLine['id']);
      await w.update('stays', stay['id'], { status: 'in_house' });
      expect(await row('rooms', room['id'])).toMatchObject({ status: 'occupied' });
      expect(Number((await row('rooms', room['id']))['price_id'])).toBe(Number(offeredLine['id']));
    });

    it('refuses a bulk edit and the dashboard\'s form, for an admin too, and takes an operator\'s own rule through Studio', async () => {
      const { h, w, row, retire, offeredLine, cheaper, retired, quote } = await harness();
      const one = await w.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'] });
      const two = await w.create('quote_lines', { quote_id: quote['id'], price_id: cheaper['id'] });
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const bulk = (ids: unknown[], values: Record<string, unknown>) =>
        r.t.app.inject({
          method: 'POST',
          url: `/api/v1/data/${r.connectionId}/${r.table('quote_lines')}/bulk`,
          headers: { 'x-test-user-id': r.t.users.admin.id },
          payload: { action: 'update', ids: ids.map(String), values },
        });
      const moved = await bulk([one['id'], two['id']], { price_id: retired['id'] });
      expect(moved.statusCode, moved.body).toBe(422);
      expect(moved.json<{ error: unknown }>().error).toMatchObject(refused);
      // A bulk edit of the quantity of lines naming a retired line: their links are left as they are.
      await retire(offeredLine['id']);
      const qty = await bulk([one['id'], two['id']], { qty: 6 });
      expect(qty.statusCode, qty.body).toBe(200);
      expect((await row('quote_lines', one['id']))['qty']).toBe(6);
      // The dashboard's own form, as an admin: the field is named, and nothing of the line it named is said.
      const form = await r.post('quote_lines', { values: { quote_id: quote['id'], price_id: retired['id'] } });
      expect(form.statusCode, form.body).toBe(422);
      expect(form.json<{ error: { details: { fields: unknown } } }>().error.details.fields).toEqual({ price_id: { code: 'not-allowed' } });
      expect(form.body).not.toContain('Refit');
      const patched = await r.patch('quote_lines', two['id'], { values: { price_id: offeredLine['id'] } });
      expect(patched.statusCode, patched.body).toBe(422);
      const kept = await r.patch('quote_lines', one['id'], { values: { price_id: offeredLine['id'], qty: 9 } });
      expect(kept.statusCode, kept.body).toBe(200);
      // An operator's own rule, through Studio's door: refused by name when it does not fit, kept and held when it does.
      const put = (value: unknown) =>
        r.t.app.inject({
          method: 'PUT',
          url: `/api/v1/connections/${r.connectionId}/overrides`,
          headers: { 'x-test-user-id': r.t.users.admin.id },
          payload: { overrides: [{ op: 'column.linkable', tableName: r.table('quote_lines'), columnName: 'price_id', value }] },
        });
      const wrong = await put({ where: [{ column: 'nope', eq: true }] });
      expect(wrong.statusCode, wrong.body).toBe(422);
      expect(wrong.json<{ error: { message: string } }>().error.message).toBe(`${h.real('price_list')} has no column "nope".`);
      const twoTests = await put({ where: [{ column: 'active', eq: true, isNull: false }] });
      expect(twoTests.statusCode, twoTests.body).toBe(422);
      const cheap = await put({ where: [{ column: 'list_rate', gte: 1500 }] });
      expect(cheap.statusCode, cheap.body).toBe(200);
      // Now a line still offered at 1200 is out, and a retired one at 1900 is in: the operator's rule is the one held.
      const third = await r.post('quote_lines', { values: { quote_id: quote['id'], price_id: cheaper['id'] } });
      expect(third.statusCode, third.body).toBe(422);
      expect(third.json<{ error: unknown }>().error).toMatchObject(refused);
      const fourth = await r.post('quote_lines', { values: { quote_id: quote['id'], price_id: offeredLine['id'] } });
      expect(fourth.statusCode, fourth.body).toBe(201);
    });

    it('refuses a public create naming a retired line, naming no column, and writes nothing', async () => {
      const { h, count, offeredLine, retired, quote } = await harness();
      const views = createPublicViews(h.meta);
      const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
      const lines = (await views.viewFor(h.connectionId))!.table(h.real('quote_lines')).id;
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'lines_door',
        origin: 'custom',
        definition: {
          path: '/lines_door',
          source: lines,
          methods: ['POST'],
          select: ['id', 'qty'],
          filters: [],
          pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
          auth: { role: 'anon' },
          rate_limit: { requests: 60, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
          writable: ['quote_id', 'price_id', 'qty'],
        },
      });
      const secret = generatePublishableKey('browser');
      const { key } = await service.createKey({
        connectionId: h.connectionId,
        name: 'lines door',
        access: [{ ref: 'lines_door', methods: ['POST'] }],
        secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
        origins: [],
        kind: 'browser',
      });
      served = await servePublic(h, key.id);
      const post = (values: Record<string, unknown>) =>
        served!.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/lines_door', headers: served!.headers(), payload: { values } });
      const out = await post({ quote_id: quote['id'], price_id: retired['id'] });
      // One answer for a value refused for what another row holds: no column, so nothing is said of that row.
      expect(out.statusCode, out.body).toBe(400);
      expect(out.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
      expect(await count('quote_lines')).toBe(0);
      const taken = await post({ quote_id: quote['id'], price_id: offeredLine['id'] });
      expect(taken.statusCode, taken.body).toBe(201);
      expect(await count('quote_lines')).toBe(1);
    });

    it('refuses every new link once the rule can no longer be read, and leaves the rows that hold one', async () => {
      const { h, row, offeredLine, quote } = await harness();
      const w = await writerFor(h);
      const line = await w.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'] });
      // The column the rule reads is gone from the snapshot's view of the price list: an operator's rule saved past the checks says so.
      const lines = w.targetOf('quote_lines').table.id;
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).find((o) => o.op === 'column.linkable' && o.tableName === lines)!;
      await overridesRepo(h.meta).delete(stored.id);
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.linkable', tableName: lines, columnName: 'price_id', value: { where: [{ column: 'offered', eq: true }] }, origin: 'user' });
      const after = await writerFor(h);
      await expect(after.create('quote_lines', { quote_id: quote['id'], price_id: offeredLine['id'] })).rejects.toMatchObject(refused);
      await after.update('quote_lines', line['id'], { qty: 2 });
      expect((await row('quote_lines', line['id']))['qty']).toBe(2);
      await after.update('quote_lines', line['id'], { price_id: null });
      await expect(after.create('quote_lines', { quote_id: quote['id'] })).resolves.toBeDefined();
    });
  });
}
