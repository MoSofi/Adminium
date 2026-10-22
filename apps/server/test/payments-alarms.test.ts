// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The setup page's alarms come from the audit log by action and age, so a
 * busy month of pay links never hides one, and choosing the first pay
 * address (or saving the same one) is not an alarm.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditRepo, createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { ALARM_SHOWN_MS, dismissAlarm, recentAlarms } from '../src/payments/alarms.js';

describe('recent money-redirect alarms', () => {
  let meta: MetaDb;
  const now = Date.UTC(2026, 9, 21);
  const log = (action: string, changes: Record<string, unknown>, at: number) =>
    auditRepo(meta).append({ actorKind: 'user', actorId: 'usr_1', actorLabel: 'Mara', category: 'payments', action, changes }, at);

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  it('keeps a three-week-old alarm past hundreds of newer payment rows', async () => {
    await log('payments.bank.changed', { before: { accounts: [] }, after: { accounts: [{ currency: 'EUR' }] } }, now - 21 * 86_400_000);
    for (let i = 0; i < 250; i += 1) await log('payments.link.minted', { after: { linkId: `plk_${i}` } }, now - i * 1000);
    expect((await recentAlarms(meta, now)).map((one) => one.what)).toEqual(['bank']);
  });

  it('forgets an alarm after 30 days', async () => {
    await log('payments.account.changed', { before: { key: 'payments-stripe', accountId: 'acct_1' }, after: { key: 'payments-stripe', accountId: 'acct_2' } }, now - ALARM_SHOWN_MS - 1);
    expect(await recentAlarms(meta, now)).toEqual([]);
  });

  it('is no alarm to choose the first pay address, or to save the same one', async () => {
    await log('payments.pay-address.changed', { before: { origin: null }, after: { origin: 'https://pay.a.test' } }, now - 3000);
    await log('payments.pay-address.changed', { before: { origin: 'https://pay.a.test' }, after: { origin: 'https://pay.a.test' } }, now - 2000);
    await log('payments.pay-address.changed', { before: { origin: 'https://pay.a.test' }, after: { origin: 'https://pay.b.test' } }, now - 1000);
    expect(await recentAlarms(meta, now)).toEqual([expect.objectContaining({ what: 'pay-address', from: 'https://pay.a.test', to: 'https://pay.b.test' })]);
  });

  it('hides an alarm for the person who said "Got it", and for nobody else', async () => {
    await log('payments.bank.changed', { before: { accounts: [] }, after: { accounts: [{ currency: 'EUR' }] } }, now - 2000);
    await log('payments.bank.changed', { before: { accounts: [{ currency: 'EUR' }] }, after: { accounts: [{ currency: 'USD' }] } }, now - 1000);
    const [newest, older] = await recentAlarms(meta, now);
    expect(newest!.id).not.toBe(older!.id);
    expect(await dismissAlarm(meta, 'usr_mara', older!.id, now)).toBe(true);
    // Twice is the same.
    expect(await dismissAlarm(meta, 'usr_mara', older!.id, now)).toBe(true);
    expect((await recentAlarms(meta, now, 'usr_mara')).map((one) => one.id)).toEqual([newest!.id]);
    expect((await recentAlarms(meta, now, 'usr_pia')).map((one) => one.id)).toEqual([newest!.id, older!.id]);
    expect((await recentAlarms(meta, now)).map((one) => one.id)).toEqual([newest!.id, older!.id]);
  });

  it('refuses to hide what is no alarm of the last 30 days', async () => {
    const row = await log('payments.link.minted', { after: { linkId: 'plk_1' } }, now - 1000);
    expect(await dismissAlarm(meta, 'usr_mara', 'aud_nothing', now)).toBe(false);
    expect(await dismissAlarm(meta, 'usr_mara', String((row as { id: string }).id), now)).toBe(false);
  });
});
