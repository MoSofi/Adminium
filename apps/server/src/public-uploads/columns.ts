// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A GUEST'S FILE INTO AN APP'S FILE COLUMN: what the upload store
 * (`store.ts`) is to a public write.
 *
 * A guest uploads a file for one column of one table (`POST
 * /public/uploads`, `routes/public/uploads.ts`): it is taken for exactly that
 * column (the binding `column` + `<connection>/<table id>/<column>`, no
 * address), kept unattached for a day, and its id handed back. The guest's
 * next public write through an entry that lets them upload there names the id
 * in the column — a create (with its child rows: an order line's artwork) or
 * a change of a row they are signed in to. The write then:
 *
 *  1. HOLDS the uploads it names ({@link ColumnUploads.hold}), in the meta
 *     store, before its own transaction: each must be an open upload of that
 *     very column, of a kind and a size its upload rule takes, no more of
 *     them than the rule lets one write name — or the write is refused before
 *     anything is written. A held upload names the row it is for
 *     (connection, table, key: unknown yet on a create) and is out of the
 *     sweep. The ids are written into the row as the files they are.
 *  2. Commits, in the owner's database. The column's judge
 *     (`files/column-judge.ts`) takes a held file there and nowhere else.
 *  3. ADOPTS them ({@link HeldUploads.adopt}): each file becomes an ordinary
 *     upload (kind `upload`, uploaded by nobody) attached to the row exactly
 *     as `files/reconcile.ts` attaches one — so the staff files routes, the
 *     guest's own read (`GET /public/files`), the bin when the row lets go of
 *     it and an erasure all treat it as any other file of the row — and its
 *     upload row is closed.
 * A write that does not stand releases its holds ({@link HeldUploads.release}):
 * the files wait again, until their own day is up.
 *
 * THE TWO DATABASES SHARE NO TRANSACTION, so a process that stops between the
 * commit and the adoption leaves a hold behind. The recovery pass
 * ({@link ColumnUploads.recover}, run with the stranger sweep) takes every
 * hold older than fifteen minutes: when the row it was for names the file, it
 * adopts it there; when no row does (the write never committed), it lets the
 * hold go, to expire as any waiting file does.
 */
import { filesRepo, publicUploadsRepo, type MetaDb, type PublicUpload, type RecordRef } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { pkLabel } from '../crud/records.js';
import { fileIdsIn, namedIn } from '../files/column-values.js';
import { COLUMN_UPLOAD_KIND, COLUMN_UPLOAD_TTL_MS, PUBLIC_UPLOAD_KINDS, type PublicUploadKind } from './store.js';

/** How old a hold is before the recovery pass asks whether its write committed. */
export const HOLD_RECOVER_MS = 15 * 60_000;

/** What an upload id looks like: 24 random bytes, url-safe. A file id (`file_…`) never does. */
const UPLOAD_ID = /^[A-Za-z0-9_-]{32}$/;

/** The key a guest's file for a column is taken under: the connection, the table's id, the column. */
export function columnUploadKey(connectionId: string, tableId: string, column: string): string {
  return `${connectionId}/${tableId}/${column}`;
}

/** Whether a value is an upload's id (and not a file's). */
export function isUploadId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ID.test(value);
}

/** The sniffed kinds a column's upload rule takes, by the store's words. */
export function uploadKindsOf(kinds: readonly string[]): PublicUploadKind[] {
  return kinds.filter((kind): kind is PublicUploadKind => Object.prototype.hasOwnProperty.call(PUBLIC_UPLOAD_KINDS, kind));
}

/** One row of a write, as the hold reads it. */
export interface UploadRow {
  table: ResolvedTable;
  /** The columns this level of the entry lets a guest upload into. */
  uploads: ReadonlySet<string>;
  /** The row's values: an upload id named in one of those columns is replaced by its file's id. */
  values: Row;
  /** The row's key as a record's address spells it, when the write knows it (a change); null on a create. */
  key?: string | null | undefined;
  /** Where the row is in the write (`['order_lines', 2]`), for the refusal; empty for the root. */
  at?: readonly (string | number)[] | undefined;
}

/** Why a write's upload was refused, on the column that named it. */
export interface UploadRefused {
  column: string;
  reason: 'file-not-here' | 'file-type' | 'file-too-large' | 'too-many-files';
  at: readonly (string | number)[];
}

export interface HeldUploads {
  /** The files held, by id, with the table and column each was taken for: the write context's `held`. */
  files: ReadonlyMap<string, { table: string; column: string }>;
  /** Whether the write named any upload at all. */
  readonly any: boolean;
  /** The write did not stand: every hold let go, the files waiting again until their day is up. Never throws. */
  release(): Promise<void>;
  /**
   * The write committed: each held file that one of `rows` names in its
   * column becomes that row's own; one no row names is let go. Never throws.
   */
  adopt(rows: readonly { table: ResolvedTable; record: Row }[]): Promise<void>;
}

