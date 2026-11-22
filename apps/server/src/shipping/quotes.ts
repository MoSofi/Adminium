// SPDX-License-Identifier: AGPL-3.0-only
/**
 * STORED QUOTES: what a carrier offered for one order, and for what.
 *
 *  - The row holds no name, address or phone. It holds an HMAC of the parcel
 *    and both addresses, keyed from `ADMINIUM_SECRET`, because a plain hash of
 *    an address can be guessed by hashing likely addresses.
 *  - A rate's `ref` and `carrierToken` are what a purchase hands back to the
 *    carrier. They are sealed with a key of their own, so the row does not
 *    show them, and no reply ever carries them: a browser picks a server-made
 *    `rateId`.
 *  - One live quote per slot. A new one replaces the old, so a rate from before
 *    an edit cannot be bought after it.
 *  - Money stays the carrier's exact decimal.
 *  - A purchase re-reads the order and calls {@link readQuoteForBooking}, which
 *    refuses when the details no longer hash the same.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { rateSchema, type Address, type Parcel, type Rate, type ShipmentPurpose } from '@adminium/add-on-contracts';
import { shippingRepo, type MetaDb, type ShippingSlot } from '@adminium/meta';
import { z } from 'zod';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

/** A quote is never good for longer than this, whatever the carrier says. */
export const QUOTE_LIFE_MS = 60 * 60 * 1000;

export interface QuoteDetails {
  parcel: Parcel;
  from: Address;
  to: Address;
  purpose: ShipmentPurpose;
  parcelNumber: number;
}

const hashKeyOf = (secret: string) => deriveKey(secret, 'adminium:shipping-details:v1', 'details');
const sealKeyOf = (secret: string) => deriveKey(secret, 'adminium:shipping-rate-handle:v1', 'handle');

/** JSON with every object's keys in order, so one set of details has one spelling. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The keyed hash of what a quote was given for. */
export function detailsHash(secret: string, details: QuoteDetails): string {
  return createHmac('sha256', hashKeyOf(secret))
    .update(canonical({ parcel: details.parcel, from: details.from, to: details.to, purpose: details.purpose, parcelNumber: details.parcelNumber }))
    .digest('hex');
}

const handleSchema = z.object({ ref: z.string().min(1).optional(), carrierToken: z.string().min(1).optional() }).strict();

/** A rate as the row keeps it: the carrier's handles sealed, the price exact. */
const storedRateSchema = rateSchema
  .omit({ ref: true, carrierToken: true, amountDecimal: true })
  .extend({ rateId: z.string().min(1), amountDecimal: z.string().regex(/^\d+(\.\d+)?$/), sealed: z.string().min(1).optional() })
  .strict();
const storedRatesSchema = z.array(storedRateSchema);
type StoredRate = z.infer<typeof storedRateSchema>;

/** A rate as a reply gives it: nothing a carrier could be called with. */
export interface OfferedRate {
  rateId: string;
  code: string;
  service: string;
  amountDecimal: string;
  currency: string;
  estimatedDelivery?: string;
  estimatedDays?: number;
  expiresAt?: string;
  carrier?: string;
  handover?: NonNullable<Rate['handover']>;
  tracked?: boolean;
}

function toStored(secret: string, rate: Rate): StoredRate {
  const { ref, carrierToken, amountDecimal, ...plain } = rate;
  const handle = { ...(ref === undefined ? {} : { ref }), ...(carrierToken === undefined ? {} : { carrierToken }) };
  return {
    ...plain,
    rateId: `rate_${randomBytes(12).toString('hex')}`,
    amountDecimal: amountDecimal ?? String(rate.amount),
    ...(Object.keys(handle).length === 0 ? {} : { sealed: encryptSecret(JSON.stringify(handle), sealKeyOf(secret)) }),
  };
}

function toOffered(rate: StoredRate): OfferedRate {
  return {
    rateId: rate.rateId,
    code: rate.code,
    service: rate.service,
    amountDecimal: rate.amountDecimal,
    currency: rate.currency,
    ...(rate.estimatedDelivery === undefined ? {} : { estimatedDelivery: rate.estimatedDelivery }),
    ...(rate.estimatedDays === undefined ? {} : { estimatedDays: rate.estimatedDays }),
    ...(rate.expiresAt === undefined ? {} : { expiresAt: rate.expiresAt }),
    ...(rate.carrier === undefined ? {} : { carrier: rate.carrier }),
    ...(rate.handover === undefined ? {} : { handover: rate.handover }),
    ...(rate.tracked === undefined ? {} : { tracked: rate.tracked }),
  };
}

