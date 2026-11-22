// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LOCKS ON REAL SHIPPING, IN CODE.
 *
 * Each is a literal `false`. No environment variable, setting or database row
 * reads into them, so nothing an operator or an attacker can reach turns one
 * on: changing one is a reviewed commit to this file.
 *
 *  - DHL's real mode: its contract is not yet proved against a real account,
 *    so it stays a demo that runs in the browser, and the engine refuses it a
 *    real call before its key is ever read.
 *  - Background carrier calls: every call to a carrier comes from a person's
 *    action until the carrier's own terms for polling are settled.
 *  - International parcels: this release ships inside one country.
 */

export const DHL_CARRIER_KEY = 'shipping-dhl';

export const DHL_REAL_MODE_ENABLED = false;

export const BACKGROUND_CARRIER_CALLS_ENABLED = false;

export const INTERNATIONAL_ENABLED = false;

/** Whether this carrier may not be called for real at all. Asked before its credential is read. */
export function carrierLocked(key: string): boolean {
  return key === DHL_CARRIER_KEY && !DHL_REAL_MODE_ENABLED;
}
