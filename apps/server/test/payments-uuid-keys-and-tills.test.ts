// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP WHOSE ROWS ARE KEYED BY A UUID, AND A TILL'S CASHIER WHO OPENS ONLY
 * THE APP'S SCREENS, on SQLite, Postgres and MySQL, with Point of Sale's own
 * manifest and with a scratch app.
 *
 *  - A uuid key is kept as text on SQLite and as char(36) on MySQL, so the
 *    snapshot reads a plain text key. Every row Adminium writes itself — a
 *    payment taken online, a refund row, a mail in the outbox — and every
 *    create that sends no key, gets a new uuid, as Postgres's uuid key does:
 *    before, MySQL refused the payment and SQLite wrote a row with no key.
 *  - A screens-only cashier takes a payment at the counter: the card readers,
 *    a charge, a ticket's pay link (the same open link each time it is asked,
 *    with or without a chosen pay address) — each still asking the
 *    cashier's own rights on the ticket. A refund still asks the refund
 *    right; Payments' own settings stay the dashboard's.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { jobsRepo, payableProfilesRepo, paymentAttemptsRepo, type PaymentAttempt } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createPayableSources } from '../src/payments/payables.js';
import { enqueueRecord, recordAttempt } from '../src/payments/record.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.62' }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidKey = { ref: 'id', type: 'uuid', role: 'pk' };
const intKey = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