export interface StoredQuoteReply {
  quoteId: string;
  carrier: string;
  expiresAt: number;
  rates: OfferedRate[];
}

/** Keeps the carrier's rates as this slot's one quote, in place of any before it. */
export async function storeQuote(meta: MetaDb, secret: string, input: { slot: ShippingSlot; carrierKey: string; details: QuoteDetails; rates: readonly Rate[]; createdBy: string | null; now: number }): Promise<StoredQuoteReply> {
  const stated = input.rates.flatMap((rate) => (rate.expiresAt === undefined ? [] : [Date.parse(rate.expiresAt)]));
  const expiresAt = Math.min(input.now + QUOTE_LIFE_MS, ...stated);
  const rates = input.rates.map((rate) => toStored(secret, rate));
  const quote = await shippingRepo(meta).replaceQuote(
    { ...input.slot, carrierKey: input.carrierKey, detailsHash: detailsHash(secret, input.details), rates, createdBy: input.createdBy, expiresAt },
    input.now,
  );
  return { quoteId: quote.id, carrier: input.carrierKey, expiresAt, rates: rates.map(toOffered) };
}

export type QuoteRefusalCode = 'QUOTE_NOT_FOUND' | 'QUOTE_EXPIRED' | 'QUOTE_STALE' | 'RATE_NOT_IN_QUOTE';

export type QuoteForBooking = { ok: true; quoteId: string; carrierKey: string; rate: Rate } | { ok: false; code: QuoteRefusalCode };

function sameSlot(a: ShippingSlot, b: ShippingSlot): boolean {
  return a.installId === b.installId && a.connectionId === b.connectionId && a.tableRef === b.tableRef && a.rowKey === b.rowKey && a.purpose === b.purpose && a.parcelNumber === b.parcelNumber;
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The rate a person chose, only if the order is still what was quoted.
 * `details` must be read again from the order and Ship from just before this,
 * and `carrierKey` is the shop's carrier now: a quote that was being stored as
 * the owner changed carrier is not one the shop still means to buy.
 * A quote of another order reads as one that does not exist.
 */
export async function readQuoteForBooking(meta: MetaDb, secret: string, input: { quoteId: string; rateId: string; slot: ShippingSlot; carrierKey: string; details: Omit<QuoteDetails, 'purpose' | 'parcelNumber'>; now: number }): Promise<QuoteForBooking> {
  const quote = await shippingRepo(meta).quote(input.quoteId);
  if (quote === null || !sameSlot(quote, input.slot)) return { ok: false, code: 'QUOTE_NOT_FOUND' };
  if (quote.expiresAt <= input.now) return { ok: false, code: 'QUOTE_EXPIRED' };
  if (quote.carrierKey !== input.carrierKey) return { ok: false, code: 'QUOTE_STALE' };
  const hash = detailsHash(secret, { ...input.details, purpose: input.slot.purpose as ShipmentPurpose, parcelNumber: input.slot.parcelNumber });
  if (!sameHash(hash, quote.detailsHash)) return { ok: false, code: 'QUOTE_STALE' };
  const rates = storedRatesSchema.safeParse(quote.rates);
  if (!rates.success) return { ok: false, code: 'QUOTE_NOT_FOUND' };
  const stored = rates.data.find((rate) => rate.rateId === input.rateId);
  if (stored === undefined) return { ok: false, code: 'RATE_NOT_IN_QUOTE' };
  const { rateId: _rateId, sealed, ...plain } = stored;
  let handle: z.infer<typeof handleSchema> = {};
  if (sealed !== undefined) {
    try {
      handle = handleSchema.parse(JSON.parse(decryptSecret(sealed, sealKeyOf(secret))));
    } catch {
      // Sealed under another secret: this server cannot buy it, so it is a quote to ask for again.
      return { ok: false, code: 'QUOTE_NOT_FOUND' };
    }
  }
  return { ok: true, quoteId: quote.id, carrierKey: quote.carrierKey, rate: { ...plain, ...handle } as Rate };
}
