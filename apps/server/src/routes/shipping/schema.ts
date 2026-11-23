// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wire shapes of an app's shipping set-up and its quotes.
 *
 * The quote body is strict and has no address in it on purpose: the server
 * reads where a parcel goes from the order, so nothing a client sends can
 * change it. A bad weight or size is refused, never replaced with a guess.
 */
import { HANDOVER_KINDS, LABEL_SIZES, SHIPMENT_PURPOSES } from '@adminium/add-on-contracts';
import { SHIPPING_ID_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH } from '@adminium/meta';
import { z } from 'zod';

import { shipFromBodySchema, shipFromSchema } from '../../shipping/addresses.js';
import { ATTENTION_REASONS } from '../../shipping/attention.js';

const finite = (max: number) => z.number().finite().gt(0).max(max);

export const shippingParams = z.object({ key: z.string().min(1).max(120) });
export const carrierParams = z.object({ key: z.string().min(1).max(120), carrier: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });

/** A pasted key: field names as the manifest declares them. Never echoed, in a reply or in an error. */
export const carrierKeyBody = z
  .object({
    fields: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.string().trim().min(1).max(4096)),
    /** The person saw that this key opens a different account, and means it. */
    confirmAccountChange: z.boolean().optional(),
  })
  .strict();

const amountText = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value), 'A limit is above zero.');

export const limitsBody = z
  .object({
    perLabel: z.object({ amount: amountText, currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable(),
    dailyLabels: z.number().int().min(1).max(100_000).nullable(),
    packersAbroad: z.boolean().optional(),
  })
  .strict()
  .refine((body) => (body.perLabel === null) === (body.dailyLabels === null), 'Set both limits, or neither.');

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
  /** What the carrier said of the saved key. Never the key. */
  account: z
    .object({ mode: z.enum(['live', 'test']), keyHint: z.string(), state: z.enum(['ok', 'refused']), carriers: z.array(z.string()), checkedAt: z.number() })
    .strict()
    .nullable(),
  /** Bookings on this carrier with no final answer: while any stands, its key cannot change. */
  openBookings: z.object({ count: z.number(), orders: z.array(z.string()) }).strict(),
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
    /** The label size this shop asks carriers for. */
    labelSize: z.enum(LABEL_SIZES),
    limits: z.object({
      perLabel: z.object({ amount: z.string(), currency: z.string() }).nullable(),
      dailyLabels: z.number().nullable(),
      packersAbroad: z.boolean(),
      /** Labels counted against the limit on the shop's day, for all packers together. */
      usedToday: z.number(),
    }),
  }),
});

/** What this person may do with the app's labels. Holds no price and no limit in money. */
export const shippingAccessReply = z.object({
  data: z
    .object({
      appUpdated: z.boolean(),
      carrier: z.string().nullable(),
      /** A test key's whole state is visible to everyone who uses it. */
      mode: z.enum(['live', 'test']).nullable(),
      manages: z.boolean(),
      mayBook: z.boolean(),
      mayCancel: z.boolean(),
      mayCustoms: z.boolean(),
      pricesHidden: z.boolean(),
      booking: z.enum(['open', 'no-limit', 'daily-limit', 'no-right']),
      usedToday: z.number().optional(),
      dailyLabels: z.number().optional(),
    })
    .strict(),
});

export const keyCheckReply = z.object({
  data: z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('ok'), mode: z.enum(['live', 'test']), carriers: z.array(z.string()), country: z.string().nullable() }).strict(),
    z.object({ outcome: z.literal('refused'), carrierMessage: z.string().optional() }).strict(),
    z.object({ outcome: z.literal('unreachable') }).strict(),
  ]),
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

export const bookingIdParams = z.object({ key: z.string().min(1).max(120), id: z.string().min(1).max(64) });

export const bookingQuery = z.object({
  /** Which install of the app this means, when it is on several databases. */
  connectionId: z.string().min(1).max(SHIPPING_ID_WIDTH).optional(),
  table: z.string().min(1).max(SHIPPING_TABLE_WIDTH),
  id: z.string().min(1).max(SHIPPING_ROW_WIDTH),
  purpose: z.enum(SHIPMENT_PURPOSES).optional(),
  parcelNumber: z.coerce.number().int().min(1).max(99).optional(),
});

