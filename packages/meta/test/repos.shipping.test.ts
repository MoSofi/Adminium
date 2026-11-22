// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What one app install chose for shipping, and its stored quotes (wave 0103),
 * on every available dialect: a store from before the wave upgrades with
 * nothing in it; saving one setting leaves the other; a slot holds one quote,
 * also when two arrive at once; expired quotes go when a new one comes; each
 * install is its own; every bounded column takes its full width and refuses
 * one character more.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  SHIPPING_CARRIER_WIDTH,
  SHIPPING_HASH_WIDTH,
  SHIPPING_ID_WIDTH,
  SHIPPING_PURPOSE_WIDTH,
  SHIPPING_ROW_WIDTH,
  SHIPPING_TABLE_WIDTH,
  applyMigrations,
  shippingRepo,
  type NewShippingQuote,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const HASH = 'a'.repeat(SHIPPING_HASH_WIDTH);
const SLOT = { installId: 'mft_shop', connectionId: 'conn_one', tableRef: 'orders', rowKey: '41', purpose: 'outbound', parcelNumber: 1 };
const quote = (over: Partial<NewShippingQuote> = {}): NewShippingQuote => ({
  ...SLOT,
  carrierKey: 'shipping-shippo',
  detailsHash: HASH,
  rates: [{ rateId: 'rate_1', amountDecimal: '4.20' }],
  createdBy: 'usr_owner',
  expiresAt: T0 + 3_600_000,
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`shipping settings and quotes [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('upgrades a store from before the wave, with nothing in it, and runs once', async () => {
      expect(ALL_MIGRATIONS.map((one) => one.name)).toContain('0103_shipping');
      expect(await shippingRepo(meta()).settings('mft_shop')).toBeNull();
      expect((await applyMigrations(meta().db, { dialect: meta().dialect })).applied).toEqual([]);
    });

    it('saves the carrier and Ship from apart, so one never writes over the other', async () => {
      const repo = shippingRepo(meta());
      await repo.setShipFrom('mft_shop', { name: 'Marlow Press', lines: ['1 Mill Lane'] }, 'usr_a', T0);
      await repo.setActiveCarrier('mft_shop', 'shipping-shippo', 'usr_b', T0 + 1);
      expect(await repo.settings('mft_shop')).toEqual({
        installId: 'mft_shop',
        activeCarrier: 'shipping-shippo',
        shipFrom: { name: 'Marlow Press', lines: ['1 Mill Lane'] },
        updatedBy: 'usr_b',
        updatedAt: T0 + 1,
      });
      await repo.setShipFrom('mft_shop', { name: 'Marlow Press Ltd' }, 'usr_a', T0 + 2);
      expect(await repo.settings('mft_shop')).toMatchObject({ activeCarrier: 'shipping-shippo', shipFrom: { name: 'Marlow Press Ltd' } });
      // The same value saved again in the same millisecond (MySQL reports no row changed).
      await repo.setActiveCarrier('mft_shop', 'shipping-shippo', 'usr_a', T0 + 2);
      await repo.setActiveCarrier('mft_shop', 'shipping-shippo', 'usr_a', T0 + 2);
      expect((await repo.settings('mft_shop'))?.activeCarrier).toBe('shipping-shippo');
      // Two first saves at once make one row.
      await Promise.all([repo.setActiveCarrier('mft_two', 'shipping-shippo', null, T0), repo.setShipFrom('mft_two', { city: 'Leeds' }, null, T0)]);
      expect(await repo.settings('mft_two')).toMatchObject({ activeCarrier: 'shipping-shippo', shipFrom: { city: 'Leeds' } });
    });

    it('keeps one quote per slot: a new one replaces the old, also when they arrive at once', async () => {
      const repo = shippingRepo(meta());
      const first = await repo.replaceQuote(quote(), T0);
      expect(await repo.quote(first.id)).toMatchObject({ ...SLOT, carrierKey: 'shipping-shippo', detailsHash: HASH, rates: [{ rateId: 'rate_1', amountDecimal: '4.20' }], createdBy: 'usr_owner', createdAt: T0, expiresAt: T0 + 3_600_000 });
      const second = await repo.replaceQuote(quote({ rates: [] }), T0 + 1);
      expect(await repo.quote(first.id)).toBeNull();
      expect((await repo.quote(second.id))?.rates).toEqual([]);

      // Six at once, on a slot with a row and on one without: every one is kept in turn, none fails, one is left.
      for (const rowKey of ['41', 'fresh']) {
        await Promise.all(Array.from({ length: 6 }, (_, n) => repo.replaceQuote(quote({ rowKey, rates: [{ rateId: `rate_${String(n)}` }] }), T0 + 2 + n)));
        expect(await meta().db.selectFrom('adminium_shipping_quotes').select('id').where('rowKey', '=', rowKey).execute()).toHaveLength(1);
      }
      await meta().db.deleteFrom('adminium_shipping_quotes').where('rowKey', '=', 'fresh').execute();

      // Another parcel, purpose, row or install is another slot.
      for (const other of [{ parcelNumber: 2 }, { purpose: 'return' }, { rowKey: '42' }, { tableRef: 'returns' }, { installId: 'mft_other' }, { connectionId: 'conn_two' }]) await repo.replaceQuote(quote(other), T0 + 20);
      expect(await meta().db.selectFrom('adminium_shipping_quotes').select('id').execute()).toHaveLength(7);
    });

    it('prunes what has expired when a new quote comes, and an install takes only its own with it', async () => {
      const repo = shippingRepo(meta());
      const old = await repo.replaceQuote(quote({ rowKey: 'old', expiresAt: T0 + 10 }), T0);
      const live = await repo.replaceQuote(quote({ rowKey: 'live', expiresAt: T0 + 1000 }), T0);
      const theirs = await repo.replaceQuote(quote({ installId: 'mft_other', expiresAt: T0 + 1000 }), T0);
      await repo.replaceQuote(quote({ rowKey: 'new', expiresAt: T0 + 1000 }), T0 + 10);
      expect(await repo.quote(old.id)).toBeNull();
      expect(await repo.quote(live.id)).not.toBeNull();

      await repo.setActiveCarrier('mft_shop', 'shipping-shippo', null, T0);
      await repo.setActiveCarrier('mft_other', 'shipping-shippo', null, T0);
      expect(await repo.clearQuotes('mft_shop')).toBe(2);
      expect(await repo.quote(live.id)).toBeNull();
      expect(await repo.settings('mft_shop')).not.toBeNull();
      await repo.forgetInstall('mft_shop');
      expect(await repo.settings('mft_shop')).toBeNull();
      expect(await repo.quote(theirs.id)).not.toBeNull();
      expect(await repo.settings('mft_other')).not.toBeNull();
    });

    it('refuses a slot it could not keep, before the database does', async () => {
      const repo = shippingRepo(meta());
      for (const over of [{ rowKey: '' }, { rowKey: 'r'.repeat(SHIPPING_ROW_WIDTH + 1) }, { tableRef: 't'.repeat(SHIPPING_TABLE_WIDTH + 1) }, { purpose: 'p'.repeat(SHIPPING_PURPOSE_WIDTH + 1) }, { parcelNumber: 0 }, { parcelNumber: 1.5 }, { installId: 'i'.repeat(SHIPPING_ID_WIDTH + 1) }, { carrierKey: 'c'.repeat(SHIPPING_CARRIER_WIDTH + 1) }, { detailsHash: 'short' }]) {
        await expect(repo.replaceQuote(quote(over), T0)).rejects.toThrow();
      }
      await expect(repo.setActiveCarrier('mft_shop', 'c'.repeat(SHIPPING_CARRIER_WIDTH + 1), null, T0)).rejects.toThrow();
    });

    it('holds every bounded column at its full width, in the slot\'s unique key too', async () => {
      const repo = shippingRepo(meta());
      const wide = {
        installId: 'i'.repeat(SHIPPING_ID_WIDTH),
        connectionId: 'c'.repeat(SHIPPING_ID_WIDTH),
        tableRef: 't'.repeat(SHIPPING_TABLE_WIDTH),
        rowKey: 'é'.repeat(SHIPPING_ROW_WIDTH),
        purpose: 'p'.repeat(SHIPPING_PURPOSE_WIDTH),
        parcelNumber: 99,
      };
      const made = await repo.replaceQuote(quote({ ...wide, carrierKey: 'k'.repeat(SHIPPING_CARRIER_WIDTH) }), T0);
      expect(await repo.quote(made.id)).toMatchObject({ ...wide, carrierKey: 'k'.repeat(SHIPPING_CARRIER_WIDTH) });
      await repo.setActiveCarrier(wide.installId, 'k'.repeat(SHIPPING_CARRIER_WIDTH), 'u'.repeat(SHIPPING_ID_WIDTH), T0);
      expect((await repo.settings(wide.installId))?.activeCarrier).toHaveLength(SHIPPING_CARRIER_WIDTH);
      if (meta().dialect !== 'sqlite') {
        await expect(
          meta().db.insertInto('adminium_shipping_quotes').values({ id: 'shq_over', ...SLOT, rowKey: 'r'.repeat(SHIPPING_ROW_WIDTH + 1), carrierKey: 'k', detailsHash: HASH, rates: '[]', createdBy: null, createdAt: T0, expiresAt: T0 }).execute(),
        ).rejects.toThrow();
      }
    });
  });
}