/** Point of Sale's own manifest, from its lane, when that checkout is here. */
function posManifest(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(homedir(), 'Work/lanes/p72-pos/manifest.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A till: tickets keyed by number, and payments, refunds and mails keyed by a uuid. */
function till(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'till',
    name: 'Till',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.till.desc', fallback: 'A till.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.61', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'till', label: { 'en-US': 'Till' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [intKey, text('name', 80)] },
        {
          ref: 'tickets',
          columns: [
            intKey,
            text('number', 40),
            text('email', 200),
            { ref: 'total', type: 'money', default: 0 },
            { ref: 'paid', type: 'money', nullable: true, rules: { rollup: { from: 'payments', via: 'ticket_id', sum: 'amount', balance: { column: 'due', of: 'total' } } } },
            { ref: 'due', type: 'money', nullable: true },
            { ref: 'status', type: 'enum', enum: ['open', 'paid'], default: 'open' },
          ],
        },
        {
          ref: 'payments',
          columns: [
            uuidKey,
            { ref: 'ticket_id', type: 'fk', references: 'tickets' },
            { ref: 'amount', type: 'money', default: 0 },
            { ref: 'paid_at', type: 'timestamptz', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
          ],
        },
        {
          ref: 'refunds',
          columns: [uuidKey, { ref: 'payment_id', type: 'fk', references: 'payments' }, { ref: 'amount', type: 'money', default: 0 }, { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, text('refund_ref', 255), text('refund_state', 16)],
        },
        {
          ref: 'messages',
          columns: [
            uuidKey,
            { ref: 'kind', type: 'enum', enum: ['ticket-paid'] },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'ticket_id', type: 'fk', references: 'tickets', nullable: true },
            text('error', 200),
            text('skip_reason', 40),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [
      // At the counter: reads and sells tickets, takes payments, refunds nothing.
      { key: 'cashier', name: 'Cashier', screensOnly: true, permissions: ['app:@:staff', 'table:@tickets:read', 'table:@tickets:update', 'table:@payments:read', 'table:@payments:create'] },
      // Reads tickets only.
      { key: 'runner', name: 'Runner', screensOnly: true, permissions: ['app:@:staff', 'table:@tickets:read'] },
    ],
    pages: [{ ref: 'till-tickets', template: 'page-crud', title: { key: 't.tickets', fallback: 'Tickets' }, nav: { group: 'till', icon: 'list', order: 1 }, bindings: { rows: 'tickets' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at' },
      links: { ticket: 'ticket_id' },
      recipient: { via: 'ticket_id', table: 'tickets', email: 'email', name: 'number' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'ticket-paid': 'till-ticket-paid' },
      classes: { 'ticket-paid': 'service' },
      producers: [{ kind: 'ticket-paid', link: 'ticket_id', onChange: { table: 'tickets', column: 'status', to: 'paid' } }],
    },
    emailTemplates: [{ key: 'till-ticket-paid', name: 'till-ticket-paid', locales: { 'en-US': { subject: 'Ticket {{ticket.number}} is paid', blocks: [{ block: 'email.text', data: { text: 'Thank you.' } }] } } }],
    payments: {
      payables: [
        {
          table: 'tickets',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'due' },
          payments: { kind: 'table', table: 'payments', link: 'ticket_id', amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref' },
          status: { column: 'status', paid: 'paid', from: ['open'] },
          payableWhen: [{ column: 'status', eq: 'open' }],
          refunds: { model: 'rows', table: 'refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'refund_ref', state: 'refund_state' },
        },
      ],
    },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** A payment the service took for a record: live, by card. */
async function paidOnline(s: WholeServer, tableName: string, key: string, amount: string, n: string): Promise<PaymentAttempt> {
  const attempts = paymentAttemptsRepo(s.meta);
  const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName, rowKey: key };
  const attempt = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: `T-${key}`, amount, currency: 'EUR', linkId: null, nonce: `nonce-${s.dialect}-${n}`.padEnd(22, 'x'), createdBy: null }))!;
  await attempts.move(attempt.id, 'open', { providerRef: `cs_${s.dialect}_${n}` });
  await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_${s.dialect}_${n}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
  return attempt;
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a till's uuid keys and its cashier [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const target = async (ref: string): Promise<WriteTarget> => {
      const view = (await createPublicViews(s.meta).viewFor(s.connectionId))!;
      const handle = await s.manager.data(s.connectionId);
      return { connectionId: s.connectionId, view, table: view.table(s.t(ref)), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
    };
    const system: WriteContext = { origin: 'payment', hops: 0, actor: { kind: 'system', id: null, label: 'Refund' }, request: null };

    beforeAll(async () => {
      s = await wholeServer(dialect, till(), { smtp: true, people: { cara: ['cashier'], rex: ['runner'] } });
      await s.rows(`INSERT INTO ${real('settings')} (id, name) VALUES (1, 'Till')`);
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      await payableProfilesRepo(s.meta).update(profile!.id, { enabled: true });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('writes a payment taken online with a new uuid key, moves the ticket, and its mail goes with one too', async () => {
      await s.rows(`INSERT INTO ${real('tickets')} (id, number, email, total, due, status) VALUES (1, 'T-1', 'ada@crumbandco.de', 12.50, 12.50, 'open')`);
      const attempt = await paidOnline(s, s.t('tickets'), '1', '12.50', 'u1');
      expect(await recordAttempt({ meta: s.meta, sources: createPayableSources({ meta: s.meta, manager: s.manager }), app: s.app }, attempt.id)).toMatchObject({ state: 'recorded' });
      const rows = await s.rows(`SELECT id, payment_ref FROM ${real('payments')} WHERE ticket_id = 1`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!['id'])).toMatch(UUID);
      expect((await s.rows(`SELECT status FROM ${real('tickets')} WHERE id = 1`))[0]).toMatchObject({ status: 'paid' });
      await s.jobs();
      expect((await s.emails()).map((mail) => mail.subject)).toEqual(['Ticket T-1 is paid']);
      const mails = await s.rows(`SELECT id FROM ${real('messages')} WHERE ticket_id = 1`);
      expect(mails).toHaveLength(1);
      expect(String(mails[0]!['id'])).toMatch(UUID);
    });

    it('gives a refund row Adminium writes, and a create that sends no key, a uuid of their own', async () => {
      const [payment] = await s.rows(`SELECT id FROM ${real('payments')} WHERE ticket_id = 1`);
      const writes = createWriteService(writeStores(s.meta));
      const refund = await writes.create({ target: await target('refunds'), values: { payment_id: payment!['id'], amount: '2.50', method: 'online', refund_state: 'asked' }, context: system, announce: async () => {} });
      expect(String(refund['id'])).toMatch(UUID);
      // A person's create through the data routes, with no key sent: one is made, never a row without.
      await s.rows(`INSERT INTO ${real('tickets')} (id, number, total, due, status) VALUES (2, 'T-2', 4.00, 4.00, 'open')`);
      const made = await s.make('cara', 'payments', { ticket_id: 2, amount: '4.00', method: 'cash' });
      expect(said(made), made.body).toBe('ok');
      const keys = (await s.rows(`SELECT id FROM ${real('payments')} WHERE ticket_id = 2`)).map((row) => String(row['id']));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(UUID);
    });

    it('lets the screens-only cashier take a payment at the counter, under their own rights on the ticket', async () => {
      await s.rows(`INSERT INTO ${real('tickets')} (id, number, total, due, status) VALUES (3, 'T-3', 9.00, 9.00, 'open')`);
      const payable = { kind: 'profile', connectionId: s.connectionId, tableName: s.t('tickets'), rowKey: '3' };
      const code = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;
      // The readers to send an amount to.
      const readers = await s.get('cara', '/api/v1/payments/terminal/readers');
      expect(said(readers), readers.body).toBe('ok');
      // A charge on a reader: past the screens-only gate, refused by the route for the reader that is not there.
      const charge = await s.send('cara', 'POST', '/api/v1/payments/terminal/charge', { connectionId: s.connectionId, table: s.t('tickets'), recordId: '3', readerId: 'prd_none' });
      expect(code(charge), charge.body).not.toBe('APP_SCREENS_ONLY');
      expect(said(charge)).not.toMatch(/^403/);
      expect(code(await s.get('cara', '/api/v1/payments/terminal/charges/pat_none'))).not.toBe('APP_SCREENS_ONLY');
      // The ticket's pay link: made, then the same open link each time it is asked, with no pay address chosen.
      const minted = await s.send('cara', 'POST', '/api/v1/payments/links', payable);
      expect(said(minted), minted.body).toBe('ok');
      const link = (minted.json() as { data: { link: { id: string; url: string } } }).data.link;
      for (let ask = 0; ask < 2; ask += 1) {
        const current = await s.send('cara', 'POST', '/api/v1/payments/links/current', payable);
        expect(said(current), current.body).toBe('ok');
        expect((current.json() as { data: { id: string; url: string } | null }).data).toMatchObject({ id: link.id, url: link.url });
      }
      // What the ticket's payments are.
      expect(said(await s.send('cara', 'POST', '/api/v1/payments/panel', { connectionId: s.connectionId, table: s.t('tickets'), recordId: '3' }))).toBe('ok');
    });

    it('still asks the cashier\'s own rights, the refund right for a refund, and keeps Payments\' settings the dashboard\'s', async () => {
      const code = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;
      const payable = { kind: 'profile', connectionId: s.connectionId, tableName: s.t('tickets'), rowKey: '3' };
      // A runner reads tickets but adds no payment and changes none: no charge, no pay link.
      const charge = await s.send('rex', 'POST', '/api/v1/payments/terminal/charge', { connectionId: s.connectionId, table: s.t('tickets'), recordId: '3', readerId: 'prd_none' });
      expect(said(charge), charge.body).toBe('403 TABLE_FORBIDDEN');
      expect(said(await s.send('rex', 'POST', '/api/v1/payments/links', payable))).toBe('403 TABLE_FORBIDDEN');
      // A refund: past the gate, refused for want of the refund right.
      const [paid] = await paymentAttemptsRepo(s.meta).forPayable({ kind: 'profile', connectionId: s.connectionId, tableName: s.t('tickets'), rowKey: '1' });
      const preview = await s.get('cara', `/api/v1/payments/attempts/${paid!.id}/refund`);
      expect(said(preview), preview.body).toBe('403 FORBIDDEN');
      // Pairing a reader, the pay address, the Studio's reader list: the dashboard's alone.
      for (const url of ['/api/v1/payments/readers', '/api/v1/payments/pay-address', '/api/v1/payments/activity', '/api/v1/payments/ways']) {
        expect(code(await s.get('cara', url)), url).toBe('APP_SCREENS_ONLY');
      }
    });
  });
}

const pos = posManifest();
for (const [dialect, available] of LEGS) {
  describe.skipIf(!available || pos === null)(`Point of Sale's own manifest: a payment into its uuid-keyed payments [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);

    beforeAll(async () => {
      s = await wholeServer(dialect, pos!, { people: { cara: ['cashier'] } });
      await s.meta.db.updateTable('adminium_connections').set({ currency: 'EUR' }).where('id', '=', s.connectionId).execute();
      const profiles = await payableProfilesRepo(s.meta).list(s.connectionId);
      for (const profile of profiles) await payableProfilesRepo(s.meta).update(profile.id, { enabled: true });
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('writes the till\'s online payment with a uuid key, and the ticket owes nothing more', async () => {
      const tickets = real('tickets');
      await s.rows(`INSERT INTO ${tickets} (number, subtotal, total, due, status) VALUES ('P-1', 6.00, 6.00, 6.00, 'open')`);
      const [ticket] = await s.rows(`SELECT id FROM ${tickets} WHERE number = 'P-1'`);
      // One item on it, so the ticket's own figures come to what was paid when the payment settles them.
      await s.rows(`INSERT INTO ${real('ticket_items')} (ticket_id, name, qty, unit_price) VALUES (${String(ticket!['id'])}, 'Flat white', 1, 6.00)`);
      const attempt = await paidOnline(s, s.t('tickets'), String(ticket!['id']), '6.00', 'pos1');
      // Recorded by the server's own job, through its own writes (the till's postings asked of its ledgers, none here).
      await enqueueRecord((input) => jobsRepo(s.meta).enqueue(input), attempt.id);
      await s.jobs();
      const after = (await paymentAttemptsRepo(s.meta).byId(attempt.id))!;
      expect(after.state, JSON.stringify(after.problem)).toBe('recorded');
      const rows = await s.rows(`SELECT id FROM ${real('payments')} WHERE payment_ref = '${attempt.id}'`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!['id'])).toMatch(UUID);
      // The cashier, screens-only, reads the readers and the ticket's payments.
      expect(said(await s.get('cara', '/api/v1/payments/terminal/readers'))).toBe('ok');
      expect(said(await s.send('cara', 'POST', '/api/v1/payments/panel', { connectionId: s.connectionId, table: s.t('tickets'), recordId: String(ticket!['id']) }))).toBe('ok');
    });
  });
}
