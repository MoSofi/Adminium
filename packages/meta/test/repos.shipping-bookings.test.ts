// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The booking table (wave 0109) on every available dialect: one live booking
 * per slot however many ask at once, every state move guarded, a freed slot
 * free again, and a late label taking its place back.
 */
import { describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, SHIPPING_CARRIER_TEXT_WIDTH, applyMigrations, shippingBookingsRepo, shippingOpenKey, type NewShippingBooking } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const SLOT = { installId: 'mft_shop', connectionId: 'conn_one', tableRef: 'orders', tableName: 'shop_orders', rowKey: '41', purpose: 'outbound', parcelNumber: 1 };
const input = (over: Partial<NewShippingBooking> = {}): NewShippingBooking => ({
  ...SLOT,
  carrierInstallId: 'mft_carrier',
  carrierKey: 'shipping-shippo',
  reference: 'MP-41',
  mode: 'live',
  accountFingerprint: 'f'.repeat(64),
  detailsHash: 'd'.repeat(64),
  service: 'Evri 48',
  rateCode: 'evri-48',
  handleSealed: null,
  quotedAmount: '3.10',
  quotedCurrency: 'GBP',
  createdBy: 'usr_packer',
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`shipping bookings [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    const made = async (over: Partial<NewShippingBooking> = {}) => {
      const out = await shippingBookingsRepo(meta()).reserve(input(over), T0);
      if (!out.ok) throw new Error('not reserved');
      return out.booking;
    };

    it('upgrades a store from before the wave, and runs once', async () => {
      expect(ALL_MIGRATIONS.map((one) => one.name)).toContain('0109_shipping_bookings');
      expect(await shippingBookingsRepo(meta()).byId('shb_none')).toBeNull();
      expect((await applyMigrations(meta().db, { dialect: meta().dialect })).applied).toEqual([]);
    });

    it('reads back what it was given, with nothing bought yet', async () => {
      const booking = await made();
      expect(booking).toMatchObject({ ...SLOT, state: 'reserved', mode: 'live', reference: 'MP-41', quotedAmount: '3.10', chargeDiffers: false, duplicates: 0, calledAt: null, appliedAt: null, openKey: shippingOpenKey(SLOT, 'live') });
      expect(booking.id.startsWith('shb_')).toBe(true);
    });

    it('holds one live booking per slot, also when many ask at once', async () => {
      const repo = shippingBookingsRepo(meta());
      const all = await Promise.all(Array.from({ length: 10 }, () => repo.reserve(input(), T0)));
      const won = all.filter((one) => one.ok);
      expect(won).toHaveLength(1);
      const winner = won[0] as Extract<(typeof all)[number], { ok: true }>;
      for (const lost of all.filter((one) => !one.ok)) expect((lost as { holder: { id: string } | null }).holder?.id).toBe(winner.booking.id);
      expect(await repo.forRow('conn_one', 'shop_orders', '41')).toHaveLength(1);
    });

    it('keeps the carrier out of the slot, and test, live, parcels and purposes in it', async () => {
      const repo = shippingBookingsRepo(meta());
      await made();
      expect((await repo.reserve(input({ carrierKey: 'shipping-dhl', carrierInstallId: 'mft_dhl' }), T0)).ok).toBe(false);
      // A reinstall is a new install of the same table: it does not get a second place.
      expect((await repo.reserve(input({ installId: 'mft_reinstalled' }), T0)).ok).toBe(false);
      for (const over of [{ mode: 'test' as const }, { parcelNumber: 2 }, { purpose: 'return' }, { rowKey: '42' }, { tableName: 'maker_orders' }, { connectionId: 'conn_two' }]) {
        expect((await repo.reserve(input(over), T0)).ok, JSON.stringify(over)).toBe(true);
      }
    });

    it('takes each step once, only from the states named', async () => {
      const repo = shippingBookingsRepo(meta());
      const { id } = await made();
      const moves = await Promise.all(Array.from({ length: 6 }, () => repo.move(id, ['reserved'], 'calling', { calledAt: T0 + 1 }, T0 + 1)));
      expect(moves.filter(Boolean)).toHaveLength(1);
      expect(await repo.move(id, ['reserved'], 'released', {}, T0 + 2)).toBe(false);
      expect(await repo.move(id, ['calling'], 'booked', { tracking: 'TRK', carrierShipmentId: 'tx', amount: '3.10', currency: 'GBP', chargeDiffers: true }, T0 + 3)).toBe(true);
      expect(await repo.byId(id)).toMatchObject({ state: 'booked', tracking: 'TRK', chargeDiffers: true, calledAt: T0 + 1, updatedAt: T0 + 3 });
      expect((await repo.byId(id))?.openKey).not.toBeNull();
    });

    it('frees the slot on a refusal or a release, and never on anything else', async () => {
      const repo = shippingBookingsRepo(meta());
      for (const state of ['refused', 'released'] as const) {
        const { id } = await made();
        await repo.move(id, ['reserved'], state, {}, T0 + 1);
        expect((await repo.byId(id))?.openKey).toBeNull();
        expect(await repo.open(SLOT, 'live')).toBeNull();
      }
      const held = await made();
      await repo.move(held.id, ['reserved'], 'calling', {}, T0 + 1);
      await repo.move(held.id, ['calling'], 'unknown', { reason: 'no-answer' }, T0 + 2);
      expect((await repo.open(SLOT, 'live'))?.id).toBe(held.id);
    });

    it('lets a released purchase that turned up take its slot back, unless the slot is held', async () => {
      const repo = shippingBookingsRepo(meta());
      const old = await made();
      await repo.move(old.id, ['reserved'], 'released', {}, T0 + 1);
      const holder = await made();
      expect(await repo.reopenAsBooked(old.id, SLOT, 'live', { tracking: 'TRK' }, T0 + 2)).toBe(false);
      expect((await repo.byId(old.id))?.state).toBe('released');
      await repo.move(holder.id, ['reserved'], 'released', {}, T0 + 3);
      expect(await repo.reopenAsBooked(old.id, SLOT, 'live', { tracking: 'TRK' }, T0 + 4)).toBe(true);
      expect(await repo.open(SLOT, 'live')).toMatchObject({ id: old.id, state: 'booked', tracking: 'TRK' });
    });

    it('hands a place from a new attempt to a label that turned up, all or nothing', async () => {
      const repo = shippingBookingsRepo(meta());
      const old = await made();
      await repo.move(old.id, ['reserved'], 'released', {}, T0 + 1);
      const fresh = await made();
      expect(await repo.takeBackSlot(fresh.id, 'shb_missing', SLOT, 'live', { tracking: 'TRK' }, 'label-found', T0 + 2)).toBe(false);
      expect(await repo.byId(fresh.id)).toMatchObject({ state: 'reserved' });
      expect((await repo.open(SLOT, 'live'))?.id).toBe(fresh.id);
      expect(await repo.takeBackSlot(fresh.id, old.id, SLOT, 'live', { tracking: 'TRK' }, 'label-found', T0 + 3)).toBe(true);
      expect(await repo.byId(fresh.id)).toMatchObject({ state: 'released', reason: 'label-found', openKey: null });
      expect(await repo.open(SLOT, 'live')).toMatchObject({ id: old.id, state: 'booked', tracking: 'TRK' });
    });

    it('lists an app install\'s unresolved attempts', async () => {
      const repo = shippingBookingsRepo(meta());
      const open = await made();
      const done = await made({ rowKey: '42' });
      await repo.move(done.id, ['reserved'], 'booked', {}, T0);
      await made({ rowKey: '43', installId: 'mft_other' });
      expect((await repo.unresolvedOfInstall('mft_shop')).map((one) => one.id)).toEqual([open.id]);
    });

    it('takes an attempt off the day\'s count once', async () => {
      const repo = shippingBookingsRepo(meta());
      const { id } = await made();
      await repo.markCounted(id, '2026-11-22', T0 + 1);
      const runs = await Promise.all(Array.from({ length: 5 }, () => repo.uncount(id, T0 + 2)));
      expect(runs.filter(Boolean)).toHaveLength(1);
      expect(await repo.byId(id)).toMatchObject({ countedDay: '2026-11-22', countHeld: false });
      const again = await Promise.all(Array.from({ length: 5 }, () => repo.recount(id, T0 + 3)));
      expect(again.filter(Boolean)).toHaveLength(1);
      expect((await repo.byId(id))?.countHeld).toBe(true);
    });

    it('lists what is unresolved on a carrier, and bought labels whose steps are not done', async () => {
      const repo = shippingBookingsRepo(meta());
      const reserved = await made();
      const calling = await made({ rowKey: '42' });
      await repo.move(calling.id, ['reserved'], 'calling', {}, T0);
      const unknown = await made({ rowKey: '43' });
      await repo.move(unknown.id, ['reserved'], 'unknown', {}, T0);
      const booked = await made({ rowKey: '44' });
      await repo.move(booked.id, ['reserved'], 'booked', {}, T0);
      const refused = await made({ rowKey: '45' });
      await repo.move(refused.id, ['reserved'], 'refused', {}, T0);
      await made({ rowKey: '46', carrierInstallId: 'mft_other' });
      expect((await repo.unresolved('mft_carrier')).map((one) => one.id).sort()).toEqual([reserved.id, calling.id, unknown.id].sort());
      expect((await repo.unapplied(T0 + 1)).map((one) => one.id)).toEqual([booked.id]);
      expect(await repo.unapplied(T0)).toEqual([]);
      await repo.note(booked.id, ['booked'], { appliedAt: T0 }, T0);
      expect(await repo.unapplied(T0 + 1)).toEqual([]);
    });

    it('takes a carrier value at its full width and refuses one character more', async () => {
      const repo = shippingBookingsRepo(meta());
      const { id } = await made();
      const full = 'x'.repeat(SHIPPING_CARRIER_TEXT_WIDTH);
      await repo.move(id, ['reserved'], 'booked', { tracking: full, carrierShipmentId: full, labelRef: full }, T0 + 1);
      expect((await repo.byId(id))?.tracking).toBe(full);
      await expect(repo.note(id, ['booked'], { tracking: `${full}x` }, T0 + 2)).rejects.toThrow(/longer than its column/);
    });
  });
}
