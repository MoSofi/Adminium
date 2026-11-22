// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The nonce of a person's private calendar link (wave 0101), on every available
 * dialect: made once however many ask at once, replaced by a renew, one
 * person's never another's, and a key no column can hold is refused without
 * touching the store.
 */
import { describe, expect, it } from 'vitest';

import { CALENDAR_FEED_APP_WIDTH, CALENDAR_FEED_CONNECTION_WIDTH, CALENDAR_FEED_ROW_WIDTH, CALENDAR_FEED_TABLE_WIDTH, calendarFeedsRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const KEY = { connectionId: 'conn_one', appKey: 'lumen', tableName: 'main.lumen_bookings', rowKey: '7' };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`a person's calendar link [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('has no nonce until it is asked for, then keeps the one it made', async () => {
      const feeds = calendarFeedsRepo(meta());
      expect(await feeds.nonceOf(KEY)).toBeNull();
      const made = await feeds.ensure(KEY, T0);
      expect(made).toMatch(/^[0-9a-f]{32}$/);
      expect(await feeds.ensure(KEY, T0 + 1)).toBe(made);
      expect(await feeds.nonceOf(KEY)).toBe(made);
    });

    it('makes one nonce when many ask at once', async () => {
      const feeds = calendarFeedsRepo(meta());
      const key = { ...KEY, rowKey: 'at-once' };
      const got = await Promise.all(Array.from({ length: 8 }, (_, n) => feeds.ensure(key, T0 + n)));
      expect(new Set(got).size).toBe(1);
      expect(await feeds.nonceOf(key)).toBe(got[0]);
    });

    it('a renew replaces it, says who, and makes one where there was none', async () => {
      const feeds = calendarFeedsRepo(meta());
      const key = { ...KEY, rowKey: 'renewed' };
      const first = await feeds.ensure(key, T0);
      const second = await feeds.renew(key, 'usr_owner', T0 + 5);
      expect(second).not.toBe(first);
      expect(await feeds.nonceOf(key)).toBe(second);
      const row = await meta().db.selectFrom('adminium_calendar_feeds').selectAll().where('rowKey', '=', 'renewed').executeTakeFirstOrThrow();
      expect([row.changedBy, Number(row.changedAt)]).toEqual(['usr_owner', T0 + 5]);
      const fresh = { ...KEY, rowKey: 'never-looked' };
      const made = await feeds.renew(fresh, null, T0);
      expect(await feeds.nonceOf(fresh)).toBe(made);
    });

    it('two renews at once leave one live nonce', async () => {
      const feeds = calendarFeedsRepo(meta());
      const key = { ...KEY, rowKey: 'renewed-at-once' };
      const got = await Promise.all(Array.from({ length: 6 }, (_, n) => feeds.renew(key, null, T0 + n)));
      expect(got).toContain(await feeds.nonceOf(key));
    });

    it('one person\'s, app\'s, table\'s or database\'s link is not another\'s', async () => {
      const feeds = calendarFeedsRepo(meta());
      const mine = await feeds.ensure(KEY, T0);
      for (const other of [{ ...KEY, rowKey: '8' }, { ...KEY, appKey: 'other' }, { ...KEY, tableName: 'main.other' }, { ...KEY, connectionId: 'conn_two' }]) {
        expect(await feeds.nonceOf(other)).toBeNull();
        expect(await feeds.ensure(other, T0)).not.toBe(mine);
      }
      expect(await feeds.nonceOf(KEY)).toBe(mine);
    });

    it('takes every column at its full width, and refuses one character more without writing', async () => {
      const feeds = calendarFeedsRepo(meta());
      const full = { connectionId: 'c'.repeat(CALENDAR_FEED_CONNECTION_WIDTH), appKey: 'a'.repeat(CALENDAR_FEED_APP_WIDTH), tableName: 't'.repeat(CALENDAR_FEED_TABLE_WIDTH), rowKey: 'r'.repeat(CALENDAR_FEED_ROW_WIDTH) };
      expect(await feeds.ensure(full, T0)).toEqual(expect.any(String));
      for (const over of [{ ...full, connectionId: `${full.connectionId}c` }, { ...full, appKey: `${full.appKey}a` }, { ...full, tableName: `${full.tableName}t` }, { ...full, rowKey: `${full.rowKey}r` }, { ...KEY, rowKey: '' }]) {
        expect(await feeds.ensure(over, T0)).toBeNull();
        expect(await feeds.renew(over, null, T0)).toBeNull();
        expect(await feeds.nonceOf(over)).toBeNull();
      }
    });
  });
}
