// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `shipping-carrier@1` — one delivery company, shaped so the second one is a
 * copy.
 *
 * The claim "each shipping company is its own add-on, and the next is this repo
 * with one file replaced" rests entirely on the conformance suite in
 * `@adminium/add-on-contracts/testing`, which every transport runs against
 * itself — the demo one and the real one alike.
 *
 * ── REAL CARRIERS (ruled 2026-11-21) ─────────────────────────────────────────
 *
 * Still version 1: the registry holds one version per contract, so a `@2` would
 * turn every released delivery manifest into an unknown contract. Every new
 * member is optional. Four answer fields a real carrier cannot always give
 * became optional too (`estimatedDelivery`, the collection window and an event's
 * `place`). No released code parses those answers, and a made-up date or window
 * is a promise to a customer nobody made.
 */

import { z } from 'zod';

import type { FileRef } from './common.js';

export const SHIPPING_CARRIER_CONTRACT = 'shipping-carrier';
export const SHIPPING_CARRIER_VERSION = 1;

/** The name a carrier add-on's server half exports its transport factory under. */
export const SHIPPING_CARRIER_FACTORY = 'createShippingCarrier';

export const SHIPMENT_PURPOSES = ['outbound', 'return', 'replacement'] as const;
export type ShipmentPurpose = (typeof SHIPMENT_PURPOSES)[number];

/** How the parcel really leaves the shop. `unknown` is an honest answer, never a default to a van. */
export const HANDOVER_KINDS = ['collection-booked', 'drop-off', 'carrier-collects', 'unknown'] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];

export const LABEL_SIZES = ['a4', 'a6', '4x6'] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

export const CUSTOMS_CONTENTS = ['merchandise', 'gift', 'sample', 'documents', 'return', 'other'] as const;
export type CustomsContents = (typeof CUSTOMS_CONTENTS)[number];

export const SHIPMENT_DOCUMENT_KINDS = ['label', 'customs-invoice'] as const;
export type ShipmentDocumentKind = (typeof SHIPMENT_DOCUMENT_KINDS)[number];

/** What a clear refusal was about, so the screen can say what to do next. */
export const CARRIER_REFUSALS = ['address', 'customs', 'payment', 'credentials', 'rate-expired', 'unavailable'] as const;
export type CarrierRefusal = (typeof CARRIER_REFUSALS)[number];

export const CARRIER_OUTCOMES = ['refused', 'unknown'] as const;
export type CarrierOutcome = (typeof CARRIER_OUTCOMES)[number];

/** A cancel on a real carrier is a refund request, and it can take days or be refused. */
export const CANCEL_STATES = ['requested', 'pending', 'refunded', 'refused'] as const;
export type CancelState = (typeof CANCEL_STATES)[number];

export interface Parcel {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  contents: string;
}

export interface Address {
  name: string;
  lines: string[];
  city: string;
  postcode: string;
  /** A state, province or region, where the country has them: printed after the city, never checked. */
  region?: string;
  country: string;
  company?: string;
  /** Plain text. It is normalised by the caller, and sent only when the carrier needs it. */
  phone?: string;
  email?: string;
}

export interface Rate {
  /** The stable service token. It survives a new quote, so a shop's preferred service can match it. */
  code: string;
  service: string;
  amount: number;
  /** The carrier's exact decimal, kept because `amount` is a float. */
  amountDecimal?: string;
  currency: string;
  /** ISO date — when the carrier says it arrives. Absent when it does not say. */
  estimatedDelivery?: string;
  /** The working days the carrier states. Absent when it states none. */
  estimatedDays?: number;
  /** The carrier's opaque handle for THIS quote. It changes on every quote. */
  ref?: string;
  /** ISO datetime — when this quote stops being buyable, if the carrier says. */
  expiresAt?: string;
  /** The company that moves the parcel, when the transport sells for several. */
  carrier?: string;
  /** The token the transport needs to track this carrier's parcels. */
  carrierToken?: string;
  handover?: HandoverKind;
  tracked?: boolean;
}

export interface OrderRef {
  /** The host's own reference, e.g. `MP-4118`. */
  reference: string;
  /** Absent means `outbound`. */
  purpose?: ShipmentPurpose;
  /** Which parcel of the order, from 1. Absent means 1. */
  parcel?: number;
}