export interface ColumnUploadsDeps {
  meta: MetaDb;
  /** The owner's database, for the recovery pass's read of a row. */
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: string }>;
  /** The schema view of a connection, for the recovery pass. */
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined;
  now?: () => number;
}

/** A file's record: its table, its key, and the label the files store keeps. */
function recordOf(connectionId: string, table: ResolvedTable, record: Row): RecordRef {
  const pk = Object.fromEntries(table.primaryKey.map((column) => [column, record[column]]));
  return { connectionId, table: table.id, pk, label: pkLabel(table, pk) };
}

/** The holds a nothing-held write answers. */
const NOTHING_HELD: HeldUploads = { files: new Map(), any: false, release: async () => undefined, adopt: async () => undefined };

export function createColumnUploads(deps: ColumnUploadsDeps) {
  const now = deps.now ?? Date.now;
  const repo = publicUploadsRepo(deps.meta);
  const files = filesRepo(deps.meta);
  const warn = (fields: Record<string, unknown>, message: string) => deps.log?.warn(fields, message);

  /** Let these holds go, each to its own expiry: a day after it was taken. */
  async function letGo(uploads: readonly PublicUpload[]): Promise<void> {
    if (uploads.length === 0) return;
    try {
      await repo.release(
        uploads.map((upload) => ({ id: upload.id, expiresAt: upload.createdAt + COLUMN_UPLOAD_TTL_MS })),
        COLUMN_UPLOAD_KIND,
      );
    } catch (error) {
      warn({ err: error, uploads: uploads.map((upload) => upload.id) }, 'public uploads: a hold could not be let go');
    }
  }

  /** One held file becomes the row's own: kind, then attachment, then the upload row closed. True when it is the row's. */
  async function adoptOne(upload: PublicUpload, record: RecordRef): Promise<boolean> {
    if (upload.fileId === null) return false;
    const at = now();
    // Bytes stay where they are: the file row changes kind, then is attached as the reconciler attaches a staff upload.
    await files.adoptStranger(upload.fileId);
    const attached = await files.attach(upload.fileId, record, at);
    if (attached === null || attached.kind !== 'upload') return false;
    await repo.adopt(upload.id, COLUMN_UPLOAD_KIND, { connectionId: record.connectionId, table: record.table, key: record.label }, at);
    return true;
  }

  return {
    /**
     * Hold the uploads a public write names. Each row's columns that the
     * entry lets a guest upload into are read; an upload id there is looked
     * up, judged and held, and replaced in the values by its file's id. A
     * write that names no upload holds nothing. A refusal holds nothing
     * either (what was held is let go first). A quote (`peek`) is judged the
     * same and holds nothing: the page asks one while the guest still types,
     * and must never keep the save it comes before from its own files.
     */
    async hold(connectionId: string, rows: readonly UploadRow[], opts: { peek?: boolean } = {}): Promise<{ ok: true; held: HeldUploads } | { ok: false; refused: UploadRefused }> {
      // Every upload id named, by row and column, before anything is read.
      const named: { row: UploadRow; column: string; ids: string[] }[] = [];
      for (const row of rows) {
        for (const column of row.uploads) {
          if (!Object.prototype.hasOwnProperty.call(row.values, column)) continue;
          const sent = namedIn(row.values[column]);
          const ids = (sent ?? []).filter(isUploadId);
          if (ids.length > 0) named.push({ row, column, ids });
        }
      }
      if (named.length === 0) return { ok: true, held: NOTHING_HELD };
      const refuse = (one: (typeof named)[number], reason: UploadRefused['reason']) => ({ ok: false as const, refused: { column: one.column, reason, at: one.row.at ?? [] } });

      const at = now();
      const found = new Map((await repo.findMany(named.flatMap((one) => one.ids))).map((upload) => [upload.id, upload]));
      const all = named.flatMap((one) => one.ids);
      if (new Set(all).size !== all.length) return refuse(named[0]!, 'file-not-here');
      for (const one of named) {
        const column = one.row.table.columns.get(one.column);
        const rule = column?.file?.upload;
        if (column === undefined || rule === undefined) return refuse(one, 'file-not-here');
        // How many one write may name: the rule's own count, one in a column of one file.
        if (one.ids.length > (rule.maxCount ?? 1)) return refuse(one, 'too-many-files');
        const key = columnUploadKey(connectionId, one.row.table.id, one.column);
        for (const id of one.ids) {
          const upload = found.get(id);
          // Taken for this very column, still waiting, still within its day: whose and whether is said alike.
          if (upload === undefined || upload.binding.kind !== COLUMN_UPLOAD_KIND || upload.binding.key !== key || upload.attachedAt !== null || upload.removedAt !== null || upload.fileId === null || (upload.expiresAt ?? 0) <= at) {
            return refuse(one, 'file-not-here');
          }
          if (!rule.kinds.includes(upload.kind)) return refuse(one, 'file-type');
          if (upload.size > Math.min(rule.maxBytes, column.file!.maxBytes)) return refuse(one, 'file-too-large');
        }
      }

      // Held column by column, all or nothing: a write that loses one race lets go of the rest.
      const held: PublicUpload[] = [];
      for (const one of opts.peek === true ? [] : named) {
        const key = columnUploadKey(connectionId, one.row.table.id, one.column);
        const owner = { connectionId, table: one.row.table.id, key: one.row.key ?? '' };
        if (!(await repo.hold(one.ids, { kind: COLUMN_UPLOAD_KIND, key }, owner, at))) {
          await letGo(held);
          return refuse(one, 'file-not-here');
        }
        held.push(...one.ids.map((id) => found.get(id)!));
      }

      // The row names the files the uploads became, in the shape the guest sent: one id, or a list.
      const byFile = new Map<string, { table: string; column: string }>();
      for (const one of named) {
        const swap = (value: string) => (isUploadId(value) ? (found.get(value)?.fileId ?? value) : value);
        const sent = one.row.values[one.column];
        if (Array.isArray(sent)) one.row.values[one.column] = sent.map((value) => (typeof value === 'string' ? swap(value) : value));
        else if (typeof sent === 'string' && sent.trim().startsWith('[')) one.row.values[one.column] = JSON.stringify((namedIn(sent) ?? []).map(swap));
        else if (typeof sent === 'string') one.row.values[one.column] = swap(sent.trim());
        for (const id of one.ids) byFile.set(found.get(id)!.fileId!, { table: one.row.table.id, column: one.column });
      }
      const uploadsByFile = new Map(held.map((upload) => [upload.fileId!, upload]));
      if (opts.peek === true) return { ok: true, held: { ...NOTHING_HELD, files: byFile, any: true } };

      return {
        ok: true,
        held: {
          files: byFile,
          any: true,
          release: () => letGo(held),
          async adopt(written) {
            const unclaimed: PublicUpload[] = [];
            for (const [fileId, target] of byFile) {
              const upload = uploadsByFile.get(fileId)!;
              const row = written.find((one) => one.table.id === target.table && fileIdsIn(one.record[target.column]).includes(fileId));
              if (row === undefined) {
                unclaimed.push(upload);
                continue;
              }
              try {
                if (!(await adoptOne(upload, recordOf(connectionId, row.table, row.record)))) warn({ upload: upload.id }, 'public uploads: a held file could not be made its row’s');
              } catch (error) {
                // Left held: the recovery pass finds the row that names it and adopts it there.
                warn({ err: error, upload: upload.id }, 'public uploads: a held file could not be made its row’s yet');
              }
            }
            // A file the row did not keep (a hook took it out): waiting again, as if never named.
            await letGo(unclaimed);
          },
        },
      };
    },

    /**
     * Holds left behind by a write that stopped between its commit and its
     * adoption, older than fifteen minutes: adopted where the row they were
     * for names them, let go to their expiry where no row does. Answers how
     * many went each way.
     */
    async recover(): Promise<{ adopted: number; released: number }> {
      const out = { adopted: 0, released: 0 };
      const due = await repo.heldBefore(COLUMN_UPLOAD_KIND, now() - HOLD_RECOVER_MS, 100);
      for (const upload of due) {
        try {
          if (upload.owner === null || upload.fileId === null) {
            await letGo([upload]);
            out.released += 1;
            continue;
          }
          const file = await files.findById(upload.fileId);
          if (file === null || file.deletedAt !== null) {
            await letGo([upload]);
            out.released += 1;
            continue;
          }
          const column = upload.binding.key.slice(upload.binding.key.lastIndexOf('/') + 1);
          const view = await deps.viewFor(upload.owner.connectionId);
          let table: ResolvedTable | null = null;
          try {
            table = view?.table(upload.owner.table) ?? null;
          } catch {
            table = null;
          }
          const rule = table?.columns.get(column)?.file;
          if (table === null || rule === undefined) {
            await letGo([upload]);
            out.released += 1;
            continue;
          }
          // The row that names the file: by its key when the write knew it, else by the file id in the column.
          const { db, dialect } = await deps.data(upload.owner.connectionId);
          const ref = db.dynamic.ref(column);
          const asText = dialect === 'mysql' ? sql`cast(${ref} as char)` : sql`cast(${ref} as text)`;
          const rows = (await db
            .selectFrom(table.id)
            .selectAll()
            .where(rule.maxCount === undefined ? sql<boolean>`${ref} = ${upload.fileId}` : sql<boolean>`${asText} like ${`%"${upload.fileId}"%`}`)
            .limit(2)
            .execute()) as Row[];
          const mine = rows.filter((record) => fileIdsIn(record[column]).includes(upload.fileId!));
          if (mine.length === 1 && (await adoptOne(upload, recordOf(upload.owner.connectionId, table, mine[0]!)))) {
            out.adopted += 1;
            continue;
          }
          await letGo([upload]);
          out.released += 1;
        } catch (error) {
          // Asked again on the next pass.
          warn({ err: error, upload: upload.id }, 'public uploads: a hold could not be recovered');
        }
      }
      return out;
    },
  };
}

export type ColumnUploads = ReturnType<typeof createColumnUploads>;
