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
  SHIP_FROM_INCOMPLETE: 422,
  ADDRESS_INCOMPLETE: 422,
  COUNTRY_NOT_RECORDED: 422,
  OUTSIDE_OWN_COUNTRY: 422,
  CARRIER_REFUSED: 422,
  CARRIER_UNAVAILABLE: 502,
  CARRIER_BAD_ANSWER: 502,
} as const;

export type ShippingRefusalCode = keyof typeof SHIPPING_REFUSAL_STATUS;

export class ShippingRefusal extends AppError {
  override readonly name = 'ShippingRefusal';
  declare readonly code: ShippingRefusalCode;

  constructor(code: ShippingRefusalCode, message: string, details?: Record<string, unknown>) {
    super(SHIPPING_REFUSAL_STATUS[code], code, message, details);
  }
}
