// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a model's address really points.
 *
 * `guardOutboundUrl` reads the host NAME. A name can resolve anywhere: a
 * public-looking one to the cloud metadata address, or to a machine on the
 * server's own network. This resolves the name and checks the addresses it
 * gives. Metadata and link-local are refused always; loopback and private
 * ranges only where the caller says so (a server on the internet running a
 * model for people who are not its operator).
 *
 * A name that was resolved and passed is then PINNED: `checkedFetch` hands
 * the model's requests a `fetch` that connects to the address that was
 * checked, so a name whose answer changes between the check and the call
 * gains nothing. Redirects are refused by the request itself.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ValidationFailedError } from '../errors.js';
import { pinnedFetch, type PinnedAddress } from '../net/pinned-fetch.js';

export interface ResolveCheckOptions {
  /** Refuse loopback and private ranges too. */
  blockPrivate?: boolean;
  /** Test seam. */
  resolve?: (host: string) => Promise<string[]>;
}

/** An IPv4 address inside an IPv6 one (`::ffff:10.0.0.1`), or the address itself. */
function unmapped(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped !== null) return mapped[1] as string;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex === null) return address;
  const high = Number.parseInt(hex[1] as string, 16);
  const low = Number.parseInt(hex[2] as string, 16);
  return `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
}

/** What kind of place an address is. */
export function addressKind(raw: string): 'metadata' | 'loopback' | 'private' | 'public' {
  const address = unmapped(raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, ''));
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    if (a === 169 && b === 254) return 'metadata';
    if (a === 127 || a === 0) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'private';
    return 'public';
  }
  if (address === '::1' || address === '::') return 'loopback';
  if (address === 'fd00:ec2::254' || /^fe[89ab]/.test(address)) return 'metadata';
  if (/^f[cd]/.test(address)) return 'private';
  return 'public';
}

const defaultResolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true })).map((entry) => entry.address);

/**
 * The address each checked name is called at, by `host:port` as the URL writes it. Kept until the name is checked
 * again (every use of a connection checks it) and bounded: an entry is only ever an address that passed.
 */
const pins = new Map<string, PinnedAddress[]>();
const PINS_MAX = 200;
/**
 * Names that were asked about here and have no address to be called at now: the last check refused them or
 * found no address, or their pin gave way to a newer one. A request to one fails, where the platform's own
 * `fetch` would look the name up again and call whatever it then gave. The next check that passes takes it out.
 */
const closed = new Set<string>();
const CLOSED_MAX = 2000;

function close(key: string): void {
  pins.delete(key);
  if (closed.size >= CLOSED_MAX) closed.delete(closed.values().next().value as string);
  closed.add(key);
}

const refusedFetch: typeof fetch = () => Promise.reject(new TypeError('fetch failed: this address was not checked, so it is not called'));

/**
 * A `fetch` for a URL whose name was checked here, connecting to what was checked; one that fails for a name
 * whose check did not pass; null for any other address (one written as numbers, or never asked about).
 */
export function checkedFetch(rawUrl: string): typeof fetch | null {
  let host: string;
  try {
    host = new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
  const pin = pins.get(host);
  if (pin !== undefined) return pinnedFetch(pin);
  return closed.has(host) ? refusedFetch : null;
}

/** Forget every pinned address (tests). */
export function forgetCheckedAddresses(): void {
  pins.clear();
  closed.clear();
}

/**
 * Resolve a URL's host and refuse it when any address it gives is one this
 * server must not call. A name that does not resolve is let through: the
 * request will fail on its own, with the provider's name in the message.
 */
export async function resolveAndCheck(rawUrl: string, opts: ResolveCheckOptions = {}): Promise<void> {
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const key = url.host.toLowerCase();
  // A request already on its way keeps the address it was checked at while this lookup runs: with no pin it would be the platform's to resolve.
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      if (opts.resolve === undefined) close(key);
      // Where private addresses are refused, a name nobody can check is refused too: it may resolve the next time it is asked.
      if (opts.blockPrivate === true) throw new ValidationFailedError('That address does not resolve, so it cannot be checked.', { host });
      return;
    }
  }
  for (const address of addresses) {
    const kind = addressKind(address);
    if (kind === 'metadata') {
      if (isIP(host) === 0 && opts.resolve === undefined) close(key);
      throw new ValidationFailedError('That address resolves to a blocked range.', { host });
    }
    if (opts.blockPrivate === true && kind !== 'public') {
      if (isIP(host) === 0 && opts.resolve === undefined) close(key);
      throw new ValidationFailedError('That address is on this server’s own network, which a model connection here may not use.', { host });
    }
  }
  // A name the system's own resolver answered is called at the addresses it gave, all of which passed, and no other.
  // An address written as numbers needs no pin, and a resolver handed in by a test names no machine to call.
  if (isIP(host) === 0 && opts.resolve === undefined) {
    if (addresses.length === 0) {
      close(key);
      return;
    }
    // The oldest gives way, and is closed until it is checked again: never left to the platform's own lookup.
    if (!pins.has(key) && pins.size >= PINS_MAX) close(pins.keys().next().value as string);
    closed.delete(key);
    pins.set(
      key,
      addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 })),
    );
  }
}
