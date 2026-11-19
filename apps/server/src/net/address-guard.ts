// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a host really points, checked before anything dials it.
 *
 * A host is written by somebody else: a DSN in a form, a model's address, a
 * webhook, a storage endpoint. Its NAME says little. `localhost.`, `127.1`,
 * `0x7f.1`, `0.0.0.0` and `::ffff:127.0.0.1` are all this machine; a
 * public-looking name can resolve to the cloud metadata address. So the host
 * is read the way the system resolver reads it, looked up the way the drivers
 * look it up (`dns.lookup` with `all: true`), and EVERY address it gives is
 * checked:
 *
 * - cloud metadata: always refused (the credential-theft target), listed or
 *   not;
 * - loopback (this machine): refused where the caller blocks it, unless the
 *   operator listed the host (`ADMINIUM_DATABASE_HOSTS`);
 * - private ranges (the server's own network): refused where the caller
 *   blocks them, unless listed. Nothing blocks them for databases yet; the
 *   seam is {@link HostPolicy.blockPrivate};
 * - a name that does not resolve: refused where the caller fails closed. An
 *   answer that fails now may succeed with any address the next time the
 *   driver asks, so "could not check" is not "nothing to check".
 *
 * The answer carries the addresses that passed. The caller hands them to
 * whatever dials (a database driver, a pinned `fetch`), so a name whose answer
 * changes between the check and the connection gains nothing.
 */
import { ADDRCONFIG } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type AddressKind = 'metadata' | 'loopback' | 'private' | 'public';

/** The 16 bytes of an IPv6 address, a trailing dotted IPv4 part included; null when it is not one. */
function ipv6Bytes(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address;
  const tail: number[] = [];
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted !== null) {
    for (const part of dotted.slice(1)) tail.push(Number(part));
    text = `${text.slice(0, dotted.index)}0:0`;
  }
  const [head = '', rest] = text.split('::');
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const before = groups(head);
  const after = rest === undefined ? [] : groups(rest);
  const all = rest === undefined ? before : [...before, ...Array<string>(8 - before.length - after.length).fill('0'), ...after];
  const bytes = all.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 255];
  });
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

/**
 * The IPv4 address an IPv6 one carries, where it is a way of reaching it:
 * IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible `::a.b.c.d` (`::` and `::1`
 * included, which read as 0.0.0.0 and 0.0.0.1: this machine), NAT64
 * `64:ff9b::/96` and its local-use `64:ff9b:1::/48` (the last 32 bits), and
 * 6to4 `2002::/16`. Null for any other address.
 */
export function embeddedIpv4(address: string): string | null {
  const bytes = ipv6Bytes(address);
  if (bytes === null) return null;
  const zero = (from: number, to: number): boolean => bytes.slice(from, to).every((byte) => byte === 0);
  const v4 = (at: number): string => bytes.slice(at, at + 4).join('.');
  if (zero(0, 10) && bytes[10] === 255 && bytes[11] === 255) return v4(12);
  if (zero(0, 12)) return v4(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12)) return v4(12);
  // RFC 8215's local-use prefix: a network picks its own length, and a /96 under it carries the address last, as above.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes[4] === 0x00 && bytes[5] === 0x01) return v4(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4(2);
  return null;
}

/** Cloud metadata services reached at an ordinary-looking IPv4 address: Alibaba Cloud, Oracle Cloud. */
const METADATA_V4 = new Set(['100.100.100.200', '192.0.0.192']);

function ipv4Kind(address: string): AddressKind {
  if (METADATA_V4.has(address)) return 'metadata';
  const [a, b] = address.split('.').map(Number) as [number, number];
  if (a === 169 && b === 254) return 'metadata';
  if (a === 127 || a === 0) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'private';
  return 'public';
}

