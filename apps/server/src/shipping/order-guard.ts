// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ORDER WITH A PAID LABEL CANNOT QUIETLY GO BACKWARDS.
 *
 * Moving an order back, or cancelling it, does not refund its label: the shop
 * keeps paying for it, and the parcel can still go out. So a person's move like
 * that is refused while a live label stands, and the refusal says what to do:
 * request the refund first, or say in so many words that the label stays.
 *
 *  - The answer names the labels it saw (`x-adminium-paid-label`), so a label
 *    bought since is asked about again.
 *  - Only someone who may cancel labels can keep one on a moved order.
 *  - A label with a refund requested no longer holds a move, and a test label
 *    never did: it cost nothing.
 *  - A move Adminium makes itself is not asked: nobody is there to answer.
 */
import { shippingBookingsRepo, shippingTrackingRepo, type ManifestsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { Row } from '../crud/mask.js';
import type { WriteContext, WriteTarget } from '../crud/write-context.js';
import { rowKeyOf } from '../payments/payables.js';
import { shippingViewerOf } from './access.js';
import { claimByOf, labelScanned } from './refund-view.js';
import { ShippingRefusal } from './refusals.js';

/** The header a person's answer travels in: the ids of the labels they were told about. */
export const PAID_LABEL_HEADER = 'x-adminium-paid-label';

function namedIn(request: FastifyRequest | null): ReadonlySet<string> {
  const raw = request?.headers[PAID_LABEL_HEADER];
  const text = Array.isArray(raw) ? raw.join(',') : raw;
  return new Set((text ?? '').split(',').map((one) => one.trim()).filter((one) => one !== '').slice(0, 20));
}

async function mayKeep(manifests: Pick<ManifestsRepo, 'findById'>, request: FastifyRequest | null, installId: string): Promise<boolean> {
  if (request === null || request.apiKeyPrincipal != null) return false;
  if ((request as unknown as { user?: { id?: string } }).user?.id === undefined) return false;
  const install = await manifests.findById(installId);
  return install !== null && (await shippingViewerOf(request, install)).mayCancel;
}

export function paidLabelJudge(meta: MetaDb, manifests: Pick<ManifestsRepo, 'findById'>) {
  return async (target: Pick<WriteTarget, 'connectionId' | 'table'>, context: Pick<WriteContext, 'origin' | 'request'>, row: Row, from: string, to: string): Promise<void> => {
    const all = await shippingBookingsRepo(meta).forRow(target.connectionId, target.table.id, rowKeyOf(target.table, row));
    const live = all.filter((one) => one.state === 'booked' && one.mode === 'live');
    if (live.length === 0) return;
    // A customer's own page is told no more than that the shop must do this.
    if (context.origin === 'public') throw new ShippingRefusal('ORDER_HAS_PAID_LABEL', 'This order is being prepared. Please contact the shop.', {});
    const keeps = await mayKeep(manifests, context.request, live[0]!.installId);
    const named = namedIn(context.request);
    if (keeps && live.every((one) => named.has(one.id))) {
      context.request?.log.info({ bookings: live.map((one) => one.id), from, to }, 'an order was moved with its paid label kept');
      return;
    }
    const parcels = await shippingTrackingRepo(meta).parcels(live.map((one) => one.id));
    const now = Date.now();
    throw new ShippingRefusal('ORDER_HAS_PAID_LABEL', 'This order has a paid label. Moving it does not refund the label.', {
      from,
      to,
      mayKeep: keeps,
      labels: live.map((one) => {
        const scanned = labelScanned(one, parcels.get(one.id));
        const claimBy = claimByOf(one);
        return { booking: one.id, carrier: one.carrierName ?? one.carrierKey, parcel: one.parcelNumber, scanned, claimBy, tooLate: now > claimBy, canRequest: !scanned && now <= claimBy && one.carrierShipmentId !== null };
      }),
    });
  };
}