export interface CustomsItem {
  /** In English, specific enough for a customs officer. */
  description: string;
  quantity: number;
  /** One unit's value as an exact decimal string. The total is quantity × this. */
  unitValue: string;
  currency: string;
  /** One unit's net weight. */
  unitWeightKg: number;
  originCountry: string;
  hsCode?: string;
  skuCode?: string;
  manufacturerCode?: string;
}

export interface CustomsDeclaration {
  contents: CustomsContents;
  /** The named person who declares the values are true. */
  signer: string;
  /** Always `true`: a declaration nobody confirmed cannot be expressed. */
  certified: true;
  nonDelivery: 'return' | 'abandon';
  items: CustomsItem[];
}

export interface QuoteOptions {
  purpose?: ShipmentPurpose;
  customs?: CustomsDeclaration;
}

/** What the server re-read for this booking. A carrier that binds them at quote time may ignore them. */
export interface BookingDetails {
  parcel: Parcel;
  from: Address;
  to: Address;
  customs?: CustomsDeclaration;
  labelSize?: LabelSize;
}

export interface TrackOptions {
  carrierToken?: string;
}

/** A document a shipment has. It holds no address to fetch it from: a signed link is never stored. */
export interface ShipmentDocument {
  kind: ShipmentDocumentKind;
  mediaType?: string;
}

export interface ShipmentDocumentFile {
  kind: ShipmentDocumentKind;
  mediaType: string;
  filename?: string;
  bytes: Uint8Array;
}

export interface Shipment {
  id: string;
  tracking: string;
  labelFileId: string;
  /** ISO datetime — the collection window the carrier committed to. Both or neither. */
  collectionFrom?: string;
  collectionTo?: string;
  rate: Rate;
  /** The company that moves the parcel, when the transport sells for several. */
  carrier?: string;
  carrierToken?: string;
  /** The carrier's own tracking page. Absent means the screen shows the number alone. */
  trackingUrl?: string;
  /** Bought with a test key: nothing will be delivered. */
  test?: boolean;
  documents?: ShipmentDocument[];
}

export interface TrackEvent {
  at: string;
  /** Absent when the carrier gave no location for this scan. */
  place?: string;
  status: string;
  description: string;
}

export interface CancelResult {
  state: CancelState;
  /** The carrier's reference for this request. */
  reference?: string;
  /** The carrier's own words, on a refusal. */
  carrierMessage?: string;
  /** What came back, only when the carrier reports it. */
  amountDecimal?: string;
  currency?: string;
}

export interface CredentialCheckQuery {
  /** The shop's country, to ask which carriers answer for it. */
  country?: string;
}

export type CarrierCredentialCheck =
  | {
      outcome: 'ok';
      mode: 'live' | 'test';
      /** Identifies the account without revealing the key. */
      accountFingerprint?: string;
      /** The carriers that answer for the asked country. Empty is a real answer. */
      carriers: string[];
    }
  | { outcome: 'refused'; carrierMessage?: string }
  | { outcome: 'unreachable' };

/**
 * What a look-up after an unanswered purchase found. `no-match` proves nothing:
 * the carrier may not have indexed the purchase yet, so it never frees an order.
 */
export type RecoveryResult =
  | { outcome: 'found'; shipment: Shipment }
  | { outcome: 'not-bought'; carrierMessage?: string }
  | { outcome: 'no-match' };

/**
 * A carrier refusal is DATA, never a thrown string: the works needs the
 * carrier's own message verbatim to act on it, and a rejected postcode is an
 * ordinary outcome rather than a crash.
 */
export class CarrierError extends Error {
  readonly code: string;
  /** The carrier's own words, rendered in mono and quoted in the UI. */
  readonly carrierMessage: string;
  readonly retryable: boolean;
  /** `refused` is the carrier's clear no. On `book`, anything else may have been bought. */
  readonly outcome?: CarrierOutcome;
  readonly reason?: CarrierRefusal;

  constructor(opts: {
    code: string;
    carrierMessage: string;
    retryable?: boolean;
    outcome?: CarrierOutcome;
    reason?: CarrierRefusal;
  }) {
    super(opts.carrierMessage);
    this.name = 'CarrierError';
    this.code = opts.code;
    this.carrierMessage = opts.carrierMessage;
    this.retryable = opts.retryable ?? true;
    if (opts.outcome !== undefined) this.outcome = opts.outcome;
    if (opts.reason !== undefined) this.reason = opts.reason;
  }
}

