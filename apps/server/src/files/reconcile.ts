// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping `adminium_files` honest about what a customer's own columns
 * say.
 *
 * THE PROBLEM THIS SOLVES. A column-bound file is a plain text value in the
 * customer's table — that is the whole point of D6/D7, and it is why the
 * feature works with a foreign app writing the same column. But a plain text
 * value carries no lifecycle: nothing tells Adminium that the invoice now has
 * a PDF, or that somebody replaced it, or that the row was deleted. Without
 * this hook every upload stays "unattached" and the daily sweep trashes it
 * twenty-four hours later — the file the user attached would vanish from a
 * record that still points at it.
 *
 * So one call, from the one post-commit hook the CRUD writes already share:
 *
 *   a ref that appeared   → attach it to this record
 *   a ref that was replaced or cleared → trash the file it named
 *   a ref that did not change → nothing
 *   a value that is not ours → nothing, ever
 *
 * THE LAST RULE IS THE IMPORTANT ONE. A column may already hold URLs a foreign
 * app wrote, and an operator may point a file column at a column full of
 * third-party links. Those are external references (`parseRef` → `external`)
 * and this code does not touch them: it never trashes a file it did not
 * recognise, and it never attaches one.
 *
 * FAILURES ARE LOGGED, NEVER THROWN. This runs AFTER the customer's row is
 * committed. Throwing here would turn a successful write into a 500 with the
 * data already changed, which is the worst of both — the record is saved and
 * the user is told it failed. A file left unattached is recoverable (the
 * operator re-saves, or finds it under Unattached on the Files page); a lie
 * about whether the write happened is not.
 */

import type { FastifyBaseLogger } from 'fastify';
import { filesRepo, type MetaDb, type RecordRef, type StoredFile } from '@adminium/meta';

import type { ColumnBlockReader, ColumnFile } from './column-blocks.js';
import { parseRefList } from './refs.js';
import type { DestinationResolver } from './destinations.js';

/** The row shape the data routes carry — values are whatever the source returned. */
type Row = Record<string, unknown>;

export interface ReconcileInput {
  connectionId: string;
  table: string;
  /** The record, with its pk map and label — what `attach` stores. */
  entity: RecordRef;
  before: Row | null;
  after: Row | null;
}

export interface ReconcileResult {
  attached: string[];
  trashed: string[];
}

/**
 * Why a write to a file column cannot be accepted.
 *
 * Returned rather than thrown, for two reasons. The status code belongs to the
 * route — this module has no opinion about HTTP — and, more importantly, this
 * is the ONE file check that runs BEFORE the customer's row is written. The
 * rest of this file is a post-commit hook that must never throw (see the
 * header); keeping the pre-commit answer a value makes the difference visible
 * at every call site instead of resting on a comment.
 */
export interface FileWriteProblem {
  column: string;
  /** `not-a-list`: a `multiple` column was handed something that is not a JSON array. */
  reason: 'not-a-list' | 'too-many';
  /** Set for `too-many`: the configured cap, and what the write would have made it. */
  maxCount?: number;
  count?: number;
}

export interface FileReconciler {
  /** Called from `afterMutation` for create/update/delete of ONE row. */
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
  /**
   * Check a row's file columns BEFORE it is written; `null` means go ahead.
   *
   * WHY THE CAP IS ENFORCED HERE AND NOT ON UPLOAD. The sidecar's `maxCount`
   * can be checked at upload time because a sidecar upload names its record.
   * A column upload for a NEW record names nothing — the record does not exist
   * yet — so the only moment at which "how many files will this record have"
   * is answerable is the write that sets the column. Doing it in the
   * post-commit hook instead would mean reporting a limit after exceeding it.
   */
  validateWrite(input: {
    connectionId: string;
    table: string;
    values: Row;
  }): Promise<FileWriteProblem | null>;
  /** Every live file this record owns — column-bound and sidecar. Delete's worklist. */
  filesForRecord(input: { connectionId: string; table: string; entity: RecordRef }): Promise<StoredFile[]>;
  /**
   * Trash everything a record owned, returning the ids so the undo entry can
   * carry them. Called on DELETE, where the column values that name the
   * column-bound files are about to stop existing — which is why the row is
   * passed in rather than re-read.
   */
  trashForRecord(input: {
    connectionId: string;
    table: string;
    entity: RecordRef;
    row: Row;
  }): Promise<string[]>;
  /** Restore a delete's trashed files — the 60 s undo (D12). */
  restoreAll(fileIds: readonly string[]): Promise<void>;
}

export interface FileReconcilerDeps {
  meta: MetaDb;
  blocks: ColumnBlockReader;
  destinations: DestinationResolver;
  logger?: FastifyBaseLogger | undefined;
  now?: () => number;
}

