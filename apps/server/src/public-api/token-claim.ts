// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row shared by link: an unguessable code in one of its columns (a
 * 16-character `code`, 80 bits) opens that one row, and what the key declares
 * with it, to whoever holds the link — a studio's handover page for a printer.
 * No email, no person: the link is the credential.
 *
 * ── CLOSED AT ONCE ─────────────────────────────────────────────────────────
 * A session opened by a link is checked against the row on EVERY request:
 * stopped, expired, or given a new code ("Make a new link"), and the session
 * reaches nothing from that moment — not at its expiry half an hour later.
 * The session carries the hash of the code it was opened with; a new code on
 * the row no longer matches it.
 *
 * ── AN OWN LINK IS BOUND TO ITS ADDRESS ────────────────────────────────────
 * A row's own link is emailed to an address the row holds (`address`: a
 * ticket's link goes to the friend it is offered to). A session opened by it
 * carries the (keyed) hashes of the addresses the row held then, and opens the
 * row only while the row still holds one of them: an offer that lapsed and
 * went to someone else is not the first friend's to read or accept, even with
 * a session opened while it was theirs.
 */
import { createHash } from 'node:crypto';

import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { venueClock } from '../crud/venue-time.js';
import { normaliseCode, type ClaimGrant } from './claim.js';
import type { CompiledScope } from './scope.js';

/** A token claim, as a compiled scope carries it. */
export interface TokenClaim {
  ref: string;
  column: string;
  expires?: string | undefined;
  stopped?: string | undefined;
  /** An own link's address columns: where it may be emailed, and what its sessions are bound to. */
  address?: readonly string[] | undefined;
}

export function tokenClaimOf(scope: CompiledScope): TokenClaim | null {
  const claim = scope.claim;
  if (claim === null || claim === undefined || claim.strategy !== 'token') return null;
  const column = claim.match[0];
  if (column === undefined) return null;
  return {
    ref: claim.ref,
    column,
    ...(claim.expires === undefined ? {} : { expires: claim.expires }),
    ...(claim.stopped === undefined ? {} : { stopped: claim.stopped }),
    ...(claim.own === true && claim.address !== undefined ? { address: claim.address } : {}),
  };
}

/** A keyed hash of an address, as a grant keeps it (never the address itself). */
export type AddressHasher = (address: string) => string;

/** The hashes of the addresses a row holds in an own link's address columns, or undefined for a link bound to none. */
export function addressesOf(row: Row, address: readonly string[] | undefined, hash: AddressHasher): string[] | undefined {
  if (address === undefined) return undefined;
  const out: string[] = [];
  for (const column of address) {
    const value = row[column];
    if (typeof value === 'string' && value.trim() !== '') out.push(hash(value));
  }
  return [...new Set(out)];
}

/**
 * Whether a row still holds an address its session was opened for: one of the
 * same, or — for a session opened while the row held none — still none. A
 * grant that carries no addresses on a link bound to them opens nothing.
 */
export function stillAddressed(row: Row, address: readonly string[] | undefined, grant: ClaimGrant, hash: AddressHasher): boolean {
  const now = addressesOf(row, address, hash);
  if (now === undefined) return true;
  const then = (grant as Partial<TokenGrant>).addresses;
  if (!Array.isArray(then)) return false;
  return then.length === 0 ? now.length === 0 : now.some((one) => then.includes(one));
}

/** A token as its column's `code` rule writes it (Crockford, upper case), whatever the page sent. */
export function normaliseToken(table: ResolvedTable, column: string, token: string): string {
  const rule = table.table.columns.find((c) => c.name === column)?.code;
  return rule === undefined ? token.trim() : normaliseCode(token, rule);
}

export function hashToken(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

/** A day as `YYYY-MM-DD`, whatever the driver handed back. */
function dayOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * Whether a shared row is still open: not stopped, not past its expiry. An
 * expiry on a date runs through that day on the venue's calendar; on a time,
 * up to that moment. No expiry, no end.
 */
export function stillOpen(row: Row, claim: TokenClaim, table: ResolvedTable, timezone: string, now: Date): boolean {
  if (claim.stopped !== undefined) {
    const stopped = row[claim.stopped];
    if (stopped === true || stopped === 1 || stopped === '1' || stopped === 't' || stopped === 'true') return false;
  }
  if (claim.expires !== undefined) {
    const expires = row[claim.expires];
    if (expires === null || expires === undefined) return true;
    const type = table.columns.get(claim.expires)?.logicalType;
    if (type === 'date') {
      const day = dayOf(expires);
      return day !== null && day >= venueClock(now, timezone).day;
    }
    const at = expires instanceof Date ? expires : new Date(String(expires));
    return !Number.isNaN(at.getTime()) && at.getTime() > now.getTime();
  }
  return true;
}

/** The grant a token session carries: the row's key, and the hash of the code that opened it. */
export interface TokenGrant extends ClaimGrant {
  token: string;
  /** An own link bound to its address: the hashes of the addresses the row held when the session was opened. */
  addresses?: string[] | undefined;
}

/**
 * Whether a token session still opens its row, asked on every request: the
 * row still there, still carrying the code the session was opened with, not
 * stopped and not expired.
 */
export async function tokenSessionOpen(input: {
  db: Kysely<SourceDatabase>;
  table: ResolvedTable;
  claim: TokenClaim;
  grant: ClaimGrant;
  timezone: string;
  now?: Date;
  /** How an own link's addresses are hashed; without it a link bound to its address opens nothing. */
  hashAddress?: AddressHasher | undefined;
}): Promise<boolean> {
  const token = (input.grant as Partial<TokenGrant>).token;
  if (typeof token !== 'string') return false;
  const row = (await input.db
    .selectFrom(input.table.id as never)
    .selectAll()
    .where(input.db.dynamic.ref(input.grant.column), '=', input.grant.value as never)
    .limit(2)
    .execute()) as Row[];
  if (row.length !== 1) return false;
  const current = row[0]![input.claim.column];
  if (typeof current !== 'string' || hashToken(normaliseToken(input.table, input.claim.column, current)) !== token) return false;
  if (input.claim.address !== undefined && (input.hashAddress === undefined || !stillAddressed(row[0]!, input.claim.address, input.grant, input.hashAddress))) return false;
  return stillOpen(row[0]!, input.claim, input.table, input.timezone, input.now ?? new Date());
}
