// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `shipping-carrier@1` (24 §5.5) — one delivery company, shaped so the second
 * one is a copy.
 *
 * The claim "each shipping company is its own add-on, and the next is this repo
 * with one file replaced" rests entirely on the conformance suite in
 * `@adminium/add-on-contracts/testing`, which every transport runs against
 * itself — the demo one and the real one alike.
 */

import { z } from 'zod';

import type { FileRef } from './common.js';

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
  country: string;
}

export interface Rate {
  code: string;
  service: string;
  amount: number;
  currency: string;
  /** ISO date — when the carrier says it arrives. */
  estimatedDelivery: string;
}

export interface OrderRef {
  /** The host's own reference, e.g. `MP-4118`. */
  reference: string;
}

export interface Shipment {
  id: string;
  tracking: string;
  labelFileId: string;
  /** ISO datetime — the collection window the carrier committed to. */
  collectionFrom: string;
  collectionTo: string;
  rate: Rate;
}

export interface TrackEvent {
  at: string;
  place: string;
  status: string;
  description: string;
}

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

  constructor(opts: {
    code: string;
    carrierMessage: string;
    retryable?: boolean;
  }) {
    super(opts.carrierMessage);
    this.name = 'CarrierError';
    this.code = opts.code;
    this.carrierMessage = opts.carrierMessage;
    this.retryable = opts.retryable ?? true;
  }
}

export interface ShippingCarrier {
  readonly key: string;
  quote(parcel: Parcel, from: Address, to: Address): Promise<Rate[]>;
  book(rate: Rate, order: OrderRef): Promise<Shipment>;
  /** An unknown reference returns an empty list — it never throws. */
  track(tracking: string): Promise<TrackEvent[]>;
  label(shipmentId: string): Promise<FileRef>;
  cancel(shipmentId: string): Promise<void>;
}

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
    country: z.string().min(1),
  })
  .strict();

export const rateSchema = z
  .object({
    code: z.string().min(1),
    service: z.string().min(1),
    amount: z.number().nonnegative(),
    currency: z.string().length(3),
    estimatedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'estimatedDelivery must be an ISO date'),
  })
  .strict();

export const shipmentSchema = z
  .object({
    id: z.string().min(1),
    tracking: z.string().min(1),
    labelFileId: z.string().min(1),
    collectionFrom: z.string().min(1),
    collectionTo: z.string().min(1),
    rate: rateSchema,
  })
  .strict();

export const trackEventSchema = z
  .object({
    at: z.string().min(1),
    place: z.string().min(1),
    status: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();
