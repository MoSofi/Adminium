// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The values Adminium decides on an installed invoicing app, on every engine,
 * and the seams a hook judges a write through:
 *
 *  - a stamp that copies another column of the row, one that leaves staff
 *    their own choice (`byOrigin` with no staff word), one from the signed-in
 *    person's own row (`claim`), a date so many days after another (`addDays`,
 *    by a choice's map) — each written by the write that fires it, and none by
 *    history;
 *  - text stored the way a rule says (an address trimmed, in lower case);
 *  - a setting a rule reads: the add-on's declared default while the install
 *    has saved none;
 *  - what a before hook judged a write on (`expect`) holds in the UPDATE's
 *    own WHERE: a row that moved meanwhile refuses the write, on a single
 *    write and on a multi-row write's statement alike;
 *  - an undo of a parent form's child rows puts a row back only while it is
 *    as the save left it, and through the child table's before hooks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { manifestsRepo, overridesRepo } from '@adminium/meta';

import { decideRow } from '../src/crud/decide.js';
import type { ColumnStamp, TableRules } from '../src/crud/column-rules.js';
import { updateRows, type RecordHooks, type WriteContext } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { venueClock } from '../src/crud/venue-time.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter, writeManifest } from './invoicing-writes.helpers.js';

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
afterEach(async () => {
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

const guest: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'guest' }, request: null };
const history: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };

