// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public namespace's own rate limiter.
 *
 * ── WHY THIS IS NOT `RATE_BUCKETS` ─────────────────────────────────────────
 * `plugins/core.ts`'s `principalKey` cannot see a publishable key. Its own
 * comment forbids reading a decoration that `plugins/rbac.ts` registers later,
 * and an `adm_pub_` token never becomes an rbac principal at all, by construction — so
 * a `keyBy: 'public'` branch there would silently fall through to `ip:`. Behind
 * the shipped Caddy, with `ADMINIUM_TRUST_PROXY` off, that is a SINGLE bucket
 * shared by every anonymous caller on earth: one scraper starves every real
 * customer, and the limiter looks like it is working the whole time.
 *
 * ── THE KEY LADDER ─────────────────────────────────────────────────────────
 * Two counts per request, one on each side of key resolution:
 *
 *     before:  flood|ip:<addr>                        every class, one ceiling
 *     after:   pubs:<session row id>                  a VERIFIED session
 *          or  pub:<keyId>:ip:<addr>                  everyone else, and EVERY claim
 *
 * The first count runs before anything is verified, so it keys on nothing the
 * caller chose: `<addr>` is `request.ip` (the address the
 * trusted proxy wrote), with IPv6 collapsed to its /64 — one subscriber is
 * handed a whole /64, and per-address counting would give them 2^64 buckets.
 * It used to key on the first 16 characters of the token and on the session
 * header's raw value, and both are free to vary: a fresh random value per
 * request was a fresh bucket per request, which reset the 5-a-minute claim
 * guard below on every attempt.
 *
 * The rungs after resolution are the real limits. A session counts on its own
 * rung only once `sessions.findValid` has returned its row, and by the row's
 * id, so a claimed customer gets their own allowance and cannot be starved by
 * an anonymous flood on the same key. `public-claim` never uses the session
 * rung: a claim is the brute-force guard on possession of a reference, and
 * nothing the caller holds may widen it.
 *
 * The key-and-address rung is the working one. Keying on the key alone would
 * let one abuser exhaust every visitor's allowance; keying on IP alone
 * collapses under NAT and behind a proxy. The pair costs one more map entry
 * and is the only combination that degrades sensibly under both. (The flood
 * guard IS keyed on the address alone, which is why its ceiling sits above
 * everything one address can spend after resolution.)
 *
 * ── THE WHOLE-KEY RUNG ─────────────────────────────────────────────────────
 * A browser key sits in a page anyone can read, so the per-visitor rungs
 * alone let many addresses together spend without bound: a thousand
 * addresses booking a venue's every slot in a minute each stay inside their
 * own allowance. After the per-visitor rung passes, a browser key's request
 * also counts on the key alone —
 *
 *     pubkey:<keyId>:read    600 a minute
 *     pubkey:<keyId>:write    60 a minute (claims count here: each is a guess)
 *
 * — the write rung a tenth of the read one, since a busy page reads far more
 * than it writes. A server key is one backend, whose endpoint rate is already
 * key-wide. It counts requests, not rows: a batch's rows are its endpoint's
 * own limit to count. Like that limit, a refused request adds nothing.
 *
 * ── AN ENDPOINT'S OWN LIMIT ────────────────────────────────────────────────
 * A resource that states a `rate` (every endpoint made in the builder does)
 * is limited by that number INSTEAD of its class bucket:
 *
 *     browser key:  ep|<keyId>:<ref>:s:<session row id>   a verified session
 *               or  ep|<keyId>:<ref>:ip:<addr>             everyone else
 *     server key:   ep|<keyId>:<ref>                       key-wide
 *
 * For a browser key the operator's number means "per visitor": keyed on the
 * key alone, one person who copied the key out of a page could spend
 * everybody's allowance and take `/orders` down for every shopper. A server
 * key is one backend or one fleet, so its number is the fleet's total. A
 * resource with no `rate` — every scope that predates this feature — keeps the
 * class limits above exactly as they were.
 *
 * The flood guard still runs first and still caps one address at 300 a
 * minute, and the core `public` bucket caps it at 600 (`plugins/core.ts`):
 * an endpoint's "5,000 a minute" is reachable by a server key's fleet, never
 * by one address. A request's COST can exceed one — a batch spends its row
 * count — and a request is allowed only if it fits whole; a refused one adds
 * nothing, so a batch too big to ever fit cannot burn the window by retrying.
 *
 * ── FAILED RESOLUTION ──────────────────────────────────────────────────────
 * A random token costs a `findByPrefix` round trip. After 30 failed
 * resolutions in a minute from one address, that address is refused BEFORE
 * the lookup until its window opens — the bounded replacement for a
 * negative cache, which a fresh random token would never hit.
 *
 * ── WHAT THIS DOES NOT FIX ─────────────────────────────────────────────────
 * It is an in-process `Map`, exactly like the one in `plugins/core.ts`. N
 * replicas means N× every ceiling here. That is a stated non-goal of this wave
 * and it is recorded rather than papered over: an operator running two
 * instances behind a load balancer gets double the published numbers.
 */

