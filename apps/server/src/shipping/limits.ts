// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT SOMEONE WHO DOES NOT MANAGE SHIPPING MAY SPEND.
 *
 * The owner sets two figures per app install: the most one label may cost, and
 * how many labels all such people together may buy on the shop's day. Until
 * both are set the owner books. A rate in another currency is above the limit,
 * because no exchange rate is guessed. Money is compared as exact decimals.
 */
import type { ShippingLimits } from '@adminium/meta';

export type BookingState = 'open' | 'no-limit' | 'daily-limit';

const DECIMAL = /^\d+(\.\d+)?$/;

function scaled(value: string, places: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(places, '0')}`);
}

/** Whether `amount` is at most `limit`, both exact decimal strings. Anything else is not. */
export function decimalAtMost(amount: string, limit: string): boolean {
  if (!DECIMAL.test(amount) || !DECIMAL.test(limit)) return false;
  const places = Math.max(amount.split('.')[1]?.length ?? 0, limit.split('.')[1]?.length ?? 0);
  return scaled(amount, places) <= scaled(limit, places);
}

/** Whether the owner has set both figures. */
export function limitsSet(limits: ShippingLimits | null): limits is ShippingLimits & { labelLimit: string; labelCurrency: string; dailyLabels: number } {
  return limits !== null && limits.labelLimit !== null && limits.labelCurrency !== null && limits.dailyLabels !== null;
}

/** Whether someone bound by the limits may book at all today. A manager is not bound. */
export function bookingState(manages: boolean, limits: ShippingLimits | null, usedToday: number): BookingState {
  if (manages) return 'open';
  if (!limitsSet(limits)) return 'no-limit';
  return usedToday >= limits.dailyLabels ? 'daily-limit' : 'open';
}

/** Whether one rate is inside the per-label limit. A manager is not bound. */
export function rateWithinLimit(manages: boolean, limits: ShippingLimits | null, rate: { amountDecimal: string; currency: string }): boolean {
  if (manages) return true;
  if (!limitsSet(limits)) return false;
  return rate.currency.toUpperCase() === limits.labelCurrency && decimalAtMost(rate.amountDecimal, limits.labelLimit);
}

/** International parcels are the owner's, unless the owner turned them on for people who also hold the customs right. */
export function mayShipAbroad(viewer: { manages: boolean; mayCustoms: boolean }, limits: ShippingLimits | null): boolean {
  if (viewer.manages) return true;
  return limitsSet(limits) && limits.packersAbroad && viewer.mayCustoms;
}

export const QUOTES_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const MAX_PEOPLE = 10_000;

/** How many quotes one person may ask for in a minute: each one can cost the shop money at the carrier. */
export function createQuoteGate(perMinute: number = QUOTES_PER_MINUTE) {
  const seen = new Map<string, number[]>();
  return {
    /** Counts one quote, or answers how many seconds until there is room. */
    take(person: string, now: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
      const recent = (seen.get(person) ?? []).filter((at) => at > now - WINDOW_MS);
      if (recent.length >= perMinute) {
        seen.set(person, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000)) };
      }
      recent.push(now);
      // The oldest person goes first, so the map cannot grow without end.
      seen.delete(person);
      if (seen.size >= MAX_PEOPLE) seen.delete(seen.keys().next().value!);
      seen.set(person, recent);
      return { ok: true };
    },
  };
}
