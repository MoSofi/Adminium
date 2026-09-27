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
 * `write-service.ts` re-exports them all, so every existing importer is
 * unaffected. `WriteContext` followed for the same reason: the outbox tells its
 * own writes apart by their context, and the service asks it. `WriteTarget`
 * followed too: the capacity guard, the moments and a write with child rows
 * name the table a write goes to, and the service reads all three.
 */
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { Moment } from '@adminium/manifest';
import type { TablePrivileges } from '@adminium/engine/adapter';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

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

export interface WriteContext {
  origin: WriteOrigin;
  /**
   * How many hook and automation writes deep this one is: 0 for a person's
   * write. The same counter automations keep (`crud/after-record-write.ts`).
   */
  hops: number;
  actor: WriteActor | null;
  /** The HTTP request behind the write, when there is one. */
  request: FastifyRequest | null;
  /**
   * The signed-in person's own row, on a public write made in a session: a
   * stamp of `claim` reads their email or name from it. Absent, such a stamp
   * writes nothing.
   */
  claimed?: Row | null | undefined;
  /**
   * When the thing the write records really happened, as the writer's device
   * says: a door scan made offline and sent later. Absent, the write happened
   * now. Only a staff or API-key write may carry one, and only a little in the
   * past; the write's clock (`write-clock.ts`) puts it in place of now for the
   * row's own rules, never for counting a shared limit.
   */
  occurredAt?: Date | undefined;
  /**
   * A move the app declared that Adminium makes itself — a timed move once its
   * moment has passed, a linked row moved by an effect. The roles a listed
   * move is kept for do not stop it, for this move only (`from` absent: from
   * any state); everything else it waits for is judged as for anyone. A
   * timed move names its moment too (`at`): it is made only while the row, as
   * held, is still due by it.
   */
  declared?: { from?: string | undefined; to: string; at?: Moment | undefined } | undefined;
}

/** The table a write goes to, and the connection it goes through. */
export interface WriteTarget {
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  /**
   * The venue's time zone (IANA), where a rule reads a wall clock: a booking
   * limit's hours and window, a venue-local column. The public API passes its
   * key's; otherwise the connection's is looked up when a rule needs it, and
   * UTC stands in when the connection names none.
   */
  timezone?: string | undefined;
  /**
   * What the connection's data role may write in this table, when known
   * (`ConnectionManager.tablePrivileges`): a column it may not write is refused
   * when sent and never filled. Absent ⇒ unknown ⇒ everything, and the
   * database decides.
   */
  rights?: TablePrivileges | null | undefined;
}
