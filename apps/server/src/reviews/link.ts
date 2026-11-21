// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE REVIEW LINK ONLY A REVIEW MAIL CARRIES.
 *
 * A booking's own link is handed to whoever made the booking, and a stranger
 * can make one in anybody's address, so a row whose word names `proved` cannot
 * be reviewed through it. The mail is the proof instead: it goes to the address
 * on the person's row, and only that mailbox holds this link.
 *
 * The link reviews ONE row, once, and does nothing else: it opens no session
 * and reads no other column. It lasts {@link REVIEW_LINK_TTL_MS}, so the request
 * the morning after and its reminder days later both still work, and it dies
 * with the address it was sent to: a person whose address changed is no longer
 * the one the mail reached.
 */
import { createHash } from 'node:crypto';

import type { Review } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { openLink, sealLink } from '../email/sealed-link.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { followPath } from './take.js';

const KIND = 'review';

/** How long a review link works: past the morning-after mail and its reminder, with weeks to spare. */
export const REVIEW_LINK_TTL_MS = 30 * 86_400_000;

/** What a review link says. */
export interface ReviewLinkClaim {
  /** The install, the app and the database it was made on. */
  install: string;
  app: string;
  connection: string;
  /** The reviewed row: its table's id and its key. */
  table: string;
  row: string;
  /** The person's address column, and a digest of the address the mail went to. */
  column: string;
  address: string;
  expires: number;
}

/** A digest of an address as sign-in compares one: trimmed, in lower case. */
export function addressDigest(address: string): string {
  return createHash('sha256').update(normaliseAddress(address)).digest('base64url');
}

export function makeReviewToken(key: string, claim: ReviewLinkClaim): string {
  return sealLink(key, KIND, { v: 1, ...claim });
}

/** What a token says, while it is this install's and has not run out; null otherwise. */
export function readReviewToken(keys: readonly string[], install: string, token: unknown, now: number): ReviewLinkClaim | null {
  const read = openLink(keys, KIND, token);
  if (read === null || read['v'] !== 1 || read['install'] !== install) return null;
  const { app, connection, table, row, column, address, expires } = read;
  if (typeof app !== 'string' || typeof connection !== 'string' || typeof table !== 'string' || typeof row !== 'string' || typeof column !== 'string' || typeof address !== 'string' || typeof expires !== 'number') return null;
  if (expires <= now) return null;
  return { install, app, connection, table, row, column, address, expires };
}

/** The person a link's row reaches, while the address on their row is still the one the mail went to; null otherwise. */
export async function personOfLink(db: Kysely<SourceDatabase>, view: SnapshotView, table: ResolvedTable, row: Row, word: Review, claim: ReviewLinkClaim): Promise<{ table: ResolvedTable; row: Row } | null> {
  const person = await followPath(db, view, table, row, word.person, 'row');
  if (person === null) return null;
  const stored = person.row[claim.column];
  if (typeof stored !== 'string' || stored.trim() === '' || addressDigest(stored) !== claim.address) return null;
  return { table: person.table, row: person.row };
}
