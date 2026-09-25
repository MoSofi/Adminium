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
}

export function tokenClaimOf(scope: CompiledScope): TokenClaim | null {
  const claim = scope.claim;
  if (claim === null || claim === undefined || claim.strategy !== 'token') return null;
  const column = claim.match[0];
  if (column === undefined) return null;
  return { ref: claim.ref, column, ...(claim.expires === undefined ? {} : { expires: claim.expires }), ...(claim.stopped === undefined ? {} : { stopped: claim.stopped }) };
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
  return stillOpen(row[0]!, input.claim, input.table, input.timezone, input.now ?? new Date());
}