describe('stamps, as DECIDE writes them', () => {
  const stamp = (column: string, set: ColumnStamp['set'], on: ColumnStamp['on'], logicalType: ColumnStamp['logicalType'] = 'text'): ColumnStamp => ({ column, set, on, logicalType });
  const rules = (...stamps: ColumnStamp[]): TableRules => ({ fills: [], checks: [], stamps });
  const context = (origin: WriteContext['origin'], claimed: Record<string, unknown> | null = null) => ({
    db: null as never,
    dialect: 'sqlite' as const,
    table: { columns: new Map() } as never,
    origin,
    actor: { kind: 'user' as const, id: 'usr_ivy', label: 'Ivy Ferreira' },
    now: new Date('2026-09-25T23:30:00Z'),
    zone: 'Pacific/Auckland',
    claimed,
  });

  it("writes today's date on the venue's calendar, and a due date from it by the terms' map", async () => {
    const r = rules(
      stamp('due_on', { addDays: { date: 'issued_on', days: 'terms', map: { net14: 14, net30: 30 } } }, { column: 'status', values: ['sent'] }, 'date'),
      stamp('issued_on', 'today', { column: 'status', values: ['sent'] }, 'date'),
    );
    const out = await decideRow(r, 'update', { status: 'sent' }, { status: 'draft', terms: 'net30' }, context('dashboard'));
    // 23:30 UTC on 25 September is already the 26th in Auckland.
    expect(out).toEqual({ status: 'sent', issued_on: '2026-09-26', due_on: '2026-10-26' });
  });

  it("copies a column as it stands, leaves staff their own choice, and reads the signed-in person's row", async () => {
    const r = rules(
      stamp('first_signed_name', { copy: 'signed_name' }, { column: 'signed_name', filled: true }),
      stamp('accepted_how', { byOrigin: { public: 'portal' } }, [{ column: 'status', values: ['accepted'] }, 'create']),
      stamp('signed_email', { claim: 'email', staff: 'user-name' }, { column: 'status', values: ['accepted'] }),
    );
    const staff = await decideRow(r, 'update', { status: 'accepted', signed_name: 'Ann Lee', accepted_how: 'call' }, { status: 'sent', signed_name: null }, context('dashboard'));
    expect(staff).toEqual({ status: 'accepted', signed_name: 'Ann Lee', first_signed_name: 'Ann Lee', accepted_how: 'call', signed_email: 'Ivy Ferreira' });
    const portal = await decideRow(r, 'update', { status: 'accepted', accepted_how: 'call' }, { status: 'sent', signed_name: 'Ann Lee' }, context('public', { email: 'ann@example.test' }));
    expect(portal).toEqual({ status: 'accepted', accepted_how: 'portal', signed_email: 'ann@example.test' });
    // A name filled before is not "first filled" again.
    const later = await decideRow(r, 'update', { signed_name: 'Ann B. Lee' }, { status: 'accepted', signed_name: 'Ann Lee' }, context('dashboard'));
    expect(later).toEqual({ signed_name: 'Ann B. Lee' });
    // History is stamped by nobody.
    expect(await decideRow(r, 'update', { status: 'accepted' }, { status: 'sent' }, context('import'))).toEqual({ status: 'accepted' });
  });
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`decided values and judged writes on ${dialect}`, () => {
    async function harness() {
      const h = await installInvoicing(dialect, writeManifest());
      open = h;
      await seedSettings(h);
      await setConnectionCurrency(h, 'EUR');
      return h;
    }

    it("stores an address trimmed and in lower case, whoever writes it, history too", async () => {
      const h = await harness();
      const w = await settledWriter(h);
      const ann = await w.create('clients', { email: '  Ann.Lee@Example.TEST ' });
      const bob = await w.create('clients', { email: 'BOB@example.test' }, history);
      await w.update('clients', ann['id'], { email: ' ANN@example.test' });
      const rows = await h.rows(`select id, email from ${h.real('clients')} order by id`);
      expect(rows.map((row) => row['email'])).toEqual(['ann@example.test', 'bob@example.test']);
      void bob;
    });

    it("reads an add-on's declared default while the install has saved none", async () => {
      const h = await harness();
      await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
        manifestKey: 'invoices',
        version: '1.0.0',
        kind: 'add-on',
        source: 'file',
        document: { settings: [{ key: 'prefix_invoice', type: 'text', default: 'FAC-' }, { key: 'secret_key', type: 'text', secret: true, default: 'x' }] },
      });
      const stores = writeStores(h.meta);
      expect(await stores.settings!.addOnSetting('invoices', 'prefix_invoice')).toBe('FAC-');
      expect(await stores.settings!.addOnSetting('invoices', 'secret_key')).toBeUndefined();
      // The number's prefix, read from the add-on's setting, on a real create.
      const w0 = await settledWriter(h);
      const numberRule = (await overridesRepo(h.meta).listForConnection(h.connectionId)).find((o) => o.op === 'column.format')!;
      await overridesRepo(h.meta).create({
        connectionId: h.connectionId,
        op: 'column.format',
        tableName: numberRule.tableName,
        columnName: 'number',
        value: { from: 'number_seq', prefixSetting: { addOn: 'invoices', setting: 'prefix_invoice' }, pad: 4 },
        origin: 'user',
      });
      const w = await settledWriter(h);
      const client = await w0.create('clients', { email: 'ann@example.test' });
      const invoice = await w.create('invoices', { client_id: client['id'] });
      expect((await h.rows(`select number from ${h.real('invoices')} where id = ${String(invoice['id'])}`))[0]!['number']).toBe('FAC-2040');
    });

    it('refuses an update whose hook judged a row that has moved since, on every door that updates', async () => {
      const h = await harness();
      let race: (() => Promise<void>) | null = null;
      const hooks: RecordHooks = {
        wants: async (timing, action, target) => timing === 'before' && action === 'update' && target.table.name === h.real('proposals'),
        before: async (event) => {
          event.expect = { status: event.record?.['status'] ?? null };
          const move = race;
          race = null;
          await move?.();
        },
        after: async () => {},
      };
      const w = await settledWriter(h, { hooks });
      const client = await w.create('clients', { email: 'ann@example.test' });
      const proposal = await w.create('proposals', { client_id: client['id'] });
      // Another writer sends it between the hook's judgement and the UPDATE.
      race = async () => {
        await h.rows(`update ${h.real('proposals')} set status = 'sent' where id = ${String(proposal['id'])}`);
      };
      await expect(w.update('proposals', proposal['id'], { signed_name: 'Ann' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
      expect((await h.rows(`select signed_name from ${h.real('proposals')} where id = ${String(proposal['id'])}`))[0]!['signed_name']).toBeNull();
      // Unraced, it goes through.
      await w.update('proposals', proposal['id'], { signed_name: 'Ann' });
      // A multi-row write's statement carries the same condition.
      const target = w.targetOf('proposals');
      const [prepared] = await w.writes.beforeEach('update', target, w.desk, [{ match: { id: proposal['id'] }, values: w.prepared('proposals', { signed_name: 'Ann Lee' }) }]);
      await h.rows(`update ${h.real('proposals')} set status = 'accepted' where id = ${String(proposal['id'])}`);
      await expect(updateRows(w.db, w.dialect, target.table, prepared!.values, { id: proposal['id'] })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
      // A row that is gone matches nothing, as ever.
      expect(await updateRows(w.db, w.dialect, target.table, prepared!.values, { id: -1 })).toBe(0);
    });

    it("undoes a parent form's child row only while it is as the save left it, and through the child's hooks", async () => {
      const h = await harness();
      let refuseUndo = false;
      const hooks: RecordHooks = {
        // Only an undo asks for it: a form saving child rows through a hooked child table is refused for other reasons.
        wants: async (timing, _action, _target, context) => timing === 'before' && context.origin === 'undo',
        before: async (event) => {
          if (refuseUndo && event.context.origin === 'undo' && event.target.table.name === h.real('invoice_lines')) {
            const { HookRejectedError } = await import('../src/crud/write-service.js');
            throw new HookRejectedError('Lines are kept as they are.', 'probe');
          }
        },
        after: async () => {},
      };
      routes = await dataRoutesOver(h, dialect, 'EUR', hooks);
      const r = routes;
      const client = await r.post('clients', { values: { email: 'bo@example.test' } });
      const clientId = client.json<{ data: { id: unknown } }>().data.id;
      const lines = r.relation('invoice_lines');
      const made = await r.post('invoices', { values: { client_id: clientId }, children: { [lines]: [{ values: { qty: '1', rate: '50' } }] } });
      expect(made.statusCode, made.body).toBe(201);
      const invoiceId = made.json<{ data: { id: unknown } }>().data.id;
      const [line] = await h.rows(`select id from ${h.real('invoice_lines')} where invoice_id = ${String(invoiceId)}`);
      const save = async (rate: string) => {
        const reply = await r.patch('invoices', invoiceId, { values: { terms: 'net30' }, children: { [lines]: [{ key: { id: line!['id'] }, values: { qty: '1', rate } }] } });
        expect(reply.statusCode, reply.body).toBe(200);
        return reply.json<{ undoToken: string }>().undoToken;
      };
      // Changed again since the save: the undo is refused, and the later change stands.
      const first = await save('60');
      await h.rows(`update ${h.real('invoice_lines')} set rate = 70 where id = ${String(line!['id'])}`);
      const refused = await r.undo(first);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(Number((await h.rows(`select rate from ${h.real('invoice_lines')} where id = ${String(line!['id'])}`))[0]!['rate'])).toBe(70);
      // A child table's before hook judges the undo too.
      const second = await save('80');
      refuseUndo = true;
      const rejected = await r.undo(second);
      expect(rejected.statusCode, rejected.body).toBe(422);
      expect(Number((await h.rows(`select rate from ${h.real('invoice_lines')} where id = ${String(line!['id'])}`))[0]!['rate'])).toBe(80);
      // As the save left it, and nothing refusing: put back.
      refuseUndo = false;
      const third = await save('90');
      const undone = await r.undo(third);
      expect(undone.statusCode, undone.body).toBe(200);
      expect(Number((await h.rows(`select rate from ${h.real('invoice_lines')} where id = ${String(line!['id'])}`))[0]!['rate'])).toBe(80);
      void venueClock;
      void guest;
    });
  });
}