/**
 * Reserved and special-purpose ranges that are no database's home on the
 * internet: "this network" 0/8, IETF protocol assignments 192.0.0/24, 6to4
 * relays 192.88.99/24, benchmarking 198.18/15, the three TEST-NETs, multicast
 * 224/4 and the rest 240/4 (broadcast included); IPv6's IPv4-mapped block as
 * written (`::ffff:0:0/96`), discard 100::/64, Teredo 2001::/32, ORCHID
 * 2001:10::/28 and 2001:20::/28, documentation 2001:db8::/32, the old
 * site-local fec0::/10 and multicast ff00::/8.
 *
 * Apart from {@link addressKind} on purpose: a webhook or a storage endpoint
 * keeps its reading, and only the source-database guard under `strict` and the
 * user's own host refuse these ({@link HostPolicy.blockReserved}). Metadata
 * and loopback are read first, so `192.0.0.192` stays metadata and 0/8 stays
 * this machine.
 */
function reservedV4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  if (a === 0) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

/** Whether an address lies in a reserved or special-purpose range (see above). Not an address: false. */
export function isReservedAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(address) === 4) return reservedV4(address);
  const bytes = ipv6Bytes(address);
  if (bytes === null) return false;
  const zero = (from: number, to: number): boolean => bytes.slice(from, to).every((byte) => byte === 0);
  // IPv4-mapped as written: a lookup answer or an address that dresses an IPv4 address as IPv6.
  if (zero(0, 10) && bytes[10] === 255 && bytes[11] === 255) return true;
  const inner = embeddedIpv4(address);
  if (inner !== null && reservedV4(inner)) return true;
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes;
  if (b0 === 0x01 && b1 === 0x00 && zero(2, 8)) return true; // 100::/64
  if (b0 === 0x20 && b1 === 0x01) {
    if (b2 === 0x00 && b3 === 0x00) return true; // Teredo 2001::/32
    if (b2 === 0x0d && b3 === 0xb8) return true; // 2001:db8::/32
    if (b2 === 0x00 && (b3 & 0xf0) === 0x10) return true; // 2001:10::/28
    if (b2 === 0x00 && (b3 & 0xf0) === 0x20) return true; // 2001:20::/28
  }
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true; // fec0::/10
  return b0 === 0xff; // ff00::/8
}

/** What kind of place an address is. Not an address at all reads as public: the caller looks names up first. */
export function addressKind(raw: string): AddressKind {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(address) === 4) return ipv4Kind(address);
  if (isIP(address) !== 6) return 'public';
  const inner = embeddedIpv4(address);
  if (inner !== null) return ipv4Kind(inner);
  if (address === 'fd00:ec2::254' || /^fe[89ab]/.test(address)) return 'metadata';
  if (/^f[cd]/.test(address)) return 'private';
  return 'public';
}

/**
 * The host as the system resolver will read it. `getaddrinfo` takes the old
 * inet_aton spellings (`2852039166`, `0xa9fea9fe`, `127.1`, `0177.0.0.1`,
 * `0x7f.1`) and IPv4 inside IPv6 (`::ffff:169.254.169.254`), and a
 * `postgres:`/`mysql:` URL keeps its host exactly as written. The WHATWG
 * parser for an http URL turns every one of those into the plain address, so
 * the checks see what the driver will dial. A name that is not an address
 * comes back lower-cased, its trailing dot kept.
 */
