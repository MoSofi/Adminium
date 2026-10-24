// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Activity: every attempt and refund, the ones that need a look flagged by
 * what happened, "Mark as checked" kept with its note, a badge of what is
 * still open, and a CSV a spreadsheet cannot be tricked by. A bookkeeper
 * with payments.view reads and exports, and acts on nothing.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, paymentAttemptsRepo, permissionsRepo, refundsRepo, rolesRepo, usersRepo, type AttemptState, type MetaDb, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentActivityRoutes } from '../src/routes/payments/activity.js';

describe('payments activity', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let bookkeeper: User;
  const as = (user: User) => ({ 'x-test-user-id': user.id });
  let seq = 0;

  async function attempt(path: AttemptState[], patch: Record<string, unknown> = {}, label = 'INV-0042'): Promise<string> {
    seq += 1;
    const repo = paymentAttemptsRepo(meta);
    const made = (await repo.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct_1', payable: { kind: 'document', connectionId: null, tableName: null, rowKey: `doc_${seq}` }, payableLabel: label, amount: '120.00', currency: 'EUR', linkId: null, nonce: `n${seq}`.padEnd(22, 'x'), createdBy: null }, 1000 + seq))!;
    for (const to of path) await repo.move(made.id, to, to === path.at(-1) ? patch : {}, 1000 + seq);
    return made.id;
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const books = await roles.create({ slug: 'books', name: 'Bookkeeper' });
    await permissionsRepo(meta).grant(books.id, 'system', 'payments.view', { allowed: true });
    bookkeeper = await users.create({ email: 'ines@adminium.test', name: 'Ines', status: 'active' });
    await roles.assignToUser(bookkeeper.id, books.id);

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(paymentActivityRoutes({ meta })), { prefix: '/api/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const REFUSED: AttemptState[] = ['open', 'succeeded', 'recording', 'record_refused'];

  it('flags each row by what happened, and leaves a recorded payment alone', async () => {
    await attempt(['open', 'succeeded', 'recording', 'recorded']);
    await attempt(REFUSED, { problem: { code: 'AMOUNT_DIFFERS', message: 'Stripe took 100.00 EUR; 120.00 was asked.' } });
    await attempt(REFUSED, { problem: { code: 'VOIDED', message: 'This invoice was voided.' } });
    await attempt(REFUSED, { problem: { code: 'VALIDATION_FAILED', message: 'The table refused the row.' } });
    await refundsRepo(meta).create({ attemptId: null, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: 'pi_1', amount: '20.00', currency: 'EUR', reason: 'requested_by_customer', note: null, idempotencyKey: 'provider:re_1', source: 'provider', requestedBy: null, state: 'succeeded', providerRefundId: 're_1' });
    const listed = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(owner) })).json().data.rows;
    expect(listed.map((row: { flag: { code: string } | null }) => row.flag?.code ?? null).sort()).toEqual([null, 'amount-differs', 'paid-not-recorded', 'payable-voided', 'refunded-at-provider'].sort((a, b) => String(a).localeCompare(String(b))));
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(4);
  });

  it('keeps who checked a flag and what they found, and asks for a note where it matters', async () => {
    const id = await attempt(REFUSED, { problem: { code: 'VOIDED', message: 'This invoice was voided.' } });
    const noNote = await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(owner), payload: { note: '' } });
    expect(noNote.statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(owner), payload: { note: 'Refunded by bank transfer on 22 Oct.' } })).statusCode).toBe(204);
    const row = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(owner) })).json().data.rows[0];
    expect(row.check).toMatchObject({ by: owner.id, note: 'Refunded by bank transfer on 22 Oct.' });
    expect(row.flag.code).toBe('payable-voided');
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(owner), payload: { note: 'again' } })).statusCode).toBe(409);
  });

  it('lets a bookkeeper read and export, and act on nothing', async () => {
    const id = await attempt(REFUSED, { problem: { code: 'AMOUNT_DIFFERS', message: 'x' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(bookkeeper) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity.csv', headers: as(bookkeeper) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(bookkeeper), payload: { note: 'ok' } })).statusCode).toBe(403);
  });

  it('writes a CSV no spreadsheet reads as a formula', async () => {
    await attempt(['open', 'succeeded', 'recording', 'recorded'], {}, '=HYPERLINK("https://evil.test","pay")');
    const csv = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity.csv', headers: as(owner) })).payload;
    const [header, line] = csv.trim().split('\r\n');
    expect(header).toBe('when,kind,service,mode,record,amount,currency,state,paid with,needs a look,checked,note');
    expect(line).toContain(`"'=HYPERLINK(""https://evil.test"",""pay"")"`);
  });

  it('finds a row that needs a look behind any number of newer ones, and counts every one', async () => {
    const flagged = await attempt(REFUSED, { problem: { code: 'VOIDED', message: 'Voided.' } });
    for (let one = 0; one < 60; one += 1) await attempt(['open', 'succeeded', 'recording', 'recorded']);
    const open = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data;
    expect(open.rows.map((row: { id: string }) => row.id)).toEqual([flagged]);
    expect(open.more).toBe(false);
    // The badge is counted in the database, not from a first page.
    for (let one = 0; one < 3; one += 1) await attempt(REFUSED, { problem: { code: 'VOIDED', message: 'Voided.' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(4);
  });

  it('shows a disputed payment as disputed, flags it until checked, and again when a dispute opens anew', async () => {
    const id = await attempt(['open', 'succeeded', 'recording', 'recorded'], { takenAmount: '120.00', takenCurrency: 'EUR', paymentRef: 'pi_d' });
    const repo = paymentAttemptsRepo(meta);
    const row = async () => (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(owner) })).json().data.rows.find((one: { id: string }) => one.id === id);
    expect(await row()).toMatchObject({ group: 'paid', flag: null, dispute: null, refund: { refundable: '120.00', refusal: null } });
    await repo.noteDispute(id, 'open', 5000);
    expect(await row()).toMatchObject({ group: 'disputed', flag: { code: 'disputed' }, check: null, dispute: { state: 'open', at: 5000, outcome: null }, refund: { refundable: '120.00', refusal: { code: 'DISPUTED' } } });
    // Needs a look since the dispute opened, not since the payment started.
    expect((await row()).lookAt).toBe(5000);
    expect((await row()).lookAt).not.toBe((await row()).at);
    const disputed = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?state=disputed', headers: as(owner) })).json().data.rows;
    expect(disputed.map((one: { id: string }) => one.id)).toEqual([id]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity?state=paid', headers: as(owner) })).json().data.rows.map((one: { id: string }) => one.id)).not.toContain(id);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(1);
    // Checked without a note: what to answer is in the service's dashboard.
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(owner), payload: { note: null } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(0);
    await repo.noteDispute(id, 'closed', Date.now() + 1000);
    expect(await row()).toMatchObject({ group: 'paid', flag: null, dispute: { state: 'closed' } });
    await repo.noteDispute(id, 'open', Date.now() + 2000);
    expect(await row()).toMatchObject({ group: 'disputed', flag: { code: 'disputed' }, check: null });
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows.map((one: { id: string }) => one.id)).toEqual([id]);
  });

  it('flags a lost dispute as a refund of its own, dated by itself, and shows how the dispute ended', async () => {
    const id = await attempt(['open', 'succeeded', 'recording', 'recorded'], { takenAmount: '120.00', takenCurrency: 'EUR', paymentRef: 'pi_lost' });
    const repo = paymentAttemptsRepo(meta);
    await repo.noteDispute(id, 'open', 5000);
    await repo.noteDispute(id, 'closed', 9000, false, 'lost');
    const made = await refundsRepo(meta).create({ attemptId: id, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: 'pi_lost', amount: '120.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: `dispute:${id}:5000`, source: 'dispute', requestedBy: null, state: 'succeeded' }, 9500);
    const rows = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(owner) })).json().data.rows as { id: string; lookAt: number; flag: unknown; refundSource: string | null; dispute: unknown }[];
    expect(rows.find((one) => one.id === made.refund.id)).toMatchObject({ flag: { code: 'dispute-lost' }, refundSource: 'dispute', lookAt: 9500 });
    expect(rows.find((one) => one.id === id)).toMatchObject({ flag: null, dispute: { state: 'closed', outcome: 'lost', closedAt: 9000 } });
    const open = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows.map((one: { id: string }) => one.id);
    expect(open).toEqual([made.refund.id]);
  });

  it('pages on the time and the id, so rows made in the same millisecond are never skipped', async () => {
    const repo = paymentAttemptsRepo(meta);
    const ids: string[] = [];
    for (let one = 0; one < 55; one += 1) {
      const made = (await repo.create({ provider: 'payments-stripe', mode: 'live', accountId: null, payable: { kind: 'document', connectionId: null, tableName: null, rowKey: `same_${one}` }, payableLabel: 'X', amount: '1.00', currency: 'EUR', linkId: null, nonce: `s${one}`.padEnd(22, 'x'), createdBy: null }, 5000))!;
      ids.push(made.id);
    }
    const first = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(owner) })).json().data;
    expect(first.rows).toHaveLength(50);
    expect(first.more).toBe(true);
    const second = (await app.inject({ method: 'GET', url: `/api/v1/payments/activity?before=${first.next.before}&beforeId=${first.next.beforeId}`, headers: as(owner) })).json().data;
    const seen = [...first.rows, ...second.rows].map((row: { id: string }) => row.id);
    expect(new Set(seen).size).toBe(55);
    expect([...seen].sort()).toEqual([...ids].sort());
    const csv = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity.csv', headers: as(owner) })).payload.trim().split('\r\n');
    expect(csv).toHaveLength(56);
  });

  it('flags a payment that arrived while another for the same record was on its way', async () => {
    await attempt(['open', 'succeeded'], { problem: { code: 'TWO_AT_ONCE', message: 'Two at once.' } });
    const id = (await paymentAttemptsRepo(meta).list())[0]!.id;
    await paymentAttemptsRepo(meta).flag(id, 9999);
    const rows = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows;
    expect(rows.map((row: { flag: { code: string } }) => row.flag.code)).toEqual(['paid-twice']);
  });

  it('names who checked a flag, and carries what was asked, the ids and the times', async () => {
    const id = await attempt(REFUSED, { problem: { code: 'AMOUNT_DIFFERS', message: 'x' }, takenAmount: '100.00', takenCurrency: 'EUR', providerRef: 'cs_live_1', paymentRef: 'pi_1', paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${id}/check`, headers: as(owner), payload: { note: 'Asked the customer.' } });
    const row = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity', headers: as(bookkeeper) })).json().data.rows[0];
    expect(row).toMatchObject({
      amount: '100.00',
      asked: { amount: '120.00', currency: 'EUR' },
      group: 'paid',
      way: 'card',
      paidWith: 'Visa ••4242',
      refs: { attempt: id, checkout: 'cs_live_1', payment: 'pi_1', refund: null },
      check: { by: owner.id, byName: 'Mara', note: 'Asked the customer.' },
    });
    expect(row.times.started).toBeGreaterThan(0);
  });

  it('flags a payment waiting for the bank for more than two weeks, counts it, and lets it be checked without a note', async () => {
    const repo = paymentAttemptsRepo(meta);
    const old = (await repo.create({ provider: 'payments-stripe', mode: 'live', accountId: null, payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'sepa_1' }, payableLabel: 'INV-0039', amount: '60.00', currency: 'EUR', linkId: null, nonce: 'sepa'.padEnd(22, 'x'), createdBy: null }, Date.now() - 15 * 86_400_000))!;
    await repo.move(old.id, 'open', {}, Date.now() - 15 * 86_400_000);
    await repo.move(old.id, 'processing', {}, Date.now() - 15 * 86_400_000);
    // A debit started today is only waiting.
    const fresh = (await repo.create({ provider: 'payments-stripe', mode: 'live', accountId: null, payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'sepa_2' }, payableLabel: 'INV-0040', amount: '60.00', currency: 'EUR', linkId: null, nonce: 'sepb'.padEnd(22, 'x'), createdBy: null }))!;
    await repo.move(fresh.id, 'open', {});
    await repo.move(fresh.id, 'processing', {});
    const open = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows;
    expect(open.map((row: { id: string; flag: { code: string } }) => [row.id, row.flag.code])).toEqual([[old.id, 'waiting-long']]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/attempts/${old.id}/check`, headers: as(owner), payload: { note: null } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(0);
  });

  it('flags a written-down payment that changed afterwards', async () => {
    const id = await attempt(['open', 'succeeded', 'recording', 'recorded'], { problem: { code: 'RECORD_CHANGED', message: 'The payment row was voided.' } });
    await paymentAttemptsRepo(meta).flag(id, 9999);
    const row = (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows[0];
    expect(row.flag).toMatchObject({ code: 'record-changed', reason: 'RECORD_CHANGED' });
  });

  it('flags a refund the record did not follow, asks what was found, and lets it go once it lands', async () => {
    const refunds = refundsRepo(meta);
    const stuck = (await refunds.create({ attemptId: null, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: 'pi_8', amount: '10.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: 'k8', source: 'staff', requestedBy: null, state: 'succeeded', providerRefundId: 're_8' })).refund;
    const gone = (await refunds.create({ attemptId: null, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: 'pi_9', amount: '10.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: 'k9', source: 'provider', requestedBy: null, state: 'succeeded', providerRefundId: 're_9' })).refund;
    await refunds.setProblem(stuck.id, 'NOT_WRITTEN');
    await refunds.setProblem(gone.id, 'RECORD_GONE');
    const open = async () => (await app.inject({ method: 'GET', url: '/api/v1/payments/activity?open=1', headers: as(owner) })).json().data.rows as { id: string; flag: { code: string; reason: string | null } | null }[];
    expect((await open()).map((row) => [row.id, row.flag?.code, row.flag?.reason]).sort()).toEqual([[stuck.id, 'refund-record', 'NOT_WRITTEN'], [gone.id, 'refund-record', 'RECORD_GONE']].sort());
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/activity/count', headers: as(owner) })).json().data.open).toBe(2);
    // Written at last: no longer a look.
    await refunds.setProblem(stuck.id, null, Date.now(), 'NOT_WRITTEN');
    expect((await open()).map((row) => row.id)).toEqual([gone.id]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/refunds/${gone.id}/check`, headers: as(owner), payload: { note: '' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/refunds/${gone.id}/check`, headers: as(owner), payload: { note: 'The payment row was deleted by hand; refunded in full.' } })).statusCode).toBe(204);
    expect(await open()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/activity/refunds/${stuck.id}/check`, headers: as(owner), payload: { note: 'x' } })).statusCode).toBe(422);
  });

  it('narrows by state group, way to pay and days, and names the record a refund gave money back on', async () => {
    const paid = await attempt(['open', 'succeeded', 'recording', 'recorded'], { paidWith: { method: 'sepa_debit', label: 'SEPA ••3000', delayed: true } }, 'INV-0007');
    await attempt(['open', 'failed']);
    await attempt(['open', 'succeeded', 'recording', 'recorded'], { paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    await refundsRepo(meta).create({ attemptId: paid, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: 'pi_7', amount: '10.00', currency: 'EUR', reason: 'requested_by_customer', note: null, idempotencyKey: 'k7', source: 'staff', requestedBy: owner.id, state: 'succeeded', providerRefundId: 're_7' });
    const list = async (q: string) => (await app.inject({ method: 'GET', url: `/api/v1/payments/activity?${q}`, headers: as(owner) })).json().data.rows as { kind: string; group: string; way: string | null; payable: { label: string } | null }[];
    expect((await list('state=failed')).map((row) => row.group)).toEqual(['failed']);
    expect((await list('state=paid')).length).toBe(2);
    expect((await list('way=sepa_debit')).map((row) => row.kind).sort()).toEqual(['attempt', 'refund']);
    const refunded = await list('state=refunded');
    expect(refunded).toEqual([expect.objectContaining({ kind: 'refund', payable: expect.objectContaining({ label: 'INV-0007' }) })]);
    // The attempts here were made on 1 January 1970, the refund today.
    expect((await list('from=1970-01-02')).map((row) => row.kind)).toEqual(['refund']);
    expect((await list('to=1970-01-01')).length).toBe(3);
    expect(await list('to=1969-12-31')).toEqual([]);
  });
});
