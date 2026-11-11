// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An http(s) address somebody else wrote, checked before every call and
 * called at what was checked: a webhook, a storage endpoint.
 *
 * {@link checkOutboundUrl} looks the host up the way the system resolver
 * does and checks every address ({@link checkHost}): cloud metadata always
 * refused; this machine where the caller refuses it (production); the
 * server's own network where `ADMINIUM_NETWORK_POLICY=strict` refuses it. A
 * name that does not resolve is never called (it could answer anything the
 * next time it is asked), and says so with its own code
 * ({@link HostLookupFailedError}, 502), apart from a rule's refusal (422).
 *
 * {@link outboundFetch} runs that check before its requests and connects to
 * the addresses that passed ({@link pinnedFetch}): the name is not looked up
 * a second time between the check and the connection, so an answer that
 * changes cannot move a request (DNS rebinding). The name stays in the Host
 * header and in the TLS server name. It keeps connections open to the
 * addresses that passed and checks the name again every
 * {@link OUTBOUND_RECHECK_MS}; see there.
 */
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import { HostLookupFailedError, ValidationFailedError } from '../errors.js';
import { checkHost, type HostLookup } from './address-guard.js';
import { pinnedFetch, type PinnedAddress } from './pinned-fetch.js';

/**
 * `ADMINIUM_NETWORK_POLICY`. `open` (the default): the server's own network
 * is called like any other. `strict`: it is refused for source databases
 * (except hosts in `ADMINIUM_DATABASE_HOSTS`), webhooks and storage
 * endpoints. Cloud metadata is refused under both.
 */
export const NETWORK_POLICIES = ['open', 'strict'] as const;
export type NetworkPolicy = (typeof NETWORK_POLICIES)[number];

export interface OutboundPolicy {
  /** Refuse this machine (loopback): production does. */
  blockLoopback: boolean;
  /** Refuse the server's own network (private ranges): `ADMINIUM_NETWORK_POLICY=strict` does. */
  blockPrivate?: boolean | undefined;
  /** Test seam: the lookup. Default the system resolver's. */
  lookup?: HostLookup | undefined;
}

/**
 * Check `rawUrl` under `policy` and return the addresses to call it at.
 * Throws 422 for an address a rule refuses, 502 `HOST_LOOKUP_FAILED` for a
 * name that could not be looked up.
 */
export async function checkOutboundUrl(rawUrl: string, policy: OutboundPolicy): Promise<PinnedAddress[]> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationFailedError('Invalid URL.', { url: rawUrl });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationFailedError('Only http and https URLs are allowed.', { protocol: url.protocol });
  }
  const check = await checkHost(url.hostname, {
    blockLoopback: policy.blockLoopback,
    blockPrivate: policy.blockPrivate === true,
    failClosed: true,
    lookup: policy.lookup,
  });
  if (check.ok) return check.addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const at = check.address === undefined || check.address === check.host ? '' : ` (${check.address})`;
  switch (check.reason) {
    case 'metadata':
      throw new ValidationFailedError('Host resolves to a blocked address range.', { host: check.host, address: check.address });
    case 'loopback':
      throw new ValidationFailedError(`Loopback hosts are not allowed in production: ${check.host}${at} is this server itself.`, {
        host: check.host,
        address: check.address,
      });
    case 'private':
      throw new ValidationFailedError(
        `The host ${check.host}${at} is on this server's own network, which ADMINIUM_NETWORK_POLICY=strict does not call.`,
        { host: check.host, address: check.address, variable: 'ADMINIUM_NETWORK_POLICY' },
      );
    case 'unresolved':
      throw new HostLookupFailedError(check.host);
  }
}

