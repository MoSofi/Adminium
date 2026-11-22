// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Why the engine did not ask a carrier, or what the carrier said no to. Each
 * has a stable `code` and the fields a screen needs to say what to do next, so
 * no screen ever has to read a sentence to decide what happened.
 */
import { AppError } from '../errors.js';

export const SHIPPING_REFUSAL_STATUS = {
  APP_NOT_UPDATED: 409,
  NOT_A_SHIPPING_TABLE: 422,
  NO_ACTIVE_CARRIER: 409,
  CARRIER_LOCKED: 409,
  CARRIER_NOT_INSTALLED: 409,
  CARRIER_SWITCHED_OFF: 409,
  CARRIER_NOT_LOADED: 409,
  CARRIER_NO_FACTORY: 409,
  CARRIER_NO_CREDENTIAL: 409,
  /** A key is saved, but no check of that exact key has passed: nobody knows whether it is test or live. */
  CARRIER_NOT_CHECKED: 409,
  /** The carrier cannot say whether a key works, so none is saved. */
  CARRIER_NO_CHECK: 409,
  /** Kept once for the whole server: one shop's key would spend on another's parcels. */
  CARRIER_SERVER_WIDE: 409,
  SHIP_FROM_INCOMPLETE: 422,
  ADDRESS_INCOMPLETE: 422,
  COUNTRY_NOT_RECORDED: 422,
  OUTSIDE_OWN_COUNTRY: 422,
  CARRIER_REFUSED: 422,
  CARRIER_UNAVAILABLE: 502,
  CARRIER_BAD_ANSWER: 502,
  /** The fields sent are not the ones this carrier's key is made of. */
  KEY_FIELDS: 422,
  /** The carrier did not accept the pasted key. Nothing was saved. */
  KEY_REFUSED: 422,
  /** The pasted key opens a different account, and nobody confirmed that. Nothing was saved. */
  KEY_OTHER_ACCOUNT: 409,
  /** A booking on this key has no final answer yet, so the key cannot change. */
  KEY_IN_USE: 409,
  /** Someone who may book, but not this one: no limit is set, or today's is used up. */
  OWNER_BOOKS: 403,
  /** Too many quotes from one person in a minute. */
  QUOTES_TOO_FAST: 429,
} as const;

export type ShippingRefusalCode = keyof typeof SHIPPING_REFUSAL_STATUS;

export class ShippingRefusal extends AppError {
  override readonly name = 'ShippingRefusal';
  declare readonly code: ShippingRefusalCode;

  constructor(code: ShippingRefusalCode, message: string, details?: Record<string, unknown>) {
    super(SHIPPING_REFUSAL_STATUS[code], code, message, details);
  }
}
