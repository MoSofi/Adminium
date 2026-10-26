// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Small pieces a person's data is read with: whether a text holds an address,
 * and a stored value as plain JSON (what the download writes).
 */
import { normaliseAddress } from '../public-api/claim-code.js';

/** What may sit right before an address and still be part of it (the local part's characters). */
const BEFORE = /[a-z0-9._%+-]/;
/** What may sit right after an address and still be part of it (a domain's characters). */
const AFTER = /[a-z0-9_-]/;

/**
 * Whether `text` holds `address` (already normalised) as a whole address:
 * `Marta <marta@cobalt.example>` and `…wrote to marta@cobalt.example.` do;
 * `xmarta@cobalt.example` and `marta@cobalt.example.org` do not. Case is
 * ignored, as everywhere an address is compared.
 */
export function holdsAddress(text: string, address: string): boolean {
  if (address === '') return false;
  const haystack = text.toLowerCase();
  let at = haystack.indexOf(address);
  while (at !== -1) {
    const before = at === 0 ? '' : haystack[at - 1]!;
    const end = at + address.length;
    const after = haystack[end] ?? '';
    // A full stop ends a sentence unless a domain goes on after it.
    const domainGoesOn = after === '.' && AFTER.test(haystack[end + 1] ?? '');
    if (!BEFORE.test(before) && !AFTER.test(after) && !domainGoesOn) return true;
    at = haystack.indexOf(address, at + 1);
  }
  return false;
}

/** Whether a stored value is the address itself, as `normaliseAddress` spells both. */
export function isAddress(value: unknown, address: string): boolean {
  return typeof value === 'string' && normaliseAddress(value) === address;
}

/** Whether a JSON value holds the address in any of its strings (keys included). */
export function jsonHoldsAddress(value: unknown, address: string): boolean {
  if (typeof value === 'string') return holdsAddress(value, address);
  if (Array.isArray(value)) return value.some((item) => jsonHoldsAddress(item, address));
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) => holdsAddress(key, address) || jsonHoldsAddress(item, address));
  return false;
}

/** A stored value as plain JSON: a date as ISO text, bytes as base64, a big integer as text. */
export function plainValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]));
  return value;
}

/** A row as plain JSON. */
export function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plainValue(value)]));
}
