// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One call to a provider's fixed address, and an honest account of what
 * happened to it.
 *
 * The question that matters after a failed POST is "could it have arrived?".
 * Only a failure on the short list below proves it could not: no connection
 * was ever made, so no byte of the request left. Everything else (a timeout, a
 * reset, a socket closed mid-way, a code nobody listed) is `lost`, which callers
 * must treat as "it may have gone". A new failure code therefore lands on the
 * safe side by itself.
 *
 * A redirect is never followed: it would carry the key elsewhere. The failure's
 * own text is dropped, because it can quote the address and so the account.
 */
import { failureCode } from '../net/safe-fetch.js';

/** Failures that happen before a request is written: no route, no name, no connection, a certificate refused. */
const NEVER_CONNECTED: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** More than any answer these APIs give to one message or one account. */
const MAX_REPLY_BYTES = 256 * 1024;

export const SMS_CALL_TIMEOUT_MS = 15_000;

export interface SmsCallContext {
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface SmsCallRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export type SmsCallResult =
  /** `json` is null when the body was unreadable, cut short or not JSON. */
  | { kind: 'answered'; status: number; headers: Headers; json: unknown }
  /** Certainly not delivered to the provider. */
  | { kind: 'no-connection' }
  /** The caller had already stopped: nothing was attempted. */
  | { kind: 'cancelled' }
  /** It may have arrived. */
  | { kind: 'lost'; reason: 'timeout' | 'connection-lost' };

async function readJson(response: Response): Promise<unknown> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPLY_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function callProvider(context: SmsCallContext, request: SmsCallRequest): Promise<SmsCallResult> {
  const callerStopped = (): boolean => context.signal?.aborted === true;
  if (callerStopped()) return { kind: 'cancelled' };
  const timeout = AbortSignal.timeout(context.timeoutMs);
  const signal = context.signal === undefined ? timeout : AbortSignal.any([context.signal, timeout]);
  try {
    const response = await context.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      signal,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    return { kind: 'answered', status: response.status, headers: response.headers, json: await readJson(response) };
  } catch (error) {
    if (timeout.aborted) return { kind: 'lost', reason: 'timeout' };
    if (callerStopped()) return { kind: 'lost', reason: 'connection-lost' };
    const code = failureCode(error);
    if (code !== undefined && NEVER_CONNECTED.has(code)) return { kind: 'no-connection' };
    return { kind: 'lost', reason: 'connection-lost' };
  }
}

/** The longest wait a provider's `Retry-After` is taken at. */
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** A `Retry-After` header in milliseconds, in seconds or as a date; null when absent or unreadable. */
export function retryAfterMs(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (raw === undefined || raw === '') return null;
  const seconds = /^\d{1,7}$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_MS);
}

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** An id or a status word from a reply, kept only when it is the plain token it should be. */
export function plainToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

export const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const STATUS_WORD = /^[a-z_]{1,32}$/;
const AMOUNT = /^-?\d{1,12}(?:\.\d{1,12})?$/;
const CURRENCY = /^[A-Za-z]{3}$/;

/** A price from a reply, or null when either half is missing or odd. */
export function priceOf(amount: unknown, currency: unknown): { amount: string; currency: string } | null {
  const value = typeof amount === 'number' ? String(amount) : amount;
  if (typeof value !== 'string' || !AMOUNT.test(value) || typeof currency !== 'string' || !CURRENCY.test(currency)) return null;
  return { amount: value, currency: currency.toUpperCase() };
}

/** A segment count from a reply (Twilio writes it as a string), or null. */
export function segmentsOf(value: unknown): number | null {
  const count = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : value;
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 9999 ? count : null;
}
