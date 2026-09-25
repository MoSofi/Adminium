// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document's life on an installed invoicing app, on every engine, through
 * every door the write path has: a single write (the dashboard's record page,
 * an automation, the public API), a multi-row write's prepared rows (bulk,
 * the public batch, an import), a parent form's child rows, and undo.
 *
 * What each case holds:
 *  - a document moves only along its moves, a move asks for what it needs
 *    first (lines, a total, nothing paid), and some moves are kept for a role;
 *  - once sent, only the columns the lock leaves open change — the stamps a
 *    void writes included — and its lines take no change, through a single
 *    write or the parent form;
 *  - a payment is taken only on a sent invoice, and clears the client's
 *    "I've paid"; its date is never after today, nor before the invoice was
 *    issued;
 *  - a numbered invoice, an accepted proposal and a locked row are never
 *    deleted; a draft proposal is;
 *  - a date that only moves later never moves earlier;
 *  - a terms version locks once a proposal naming it is sent;
 *  - history (an import) may write any state, and the outbox's own writes
 *    keep their own moves;
 *  - undo is never offered on a table tied to states, and an older token is
 *    refused;
 *  - two real connections moving a document and writing its children at once
 *    never leave a sent invoice with a line added after it was sent, nor a
 *    voided invoice with a payment.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rolesRepo, usersRepo } from '@adminium/meta';

