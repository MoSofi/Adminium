// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wire shapes of an app's shipping set-up and its quotes.
 *
 * The quote body is strict and has no address in it on purpose: the server
 * reads where a parcel goes from the order, so nothing a client sends can
 * change it. A bad weight or size is refused, never replaced with a guess.
 */
import { HANDOVER_KINDS, SHIPMENT_PURPOSES } from '@adminium/add-on-contracts';
import { SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH } from '@adminium/meta';
import { z } from 'zod';

import { shipFromBodySchema, shipFromSchema } from '../../shipping/addresses.js';

const finite = (max: number) => z.number().finite().gt(0).max(max);

export const shippingParams = z.object({ key: z.string().min(1).max(120) });

export const activeCarrierBody = z.object({ carrier: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) }).strict();

export { shipFromBodySchema };

export const quoteBody = z
  .object({
    source: z.object({ table: z.string().min(1).max(SHIPPING_TABLE_WIDTH), id: z.string().min(1).max(SHIPPING_ROW_WIDTH) }).strict(),
    parcel: z
      .object({
        weightKg: finite(1000),
        lengthCm: finite(400),
        widthCm: finite(400),
        heightCm: finite(400),
        contents: z.string().trim().min(1).max(200),
      })
      .strict(),
    purpose: z.enum(SHIPMENT_PURPOSES).optional(),
    parcelNumber: z.number().int().min(1).max(99).optional(),
  })
  .strict();

const carrierView = z.object({
  key: z.string(),
  name: z.string(),
  locked: z.boolean(),
  on: z.boolean(),
  connected: z.boolean(),
});

export const shippingStatusReply = z.object({
  data: z.object({
    /** Whether the app's manifest says where its orders keep an address. */
    appUpdated: z.boolean(),
    carriers: z.array(carrierView),
    activeCarrier: z.string().nullable(),
    shipFrom: shipFromSchema.nullable(),
    shipFromMissing: z.array(z.string()),
    international: z.literal(false),
  }),
});

const offeredRate = z
  .object({
    rateId: z.string(),
    code: z.string(),
    service: z.string(),
    amountDecimal: z.string(),
    currency: z.string(),
    estimatedDelivery: z.string().optional(),
    estimatedDays: z.number().optional(),
    expiresAt: z.string().optional(),
    carrier: z.string().optional(),
    handover: z.enum(HANDOVER_KINDS).optional(),
    tracked: z.boolean().optional(),
  })
  .strict();

export const quoteReply = z.object({
  data: z.object({
    quoteId: z.string(),
    carrier: z.string(),
    expiresAt: z.number(),
    rates: z.array(offeredRate),
  }),
});