export function createFileReconciler(deps: FileReconcilerDeps): FileReconciler {
  const files = filesRepo(deps.meta);
  const now = deps.now ?? (() => Date.now());

  /**
   * Resolve a stored value to the file rows it names — none, one, or many.
   *
   * ONE FUNCTION FOR BOTH SHAPES. A single-value column yields a one-element
   * list and a `multiple` column yields its array, so every caller below works
   * in sets and nothing has to branch on the column's block. That also means a
   * column switched to `multiple` after it already held one plain reference
   * keeps working with no migration: `parseRefList` reads the old value as a
   * list of one.
   *
   * Anything that is not ours — a foreign URL, a mistyped id — is dropped
   * here, which is what makes "never touch a file you did not recognise" a
   * property of the lookup rather than of each caller.
   */
  async function filesFor(value: unknown): Promise<StoredFile[]> {
    const parsed = parseRefList(value, await deps.destinations.publicBases());
    const out: StoredFile[] = [];
    for (const ref of parsed) {
      if (ref.kind === 'external') continue;
      const file = ref.kind === 'id' ? await files.findById(ref.id) : await files.findByStorageKey(ref.key);
      if (file !== null) out.push(file);
    }
    return out;
  }

  async function filesForRecord(input: {
    connectionId: string;
    table: string;
    entity: RecordRef;
  }): Promise<StoredFile[]> {
    // Sidecar attachments are found by the denormalized keys…
    const sidecar = await files.listByEntity({
      connectionId: input.connectionId,
      table: input.table,
      recordId: input.entity.label,
    });
    return sidecar;
  }

  return {
    filesForRecord,

    async validateWrite(input) {
      // A failure to READ the configuration must not block the customer's
      // write: the blocks are an Adminium-side convenience and the row is the
      // customer's data. Same reasoning as the post-commit hook's, applied to
      // the one check that runs before it.
      let byColumn: ReadonlyMap<string, ColumnFile>;
      try {
        ({ byColumn } = await deps.blocks.forTable(input.connectionId, input.table));
      } catch (error) {
        deps.logger?.warn(
          { err: error, table: input.table, connectionId: input.connectionId },
          'could not read file columns before a record write',
        );
        return null;
      }

      for (const [column, block] of byColumn) {
        if (block.multiple !== true) continue;
        // A column absent from this write is untouched, and `null` clears it —
        // neither is a list this check has anything to say about.
        if (!(column in input.values)) continue;
        const value = input.values[column];
        if (value === null || value === undefined || value === '') continue;

        if (typeof value !== 'string' || !value.trim().startsWith('[')) {
          return { column, reason: 'not-a-list' };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(value.trim());
        } catch {
          return { column, reason: 'not-a-list' };
        }
        if (!Array.isArray(parsed)) return { column, reason: 'not-a-list' };

        if (block.maxCount !== undefined && parsed.length > block.maxCount) {
          return { column, reason: 'too-many', maxCount: block.maxCount, count: parsed.length };
        }
      }
      return null;
    },

    async trashForRecord(input) {
      const trashed: string[] = [];
      try {
        const ids = new Set<string>();
        // Sidecar attachments — found by the denormalized keys.
        for (const file of await filesForRecord(input)) ids.add(file.id);
        // Column-bound files — found by reading the values that are about to
        // disappear. A value that is not ours is skipped, as always.
        const { byColumn } = await deps.blocks.forTable(input.connectionId, input.table);
        for (const column of byColumn.keys()) {
          for (const file of await filesFor(input.row[column])) {
            if (file.deletedAt === null) ids.add(file.id);
          }
        }
        const at = now();
        for (const id of ids) {
          if (await files.markDeleted(id, at)) trashed.push(id);
        }
      } catch (error) {
        // Same rule as `reconcile`: the customer's row is already deleted.
        deps.logger?.warn(
          { err: error, table: input.table, connectionId: input.connectionId },
          'could not trash a deleted record’s files',
        );
      }
      return trashed;
    },

    async reconcile(input) {
      const result: ReconcileResult = { attached: [], trashed: [] };
      try {
        const { byColumn } = await deps.blocks.forTable(input.connectionId, input.table);
        if (byColumn.size === 0) return result;

        for (const column of byColumn.keys()) {
          const beforeValue = input.before?.[column];
          const afterValue = input.after?.[column];
          // Identical values need no lookup at all — the common case on every
          // update that did not touch the file column.
          if (beforeValue === afterValue) continue;

          const [previous, next] = await Promise.all([filesFor(beforeValue), filesFor(afterValue)]);

          /*
           * A SET DIFFERENCE, not a pairwise compare.
           *
           * With one file per column the two were single values and `previous
           * !== next` said everything. With a list, the same file can move
           * position, and a second file can be added while the first stays —
           * so the questions are "which ids are in `next`" (attach them) and
           * "which ids were in `previous` and are not in `next` any more"
           * (trash those). Comparing element by element would trash a file
           * that merely moved.
           */
          const nextIds = new Set(next.map((file) => file.id));
          for (const file of next) {
            if (file.attachedAt === null || file.entityId !== input.entity.label) {
              await files.attach(file.id, input.entity, now());
              result.attached.push(file.id);
            }
          }
          // Removed or replaced: a file the column USED to name and no longer
          // does. Trash, never delete (D12) — the undo window and the
          // retention sweep own the bytes.
          for (const file of previous) {
            if (nextIds.has(file.id)) continue;
            await files.markDeleted(file.id, now());
            result.trashed.push(file.id);
          }
        }
      } catch (error) {
        // See the header: the customer's row is already committed.
        deps.logger?.warn(
          { err: error, table: input.table, connectionId: input.connectionId },
          'could not reconcile file references after a record write',
        );
      }
      return result;
    },

    async restoreAll(fileIds) {
      for (const id of fileIds) {
        try {
          await files.restore(id);
        } catch (error) {
          deps.logger?.warn({ err: error, fileId: id }, 'could not restore a file during undo');
        }
      }
    },
  };
}
