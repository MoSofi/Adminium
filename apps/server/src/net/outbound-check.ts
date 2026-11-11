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
 * {@link outboundFetch} runs that check on EVERY request and connects to the
 * addresses that passed ({@link pinnedFetch}): the name is not looked up a
 * second time between the check and the connection, so an answer that changes
 * cannot move a request (DNS rebinding). The name stays in the Host header
 * and in the TLS server name.
 */
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
 * A `fetch` that checks the URL's host before each request and connects to
 * the addresses that passed, never anything a later lookup gives. A refusal
 * is thrown from the call, as the check throws it.
 */
export function outboundFetch(policy: OutboundPolicy): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pins = await checkOutboundUrl(url, policy);
    return pinnedFetch(pins)(url, init);
  };
}
