// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Undo-token pattern: mutations execute immediately; before-images are
 * captured in the same transaction; the reply carries a single-use
 * `undo_<ulid>` token; `POST /data/undo/:token` runs compensating writes.
 *
 * Memory + meta hybrid: the live token index is in-process (single-process
 * topologies) keyed by SHA-256 of the token; the full undo payload also
 * lands in the audit row (`changes.undo`) for tamper-evidence and
 * post-mortems. Tokens expire after 60 s.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Row } from './mask.js';

export const UNDO_TTL_MS = 60_000;

export type UndoAction = 'create' | 'update' | 'delete';

/**
 * One relation's link set, before and after the write that changed it.
 *
 * Without this an undo is a HALF-undo: the parent's columns come back and the
 * replaced links stay replaced — in the one path a person reaches for after a
 * mistake. Keys are strings, because that is what a key travels as and what
 * the diff compares.
 */
export interface UndoLinks {
  relationId: string;
  before: string[];
  after: string[];
}

/**
 * The child rows one write touched, as they were.
 *
 * `added` carries KEYS (what to delete to undo an add) while `removed` carries
 * WHOLE ROWS (what to write back to undo a removal) — the two directions need
 * different things, and storing only keys for both would make a removal
 * unrecoverable the moment the row was gone.
 */
export interface UndoChildren {
  relationId: string;
  added: Row[];
  /** Each added row as the write left it: an undo takes it away only while it is still that row. */
  addedRows?: Row[];
  removed: Row[];
  /** `after` is the row as the write left it: an undo puts `before` back only over that. */
  changed: { key: Row; before: Row; after?: Row }[];
}

export interface UndoEntry {
  auditId: string | null;
  /** Only the issuing user may undo. */
  userId: string;
  connectionId: string;
  /** Snapshot table id, e.g. `public.orders`. */
  tableId: string;
  action: UndoAction;
  pkColumns: string[];
  /** Row images before the mutation (empty for create). */
  before: Row[];
  /** Row images after the mutation (conflict detection + create deletion). */
  after: Row[];
  /** Update undo: the column set to compare + restore ([] = all columns). */
  changedColumns: string[];
  /**
   * Files trashed alongside this write.
   *
   * They are here rather than re-derived at undo time because once the row is
   * deleted there is nothing left to derive them FROM: the column values that
   * named them are gone, and the sidecar rows have already been trashed.
   */
  fileIds: string[];
  /** Link sets this write replaced, per relation. Empty for every other write. */
  links: UndoLinks[];
  /** Child rows this write added, changed or removed. Empty for every other. */
  children: UndoChildren[];
  expiresAt: number;
}

export interface IssuedUndo {
  token: string;
  entry: UndoEntry;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type UndoConsumeResult =
  | { status: 'ok'; entry: UndoEntry }
  | { status: 'expired' }
  | { status: 'unknown' };

export class UndoStore {
  readonly #entries = new Map<string, UndoEntry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(
    // `fileIds` is optional at the door and always present on the stored entry:
    // every caller that predates 37 trashes no files, and making them all say
    // `fileIds: []` would be noise at ten call sites to state a default.
    entry: Omit<UndoEntry, 'expiresAt' | 'fileIds' | 'links' | 'children'> & {
      fileIds?: string[];
      links?: UndoLinks[];
      children?: UndoChildren[];
    },
    ttlMs: number = UNDO_TTL_MS,
  ): IssuedUndo {
    this.#sweep();
    const token = `undo_${randomBytes(16).toString('hex')}`;
    const stored: UndoEntry = {
      ...entry,
      fileIds: entry.fileIds ?? [],
      links: entry.links ?? [],
      children: entry.children ?? [],
      expiresAt: this.#now() + ttlMs,
    };
    this.#entries.set(hashToken(token), stored);
    return { token, entry: stored };
  }

  /** Single-use: any consume removes the token (expired ones report 410-able state). */
  consume(token: string): UndoConsumeResult {
    const key = hashToken(token);
    const entry = this.#entries.get(key);
    if (entry === undefined) return { status: 'unknown' };
    this.#entries.delete(key);
    if (entry.expiresAt < this.#now()) return { status: 'expired' };
    return { status: 'ok', entry };
  }

  /** Expired entries linger briefly so `consume` can answer 410 instead of 404. */
  static readonly SWEEP_GRACE_MS = 10 * 60_000;

  #sweep(): void {
    const cutoff = this.#now() - UndoStore.SWEEP_GRACE_MS;
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt < cutoff) this.#entries.delete(key);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}

/**
 * Value-normalizing row comparison for the unchanged-since-mutation
 * check. Dates round-trip as ISO strings; bigints as strings.
 */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function rowsEqual(a: Row, b: Row, columns: string[]): boolean {
  return columns.every((column) => {
    const va = normalize(a[column]);
    const vb = normalize(b[column]);
    return JSON.stringify(va) === JSON.stringify(vb);
  });
}
