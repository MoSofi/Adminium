// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Time and purchases billed on invoice lines, on every engine, through every
 * door the write path has: the record page (a single write), a bulk edit, an
 * import, undo, and the write service an automation or project code uses.
 *
 * What each case holds:
 *  - a void invoice's line may EMPTY its link to the time or purchase it
 *    billed (`release`), and do nothing else: not link to another row, not
 *    change its amount, not go; a sent invoice's line may not even empty it;
 *  - the hours of time a line bills, and the amount of a purchase, do not
 *    change while the line stands on an invoice that is not void
 *    (`lockLinked`), whoever writes them — an undo of an edit made before
 *    the time was billed included; the note beside them does;
 *  - void, release and bill again follow each other: once the invoice is
 *    void the time's hours are free, and billed again they are kept again;
 *  - two desks at once — one changing the hours, one billing the time — never
 *    leave a line billing hours the time no longer has.
 */
import { Readable } from 'node:stream';

import type { DatabaseModel } from '@adminium/engine';
import { connectionTenantConfig, filesRepo, importsRepo, overridesRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { statesRuleIssue } from '../src/connections/column-rules-validation.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { statesTables } from './invoicing-states.helpers.js';
import { invoicingManifest } from './invoicing-install.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter } from './invoicing-writes.helpers.js';

type Table = { ref: string; columns: Record<string, unknown>[] } & Record<string, unknown>;

/** The states app, with time entries and purchases a line bills. */
function billedManifest(): Record<string, unknown> {
  const tables = (statesTables() as Table[]).map((table): Table => {
    if (table.ref === 'invoices') {
      const states = table['states'] as Record<string, unknown>;
      return {
        ...table,
        states: {
          ...states,
          children: {
            ...(states['children'] as Record<string, unknown>),
            invoice_lines: {
              via: 'invoice_id',
              lock: true,
              release: { when: ['void'], columns: ['time_entry_id', 'expense_id'] },
              lockLinked: { time_entry_id: ['hours', 'worked_on'], expense_id: ['amount'] },
            },
          },
        },
      };
    }
    if (table.ref === 'invoice_lines') {
      return {
        ...table,
        columns: [
          ...table.columns,
          { ref: 'time_entry_id', type: 'fk', references: 'time_entries', nullable: true, unique: true },
          { ref: 'expense_id', type: 'fk', references: 'expenses', nullable: true, unique: true },
          { ref: 'billed_hours', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'time_entry_id', from: 'hours', mode: 'always' } } },
        ],
      };
    }
    return table;
  });
  const time: Table = {
    ref: 'time_entries',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'hours', type: 'decimal', scale: 2 },
      { ref: 'worked_on', type: 'date', nullable: true },
      { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    ],
  };
  const expenses: Table = {
    ref: 'expenses',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'amount', type: 'decimal', scale: 2 },
      { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    ],
  };
  // Referenced tables first: the installer creates them in order.
  const at = tables.findIndex((table) => table.ref === 'invoices');
  tables.splice(at, 0, time, expenses);
  return { ...invoicingManifest(tables), roles: [{ key: 'manager', name: 'Studio manager' }] };
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

