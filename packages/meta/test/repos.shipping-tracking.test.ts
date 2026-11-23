// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a parcel is (wave 0111) on every available dialect: a status moves
 * forward only, a real event moves the label's keeping clock, a changed number
 * lands whole or not at all, and test bookings are never matched or refreshed.
 */
import { describe, expect, it } from 'vitest';

import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_TRACK_FINAL_RANK, shippingBookingsRepo, shippingTrackingRepo, type NewShippingBooking } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

type NewEvent = Parameters<ReturnType<typeof shippingTrackingRepo>['storeEvent']>[0];

const T0 = 1_750_000_000_000;
const CARRIER = 'mft_carrier';
const input = (rowKey: string, over: Partial<NewShippingBooking> = {}): NewShippingBooking => ({
  installId: 'mft_shop',
  connectionId: 'conn_one',
  tableRef: 'orders',
  tableName: 'shop_orders',
  rowKey,
  purpose: 'outbound',
  parcelNumber: 1,
  carrierInstallId: CARRIER,
  carrierKey: 'shipping-shippo',
  reference: `MP-${rowKey}`,
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
const event = (dedupe: string, over: Partial<NewEvent> = {}): NewEvent => ({
  carrierInstallId: CARRIER,
  kind: 'track',
  tracking: 'TRK-1',
  transactionId: null,
  rateRef: null,
  status: 'TRANSIT',
  statusAt: T0,
  trackingUrl: null,
  dedupeHash: dedupe.repeat(64).slice(0, 64),
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`shipping tracking [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    const reserved = async (rowKey: string, over: Partial<NewShippingBooking> = {}, at = T0) => {
      const out = await shippingBookingsRepo(meta()).reserve(input(rowKey, over), at);
      if (!out.ok) throw new Error('not reserved');
      return out.booking.id;
    };
    const booked = async (rowKey: string, over: Partial<NewShippingBooking> = {}, at = T0) => {
      const id = await reserved(rowKey, over, at);
      expect(await shippingBookingsRepo(meta()).move(id, ['reserved'], 'booked', { tracking: `TRK-${rowKey}`, carrierShipmentId: `tx-${rowKey}` }, at)).toBe(true);
      await shippingTrackingRepo(meta()).ensureParcel(id, over.carrierInstallId ?? CARRIER, at);
      return id;
    };

    it('moves a status forward only, and lets a failed delivery be sent out again', async () => {
      const repo = shippingTrackingRepo(meta());
      const id = await booked('1');
      await repo.ensureParcel(id, CARRIER, T0);
      expect(await repo.applyStatus(id, 'UNKNOWN', T0 + 100, T0)).toBe(true);
      expect(await repo.applyStatus(id, 'UNKNOWN', T0 + 200, T0)).toBe(false);
      // A real status replaces UNKNOWN whatever its date.
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 10, T0)).toBe(true);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 10, T0)).toBe(false);
      expect(await repo.applyStatus(id, 'PRE_TRANSIT', T0 + 20, T0)).toBe(false);
      expect(await repo.applyStatus(id, 'DELIVERED', T0 + 5, T0)).toBe(false);
      expect(await repo.applyStatus(id, 'FAILURE', T0 + 30, T0)).toBe(true);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 40, T0)).toBe(true);
      expect(await repo.applyStatus(id, 'DELIVERED', T0 + 50, T0)).toBe(true);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 60, T0)).toBe(false);
      expect(await repo.parcel(id)).toMatchObject({ status: 'DELIVERED', statusRank: 100, statusAt: T0 + 50 });
    });

    it('keeps a label from its last real event, never backwards and never once it is gone', async () => {
      const repo = shippingTrackingRepo(meta());
      const bookings = shippingBookingsRepo(meta());
      const id = await booked('1');
      const before = (await bookings.byId(id))!.labelClockAt;
      expect(await repo.applyStatus(id, 'UNKNOWN', T0 + 5, T0)).toBe(true);
      expect((await bookings.byId(id))!.labelClockAt).toBe(before);
      // An event dated before the purchase is a status, but it does not move the clock.
      expect(await repo.applyStatus(id, 'PRE_TRANSIT', T0 - 1_000, T0)).toBe(true);
      expect((await bookings.byId(id))!.labelClockAt).toBe(before);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 10, T0)).toBe(true);
      expect((await bookings.byId(id))!.labelClockAt).toBe(T0 + 10);
      expect(await repo.applyStatus(id, 'PRE_TRANSIT', T0 + 5, T0)).toBe(false);
      expect((await bookings.byId(id))!.labelClockAt).toBe(T0 + 10);
      await bookings.markLabelGone(id, 'kept-90', T0 + 20);
      expect(await repo.applyStatus(id, 'DELIVERED', T0 + 30, T0)).toBe(true);
      expect((await bookings.byId(id))!.labelClockAt).toBe(T0 + 10);
    });

    it('does not write an answer about a number that has changed since it was asked', async () => {
      const repo = shippingTrackingRepo(meta());
      const id = await booked('1');
      expect(await repo.changeNumber({ bookingId: id, carrierInstallId: CARRIER, from: 'TRK-1', to: 'TRK-2', trackingUrl: null, carrierAt: T0 + 1, at: T0 + 5 })).toBe('changed');
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 6, T0 + 6, null)).toBe(false);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 6, T0 + 6, T0 + 4)).toBe(false);
      expect(await repo.applyStatus(id, 'TRANSIT', T0 + 6, T0 + 6, T0 + 5)).toBe(true);
    });

    it('changes a number whole, keeps the old one, and refuses an older or stale change', async () => {
      const repo = shippingTrackingRepo(meta());
      const bookings = shippingBookingsRepo(meta());
      const id = await booked('1');
      await repo.applyStatus(id, 'TRANSIT', T0 + 1, T0 + 1);
      const change = { bookingId: id, carrierInstallId: CARRIER, trackingUrl: 'https://track.example/2', at: T0 + 10 };
      expect(await repo.changeNumber({ ...change, from: 'TRK-1', to: 'TRK-2', carrierAt: T0 + 5 })).toBe('changed');
      expect(await bookings.byId(id)).toMatchObject({ tracking: 'TRK-2', trackingUrl: 'https://track.example/2' });
      expect(await repo.parcel(id)).toMatchObject({ status: null, statusRank: -1, statusAt: null, oldNumbers: ['TRK-1'], numberChangedAt: T0 + 10, numberAt: T0 + 5 });

      expect(await repo.changeNumber({ ...change, from: 'TRK-2', to: 'TRK-0', carrierAt: T0 + 4 })).toBe('older');
      expect((await bookings.byId(id))!.tracking).toBe('TRK-2');

      // The booking no longer holds `from`: the parcel's half of the change rolls back too.
      expect(await repo.changeNumber({ ...change, from: 'TRK-9', to: 'TRK-3', carrierAt: T0 + 6, at: T0 + 20 })).toBe('moved');
      expect((await bookings.byId(id))!.tracking).toBe('TRK-2');
      expect(await repo.parcel(id)).toMatchObject({ oldNumbers: ['TRK-1'], numberChangedAt: T0 + 10, numberAt: T0 + 5 });

      await expect(repo.changeNumber({ ...change, from: 'TRK-2', to: 'x'.repeat(SHIPPING_CARRIER_TEXT_WIDTH + 1), carrierAt: T0 + 7 })).rejects.toThrow(/longer than its column/);
    });

    it('reads a damaged list of old numbers as empty', async () => {
      const repo = shippingTrackingRepo(meta());
      const id = await booked('1');
      for (const text of ['not json', '{"a":1}', '["TRK-1",7]']) {
        await meta().db.updateTable('adminium_shipping_parcels').set({ oldNumbers: text }).where('bookingId', '=', id).execute();
        expect((await repo.parcel(id))!.oldNumbers).toEqual(text.startsWith('[') ? ['TRK-1'] : []);
      }
    });

    it('keeps one row per install for its token, health, cool-down and polling allowance', async () => {
      const repo = shippingTrackingRepo(meta());
      expect(await repo.install(CARRIER)).toBeNull();
      await repo.setToken(CARRIER, 'h'.repeat(64), 'abcd', T0);
      await repo.setToken(CARRIER, 'i'.repeat(64), 'wxyz', T0 + 1);
      expect(await repo.install(CARRIER)).toMatchObject({ tokenHash: 'i'.repeat(64), tokenHint: 'wxyz', tokenMadeAt: T0 + 1, pollCalls: 0 });

      await repo.heard(CARRIER, T0 + 10);
      await repo.heard(CARRIER, T0 + 20);
      expect(await repo.install(CARRIER)).toMatchObject({ firstAt: T0 + 10, lastAt: T0 + 20 });

      await repo.badToken(CARRIER, T0 + 100);
      await repo.badToken(CARRIER, T0 + 30_000);
      expect((await repo.install(CARRIER))!.lastBadAt).toBe(T0 + 100);
      await repo.badToken(CARRIER, T0 + 60_100);
      expect((await repo.install(CARRIER))!.lastBadAt).toBe(T0 + 60_100);

      expect(await repo.claimRefresh(CARRIER, T0, 5_000)).toBe(true);
      expect(await repo.claimRefresh(CARRIER, T0 + 4_999, 5_000)).toBe(false);
      expect(await repo.claimRefresh(CARRIER, T0 + 5_000, 5_000)).toBe(true);

      await repo.setPolling(CARRIER, true, T0 + 1);
      expect((await repo.install(CARRIER))!.pollOnAt).toBe(T0 + 1);
      await repo.setPolling(CARRIER, false, T0 + 2);
      expect((await repo.install(CARRIER))!.pollOnAt).toBeNull();

      expect(await repo.takePollCall(CARRIER, '2026-11', 2, T0)).toBe(true);
      expect(await repo.takePollCall(CARRIER, '2026-11', 2, T0)).toBe(true);
      expect(await repo.takePollCall(CARRIER, '2026-11', 2, T0)).toBe(false);
      expect(await repo.takePollCall(CARRIER, '2026-12', 2, T0)).toBe(true);
      expect(await repo.install(CARRIER)).toMatchObject({ pollMonth: '2026-12', pollCalls: 1 });

      await repo.clearToken(CARRIER, T0 + 3);
      expect(await repo.install(CARRIER)).toMatchObject({ tokenHash: null, tokenHint: null, tokenMadeAt: T0 + 1, firstAt: T0 + 10 });
    });

    it('stores an event once, finishes it once, and prunes it when its use is past', async () => {
      const repo = shippingTrackingRepo(meta());
      const first = await repo.storeEvent(event('a'), T0);
      expect(first).not.toBeNull();
      expect(await repo.storeEvent(event('a'), T0 + 1)).toBeNull();
      await expect(repo.storeEvent(event('b', { tracking: 'x'.repeat(SHIPPING_CARRIER_TEXT_WIDTH + 1) }), T0)).rejects.toThrow(/longer than its columns/);
      const second = await repo.storeEvent(event('c', { kind: 'transaction', transactionId: 'tx-1', rateRef: 'rate-1', status: 'SUCCESS' }), T0 + 10);

      expect(await repo.event('ste_none')).toBeNull();
      expect(await repo.event(second!)).toMatchObject({ kind: 'transaction', transactionId: 'tx-1', rateRef: 'rate-1', state: 'waiting', outcome: null, processedAt: null });
      expect(await repo.waitingCount(CARRIER)).toBe(2);
      expect((await repo.waitingEvents(T0 + 5, 10)).map((one) => one.id)).toEqual([first]);

      expect(await repo.finishEvent(first!, 'no-match', T0 + 20)).toBe(true);
      expect(await repo.finishEvent(first!, 'applied', T0 + 21)).toBe(false);
      expect(await repo.event(first!)).toMatchObject({ state: 'done', outcome: 'no-match', processedAt: T0 + 20 });
      expect(await repo.finishEvent(second!, 'x'.repeat(40), T0 + 30)).toBe(true);
      expect((await repo.event(second!))!.outcome).toHaveLength(16);
      expect(await repo.waitingCount(CARRIER)).toBe(0);

      // An unmatched event goes at the sooner limit, and the other waits for the later one.
      await repo.pruneEvents(T0, T0 + 25);
      expect(await repo.event(first!)).toBeNull();
      expect(await repo.event(second!)).not.toBeNull();
      await repo.pruneEvents(T0 + 30, T0);
      expect(await repo.event(second!)).toBeNull();
    });

    it('matches a claim only to a live booked label of its own install', async () => {
      const repo = shippingTrackingRepo(meta());
      const live = await booked('1');
      await booked('2', { mode: 'test' });
      await booked('3', { carrierInstallId: 'mft_other' });
      expect(await repo.liveBookedByTracking(CARRIER, 'TRK-1')).toEqual([live]);
      expect(await repo.liveBookedByTracking(CARRIER, 'TRK-2')).toEqual([]);
      expect(await repo.liveBookedByTracking(CARRIER, 'TRK-3')).toEqual([]);
      expect(await repo.liveBookedByShipment(CARRIER, 'tx-1')).toEqual([live]);
      expect(await repo.liveBookedByShipment(CARRIER, 'tx-2')).toEqual([]);

      const bookings = shippingBookingsRepo(meta());
      const sealed = await reserved('4', { handleSealed: 'sealed-handle' });
      const bare = await reserved('5');
      const testOne = await reserved('6', { handleSealed: 'sealed-handle', mode: 'test' });
      for (const id of [sealed, bare, testOne]) await bookings.move(id, ['reserved'], 'unknown', {}, T0);
      expect(await repo.liveUnknown(CARRIER, 10)).toEqual([sealed]);
    });

    it('notes what happened to a parcel, one person a minute', async () => {
      const repo = shippingTrackingRepo(meta());
      const id = await booked('1');
      expect(await repo.parcel('shb_none')).toBeNull();
      expect((await repo.parcels([])).size).toBe(0);
      expect([...(await repo.parcels([id, 'shb_none'])).keys()]).toEqual([id]);

      expect(await repo.claimTry(id, T0, 60_000)).toBe(true);
      expect(await repo.claimTry(id, T0 + 59_999, 60_000)).toBe(false);
      expect(await repo.claimTry(id, T0 + 60_000, 60_000)).toBe(true);
      await repo.markChecked(id, T0 + 1);
      await repo.markPolled(id, T0 + 2);
      expect(await repo.parcel(id)).toMatchObject({ checkedAt: T0 + 1, polledAt: T0 + 2, triedAt: T0 + 2 });

      const unseen = await booked('2');
      await meta().db.deleteFrom('adminium_shipping_parcels').where('bookingId', '=', unseen).execute();
      await repo.flag(unseen, CARRIER, 'two-bookings-with-one-number', T0);
      expect((await repo.parcel(unseen))!.flag).toHaveLength(16);
      await repo.clearFlag(unseen, T0 + 1);
      expect((await repo.parcel(unseen))!.flag).toBeNull();
    });

    it('lists only open live parcels in its scope, longest-untried first', async () => {
      const repo = shippingTrackingRepo(meta());
      const a = await booked('1', {}, T0);
      const b = await booked('2', {}, T0 + 1);
      const c = await booked('3', {}, T0 + 2);
      const noParcelRow = await booked('4', {}, T0 + 3);
      await meta().db.deleteFrom('adminium_shipping_parcels').where('bookingId', '=', noParcelRow).execute();

      const delivered = await booked('5', {}, T0);
      await repo.applyStatus(delivered, 'DELIVERED', T0 + 5, T0 + 5);
      expect((await repo.parcel(delivered))!.statusRank).toBeGreaterThanOrEqual(SHIPPING_TRACK_FINAL_RANK);
      await booked('6', { mode: 'test' }, T0);
      await booked('7', { carrierInstallId: 'mft_other' }, T0);
      await booked('8', { connectionId: 'conn_two' }, T0);
      await booked('9', { installId: 'mft_shop_two' }, T0);
      await booked('10', {}, T0 - 10_000);
      await reserved('11');

      const scope = { carrierInstallId: CARRIER, connectionId: 'conn_one', installId: 'mft_shop' };
      await repo.claimTry(a, T0 + 100, 1);
      const ids = async (limit = 10, offset = 0) => (await repo.openParcels(scope, T0, limit, offset)).map((one) => one.bookingId);
      expect(await ids()).toEqual([b, c, noParcelRow, a]);
      expect(await ids(2)).toEqual([b, c]);
      expect(await ids(2, 2)).toEqual([noParcelRow, a]);

      const listed = await repo.openParcels(scope, T0, 10);
      expect(listed.find((one) => one.bookingId === noParcelRow)).toMatchObject({ rank: -1, statusAt: null, checkedAt: null, polledAt: null, createdAt: T0 + 3 });
      const wide = (await repo.openParcels({ carrierInstallId: CARRIER }, T0, 20)).map((one) => one.bookingId);
      expect(wide).toHaveLength(6);
      expect(wide).toEqual(expect.arrayContaining([a, b, c, noParcelRow]));
    });
  });
}