/** A purchase names a stored quote and one of its rates. The order, parcel and price are the server's. */
export const bookBody = z
  .object({
    quoteId: z.string().min(1).max(64),
    rateId: z.string().min(1).max(64),
    /** Someone who manages shipping saw that an earlier attempt cannot be looked up, and means to buy anyway. */
    confirmEarlier: z.boolean().optional(),
  })
  .strict();

/** What a person declares, in so many words, to free an order whose purchase has no known result. */
export const releaseBody = z.object({ declaration: z.literal('no-label-exists') }).strict();

/** Where a parcel is. `checkedAt` is a person's Refresh, never a webhook. */
export const trackView = z
  .object({
    status: z.enum(['UNKNOWN', 'PRE_TRANSIT', 'TRANSIT', 'FAILURE', 'RETURNED', 'DELIVERED']).nullable(),
    statusAt: z.number().nullable(),
    checkedAt: z.number().nullable(),
    flag: z.string().nullable(),
    newNumber: z.boolean(),
  })
  .strict();

const bookingView = z
  .object({
    id: z.string(),
    state: z.enum(['reserved', 'calling', 'booked', 'refused', 'unknown', 'released']),
    test: z.boolean(),
    purpose: z.string(),
    parcelNumber: z.number(),
    carrier: z.string(),
    service: z.string(),
    tracking: z.string().nullable(),
    carrierName: z.string().nullable(),
    reason: z.string().nullable(),
    duplicates: z.number(),
    createdAt: z.number(),
    calledAt: z.number().nullable(),
    checkedAt: z.number().nullable(),
    releaseAfter: z.number().nullable(),
    applied: z.boolean(),
    label: z
      .object({
        state: z.enum(['none', 'ready', 'owed', 'gone']),
        size: z.string().nullable(),
        sizeGot: z.string().nullable(),
        sizeDiffers: z.boolean(),
        customsInvoice: z.boolean(),
      })
      .strict(),
    amount: z.string().optional(),
    currency: z.string().optional(),
    chargeDiffers: z.boolean().optional(),
    track: trackView.nullable().optional(),
  })
  .strict();

export const bookingReply = z.object({ data: bookingView });

export const bookingsReply = z.object({
  data: z
    .object({
      bookings: z.array(bookingView),
      /** True only on a positive "no booking": anything unsure is false, and says why. */
      bookable: z.boolean(),
      blockedBy: z.enum(['booking', 'label-on-order', 'no-carrier']).nullable(),
    })
    .strict(),
});

/** The labels that need a person. Only rows this person reaches, and no carrier handle, key or address. */
export const attentionReply = z.object({
  data: z
    .object({
      items: z.array(
        z
          .object({
            /** Most pressing first. */
            reasons: z.array(z.enum(ATTENTION_REASONS)),
            reference: z.string(),
            source: z.object({ table: z.string(), id: z.string() }).strict(),
            /** The order was deleted, so there is none to open. Only ever true for someone who manages shipping. */
            orderGone: z.boolean(),
            booking: bookingView,
          })
          .strict(),
      ),
      /** The scan was cut, so more may be waiting. */
      more: z.boolean(),
    })
    .strict(),
});

export const lookUpReply = z.object({
  data: z
    .object({
      outcome: z.enum(['found', 'not-bought', 'no-match', 'no-answer', 'cannot-check', 'other-account', 'other-rate']),
      booking: bookingView,
    })
    .strict(),
});

/** A rate for someone who cannot see money: no amount, no currency, and listed in no price order. */
const pricelessRate = offeredRate.omit({ amountDecimal: true, currency: true }).extend({ withinLimit: z.boolean() }).strict();

export const quoteReply = z.object({
  data: z.union([
    z
      .object({
        quoteId: z.string(),
        carrier: z.string(),
        mode: z.enum(['live', 'test']),
        expiresAt: z.number(),
        pricesHidden: z.literal(false),
        rates: z.array(offeredRate.extend({ withinLimit: z.boolean() }).strict()),
      })
      .strict(),
    z
      .object({
        quoteId: z.string(),
        carrier: z.string(),
        mode: z.enum(['live', 'test']),
        expiresAt: z.number(),
        pricesHidden: z.literal(true),
        rates: z.array(pricelessRate),
      })
      .strict(),
  ]),
});