import { isIPv4, isIPv6 } from 'node:net';

/** Fixed-window counters. */
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

/**
 * The count before the key is resolved: every request, any class, per address.
 *
 * A flood guard, not a limit. Its job is to bound what an UNVERIFIED caller can
 * make the server do — a random-token flood costs a `findByPrefix` round trip
 * per request — so it must sit above everything a legitimate address can spend
 * after resolution, or it would bind before the limits it guards: the anonymous
 * rung's three classes (120 + 20 + 5) plus one claimed session's (120 + 20) is
 * 285. And below the core `public` backstop (600, `plugins/core.ts`), which
 * does not collapse IPv6 and so is no bound at all against a /64.
 */
export const PUBLIC_FLOOD_GUARD = { max: 300, windowMs: 60_000 } as const;

/** The whole-key rung for a browser key: every visitor together. */
export const PUBLIC_KEY_LIMITS = {
  read: { max: 600, windowMs: 60_000 },
  write: { max: 60, windowMs: 60_000 },
} as const;

export type PublicKeySide = keyof typeof PUBLIC_KEY_LIMITS;

/** The whole-key counter identity. */
export function keyRateKeyFor(keyId: string, side: PublicKeySide): string {
  return `pubkey:${keyId}:${side}`;
}

/** Failed key resolutions one address may cause in a window. */
export const PUBLIC_FAILED_RESOLUTION = { max: 30, windowMs: 60_000 } as const;

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
/** A full sweep runs at most this often, however fast keys churn. */
const SWEEP_EVERY_MS = 1_000;
/**
 * Past this many live windows in one map, the oldest are dropped. Dropping
 * resets somebody's allowance, which is the lesser harm: the alternative is a
 * map an attacker can grow without bound.
 */
const HARD_CAP = 100_000;

export interface PublicRateLimiter {
  /** Before resolution. Takes the address and nothing the caller chose. */
  hitUnverified: (ip: string) => RateDecision;
  /** After resolution, on the ladder in the header. */
  hit: (limit: PublicLimit, identity: RateIdentity) => RateDecision;
  /** An endpoint's own `rate`, instead of the class bucket. `cost` defaults to 1. */
  hitEndpoint: (identity: EndpointRateIdentity, rate: { max: number; windowMs: number }, cost?: number) => RateDecision;
  /** A browser key's whole-key rung, after the per-visitor one. `cost` defaults to 1. */
  hitKey: (keyId: string, side: PublicKeySide, cost?: number) => RateDecision;
  /** Whether this address has used up its failed resolutions; counts nothing. */
  resolutionBlocked: (ip: string) => RateDecision | null;
  /** One more failed resolution from this address. */
  failedResolution: (ip: string) => void;
  /** Test seam only. */
  reset: () => void;
}

export interface RateIdentity {
  /** A RESOLVED key's id — never anything cut from the presented token. */
  keyId: string;
  ip: string;
  /**
   * A VERIFIED session's row id — never the presented header. Ignored for
   * `public-claim`.
   */
  sessionId?: string | undefined;
}

export interface EndpointRateIdentity extends RateIdentity {
  ref: string;
  /** `browser` counts per visitor; `server` counts key-wide. */
  kind: 'browser' | 'server';
}

/** The counter identity for an endpoint's own limit. See the header. */
export function endpointRateKeyFor(id: EndpointRateIdentity): string {
  if (id.kind === 'server') return `ep|${id.keyId}:${id.ref}`;
  if (id.sessionId !== undefined) return `ep|${id.keyId}:${id.ref}:s:${id.sessionId}`;
  return `ep|${id.keyId}:${id.ref}:ip:${rateAddress(id.ip)}`;
}

/**
 * The address a bucket counts: IPv4 as written, IPv6 as its /64.
 *
 * An IPv4-mapped address (`::ffff:198.51.100.7`, what a dual-stack socket
 * reports) is ONE IPv4 client and is keyed as that address. Collapsing it to
 * its /64 would put every IPv4 caller of a dual-stack listener in one bucket,
 * `0:0:0:0`. Anything that is not an address is used as written.
 */
