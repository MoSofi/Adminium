// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the notice readers share: the path token and basic-auth checks (both
 * in constant time), reading a header, and turning a service's address and
 * time into Adminium's.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { normaliseAddress } from '../../public-api/claim-code.js';
import type { BasicCredentials, NoticeEndpointConfig, NoticeEvent, NoticeEventKind, NoticeRequest } from './types.js';

/** Bytes of randomness in a path token: 256 bits, 43 characters of base64url. */
const TOKEN_BYTES = 32;

/** A new path token: long and random, so the address itself is a capability. */
export function mintNoticeToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** New credentials for a service that signs nothing: the owner copies them into the service. */
export function mintBasicCredentials(service: string): BasicCredentials {
  return { user: `adminium-${service}`, pass: randomBytes(24).toString('base64url') };
}

/** sha256 of each side, compared in constant time: neither the value nor its length leaks through timing. */
export function sameSecret(given: string, kept: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(kept, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Whether the token in the address is the endpoint's, in constant time. */
export function tokenMatches(endpoint: NoticeEndpointConfig, pathToken: string): boolean {
  const given = createHash('sha256').update(pathToken, 'utf8').digest();
  const kept = Buffer.from(endpoint.tokenHash, 'hex');
  return kept.length === given.length && timingSafeEqual(given, kept);
}

/** One header's value; the first when it came more than once. */
export function headerOf(request: NoticeRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

/** Whether the call carries the credentials kept (`Authorization: Basic …`). Both parts are always compared. */
export function basicMatches(request: NoticeRequest, kept: BasicCredentials): boolean {
  const header = headerOf(request, 'authorization');
  const match = header === null ? null : /^basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  const decoded = match === null ? '' : Buffer.from(match[1] as string, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  const user = colon < 0 ? '' : decoded.slice(0, colon);
  const pass = colon < 0 ? '' : decoded.slice(colon + 1);
  // `&` rather than `&&`: the password is compared even when the user name is wrong.
  return (Number(sameSecret(user, kept.user)) & Number(sameSecret(pass, kept.pass)) & Number(colon >= 0)) === 1;
}

/** The body as JSON, or undefined when it is not JSON. */
export function jsonOf(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A field as a string, or null. */
export function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

/** An address as Adminium keeps it; null when it is not one. */
export function addressOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = normaliseAddress(value);
  // A bare `local@domain`: one @, something on each side, no spaces, no display name.
  return /^[^\s@<>]+@[^\s@<>]+$/.test(address) && address.length <= 320 ? address : null;
}

/** An ISO date's epoch ms, or null. */
export function isoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Seconds since the epoch (a number or its text, fractions allowed) as epoch ms, or null. */
export function secondsTime(value: unknown): number | null {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

/** One event, or none when the address is not one. */
export function eventOf(address: unknown, kind: NoticeEventKind, permanent: boolean, relayEventId: string | null, at: number | null): NoticeEvent[] {
  const clean = addressOf(address);
  return clean === null ? [] : [{ address: clean, kind, permanent, relayEventId, at }];
}
