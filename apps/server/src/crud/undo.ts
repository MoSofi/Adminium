/**
 * Undo-token pattern (08-server-api.md §2.7.3): mutations execute
 * immediately; before-images are captured in the same transaction; the
 * reply carries a single-use `undo_<ulid>` token; `POST /data/undo/:token`
 * runs compensating writes.
 *
 * Memory + meta hybrid: the live token index is in-process (single-process
 * topologies per 08 §6) keyed by SHA-256 of the token; the full undo
 * payload also lands in the audit row (`changes.undo`) for tamper-evidence
 * and post-mortems. Tokens expire after 60 s (§2.7.3 step 2).
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Row } from './mask.js';

export const UNDO_TTL_MS = 60_000;

export type UndoAction = 'create' | 'update' | 'delete';

export interface UndoEntry {
  auditId: string | null;
  /** Only the issuing user may undo (§2.7.3 step 4). */
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

  issue(entry: Omit<UndoEntry, 'expiresAt'>, ttlMs: number = UNDO_TTL_MS): IssuedUndo {
    this.#sweep();
    const token = `undo_${randomBytes(16).toString('hex')}`;
    const stored: UndoEntry = { ...entry, expiresAt: this.#now() + ttlMs };
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
 * Value-normalizing row comparison for the unchanged-since-mutation check
 * (§2.7.3 step 4). Dates round-trip as ISO strings; bigints as strings.
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