/** What a failed `book` means, whichever bundle the error's class came from. */
export interface BookFailure {
  outcome: CarrierOutcome;
  code: string;
  /** Present only on a recognised carrier error: other errors can hold anything. */
  carrierMessage?: string;
  reason?: CarrierRefusal;
  /** Whether the same purchase may be tried again. Never true for `unknown`. */
  retryable: boolean;
}

export const BOOK_OUTCOME_UNKNOWN = 'CARRIER_OUTCOME_UNKNOWN';

/**
 * Reads a thrown value by SHAPE, because each add-on's server bundle inlines its
 * own copy of `CarrierError` and `instanceof` is false across that line.
 */
function carrierErrorFields(err: unknown): {
  code: string;
  carrierMessage: string;
  retryable: unknown;
  outcome: unknown;
  reason: unknown;
} | null {
  if (typeof err !== 'object' || err === null) return null;
  const fields = err as Record<string, unknown>;
  if (fields.name !== 'CarrierError') return null;
  const { code, carrierMessage, retryable, outcome, reason } = fields;
  if (typeof code !== 'string' || typeof carrierMessage !== 'string') return null;
  return { code, carrierMessage, retryable, outcome, reason };
}

/**
 * THE RULE THAT PREVENTS A SECOND PAID LABEL: on `book`, only an explicit
 * `outcome: 'refused'` proves nothing was bought. A timeout, a crash, a bad
 * answer and a carrier error that does not say are all `unknown`.
 */
export function classifyBookFailure(err: unknown): BookFailure {
  const fields = carrierErrorFields(err);
  if (fields === null) return { outcome: 'unknown', code: BOOK_OUTCOME_UNKNOWN, retryable: false };
  if (fields.outcome !== 'refused') {
    return { outcome: 'unknown', code: fields.code, carrierMessage: fields.carrierMessage, retryable: false };
  }
  const reason = (CARRIER_REFUSALS as readonly unknown[]).includes(fields.reason)
    ? (fields.reason as CarrierRefusal)
    : undefined;
  return {
    outcome: 'refused',
    code: fields.code,
    carrierMessage: fields.carrierMessage,
    ...(reason === undefined ? {} : { reason }),
    retryable: fields.retryable !== false,
  };
}

export interface ShippingCarrier {
  readonly key: string;
  quote(parcel: Parcel, from: Address, to: Address, options?: QuoteOptions): Promise<Rate[]>;
  book(rate: Rate, order: OrderRef, details?: BookingDetails): Promise<Shipment>;
  /** An unknown reference returns an empty list — it never throws. */
  track(tracking: string, options?: TrackOptions): Promise<TrackEvent[]>;
  label(shipmentId: string): Promise<FileRef>;
  cancel(shipmentId: string): Promise<void>;
  /** The file itself. A carrier without it has only `label`'s metadata. */
  fetchDocument?(shipmentId: string, kind: ShipmentDocumentKind): Promise<ShipmentDocumentFile>;
  /** A cancel that can say what happened. Preferred over `cancel` when present. */
  requestCancel?(shipmentId: string): Promise<CancelResult>;
  cancelStatus?(shipmentId: string): Promise<CancelResult>;
  checkCredentials?(query?: CredentialCheckQuery): Promise<CarrierCredentialCheck>;
  /** Looks for a purchase whose answer never arrived. Never buys anything. */
  recover?(order: OrderRef): Promise<RecoveryResult>;
}

// ── What the engine hands a transport ───────────────────────────────────────

export interface ShippingHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Egress-bound: only hosts in the add-on's `network.allow`, and a redirect is refused. */
export type ShippingHttpClient = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<ShippingHttpResponse>;

export interface ShippingCarrierContext {
  readonly http: ShippingHttpClient;
  /** The stored setting names, decrypted for one call. */
  readonly credentials: Readonly<Record<string, string>>;
  /** The shop's date, so a transport never reads a clock of its own. */
  readonly todayIso: string;
  readonly signal?: AbortSignal;
}

// ── Validators ──────────────────────────────────────────────────────────────

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const decimalSchema = z.string().regex(/^\d+(\.\d+)?$/, 'must be an exact decimal string');
const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code');

