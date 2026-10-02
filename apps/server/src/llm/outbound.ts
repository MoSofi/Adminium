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
 * The address is checked, not pinned: the request that follows resolves the
 * name again. Redirects are refused by the streamed request itself, so the
 * one window left is a name whose answer changes between the two lookups.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ValidationFailedError } from '../errors.js';

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
 * Resolve a URL's host and refuse it when any address it gives is one this
 * server must not call. A name that does not resolve is let through: the
 * request will fail on its own, with the provider's name in the message.
 */
export async function resolveAndCheck(rawUrl: string, opts: ResolveCheckOptions = {}): Promise<void> {
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      return;
    }
  }
  for (const address of addresses) {
    const kind = addressKind(address);
    if (kind === 'metadata') {
      throw new ValidationFailedError('That address resolves to a blocked range.', { host });
    }
    if (opts.blockPrivate === true && kind !== 'public') {
      throw new ValidationFailedError('That address is on this server’s own network, which a model connection here may not use.', { host });
    }
  }
}