export function canonicalHost(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  try {
    const wrapped = bare.includes(':') ? `[${bare}]` : bare;
    return new URL(`http://${wrapped}/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return bare;
  }
}

export const METADATA_NAME = 'metadata.google.internal';

/** What a host is by how it is written, before any lookup. */
export function hostSpelling(host: string): { host: string; metadata: boolean; loopback: boolean } {
  const h = canonicalHost(host);
  const name = h.replace(/\.$/, '');
  const kind = isIP(h) === 0 ? null : addressKind(h);
  return {
    host: h,
    metadata: kind === 'metadata' || name === METADATA_NAME,
    loopback: kind === 'loopback' || name === 'localhost' || name.endsWith('.localhost'),
  };
}

/** A name's addresses, as `dns.lookup(name, { all: true })` answers. */
export type HostLookup = (host: string) => Promise<readonly string[]>;

/**
 * The lookup the drivers make: `net.connect` asks `getaddrinfo` for every
 * address (`all`, for its family fallback) with `ADDRCONFIG`, so a name is
 * checked at exactly the addresses a connection could reach.
 */
export const systemLookup: HostLookup = async (host) => (await lookup(host, { all: true, hints: ADDRCONFIG })).map((entry) => entry.address);

export interface HostPolicy {
  /** Refuse this machine (loopback). */
  blockLoopback?: boolean | undefined;
  /** Refuse the server's own network (private ranges). */
  blockPrivate?: boolean | undefined;
  /** The operator named this host (and port) as allowed: loopback and private pass. Metadata never does. */
  listed?: boolean | undefined;
  /**
   * Refuse reserved and special-purpose ranges ({@link isReservedAddress}): the source-database guard under
   * `strict`, and always for the user's own host. A listed host passes.
   */
  blockReserved?: boolean | undefined;
  /** Addresses never to dial whatever else says (the fleet's own, `ADMINIUM_DATABASE_DENY_ADDRESSES`). Not skipped by `listed`. */
  denied?: ((address: string) => boolean) | undefined;
  /** Refuse a name that does not resolve. Default: wherever loopback or private addresses are blocked. */
  failClosed?: boolean | undefined;
  /** Test seam: the lookup. Default {@link systemLookup}. */
  lookup?: HostLookup | undefined;
}

export type HostRefusal = 'metadata' | 'loopback' | 'private' | 'reserved' | 'denied' | 'unresolved';

export type HostCheck =
  | {
      ok: true;
      /** As the resolver reads it ({@link canonicalHost}). */
      host: string;
      /** Every address that passed, in the resolver's order; the first is the one to dial. Empty only for an unresolved name let through. */
      addresses: string[];
      /** The host was a name and was looked up (an address needs no lookup). */
      looked: boolean;
    }
  | {
      ok: false;
      host: string;
      reason: HostRefusal;
      /** The address that was refused, when one was. */
      address?: string;
    };

/** Whether one address may be dialled under a policy. */
function refusalFor(address: string, policy: HostPolicy): HostRefusal | null {
  const kind = addressKind(address);
  if (kind === 'metadata') return 'metadata';
  if (policy.denied?.(address) === true) return 'denied';
  if (policy.listed === true) return null;
  if (kind === 'loopback' && policy.blockLoopback === true) return 'loopback';
  if (kind === 'private' && policy.blockPrivate === true) return 'private';
  if (policy.blockReserved === true && isReservedAddress(address)) return 'reserved';
  return null;
}

/**
 * Check a host: its spelling first (no lookup needed to refuse `localhost.`
 * or `0x7f.1`), then every address the lookup gives. Never throws: a refusal
 * names its reason, and the caller says it in its own words.
 */
export async function checkHost(rawHost: string, policy: HostPolicy = {}): Promise<HostCheck> {
  const spelled = hostSpelling(rawHost);
  const host = spelled.host;
  if (spelled.metadata) return { ok: false, host, reason: 'metadata' };
  if (spelled.loopback && policy.blockLoopback === true && policy.listed !== true) return { ok: false, host, reason: 'loopback' };
  if (isIP(host) !== 0) {
    const refused = refusalFor(host, policy);
    return refused === null ? { ok: true, host, addresses: [host], looked: false } : { ok: false, host, reason: refused, address: host };
  }
  const failClosed = policy.failClosed ?? (policy.blockLoopback === true || policy.blockPrivate === true || policy.blockReserved === true);
  let addresses: string[];
  try {
    addresses = [...(await (policy.lookup ?? systemLookup)(host))];
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    return failClosed ? { ok: false, host, reason: 'unresolved' } : { ok: true, host, addresses: [], looked: true };
  }
  for (const address of addresses) {
    const refused = refusalFor(address, policy);
    if (refused !== null) return { ok: false, host, reason: refused, address };
  }
  return { ok: true, host, addresses, looked: true };
}
