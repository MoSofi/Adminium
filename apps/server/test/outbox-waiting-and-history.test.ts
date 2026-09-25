// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT WAITS, AND WHAT HISTORY BRINGS — the three ways a message could go
 * that nobody meant, on every engine.
 *
 *  - A held reminder whose day cannot be worked out (the invoice has no due
 *    date) waits for a person; once a person approves it, it goes at the
 *    next send — it must not wait for a day that will never come.
 *  - An import or an undo may bring any row of the log as it was, but a row
 *    brought in `queued` was made by no producer: it waits for a person
 *    rather than going out as if the outbox had made it.
 *  - A batched message (one "new work" email per window) is judged like any
 *    other waiting message: dropped when the row it is about no longer needs
 *    it, overtaken when a later message of its group has come due.
 *
 * A small studio app installed through the real installer; the producers,
 * the minute scan, the sender and the moves a person may make run as the
 * server runs them; only the clock is the test's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentSequencesRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { slotInstant } from '../src/crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { NO_RECORD_HOOKS, createWriteService, type WriteContext } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { BROUGHT_IN_QUEUED, judgeMove, withOutboxMoves } from '../src/outbox/moves.js';
import { createOutboxProducers, type LiveOutbox, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const fk = (ref: string, references: string, nullable = true) => ({ ref, type: 'fk', references, nullable });
const instant = (ref: string) => ({ ref, type: 'timestamptz', nullable: true });

const KINDS = ['invoice-sent', 'reminder', 'new-work', 'delivered'];

function tables(): Record<string, unknown>[] {
  return [
    { ref: 'settings', columns: [id, text('name')] },
    { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
    {
      ref: 'invoices',
      columns: [id, fk('client_id', 'clients', false), { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' }, { ref: 'due_on', type: 'date', nullable: true }],
    },
    {
      ref: 'deliverables',
      columns: [
        id,
        fk('client_id', 'clients'),
        text('title'),
        { ref: 'status', type: 'enum', enum: ['open', 'cancelled', 'delivered'], default: 'open' },
        { ref: 'delivered_on', type: 'date', nullable: true },
      ],
    },
    { ref: 'deliverable_versions', columns: [id, fk('deliverable_id', 'deliverables', false), { ref: 'v', type: 'int', nullable: true }] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: KINDS },
        { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        text('language', 35),
        fk('client_id', 'clients'),
        fk('invoice_id', 'invoices'),
        fk('deliverable_id', 'deliverables'),
        text('skip_reason', 24),
        text('approved_by'),
        instant('due'),
        instant('sent_at'),
        text('error', 200),
      ],
    },
  ];
}

const template = (key: string, subject: string) => ({
  key: `studio-${key}`,
  name: key,
  locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: `${subject}.` } }] } },
});

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest(tables()),
    outbox: {
      table: 'messages',
      columns: {
        kind: 'kind',
        status: 'status',
        to: 'to_address',
        language: 'language',
        due: 'due',
        sentAt: 'sent_at',
        error: 'error',
        skipReason: 'skip_reason',
        approvedBy: 'approved_by',
      },
      links: { client: 'client_id', invoice: 'invoice_id', deliverable: 'deliverable_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
      producers: [
        { kind: 'invoice-sent', link: 'invoice_id', onChange: { table: 'invoices', column: 'status', to: 'sent' } },
        // Three days after the due date, at 09:00 — no due date, no day.
        {
          kind: 'reminder',
          link: 'invoice_id',
          hold: true,
          onChange: { table: 'invoices', column: 'status', to: 'sent' },
          due: { date: 'due_on', days: 3, at: '09:00' },
          dropWhen: [{ column: 'status', eq: 'void', reason: 'void' }],
        },
        // One email per deliverable per ten minutes; not wanted once it is cancelled, nor once the delivery has come due.
        {
          kind: 'new-work',
          link: 'deliverable_id',
          onCreate: { table: 'deliverable_versions', via: 'deliverable_id' },
          // Its window is its due: a batch takes no other.
          batchMinutes: 10,
          supersede: 'work',
          dropWhen: [{ column: 'status', eq: 'cancelled', reason: 'no-longer-needed' }],
        },
        {
          kind: 'delivered',
          link: 'deliverable_id',
          onChange: { table: 'deliverables', column: 'status', to: 'delivered' },
          due: { date: 'delivered_on', days: 0, at: '00:00' },
          supersede: 'work',
        },
      ],
    },
    emailTemplates: [
      template('invoice-sent', 'Your invoice'),
      template('reminder', 'A gentle nudge'),
      template('new-work', 'New work to review'),
      template('delivered', 'Delivered'),
    ],
  };
}

