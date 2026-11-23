// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BOOKING A LABEL, and what became of one.
 *
 *  - `GET  …/bookings`             is this parcel booked? Book is drawn only
 *                                  on a positive "no booking".
 *  - `POST …/bookings`             buys one label. It names a stored quote and
 *                                  a rate, and nothing else: the server reads
 *                                  the order again, and refuses if it changed.
 *  - `POST …/bookings/:id/check`   a person asks the carrier what became of an
 *                                  unknown purchase.
 *  - `POST …/bookings/:id/release` someone who manages shipping declares that
 *                                  no label exists, after a quiet period.
 *
 * Every route is for a signed-in person who reaches the order. No reply holds
 * a carrier's handle, and someone who cannot see money is told none.
 */
import type { Address, CustomsDeclaration, Parcel, ShipmentPurpose } from '@adminium/add-on-contracts';
import { SHIPPING_CARRIER_TEXT_WIDTH, shippingBookingsRepo, shippingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb, type ShippingBooking, type ShippingSlot, shippingTrackingRepo } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import { venueDayOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { grantKeyOf } from '../../installs/resolve.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { pkOfRowKey, type PayableSources } from '../../payments/payables.js';
import { appShippingPermission, PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { pricesHiddenFrom, shippingPerson, shippingViewerOf, type ShippingViewer } from '../../shipping/access.js';
import { recipientAbroad, recipientForRates } from '../../shipping/addresses.js';
import { readCustomsChoice, type CustomsChoice, type InternationalSettings } from '../../shipping/customs.js';
import { checkRefund, requestRefund } from '../../shipping/refunds.js';
import { trackViewOf } from '../../shipping/tracking.js';
import { FOREIGN_LABEL_REASON, bookingView, buyLabel, foreignLabelOn, lookUpBooking, releaseBooking, settleStale, type BookingDeps } from '../../shipping/bookings.js';
import { shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import { checkedAccount } from '../../shipping/keys.js';
import { firstFetch, labelSizeOf, type LabelDeps } from '../../shipping/labels.js';
import { rateWithinLimit } from '../../shipping/limits.js';
import { readQuoteForBooking } from '../../shipping/quotes.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import { carrierAccounts, shopShipping } from '../../shipping/shop.js';
import { bookBody, bookingIdParams, bookingQuery, bookingReply, bookingsReply, lookUpReply, refundBody, refundReply, releaseBody, shippingParams } from './schema.js';

/** The order, as this person reaches it. */
export interface ReachedOrder {
  mapping: { table: string; tracking?: string | undefined };
  table: { id: string; columns: ReadonlyMap<string, unknown> };
  row: Record<string, unknown>;
  rowKey: string;
  reference: string;
}

/** The order, ready for a carrier: everything a quote or a purchase refuses on, already asked. */
export interface ShippableOrder extends ReachedOrder {
  carrierKey: string;
  from: Address;
  to: Address;
  limits: Awaited<ReturnType<ReturnType<typeof shippingRepo>['limits']>>;
  venueDay: string;
  pricesHidden: boolean;
  /** The shop's countries and customs defaults, once its owner has saved them. */
  international: InternationalSettings | null;
}

export interface ShippingBookingRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  secret: string;
  sources: PayableSources;
  carrierDeps(request: FastifyRequest): ShippingCarrierDeps;
  appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }>;
  reachOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, source: { table: string; id: string }): Promise<ReachedOrder>;
  shippableOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, viewer: ShippingViewer, source: { table: string; id: string }, purpose: ShipmentPurpose): Promise<ShippableOrder>;
  withoutCarrierWords(error: unknown): unknown;
  /** What is declared for this parcel, read from the order again. */
  declareCustoms(install: InstalledManifest, connectionId: string, order: ShippableOrder, parcel: Parcel, choice: CustomsChoice): Promise<{ declaration: CustomsDeclaration; signerId: string }>;
  bookingDeps(request: FastifyRequest): BookingDeps;
  /** A return label's place on its order, once the return is known to be approved and this person the owner. */
  returnPlace(request: FastifyRequest, install: InstalledManifest, connectionId: string, viewer: ShippingViewer, order: ReachedOrder, returnId: string | undefined): Promise<number>;
  /** What stores a bought label's file. Without it, every label is owed. */
  labelDeps?(request: FastifyRequest): LabelDeps;
}

