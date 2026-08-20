// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The runtime off switch's read path (28-public-surface.md §3.5 level 2, D10).
 *
 * ── WHY A CACHE, ON A SETTING NOBODY CHANGES ───────────────────────────────
 * `settingsRepo.get()` is an UNCACHED bare SELECT — there is no settings cache
 * in this server. This flag is read on every request to the one surface that is
 * exposed to the internet, so reading it straight through would make the off
 * switch its own amplifier: a flood costs one meta-store round trip per request
 * *before* anything else refuses it. The cache is what keeps "turn it off" from
 * being more expensive than leaving it on.
 *
 * ── WHY THE TTL IS SHORT AND THE INVALIDATION IS EXPLICIT ──────────────────
 * A TTL alone would mean flipping the switch in Studio appears not to work for
 * up to the TTL — which reads as a broken control and invites a second click.
 * The settings write path calls `invalidate()`, so the intended flow is
 * immediate; the TTL is the backstop for anything that changes the row without
 * going through that path (a direct SQL edit, a config import, a second
 * process). Five seconds is short enough that such a change is not mysterious
 * and long enough that a flood is not a query per request.
 *
 * ── FAIL CLOSED ────────────────────────────────────────────────────────────
 * If the read throws, the answer is FALSE. A meta store that cannot answer
 * "may this be public?" has not said yes, and the direction of that guess is
 * the whole point: the failure mode of guessing `true` is an unscoped database
 * on the internet.
 */

export interface PublicApiGateOptions {
  /** Reads the raw setting. Throwing is expected and handled. */
  read: () => Promise<boolean>;
  ttlMs?: number;
  now?: () => number;
}

export interface PublicApiGate {
  isEnabled: () => Promise<boolean>;
  /** Called by the settings write path so a Studio flip takes effect at once. */
  invalidate: () => void;
}

export const PUBLIC_API_GATE_TTL_MS = 5_000;

export function createPublicApiGate(opts: PublicApiGateOptions): PublicApiGate {
  const ttl = opts.ttlMs ?? PUBLIC_API_GATE_TTL_MS;
  const now = opts.now ?? Date.now;

  let value: boolean | null = null;
  let expiresAt = 0;
  /*
   * In-flight de-duplication. Without it a burst arriving on a cold cache
   * issues one query per concurrent request — the exact stampede the cache
   * exists to prevent, just moved to the moment it matters most.
   */
  let inFlight: Promise<boolean> | null = null;

  const refresh = async (): Promise<boolean> => {
    try {
      const next = await opts.read();
      value = next;
      expiresAt = now() + ttl;
      return next;
    } catch {
      // Fail closed, and do NOT cache the failure: a transient meta-store blip
      // should not keep the surface dark for the whole TTL after it recovers.
      value = null;
      expiresAt = 0;
      return false;
    } finally {
      inFlight = null;
    }
  };

  return {
    async isEnabled() {
      if (value !== null && now() < expiresAt) return value;
      inFlight ??= refresh();
      return inFlight;
    },
    invalidate() {
      value = null;
      expiresAt = 0;
    },
  };
}