async function harness(dialect: (typeof LEGS)[number][0]) {
  const h = await installInvoicing(dialect, billedManifest());
  open = h;
  await seedSettings(h);
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  const user = await usersRepo(h.meta).create({ email: 'manager@test', name: 'Mo Manager' });
  const role = await rolesRepo(h.meta).findBySlug('studio-manager');
  await rolesRepo(h.meta).assignToUser(user.id, role!.id);
  const boss: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: user.id, label: 'Mo Manager' }, request: null };
  const row = async (ref: string, id: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(id)}`))[0]!;
  const entry = async (hours = '3') => w.create('time_entries', { hours, worked_on: '2026-09-01', note: 'design' });
  /** A draft invoice billing one time entry and one purchase. */
  const billing = async (time: Record<string, unknown>, expense?: Record<string, unknown>) => {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100', time_entry_id: time['id'], ...(expense === undefined ? {} : { expense_id: expense['id'] }) });
    return { invoice, line };
  };
  return { h, w, boss, row, entry, billing };
}

const codeOf = (error: unknown) => (error as { code?: string }).code;

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`billed time and purchases on ${dialect}`, () => {
    it("let a void invoice's line empty its link, and nothing else; a sent invoice's line not even that", async () => {
      const { h, w, boss, row, entry, billing } = await harness(dialect);
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const time = await entry();
      const other = await entry('1');
      const expense = await w.create('expenses', { amount: '40' });
      const { invoice, line } = await billing(time, expense);
      await w.update('invoices', invoice['id'], { status: 'sent' });

      // Sent: the line is locked whole, emptying its link too.
      const sentEmpty = await r.patch('invoice_lines', line['id'], { values: { time_entry_id: null } });
      expect(sentEmpty.statusCode, sentEmpty.body).toBe(409);
      expect(sentEmpty.json<{ error: { code: string } }>().error.code).toBe('RECORD_LOCKED');

      await w.update('invoices', invoice['id'], { status: 'void' }, boss);
      // Void: linking to other time, changing the amount, both at once, or deleting the line — refused.
      for (const values of [{ time_entry_id: other['id'] }, { qty: '2' }, { time_entry_id: null, qty: '2' }]) {
        const refused = await r.patch('invoice_lines', line['id'], { values });
        expect(refused.statusCode, `${JSON.stringify(values)} ${refused.body}`).toBe(409);
        expect(refused.json<{ error: { code: string } }>().error.code).toBe('RECORD_LOCKED');
      }
      await expect(w.remove('invoice_lines', line['id'])).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // …and emptying the links, through the record page and through the write service.
      const emptied = await r.patch('invoice_lines', line['id'], { values: { time_entry_id: null } });
      expect(emptied.statusCode, emptied.body).toBe(200);
      await w.update('invoice_lines', line['id'], { expense_id: null });
      expect(await row('invoice_lines', line['id'])).toMatchObject({ time_entry_id: null, expense_id: null });
      expect(Number((await row('invoice_lines', line['id']))['qty'])).toBe(1);

      // Released, the time and the purchase go on a new invoice.
      const again = await billing(time, expense);
      expect(await row('invoice_lines', again.line['id'])).toMatchObject({ time_entry_id: time['id'], expense_id: expense['id'] });
    });

    it('keep the hours of billed time and the amount of a billed purchase, on every door, until the invoice is void', async () => {
      const { h, w, boss, row, entry, billing } = await harness(dialect);
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const time = await entry();
      const expense = await w.create('expenses', { amount: '40' });
      // An edit made before the time is billed, whose undo would come after.
      const early = await r.patch('time_entries', time['id'], { values: { hours: '4' } });
      expect(early.statusCode, early.body).toBe(200);
      const undoToken = early.json<{ undoToken: string | null }>().undoToken;
      expect(undoToken).not.toBeNull();

      const { invoice } = await billing(time, expense);
      const locked = async (reply: Promise<{ statusCode: number; body: string; json: <T>() => T }>, column: string) => {
        const res = await reply;
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json<{ error: { code: string; details: { column: string } } }>().error).toMatchObject({ code: 'RECORD_LOCKED', details: { column } });
      };
      // On a draft invoice already: the record page, a bulk edit, an undo, the write service.
      await locked(r.patch('time_entries', time['id'], { values: { hours: '5' } }), 'hours');
      await locked(r.patch('time_entries', time['id'], { values: { note: 'x', worked_on: '2026-09-02' } }), 'worked_on');
      await locked(r.patch('expenses', expense['id'], { values: { amount: '41' } }), 'amount');
      await locked(
        r.t.app.inject({
          method: 'POST',
          url: `/api/v1/data/${r.connectionId}/${r.table('time_entries')}/bulk`,
          headers: { 'x-test-user-id': r.t.users.admin.id },
          payload: { action: 'update', ids: [String(time['id'])], values: { hours: '6' } },
        }) as never,
        'hours',
      );
      await locked(r.undo(undoToken!) as never, 'hours');
      await expect(w.update('time_entries', time['id'], { hours: '7' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // What the line does not keep still changes.
      const note = await r.patch('time_entries', time['id'], { values: { note: 'design, round 2' } });
      expect(note.statusCode, note.body).toBe(200);

      // An import of the time, matched by id: the hours are refused, reported by column.
      const csv = ['id,hours', `${String(time['id'])},8`, ''].join('\n');
      let report = '';
      const storage = {
        read: async () => Readable.from([csv]),
        write: async (input: { bytes: string }) => {
          report = input.bytes;
          return { storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' };
        },
      } as unknown as FileStore;
      const file = await filesRepo(h.meta).create({ filename: 'time.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
      const job = await importsRepo(h.meta).create({
        connectionId: h.connectionId,
        tableName: w.targetOf('time_entries').table.id,
        requestedBy: String((await h.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id),
        fileId: file.id,
        mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'hours', to: 'hours' }] },
        options: { mode: 'upsert', matchColumn: 'id' },
      });
      await importsRepo(h.meta).markReady(job.id, { total: 1 });
      let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
      registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: h.meta, manager: h.manager, storage });
      await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log: () => {} }).catch((error: unknown) => {
        report = String((error as Error).message);
      });
      expect(report).toContain('hours can no longer change');
      expect(Number((await row('time_entries', time['id']))['hours'])).toBe(4);

      // A guest's change through a public entry that may write the hours: the one opaque refusal.
      const views = createPublicViews(h.meta);
      const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'time_door',
        origin: 'custom',
        definition: {
          path: '/time_door',
          source: (await views.viewFor(h.connectionId))!.table(h.real('time_entries')).id,
          methods: ['PATCH'],
          select: ['id', 'hours', 'note'],
          filters: [],
          pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
          auth: { role: 'anon' },
          rate_limit: { requests: 60, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
          writable: ['hours', 'note'],
        },
      });
      const secret = generatePublishableKey('browser');
      const { key } = await service.createKey({
        connectionId: h.connectionId,
        name: 'time door',
        access: [{ ref: 'time_door', methods: ['PATCH'] }],
        secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
        origins: [],
        kind: 'browser',
      });
      served = await servePublic(h, key.id);
      const guest = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/time_door/${String(time['id'])}`, headers: served.headers(), payload: { values: { hours: '1' } } });
      expect(guest.statusCode, guest.body).toBe(400);
      expect(guest.json<{ error: { code: string } }>().error.code).toBe('PUBLIC_WRITE_REFUSED');
      expect(Number((await row('time_entries', time['id']))['hours'])).toBe(4);
      // The same door changes what the line does not keep.
      const guestNote = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/time_door/${String(time['id'])}`, headers: served.headers(), payload: { values: { note: 'from the portal' } } });
      expect(guestNote.statusCode, guestNote.body).toBe(200);

      // Sent: still kept. Void: free, before the line lets go and after.
      await w.update('invoices', invoice['id'], { status: 'sent' });
      await expect(w.update('time_entries', time['id'], { hours: '9' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      await w.update('invoices', invoice['id'], { status: 'void' }, boss);
      await w.update('time_entries', time['id'], { hours: '4.5' });
      await w.update('expenses', expense['id'], { amount: '42' });
      expect(Number((await row('time_entries', time['id']))['hours'])).toBe(4.5);
    });

    it('name the tables in a refusal by their own names, never a schema', async () => {
      const { h, w, boss, entry, billing } = await harness(dialect);
      const time = await entry();
      const { invoice, line } = await billing(time);
      const linked = await w.update('time_entries', time['id'], { hours: '5' }).catch((error: unknown) => error);
      expect(linked).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'hours', linkedFrom: h.real('invoice_lines') } });
      expect((linked as Error).message).toBe(`This ${h.real('time_entries')} row is linked from ${h.real('invoice_lines')}: hours can no longer change.`);
      await w.update('invoices', invoice['id'], { status: 'sent' }, boss);
      const parent = await w.update('invoice_lines', line['id'], { qty: '2' }).catch((error: unknown) => error);
      expect(parent).toMatchObject({ code: 'RECORD_LOCKED', details: { table: h.real('invoice_lines'), parent: h.real('invoices') } });
      expect((parent as Error).message).toBe(`${h.real('invoice_lines')} rows cannot change while their ${h.real('invoices')} is sent.`);
    });

    it('link nothing new through a link the model can no longer follow', async () => {
      const { h, entry, billing } = await harness(dialect);
      const time = await entry();
      const before = await billing(time);
      // Studio's remap editor takes the link's relation away: the rule can no longer be kept.
      const lines = (await settledWriter(h)).targetOf('invoice_lines').table.id;
      const times = (await settledWriter(h)).targetOf('time_entries').table.id;
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'relation.remove', tableName: lines, value: { fromColumn: 'time_entry_id', toTable: times }, origin: 'user' });
      const w = await settledWriter(h);
      const other = await w.create('time_entries', { hours: '2', worked_on: '2026-09-03' });
      const invoice = await w.create('invoices', { client_id: (await w.create('clients', { email: 'bo@example.test', name: 'Bo' }))['id'] });
      const refused = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100', time_entry_id: other['id'] }).catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'RECORD_LOCKED', details: { table: h.real('invoice_lines'), column: 'time_entry_id', unresolved: true } });
      const moved = await w.update('invoice_lines', before.line['id'], { time_entry_id: other['id'] }).catch((error: unknown) => error);
      expect(moved).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'time_entry_id', unresolved: true } });
      // A line with no link, a change beside the link, and emptying it all still go.
      const plain = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '50' });
      expect(plain['id']).toBeDefined();
      await w.update('invoice_lines', before.line['id'], { qty: '2' });
      await w.update('invoice_lines', before.line['id'], { time_entry_id: null });
    });

    it('bill time again once its void line let go of it, and keep it again', async () => {
      const { w, boss, row, entry, billing } = await harness(dialect);
      const time = await entry();
      const first = await billing(time);
      await w.update('invoices', first.invoice['id'], { status: 'void' }, boss);
      // Still linked from the void line, which holds the time's one place on an invoice.
      await expect(billing(time)).rejects.toBeTruthy();
      await w.update('invoice_lines', first.line['id'], { time_entry_id: null });
      await w.update('time_entries', time['id'], { hours: '2.25' });
      const second = await billing(time);
      expect(Number((await row('invoice_lines', second.line['id']))['billed_hours'])).toBe(2.25);
      await expect(w.update('time_entries', time['id'], { hours: '2' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    });
  });

  describe.skipIf(!available || dialect !== 'sqlite')('a release only in a final state, as Studio keeps it', () => {
    it('takes the stored states, and refuses a release in a state a move leaves, or outside the lock', async () => {
      const { h, w } = await harness(dialect);
      const invoices = w.targetOf('invoices').table.id;
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })).find((row) => row.op === 'table.states' && row.tableName === invoices)!;
      const model = w.view.model as unknown as DatabaseModel;
      const table = model.tables.find((t) => t.id === invoices)!;
      expect(statesRuleIssue(stored.value, table, model)).toBeNull();
      const states = structuredClone(stored.value) as { moves: Record<string, unknown[]> };
      states.moves['void'] = ['draft'];
      expect(statesRuleIssue(states, table, model)).toMatch(/"void" has moves out of it/);
      const lines = Object.keys((stored.value as { children: Record<string, unknown> }).children).find((id) => id.endsWith('invoice_lines'))!;
      const outside = structuredClone(stored.value) as { children: Record<string, { release: { when: string[] } }> };
      outside.children[lines]!.release.when = ['draft'];
      expect(statesRuleIssue(outside, table, model)).toMatch(/not a state the lock holds/);
    });
  });

  describe.skipIf(!available || dialect === 'sqlite')(`billed time under two desks at once on ${dialect}`, () => {
    it('never leave a line billing hours its time no longer has', async () => {
      const { h, w, entry } = await harness(dialect);
      const outcomes = { both: 0, hoursFirst: 0, billedFirst: 0 };
      for (let round = 0; round < 16; round += 1) {
        const time = await entry('3');
        const invoice = await w.create('invoices', { client_id: (await h.rows(`select id from ${h.real('clients')}`))[0]!['id'] });
        const [edit, bill] = await Promise.allSettled([
          w.update('time_entries', time['id'], { hours: '5' }),
          w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100', time_entry_id: time['id'] }),
        ]);
        // Each refusal is one the engine gives on purpose, never anything else.
        if (edit.status === 'rejected') expect(codeOf(edit.reason)).toBe('RECORD_LOCKED');
        if (bill.status === 'rejected') expect(codeOf(bill.reason)).toBe('WRITE_CONFLICT');
        const [kept] = await h.rows(`select hours from ${h.real('time_entries')} where id = ${String(time['id'])}`);
        const lines = await h.rows(`select billed_hours from ${h.real('invoice_lines')} where time_entry_id = ${String(time['id'])}`);
        // A line bills exactly the hours its time has.
        for (const line of lines) expect(Number(line['billed_hours'])).toBe(Number(kept!['hours']));
        if (edit.status === 'fulfilled' && bill.status === 'fulfilled') outcomes.both += 1;
        else if (edit.status === 'fulfilled') outcomes.hoursFirst += 1;
        else outcomes.billedFirst += 1;
      }
      expect(outcomes.both + outcomes.hoursFirst + outcomes.billedFirst).toBe(16);
      // The desks really met: in some round one of them was refused because of the other.
      expect(outcomes.hoursFirst + outcomes.billedFirst).toBeGreaterThan(0);
    });
  });
}
