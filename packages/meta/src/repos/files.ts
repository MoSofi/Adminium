// SPDX-License-Identifier: AGPL-3.0-only
/**
 * filesRepo — adminium_files (07-meta-store.md §3.27): one row per stored
 * artifact (export bundles, import uploads, error reports, branding assets…).
 *
 * The repo owns ROWS only — bytes live wherever `destination_id`/`storage_key`
 * say: `destination_id IS NULL` is this server's disk under
 * `<dataDir>/files/<id>` (apps/server/src/files/drivers/local.ts), any other
 * value is a configured destination (37-files-and-storage.md D3).
 * Deletion is soft (`deleted_at`) so a GC pass can remove bytes first and rows
 * second without ever leaving a row that points at nothing.
 *
 * Wave 0024 adds the record linkage the `entity` column was declared for in
 * 0003 and nothing ever wrote (37 §0.1 item 4). The lookup keys are
 * denormalized into real columns — `entity_connection_id`, `entity_table`,
 * `entity_id` — for the same reason 0016 did it to the audit log: filtering on
 * packed JSON is either a per-dialect JSON-extract expression or a full scan.
 * The json column keeps the full ref (the PK map, the label at write time);
 * the three columns are how it is FOUND.
 */

import { sql, type Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  auditEntityKeyPart,
  fileKindSchema,
  recordRefSchema,
  type RecordRef,
} from '../schema/json-payloads.js';
import type { AdminiumFilesTable } from '../schema/tables.js';
import { affected, packJson, readJsonOrNull } from './util.js';

export type FileKind = 'upload' | 'export' | 'import' | 'branding' | 'schema' | 'archive';

export interface StoredFile {
  id: string;
  /** The driver that wrote the bytes; informational, `destinationId` is the authority. */
  storage: string;
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  kind: FileKind;
  entity: RecordRef | null;
  uploadedBy: string | null;
  createdAt: number;
  deletedAt: number | null;
  /** NULL = this server's disk, the implicit destination (37 D3). */
  destinationId: string | null;
  /** NULL = no record claims this upload yet; the sweep collects it (37 D12). */
  attachedAt: number | null;
  entityConnectionId: string | null;
  entityTable: string | null;
  entityId: string | null;
}

export interface CreateFileInput {
  /** Storage backend key; defaults to the row id (local layout). */
  storageKey?: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  kind: FileKind;
  entity?: RecordRef | null;
  /**
   * The connection a file belongs to when it belongs to NO record
   * (38-files-library-and-attachments.md D4) — the Files page's own upload.
   *
   * Ignored when `entity` is given, which carries a connection of its own.
   * Everything else about such a row is a normal upload; what makes it a
   * library file rather than an abandoned one is `attachedAt`, which the
   * caller stamps (see below).
   */
  entityConnectionId?: string | null;
  uploadedBy?: string | null;
  /** Pre-minted id (lets the storage layer write bytes under the final id first). */
  id?: string;
  /** The driver name that wrote the bytes; informational (defaults to `local`). */
  storage?: string;
  /** NULL/omitted = this server's disk (37 D3). */
  destinationId?: string | null;
  /**
   * Attach at creation — the upload that already names its record. Omitted
   * leaves the row unattached, which is the create-form flow: the record does
   * not exist yet and `attach()` runs when the CRUD write lands.
   *
   * READ THIS AS "CLAIMED", NOT "HAS A RECORD" (38 D4). A library upload has no
   * record and still stamps it, because the alternative is being collected by
   * `listUnattachedBefore` a day later — the sweep's question is "did anything
   * ever claim this?", and for a library file the answer is the workspace.
   */
  attachedAt?: number | null;
}

/** The three denormalized lookup keys a sidecar attachment is found by. */
export interface FileEntityKeys {
  connectionId: string;
  /** Qualified source name, e.g. `public.invoices`. */
  table: string;
  /** Canonical record-id string — `pkLabel` form, the same one the record route uses. */
  recordId: string;
}

function decode(row: Selectable<AdminiumFilesTable>): StoredFile {
  return {
    id: row.id,
    storage: row.storage,
    storageKey: row.storageKey,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    kind: fileKindSchema.parse(row.kind),
    entity: readJsonOrNull<RecordRef>(row.entity),
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    destinationId: row.destinationId,
    attachedAt: row.attachedAt,
    entityConnectionId: row.entityConnectionId,
    entityTable: row.entityTable,
    entityId: row.entityId,
  };
}