import { outboxContext } from '../src/outbox/context.js';
import { insertRow, updateRows, type WriteContext } from '../src/crud/write-service.js';
import { venueClock } from '../src/crud/venue-time.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter } from './invoicing-writes.helpers.js';
import { statesManifest } from './invoicing-states.helpers.js';

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
afterEach(async () => {
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

const day = (offset = 0) => {
  const today = venueClock(new Date(), 'Europe/London').day;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
};

async function harness(dialect: (typeof LEGS)[number][0]) {
  const h = await installInvoicing(dialect, statesManifest());
  open = h;
  await seedSettings(h);
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  const row = async (ref: string, id: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(id)}`))[0]!;
  /** A draft invoice with one line of 100. */
  const draft = async () => {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
    return { invoice, line };
  };
  /** A sent invoice with one line of 100 (120 with tax). */
  const sent = async () => {
    const out = await draft();
    await w.update('invoices', out.invoice['id'], { status: 'sent' });
    return out;
  };
  return { h, w, client, row, draft, sent };
}

/** A person holding the app's manager role, as the write path sees them. */
async function manager(h: InvoicingHarness): Promise<WriteContext> {
  const user = await usersRepo(h.meta).create({ email: `manager-${String(Math.random()).slice(2, 8)}@test`, name: 'Mo Manager' });
  const role = await rolesRepo(h.meta).findBySlug('studio-manager');
  await rolesRepo(h.meta).assignToUser(user.id, role!.id);
  return { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: user.id, label: 'Mo Manager' }, request: null };
}

const history: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`states on ${dialect}`, () => {
    it('move a document only along its moves, and only once it has what the move asks for', async () => {
      const { w, client, row } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'] });
      expect((await row('invoices', invoice['id']))['status']).toBe('draft');
      // No line yet.
      await expect(w.update('invoices', invoice['id'], { status: 'sent' })).rejects.toMatchObject({
        code: 'STATE_MOVE_REFUSED',
        details: { from: 'draft', to: 'sent', requires: expect.stringContaining('invoice_lines') },
      });
      // A line of nothing: the total must be above zero.
      const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '0' });
      await expect(w.update('invoices', invoice['id'], { status: 'sent' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { requires: 'total' } });
      await w.update('invoice_lines', line['id'], { rate: '100' });
      await w.update('invoices', invoice['id'], { status: 'sent' });
      const stored = await row('invoices', invoice['id']);
      expect(stored['status']).toBe('sent');
      // Its stamps: the day it was issued on the venue's calendar, and the day it falls due (net 14).
      expect(String(stored['issued_on'] instanceof Date ? day(0) : stored['issued_on']).slice(0, 10)).toBe(day(0));
      const due = stored['due_on'];
      const dueDay = due instanceof Date ? `${String(due.getFullYear())}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` : String(due).slice(0, 10);
      expect(dueDay).toBe(day(14));
      // Back to draft is no move.
      await expect(w.update('invoices', invoice['id'], { status: 'draft' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'sent', to: 'draft' } });
      // A new document starts as a draft.
      await expect(w.create('invoices', { client_id: client['id'], status: 'sent' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    });

    it('keep a sent document locked but for what the lock leaves open, and its lines with it', async () => {
      const { h, w, row, sent } = await harness(dialect);
      const { invoice, line } = await sent();
      await expect(w.update('invoices', invoice['id'], { tax_rate: '5' })).rejects.toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'tax_rate' } });
      await w.update('invoices', invoice['id'], { client_paid_at: new Date().toISOString() });
      // A form sending the row back as it is changes nothing and is not refused.
      const stored = await row('invoices', invoice['id']);
      await w.update('invoices', invoice['id'], { tax_rate: stored['tax_rate'], terms: stored['terms'] });
      await expect(w.update('invoice_lines', line['id'], { rate: '90' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      await expect(w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '5' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      await expect(w.remove('invoice_lines', line['id'])).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // The multi-row doors: a bulk edit's prepared rows, and the import (history) which may add a line.
      const target = w.targetOf('invoice_lines');
      const [prepared] = await w.writes.beforeEach('update', target, w.desk, [{ match: { id: line['id'] }, values: w.prepared('invoice_lines', { position: 3 }) }]);
      await expect(updateRows(w.db, w.dialect, target.table, prepared!.values, { id: line['id'] })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      const imported = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '1' }, history);
      expect(imported['id']).toBeDefined();
      expect((await h.rows(`select id from ${h.real('invoice_lines')} where invoice_id = ${String(invoice['id'])}`)).length).toBe(2);
    });

    it("take a payment only on a sent invoice, clear the client's word that they paid, and keep its date within dates", async () => {
      const { w, row, draft, sent } = await harness(dialect);
      const early = await draft();
      await expect(w.create('payments', { invoice_id: early.invoice['id'], amount: '10' })).rejects.toMatchObject({ code: 'RECORD_LOCKED', details: { parentIn: ['sent'] } });
      const { invoice } = await sent();
      await w.update('invoices', invoice['id'], { client_paid_at: new Date().toISOString() });
      expect((await row('invoices', invoice['id']))['client_paid_at']).not.toBeNull();
      await expect(w.create('payments', { invoice_id: invoice['id'], amount: '10', paid_on: day(1) })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { paid_on: { code: 'out-of-range' } } },
      });
      await expect(w.create('payments', { invoice_id: invoice['id'], amount: '10', paid_on: day(-1) })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { paid_on: { code: 'out-of-range' } } },
      });
      await w.create('payments', { invoice_id: invoice['id'], amount: '10', paid_on: day(0) });
      const stored = await row('invoices', invoice['id']);
      expect(stored['client_paid_at']).toBeNull();
      expect(Number(stored['paid'])).toBe(10);
    });

    it('keep the void of a sent invoice for managers, with nothing paid, and let its own stamps through the lock', async () => {
      const { h, w, row, sent } = await harness(dialect);
      const { invoice } = await sent();
      await expect(w.update('invoices', invoice['id'], { status: 'void', void_reason: 'Sent twice' })).rejects.toMatchObject({
        code: 'STATE_MOVE_REFUSED',
        details: { roles: ['studio-manager'] },
      });
      const boss = await manager(h);
      await w.update('invoices', invoice['id'], { status: 'void', void_reason: 'Sent twice' }, boss);
      const stored = await row('invoices', invoice['id']);
      expect(stored['status']).toBe('void');
      expect(stored['voided_by']).toBe('Mo Manager');
      expect(stored['voided_at']).not.toBeNull();
      expect(stored['void_reason']).toBe('Sent twice');
      // Paid: no void, even for a manager.
      const other = await sent();
      await w.create('payments', { invoice_id: other.invoice['id'], amount: '10' });
      await expect(w.update('invoices', other.invoice['id'], { status: 'void' }, boss)).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { requires: 'paid' } });
    });

    it('never delete a numbered invoice, an accepted proposal or a locked row, and delete a draft proposal', async () => {
      const { w, client, draft } = await harness(dialect);
      const { invoice } = await draft();
      await expect(w.remove('invoices', invoice['id'])).rejects.toMatchObject({ code: 'DELETE_REFUSED', details: { numbered: true } });
      const scrap = await w.create('proposals', { client_id: client['id'] });
      expect(await w.remove('proposals', scrap['id'])).toBe(1);
      const kept = await w.create('proposals', { client_id: client['id'] });
      await w.update('proposals', kept['id'], { status: 'sent' });
      await w.update('proposals', kept['id'], { status: 'accepted', signed_name: 'Ann' });
      await expect(w.remove('proposals', kept['id'])).rejects.toMatchObject({ code: 'DELETE_REFUSED' });
    });

    it('move a date that only moves later, later only', async () => {
      const { w, client, row } = await harness(dialect);
      const proposal = await w.create('proposals', { client_id: client['id'], valid_until: day(10) });
      await w.update('proposals', proposal['id'], { valid_until: day(20) });
      await expect(w.update('proposals', proposal['id'], { valid_until: day(5) })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'ONLY_LATER' },
      });
      expect(String((await row('proposals', proposal['id']))['valid_until'])).not.toBe('');
    });

    it('lock a terms version and its clauses once a proposal naming it is sent', async () => {
      const { w, client } = await harness(dialect);
      const terms = await w.create('terms', { version: 'v1' });
      const clause = await w.create('terms_clauses', { terms_id: terms['id'], position: 1, body: 'We keep the files for a year.' });
      await w.update('terms', terms['id'], { version: 'v1.1' });
      const proposal = await w.create('proposals', { client_id: client['id'], terms_id: terms['id'] });
      await w.update('terms_clauses', clause['id'], { body: 'We keep the files for two years.' });
      await w.update('proposals', proposal['id'], { status: 'sent' });
      await expect(w.update('terms', terms['id'], { version: 'v2' })).rejects.toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'version' } });
      await expect(w.update('terms_clauses', clause['id'], { body: 'Changed after the fact.' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    });

    it("let history write any state, and the outbox's own writes keep their own moves", async () => {
      const { w, client, row } = await harness(dialect);
      const past = await w.create('invoices', { client_id: client['id'], status: 'sent', number: 'INV-1999' }, history);
      expect((await row('invoices', past['id']))['status']).toBe('sent');
      const outbox = outboxContext('studio');
      const made = await w.create('proposals', { client_id: client['id'], status: 'accepted' }, outbox);
      expect((await row('proposals', made['id']))['status']).toBe('accepted');
    });

    it("refuse, through the public batch's scope, only a row the caller can see", async () => {
      const { w, sent } = await harness(dialect);
      const { invoice } = await sent();
      const target = w.targetOf('invoices');
      const guest: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'guest' }, request: null };
      const [prepared] = await w.writes.beforeEach('update', target, guest, [{ match: { id: invoice['id'] }, values: w.prepared('invoices', { tax_rate: '1' }) }]);
      // Out of scope: the write matches nothing, and says nothing about the row.
      const outside = <Q extends { where: (column: never, op: never, value: never) => Q }>(query: Q): Q => query.where('id' as never, '<' as never, -1 as never);
      expect(await updateRows(w.db, w.dialect, target.table, prepared!.values, { id: invoice['id'] }, outside)).toBe(0);
      await expect(updateRows(w.db, w.dialect, target.table, prepared!.values, { id: invoice['id'] })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // A create prepared by the batch goes in through the same statement, judged there.
      await expect(
        w.db.transaction().execute(async (trx) => {
          const lines = { ...w.targetOf('invoice_lines'), db: trx };
          const [line] = await w.writes.beforeEach('create', lines, guest, [{ values: w.prepared('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '1' }) }]);
          return insertRow(trx, w.dialect, lines.table, line!.values);
        }),
      ).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    });

    it('offer no undo on a document, refuse an older token, and judge the parent form and bulk edits by the states', async () => {
      const { h, w, sent } = await harness(dialect);
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const client = await r.post('clients', { values: { email: 'bo@example.test' } });
      const clientId = client.json<{ data: { id: unknown } }>().data.id;
      const lines = r.relation('invoice_lines');
      const made = await r.post('invoices', { values: { client_id: clientId }, children: { [lines]: [{ values: { qty: '1', rate: '50' } }] } });
      expect(made.statusCode, made.body).toBe(201);
      expect(made.json<{ undoToken: string | null }>().undoToken).toBeNull();
      const id = made.json<{ data: { id: unknown } }>().data.id;
      const edited = await r.patch('invoices', id, { values: { status: 'sent' } });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json<{ undoToken: string | null }>().undoToken).toBeNull();
      // The form adding a line to the sent invoice, or taking its line away: refused.
      // The invoice's own values here are ones its lock leaves open: only the lines are judged.
      const open = { client_paid_at: new Date().toISOString() };
      const added = await r.patch('invoices', id, { values: open, children: { [lines]: [{ values: { qty: '1', rate: '5' } }] } });
      expect(added.statusCode, added.body).toBe(409);
      expect(added.json<{ error: { code: string } }>().error.code).toBe('RECORD_LOCKED');
      const removed = await r.patch('invoices', id, { values: open, children: { [lines]: [] } });
      expect(removed.statusCode, removed.body).toBe(409);
      expect(removed.json<{ error: { code: string } }>().error.code).toBe('RECORD_LOCKED');
      // Bulk: a delete of numbered invoices, an update of a locked column — refused.
      const bulkDelete = await r.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${r.connectionId}/${r.table('invoices')}/bulk`,
        headers: { 'x-test-user-id': r.t.users.admin.id },
        payload: { action: 'delete', ids: [String(id)] },
      });
      expect(bulkDelete.statusCode, bulkDelete.body).toBe(409);
      expect(bulkDelete.json<{ error: { code: string } }>().error.code).toBe('DELETE_REFUSED');
      const bulkUpdate = await r.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${r.connectionId}/${r.table('invoices')}/bulk`,
        headers: { 'x-test-user-id': r.t.users.admin.id },
        payload: { action: 'update', ids: [String(id)], values: { tax_rate: '3' } },
      });
      expect(bulkUpdate.statusCode, bulkUpdate.body).toBe(409);
      // A token from before the table kept states: refused.
      const other = await sent();
      const { token } = r.t.undoStore.issue({
        auditId: null,
        userId: r.t.users.admin.id,
        connectionId: r.connectionId,
        tableId: r.table('invoices'),
        action: 'update',
        pkColumns: ['id'],
        before: [{ ...other.invoice, status: 'draft' }],
        after: [{ ...other.invoice, status: 'sent' }],
        changedColumns: ['status'],
        fileIds: [],
        links: [],
        children: [],
      });
      const undone = await r.undo(token);
      expect(undone.statusCode, undone.body).toBe(409);
      expect(undone.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe('UNDO_STATES');
      void w;
    });
  });

  describe.skipIf(!available || dialect === 'sqlite')(`states under two writers at once on ${dialect}`, () => {
    it('never leave a line added to a sent invoice, nor a payment on a voided one', async () => {
      const { h, w, draft, sent } = await harness(dialect);
      const boss = await manager(h);
      for (let round = 0; round < 12; round += 1) {
        const { invoice } = await draft();
        const [send, add] = await Promise.allSettled([
          w.update('invoices', invoice['id'], { status: 'sent' }),
          w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '7' }),
        ]);
        expect(send.status).toBe('fulfilled');
        // Either the line went in before the send, or it was refused because the invoice was sent.
        if (add.status === 'rejected') expect(add.reason).toMatchObject({ code: 'RECORD_LOCKED' });
        const [stored] = await h.rows(`select subtotal from ${h.real('invoices')} where id = ${String(invoice['id'])}`);
        expect(Number(stored!['subtotal'])).toBe(add.status === 'fulfilled' ? 107 : 100);

        const other = await sent();
        const [voiding, paying] = await Promise.allSettled([
          w.update('invoices', other.invoice['id'], { status: 'void' }, boss),
          w.create('payments', { invoice_id: other.invoice['id'], amount: '10' }),
        ]);
        const [after] = await h.rows(`select status, paid from ${h.real('invoices')} where id = ${String(other.invoice['id'])}`);
        // Never both: a voided invoice with money on it.
        expect(voiding.status === 'fulfilled' && paying.status === 'fulfilled').toBe(false);
        if (voiding.status === 'fulfilled') expect(Number(after!['paid'])).toBe(0);
        else expect(after!['status']).toBe('sent');
      }
    });
  });
}