/**
 * How long a host's checked addresses are used before the name is looked up
 * and checked again: 60 seconds.
 *
 * Only addresses that passed the check are ever dialled, so this interval is
 * not what keeps a request off a refused address; it bounds how long a
 * connection keeps going to an address after the name has moved away from it.
 * A page of thumbnails asks for dozens of files within a second or two: one
 * lookup and a handful of reused connections serve them all, where a lookup
 * and a new TLS handshake per file made such pages slow on every install. A
 * minute is about what a resolver cache keeps a name for anyway, and short
 * enough that a moved bucket or share is followed within it. A request that
 * fails also forgets the addresses, so the next one looks the name up again.
 */
export const OUTBOUND_RECHECK_MS = 60_000;

/**
 * How long an open connection may sit unused before it is closed: 5 seconds,
 * Node's own default for a keep-alive agent. Below the idle limit of the
 * servers storage talks to (Apache's 5 s is the shortest common one, S3's
 * about 20 s), so a connection is closed here before the far end closes it
 * under a request.
 */
export const OUTBOUND_IDLE_MS = 5_000;

export interface OutboundFetchOptions {
  /** {@link OUTBOUND_RECHECK_MS}; test seam. */
  recheckMs?: number;
  /** Test seam: the clock. */
  now?: () => number;
}

interface PinnedOrigin {
  /** The addresses that passed, as the check gave them. */
  pins: PinnedAddress[];
  /** The agent for exactly these addresses: a changed answer gets a new one. */
  agent: HttpAgent | HttpsAgent;
  /** When they passed. */
  checkedAt: number;
}

const pinsKey = (pins: readonly PinnedAddress[]): string => pins.map((pin) => pin.address).join(',');

/**
 * A `fetch` that checks the URL's host, connects to the addresses that
 * passed, never anything a later lookup gives, and keeps those connections
 * open for the next request. The host is checked again once
 * {@link OUTBOUND_RECHECK_MS} has passed (or after a request failed); a
 * changed answer goes through the whole check before anything is reused, and
 * gets connections of its own. A refusal is thrown from the call, as the
 * check throws it.
 */
export function outboundFetch(policy: OutboundPolicy, opts: OutboundFetchOptions = {}): typeof fetch {
  const recheckMs = opts.recheckMs ?? OUTBOUND_RECHECK_MS;
  const now = opts.now ?? (() => Date.now());
  const origins = new Map<string, PinnedOrigin>();
  // One check at a time per origin: a page that asks for thirty files at once looks the name up once.
  const checking = new Map<string, Promise<PinnedOrigin>>();

  async function pinned(url: URL): Promise<PinnedOrigin> {
    const origin = `${url.protocol}//${url.host}`;
    const held = origins.get(origin);
    if (held !== undefined && now() - held.checkedAt < recheckMs) return held;
    const pending = checking.get(origin);
    if (pending !== undefined) return pending;
    const check = (async () => {
      try {
        const pins = await checkOutboundUrl(url.href, policy);
        const current = origins.get(origin);
        if (current !== undefined && pinsKey(current.pins) === pinsKey(pins)) {
          current.checkedAt = now();
          return current;
        }
        // A new answer, checked: connections of its own. The old agent's idle connections close on their own.
        const Agent = url.protocol === 'https:' ? HttpsAgent : HttpAgent;
        const next: PinnedOrigin = { pins, agent: new Agent({ keepAlive: true, timeout: OUTBOUND_IDLE_MS }), checkedAt: now() };
        origins.set(origin, next);
        return next;
      } catch (error) {
        // Refused, or not found: nothing of the old answer is used again.
        origins.delete(origin);
        throw error;
      } finally {
        checking.delete(origin);
      }
    })();
    checking.set(origin, check);
    return check;
  }

  return async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw new ValidationFailedError('Invalid URL.', { url: href });
    }
    const target = await pinned(url);
    try {
      return await pinnedFetch(target.pins, { agent: target.agent })(href, init);
    } catch (error) {
      // A connection that failed: the next request looks the name up again.
      target.checkedAt = Number.NEGATIVE_INFINITY;
      throw error;
    }
  };
}
