// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Numbers without gaps on an installed invoicing app, on every engine: INV-2040,
 * INV-2041 … taken inside the transaction that inserts each row, whichever
 * door the create comes through.
 *
 * What each case holds:
 *  - twenty creates at once get twenty consecutive numbers, none twice —
 *    through `create()`, through the dashboard's form saving an invoice with
 *    its lines, and through the public batch's steps (`beforeEach`, then
 *    `insertRow` inside the batch's own transaction);
 *  - a payment saved as a child row of the invoice form takes its receipt
 *    number inside the form's transaction (on MySQL, a named lock cannot join
 *    an open transaction: that was a 500);
 *  - a create refused after it took its number leaves no gap;
 *  - a writer's value for the number or its text is dropped;
 *  - a numbered create is given no undo, and an older undo token for one is refused;
 *  - a per-parent series numbers each parent's rows 1, 2, 3;
 *  - a CSV import of past invoices keeps their numbers, and the next create
 *    carries on after the largest.
 */
import { Readable } from 'node:stream';

import { filesRepo, importsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { insertRow } from '../src/crud/write-service.js';
import type { FileStore } from '../src/files/store.js';
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

async function harness(dialect: (typeof LEGS)[number][0]) {
  const h = await installInvoicing(dialect, writeManifest());
  open = h;
  await seedSettings(h, { prefix: 'INV-', start: 2040 });
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  return { h, w, client };
}

/** The series as stored: each number and its text, in number order. */
async function series(h: InvoicingHarness, ref: string, seq: string, text: string) {
  return (await h.rows(`select ${seq} as n, ${text} as t from ${h.real(ref)} order by ${seq}`)).map((row) => ({
    n: row['n'] === null ? null : Number(row['n']),
    t: row['t'],
  }));
}

const consecutive = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`numbers without gaps on ${dialect}`, () => {
    it('give twenty creates at once twenty consecutive numbers, none twice', async () => {
      const { h, w, client } = await harness(dialect);
      await Promise.all(Array.from({ length: 20 }, () => w.create('invoices', { client_id: client['id'] })));
      const rows = await series(h, 'invoices', 'number_seq', 'number');
      expect(rows.map((r) => r.n)).toEqual(consecutive(2040, 20));
      expect(rows.map((r) => r.t)).toEqual(consecutive(2040, 20).map((n) => `INV-${String(n)}`));
    });

    it("number an invoice saved with its lines by the dashboard's form, twenty at once", async () => {
      const { h } = await harness(dialect);
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const client = await r.post('clients', { values: { email: 'bo@example.test' } });
      expect(client.statusCode, client.body).toBe(201);
      const clientId = client.json<{ data: { id: unknown } }>().data.id;
      const replies = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          r.post('invoices', {
            values: { client_id: clientId, number: 'INV-9999', number_seq: 9999 },
            children: { [r.relation('invoice_lines')]: [{ values: { qty: '1', rate: String(10 + i) } }, { values: { qty: '2', rate: '5' } }] },
          }),
        ),
      );
      for (const reply of replies) expect(reply.statusCode, reply.body).toBe(201);
      // Numbered, and never undone: an undo would delete the row with its number.
      expect(replies.map((reply) => reply.json<{ undoToken: string | null }>().undoToken)).toEqual(Array(20).fill(null));
      const rows = await series(h, 'invoices', 'number_seq', 'number');
      expect(rows.map((row) => row.n)).toEqual(consecutive(2040, 20));
      expect(rows.map((row) => row.t)).toEqual(consecutive(2040, 20).map((n) => `INV-${String(n)}`));
      // The lines settled their invoice inside the same transaction.
      const [first] = await h.rows(`select subtotal from ${h.real('invoices')} where number_seq = 2040`);
      expect(Number(first!['subtotal'])).toBeGreaterThanOrEqual(20);
    });

    it('take a payment receipt number inside the invoice form, and leave no gap when the form fails', async () => {
      const { h, w, client } = await harness(dialect);
      const invoices: Record<string, unknown>[] = [];
      for (let i = 0; i < 7; i += 1) {
        const invoice = await w.create('invoices', { client_id: client['id'] });
        await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
        invoices.push(invoice);
      }
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const payments = r.relation('payments');
      // Six forms at once, each saving a payment on its own invoice.
      const replies = await Promise.all(
        invoices.slice(0, 6).map((invoice) =>
          r.patch('invoices', invoice['id'], { values: { terms: 'net14' }, children: { [payments]: [{ values: { amount: '10' } }] } }),
        ),
      );
      for (const reply of replies) expect(reply.statusCode, reply.body).toBe(200);
      // A payment larger than what is left refuses the whole save, number and all.
      const invoice = invoices[6]!;
      const refused = await r.patch('invoices', invoice['id'], { values: { terms: 'net14' }, children: { [payments]: [{ values: { amount: '500' } }] } });
      expect(refused.statusCode, refused.body).toBe(409);
      await w.create('payments', { invoice_id: invoice['id'], amount: '1' });
      const rows = await series(h, 'payments', 'receipt_seq', 'receipt');
      expect(rows.map((row) => row.n)).toEqual(consecutive(1, 7));
      expect(rows.map((row) => row.t)).toEqual(consecutive(1, 7).map((n) => `RCT-${String(n).padStart(4, '0')}`));
    });

    it("number the public batch's rows inside the batch's own transaction", async () => {
      const { h, w, client } = await harness(dialect);
      const target = w.targetOf('invoices');
      const guest = { origin: 'public' as const, hops: 0, actor: { kind: 'public' as const, id: null, label: 'guest' }, request: null };
      const two = [{ values: { client_id: client['id'] } }, { values: { client_id: client['id'] } }];
      // As `routes/public` does today: rows prepared before the transaction, written inside one it opens itself.
      const today = async () => {
        const prepared = await w.writes.beforeEach('create', target, guest, two);
        await w.db.transaction().execute(async (trx) => {
          for (const row of prepared) await insertRow(trx, target.dialect, target.table, row.values);
        });
      };
      // With the transaction opened by the write service, holding the series from the first number on.
      const held = async () => {
        const prepared = await w.writes.beforeEach('create', target, guest, two);
        await w.writes.transaction(target, prepared.map((row) => row.values), async (trx) => {
          for (const row of prepared) await insertRow(trx, target.dialect, target.table, row.values);
        });
      };
      // An empty series: its first numbers have no row to wait on, so they are taken under the series' lock.
      await Promise.all(Array.from({ length: 5 }, held));
      // A series under way: a batch in a transaction of its own waits on the series' first row.
      await Promise.all(Array.from({ length: 5 }, today));
      const rows = await series(h, 'invoices', 'number_seq', 'number');
      expect(rows.map((row) => row.n)).toEqual(consecutive(2040, 20));
    });

    it('leave no gap when a create fails after taking its number', async () => {
      const { h, w, client } = await harness(dialect);
      await w.create('invoices', { client_id: client['id'] });
      // No client: the database refuses the INSERT the number was taken for.
      await expect(w.create('invoices', {})).rejects.toBeTruthy();
      await w.create('invoices', { client_id: client['id'] });
      expect((await series(h, 'invoices', 'number_seq', 'number')).map((row) => row.n)).toEqual([2040, 2041]);
    });

    it("drop a writer's number, on a create and on a PATCH", async () => {
      const { h, w, client } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'], number_seq: 7, number: 'INV-0007' });
      await w.update('invoices', invoice['id'], { number_seq: 1, number: 'INV-0001' });
      await w.update('invoices', invoice['id'], { number: 'HACKED' });
      expect(await series(h, 'invoices', 'number_seq', 'number')).toEqual([{ n: 2040, t: 'INV-2040' }]);
    });

    it('refuse an undo token for a numbered create issued before the table numbered its rows', async () => {
      const { h, w, client } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'] });
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const { token } = r.t.undoStore.issue({
        auditId: null,
        userId: r.t.users.admin.id,
        connectionId: r.connectionId,
        tableId: r.table('invoices'),
        action: 'create',
        pkColumns: ['id'],
        before: [],
        after: [invoice],
        changedColumns: [],
        fileIds: [],
        links: [],
        children: [],
      });
      const reply = await r.undo(token);
      expect(reply.statusCode, reply.body).toBe(409);
      expect(reply.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe('UNDO_NUMBERED');
      expect(await series(h, 'invoices', 'number_seq', 'number')).toEqual([{ n: 2040, t: 'INV-2040' }]);
    });

    it("number each parent's rows 1, 2, 3 in a per-parent series", async () => {
      const { h, w, client } = await harness(dialect);
      const a = await w.create('proposals', { client_id: client['id'] });
      const b = await w.create('proposals', { client_id: client['id'] });
      await Promise.all(
        Array.from({ length: 6 }, (_, i) => w.create('versions', { proposal_id: (i % 2 === 0 ? a : b)['id'] })),
      );
      const rows = await h.rows(`select proposal_id as p, v from ${h.real('versions')} order by proposal_id, v`);
      expect(rows.map((row) => `${String(row['p'])}:${String(row['v'])}`)).toEqual([
        `${String(a['id'])}:1`,
        `${String(a['id'])}:2`,
        `${String(a['id'])}:3`,
        `${String(b['id'])}:1`,
        `${String(b['id'])}:2`,
        `${String(b['id'])}:3`,
      ]);
    });

    it('keep the numbers of imported invoices, and carry on after the largest', async () => {
      const { h, w, client } = await harness(dialect);
      const csv = ['client_id,number', `${String(client['id'])},INV-2100`, `${String(client['id'])},INV-2105`, `${String(client['id'])},2023-001`, ''].join('\n');
      const storage = {
        read: async () => Readable.from([csv]),
        write: async () => ({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
      } as unknown as FileStore;
      const file = await filesRepo(h.meta).create({ filename: 'past.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
      const imports = importsRepo(h.meta);
      const job = await imports.create({
        connectionId: h.connectionId,
        tableName: w.targetOf('invoices').table.id,
        requestedBy: String((await h.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id),
        fileId: file.id,
        mapping: { columns: [{ from: 'client_id', to: 'client_id' }, { from: 'number', to: 'number' }] },
        options: { mode: 'insert' },
      });
      await imports.markReady(job.id, { total: 3 });
      let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
      registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, {
        meta: h.meta,
        manager: h.manager,
        storage,
      });
      await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log: () => {} });
      expect((await imports.findById(job.id))?.status).toBe('succeeded');

      await w.create('invoices', { client_id: client['id'] });
      const rows = (await h.rows(`select number_seq as n, number as t from ${h.real('invoices')} order by id`)).map((row) => ({
        n: row['n'] === null ? null : Number(row['n']),
        t: row['t'],
      }));
      // An old tool's `2023-001` keeps its text and takes no place in the series.
      expect(rows).toEqual([
        { n: 2100, t: 'INV-2100' },
        { n: 2105, t: 'INV-2105' },
        { n: null, t: '2023-001' },
        { n: 2106, t: 'INV-2106' },
      ]);
    });
  });
}
