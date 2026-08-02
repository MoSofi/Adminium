/**
 * The local-bridge seed store (08-server-api.md §1.2, `routes/bridge`).
 *
 * ── WHAT THE BRIDGE IS, AND WHAT IT DELIBERATELY IS NOT ─────────────────────
 * A web page cannot open a TCP socket to PostgreSQL, so adminium.dev can never
 * introspect a database itself. What it CAN do is hand the connection string to
 * an Adminium already running on the same machine — browser to loopback, never
 * through anyone's server. This module holds that hand-off for the few seconds
 * between "the site posted it" and "the Studio wizard picked it up".
 *
 * The bridge NEVER CONNECTS TO ANYTHING. It parks a string, hands back an
 * opaque ticket, and the authenticated Studio session redeems that ticket to
 * PREFILL A FORM the user still has to look at and submit. That property is what
 * keeps the attack surface at "a page you allow-listed can put text in a field
 * you are about to read" rather than "a page can make your admin panel dial an
 * arbitrary host".
 *
 * Seeds are therefore:
 *  - in memory only — a credential-bearing string never reaches the meta store
 *    or the disk on this path,
 *  - single-use — `take` deletes, so a redeemed ticket is inert,
 *  - short-lived — a ticket nobody redeems expires rather than lingering,
 *  - bounded — the map is capped, so an allow-listed origin looping on the
 *    hand-off route cannot grow the heap without limit.
 */

import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a parked seed stays redeemable. Long enough to log in first. */
export const SEED_TTL_MS = 10 * 60 * 1000;

/** Hard cap on parked seeds. Oldest are evicted first. */
export const SEED_MAX = 32;

export interface BridgeSeed {
  /** The connection string the site handed over. Never logged, never persisted. */
  dsn: string;
  /** The engine the site inferred, when it managed to. */
  engine: string | null;
  createdAt: number;
}

export interface BridgeStore {
  /** Park a seed; returns the opaque ticket that redeems it. */
  put(seed: Omit<BridgeSeed, 'createdAt'>): string;
  /** Redeem a ticket. Returns null if unknown, already used, or expired. */
  take(ticket: string): BridgeSeed | null;
  /** Live (unexpired) seed count — for tests and the `/hello` payload. */
  size(): number;
}

export interface BridgeStoreOptions {
  ttlMs?: number;
  max?: number;
  /** Injected so expiry is testable without timers. */
  now?: () => number;
}

export function createBridgeStore(opts: BridgeStoreOptions = {}): BridgeStore {
  const ttlMs = opts.ttlMs ?? SEED_TTL_MS;
  const max = opts.max ?? SEED_MAX;
  const now = opts.now ?? Date.now;
  const seeds = new Map<string, BridgeSeed>();

  const sweep = (): void => {
    const cutoff = now() - ttlMs;
    for (const [ticket, seed] of seeds) {
      if (seed.createdAt <= cutoff) seeds.delete(ticket);
    }
  };

  return {
    put(seed) {
      sweep();
      // Map preserves insertion order, so the first key is the oldest.
      while (seeds.size >= max) {
        const oldest = seeds.keys().next();
        if (oldest.done === true) break;
        seeds.delete(oldest.value);
      }
      const ticket = randomUUID();
      seeds.set(ticket, { ...seed, createdAt: now() });
      return ticket;
    },

    take(ticket) {
      sweep();
      const seed = seeds.get(ticket);
      if (seed === undefined) return null;
      seeds.delete(ticket); // single-use: redeeming consumes
      return seed;
    },

    size() {
      sweep();
      return seeds.size;
    },
  };
}

// ── pairing ──────────────────────────────────────────────────────────────────

/**
 * Crockford-ish base32 minus the characters people mistype from a terminal:
 * no O/0, no I/1/L. The code is read off a screen and typed into a web page, so
 * ambiguity here is a support burden, not a security property.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;

/**
 * A fresh pairing code. Rejection-sampled so every character is uniform —
 * `% alphabet.length` over 256 would quietly bias the first 8 letters, and the
 * whole value of this code is its guess resistance.
 */
export function createPairingCode(): string {
  let code = '';
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of randomBytes(PAIRING_CODE_LENGTH)) {
      if (byte >= limit) continue; // biased tail — draw again
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * Compare a submitted code against the real one without leaking, through timing,
 * how much of a guess was right.
 *
 * Case is normalised first: the code is displayed uppercase and typed by hand,
 * so accepting `abc…` costs nothing (the alphabet has no case-colliding pair)
 * and rejecting it would read as a bug. Length is compared before
 * `timingSafeEqual`, which throws on a mismatch — the length of a fixed-format
 * code is not a secret.
 */
export function pairingCodeMatches(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted.trim().toUpperCase(), 'utf8');
  const b = Buffer.from(expected.trim().toUpperCase(), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
