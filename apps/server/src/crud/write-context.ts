// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO a write is, and where it came from — a leaf.
 *
 * These three types belong with `write-service.ts`, which owns the write, and
 * they lived there until `column-rules.ts` needed them: the fill step has to
 * know whether this is a create or an update, and who is signed in, to answer
 * "the current date and time, on update" and "the signed-in user". A type-only
 * import was enough for TypeScript and not enough for the dependency graph —
 * rules → service → rules is a cycle whether or not any value crosses it.
 *
 * Splitting them out rather than duplicating them keeps ONE vocabulary: an
 * origin the hooks understand and the rules do not would be two answers to the
 * same question.
 *
 * `write-service.ts` re-exports all three, so every existing importer is
 * unaffected.
 */

/** The three things a write does to a row. */
export type WriteAction = 'create' | 'update' | 'delete';

/** Where a write came from, as project hooks see it. */
export type WriteOrigin =
  | 'dashboard'
  | 'bulk'
  | 'undo'
  | 'public'
  | 'automation'
  | 'import'
  | 'hook'
  | 'action';

/** Who a write is attributed to. */
export interface WriteActor {
  kind: 'user' | 'api-key' | 'public' | 'automation' | 'system';
  /** The user, API key or rule id; null for the public API and the system. */
  id: string | null;
  /** What the audit trail shows: a name, a key label, a rule's name. */
  label: string;
}
