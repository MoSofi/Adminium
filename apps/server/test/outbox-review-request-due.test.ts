// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TWO MAILS AFTER A VISIT, as an app's own outbox times them, on every
 * engine: a request the morning after at 10:00 on the venue's clock, and one
 * reminder four days later, unless the visit was reviewed.
 *
 * This is the contract a bookings app stands on, so it is declared here in the
 * words such an app uses: both producers hear a visit reach `arrived` or
 * `done` (a desk that forgets "Done" still asks), wait on a `due`, go in one
 * `supersede` group (a visit closed a week late gets one mail, not two), and
 * are dropped by `dropWhen`. The producers, the minute scan and the sender run
 * as the server runs them; only the clock is the test's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documentSequencesRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { slotInstant } from '../src/crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { NO_RECORD_HOOKS, createWriteService, type WriteContext } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { withOutboxMoves } from '../src/outbox/moves.js';
import { createOutboxProducers, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const ZONE = 'America/Los_Angeles';
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const fk = (ref: string, references: string, nullable = true) => ({ ref, type: 'fk', references, nullable });
const instant = (ref: string) => ({ ref, type: 'timestamptz', nullable: true });
const KINDS = ['review-request', 'review-reminder'];
const STATES = ['booked', 'arrived', 'done', 'no_show', 'cancelled'];

/** Both mails hear the same move, and leave the same way. */
const mail = (kind: string, days: number) => ({
  kind,
  link: 'visit_id',
  gate: { setting: { table: 'settings', column: 'reviews_on' } },
  onChange: { table: 'visits', column: 'state', to: ['arrived', 'done'] },
  due: { date: 'starts_at', days, at: '10:00' },
  supersede: 'review',
  dropWhen: [
    { column: 'reviewed_at', isNull: false, reason: 'no-longer-needed' },
    { column: 'state', in: ['booked', 'no_show', 'cancelled'], reason: 'no-longer-needed' },
  ],
});

function manifest(): Record<string, unknown> {
  const tables = [
    { ref: 'settings', columns: [id, text('name'), { ref: 'reviews_on', type: 'bool', default: true }] },
    { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
    { ref: 'visits', columns: [id, fk('customer_id', 'customers', false), instant('starts_at'), { ref: 'state', type: 'enum', enum: STATES, default: 'booked' }, instant('reviewed_at')] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: KINDS },
        { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        fk('customer_id', 'customers'),
        fk('visit_id', 'visits'),
        text('skip_reason', 24),
        instant('due'),
        instant('sent_at'),
        text('error', 200),
        text('approved_by', 120),
      ],
    },
  ];
  const template = (kind: string, subject: string) => ({
    key: `studio-${kind}`,
    name: kind,
    locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: 'How was your visit?' } }] } },
  });
  return {
    ...invoicingManifest(tables),
    pages: [{ ref: 'studio-visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'visits' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason', approvedBy: 'approved_by' },
      links: { customer: 'customer_id', visit: 'visit_id' },
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
      producers: [mail('review-request', 1), mail('review-reminder', 5)],
    },
    emailTemplates: [template('review-request', 'How was it?'), template('review-reminder', 'A last word?')],
  };
}

