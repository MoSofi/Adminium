// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one database host of the user's own that a trial or hosted installation
 * may reach besides the operator's list, and the addresses it may never be.
 *
 * adminium.app checks a visitor's database from a one-off container
 * (`adminium check-source`), then starts the trial with three variables:
 *
 *   ADMINIUM_YOUR_DATABASE            the database itself (`config/your-database.ts`);
 *   ADMINIUM_DATABASE_USER_HOST       `host:port`, the host the check passed;
 *   ADMINIUM_DATABASE_DENY_ADDRESSES  the fleet's own addresses (public, private,
 *                                     floating), IPs or CIDR ranges.
 *
 * The user host is never "any host": it is the one the check passed, and only
 * while `ADMINIUM_YOUR_DATABASE` is set. It never gets a listed host's skip:
 * every lookup and every re-check holds it to the public internet (no
 * loopback, private, reserved or metadata address, nothing on the deny list),
 * and its port is a database's, not one of the services a fleet runs.
 */
import { isIP } from 'node:net';

import { canonicalHost, hostSpelling } from '../net/address-guard.js';

/**
 * Ports a user host may never name, though they are ≥ 1024: Docker's API (2375, 2376), etcd (2379), Redis (6379),
 * Kubernetes and admin panels (8443), Elasticsearch (9200), the kubelet (10250), memcached (11211), MongoDB (27017).
 */
export const DENIED_USER_PORTS: ReadonlySet<number> = new Set([2375, 2376, 2379, 6379, 8443, 9200, 10250, 11211, 27017]);

/** The lowest port a user host may name: below it are the system's own services (22 is SSH). */
export const USER_PORT_MIN = 1024;

/** Why a port is refused for a user host, or null when it may be dialled. */
export function userPortRefusal(port: number): string | null {
  if (!Number.isInteger(port) || port < USER_PORT_MIN || port > 65535) return `is not a database port (${String(USER_PORT_MIN)}–65535)`;
  if (DENIED_USER_PORTS.has(port)) return 'is a port this server never connects to';
  return null;
}

export interface UserHost {
  /** As the resolver reads it, lower case, no trailing dot, IPv6 without brackets. */
  host: string;
  port: number;
}

/** Read `host:port` (`[v6]:port` for an IPv6 address). The port is required: it is the one the check passed. */
export function parseUserHost(raw: string): { ok: true; entry: UserHost } | { ok: false; problem: string } {
  const text = raw.trim().toLowerCase();
  const bracketed = /^\[([0-9a-f:.]+)\]:(\d{1,5})$/.exec(text);
  const plain = /^([a-z0-9_.-]+):(\d{1,5})$/.exec(text);
  const match = bracketed ?? plain;
  if (match === null) return { ok: false, problem: 'must be one host:port, e.g. db.example.com:5432 ([2001:db8::1]:5432 for an IPv6 address)' };
  const rawHost = (match[1] ?? '').replace(/\.$/, '');
  if (bracketed !== null && isIP(rawHost) !== 6) return { ok: false, problem: 'holds an IPv6 address that does not parse' };
  if (rawHost === '' || rawHost.startsWith('*')) return { ok: false, problem: 'must name one host, not a pattern' };
  const port = Number(match[2]);
  const portProblem = userPortRefusal(port);
  if (portProblem !== null) return { ok: false, problem: `names port ${String(port)}, which ${portProblem}` };
  const spelled = hostSpelling(rawHost);
  if (spelled.metadata || spelled.loopback) return { ok: false, problem: 'names an address this server never connects to' };
  return { ok: true, entry: { host: spelled.host.replace(/\.$/, ''), port } };
}

/** Whether a parsed DSN's host and port are the user host. */
export function isUserHost(userHost: UserHost | null | undefined, host: string | null, port: number | null): boolean {
  if (userHost === null || userHost === undefined || host === null || port === null) return false;
  return canonicalHost(host).replace(/\.$/, '') === userHost.host && port === userHost.port;
}

/** One deny entry: an address or a CIDR range, as bytes. */
export interface DenyRange {
  /** 4 or 16 bytes. */
  bytes: number[];
  /** Prefix length in bits. */
  bits: number;
  /** As written, for the operator's messages only. */
  text: string;
}

function v4Bytes(address: string): number[] {
  return address.split('.').map(Number);
}

/** The 16 bytes of an IPv6 address (a trailing dotted IPv4 part included). */
export function v6Bytes(address: string): number[] {
  let text = address.toLowerCase();
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

/** An address as bytes, or null when it is none. Brackets and a zone are dropped. */
export function addressBytes(raw: string): number[] | null {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const version = isIP(address);
  if (version === 4) return v4Bytes(address);
  if (version === 6) return v6Bytes(address);
  return null;
}

/** Whether `bytes` lie in a range of the same family. */
export function inRange(bytes: readonly number[], range: Pick<DenyRange, 'bytes' | 'bits'>): boolean {
  if (bytes.length !== range.bytes.length) return false;
  let left = range.bits;
  for (let i = 0; i < bytes.length && left > 0; i += 1) {
    const take = Math.min(8, left);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((range.bytes[i] ?? 0) & mask)) return false;
    left -= take;
  }
  return true;
}

/** Read `ADMINIUM_DATABASE_DENY_ADDRESSES`: comma-separated addresses or CIDR ranges. */
export function parseDenyAddresses(raw: string): { ok: true; ranges: DenyRange[] } | { ok: false; refused: string[] } {
  const ranges: DenyRange[] = [];
  const refused: string[] = [];
  for (const entry of raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0)) {
    const [address = '', prefix] = entry.split('/');
    const bytes = addressBytes(address);
    const max = bytes === null ? 0 : bytes.length * 8;
    const bits = prefix === undefined ? max : /^\d{1,3}$/.test(prefix) ? Number(prefix) : -1;
    if (bytes === null || bits < 0 || bits > max) refused.push(entry);
    else ranges.push({ bytes, bits, text: entry });
  }
  return refused.length > 0 ? { ok: false, refused } : { ok: true, ranges };
}

/** Whether an address is on the deny list. An IPv4-mapped IPv6 address is read as its IPv4 address too. */
export function addressDenied(address: string, ranges: readonly DenyRange[] | undefined): boolean {
  if (ranges === undefined || ranges.length === 0) return false;
  const bytes = addressBytes(address);
  if (bytes === null) return false;
  const forms = [bytes];
  if (bytes.length === 16 && bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255) forms.push(bytes.slice(12));
  return forms.some((form) => ranges.some((range) => inRange(form, range)));
}
