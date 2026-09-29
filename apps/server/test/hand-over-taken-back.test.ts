// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kitchen's hand-over, its receipt and the manager taking it back, on
 * every engine this run can reach.
 *
 * The order is locked once picked up (only `link_stopped` stays open). The
 * receipt is sent only while Invoices & Receipts is attached AND the
 * manager's switch `receipt_email_on` is on (a gate of two keys), and waits
 * twenty seconds so a take-back drops it. A hand-over made by mistake is
 * taken back by the manager's move marked `undo`: its stamps
 * (`clearOnBack`) and how the order was paid (`clears`) are emptied, open to
 * the lock for that move only:
 *
 *  - the receipt goes only with the add-on attached and the switch on;
 *  - the manager's take-back empties the stamps and the payment, and drops
 *    the held receipt; a kitchen-only person is refused by the move's roles;
 *  - a value sent for what the take-back empties is refused; a stamp or the
 *    payment changed alone, or another column beside the move, is still
 *    locked; the lines stay locked while the order is picked up;
 *  - through the data routes: the staff change, an API key, the dashboard's
 *    Undo of the hand-over, a quote, and a bulk change (which names no state,
 *    so makes no take-back).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeysRepo, appOutboxesRepo, manifestsRepo, overridesRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { withSeenState } from '../src/crud/seen-state.js';
import { NO_RECORD_HOOKS, createWriteService, updateRows, type WriteContext } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { withOutboxMoves } from '../src/outbox/moves.js';
import { createOutboxProducers, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { addOnManifest } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const stamp = (ref: string, type: string, set: string) => ({
  ref,
  type,
  nullable: true,
  rules: { stamp: { set, on: { column: 'status', values: ['picked_up'] }, clearOnBack: true } },
});

export function kitchenManifest(): Record<string, unknown> {
  const tables = [
    { ref: 'settings', columns: [id, text('name'), { ref: 'receipt_email_on', type: 'bool', default: false }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        text('note'),
        { ref: 'status', type: 'enum', enum: ['placed', 'ready', 'picked_up'], default: 'placed' },
        { ref: 'paid_method', type: 'enum', enum: ['cash', 'card'], nullable: true },
        { ref: 'link_stopped', type: 'bool', default: false },
        stamp('picked_up_at', 'timestamptz', 'now'),
        stamp('picked_up_by', 'text', 'user-name'),
      ],
      states: {
        column: 'status',
        initial: 'placed',
        moves: {
          placed: ['ready'],
          ready: [{ to: 'picked_up', requires: { where: [{ column: 'paid_method', isNull: false }] } }],
          // A hand-over made by mistake: a manager takes it back, unpaid again.
          picked_up: [{ to: 'ready', roles: ['manager'], undo: true, clears: ['paid_method'] }],
        },
        lock: { when: ['picked_up'], except: ['link_stopped'] },
        children: { order_items: { via: 'order_id', lock: true } },
      },
    },
    { ref: 'order_items', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }, text('name'), { ref: 'qty', type: 'int', default: 1 }] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['order-receipt', 'order-thanks'] },
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
    roles: [
      { key: 'manager', name: 'Manager' },
      { key: 'kitchen', name: 'Kitchen' },
    ],
    pages: [{ ref: 'studio-orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Receipts.' } }],
      features: [{ id: 'receipts', requires: ['invoices'], label: { 'en-US': 'Receipts' } }],
    },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'order-receipt': 'studio-receipt', 'order-thanks': 'studio-thanks' },
      producers: [
        {
          kind: 'order-receipt',
          link: 'order_id',
          // Only with Invoices & Receipts attached, and only while the manager wants receipts sent.
          gate: { feature: 'receipts', setting: { table: 'settings', column: 'receipt_email_on' } },
          onChange: { table: 'orders', column: 'status', to: 'picked_up' },
          holdSeconds: 20,
          dropWhen: [{ column: 'status', in: ['ready'], reason: 'no-longer-needed' }],
        },
        // A gate of one key beside it: only while Invoices & Receipts is attached, whatever the switch says.
        { kind: 'order-thanks', link: 'order_id', gate: { feature: 'receipts' }, onChange: { table: 'orders', column: 'status', to: 'picked_up' } },
      ],
    },
    emailTemplates: [
      { key: 'studio-receipt', name: 'Receipt', locales: { 'en-US': { subject: 'Your receipt', blocks: [{ block: 'email.text', data: { text: 'Paid.' } }] } } },
      { key: 'studio-thanks', name: 'Thanks', locales: { 'en-US': { subject: 'Thank you', blocks: [{ block: 'email.text', data: { text: 'Thanks.' } }] } } },
    ],
  };
}

