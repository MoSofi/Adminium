// SPDX-License-Identifier: AGPL-3.0-only
/**
 * In-process single-use undo store for an LLM apply (06-llm-assist.md §8.3 /
 * §10.3 "success toast with Undo").
 *
 * `applyRun` captures a full before-image ({@link ApplyUndo}) inside its write
 * transaction; the apply route parks that image here under a `llmundo_<hex>`
 * token, returns the token in the reply, and the review screen renders it as the
 * toast's Undo action. `POST /llm/runs/:id/undo/:token` consumes the token and
 * replays {@link ApplyService.undoApply} in one transaction.
 *
 * Mirrors the CRUD `UndoStore` (crud/undo.ts): tokens are SHA-256-indexed,
 * single-use, expire after the toast window, and record the issuing user so only
 * the applier may undo. Single-process topology per 08-server-api.md §6.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { ApplyUndo } from './apply-service.js';

/** The toast window the Undo action stays live for. */
export const LLM_UNDO_TTL_MS = 60_000;

export interface LlmApplyUndoEntry {
  /** Only the user who applied the run may undo it (mirrors CRUD undo). */
  userId: string | null;
  /** The run this apply belongs to — audit + query invalidation on the client. */
  runId: string;
  connectionId: string;
  /** The captured before-image replayed by {@link ApplyService.undoApply}. */
  undo: ApplyUndo;
  expiresAt: number;
}

export interface IssuedLlmUndo {
  token: string;
  entry: LlmApplyUndoEntry;
}

export type LlmUndoConsumeResult =
  | { status: 'ok'; entry: LlmApplyUndoEntry }
  | { status: 'expired' }
  | { status: 'unknown' };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class LlmApplyUndoStore {
  readonly #entries = new Map<string, LlmApplyUndoEntry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(entry: Omit<LlmApplyUndoEntry, 'expiresAt'>, ttlMs: number = LLM_UNDO_TTL_MS): IssuedLlmUndo {
    this.#sweep();
    const token = `llmundo_${randomBytes(16).toString('hex')}`;
    const stored: LlmApplyUndoEntry = { ...entry, expiresAt: this.#now() + ttlMs };
    this.#entries.set(hashToken(token), stored);
    return { token, entry: stored };
  }

  /** Single-use: any consume removes the token (expired ones report 410-able state). */
  consume(token: string): LlmUndoConsumeResult {
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
    const cutoff = this.#now() - LlmApplyUndoStore.SWEEP_GRACE_MS;
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt < cutoff) this.#entries.delete(key);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