const at = (utc: string) => Date.parse(utc);

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`what waits, and what history brings, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;
    let producers: OutboxProducers;
    let sender: OutboxSender;
    let view: SnapshotView;
    let writes: ReturnType<typeof createWriteService>;
    const clock = at('2026-10-02T12:00:00Z');
    const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };
    const imported: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };
    const undone: WriteContext = { origin: 'undo', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };

    const table = (ref: string): ResolvedTable => view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id);
    const rows = (statement: string) =>
      h.rows(statement.replaceAll(/\bstudio\.(settings|clients|invoices|deliverables|deliverable_versions|messages)\b/g, (_, ref: string) => h.real(ref)));
    const target = async (ref: string) => {
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      return { connectionId: h.connectionId, view, table: table(ref), db, dialect: d, timezone: 'Europe/London' };
    };
    const event = (ref: string, action: 'create' | 'update', before: Row | null, after: Row): RecordWriteEvent => ({
      connectionId: h.connectionId,
      table: table(ref),
      action,
      entity: { connectionId: h.connectionId, table: table(ref).id, pk: { id: after['id'] }, label: String(after['id']) },
      before,
      after,
      origin: 'dashboard',
      hops: 0,
    });
    /** A write as the dashboard makes it (or an import, an undo): the write service, then the record event. */
    const create = async (ref: string, values: Row, context: WriteContext = desk): Promise<Row> => {
      const row = await writes.create({ target: await target(ref), values, context, announce: async () => {} });
      // History announces nothing.
      if (context === desk) await producers.onRecordEvent(event(ref, 'create', null, row));
      return row;
    };
    const update = async (ref: string, rowId: unknown, values: Row): Promise<Row> => {
      const outcome = await writes.update({ target: await target(ref), pk: { id: rowId }, values, context: desk, announce: async () => {} });
      await producers.onRecordEvent(event(ref, 'update', outcome.before, outcome.after!));
      return outcome.after!;
    };
    const msg = async (mid: unknown) => {
      const row = (await rows(`SELECT * FROM studio.messages WHERE id = ${String(mid)}`))[0]!;
      return {
        kind: String(row['kind']),
        status: String(row['status']),
        to: (row['to_address'] as string | null) ?? null,
        skip: (row['skip_reason'] as string | null) ?? null,
        approvedBy: (row['approved_by'] as string | null) ?? null,
        due: slotInstant(row['due'])?.toISOString() ?? null,
        sent: row['sent_at'] !== null,
        error: (row['error'] as string | null) ?? null,
      };
    };
    const about = async (column: 'invoice_id' | 'deliverable_id', rowId: unknown, kind: string) =>
      (await rows(`SELECT id FROM studio.messages WHERE ${column} = ${String(rowId)} AND kind = '${kind}' ORDER BY id`)).map((row) => row['id']);

    /** Every email queued, oldest first. */
    const mail = async () =>
      (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
        const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
        return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string };
      });
    /** The subjects of every email queued to one address: each test mails its own client. */
    const mailTo = async (address: string) => (await mail()).filter((m) => m.to === address).map((m) => m.subject);
    /** A client of this test's own. */
    const client = async (name: string) => create('clients', { email: `${name}@client.studio.dev`, name });

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
      meta = h.meta;
      await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).where('id', '=', h.connectionId).execute();
      await settingsRepo(meta).set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Studio <no-reply@north-studio.dev>',
        secure: false,
      } as never);
      const views = createPublicViews(meta);
      view = (await views.viewFor(h.connectionId))!;
      writes = createWriteService({
        sequences: documentSequencesRepo(meta),
        hooks: () => withOutboxMoves(NO_RECORD_HOOKS, { meta, outboxes: () => producers.all(), now: () => clock }),
        watched: (connectionId, tableId) => producers.watches(connectionId, tableId),
      });
      producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
      await rows(`INSERT INTO studio.settings (name) VALUES ('North Studio')`);
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('sends an approved reminder whose day could not be worked out at the next send — and never one nobody approved', async () => {
      const cal = await client('cal');
      const invoice = await create('invoices', { client_id: cal['id'], due_on: null });
      await update('invoices', invoice['id'], { status: 'sent' });
      const [waiting] = await about('invoice_id', invoice['id'], 'reminder');
      // No due date, no day: it waits for a person, whatever the clock says.
      expect(await msg(waiting)).toMatchObject({ status: 'held', due: null });
      for (const now of [clock, clock + 86_400_000 * 30]) {
        await producers.scan(now);
        await sender.sendApp('studio', now);
      }
      expect(await mailTo('cal@client.studio.dev')).toEqual(['Your invoice']);
      expect((await msg(waiting)).status).toBe('held');

      // A person approves it: it goes at the next send, to the address on file.
      await update('messages', waiting, { status: 'queued' });
      expect(await msg(waiting)).toMatchObject({ status: 'queued', approvedBy: 'Ivy Ferreira' });
      await producers.scan(clock);
      await sender.sendApp('studio', clock);
      expect(await mailTo('cal@client.studio.dev')).toEqual(['Your invoice', 'A gentle nudge']);
      // Due when it was approved: the log says when it became ready.
      expect(await msg(waiting)).toMatchObject({ status: 'sent', sent: true, due: new Date(clock).toISOString() });
    });

    it('holds a message an import or an undo brings in queued: it goes only once a person approves it', async () => {
      const dee = await client('dee');
      const address = 'dee@client.studio.dev';
      const invoice = await create('invoices', { client_id: dee['id'], due_on: '2026-10-01' });
      const brought = async (context: WriteContext, values: Row = {}) =>
        (await create('messages', { kind: 'invoice-sent', status: 'queued', invoice_id: invoice['id'], client_id: dee['id'], to_address: address, ...values }, context))['id'];
      const fromImport = await brought(imported);
      const fromUndo = await brought(undone);
      // A reminder of a producer that holds, brought in queued as if approved: nobody here approved it.
      const reminder = await brought(imported, { kind: 'reminder', approved_by: 'Someone Else' });
      for (const mid of [fromImport, fromUndo, reminder]) expect((await msg(mid)).status).toBe('held');
      await producers.scan(clock);
      await sender.sendApp('studio', clock);
      await sender.sweep(clock + 60_000);
      expect(await mailTo(address)).toEqual([]);

      // History brings every other row as it was: a sent one stays sent, a failed one failed, a skipped one skipped.
      const sent = await brought(imported, { status: 'sent', sent_at: new Date(clock).toISOString() });
      const failed = await brought(undone, { status: 'failed', error: 'Mailbox full' });
      const skipped = await brought(imported, { status: 'skipped', skip_reason: 'by-hand' });
      expect([(await msg(sent)).status, (await msg(failed)).status, (await msg(skipped)).status]).toEqual(['sent', 'failed', 'skipped']);
      // A queued row that says it went already, and records no failure, went: it is sent, never sent again.
      const went = await brought(imported, { sent_at: new Date(clock - 60_000).toISOString() });
      expect(await msg(went)).toMatchObject({ status: 'sent', sent: true });
      await sender.sendApp('studio', clock);
      expect(await mailTo(address)).toEqual([]);

      // A person approves the imported one: it goes, once.
      await update('messages', fromImport, { status: 'queued' });
      await sender.sendApp('studio', clock);
      await sender.sendApp('studio', clock + 60_000);
      expect(await mailTo(address)).toEqual(['Your invoice']);
      expect((await msg(fromImport)).status).toBe('sent');
      expect((await msg(fromUndo)).status).toBe('held');
    });

    it('drops a batched message the row it is about no longer needs — at the scan, and again just before it goes', async () => {
      const eve = await client('eve');
      const deliverable = async (title: string) => create('deliverables', { client_id: eve['id'], title });
      const post = async (row: Row) => create('deliverable_versions', { deliverable_id: row['id'], v: 1 });

      // Cancelled while its window is open: the scan skips it.
      const scanned = await deliverable('Sleeve back');
      await post(scanned);
      const [first] = await about('deliverable_id', scanned['id'], 'new-work');
      expect((await msg(first)).status).toBe('queued');
      await update('deliverables', scanned['id'], { status: 'cancelled' });
      await producers.scan(Date.now());
      expect(await msg(first)).toMatchObject({ status: 'skipped', skip: 'no-longer-needed' });

      // Cancelled with no scan between: the sender judges it as its window closes.
      const unscanned = await deliverable('Sleeve front');
      await post(unscanned);
      const [second] = await about('deliverable_id', unscanned['id'], 'new-work');
      await update('deliverables', unscanned['id'], { status: 'cancelled' });
      await sender.sendApp('studio', Date.parse((await msg(second)).due!) + 1_000);
      expect(await mailTo('eve@client.studio.dev')).toEqual([]);
      expect(await msg(second)).toMatchObject({ status: 'skipped', skip: 'no-longer-needed', sent: false });
    });

    it('skips a batched message overtaken by a later one of its group that has come due', async () => {
      const fay = await client('fay');
      const row = await create('deliverables', { client_id: fay['id'], title: 'Cover' });
      await create('deliverable_versions', { deliverable_id: row['id'], v: 1 });
      const [batch] = await about('deliverable_id', row['id'], 'new-work');
      const window = (await msg(batch)).due!;
      // Delivered today: the delivery notice is due at once, and goes while the batch's window is still open.
      await update('deliverables', row['id'], { status: 'delivered', delivered_on: new Date().toISOString().slice(0, 10) });
      await sender.sendApp('studio', Date.now());
      expect(await mailTo('fay@client.studio.dev')).toEqual(['Delivered']);
      // Its window closes after the delivery went: it is overtaken, not sent.
      await sender.sendApp('studio', Date.parse(window) + 1_000);
      expect(await mailTo('fay@client.studio.dev')).toEqual(['Delivered']);
      expect(await msg(batch)).toMatchObject({ status: 'skipped', skip: 'overtaken', sent: false });
    });

    it('keeps a batched message’s own window through the scan and the send: a batch is never re-dated by the date its group reads', async () => {
      const gus = await client('gus');
      const row = await create('deliverables', { client_id: gus['id'], title: 'Spine' });
      await create('deliverable_versions', { deliverable_id: row['id'], v: 1 });
      const [batch] = await about('deliverable_id', row['id'], 'new-work');
      const window = (await msg(batch)).due!;
      // A delivery date far ahead: were the batch re-dated by it, it would move there.
      await rows(`UPDATE studio.deliverables SET delivered_on = '2027-01-01' WHERE id = ${String(row['id'])}`);
      await producers.scan(Date.now());
      expect(await msg(batch)).toMatchObject({ status: 'queued', due: window });
      await sender.sendApp('studio', Date.parse(window) + 1_000);
      expect(await mailTo('gus@client.studio.dev')).toEqual(['New work to review']);
    });
  });
}

describe('a queued row history brings to an outbox that offers no held', () => {
  // A clinic's log: queued, sent, failed, skipped — no producer holds, so no `held`.
  const box = (options: { enum?: string[] | null; hold?: boolean } = {}): { box: LiveOutbox; target: never } => ({
    box: {
      appKey: 'clinic',
      connectionId: 'c1',
      row: {} as never,
      definition: {
        table: 'messages',
        columns: { kind: 'kind', status: 'status', to: 'to_address', sentAt: 'sent_at', error: 'error' },
        recipient: { via: 'patient_id', table: 'patients', email: 'email' },
        kinds: { reminder: 'clinic-reminder' },
        producers: [{ kind: 'reminder', link: 'appointment_id', onCreate: { table: 'appointments' }, ...(options.hold === true ? { hold: true } : {}) }],
      } as never,
    },
    target: {
      connectionId: 'c1',
      view: { model: { enums: [{ id: 'message_status', values: options.enum ?? [] }] } },
      table: { id: 'messages', columns: new Map(), table: { columns: [{ name: 'status', enumRef: options.enum === null ? null : 'message_status' }] } },
    } as never,
  });
  const judged = async (origin: 'import' | 'undo', values: Row, options?: { enum?: string[] | null; hold?: boolean }): Promise<Row> => {
    const { box: outbox, target } = box(options);
    const event = { action: 'create' as const, target, values: { kind: 'reminder', ...values }, record: null, context: { origin, hops: 0, actor: null, request: null } };
    await judgeMove(outbox, event, { meta: null as never });
    return event.values;
  };
  const CLINIC = ['queued', 'sent', 'failed', 'skipped'];

  it('marks it failed, saying why, so a person may queue it again — it never goes by itself', async () => {
    expect(await judged('import', { status: 'queued' }, { enum: CLINIC })).toMatchObject({ status: 'failed', error: BROUGHT_IN_QUEUED });
    // No status: the column's default is queued.
    expect(await judged('undo', {}, { enum: CLINIC })).toMatchObject({ status: 'failed', error: BROUGHT_IN_QUEUED });
    // A failure it carried is replaced by why it is failed now.
    expect(await judged('import', { status: 'queued', error: 'Mailbox full' }, { enum: CLINIC })).toMatchObject({ status: 'failed', error: BROUGHT_IN_QUEUED });
  });

  it('holds it where the option list offers held, or — with no list known — where a producer holds', async () => {
    expect((await judged('import', { status: 'queued' }, { enum: [...CLINIC, 'held'] }))['status']).toBe('held');
    expect((await judged('import', { status: 'queued' }, { enum: null, hold: true }))['status']).toBe('held');
    expect((await judged('import', { status: 'queued' }, { enum: null }))['status']).toBe('failed');
  });

  it('brings a row that says it went back sent, and every other row as it was', async () => {
    const went = new Date('2026-10-01T09:00:00Z').toISOString();
    expect(await judged('import', { status: 'queued', sent_at: went }, { enum: CLINIC })).toMatchObject({ status: 'sent', sent_at: went });
    // Tried and failed: a failure, not a send.
    expect(await judged('import', { status: 'queued', sent_at: went, error: 'Bounced' }, { enum: CLINIC })).toMatchObject({ status: 'failed', error: BROUGHT_IN_QUEUED });
    for (const status of ['sent', 'failed', 'skipped']) {
      expect(await judged('undo', { status, error: 'as it was' }, { enum: CLINIC })).toEqual({ kind: 'reminder', status, error: 'as it was' });
    }
  });
});