/**
 * Clamp the two wide keys exactly as the audit log does, on the WRITE side and
 * again on the QUERY side, so an over-long qualified name still matches the row
 * it wrote. One-sided truncation is the bug this shape exists to prevent.
 */
function entityColumns(entity: FileEntityKeys | null | undefined): {
  entityConnectionId: string | null;
  entityTable: string | null;
  entityId: string | null;
} {
  if (entity === null || entity === undefined) {
    return { entityConnectionId: null, entityTable: null, entityId: null };
  }
  return {
    entityConnectionId: entity.connectionId,
    entityTable: auditEntityKeyPart(entity.table),
    entityId: auditEntityKeyPart(entity.recordId),
  };
}

export function filesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<StoredFile | null> {
    const row = await db.selectFrom('adminium_files').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    async create(input: CreateFileInput, at: number = Date.now()): Promise<StoredFile> {
      const id = input.id ?? newId('file');
      const entity = input.entity == null ? null : recordRefSchema.parse(input.entity);
      const row = {
        id,
        storage: input.storage ?? 'local',
        storageKey: input.storageKey ?? id,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        kind: fileKindSchema.parse(input.kind),
        entity: entity === null ? null : packJson(entity),
        uploadedBy: input.uploadedBy ?? null,
        createdAt: at,
        deletedAt: null,
        destinationId: input.destinationId ?? null,
        attachedAt: input.attachedAt ?? null,
        ...entityColumns(
          entity === null
            ? null
            : { connectionId: entity.connectionId, table: entity.table, recordId: entity.label },
        ),
        // A file with a connection and no record (38 D4). Written AFTER the
        // spread so it cannot overwrite a real entity's connection — the two
        // are mutually exclusive, and `entity` is the stronger claim.
        ...(entity === null && input.entityConnectionId != null
          ? { entityConnectionId: input.entityConnectionId }
          : {}),
      };
      await db.insertInto('adminium_files').values(row).execute();
      return decode(row as Selectable<AdminiumFilesTable>);
    },

    /** Soft delete — bytes are removed by the storage GC, rows stay addressable. */
    async markDeleted(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_files')
        .set({ deletedAt: at })
        .where('id', '=', id)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Rows already soft-deleted before `cutoff` — the storage GC's worklist. */
    async listDeletedBefore(cutoff: number, limit = 100): Promise<StoredFile[]> {
      const rows = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('deletedAt', 'is not', null)
        .where('deletedAt', '<', cutoff)
        .orderBy('deletedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /** Hard-delete a row (call only after the bytes are gone). */
    async purge(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_files').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    // ── wave 0024 (37-files-and-storage.md §3.5, D6, D12, D20) ──────────────

    /**
     * Bind a file to a record. Writes BOTH forms — the full `RecordRef` json
     * (which carries the PK map and the label as of write time) and the three
     * denormalized lookup columns — because they answer different questions:
     * the json is what a UI renders, the columns are what a query finds.
     *
     * Idempotent on `attached_at`: re-attaching an already-attached file to the
     * same record keeps the original timestamp, so "when did this become the
     * invoice's PDF" survives a re-save of the record.
     */
    async attach(id: string, entity: RecordRef, at: number = Date.now()): Promise<StoredFile | null> {
      const ref = recordRefSchema.parse(entity);
      const current = await findById(id);
      if (current === null) return null;
      const sameRecord =
        current.entityConnectionId === ref.connectionId &&
        current.entityTable === auditEntityKeyPart(ref.table) &&
        current.entityId === auditEntityKeyPart(ref.label);
      await db
        .updateTable('adminium_files')
        .set({
          entity: packJson(ref),
          attachedAt: sameRecord && current.attachedAt !== null ? current.attachedAt : at,
          ...entityColumns({ connectionId: ref.connectionId, table: ref.table, recordId: ref.label }),
        })
        .where('id', '=', id)
        .execute();
      return findById(id);
    },

    /**
     * Unbind without deleting. The file becomes an unattached upload again —
     * which means the sweep's first half will collect it once it is older than
     * `files.unattachedHours`, exactly as if it had just been uploaded and
     * never used. That is deliberate: a detached file nobody re-attaches is
     * litter, and the alternative is a third state to reason about.
     */
    async detach(id: string): Promise<StoredFile | null> {
      await db
        .updateTable('adminium_files')
        .set({ entity: null, attachedAt: null, ...entityColumns(null) })
        .where('id', '=', id)
        .execute();
      return findById(id);
    },

    /** Every live file attached to one record — the Attachments panel's query. */
    async listByEntity(entity: FileEntityKeys, limit = 200): Promise<StoredFile[]> {
      const keys = entityColumns(entity);
      const rows = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('entityConnectionId', '=', keys.entityConnectionId)
        .where('entityTable', '=', keys.entityTable)
        .where('entityId', '=', keys.entityId)
        .where('deletedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /**
     * Uploads no record ever claimed, older than `cutoff` — the sweep's first
     * half (D12). Scoped to `kind = 'upload'` because every other kind is a
     * system artifact with its own lifecycle: an export is attached to nothing
     * by design and its retention is the exports sweep's business.
     */
    async listUnattachedBefore(cutoff: number, limit = 100): Promise<StoredFile[]> {
      const rows = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('kind', '=', 'upload')
        .where('attachedAt', 'is', null)
        .where('deletedAt', 'is', null)
        .where('createdAt', '<', cutoff)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /**
     * One page of a destination's files, id-keyset ordered so the migrate job
     * resumes from where it was killed (D20). `destinationId === null` reads
     * the implicit local destination, which is how "move everything off this
     * server's disk" is expressed.
     */
    async listByDestination(
      destinationId: string | null,
      // `| undefined` on each: under `exactOptionalPropertyTypes` a paging
      // caller naturally holds `lastRow?.id`, and forcing it to branch on the
      // first page buys nothing.
      opts: { after?: string | undefined; limit?: number | undefined; kinds?: readonly FileKind[] | undefined } = {},
    ): Promise<StoredFile[]> {
      let q = db.selectFrom('adminium_files').selectAll();
      q = destinationId === null ? q.where('destinationId', 'is', null) : q.where('destinationId', '=', destinationId);
      if (opts.after !== undefined) q = q.where('id', '>', opts.after);
      if (opts.kinds !== undefined && opts.kinds.length > 0) q = q.where('kind', 'in', [...opts.kinds]);
      const rows = await q
        .where('deletedAt', 'is', null)
        .orderBy('id', 'asc')
        .limit(opts.limit ?? 100)
        .execute();
      return rows.map(decode);
    },

    /**
     * Point a row at its new home — ONE update carrying both the destination
     * and the key, because a row that has been given the new destination but
     * still carries the old key names bytes that are not there. The migrate job
     * runs this only after the copy has landed and its sha256 has been verified.
     */
    async flipDestination(
      id: string,
      to: { destinationId: string | null; storageKey: string; storage: string },
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_files')
        .set({ destinationId: to.destinationId, storageKey: to.storageKey, storage: to.storage })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Restore a trashed row — the Undo affordance; no token machinery (D12). */
    async restore(id: string): Promise<StoredFile | null> {
      await db
        .updateTable('adminium_files')
        .set({ deletedAt: null })
        .where('id', '=', id)
        .where('deletedAt', 'is not', null)
        .execute();
      return findById(id);
    },

    /** Rename the DISPLAY name only — the storage key is never touched (37 §3.4). */
    async rename(id: string, filename: string): Promise<StoredFile | null> {
      await db.updateTable('adminium_files').set({ filename }).where('id', '=', id).execute();
      return findById(id);
    },

    /**
     * Resolve a `key`-shaped reference. Scoped to LIVE rows because a trashed
     * file's key may legitimately be reused by a later upload to the same
     * destination, and answering with the dead one would hand back bytes that
     * are scheduled for deletion.
     */
    /**
     * A LIVE row holding these exact bytes, if any — the import path's dedupe
     * (39-email-templates-and-campaigns.md D14): a bundle re-imported twice
     * must not leave two copies of every attachment in the library.
     */
    async findBySha256(sha256: string): Promise<StoredFile | null> {
      const row = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('sha256', '=', sha256)
        .where('deletedAt', 'is', null)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row ? decode(row) : null;
    },

    async findByStorageKey(storageKey: string): Promise<StoredFile | null> {
      const row = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('storageKey', '=', storageKey)
        .where('deletedAt', 'is', null)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * The Files page and the record panel's one query (37 Appendix C).
     *
     * `state` is the closed vocabulary the UI's preset rail offers rather than
     * three independent booleans: `live`, `trash` and `unattached` are mutually
     * exclusive views of the same rows, and expressing them as flags would let
     * a caller ask for "trashed AND unattached", which is a question with two
     * defensible answers and therefore no answer.
     *
     * Keyset paging on `id`, which is a ULID and therefore already creation
     * ordered — the same convention every other list in this store uses.
     */
    async search(input: {
      state?: 'live' | 'trash' | 'unattached';
      kinds?: readonly FileKind[];
      q?: string;
      kind?: FileKind;
      entityConnectionId?: string;
      entityTable?: string;
      entityId?: string;
      destinationId?: string | null;
      mime?: string;
      uploadedBy?: string | undefined;
      /** Created at or after this epoch-ms instant — the Recent preset (38 D9). */
      since?: number;
      limit?: number;
      cursor?: string;
    }): Promise<{ rows: StoredFile[]; nextCursor: string | null }> {
      const limit = input.limit ?? 50;
      let q = db.selectFrom('adminium_files').selectAll();

      switch (input.state ?? 'live') {
        case 'trash':
          q = q.where('deletedAt', 'is not', null);
          break;
        case 'unattached':
          q = q.where('deletedAt', 'is', null).where('attachedAt', 'is', null);
          break;
        default:
          q = q.where('deletedAt', 'is', null);
      }
      if (input.kinds !== undefined && input.kinds.length > 0) q = q.where('kind', 'in', [...input.kinds]);
      if (input.kind !== undefined) q = q.where('kind', '=', input.kind);
      if (input.q !== undefined && input.q !== '') {
        // A LIKE on the display name. Deliberately not a full-text index: the
        // corpus is filenames, and every dialect spells FTS differently.
        //
        // The ESCAPE clause is NOT optional and is why this is raw SQL.
        // PostgreSQL and MySQL treat backslash as the default LIKE escape;
        // SQLite has NO default, so `\%` there matches a literal backslash and
        // a search for `50%.pdf` would silently return every file. Naming the
        // escape character explicitly is the one spelling all three agree on.
        const escaped = input.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
        q = q.where(sql<boolean>`${sql.ref('filename')} like ${`%${escaped}%`} escape '\\'`);
      }
      if (input.entityConnectionId !== undefined) q = q.where('entityConnectionId', '=', input.entityConnectionId);
      if (input.entityTable !== undefined) q = q.where('entityTable', '=', auditEntityKeyPart(input.entityTable));
      if (input.entityId !== undefined) q = q.where('entityId', '=', auditEntityKeyPart(input.entityId));
      if (input.destinationId !== undefined) {
        q =
          input.destinationId === null
            ? q.where('destinationId', 'is', null)
            : q.where('destinationId', '=', input.destinationId);
      }
      if (input.mime !== undefined) q = q.where('mime', '=', input.mime);
      if (input.uploadedBy !== undefined) q = q.where('uploadedBy', '=', input.uploadedBy);
      if (input.since !== undefined) q = q.where('createdAt', '>=', input.since);
      if (input.cursor !== undefined && input.cursor !== '') q = q.where('id', '<', input.cursor);

      // One more than asked, so "is there another page" needs no count.
      const rows = await q.orderBy('id', 'desc').limit(limit + 1).execute();
      const page = rows.slice(0, limit).map(decode);
      return { rows: page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
    },

    /**
     * Bytes and row count per destination, for the usage strip (D23).
     * `destinationId` is nullable in the result and NULL means this server's
     * disk. Counts LIVE rows only: trashed bytes are still on the disk but they
     * are not what the operator is being asked to reason about.
     */
    async usageByDestination(): Promise<{ destinationId: string | null; files: number; bytes: number }[]> {
      const rows = await db
        .selectFrom('adminium_files')
        .select((eb) => [
          'destinationId',
          eb.fn.countAll<number | string | bigint>().as('files'),
          eb.fn.sum<number | string | bigint | null>('sizeBytes').as('bytes'),
        ])
        .where('deletedAt', 'is', null)
        .groupBy('destinationId')
        .execute();
      return rows.map((row) => ({
        destinationId: row.destinationId,
        files: Number(row.files),
        bytes: Number(row.bytes ?? 0),
      }));
    },
  };
}

export type FilesRepo = ReturnType<typeof filesRepo>;
