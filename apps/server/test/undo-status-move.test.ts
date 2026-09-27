// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kitchen taking back a status move it made by mistake, on every engine.
 *
 * The app lists a move back for each step (ready → preparing after
 * preparing → ready, marked `undo`), empties the stamps a step wrote
 * (`stamp.clearOnBack`) and holds its "ready" email twenty seconds
 * (`holdSeconds`), dropping it when the order is no longer ready:
 *
 *  - Ready, then Undo within the minute: the ready stamps are empty again,
 *    the time it started preparing and who confirmed it keep what they had,
 *    and the held email is dropped rather than sent; Ready again sends one;
 *  - an undo that does not name the state it saw is refused, and so is a
 *    stale screen's tap that would take back another screen's move;
 *  - an undo after its minute is refused, judged on the stamp as it stands;
 *  - through the data routes: a change naming the state it saw, and the
 *    dashboard's Undo of a status move, made as the listed move back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appOutboxesRepo, documentSequencesRepo, overridesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { slotInstant } from '../src/crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { withSeenState } from '../src/crud/seen-state.js';
import { NO_RECORD_HOOKS, createWriteService, type WriteContext } from '../src/crud/write-service.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { withOutboxMoves } from '../src/outbox/moves.js';
import { createOutboxProducers, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const stamp = (ref: string, type: string, set: string, state: string, clearOnBack = false) => ({
  ref,
  type,
  nullable: true,
  rules: { stamp: { set, on: { column: 'status', values: [state] }, ...(clearOnBack ? { clearOnBack: true } : {}) } },
});

function manifest(): Record<string, unknown> {
  const tables = [
    { ref: 'settings', columns: [id, text('name')] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        text('note'),
        { ref: 'status', type: 'enum', enum: ['placed', 'confirmed', 'preparing', 'ready', 'picked_up'], default: 'placed' },
        stamp('confirmed_by', 'text', 'user-name', 'confirmed'),
        stamp('preparing_at', 'timestamptz', 'now', 'preparing'),
        stamp('ready_at', 'timestamptz', 'now', 'ready', true),
        stamp('ready_by', 'text', 'user-name', 'ready', true),
      ],
      states: {
        column: 'status',
        initial: 'placed',
        moves: {
          placed: ['confirmed'],
          confirmed: ['preparing', { to: 'placed', undo: true }],
          preparing: ['ready', { to: 'confirmed', undo: true }],
          // Taken back only within a minute of the Ready.
          ready: ['picked_up', { to: 'preparing', undo: true, requires: { time: { before: { column: 'ready_at', plus: { minutes: 1 } } } } }],
        },
      },
    },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['order-ready'] },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
        { ref: 'due', type: 'timestamptz', nullable: true },
        text('skip_reason', 24),
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
        text('error', 200),
      ],
    },
  ];
  return {
    ...invoicingManifest(tables),
    pages: [{ ref: 'studio-orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'order-ready': 'studio-ready' },
      producers: [
        {
          kind: 'order-ready',
          link: 'order_id',
          onChange: { table: 'orders', column: 'status', to: 'ready' },
          holdSeconds: 20,
          dropWhen: [{ column: 'status', in: ['placed', 'confirmed', 'preparing'], reason: 'no-longer-needed' }],
        },
      ],
    },
    emailTemplates: [{ key: 'studio-ready', name: 'Ready', locales: { 'en-US': { subject: 'Your order is ready', blocks: [{ block: 'email.text', data: { text: 'Ready.' } }] } } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a status move taken back, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;
    let producers: OutboxProducers;
    let sender: OutboxSender;
    let view: SnapshotView;
    let writes: ReturnType<typeof createWriteService>;
    const sam: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_sam', label: 'Sam' }, request: null };
    const ivy: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

    const table = (ref: string): ResolvedTable => view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id);
    const target = async (ref: string) => {
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      return { connectionId: h.connectionId, view, table: table(ref), db, dialect: d, timezone: 'Europe/London' };
    };
    const event = (ref: string, before: Row | null, after: Row): RecordWriteEvent => ({
      connectionId: h.connectionId,
      table: table(ref),
      action: before === null ? 'create' : 'update',
      entity: { connectionId: h.connectionId, table: table(ref).id, pk: { id: after['id'] }, label: String(after['id']) },
      before,
      after,
      origin: 'dashboard',
      hops: 0,
    });
    const create = async (values: Row): Promise<Row> => {
      const row = await writes.create({ target: await target('orders'), values, context: sam, announce: async () => {} });
      await producers.onRecordEvent(event('orders', null, row));
      return row;
    };
    /** A move as a screen makes it, naming the state it saw when it says so. */
    const move = async (rowId: unknown, to: string, saw?: string, context: WriteContext = sam): Promise<Row> => {
      const values = saw === undefined ? { status: to } : withSeenState(table('orders'), { status: to }, saw);
      const outcome = await writes.update({ target: await target('orders'), pk: { id: rowId }, values, context, announce: async () => {} });
      await producers.onRecordEvent(event('orders', outcome.before, outcome.after!));
      return outcome.after!;
    };
    const refusal = (run: Promise<unknown>) =>
      run.then(
        () => 'ok',
        (error: { code?: string; details?: Record<string, unknown> }) => ({ code: error.code, details: error.details }),
      );
    const row = async (rowId: unknown) => (await h.rows(`SELECT * FROM ${h.real('orders')} WHERE id = ${String(rowId)}`))[0]!;
    const readyMessages = async (rowId: unknown) =>
      (await h.rows(`SELECT status, skip_reason, due FROM ${h.real('messages')} WHERE order_id = ${String(rowId)} ORDER BY id`)).map((m) => ({
        status: String(m['status']),
        skip: (m['skip_reason'] as string | null) ?? null,
        due: slotInstant(m['due'])?.getTime() ?? null,
      }));
    const mailTo = async (address: string) =>
      (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').execute())
        .map((job) => {
          const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
          return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string };
        })
        .filter((m) => m.to === address)
        .map((m) => m.subject);

    /** An order taken to preparing by the morning's screens: confirmed by Sam. */
    const preparing = async (email: string) => {
      const order = await create({ email });
      await move(order['id'], 'confirmed', 'placed');
      await move(order['id'], 'preparing', 'confirmed');
      return order['id'];
    };

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, {}, { database: 'kitchen_undo' });
      meta = h.meta;
      await settingsRepo(meta).set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Kitchen <no-reply@kitchen.dev>',
        secure: false,
      } as never);
      const views = createPublicViews(meta);
      view = (await views.viewFor(h.connectionId))!;
      writes = createWriteService({
        sequences: documentSequencesRepo(meta),
        hooks: () => withOutboxMoves(NO_RECORD_HOOKS, { meta, outboxes: () => producers.all() }),
        watched: (connectionId, tableId) => producers.watches(connectionId, tableId),
      });
      producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
      await h.rows(`INSERT INTO ${h.real('settings')} (name) VALUES ('Kitchen')`);
    }, 180_000);

    afterAll(async () => {
      await h?.close();
    });

    it('keeps the rules as the app wrote them: the move back, the stamps it empties, the wait', async () => {
      const stored = await overridesRepo(meta).listForConnection(h.connectionId, { status: 'active' });
      const rule = (op: string, column: string | null) => stored.find((o) => o.op === op && o.tableName === table('orders').id && o.columnName === column)?.value;
      expect(rule('column.stamp', 'ready_at')).toEqual({ set: 'now', on: { column: 'status', values: ['ready'] }, clearOnBack: true });
      expect(rule('column.stamp', 'preparing_at')).toEqual({ set: 'now', on: { column: 'status', values: ['preparing'] } });
      const moves = (rule('table.states', null) as { moves: Record<string, unknown[]> }).moves;
      expect(moves['preparing']).toEqual(['ready', { to: 'confirmed', undo: true }]);
      const box = (await appOutboxesRepo(meta).list()).find((row) => row.appKey === 'studio');
      expect((JSON.parse(box!.definition) as { producers: Record<string, unknown>[] }).producers[0]).toMatchObject({ holdSeconds: 20 });
    });

    it('takes a Ready back: its stamps emptied, the others kept, the held email dropped — and Ready again sends one', async () => {
      const order = await preparing('ada@kitchen.dev');
      const before = await row(order);
      expect(before['confirmed_by']).toBe('Sam');
      const started = slotInstant(before['preparing_at'])!.getTime();

      const ready = await move(order, 'ready', 'preparing', ivy);
      expect(ready['ready_by']).toBe('Ivy');
      expect(ready['ready_at']).not.toBeNull();
      const [held] = await readyMessages(order);
      // Waiting its twenty seconds: nothing goes before then.
      expect(held!.status).toBe('queued');
      expect(held!.due! - Date.now()).toBeGreaterThan(10_000);
      await sender.sendApp('studio', Date.now());
      expect(await mailTo('ada@kitchen.dev')).toEqual([]);

      // Undo, naming the state the screen saw.
      const back = await move(order, 'preparing', 'ready', ivy);
      expect(back['status']).toBe('preparing');
      expect(back['ready_at']).toBeNull();
      expect(back['ready_by']).toBeNull();
      // The state it returns to keeps its own stamp, and the earlier ones theirs.
      expect(slotInstant(back['preparing_at'])!.getTime()).toBe(started);
      expect(back['confirmed_by']).toBe('Sam');

      // Past the hold: the message is dropped, never sent.
      await sender.sendApp('studio', Date.now() + 30_000);
      expect(await readyMessages(order)).toEqual([expect.objectContaining({ status: 'skipped', skip: 'no-longer-needed' })]);
      expect(await mailTo('ada@kitchen.dev')).toEqual([]);

      // Ready again: a fresh message (the dropped one does not stop it), sent once its hold has passed.
      await move(order, 'ready', 'preparing', sam);
      const messages = await readyMessages(order);
      expect(messages.map((m) => m.status)).toEqual(['skipped', 'queued']);
      await sender.sendApp('studio', Date.now() + 30_000);
      await sender.sendApp('studio', Date.now() + 60_000);
      expect(await mailTo('ada@kitchen.dev')).toEqual(['Your order is ready']);
      expect((await row(order))['ready_by']).toBe('Sam');
    });

    it('refuses an undo that names no state, and a stale screen’s tap that would take back another’s move', async () => {
      const order = await preparing('ben@kitchen.dev');
      await move(order, 'ready', 'preparing', ivy);

      // An undo naming nothing: refused.
      expect(await refusal(move(order, 'preparing'))).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'ready', to: 'preparing', undo: true } });
      // A screen still showing the order confirmed taps Start: it would take back the Ready. Refused, naming both.
      expect(await refusal(move(order, 'preparing', 'confirmed'))).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'ready', to: 'preparing', named: 'confirmed' } });
      // A forward move naming a state the row has left: refused too, and the row is as it was.
      expect(await refusal(move(order, 'picked_up', 'preparing'))).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'ready', named: 'preparing' } });
      const still = await row(order);
      expect(still['status']).toBe('ready');
      expect(still['ready_by']).toBe('Ivy');
    });

    it('refuses an undo after its minute, judged on the Ready as it stands', async () => {
      const order = await preparing('cal@kitchen.dev');
      await move(order, 'ready', 'preparing');
      // The Ready was two minutes ago: the stamp moved back, spelled as each engine keeps a time.
      const readyAt = table('orders').columns.get('ready_at')!;
      const { db } = await h.manager.data(h.connectionId);
      await db
        .updateTable(table('orders').id as never)
        .set({ ready_at: bindWriteValue(readyAt, new Date(Date.now() - 120_000).toISOString(), dialect) } as never)
        .where('id' as never, '=', order as never)
        .execute();
      expect(await refusal(move(order, 'preparing', 'ready'))).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'ready', to: 'preparing', requires: 'time' } });
      expect((await row(order))['status']).toBe('ready');
      expect((await row(order))['ready_at']).not.toBeNull();
    });

    it('through the data routes: a change naming the state it saw, and the dashboard’s Undo of a status move', async () => {
      const served = await servePublic(h, null);
      try {
        const cook = await usersRepo(meta).create({ email: 'cook@kitchen.dev', name: 'Cook', passwordHash: await adminPasswordHash() });
        await rolesRepo(meta).assignToUser(cook.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
        const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'cook@kitchen.dev', password: ADMIN_PASSWORD } });
        const cookie = sessionCookie(login.headers['set-cookie']);
        const url = (rowId: unknown) => `/api/v1/data/${h.connectionId}/${encodeURIComponent(table('orders').id)}/${String(rowId)}`;
        const patch = (rowId: unknown, payload: Record<string, unknown>) => served.composed.app.inject({ method: 'PATCH', url: url(rowId), headers: { cookie }, payload });

        const order = await preparing('dee@kitchen.dev');
        // A stale screen: refused, and says what it is now.
        const stale = await patch(order, { values: { status: 'ready' }, from: 'confirmed' });
        expect(stale.statusCode, stale.body).toBe(409);
        expect(stale.json()).toMatchObject({ error: { code: 'STATE_MOVE_REFUSED', details: { from: 'preparing', named: 'confirmed' } } });
        // An undo with no state named: refused.
        const unnamed = await patch(order, { values: { status: 'confirmed' } });
        expect(unnamed.statusCode, unnamed.body).toBe(409);
        expect(unnamed.json()).toMatchObject({ error: { code: 'STATE_MOVE_REFUSED', details: { undo: true } } });

        // Ready, then the dashboard's Undo: made as the listed move back.
        const ready = await patch(order, { values: { status: 'ready' }, from: 'preparing' });
        expect(ready.statusCode, ready.body).toBe(200);
        const token = (ready.json() as { undoToken: string | null }).undoToken;
        expect(token).not.toBeNull();
        expect((await row(order))['ready_by']).toBe('Cook');
        const undone = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie } });
        expect(undone.statusCode, undone.body).toBe(200);
        const after = await row(order);
        expect(after['status']).toBe('preparing');
        expect(after['ready_at']).toBeNull();
        expect(after['ready_by']).toBeNull();

        // A move the app lists no undo for is not offered one; nor is a change that also wrote something else.
        await patch(order, { values: { status: 'ready' }, from: 'preparing' });
        const picked = await patch(order, { values: { status: 'picked_up' }, from: 'ready' });
        expect(picked.statusCode, picked.body).toBe(200);
        expect((picked.json() as { undoToken: string | null }).undoToken).toBeNull();
        const other = await preparing('eve@kitchen.dev');
        const both = await patch(other, { values: { status: 'ready', note: 'extra napkins' }, from: 'preparing' });
        expect((both.json() as { undoToken: string | null }).undoToken).toBeNull();

        // An undo token whose move is no longer allowed (another screen moved the row on) is refused, and changes nothing.
        const third = await preparing('fay@kitchen.dev');
        const readied = await patch(third, { values: { status: 'ready' }, from: 'preparing' });
        const later = (readied.json() as { undoToken: string }).undoToken;
        await patch(third, { values: { status: 'picked_up' }, from: 'ready' });
        const refused = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${later}`, headers: { cookie } });
        expect(refused.statusCode, refused.body).toBe(409);
        expect((await row(third))['status']).toBe('picked_up');

        // A change naming a state on a table that keeps none is refused as it stands.
        const settingsUrl = `/api/v1/data/${h.connectionId}/${encodeURIComponent(table('settings').id)}/1`;
        const plain = await served.composed.app.inject({ method: 'PATCH', url: settingsUrl, headers: { cookie }, payload: { values: { name: 'Kitchen 2' }, from: 'open' } });
        expect(plain.statusCode, plain.body).toBe(422);
      } finally {
        await served.close();
      }
    });
  });
}