const parcelSchema = z
  .object({ weightKg: z.number(), lengthCm: z.number(), widthCm: z.number(), heightCm: z.number(), contents: z.string() })
  .strict();

const textOf = (value: unknown): string | null => (value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim());

export function shippingBookingRoutes(deps: ShippingBookingRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests, secret } = deps;

  const refuseNoRight = (install: InstalledManifest) => new ForbiddenError('You may not book labels for this app.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'book') });

  /**
   * A booking on an order this person reaches. One they do not reach is one
   * that is not there, except that someone who manages shipping can still
   * settle a booking whose order has gone: nothing else could ever free its key.
   */
  async function bookingOf(request: FastifyRequest, install: InstalledManifest, connectionId: string, id: string, viewer: ShippingViewer): Promise<{ booking: ShippingBooking; order: ReachedOrder | null }> {
    const missing = () => new NotFoundError('That booking was not found.');
    const booking = await shippingBookingsRepo(meta).byId(id);
    // By the real table, not the install: a booking outlives a reinstall, and still has to be settled.
    if (booking === null || booking.connectionId !== connectionId) throw missing();
    const orderGone = async () => viewer.manages && booking.installId === install.row.id && (await deps.sources.readRow(connectionId, booking.tableName, booking.rowKey).catch(() => null)) === null;
    let order: ReachedOrder;
    try {
      order = await deps.reachOrder(request, install, connectionId, { table: booking.tableRef, id: booking.rowKey });
    } catch (error) {
      if (!(error instanceof ForbiddenError || error instanceof ShippingRefusal || error instanceof NotFoundError)) throw error;
      if (await orderGone()) return { booking, order: null };
      throw missing();
    }
    if (order.table.id !== booking.tableName) {
      if (await orderGone()) return { booking, order: null };
      throw missing();
    }
    return { booking, order };
  }

  return async (app) => {
    tagRoutes(app, 'staff');

    app.get(
      '/apps/:key/shipping/bookings',
      { config: { audit: auditExempt('says how an order\'s labels stand: nothing is bought or changed') }, schema: { params: shippingParams, querystring: bookingQuery, response: { 200: bookingsReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayBook && !viewer.mayCancel && !viewer.mayCustoms) throw refuseNoRight(install);
        const { table: ref, id, purpose = 'outbound', returnId } = request.query;
        const order = await deps.reachOrder(request, install, connectionId, { table: ref, id });
        const parcelNumber = purpose === 'return' && returnId !== undefined ? await deps.returnPlace(request, install, connectionId, viewer, order, returnId) : (request.query.parcelNumber ?? 1);
        const hidden = await pricesHiddenFrom(request, viewer, deps.sources, connectionId, order.table);
        const bookingDeps = deps.bookingDeps(request);
        const repo = shippingBookingsRepo(meta);
        const all = await repo.forRow(connectionId, order.table.id, order.rowKey);
        const settled: ShippingBooking[] = [];
        for (const one of all) settled.push(await settleStale(bookingDeps, one));

        const shop = await shopShipping(meta, manifests, install, connectionId);
        const carrierKey = shop.activeCarrier;
        const account = carrierKey === null ? null : ((await carrierAccounts(meta, manifests, shop.carriers, connectionId))[carrierKey] ?? null);
        const slotHeld = settled.some((one) => one.openKey !== null && one.purpose === purpose && one.parcelNumber === parcelNumber && (account === null || one.mode === account.mode));
        let blockedBy: 'booking' | 'label-on-order' | 'no-carrier' | null = null;
        if (slotHeld) blockedBy = 'booking';
        else if (carrierKey === null || account === null || account.state !== 'ok') blockedBy = 'no-carrier';
        else if (
          account.mode === 'live' &&
          purpose === 'outbound' &&
          (await foreignLabelOn(meta, deps.sources, {
            connectionId,
            tableName: order.table.id,
            rowKey: order.rowKey,
            reference: order.reference,
            carrierKey,
            tracking: order.mapping.tracking === undefined ? null : textOf(order.row[order.mapping.tracking]),
          })) !== null
        ) {
          blockedBy = 'label-on-order';
        }
        const now = app.rbac.now();
        const parcels = await shippingTrackingRepo(meta).parcels(settled.map((one) => one.id));
        return { data: { bookings: settled.map((one) => ({ ...bookingView(one, now, hidden, parcels.get(one.id)), track: trackViewOf(parcels.get(one.id)) })), bookable: blockedBy === null && viewer.mayBook, blockedBy, parcelNumber } };
      },
    );

    app.post(
      '/apps/:key/shipping/bookings',
      { config: { audit: audited('rbac') }, schema: { params: shippingParams, body: bookBody, response: { 200: bookingReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayBook) throw refuseNoRight(install);
        const { quoteId, rateId, confirmEarlier, replaceRefunding, returnId } = request.body;

        const repo = shippingRepo(meta);
        const stored = await repo.quote(quoteId);
        if (stored === null || stored.installId !== install.row.id || stored.connectionId !== connectionId) throw new ShippingRefusal('QUOTE_NOT_FOUND', 'That quote is no longer there. Get rates again.');
        const parcel = parcelSchema.safeParse(stored.parcel);
        if (!parcel.success) throw new ShippingRefusal('QUOTE_NOT_FOUND', 'That quote is no longer there. Get rates again.');

        const purpose = stored.purpose as ShipmentPurpose;
        const order = await deps.shippableOrder(request, install, connectionId, viewer, { table: stored.tableRef, id: stored.rowKey }, purpose);
        // Asked again at purchase: the return may have moved on since the quote, and it must be this return's place.
        if (purpose === 'return' && (await deps.returnPlace(request, install, connectionId, viewer, order, returnId)) !== stored.parcelNumber) {
          throw new ShippingRefusal('QUOTE_NOT_FOUND', 'That quote is no longer there. Get rates again.');
        }
        const slot: ShippingSlot = { installId: install.row.id, connectionId, tableRef: stored.tableRef, rowKey: order.rowKey, purpose, parcelNumber: stored.parcelNumber };
        const place = { ...slot, tableName: order.table.id };

        const abroad = order.to.country !== order.from.country;
        const customsChoice = abroad ? readCustomsChoice(stored.customs) : null;
        // A quote with no ticked declaration was not given for a parcel going abroad.
        if (abroad && customsChoice === null) throw new ShippingRefusal('QUOTE_STALE', 'That quote can no longer be bought. Get rates again.');
        const declared = customsChoice === null ? null : await deps.declareCustoms(install, connectionId, order, parcel.data as Parcel, customsChoice);
        const customs = declared === null ? {} : { customs: declared.declaration };

        const seam = deps.carrierDeps(request);
        const resolved = await shippingCarrierFor(seam, order.carrierKey, connectionId, order.venueDay);
        const account = await checkedAccount(meta, secret, resolved);
        const held = await readQuoteForBooking(meta, secret, {
          quoteId,
          rateId,
          slot,
          carrierKey: order.carrierKey,
          accountFingerprint: account.fingerprint,
          details: { parcel: parcel.data as Parcel, from: order.from, to: order.to, ...customs },
          now: app.rbac.now(),
        });
        if (!held.ok) throw new ShippingRefusal(held.code, 'That quote can no longer be bought. Get rates again.');
        const amountDecimal = held.rate.amountDecimal ?? String(held.rate.amount);
        if (!rateWithinLimit(viewer.manages, order.limits, { amountDecimal, currency: held.rate.currency })) {
          throw new ShippingRefusal('OWNER_BOOKS', 'The owner books this one.', { reason: 'over-limit' });
        }

        const bookingDeps = deps.bookingDeps(request);
        const bookings = shippingBookingsRepo(meta);
        // A label the shop's own data shows and the booking table does not know: held as unknown, never bought over.
        // A row left by a dead process is settled first: it must not hide this check.
        const heldBy = await bookings.open(place, account.mode);
        const settledHolder = heldBy === null ? null : await settleStale(bookingDeps, heldBy);
        if (account.mode === 'live' && purpose === 'outbound' && (settledHolder === null || settledHolder.openKey === null)) {
          const foreign = await foreignLabelOn(meta, deps.sources, {
            connectionId,
            tableName: place.tableName,
            rowKey: slot.rowKey,
            reference: order.reference,
            carrierKey: order.carrierKey,
            tracking: order.mapping.tracking === undefined ? null : textOf(order.row[order.mapping.tracking]),
          });
          if (foreign !== null) {
            const made = await bookings.reserve(
              {
                ...place,
                carrierInstallId: resolved.install.row.id,
                carrierKey: resolved.key,
                reference: order.reference,
                mode: account.mode,
                accountFingerprint: account.fingerprint,
                detailsHash: held.detailsHash,
                service: held.rate.service,
                rateCode: held.rate.code,
                handleSealed: null,
                quotedAmount: amountDecimal,
                quotedCurrency: held.rate.currency.toUpperCase(),
                createdBy: by,
                state: 'unknown',
                reason: FOREIGN_LABEL_REASON,
              },
              app.rbac.now(),
            );
            // The number it is about, so that once someone has looked and released it, it stops holding the order.
            if (made.ok) await bookings.note(made.booking.id, ['unknown'], { tracking: foreign.slice(0, SHIPPING_CARRIER_TEXT_WIDTH) }, app.rbac.now());
            const holder = made.ok ? await bookings.byId(made.booking.id) : made.holder;
            throw new ShippingRefusal('BOOKING_EXISTS', 'This order already shows a label. Check it before buying another.', holder === null ? {} : { booking: bookingView(holder, app.rbac.now(), order.pricesHidden) });
          }
        }

        const dailyLabels = order.limits?.dailyLabels ?? null;
        const bought = await buyLabel(
          bookingDeps,
          {
            slot: place,
            reference: order.reference,
            resolved,
            account,
            quoteId,
            detailsHash: held.detailsHash,
            rate: held.rate,
            // A carrier that binds at quote time ignores these. A customer's phone and email stay here until one needs them.
            details: { parcel: parcel.data as Parcel, ...(purpose === 'return' ? { from: recipientForRates(order.to), to: order.from } : { from: order.from, to: abroad ? recipientAbroad(order.to) : recipientForRates(order.to) }), ...customs, labelSize: await labelSizeOf(meta, install.row.id) },
            by,
            counted: viewer.manages || dailyLabels === null ? null : { day: order.venueDay, dailyLabels },
            confirmEarlier: viewer.manages && confirmEarlier === true,
            replaceRefunding: viewer.mayCancel && replaceRefunding === true,
          },
          order.pricesHidden,
        ).catch((error: unknown) => {
          throw order.pricesHidden ? deps.withoutCarrierWords(error) : error;
        });
        // The label is paid for from here: a file that does not arrive is owed, and never fails the booking.
        const booking = deps.labelDeps === undefined ? bought : await firstFetch(deps.labelDeps(request), bought, resolved, { pk: pkOfRowKey(order.table as unknown as Pick<ResolvedTable, 'primaryKey' | 'columns'>, order.rowKey) ?? {} }, by);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.booking.made',
          changes: { after: { app: install.row.manifestKey, booking: booking.id, carrier: booking.carrierKey, reference: booking.reference, purpose: booking.purpose, parcel: booking.parcelNumber, mode: booking.mode, state: booking.state, ...(declared === null || customsChoice === null ? {} : { customs: { declaredBy: customsChoice.certifiedBy, signer: declared.signerId, to: order.to.country, lines: declared.declaration.items.length } }) } },
        });
        return { data: bookingView(booking, app.rbac.now(), order.pricesHidden) };
      },
    );

    app.post(
      '/apps/:key/shipping/bookings/:id/check',
      { config: { audit: audited('rbac') }, schema: { params: bookingIdParams, response: { 200: lookUpReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayBook) throw refuseNoRight(install);
        const { booking, order } = await bookingOf(request, install, connectionId, request.params.id, viewer);
        const hidden = order === null ? !viewer.manages : await pricesHiddenFrom(request, viewer, deps.sources, connectionId, order.table);
        const seam = deps.carrierDeps(request);
        const resolved = await shippingCarrierFor(seam, booking.carrierKey, connectionId, await venueDayOf(meta, connectionId));
        // The key must be the one that was checked: an answer from another account would read as "not bought".
        const account = await checkedAccount(meta, secret, resolved);
        const result = await lookUpBooking(deps.bookingDeps(request), booking, resolved, account);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.booking.checked',
          changes: { after: { app: install.row.manifestKey, booking: booking.id, outcome: result.outcome, state: result.booking.state } },
        });
        return { data: { outcome: result.outcome, booking: bookingView(result.booking, app.rbac.now(), hidden) } };
      },
    );

    app.post(
      '/apps/:key/shipping/bookings/:id/refund',
      { config: { audit: audited('rbac') }, schema: { params: bookingIdParams, body: refundBody, response: { 200: refundReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayCancel) throw new ForbiddenError('You may not request refunds for this app.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'cancel') });
        const { booking, order } = await bookingOf(request, install, connectionId, request.params.id, viewer);
        const hidden = order === null ? !viewer.manages : await pricesHiddenFrom(request, viewer, deps.sources, connectionId, order.table);
        const resolved = await shippingCarrierFor(deps.carrierDeps(request), booking.carrierKey, connectionId, await venueDayOf(meta, connectionId));
        const account = await checkedAccount(meta, secret, resolved);
        const result = await requestRefund(deps.bookingDeps(request), booking, resolved, account, by).catch((error: unknown) => {
          throw hidden ? deps.withoutCarrierWords(error) : error;
        });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.refund.requested',
          changes: { before: { booking: booking.id, state: booking.state }, after: { app: install.row.manifestKey, booking: booking.id, carrier: booking.carrierKey, reference: booking.reference, declaration: request.body.declaration, outcome: result.outcome, state: result.booking.state } },
        });
        const parcel = await shippingTrackingRepo(meta).parcel(booking.id);
        return { data: { outcome: result.outcome, booking: { ...bookingView(result.booking, app.rbac.now(), hidden, parcel), track: trackViewOf(parcel) } } };
      },
    );

    app.post(
      '/apps/:key/shipping/bookings/:id/refund/check',
      { config: { audit: audited('rbac') }, schema: { params: bookingIdParams, response: { 200: refundReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayCancel && !viewer.mayBook) throw refuseNoRight(install);
        const { booking, order } = await bookingOf(request, install, connectionId, request.params.id, viewer);
        const hidden = order === null ? !viewer.manages : await pricesHiddenFrom(request, viewer, deps.sources, connectionId, order.table);
        const resolved = await shippingCarrierFor(deps.carrierDeps(request), booking.carrierKey, connectionId, await venueDayOf(meta, connectionId));
        const account = await checkedAccount(meta, secret, resolved);
        const result = await checkRefund(deps.bookingDeps(request), booking, resolved, account);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.refund.checked',
          changes: { after: { app: install.row.manifestKey, booking: booking.id, outcome: result.outcome, state: result.booking.state } },
        });
        const parcel = await shippingTrackingRepo(meta).parcel(booking.id);
        return { data: { outcome: result.outcome, booking: { ...bookingView(result.booking, app.rbac.now(), hidden, parcel), track: trackViewOf(parcel) } } };
      },
    );

    app.post(
      '/apps/:key/shipping/bookings/:id/release',
      { preHandler: app.rbac.require(PERMISSIONS.shippingManage), config: { audit: audited('rbac') }, schema: { params: bookingIdParams, body: releaseBody, response: { 200: bookingReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { booking } = await bookingOf(request, install, connectionId, request.params.id, await shippingViewerOf(request, install));
        const released = await releaseBooking(deps.bookingDeps(request), booking, by);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.booking.released',
          changes: {
            before: { booking: booking.id, state: 'unknown' },
            after: { app: install.row.manifestKey, booking: booking.id, carrier: booking.carrierKey, reference: booking.reference, state: released.state, declaration: request.body.declaration, releasedAt: released.releasedAt },
          },
        });
        return { data: bookingView(released, app.rbac.now(), false) };
      },
    );
  };
}