const utc = (spelled: string) => Date.parse(spelled);

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the two mails after a visit on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;
    let view: SnapshotView;
    let producers: OutboxProducers;
    let sender: OutboxSender;
    let writes: ReturnType<typeof createWriteService>;
    let customer: Row;
    const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_desk', label: 'The desk' }, request: null };

    const table = (ref: string): ResolvedTable => view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id);
    const target = async (ref: string) => {
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      return { connectionId: h.connectionId, view, table: table(ref), db, dialect: d, timezone: ZONE };
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
    const create = async (ref: string, values: Row): Promise<Row> => {
      const row = await writes.create({ target: await target(ref), values, context: desk, announce: async () => {} });
      await producers.onRecordEvent(event(ref, 'create', null, row));
      return row;
    };
    const update = async (ref: string, rowId: unknown, values: Row): Promise<Row> => {
      const outcome = await writes.update({ target: await target(ref), pk: { id: rowId }, values, context: desk, announce: async () => {} });
      await producers.onRecordEvent(event(ref, 'update', outcome.before, outcome.after!));
      return outcome.after!;
    };
    /** This visit's mails, oldest first: kind, status, why skipped, and when due. */
    const mails = async (visit: Row) => {
      const rows = await h.rows(`SELECT kind, status, skip_reason, due FROM ${h.real('messages')} WHERE visit_id = ${String(visit['id'])} ORDER BY id`);
      return rows.map((row) => ({ kind: row['kind'], status: row['status'], skip: row['skip_reason'] ?? null, due: slotInstant(row['due'])?.toISOString() }));
    };
    const statuses = async (visit: Row) => Object.fromEntries((await mails(visit)).map((row) => [row.kind, row.skip === null ? row.status : `${String(row.status)}:${String(row.skip)}`]));
    const visitOn = (starts: string) => create('visits', { customer_id: customer['id'], starts_at: starts });
    const run = async (now: string) => {
      await producers.scan(utc(now));
      return sender.sendApp('studio', utc(now));
    };

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
      meta = h.meta;
      await meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', h.connectionId).execute();
      await settingsRepo(meta).set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Studio <no-reply@studio.example>',
        secure: false,
      } as never);
      await settingsRepo(meta).set('system.publicOrigin', 'https://admin.studio.example' as never);
      const views = createPublicViews(meta);
      view = (await views.viewFor(h.connectionId))!;
      writes = createWriteService({
        sequences: documentSequencesRepo(meta),
        watched: (connectionId, tableId) => producers.watches(connectionId, tableId),
        hooks: () => withOutboxMoves(NO_RECORD_HOOKS, { meta, outboxes: () => producers.all() }),
      });
      producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      sender = createOutboxSender({
        meta,
        manager: h.manager,
        viewFor: views.viewFor,
        writes,
        live: () => producers.live(),
        secret: TEST_SECRET,
        hostFor: async () => 'book.studio.example',
        emit: async (e) => {
          await producers.onRecordEvent(e);
        },
      });
      await h.rows(`INSERT INTO ${h.real('settings')} (name) VALUES ('Lumen')`);
      customer = await create('customers', { email: 'ava@lumen-guests.dev', name: 'Ava Stone' });
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    beforeEach(async () => {
      // Each test's mails only: what an earlier visit left waiting is not this one's to send.
      await h.rows(`DELETE FROM ${h.real('messages')}`);
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'true' : '1'}`);
    });

    it('times the request for the morning after at 10:00, and the reminder four days on', async () => {
      const visit = await visitOn('2026-09-16T21:00:00.000Z'); // Wed 16 Sep, 14:00 in Los Angeles
      await update('visits', visit['id'], { state: 'done' });
      expect((await mails(visit)).map((row) => [row.kind, row.due])).toEqual([
        ['review-request', '2026-09-17T17:00:00.000Z'],
        ['review-reminder', '2026-09-21T17:00:00.000Z'],
      ]);
      expect(await run('2026-09-17T16:59:00Z')).toBe(0);
      expect(await run('2026-09-17T17:00:00Z')).toBe(1);
      expect(await statuses(visit)).toEqual({ 'review-request': 'sent', 'review-reminder': 'queued' });
      expect(await run('2026-09-21T16:59:00Z')).toBe(0);
      expect(await run('2026-09-21T17:00:00Z')).toBe(1);
      expect(await statuses(visit)).toEqual({ 'review-request': 'sent', 'review-reminder': 'sent' });
    });

    it('keeps 10:00 on the venue’s clock across a change of the clocks', async () => {
      const visit = await visitOn('2026-10-31T21:00:00.000Z'); // Sat 31 Oct, 14:00 PDT; the clocks go back that night
      await update('visits', visit['id'], { state: 'done' });
      expect((await mails(visit)).map((row) => row.due)).toEqual(['2026-11-01T18:00:00.000Z', '2026-11-05T18:00:00.000Z']);
    });

    it('asks once when a visit goes through arrived to done, and asks when nobody marks it done', async () => {
      const both = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', both['id'], { state: 'arrived' });
      await update('visits', both['id'], { state: 'done' });
      expect((await mails(both)).map((row) => row.kind)).toEqual(['review-request', 'review-reminder']);

      const forgotten = await visitOn('2026-09-16T22:00:00.000Z');
      await update('visits', forgotten['id'], { state: 'arrived' });
      expect((await mails(forgotten)).map((row) => row.kind)).toEqual(['review-request', 'review-reminder']);
    });

    it('sends neither once the visit is reviewed', async () => {
      const visit = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', visit['id'], { state: 'done' });
      await update('visits', visit['id'], { reviewed_at: '2026-09-16T23:00:00.000Z' });
      // The sender judges each message again as it comes due: what it counts is what it dealt with, so the statuses tell.
      await run('2026-09-22T17:00:00Z');
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'skipped:no-longer-needed' });
    });

    it('sends no reminder after a request that was answered, and neither if the visit is taken back', async () => {
      const reviewedLate = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', reviewedLate['id'], { state: 'done' });
      expect(await run('2026-09-17T17:00:00Z')).toBe(1);
      await update('visits', reviewedLate['id'], { reviewed_at: '2026-09-18T17:00:00.000Z' });
      await run('2026-09-21T17:00:00Z');
      expect(await statuses(reviewedLate)).toEqual({ 'review-request': 'sent', 'review-reminder': 'skipped:no-longer-needed' });

      const mistake = await visitOn('2026-09-16T22:00:00.000Z');
      await update('visits', mistake['id'], { state: 'done' });
      await update('visits', mistake['id'], { state: 'booked' });
      await run('2026-09-22T17:00:00Z');
      expect(await statuses(mistake)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'skipped:no-longer-needed' });
    });

    it('sends one mail, not two, for a visit closed a week late', async () => {
      const visit = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', visit['id'], { state: 'done' });
      await run('2026-09-23T17:00:00Z');
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:overtaken', 'review-reminder': 'sent' });
    });

    it('drops what comes due while the studio has reviews off, and sends none of it when they are back on', async () => {
      const visit = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', visit['id'], { state: 'done' });
      expect((await mails(visit)).map((row) => row.status)).toEqual(['queued', 'queued']);
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'false' : '0'}`);
      await run('2026-09-22T17:00:00Z');
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'skipped:no-longer-needed' });
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'true' : '1'}`);
      expect(await run('2026-09-23T17:00:00Z')).toBe(0);
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'skipped:no-longer-needed' });
    });

    it('keeps a mail not yet due when reviews go off and come back before its moment', async () => {
      const visit = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', visit['id'], { state: 'done' });
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'false' : '0'}`);
      await run('2026-09-17T17:00:00Z');
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'queued' });
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'true' : '1'}`);
      expect(await run('2026-09-21T17:00:00Z')).toBe(1);
      expect(await statuses(visit)).toEqual({ 'review-request': 'skipped:no-longer-needed', 'review-reminder': 'sent' });
    });

    describe('a person decides, or the day moved, while reviews are off', () => {
      const off = () => h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'false' : '0'}`);
      const requestOf = async (visit: Row) => (await h.rows(`SELECT id FROM ${h.real('messages')} WHERE visit_id = ${String(visit['id'])} AND kind = 'review-request'`))[0]!['id'];
      const setStatus = (rowId: unknown, status: string) => h.rows(`UPDATE ${h.real('messages')} SET status = '${status}' WHERE id = ${String(rowId)}`);

      it('leaves a held mail held when its moment passes', async () => {
        const visit = await visitOn('2026-09-16T21:00:00.000Z');
        await update('visits', visit['id'], { state: 'done' });
        await setStatus(await requestOf(visit), 'held');
        await off();
        await run('2026-09-18T17:00:00Z');
        expect((await statuses(visit))['review-request']).toBe('held');
      });

      it('sends a mail a person approved', async () => {
        const visit = await visitOn('2026-09-16T21:00:00.000Z');
        await update('visits', visit['id'], { state: 'done' });
        const request = await requestOf(visit);
        await setStatus(request, 'held');
        await off();
        await update('messages', request, { status: 'queued' });
        await run('2026-09-18T17:00:00Z');
        expect((await statuses(visit))['review-request']).toBe('sent');
      });

      it('sends a failed mail a person queued again', async () => {
        const visit = await visitOn('2026-09-16T21:00:00.000Z');
        await update('visits', visit['id'], { state: 'done' });
        const request = await requestOf(visit);
        await setStatus(request, 'failed');
        await off();
        await update('messages', request, { status: 'queued' });
        await run('2026-09-18T17:00:00Z');
        expect((await statuses(visit))['review-request']).toBe('sent');
      });

      it('moves a mail whose visit moved ahead instead of dropping it on its old day', async () => {
        const visit = await visitOn('2026-09-16T21:00:00.000Z');
        await update('visits', visit['id'], { state: 'done' });
        const later = dialect === 'mysql' ? '2026-09-25 21:00:00' : '2026-09-25T21:00:00.000Z';
        await h.rows(`UPDATE ${h.real('visits')} SET starts_at = '${later}' WHERE id = ${String(visit['id'])}`);
        await off();
        await run('2026-09-18T17:00:00Z');
        const request = (await mails(visit)).find((row) => row.kind === 'review-request')!;
        expect(request.status).toBe('queued');
        expect(request.due).toBe('2026-09-26T17:00:00.000Z');
      });
    });

    it('queues neither while the studio has reviews switched off', async () => {
      await h.rows(`UPDATE ${h.real('settings')} SET reviews_on = ${dialect === 'postgres' ? 'false' : '0'}`);
      const visit = await visitOn('2026-09-16T21:00:00.000Z');
      await update('visits', visit['id'], { state: 'done' });
      expect(await mails(visit)).toEqual([]);
    });
  });
}
