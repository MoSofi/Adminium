// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-queue-inbox` mutation adapter contract.
 *
 * The template stays fetch-free (discipline): the dashboard binding implements
 * this over the generated CRUD API's bulk endpoint (`POST
 * /api/v1/data/:connectionId/:table/bulk`, apps/dashboard/src/api/crud.ts) whose
 * reply carries the single-use undo token — the server captured the EXACT prior
 * values of the exact id set, which is what makes the queue's undo-first bulk
 * semantics safe to expose as a one-click toast action. Stories/tests pass an
 * in-memory fake.
 */

export interface QueueMutationResult {
  /** Single-use undo token, or null when the backend cannot undo this write. */
  undoToken: string | null;
}

export interface QueueApi {
  /** One bulk UPDATE over the exact id set (approve / reject / mark-read). */
  bulkUpdate(ids: readonly string[], values: Record<string, unknown>): Promise<QueueMutationResult>;
  /** Redeem an undo token (compensating restore of the captured set). */
  undo(token: string): Promise<unknown>;
}
