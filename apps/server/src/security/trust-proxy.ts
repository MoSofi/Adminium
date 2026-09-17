// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which connection is the reverse proxy — Fastify's `trustProxy`, as
 * `ADMINIUM_TRUST_PROXY` and `ADMINIUM_TRUSTED_PROXIES` configure it
 * (08-server-api.md §7 item 5).
 *
 * ─── Why not a hop count ─────────────────────────────────────────────────────
 *
 * `app.ts` used to pass `trustProxy: 1`. A hop count never looks at who
 * connected: the "first hop" is whoever opened the socket, so a client that
 * reached the port directly could set `X-Forwarded-For`, `-Proto` and `-Host`
 * to anything (GHSA-3m5p-2c4r-xxw2). Fastify 5.12.1 fixed that by making a
 * numeric `trustProxy` trust NOBODY. Every npm install from then on resolved
 * the fixed Fastify, and `ADMINIUM_TRUST_PROXY=on` quietly stopped working:
 * the audit log recorded the proxy's address, the session cookie lost
 * `Secure` behind TLS, and everyone behind the proxy shared one login
 * rate-limit bucket. The lockfile still pinned 5.12.0, so neither the test
 * suite nor the Docker image showed it.
 *
 * ─── What is trusted now ─────────────────────────────────────────────────────
 *
 * The IMMEDIATE peer, and only when its socket address is on the list. Both
 * halves matter:
 *
 *  - the address check is the fix the advisory asks for. A client connecting
 *    from an address that is not a listed proxy has no say over any
 *    forwarded header.
 *  - the hop check (`hop === 0`) keeps the one-proxy shape the hop count had.
 *    Fastify's string form trusts EVERY listed address along the
 *    `X-Forwarded-For` chain, and the default list includes private networks.
 *    A LAN client behind nginx (which APPENDS to the header) would then be
 *    skipped as one more proxy, and `request.ip` would be the entry to its
 *    left, which that client wrote. With the hop check, `request.ip` is always
 *    the entry the trusted proxy appended.
 *
 * The default list, `loopback,uniquelocal`, covers the two documented setups:
 * a proxy on this host, and a proxy on a Docker network (172.16.0.0/12 and
 * friends). What that costs is in the docs: a machine on a private network
 * that can reach the port directly is trusted too. Keep the port reachable
 * only through the proxy, or narrow the list to the proxy's address.
 */
import proxyAddr from '@fastify/proxy-addr';

/** The trusted proxies when `ADMINIUM_TRUSTED_PROXIES` is unset. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'uniquelocal'];

/**
 * Fastify's `trustProxy` function: is the address at this `X-Forwarded-For`
 * position (0 = the socket peer) a proxy whose headers count?
 */
export type ProxyTrust = (address: string | undefined, hop: number) => boolean;

/**
 * The entries `@fastify/proxy-addr` would refuse. Checked one by one so the env
 * table names every bad entry at once, instead of Fastify throwing on the first
 * one mid-boot.
 *
 * The grammar is proxy-addr's, which is also Fastify's `trustProxy` string: an
 * address, a CIDR subnet or `address/netmask`, or one of the names `loopback`,
 * `linklocal`, `uniquelocal`. A `/0` range is refused by the library itself, so
 * "trust everyone" cannot be written here.
 */
export function invalidTrustedProxies(entries: readonly string[]): string[] {
  return entries.filter((entry) => {
    try {
      proxyAddr.compile(entry);
      return false;
    } catch {
      return true;
    }
  });
}

/** The `trustProxy` function for a validated list. See the module header. */
export function compileProxyTrust(entries: readonly string[]): ProxyTrust {
  const listed = proxyAddr.compile([...entries]);
  // A socket that has already gone reports no address. Fastify can still ask
  // about it, and "unknown" must not count as trusted.
  return (address, hop) => hop === 0 && typeof address === 'string' && listed(address, hop);
}
