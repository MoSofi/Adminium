// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH FILES A WRITE MAY NAME in a column that holds files (`column.file`).
 *
 * A file column holds Adminium's own file ids, and a file is read with the
 * record that holds it: whoever reads the record reads the file, and when the
 * record lets go of it (the column changed, the row removed) the file goes to
 * the bin. So naming a file in a record is handing it to that record. Left to
 * itself, any id a writer could read would do: a crew member who reads job
 * A's sign-off names its signature on job B, and job A's signature is then
 * B's to lose.
 *
 * So a write may name, beside what the row already held in that column:
 *
 *  - a file the WRITER uploaded — a signed-in person, through a person's own
 *    door (a save, a bulk edit, a record's button); a rule, an import, a
 *    public write and project code name none, and an app's sample data names
 *    only the pictures it added from its own bundle in the same pass, each
 *    row its own;
 *  - that no record holds yet, or that was uploaded for this very record
 *    and is in none of its other file columns;
 *  - of this database, alive, of a kind the column takes, no larger than it
 *    allows;
 *  - and, a picture, one whose camera notes were taken out as it was
 *    uploaded for a file column: its bytes, cleaned again, are the same
 *    bytes (`public-api/picture.ts`). A picture sent through another door
 *    keeps the place it was taken, and is refused here.
 *
 * Each refusal is the field's own issue. Whose a file is, whether it exists,
 * and which record holds it are said alike (`file-not-here`): a refusal is
 * no way to learn of somebody else's file. An undo puts back what was, and
 * is not judged.
 *
 * A PAGE's file column (a `file` block, in a column the app knows as plain
 * text) is judged too, through a person's door: the value it newly names, in
 * whichever shape the block stores (an id, a key, a link), may be only an
 * upload the writer made that no record holds yet, or one made for this very
 * record. A file chosen from another record or the Files page is copied for
 * the writer first (`POST /files/:id/copy`), so it is such an upload. What
 * else such a column takes is its own business: a link to another site, or
 * text that names no file of ours, is left as it is. Every other door keeps
 * what it had: the record that names a file somebody else holds never takes
 * it (`files/reconcile.ts`).
 */
import { createHash } from 'node:crypto';

import { filesRepo, isId, type MetaDb, type StoredFile } from '@adminium/meta';