export function rateAddress(ip: string): string {
  const bare = ip.split('%', 1)[0] as string; // an IPv6 zone names an interface, not a peer
  if (isIPv4(bare)) return bare;
  if (!isIPv6(bare)) return ip;
  const groups = ipv6Groups(bare);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6] as number, groups[7] as number];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** The eight groups of an address `isIPv6` has already accepted. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  // A trailing dotted quad is the last two groups written as IPv4.
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (quad !== null) {
    const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(fill).fill('0'), ...right].map((g) => parseInt(g, 16));
}

/** The pre-resolution counter identity. */
export function floodKeyFor(ip: string): string {
  return `flood|ip:${rateAddress(ip)}`;
}

/**
 * The counter identity after resolution. See the ladder in the header.
 *
 * The bucket name is embedded so two limits can never collide in the shared
 * map — the same reason `plugins/core.ts` embeds it.
 */
export function rateKeyFor(limit: PublicLimit, id: RateIdentity): string {
  if (id.sessionId !== undefined && limit !== 'public-claim') return `${limit}|pubs:${id.sessionId}`;
  return `${limit}|pub:${id.keyId}:ip:${rateAddress(id.ip)}`;
}

export function createPublicRateLimiter(now: () => number = Date.now): PublicRateLimiter {
  /*
   * Two maps: the class and flood windows, and the endpoint windows, which
   * can be far more numerous (key × ref × visitor) and live up to an hour. A
   * sweep of one never scans the other.
   */
  const windows = new Map<string, Window>();
  const endpointWindows = new Map<string, Window>();
  const lastSweep = new WeakMap<Map<string, Window>, number>();

  const sweep = (map: Map<string, Window>, at: number): void => {
    if (map.size < SWEEP_SIZE) return;
    if (at - (lastSweep.get(map) ?? 0) >= SWEEP_EVERY_MS) {
      lastSweep.set(map, at);
      for (const [key, window] of map) {
        if (window.resetAt <= at) map.delete(key);
      }
    }
    if (map.size >= HARD_CAP) {
      // Insertion order is age order: drop the oldest tenth.
      let drop = Math.ceil(HARD_CAP / 10);
      for (const key of map.keys()) {
        if (drop-- <= 0) break;
        map.delete(key);
      }
    }
  };

  const decide = (map: Map<string, Window>, key: string, spec: { max: number; windowMs: number }, cost: number, commit: boolean): RateDecision => {
    const at = now();
    sweep(map, at);
    const existing = map.get(key);
    const window =
      existing === undefined || existing.resetAt <= at ? { count: 0, resetAt: at + spec.windowMs } : existing;
    const allowed = window.count + cost <= spec.max;
    if (commit && allowed) {
      window.count += cost;
      map.set(key, window);
    }
    return {
      allowed,
      // Always at least 1: a `Retry-After: 0` invites an immediate retry,
      // which is the opposite of what a refusal is for.
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - at) / 1000)),
      limit: spec.max,
      remaining: Math.max(0, spec.max - window.count),
    };
  };

  /*
   * The class and flood counters keep their original semantics — a refused
   * request still counts — so their behaviour for every existing scope is
   * byte-for-byte what it was.
   */
  const count = (key: string, spec: { max: number; windowMs: number }): RateDecision => {
    const at = now();
    sweep(windows, at);
    const existing = windows.get(key);
    const window =
      existing === undefined || existing.resetAt <= at ? { count: 0, resetAt: at + spec.windowMs } : existing;
    window.count += 1;
    windows.set(key, window);
    const allowed = window.count <= spec.max;
    return {
      allowed,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - at) / 1000)),
      limit: spec.max,
      remaining: Math.max(0, spec.max - window.count),
    };
  };

  const failKey = (ip: string): string => `fail|ip:${rateAddress(ip)}`;

  return {
    hitUnverified(ip) {
      return count(floodKeyFor(ip), PUBLIC_FLOOD_GUARD);
    },
    hit(limit, identity) {
      return count(rateKeyFor(limit, identity), PUBLIC_LIMITS[limit]);
    },
    hitEndpoint(identity, rate, cost = 1) {
      return decide(endpointWindows, endpointRateKeyFor(identity), rate, cost, true);
    },
    hitKey(keyId, side, cost = 1) {
      return decide(windows, keyRateKeyFor(keyId, side), PUBLIC_KEY_LIMITS[side], cost, true);
    },
    resolutionBlocked(ip) {
      const decision = decide(windows, failKey(ip), PUBLIC_FAILED_RESOLUTION, 1, false);
      return decision.allowed ? null : decision;
    },
    failedResolution(ip) {
      decide(windows, failKey(ip), PUBLIC_FAILED_RESOLUTION, 1, true);
    },
    reset() {
      windows.clear();
      endpointWindows.clear();
    },
  };
}
