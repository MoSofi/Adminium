// SPDX-License-Identifier: AGPL-3.0-only
/**
 * This server's clock, compared with the payment services' own.
 *
 * Every answer from a payment service carries a `Date` header. A webhook's
 * signature carries a time too, and Stripe accepts one at most five minutes
 * off; that window is never widened here. Instead each answer's date is
 * compared with this clock, and the setup page warns past a minute, while
 * the clock is still near enough for signatures to pass.
 *
 * Kept per service in this process only: it is a fact about this machine's
 * clock, read again with every answer. An HTTP date has whole seconds, so a
 * skew under two seconds is no skew.
 */
import type { PaymentHttpClient } from '@adminium/add-on-contracts';

/** Past this, the setup page warns. */
export const CLOCK_WARN_MS = 60_000;

interface Reading {
  /** The service's clock minus this one, at the last answer. */
  skewMs: number;
  at: number;
}

const readings = new Map<string, Reading>();

/** Notes one answer's `Date` header for a service. */
export function noteServiceDate(key: string, header: string | null, at: number = Date.now()): void {
  if (header === null) return;
  const theirs = Date.parse(header);
  if (Number.isNaN(theirs)) return;
  const skew = theirs - at;
  readings.set(key, { skewMs: Math.abs(skew) < 2_000 ? 0 : skew, at });
}

/** How far a service's clock was from this one at its last answer, or null before any answer. */
export function clockSkewOf(key: string): Reading | null {
  return readings.get(key) ?? null;
}

/** For tests: forgets every reading. */
export function forgetClockReadings(): void {
  readings.clear();
}

/** The egress client of a service, noting each answer's date on its way back. */
export function watchingClock(key: string, http: PaymentHttpClient, now: () => number = Date.now): PaymentHttpClient {
  return async (url, init) => {
    const answer = await http(url, init);
    try {
      noteServiceDate(key, answer.headers.get('date'), now());
    } catch {
      // A header that cannot be read is no reading.
    }
    return answer;
  };
}