export const parcelSchema = z
  .object({
    weightKg: z.number().positive(),
    lengthCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
    contents: z.string().min(1),
  })
  .strict();

export const addressSchema = z
  .object({
    name: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1),
    city: z.string().min(1),
    postcode: z.string().min(1),
    region: z.string().min(1).optional(),
    country: z.string().min(1),
    company: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
  })
  .strict();

export const rateSchema = z
  .object({
    code: z.string().min(1),
    service: z.string().min(1),
    amount: z.number().nonnegative(),
    amountDecimal: decimalSchema.optional(),
    currency: z.string().length(3),
    estimatedDelivery: z.string().regex(isoDate, 'estimatedDelivery must be an ISO date').optional(),
    estimatedDays: z.number().int().nonnegative().optional(),
    ref: z.string().min(1).optional(),
    expiresAt: z.string().min(1).optional(),
    carrier: z.string().min(1).optional(),
    carrierToken: z.string().min(1).optional(),
    handover: z.enum(HANDOVER_KINDS).optional(),
    tracked: z.boolean().optional(),
  })
  .strict();

export const orderRefSchema = z
  .object({
    reference: z.string().min(1),
    purpose: z.enum(SHIPMENT_PURPOSES).optional(),
    parcel: z.number().int().positive().optional(),
  })
  .strict();

export const customsItemSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().int().positive(),
    unitValue: decimalSchema,
    currency: z.string().length(3),
    unitWeightKg: z.number().positive(),
    originCountry: countrySchema,
    hsCode: z.string().min(1).optional(),
    skuCode: z.string().min(1).optional(),
    manufacturerCode: z.string().min(1).optional(),
  })
  .strict();

export const customsDeclarationSchema = z
  .object({
    contents: z.enum(CUSTOMS_CONTENTS),
    signer: z.string().min(1),
    certified: z.literal(true),
    nonDelivery: z.enum(['return', 'abandon']),
    items: z.array(customsItemSchema).min(1),
  })
  .strict();

export const shipmentDocumentSchema = z
  .object({
    kind: z.enum(SHIPMENT_DOCUMENT_KINDS),
    mediaType: z.string().min(1).optional(),
  })
  .strict();

export const shipmentDocumentFileSchema = z
  .object({
    kind: z.enum(SHIPMENT_DOCUMENT_KINDS),
    mediaType: z.string().min(1),
    filename: z.string().min(1).optional(),
    bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0, 'a document has bytes'),
  })
  .strict();

export const shipmentSchema = z
  .object({
    id: z.string().min(1),
    tracking: z.string().min(1),
    labelFileId: z.string().min(1),
    collectionFrom: z.string().min(1).optional(),
    collectionTo: z.string().min(1).optional(),
    rate: rateSchema,
    carrier: z.string().min(1).optional(),
    carrierToken: z.string().min(1).optional(),
    trackingUrl: z.string().regex(/^https:\/\/\S+$/, 'trackingUrl must be https').optional(),
    test: z.boolean().optional(),
    documents: z.array(shipmentDocumentSchema).optional(),
  })
  .strict()
  .refine((s) => (s.collectionFrom === undefined) === (s.collectionTo === undefined), {
    message: 'a collection window has both ends or neither',
    path: ['collectionTo'],
  });

export const trackEventSchema = z
  .object({
    at: z.string().min(1),
    place: z.string().min(1).optional(),
    status: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const cancelResultSchema = z
  .object({
    state: z.enum(CANCEL_STATES),
    reference: z.string().min(1).optional(),
    carrierMessage: z.string().min(1).optional(),
    amountDecimal: decimalSchema.optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

export const carrierCredentialCheckSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('ok'),
      mode: z.enum(['live', 'test']),
      accountFingerprint: z.string().min(1).optional(),
      carriers: z.array(z.string().min(1)),
    })
    .strict(),
  z.object({ outcome: z.literal('refused'), carrierMessage: z.string().min(1).optional() }).strict(),
  z.object({ outcome: z.literal('unreachable') }).strict(),
]);

export const recoveryResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('found'), shipment: shipmentSchema }).strict(),
  z.object({ outcome: z.literal('not-bought'), carrierMessage: z.string().min(1).optional() }).strict(),
  z.object({ outcome: z.literal('no-match') }).strict(),
]);
