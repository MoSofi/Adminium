// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public namespace's own rate limiter (28-public-surface.md §3.6, D9).
 *
 * ── WHY THIS IS NOT `RATE_BUCKETS` ─────────────────────────────────────────
 * `plugins/core.ts`'s `principalKey` cannot see a publishable key. Its own
 * comment forbids reading a decoration that `plugins/rbac.ts` registers later,
 * and under D3 an `adm_pub_` token never becomes an rbac principal at all — so
 * a `keyBy: 'public'` branch there would silently fall through to `ip:`. Behind
 * the shipped Caddy, with `ADMINIUM_TRUST_PROXY` off, that is a SINGLE bucket
 * shared by every anonymous caller on earth: one scraper starves every real
 * customer, and the limiter looks like it is working the whole time.
 *
 * ── THE KEY LADDER ─────────────────────────────────────────────────────────
 * Most specific first, so a claimed customer gets their own allowance and
 * cannot be starved by an anonymous flood on the same key:
 *
 *     pubs:<sessionId>  →  pub:<keyId>:ip:<ip>  →  pub:<keyId>
 *
 * The middle rung is the working one. Keying on the key alone would let one
 * abuser exhaust every visitor's allowance; keying on IP alone collapses under
 * NAT and behind a proxy. The pair costs one more map entry and is the only
 * combination that degrades sensibly under both.
 *
 * ── WHAT THIS DOES NOT FIX ─────────────────────────────────────────────────
 * It is an in-process `Map`, exactly like the one in `plugins/core.ts`. N
 * replicas means N× every ceiling here. That is a stated non-goal of this wave
 * (§9) and it is recorded rather than papered over: an operator running two
 * instances behind a load balancer gets double the published numbers.
 */

/** Fixed-window counters, per §3.6. */
export const PUBLIC_LIMITS = {
  /** Reads. Generous — a page load fans out across several refs. */
  'public-read': { max: 120, windowMs: 60_000 },
  /** Writes. An order, a booking, a ticket — human-paced by nature. */
  'public-write': { max: 20, windowMs: 60_000 },
  /**
   * Claims. The containment property for the `lookup` tier: possession of a
   * reference IS the credential, so the only thing standing between a
   * sequential reference space and enumeration is how fast it can be walked.
   * Deliberately the tightest bucket in the product.
   */
  'public-claim': { max: 5, windowMs: 60_000 },
} as const;

export type PublicLimit = keyof typeof PUBLIC_LIMITS;

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window opens again — the `Retry-After` value. */
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Sweep trigger, mirroring `plugins/core.ts`'s bound on key churn. */
const SWEEP_SIZE = 10_000;

export interface PublicRateLimiter {
  hit: (limit: PublicLimit, identity: RateIdentity) => RateDecision;
  /** Test seam only. */
  reset: () => void;
}

export interface RateIdentity {
  keyId: string;
  ip: string;
  sessionId?: string | undefined;
}

/**
 * The counter identity. See the ladder in the header.
 *
 * The bucket name is embedded so two limits can never collide in the shared
 * map — the same reason `plugins/core.ts` embeds it.
 */
export function rateKeyFor(limit: PublicLimit, id: RateIdentity): string {
  if (id.sessionId !== undefined) return `${limit}|pubs:${id.sessionId}`;
  return `${limit}|pub:${id.keyId}:ip:${id.ip}`;
}

export function createPublicRateLimiter(now: () => number = Date.now): PublicRateLimiter {
  const windows = new Map<string, Window>();

  const sweep = (at: number): void => {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key);
    }
  };

  return {
    hit(limit, identity) {
      const spec = PUBLIC_LIMITS[limit];
      const at = now();
      if (windows.size >= SWEEP_SIZE) sweep(at);

      const key = rateKeyFor(limit, identity);
      const existing = windows.get(key);
      const window =
        existing === undefined || existing.resetAt <= at
          ? { count: 0, resetAt: at + spec.windowMs }
          : existing;

      window.count += 1;
      windows.set(key, window);

      const allowed = window.count <= spec.max;
      return {
        allowed,
        // Always at least 1: a `Retry-After: 0` invites an immediate retry,
        // which is the opposite of what a refusal is for.
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - at) / 1000)),
        limit: spec.max,
        remaining: Math.max(0, spec.max - window.count),
      };
    },
    reset() {
      windows.clear();
    },
  };
}
