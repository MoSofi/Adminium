// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telling payment managers, checking recorded payments, and what going live,
 * a refused key, a waiting payment and removed sample rows do:
 *
 *  1. each notice is told once, to every payment manager and to nobody else,
 *     in the reader's own language; test and demo payments tell nobody;
 *  2. the integrity check flags a recorded payment whose row is gone, and
 *     leaves one it cannot read now alone;
 *  3. a key refused while taking a payment pauses the service;
 *  4. switching live on ends the test links and the open test checkouts;
 *  5. a reminder waits while a payment for its row waits for the bank;
 *  6. rows removed with sample data lose their links and open checkouts;
 *  7. the provider's clock is read off its answers.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSqliteMetaDb,
  firstRun,
  keptPaymentsRepo,
  notificationsRepo,
  paymentAttemptsRepo,
  paymentLinksRepo,
  paymentSettingsRepo,
  permissionsRepo,
  rolesRepo,
  userPrefsRepo,
  usersRepo,
  type AttemptState,
  type MetaDb,
  type PayableRef,
  type User,
} from '@adminium/meta';

import { attemptFlag } from '../src/routes/payments/activity.js';
import { clockSkewOf, forgetClockReadings, noteServiceDate, watchingClock } from '../src/payments/clock.js';
import { endPaymentsForRows, endTestWork, setLive } from '../src/payments/going-live.js';
import type { PayableSources } from '../src/payments/payables.js';
import { paymentWaitingSince } from '../src/payments/reminder-hold.js';
import { emptyServiceState, noteKeyRefused, serviceDocName, serviceStateSchema } from '../src/payments/services.js';
import { sweepDocName, sweepStateSchema } from '../src/payments/sweep.js';
import { runPaymentIntegrity, runPaymentWatch, UNRECORDED_AFTER_MS } from '../src/payments/watch.js';
import { webhookDocName, webhookHealthSchema } from '../src/payments/webhook.js';

const T0 = 1_760_000_000_000;
const STRIPE = 'payments-stripe';