import type { FieldIssues } from '../crud/column-rules.js';
import type { ResolvedColumn, ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { pkLabel } from '../crud/records.js';
import type { WriteActor, WriteOrigin } from '../crud/write-context.js';
import { cleanPicture, isPictureMime, PictureRefused, readCapped } from '../public-api/picture.js';
import { fileIdsIn, namedIn } from './column-values.js';
import { parseRefList, type RefDestination } from './refs.js';
import { mimesForKeys, SNIFF_TYPE_KEYS, type SniffTypeKey } from './sniff.js';
import type { FileStore } from './store.js';

/** The doors through which a signed-in person names a file they uploaded. */
const PERSON_ORIGINS: ReadonlySet<WriteOrigin> = new Set(['dashboard', 'bulk', 'action']);

/** A stored file's bytes, read up to `max`; undefined when they cannot be read. */
export type FileBytes = (file: StoredFile, max: number) => Promise<Buffer | undefined>;

export interface FileColumnJudgeDeps {
  /** Where the files are kept. Without it no file can be found, and a write names no new one. */
  meta?: MetaDb | undefined;
  /**
   * Reads a file's bytes, for the check that a picture was cleaned. Without
   * it no picture can be shown to be clean, and a new one is refused: a
   * service built without the store is one no person writes through.
   */
  bytesOf?: FileBytes | undefined;
  /**
   * A table's file columns that its pages make (`file` blocks), by name.
   * Without it a page's file column is not judged here.
   */
  pageColumns?: ((connectionId: string, table: string) => Promise<ReadonlySet<string>>) | undefined;
  /** The destinations whose public links name a file of ours, for reading a page column's value. */
  publicBases?: (() => Promise<readonly RefDestination[]>) | undefined;
}

export interface FileColumnWrite {
  connectionId: string;
  table: ResolvedTable;
  origin: WriteOrigin;
  actor: WriteActor | null;
  values: Row;
  /** The row as it is (an update), or null (a create). */
  stored: Row | null;
  /** The files the write itself made for its rows (`WriteContext.minted`): an import names these and no other. */
  minted?: ReadonlySet<string> | undefined;
}

export interface FileColumnJudge {
  /** The file columns' issues in this write, or null when there is none. */
  judge(write: FileColumnWrite): Promise<FieldIssues | null>;
}

/** A file's bytes from the store it is kept in, read up to `max`: undefined past it, or when they are not there. */
export function storedBytes(storage: Pick<FileStore, 'open'>): FileBytes {
  return async (file, max) => {
    try {
      return await readCapped((await storage.open(file)).stream, max);
    } catch {
      return undefined;
    }
  };
}

/** The columns of a table that hold files, by name. */
export function fileColumnsOf(table: ResolvedTable): ResolvedColumn[] {
  return [...table.columns.values()].filter((column) => column.file !== undefined);
}

/** Whether a stored file is a clean picture: its bytes, cleaned again, are the bytes kept. */
async function cleanAsKept(file: StoredFile, bytesOf: FileBytes | undefined, max: number): Promise<boolean> {
  if (bytesOf === undefined) return false;
  const bytes = await bytesOf(file, max);
  if (bytes === undefined) return false;
  try {
    return createHash('sha256').update(cleanPicture(bytes, file.mime).bytes).digest('hex') === file.sha256;
  } catch (error) {
    if (error instanceof PictureRefused) return false;
    throw error;
  }
}

export function createFileColumnJudge(deps: FileColumnJudgeDeps): FileColumnJudge {
  const files = deps.meta === undefined ? null : filesRepo(deps.meta);

  return {
    async judge(write) {
      if (write.origin === 'undo') return null;
      const columns = fileColumnsOf(write.table).filter((column) => Object.prototype.hasOwnProperty.call(write.values, column.name));
      if (columns.length === 0 && (deps.pageColumns === undefined || !PERSON_ORIGINS.has(write.origin))) return null;
      let issues: FieldIssues | null = null;
      const refuse = (column: string, issue: FieldIssues[string]): void => {
        (issues ??= {})[column] ??= issue;
      };
      const person = write.actor?.kind === 'user' && write.actor.id !== null && PERSON_ORIGINS.has(write.origin) ? write.actor.id : null;
      // The record a file uploaded for it says it belongs to: its table, by either name, and its key as a record's address spells it.
      const label = write.stored === null || write.table.primaryKey.some((name) => write.stored![name] === undefined) ? null : pkLabel(write.table, Object.fromEntries(write.table.primaryKey.map((name) => [name, write.stored![name]])));
      const ofThisRecord = (file: StoredFile): boolean =>
        label !== null && file.entityConnectionId === write.connectionId && (file.entityTable === write.table.id || file.entityTable === write.table.name) && file.entityId === label;
      // A file named twice in the row (two columns, or twice in a list) would be two records' worth of one file.
      const seen = new Set<string>();
      // What the row holds now, column by column: a file another column of it holds is not this column's to take.
      const heldBy = new Map<string, Set<string>>();
      for (const column of fileColumnsOf(write.table)) heldBy.set(column.name, new Set(write.stored === null ? [] : fileIdsIn(write.stored[column.name])));

      for (const column of columns) {
        const rule = column.file!;
        const named = namedIn(write.values[column.name]);
        const list = rule.maxCount !== undefined;
        // Only Adminium's own ids, one for a text column and a list of them for a json one.
        const sent = write.values[column.name];
        const shaped = list ? Array.isArray(sent) || sent === null || sent === undefined || (typeof sent === 'string' && (sent.trim() === '' || sent.trim().startsWith('['))) : !Array.isArray(sent);
        if (named === null || !shaped || named.some((id) => !isId(id, 'file')) || (!list && named.length > 1)) {
          refuse(column.name, { code: 'file-not-here' });
          continue;
        }
        if (list && named.length > rule.maxCount!) {
          refuse(column.name, { code: 'too-many-files', n: rule.maxCount! });
          continue;
        }
        if (new Set(named).size !== named.length || named.some((id) => seen.has(id))) {
          refuse(column.name, { code: 'file-not-here' });
          continue;
        }
        for (const id of named) seen.add(id);
        const kept = heldBy.get(column.name) ?? new Set<string>();
        const fresh = named.filter((id) => !kept.has(id));
        if (fresh.length === 0) continue;
        // An app's sample: the files it made in this pass, of a kind and a size the column takes, and nothing else.
        // (A row after the first that names one is given a copy of its own as it is written.)
        if (write.origin === 'import' && write.minted !== undefined && files !== null) {
          const accept = new Set(mimesForKeys(rule.accept.filter((key): key is SniffTypeKey => (SNIFF_TYPE_KEYS as readonly string[]).includes(key))));
          for (const id of fresh) {
            const file = write.minted.has(id) ? await files.findById(id) : null;
            if (file === null || file.kind !== 'upload' || file.deletedAt !== null || file.entityConnectionId !== write.connectionId) {
              refuse(column.name, { code: 'file-not-here' });
              break;
            }
            if (!accept.has(file.mime)) {
              refuse(column.name, { code: 'file-type' });
              break;
            }
            if (file.sizeBytes > rule.maxBytes) {
              refuse(column.name, { code: 'file-too-large', n: rule.maxBytes });
              break;
            }
          }
          continue;
        }
        if (person === null || files === null) {
          refuse(column.name, { code: 'file-not-here' });
          continue;
        }
        const others = new Set([...heldBy.entries()].filter(([name]) => name !== column.name).flatMap(([, ids]) => [...ids]));
        const accept = new Set(mimesForKeys(rule.accept.filter((key): key is SniffTypeKey => (SNIFF_TYPE_KEYS as readonly string[]).includes(key))));
        for (const id of fresh) {
          const file = await files.findById(id);
          const free =
            file !== null &&
            file.kind === 'upload' &&
            file.deletedAt === null &&
            file.uploadedBy === person &&
            file.entityConnectionId === write.connectionId &&
            (file.attachedAt === null || (ofThisRecord(file) && !others.has(id)));
          if (!free) {
            refuse(column.name, { code: 'file-not-here' });
            break;
          }
          if (!accept.has(file.mime)) {
            refuse(column.name, { code: 'file-type' });
            break;
          }
          if (file.sizeBytes > rule.maxBytes) {
            refuse(column.name, { code: 'file-too-large', n: rule.maxBytes });
            break;
          }
          if (isPictureMime(file.mime) && !(await cleanAsKept(file, deps.bytesOf, rule.maxBytes))) {
            refuse(column.name, { code: 'file-not-here' });
            break;
          }
        }
      }

      // A page's file columns, through a person's door only.
      if (person !== null && files !== null && deps.pageColumns !== undefined && PERSON_ORIGINS.has(write.origin)) {
        const ruled = new Set(fileColumnsOf(write.table).map((column) => column.name));
        const pageColumns = [...(await deps.pageColumns(write.connectionId, write.table.id))].filter(
          (name) => !ruled.has(name) && write.table.columns.has(name) && Object.prototype.hasOwnProperty.call(write.values, name),
        );
        if (pageColumns.length > 0) {
          const bases = (await deps.publicBases?.()) ?? [];
          // The file a ref names, by its id or its key; null for one that names nothing of ours.
          const fileOf = async (ref: ReturnType<typeof parseRefList>[number]): Promise<StoredFile | null> =>
            ref.kind === 'id' ? files.findById(ref.id) : ref.kind === 'key' ? files.findByStorageKey(ref.key) : null;
          const idsIn = async (value: unknown): Promise<Set<string>> => {
            const out = new Set<string>();
            for (const ref of parseRefList(value, bases)) {
              const file = await fileOf(ref);
              if (file !== null) out.add(file.id);
            }
            return out;
          };
          // What every page column of the row holds now: a file one of them holds is not another's to take.
          const pageHeld = new Map<string, Set<string>>();
          for (const name of pageColumns) pageHeld.set(name, write.stored === null ? new Set() : await idsIn(write.stored[name]));
          for (const name of pageColumns) {
            const kept = pageHeld.get(name)!;
            const others = new Set([...pageHeld.entries()].filter(([other]) => other !== name).flatMap(([, ids]) => [...ids]));
            for (const ref of parseRefList(write.values[name], bases)) {
              const file = await fileOf(ref);
              // Not a file of ours (a link elsewhere, a key nothing is kept under), or one the row already held here.
              if (file === null || kept.has(file.id)) continue;
              const free =
                file.kind === 'upload' &&
                file.deletedAt === null &&
                file.uploadedBy === person &&
                file.entityConnectionId === write.connectionId &&
                (file.attachedAt === null || (ofThisRecord(file) && !others.has(file.id)));
              if (!free) {
                refuse(name, { code: 'file-not-here' });
                break;
              }
            }
          }
        }
      }
      return issues;
    },
  };
}

/** The judge of a write service built over no meta store: what a file column holds may be kept or cleared, and nothing new named. */
export const NO_NEW_FILES: FileColumnJudge = createFileColumnJudge({});