type Refusal = { code?: string; details?: Record<string, unknown> };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a hand-over taken back, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;
    let producers: OutboxProducers;
    let sender: OutboxSender;
    let view: SnapshotView;
    let writes: ReturnType<typeof createWriteService>;
    let boss: WriteContext;
    let cook: WriteContext;

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
    /** A change as a screen makes it, naming the state it saw when it says so. */
    const change = async (rowId: unknown, values: Row, saw?: string, context: WriteContext = cook): Promise<Row> => {
      const outcome = await writes.update({ target: await target('orders'), pk: { id: rowId }, values: saw === undefined ? values : withSeenState(table('orders'), values, saw), context, announce: async () => {} });
      await producers.onRecordEvent(event('orders', outcome.before, outcome.after!));
      return outcome.after!;
    };
    const refusal = (run: Promise<unknown>) =>
      run.then(
        () => 'ok',
        (error: Refusal) => ({ code: error.code, details: error.details }),
      );
    const row = async (rowId: unknown) => (await h.rows(`SELECT * FROM ${h.real('orders')} WHERE id = ${String(rowId)}`))[0]!;
    const receipts = async (rowId: unknown) =>
      (await h.rows(`SELECT status, skip_reason FROM ${h.real('messages')} WHERE order_id = ${String(rowId)} AND kind = 'order-receipt' ORDER BY id`)).map((m) => ({
        status: String(m['status']),
        skip: (m['skip_reason'] as string | null) ?? null,
      }));
    const thanks = async (rowId: unknown) =>
      Number((await h.rows(`SELECT count(*) AS n FROM ${h.real('messages')} WHERE order_id = ${String(rowId)} AND kind = 'order-thanks'`))[0]!['n']);
    const mailTo = async (address: string) =>
      (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').execute())
        .map((job) => {
          const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
          return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string };
        })
        .filter((m) => m.to === address)
        .map((m) => m.subject);
    const switchReceipts = async (on: boolean) => {
      await h.rows(`UPDATE ${h.real('settings')} SET receipt_email_on = ${on ? 'true' : 'false'}`);
    };
    /** A ready order with one line, as the pass holds it. */
    const readyOrder = async (email: string): Promise<unknown> => {
      const order = await writes.create({ target: await target('orders'), values: { email }, context: cook, announce: async () => {} });
      await producers.onRecordEvent(event('orders', null, order));
      await writes.create({ target: await target('order_items'), values: { order_id: order['id'], name: 'Soup', qty: 1 }, context: cook, announce: async () => {} });
      await change(order['id'], { status: 'ready' }, 'placed');
      return order['id'];
    };
    /** Handed over, paid in cash, by the kitchen. */
    const handOver = async (orderId: unknown) => change(orderId, { status: 'picked_up', paid_method: 'cash' }, 'ready');
    const person = async (name: string, roleKey: string): Promise<WriteContext> => {
      const user = await usersRepo(meta).create({ email: `${name.toLowerCase()}-${dialect}@kitchen.dev`, name });
      await rolesRepo(meta).assignToUser(user.id, (await rolesRepo(meta).findBySlug(`studio-${roleKey}`))!.id);
      return { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: user.id, label: name }, request: null };
    };

    beforeAll(async () => {
      h = await installInvoicing(dialect, kitchenManifest(), undefined, {}, { database: 'kitchen_handover' });
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
        ...writeStores(meta),
        hooks: () => withOutboxMoves(NO_RECORD_HOOKS, { meta, outboxes: () => producers.all() }),
        watched: (connectionId, tableId) => producers.watches(connectionId, tableId),
      });
      producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
      await h.rows(`INSERT INTO ${h.real('settings')} (name) VALUES ('Kitchen')`);
      boss = await person('Mo', 'manager');
      cook = await person('Sam', 'kitchen');
    }, 180_000);

    let served: Awaited<ReturnType<typeof servePublic>> | undefined;
    /** The whole server over the same install, started once; closing it lets go of the install's pools, so it is closed last. */
    const serve = async () => (served ??= await servePublic(h, null));
    /** A person signed in to it, holding one role, and read and change on the orders for an app role. */
    const signedIn = async (name: string, slug: string): Promise<string> => {
      const app = (await serve()).composed.app;
      const user = await usersRepo(meta).create({ email: `${name.toLowerCase()}-${dialect}@kitchen.dev`, name, passwordHash: await adminPasswordHash() });
      const role = (await rolesRepo(meta).findBySlug(slug))!;
      await rolesRepo(meta).assignToUser(user.id, role.id);
      if (slug !== 'super-admin') {
        await permissionsRepo(meta).grant(role.id, 'table', `${h.connectionId}/${table('orders').id}`, { read: true, create: false, update: true, delete: false, export: false, import: false, read_pii: false } as never);
      }
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      return sessionCookie(login.headers['set-cookie']);
    };
    const url = (rowId: unknown, suffix = '') => `/api/v1/data/${h.connectionId}/${encodeURIComponent(table('orders').id)}/${String(rowId)}${suffix}`;

    afterAll(async () => {
      await served?.close();
      await h?.close();
    });

    it('keeps the rules as the app wrote them: a gate of two keys, and the move back with what it empties', async () => {
      const box = (await appOutboxesRepo(meta).list()).find((stored) => stored.appKey === 'studio');
      const [producer] = (JSON.parse(box!.definition) as { producers: Record<string, unknown>[] }).producers;
      expect(producer!['gate']).toEqual({ feature: 'receipts', setting: { table: table('settings').id, column: 'receipt_email_on' } });
      const stored = await overridesRepo(meta).listForConnection(h.connectionId, { status: 'active' });
      const states = stored.find((o) => o.op === 'table.states' && o.tableName === table('orders').id)?.value as { moves: Record<string, unknown[]> };
      expect(states.moves['picked_up']).toEqual([{ to: 'ready', roles: ['studio-manager'], undo: true, clears: ['paid_method'] }]);
      expect(table('orders').table?.states?.moves['picked_up']).toEqual([{ to: 'ready', roles: ['studio-manager'], undo: true, clears: ['paid_method'] }]);
    });

    it('queues a receipt only while Invoices & Receipts is attached and the switch is on', async () => {
      // Switched on, no add-on: nothing.
      await switchReceipts(true);
      const detached = await readyOrder('ada@kitchen.dev');
      await handOver(detached);
      expect(await receipts(detached)).toEqual([]);
      expect(await thanks(detached)).toBe(0);

      await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
        manifestKey: 'invoices',
        version: '1.0.0',
        kind: 'add-on',
        source: 'file',
        document: addOnManifest('invoices', { addOn: { attaches: [{ app: 'studio' }], slots: [] } }),
        attachTo: ['studio'],
      });
      // Attached, switched off: nothing.
      await switchReceipts(false);
      const off = await readyOrder('ben@kitchen.dev');
      await handOver(off);
      expect(await receipts(off)).toEqual([]);
      // The gate of one key reads the feature alone.
      expect(await thanks(off)).toBe(1);

      // Attached and switched on: one, held.
      await switchReceipts(true);
      const on = await readyOrder('cal@kitchen.dev');
      await handOver(on);
      expect(await receipts(on)).toEqual([{ status: 'queued', skip: null }]);
      expect(await thanks(on)).toBe(1);

      // Switched off again, still attached: the next hand-over queues nothing.
      await switchReceipts(false);
      const later = await readyOrder('dan@kitchen.dev');
      await handOver(later);
      expect(await receipts(later)).toEqual([]);
      await switchReceipts(true);
    });

    it("takes a hand-over back for the manager: ready, unpaid, its stamps empty, the held receipt dropped", async () => {
      const order = await readyOrder('eve@kitchen.dev');
      const handed = await handOver(order);
      expect(handed['picked_up_by']).toBe('Sam');
      expect(handed['picked_up_at']).not.toBeNull();
      expect(await receipts(order)).toEqual([{ status: 'queued', skip: null }]);

      // The kitchen's screen sends the payment emptied, naming the state it saw.
      const back = await change(order, { status: 'ready', paid_method: null }, 'picked_up', boss);
      expect([back['status'], back['paid_method'], back['picked_up_at'], back['picked_up_by']]).toEqual(['ready', null, null, null]);
      expect(await row(order)).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null, picked_up_by: null });

      // Past the hold: dropped, never sent.
      await sender.sendApp('studio', Date.now() + 30_000);
      expect(await receipts(order)).toEqual([{ status: 'skipped', skip: 'no-longer-needed' }]);
      expect((await mailTo('eve@kitchen.dev')).filter((subject) => subject === 'Your receipt')).toEqual([]);

      // Handed over again (card this time): a fresh receipt, the dropped one does not stop it.
      await change(order, { status: 'picked_up', paid_method: 'card' }, 'ready');
      expect((await receipts(order)).map((m) => m.status)).toEqual(['skipped', 'queued']);

      // A take-back naming only the state: the payment is emptied all the same.
      const again = await change(order, { status: 'ready' }, 'picked_up', boss);
      expect([again['status'], again['paid_method'], again['picked_up_at'], again['picked_up_by']]).toEqual(['ready', null, null, null]);
    });

    it("refuses the kitchen's take-back, a payment sent with it, and whatever the lock holds besides", async () => {
      const order = await readyOrder('fay@kitchen.dev');
      await handOver(order);
      const [line] = await h.rows(`SELECT id FROM ${h.real('order_items')} WHERE order_id = ${String(order)}`);

      // A kitchen-only person: refused by the move's roles.
      expect(await refusal(change(order, { status: 'ready', paid_method: null }, 'picked_up', cook))).toMatchObject({
        code: 'STATE_MOVE_REFUSED',
        details: { from: 'picked_up', to: 'ready', roles: ['studio-manager'] },
      });
      // The manager, sending a payment the take-back empties: refused, naming it.
      expect(await refusal(change(order, { status: 'ready', paid_method: 'card' }, 'picked_up', boss))).toMatchObject({
        code: 'STATE_MOVE_REFUSED',
        details: { from: 'picked_up', to: 'ready', clears: 'paid_method' },
      });
      // The payment changed alone: the lock holds.
      expect(await refusal(change(order, { paid_method: null }, undefined, boss))).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'paid_method' } });
      // A stamp is never a staff writer's to write (the value is left out); an import that writes one alone meets the lock.
      await change(order, { picked_up_at: null }, undefined, boss);
      expect((await row(order))['picked_up_at']).not.toBeNull();
      const imported: WriteContext = { ...boss, origin: 'import' };
      expect(await refusal(change(order, { picked_up_at: null }, undefined, imported))).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'picked_up_at' } });
      expect(await refusal(change(order, { picked_up_by: 'Mo' }, undefined, imported))).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'picked_up_by' } });
      // An import's take-back opens what the move empties to being emptied, never to another value.
      expect(await refusal(change(order, { status: 'ready', paid_method: null, picked_up_by: 'Mo' }, 'picked_up', imported))).toMatchObject({
        code: 'RECORD_LOCKED',
        details: { column: 'picked_up_by' },
      });
      // Nor does the take-back open anything else it does not empty.
      expect(await refusal(change(order, { status: 'ready', note: 'fixed', paid_method: null }, 'picked_up', boss))).toMatchObject({ code: 'RECORD_LOCKED', details: { column: 'note' } });
      // The lines stay locked while it is picked up.
      expect(await refusal(writes.update({ target: await target('order_items'), pk: { id: line!['id'] }, values: { qty: 2 }, context: boss, announce: async () => {} }))).toMatchObject({
        code: 'RECORD_LOCKED',
      });
      // The column the lock leaves open is open, as before.
      await change(order, { link_stopped: true }, undefined, boss);
      const still = await row(order);
      expect(still['status']).toBe('picked_up');
      expect(still['paid_method']).toBe('cash');
      expect(still['picked_up_by']).toBe('Sam');
      expect(await receipts(order)).toEqual([{ status: 'queued', skip: null }]);
    });

    it('closes both gates while the add-on is switched off or detached, and opens them again with it', async () => {
      const manifests = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
      const invoices = (await manifests.findByKey('invoices'))!;
      const handedOver = async (email: string) => {
        const order = await readyOrder(email);
        await handOver(order);
        return { receipts: (await receipts(order)).length, thanks: await thanks(order) };
      };
      // Switched off, by its row: neither gate is open.
      await manifests.setStatus(invoices.row.id, 'disabled');
      expect(await handedOver('hal@kitchen.dev')).toEqual({ receipts: 0, thanks: 0 });
      // On again: both.
      await manifests.setStatus(invoices.row.id, 'installed');
      expect(await handedOver('ida@kitchen.dev')).toEqual({ receipts: 1, thanks: 1 });
      // Detached: neither.
      expect(await manifests.detachHost('studio')).toBe(1);
      expect(await handedOver('jo@kitchen.dev')).toEqual({ receipts: 0, thanks: 0 });
    });

    it('starts a take-back again when the row moved between the read its rules were decided on and the write', async () => {
      const order = await readyOrder('kim@kitchen.dev');
      // Decided on the row as it stands, ready: nothing to empty.
      const orders = await target('orders');
      const [prepared] = await writes.beforeEach('update', orders, boss, [{ match: { id: order }, values: withSeenState(table('orders'), { status: 'ready' }, 'picked_up') }]);
      // Meanwhile another screen hands it over.
      await handOver(order);
      expect(await refusal(updateRows(orders.db, orders.dialect, orders.table, prepared!.values, { id: order }))).toMatchObject({ code: 'WRITE_CONFLICT', details: { retry: true } });
      expect(await row(order)).toMatchObject({ status: 'picked_up', paid_method: 'cash' });
    });

    it('through the data routes: the staff change, an API key, the dashboard’s Undo of the hand-over, a quote and a bulk change', async () => {
      const served = await serve();
      {
        const cookie = await signedIn('Owner', 'super-admin');
        const patch = (rowId: unknown, payload: Record<string, unknown>, headers: Record<string, string> = { cookie }) =>
          served.composed.app.inject({ method: 'PATCH', url: url(rowId), headers, payload });

        // The staff change: hand over, then take it back.
        const order = await readyOrder('gus@kitchen.dev');
        const handed = await patch(order, { values: { status: 'picked_up', paid_method: 'cash' }, from: 'ready' });
        expect(handed.statusCode, handed.body).toBe(200);
        const valued = await patch(order, { values: { status: 'ready', paid_method: 'card' }, from: 'picked_up' });
        expect(valued.statusCode, valued.body).toBe(409);
        expect(valued.json()).toMatchObject({ error: { code: 'STATE_MOVE_REFUSED', details: { clears: 'paid_method' } } });
        // A stamp sent alone is not the writer's to write: nothing changes.
        const stampAlone = await patch(order, { values: { picked_up_at: null } });
        expect(stampAlone.statusCode, stampAlone.body).toBe(200);
        expect((await row(order))['picked_up_at']).not.toBeNull();
        const payAlone = await patch(order, { values: { paid_method: null } });
        expect(payAlone.statusCode, payAlone.body).toBe(409);
        expect(payAlone.json()).toMatchObject({ error: { code: 'RECORD_LOCKED', details: { column: 'paid_method' } } });
        // A quote of the take-back: what it would leave, nothing written.
        const quote = await served.composed.app.inject({ method: 'POST', url: url(order, '/dry-run'), headers: { cookie }, payload: { values: { status: 'ready', paid_method: null }, from: 'picked_up' } });
        expect(quote.statusCode, quote.body).toBe(200);
        expect((quote.json() as { data: Row }).data).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null });
        expect((await row(order))['status']).toBe('picked_up');
        // A bulk change names no state it saw, so it makes no take-back.
        const bulk = await served.composed.app.inject({
          method: 'POST',
          url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table('orders').id)}/bulk`,
          headers: { cookie },
          payload: { action: 'update', ids: [String(order)], values: { status: 'ready', paid_method: null } },
        });
        expect(bulk.statusCode, bulk.body).toBe(409);
        expect(bulk.json()).toMatchObject({ error: { code: 'STATE_MOVE_REFUSED', details: { undo: true } } });
        expect(await row(order)).toMatchObject({ status: 'picked_up', paid_method: 'cash' });
        const back = await patch(order, { values: { status: 'ready', paid_method: null }, from: 'picked_up' });
        expect(back.statusCode, back.body).toBe(200);
        expect(await row(order)).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null, picked_up_by: null });

        // An API key holding the manager's role.
        const manager = (await rolesRepo(meta).findBySlug('studio-manager'))!;
        await permissionsRepo(meta).grant(manager.id, 'table', `${h.connectionId}/${table('orders').id}`, { read: true, create: false, update: true, delete: false, export: false, import: false, read_pii: false } as never);
        const generated = generateApiKey();
        await apiKeysRepo(meta).create({ name: 'pass tablet', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: manager.id });
        const bearer = { authorization: `Bearer ${generated.key}` };
        await handOver(order);
        const byKey = await patch(order, { values: { status: 'ready', paid_method: null }, from: 'picked_up' }, bearer);
        expect(byKey.statusCode, byKey.body).toBe(200);
        expect(await row(order)).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null, picked_up_by: null });

        // The dashboard's Undo of the hand-over: made as the listed move back, the payment emptied with it.
        const undoable = await patch(order, { values: { status: 'picked_up', paid_method: 'cash' }, from: 'ready' });
        expect(undoable.statusCode, undoable.body).toBe(200);
        const token = (undoable.json() as { undoToken: string | null }).undoToken;
        expect(token).not.toBeNull();
        const undone = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie } });
        expect(undone.statusCode, undone.body).toBe(200);
        expect(await row(order)).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null, picked_up_by: null });

        // A hand-over that changed a payment already there has no Undo: the move back would lose it.
        await patch(order, { values: { paid_method: 'card' } });
        const changedPay = await patch(order, { values: { status: 'picked_up', paid_method: 'cash' }, from: 'ready' });
        expect(changedPay.statusCode, changedPay.body).toBe(200);
        expect((changedPay.json() as { undoToken: string | null }).undoToken).toBeNull();
        // One that kept it has one.
        await patch(order, { values: { status: 'ready' }, from: 'picked_up' });
        await patch(order, { values: { paid_method: 'card' } });
        const kept = await patch(order, { values: { status: 'picked_up' }, from: 'ready' });
        expect((kept.json() as { undoToken: string | null }).undoToken).not.toBeNull();
      }
    });

    it('offers the Undo of a hand-over only to a person who may make the move back', async () => {
      const app = (await serve()).composed.app;
      const patch = (rowId: unknown, payload: Record<string, unknown>, cookie: string) => app.inject({ method: 'PATCH', url: url(rowId), headers: { cookie }, payload });
      const tokenOf = (reply: { json: () => unknown }) => (reply.json() as { undoToken: string | null }).undoToken;
      // The kitchen hands over: no Undo, since only a manager takes a hand-over back.
      const kitchen = await signedIn('Lee', 'studio-kitchen');
      const byKitchen = await readyOrder('lee@kitchen.dev');
      const handed = await patch(byKitchen, { values: { status: 'picked_up', paid_method: 'cash' }, from: 'ready' }, kitchen);
      expect(handed.statusCode, handed.body).toBe(200);
      expect(tokenOf(handed)).toBeNull();
      // A manager's hand-over is offered one, and it is made.
      const manager = await signedIn('Max', 'studio-manager');
      const byManager = await readyOrder('max@kitchen.dev');
      const offered = await patch(byManager, { values: { status: 'picked_up', paid_method: 'card' }, from: 'ready' }, manager);
      expect(offered.statusCode, offered.body).toBe(200);
      expect(tokenOf(offered)).not.toBeNull();
      const undone = await app.inject({ method: 'POST', url: `/api/v1/data/undo/${tokenOf(offered)!}`, headers: { cookie: manager } });
      expect(undone.statusCode, undone.body).toBe(200);
      expect(await row(byManager)).toMatchObject({ status: 'ready', paid_method: null, picked_up_at: null, picked_up_by: null });
    });

    it('saves no states rule in Studio whose undo empties what the manifest would refuse, and the take-back works after one it keeps', async () => {
      const app = (await serve()).composed.app;
      const cookie = await signedIn('Pat', 'super-admin');
      const overridesUrl = `/api/v1/connections/${h.connectionId}/overrides`;
      const got = await app.inject({ method: 'GET', url: overridesUrl, headers: { cookie } });
      expect(got.statusCode, got.body).toBe(200);
      const listed = ((got.json() as { overrides?: Record<string, unknown>[]; data?: Record<string, unknown>[] }).overrides ?? (got.json() as { data: Record<string, unknown>[] }).data) as Record<string, unknown>[];
      const items = listed.map((item) => ({ op: item['op'], tableName: item['tableName'], ...(item['columnName'] == null ? {} : { columnName: item['columnName'] }), value: item['value'], ...(item['status'] === 'disabled' ? { status: 'disabled' } : {}) }));
      const statesItem = items.find((item) => item.op === 'table.states' && item.tableName === table('orders').id)!;
      const put = (pickedUp: unknown[]) => {
        const value = JSON.parse(JSON.stringify(statesItem.value)) as { moves: Record<string, unknown[]> };
        value.moves['picked_up'] = pickedUp;
        return app.inject({ method: 'PUT', url: overridesUrl, headers: { cookie }, payload: { overrides: items.map((item) => (item === statesItem ? { ...item, value } : item)) } });
      };
      const back = (clears: unknown[]) => [{ to: 'ready', roles: ['studio-manager'], undo: true, clears }];
      const refused: [unknown[], string][] = [
        [back(['nope']), 'has no column "nope"'],
        [back(['picked_up_at']), 'is written by another rule already'],
        [back(['note', 'note']), '"note" is named twice'],
        [back(['status']), 'not by what it empties'],
        [back(['id']), 'is the key, which never changes'],
        [back(['link_stopped']), 'is not nullable, so an undo cannot empty it'],
        [[{ to: 'ready', roles: ['studio-kitchen'] }, ...back(['paid_method'])], 'comes first, so this one is never made'],
      ];
      for (const [pickedUp, sentence] of refused) {
        const reply = await put(pickedUp);
        expect(reply.statusCode, `${JSON.stringify(pickedUp)} ${reply.body}`).toBe(422);
        expect((reply.json() as { error: { message: string } }).error.message).toContain(sentence);
      }
      // Nothing of them was kept: the move back is the app's still.
      expect(table('orders').table?.states?.moves['picked_up']).toEqual(back(['paid_method']));
      // One it keeps: the note emptied beside the payment.
      const kept = await put(back(['paid_method', 'note']));
      expect(kept.statusCode, kept.body).toBe(200);
      const order = await readyOrder('pat@kitchen.dev');
      const noted = await app.inject({ method: 'PATCH', url: url(order), headers: { cookie }, payload: { values: { note: 'no onions' } } });
      expect(noted.statusCode, noted.body).toBe(200);
      const handed = await app.inject({ method: 'PATCH', url: url(order), headers: { cookie }, payload: { values: { status: 'picked_up', paid_method: 'cash' }, from: 'ready' } });
      expect(handed.statusCode, handed.body).toBe(200);
      const taken = await app.inject({ method: 'PATCH', url: url(order), headers: { cookie }, payload: { values: { status: 'ready' }, from: 'picked_up' } });
      expect(taken.statusCode, taken.body).toBe(200);
      expect(await row(order)).toMatchObject({ status: 'ready', paid_method: null, note: null, picked_up_at: null });
    });

  });
}
