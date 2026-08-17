// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop boot-token mechanics (11-electron.md §5, §2.2 step 4).
 *
 * Three primitives, deliberately framework-free so they can be tested as what
 * they are — security decisions — rather than through a route:
 *
 *   {@link isLoopbackPeer}      — is the SOCKET peer this same machine?
 *   {@link bootTokenMatches}    — constant-time comparison against the boot token
 *   {@link createBootTokenGuard} — the one-shot-per-boot claim
 *
 * ─── Why the socket, and not `request.ip` ────────────────────────────────────
 *
 * `request.ip` is Fastify's PROXY-AWARE address: with `trustProxy` on it is
 * whatever `X-Forwarded-For` said. That header is a claim by the client, and
 * this is the one route in the product where a client's claim about its own
 * address would be an authentication bypass — a LAN peer (§8.3 binds `0.0.0.0`)
 * could send `X-Forwarded-For: 127.0.0.1` and become the super admin without a
 * password. So the check reads `socket.remoteAddress`: the kernel's view of who
 * actually opened the connection, which no header can move. §2.4 states the rule
 * without qualification — "rejects non-loopback peers unconditionally" — and
 * unconditional means "not even for a proxy we would otherwise trust".
 *
 * ─── Why one-shot lives in memory ────────────────────────────────────────────
 *
 * "One success per boot token" (§5) and "never persisted" (§2.2) are the same
 * requirement seen twice: the token's lifetime IS this process's lifetime. A
 * replay table in the meta store would outlive the token it guards, and give the
 * next boot a row to be confused by. The guard is therefore a closure over a
 * boolean, and a restarted server is a new boot with a new token — which is
 * exactly why "a token from a previous boot" fails: nothing in this process ever
 * heard of it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * IPv4 loopback is a whole /8 (127.0.0.0/8), not just 127.0.0.1 — `127.0.0.2`
 * is equally this machine and equally reachable from nowhere else.
 */
const IPV4_LOOPBACK = /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/;

/** `::ffff:127.0.0.1` — an IPv4 peer seen through a dual-stack listener. */
const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * True when `address` is a loopback address in any of the shapes Node hands out.
 *
 * `undefined`/empty ⇒ FALSE. An absent `remoteAddress` means the socket is gone
 * (or is not a socket at all); "we could not tell who this is" is not "this is
 * the local user", and the failure has to land on the deny side.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (address === undefined || address === null || address === '') return false;

  // Strip a zone index (`fe80::1%en0`) before comparing — it belongs to the
  // interface, not the address, and `::1%lo0` is still `::1`.
  const zoneless = address.split('%')[0] ?? '';
  const normalized = zoneless.toLowerCase();

  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith(IPV4_MAPPED_PREFIX)) {
    return IPV4_LOOPBACK.test(normalized.slice(IPV4_MAPPED_PREFIX.length));
  }
  return IPV4_LOOPBACK.test(normalized);
}

/** The narrow slice of a request this module reads: the raw socket's peer. */
export interface PeerSocketLike {
  remoteAddress?: string | undefined;
}

/**
 * The §2.4 peer check. Takes the SOCKET, never the request, so a caller cannot
 * pass the proxy-aware `request.ip` by accident — the type will not allow it.
 */
export function isLoopbackPeer(socket: PeerSocketLike | undefined | null): boolean {
  return isLoopbackAddress(socket?.remoteAddress);
}

/**
 * Constant-time equality for the boot token (§5: "compares against
 * `ADMINIUM_BOOT_TOKEN` (constant-time)").
 *
 * Both sides are hashed first. `timingSafeEqual` THROWS on a length mismatch,
 * so comparing the raw strings would both leak the token's length through the
 * error path and turn a short guess into a 500 instead of a 401. SHA-256 makes
 * every candidate exactly 32 bytes, which is the point — the comparison is over
 * digests, and the digest of a wrong guess differs from the first byte on.
 */
export function bootTokenMatches(candidate: string, bootToken: string): boolean {
  const a = createHash('sha256').update(candidate, 'utf8').digest();
  const b = createHash('sha256').update(bootToken, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Why a claim was refused. The route maps every one of these to a 401. */
export type BootTokenClaim = 'ok' | 'invalid' | 'used';

export interface BootTokenGuard {
  /**
   * Verify and CONSUME. Exactly one call in this process's lifetime can return
   * `ok`; every later call returns `used`, including a second call with the
   * correct token (that is the §5 replay case, not a retry).
   */
  claim(candidate: string): BootTokenClaim;
  /** Introspection for tests/diagnostics — never gates anything. */
  readonly consumed: boolean;
}

/**
 * The one-shot guard over this boot's token.
 *
 * ORDERING MATTERS: the `used` check comes FIRST. Once the token is spent the
 * answer is `used` for every candidate, right or wrong, so a spent boot stops
 * being an oracle that confirms a guessed token by answering it differently.
 *
 * The claim is taken BEFORE the session is issued (see the route): if minting
 * the session then fails, the token is still burned. Better a user who clicks
 * relaunch than a token that survives its first use.
 */
export function createBootTokenGuard(bootToken: string): BootTokenGuard {
  let consumed = false;
  return {
    claim(candidate: string): BootTokenClaim {
      if (consumed) return 'used';
      if (!bootTokenMatches(candidate, bootToken)) return 'invalid';
      consumed = true;
      return 'ok';
    },
    get consumed(): boolean {
      return consumed;
    },
  };
}