describe('payment notices, integrity and the moves around live', () => {
  let meta: MetaDb;
  let owner: User;
  let desk: User;
  let clerk: User;
  let seq = 0;
  const sources: PayableSources = {
    table: async () => null,
    readRow: async () => null,
    shapeOf: async () => null,
    connectionCurrency: async () => 'EUR',
    profile: async () => null,
    keptPaid: async () => '0',
    document: async (id) => (id.startsWith('doc_') ? { status: 'sent', number: id, currency: 'EUR', totalMinor: 12000 } : null),
  };

  async function attempt(path: AttemptState[], over: { mode?: 'test' | 'live'; provider?: string; patch?: Record<string, unknown>; payable?: PayableRef; at?: number } = {}): Promise<string> {
    seq += 1;
    const repo = paymentAttemptsRepo(meta);
    const at = over.at ?? T0;
    const made = (await repo.create(
      {
        provider: over.provider ?? STRIPE,
        mode: over.mode ?? 'live',
        accountId: 'acct_1',
        payable: over.payable ?? { kind: 'document', connectionId: null, tableName: null, rowKey: `doc_${seq}` },
        payableLabel: `INV-00${String(40 + seq)}`,
        amount: '120.00',
        currency: 'EUR',
        linkId: null,
        nonce: `n${seq}`.padEnd(22, 'x'),
        createdBy: null,
      },
      at,
    ))!;
    for (const to of path) await repo.move(made.id, to, to === path.at(-1) ? (over.patch ?? {}) : {}, at);
    return made.id;
  }

  const watch = (at: number, keys: string[] = [STRIPE]) => runPaymentWatch({ meta, sources, serviceKeys: async () => keys, now: () => at });
  const told = async (user: User) => notificationsRepo(meta).listForUser(user.id, { limit: 50 });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const payDesk = await roles.create({ slug: 'pay-desk', name: 'Payments desk' });
    await permissionsRepo(meta).grant(payDesk.id, 'system', 'payments.manage', { allowed: true });
    desk = await users.create({ email: 'pia@adminium.test', name: 'Pia', status: 'active' });
    await roles.assignToUser(desk.id, payDesk.id);
    await userPrefsRepo(meta).set(desk.id, { locale: 'de_DE' });
    clerk = await users.create({ email: 'tom@adminium.test', name: 'Tom', status: 'active' });
    await roles.assignToUser(clerk.id, (await roles.findBySlug('editor'))!.id);
    forgetClockReadings();
    seq = 0;
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  it('tells every payment manager once that a payment arrived, in their own language, and nobody else', async () => {
    const id = await attempt(['open', 'succeeded', 'recording']);
    await paymentAttemptsRepo(meta).move(id, 'recorded', { recordedKey: 'kept:x', recordedAt: T0 + 1, takenAmount: '120.00', paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } }, T0 + 1);
    expect((await watch(T0 + 60_000)).landed).toBe(1);
    expect((await watch(T0 + 120_000)).landed).toBe(0);
    expect((await told(owner)).map((one) => [one.kind, one.title, one.body])).toEqual([['payments.landed', 'Payment received', '€120.00 for INV-0041 by Visa ••4242']]);
    const german = await told(desk);
    expect(german).toHaveLength(1);
    expect(german[0]).toMatchObject({ title: 'Zahlung eingegangen' });
    expect(german[0]!.body).toMatch(/^120,00\s€ für INV-0041 mit Visa ••4242$/);
    expect(await told(clerk)).toEqual([]);
  });

  it('tells nobody of a test or demo payment', async () => {
    const test = await attempt(['open', 'succeeded', 'recording'], { mode: 'test' });
    await paymentAttemptsRepo(meta).move(test, 'recorded', { recordedKey: 'kept:t', recordedAt: T0 + 1 }, T0 + 1);
    await attempt(['open', 'succeeded', 'recording', 'record_refused'], { mode: 'test', patch: { problem: { code: 'AMOUNT_DIFFERS', message: 'x' } } });
    const result = await watch(T0 + 60_000);
    expect(result).toMatchObject({ landed: 0, looks: 0 });
    expect(await told(owner)).toEqual([]);
  });

  it('says what a payment that needs a look is about, once, and what is taken but not recorded', async () => {
    await attempt(['open', 'succeeded', 'recording', 'record_refused'], { patch: { problem: { code: 'AMOUNT_DIFFERS', message: 'Stripe took 100.00' } } });
    await attempt(['open', 'succeeded'], { at: T0 - UNRECORDED_AFTER_MS - 60_000 });
    const first = await watch(T0);
    expect(first).toMatchObject({ looks: 1, unrecorded: 1 });
    expect((await watch(T0 + 1)).looks).toBe(0);
    const bodies = (await told(owner)).map((one) => one.body).sort();
    expect(bodies).toEqual(['Paid at Stripe, not recorded yet: INV-0042', 'Paid at Stripe, not the amount asked: INV-0041']);
    expect((await told(owner)).every((one) => one.title === 'A payment needs a look')).toBe(true);
  });

  it('pauses a service whose key is refused while taking a payment, and tells once per refusal', async () => {
    await paymentSettingsRepo(meta).set(serviceDocName(STRIPE), serviceStateSchema, { ...emptyServiceState(), test: { ...emptyServiceState().test, check: { at: T0 - 1, ok: true, code: null, message: null, missing: [] } } }, T0 - 1);
    expect(await noteKeyRefused(meta, STRIPE, 'test', 'Expired API Key provided', T0)).toBe(true);
    expect(await noteKeyRefused(meta, STRIPE, 'test', 'Expired API Key provided', T0 + 1)).toBe(false);
    const state = await paymentSettingsRepo(meta).get(serviceDocName(STRIPE), serviceStateSchema);
    expect(state?.test.check).toMatchObject({ ok: false, code: 'CREDENTIALS_REFUSED', message: 'Expired API Key provided' });
    expect((await watch(T0 + 2)).keys).toBe(1);
    expect((await watch(T0 + 3)).keys).toBe(0);
    expect((await told(owner))[0]).toMatchObject({ kind: 'payments.key-refused', title: 'Stripe refused the key', body: 'Payments are paused until a working key is saved.' });
  });

  it('says a live webhook is silent, once a day, and that the sweep slowed, once a month', async () => {
    await paymentSettingsRepo(meta).set(serviceDocName(STRIPE), serviceStateSchema, { ...emptyServiceState(), liveOn: true }, T0);
    await paymentSettingsRepo(meta).set(webhookDocName(STRIPE, 'live'), webhookHealthSchema, { firstAt: T0 - 5 * 86_400_000, lastAt: T0 - 2 * 86_400_000, lastBadAt: null, origin: null }, T0);
    await attempt(['open'], { at: T0 - 5 * 3_600_000 });
    await paymentSettingsRepo(meta).set(sweepDocName(STRIPE, 'live'), sweepStateSchema, { cursor: null, lastRunAt: T0, month: '2025-10', reads: 9_000, caughtAt: null, slowed: true, lastLookupAt: null }, T0);
    expect(await watch(T0)).toMatchObject({ silent: 1, reads: 1 });
    expect(await watch(T0 + 60_000)).toMatchObject({ silent: 0, reads: 0 });
    const titles = (await told(owner)).map((one) => one.title).sort();
    expect(titles).toEqual(['Adminium checks Stripe less often', 'The Stripe webhook is silent']);
  });

  it('flags a recorded payment whose kept row was voided, as Activity shows it, and leaves the rest', async () => {
    const kept = keptPaymentsRepo(meta);
    const ok = await attempt(['open', 'succeeded', 'recording']);
    const gone = await attempt(['open', 'succeeded', 'recording']);
    for (const id of [ok, gone]) {
      const row = (await kept.insert({ payable: (await paymentAttemptsRepo(meta).byId(id))!.payable, number: null, amount: '120.00', currency: 'EUR', method: 'card', methodNote: null, provider: STRIPE, mode: 'live', attemptId: id, approvalCode: null, cardLast4: null, note: null, paidOn: T0, recordedBy: 'Online payment (Stripe)', recordedByUser: null }, T0))!;
      await paymentAttemptsRepo(meta).move(id, 'recorded', { recordedKey: `kept:${row.id}`, recordedAt: T0, takenAmount: '120.00' }, T0);
      if (id === gone) await kept.void(row.id, 'restored from a backup', T0);
    }
    const result = await runPaymentIntegrity({ meta, sources, serviceKeys: async () => [], now: () => T0 + 60_000 });
    expect(result).toEqual({ checked: 2, missing: 1, skipped: 0 });
    const flagged = (await paymentAttemptsRepo(meta).byId(gone))!;
    expect(flagged.problem?.code).toBe('RECORD_MISSING');
    expect(attemptFlag(flagged)?.code).toBe('record-changed');
    expect(attemptFlag((await paymentAttemptsRepo(meta).byId(ok))!)).toBeNull();
    // Checked again, it is not flagged twice, and the watch tells of it once.
    expect((await runPaymentIntegrity({ meta, sources, serviceKeys: async () => [], now: () => T0 + 120_000 })).missing).toBe(0);
    expect((await watch(T0 + 180_000)).looks).toBe(1);
    expect((await told(owner)).some((one) => one.body === 'Its recorded payment is no longer there: INV-0042')).toBe(true);
  });

  it('ends every test link and open test checkout when live payments are switched on', async () => {
    const links = paymentLinksRepo(meta);
    const testLink = await links.mint({ tokenHash: 'h1', tokenSealed: 's1', payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_a' }, mode: 'test', expiresAt: T0 + 9e6, createdBy: null }, T0);
    const openTest = await attempt(['open'], { mode: 'test', provider: 'demo' });
    const liveOpen = await attempt(['open']);
    const waiting = await attempt(['open', 'processing'], { mode: 'test', provider: 'demo' });
    const { ended } = await setLive({ meta, providerFor: async () => ({ ok: false, code: 'NOT_LOADED', message: 'x' }), now: () => T0 + 1 }, STRIPE, true);
    expect(ended).toEqual({ links: 1, checkouts: 1 });
    expect(await links.byId(testLink.link.id)).toMatchObject({ current: false, revokeReason: 'test-ended' });
    expect((await paymentAttemptsRepo(meta).byId(openTest))!.state).toBe('expired');
    expect((await paymentAttemptsRepo(meta).byId(liveOpen))!.state).toBe('open');
    expect((await paymentAttemptsRepo(meta).byId(waiting))!.state).toBe('processing');
    // Already on: nothing more is ended.
    expect((await setLive({ meta, providerFor: async () => ({ ok: false, code: 'NOT_LOADED', message: 'x' }) }, STRIPE, true)).ended).toBeNull();
    expect(await endTestWork({ meta, providerFor: async () => ({ ok: false, code: 'NOT_LOADED', message: 'x' }) })).toEqual({ links: 0, checkouts: 0 });
  });

  it('holds a reminder about a row while a payment for it waits for the bank', async () => {
    const table = { id: 'main.invoices', primaryKey: ['id'] } as never;
    const ref: PayableRef = { kind: 'shape', connectionId: 'conn_1', tableName: 'main.invoices', rowKey: '42' };
    expect(await paymentWaitingSince(meta, 'conn_1', table, { id: 42 })).toBeNull();
    const id = await attempt(['open', 'processing'], { payable: ref, at: T0 - 86_400_000 });
    expect(await paymentWaitingSince(meta, 'conn_1', table, { id: 42 })).toBe(T0 - 86_400_000);
    await paymentAttemptsRepo(meta).move(id, 'failed', {}, T0);
    expect(await paymentWaitingSince(meta, 'conn_1', table, { id: 42 })).toBeNull();
  });

  it('ends the pay links and open checkouts of rows removed with sample data', async () => {
    const ref: PayableRef = { kind: 'profile', connectionId: 'conn_1', tableName: 'main.deposits', rowKey: '7' };
    const link = await paymentLinksRepo(meta).mint({ tokenHash: 'h7', tokenSealed: 's7', payable: ref, mode: 'live', expiresAt: T0 + 9e6, createdBy: null }, T0);
    const open = await attempt(['open'], { payable: ref, provider: 'demo', mode: 'test' });
    const ended = await endPaymentsForRows({ meta, providerFor: async () => ({ ok: false, code: 'NOT_LOADED', message: 'x' }), now: () => T0 + 1 }, 'conn_1', [{ table: { id: 'main.deposits', primaryKey: ['id'] }, pk: { id: 7 } }]);
    expect(ended).toEqual({ links: 1, checkouts: 1 });
    expect((await paymentLinksRepo(meta).byId(link.link.id))?.current).toBe(false);
    expect((await paymentAttemptsRepo(meta).byId(open))!.state).toBe('expired');
  });

  it('reads how far a service\'s clock is from this one off its answers', async () => {
    noteServiceDate(STRIPE, new Date(T0 + 90_000).toUTCString(), T0);
    expect(clockSkewOf(STRIPE)?.skewMs).toBe(90_000);
    noteServiceDate(STRIPE, new Date(T0 + 1_000).toUTCString(), T0);
    expect(clockSkewOf(STRIPE)?.skewMs).toBe(0);
    noteServiceDate(STRIPE, 'not a date', T0);
    expect(clockSkewOf(STRIPE)?.skewMs).toBe(0);
    const client = watchingClock('payments-paypal', async () => ({ status: 200, headers: { get: (name: string) => (name === 'date' ? new Date(T0 - 120_000).toUTCString() : null) }, text: async () => '{}' }), () => T0);
    await client('https://api-m.paypal.com/v1/x');
    expect(clockSkewOf('payments-paypal')?.skewMs).toBe(-120_000);
  });
});

describe('the words of payment notices', () => {
  it('names only words the bundle has, each with its English exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const english = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/i18n/locales/en-US/payments.json'), 'utf8')) as { notice: Record<string, Record<string, string>> };
    const pairs: [string, string][] = [];
    for (const file of ['src/payments/watch.ts', 'src/payments/alarms.ts', 'src/routes/payments/index.ts']) {
      const text = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
      for (const match of text.matchAll(/key: '([a-zA-Z]+\.[a-zA-Z]+)', fallback: '((?:[^'\\]|\\.)*)'/g)) pairs.push([match[1]!, match[2]!.replace(/\\'/g, "'")]);
    }
    expect(pairs.length).toBeGreaterThan(15);
    for (const [key, fallback] of pairs) {
      const [group, name] = key.split('.') as [string, string];
      expect(english.notice[group]?.[name], key).toBe(fallback);
    }
  });
});
