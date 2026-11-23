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
  /** Cancelled while rates were open: postage for it would be money spent on nothing. */
  ORDER_CANCELLED: 409,
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
  QUOTE_NOT_FOUND: 404,
  QUOTE_EXPIRED: 409,
  /** The order, the carrier or the account is no longer what was quoted. */
  QUOTE_STALE: 409,
  RATE_NOT_IN_QUOTE: 409,
  /** This parcel's place is held by a live booking, which the reply names. */
  BOOKING_EXISTS: 409,
  /** Before buying again, an earlier purchase for this parcel turned up. */
  ALREADY_BOUGHT: 409,
  BOOKING_NOT_UNKNOWN: 409,
  /** An earlier attempt on this parcel cannot be looked up, and nobody who manages shipping confirmed. */
  REBUY_UNCHECKED: 409,
  /** The quiet period before a person may declare that no label exists. */
  RELEASE_TOO_SOON: 409,
  /** The label is paid for and has not been stored yet: a person retries. */
  LABEL_OWED: 409,
  /** The carrier did not hand the file over. The label is still paid for. */
  LABEL_FETCH_FAILED: 502,
  /** Deleted after its keeping time, or with its person. Nothing can fetch it again. */
  LABEL_GONE: 410,
  /** Past the time the carrier keeps it. */
  LABEL_EXPIRED: 410,
  /** A booking with no usable label: not bought, refused, or being refunded. */
  LABEL_NOT_AVAILABLE: 409,
  REFUND_NOT_OPEN: 409,
  REFUND_OTHER_ACCOUNT: 409,
  REFUND_NOT_OFFERED: 409,
  REFUND_TOO_LATE: 409,
  LABEL_SCANNED: 409,
  ORDER_HAS_PAID_LABEL: 409,
  RETURN_NOT_OFFERED: 409,
  RETURN_NOT_APPROVED: 409,
  /** This carrier has no way to hand the file over. */
  LABEL_NOT_OFFERED: 409,
  /** The key saved now opens another account than the one that bought this label. */
  LABEL_OTHER_ACCOUNT: 409,
  /** The file store could not answer. Nothing was changed. */
  LABEL_UNREADABLE: 503,
  /** This carrier has no webhook to point anywhere. */
  TRACKING_NO_WEBHOOK: 409,
  /** A webhook address needs this server's public https address, and there is none, or it is too long for the carrier. */
  NO_PUBLIC_ADDRESS: 409,
  /** Background tracking is locked in code until the carrier's terms are settled. */
  POLLING_LOCKED: 409,
} as const;

export type ShippingRefusalCode = keyof typeof SHIPPING_REFUSAL_STATUS;

export class ShippingRefusal extends AppError {
  override readonly name = 'ShippingRefusal';
  declare readonly code: ShippingRefusalCode;

  constructor(code: ShippingRefusalCode, message: string, details?: Record<string, unknown>) {
    super(SHIPPING_REFUSAL_STATUS[code], code, message, details);
  }
}
