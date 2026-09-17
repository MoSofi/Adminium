// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping a project's files and its meta store in step.
 *
 * Every path is judged from three hashes: the file's, the database's (the
 * file the database implies), and the one recorded in
 * `adminium_project_files` when the two last agreed. Whichever side moved
 * away from the recorded hash is the side that changed.
 *
 * In `dev` the folder is the master copy: a changed file is applied, a change
 * made in the database (Studio, regeneration, a CLI command) is written to
 * its file, and when both changed the file wins and a warning says so.
 *
 * On a `server` files only change through a deploy: a changed file is applied
 * when the page was not changed here, a page changed here is kept and flagged
 * "changed on server" until it is pulled into the project, and a page changed
 * on both sides is a conflict that Studio asks about. Nothing on a server
 * writes files.
 */

import { projectFilesRepo, type MetaDb, type ProjectFileRow } from '@adminium/meta';

import { applyPageFile, applySchemaFile, deletePage } from './apply-files.js';
import type { ProjectFileStore } from './file-store.js';
import { parseProjectPath } from './paths.js';
import { adoptAsProjectPage } from './project-pages.js';
import {
  ABSENT,
  exportProjectFiles,
  fileText,
  loadInstallRefs,
  readProjectFiles,
  type DatabaseFile,
  type FolderFile,
  type InstallRefs,
  type OutsidePage,
} from './project-files.js';

export type SyncMode = 'dev' | 'server';

export interface PathState {
  path: string;
  file: FolderFile | null;
  db: DatabaseFile | null;
  row: ProjectFileRow | null;
}

export type SyncAction =
  | { kind: 'none' }
  | { kind: 'record'; hash: string }
  | { kind: 'drop-row' }
  | { kind: 'write-file' }
  | { kind: 'delete-file' }
  | { kind: 'apply-file'; bothChanged: boolean }
  | { kind: 'delete-page'; bothChanged: boolean }
  | { kind: 'flag'; serverHash: string }
  | { kind: 'invalid'; problems: string[] };

const NONE: SyncAction = { kind: 'none' };

function hashes(state: PathState): { fh: string; dh: string; rh: string | null } {
  return {
    fh: state.file === null ? ABSENT : state.file.hash,
    dh: state.db === null ? ABSENT : state.db.hash,
    rh: state.row === null ? null : state.row.hash,
  };
}

/** What to do for one path. */
export function decide(mode: SyncMode, state: PathState): SyncAction {
  const { fh, dh, rh } = hashes(state);
  const flag = (): SyncAction => (state.row?.serverHash === dh ? NONE : { kind: 'flag', serverHash: dh });

  if (state.file !== null && !state.file.valid) {
    // The file cannot be applied, but a server can still notice its own copy moved.
    if (mode === 'server' && rh !== null && dh !== rh) return flag();
    return { kind: 'invalid', problems: state.file.problems };
  }
  if (fh === dh) {
    if (fh === ABSENT) return state.row === null ? NONE : { kind: 'drop-row' };
    return rh === fh && state.row?.serverEditedAt === null ? NONE : { kind: 'record', hash: fh };
  }
  if (rh !== null && fh === rh) {
    // Only the database moved.
    if (mode === 'server') return flag();
    return dh === ABSENT ? { kind: 'delete-file' } : { kind: 'write-file' };
  }
  if (rh !== null && dh === rh) {
    // Only the file moved.
    return fh === ABSENT ? { kind: 'delete-page', bothChanged: false } : { kind: 'apply-file', bothChanged: false };
  }
  if (rh === null) {
    if (fh === ABSENT) return mode === 'dev' ? { kind: 'write-file' } : NONE;
    if (dh === ABSENT) return { kind: 'apply-file', bothChanged: false };
  }
  // Both moved, or they already differed when this install first saw them.
  if (mode === 'server') return flag();
  return fh === ABSENT ? { kind: 'delete-page', bothChanged: true } : { kind: 'apply-file', bothChanged: true };
}

export type PathStatus =
  | 'in-sync'
  /** The file is what this server applied; the server's copy changed since (or was deleted). */
  | 'changed-on-server'
  /** Both the file and the server's copy changed. */
  | 'conflict'
  /** The page exists on this server only. */
  | 'not-in-project'
  /** The file changed and is applied at the next start. */
  | 'pending'
  | 'invalid';

export function statusOf(state: PathState): PathStatus {
  if (state.file !== null && !state.file.valid) return 'invalid';
  const { fh, dh, rh } = hashes(state);
  if (fh === dh) return 'in-sync';
  if (rh !== null && fh === rh) return 'changed-on-server';
  if (rh !== null && dh === rh) return 'pending';
  if (rh === null && fh === ABSENT) return 'not-in-project';
  if (rh === null && dh === ABSENT) return 'pending';
  return 'conflict';
}

export interface ProjectSnapshot {
  refs: InstallRefs;
  states: PathState[];
  outside: OutsidePage[];
}

/** Both sides and the records, for every path either side or the records know. */
export async function snapshotProject(meta: MetaDb, store: ProjectFileStore): Promise<ProjectSnapshot> {
  const refs = await loadInstallRefs(meta);
  const [folder, database, rows] = await Promise.all([
    readProjectFiles(store, refs),
    exportProjectFiles(meta, refs),
    projectFilesRepo(meta).list(),
  ]);
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const paths = new Set([...folder.keys(), ...database.files.keys(), ...byPath.keys()]);
  const states = [...paths]
    .filter((path) => parseProjectPath(path) !== null)
    // Schema customizations first: pages are generated from them.
    .sort((a, b) => (a.startsWith('schema/') === b.startsWith('schema/') ? (a < b ? -1 : 1) : a.startsWith('schema/') ? -1 : 1))
    .map((path) => ({
      path,
      file: folder.get(path) ?? null,
      db: database.files.get(path) ?? null,
      row: byPath.get(path) ?? null,
    }));
  return { refs, states, outside: database.outside };
}

export interface ReconcileOptions {
  meta: MetaDb;
  store: ProjectFileStore;
  mode: SyncMode;
  now?: () => number;
  /** Only these paths; all of them when omitted. */
  paths?: ReadonlySet<string>;
  /**
   * False on a running server: its files only change with a deploy, so a
   * changed file waits for the next start, and only the server-edit flags
   * are brought up to date. Default true.
   */
  applyFiles?: boolean;
  /**
   * Whether the folder has a page of code at this address. A deleted page
   * file whose address has one was ejected (`adminium eject`): its row
   * becomes that page's row instead of being deleted.
   */
  hasCodePage?: (slug: string) => boolean;
}

export interface ReconcileReport {
  /** Files applied to the database. */
  applied: string[];
  /** Files written from the database's copy (dev). */
  written: string[];
  /** Files deleted because their page or database is gone (dev). */
  deletedFiles: string[];
  /** Pages or schema customizations removed because their file was deleted. */
  removed: string[];
  /** Page files replaced by a page of code, whose row that page now has. */
  replacedByCode: string[];
  /** Paths whose server copy was newly flagged (server). */
  flagged: string[];
  invalid: { path: string; problems: string[] }[];
  warnings: string[];
  /** Whether anything in the database changed. */
  changedDatabase: boolean;
}

/** Bring one project's files and database in step, as `mode` rules. */
export async function reconcileProject(opts: ReconcileOptions): Promise<ReconcileReport> {
  const { meta, store, mode } = opts;
  const now = opts.now ?? Date.now;
  const records = projectFilesRepo(meta);
  const snapshot = await snapshotProject(meta, store);
  const report: ReconcileReport = {
    applied: [],
    written: [],
    deletedFiles: [],
    removed: [],
    replacedByCode: [],
    flagged: [],
    invalid: [],
    warnings: [],
    changedDatabase: false,
  };
  const folderSlugs = new Set(
    snapshot.states.flatMap((state) => {
      const kind = parseProjectPath(state.path);
      return state.file !== null && kind?.kind === 'page' ? [kind.slug] : [];
    }),
  );

  for (const state of snapshot.states) {
    if (opts.paths !== undefined && !opts.paths.has(state.path)) continue;
    const action = decide(mode, state);
    const kind = parseProjectPath(state.path);
    if (kind === null) continue;
    if (opts.applyFiles === false && (action.kind === 'apply-file' || action.kind === 'delete-page')) continue;
    try {
      switch (action.kind) {
        case 'none':
          break;
        case 'record':
          await records.record(state.path, action.hash, now());
          break;
        case 'drop-row':
          await records.remove(state.path);
          break;
        case 'invalid':
          report.invalid.push({ path: state.path, problems: action.problems });
          break;
        case 'flag':
          await records.flagServerEdit(state.path, action.serverHash, now());
          if (state.row?.serverHash === null || state.row === null) report.flagged.push(state.path);
          break;
        case 'write-file':
          if (state.db === null) break;
          await store.write(state.path, fileText(state.db));
          await records.record(state.path, state.db.hash, now());
          report.written.push(state.path);
          break;
        case 'delete-file':
          await store.remove(state.path);
          await records.remove(state.path);
          report.deletedFiles.push(state.path);
          break;
        case 'apply-file': {
          const file = state.file;
          if (file === null || !file.valid) break;
          if (action.bothChanged) {
            report.warnings.push(`${state.path} and the database both changed; the file was applied.`);
          }
          if (file.kind === 'page') {
            const applied = await applyPageFile(meta, file.doc, snapshot.refs, now(), (slug) => folderSlugs.has(slug));
            for (const warning of applied.warnings) report.warnings.push(`${state.path}: ${warning}`);
          } else {
            const connectionId = snapshot.refs.connectionOf(file.key);
            if (connectionId === null) break;
            await applySchemaFile(meta, connectionId, file.rows, now());
          }
          await records.record(state.path, file.hash, now());
          report.applied.push(state.path);
          report.changedDatabase = true;
          break;
        }
        case 'delete-page': {
          if (action.bothChanged) {
            report.warnings.push(`${state.path} was deleted while the database changed it; the deletion was applied.`);
          }
          const pageId = kind.kind === 'page' ? (state.db?.pageId ?? null) : null;
          if (kind.kind === 'page' && pageId !== null && opts.hasCodePage?.(kind.slug) === true) {
            await adoptAsProjectPage(meta, pageId, now());
            await records.remove(state.path);
            report.replacedByCode.push(state.path);
            report.changedDatabase = true;
            break;
          }
          if (kind.kind === 'page') {
            if (pageId !== null) await deletePage(meta, pageId);
          } else {
            const connectionId = snapshot.refs.connectionOf(kind.key);
            if (connectionId !== null) await applySchemaFile(meta, connectionId, [], now());
          }
          await records.remove(state.path);
          report.removed.push(state.path);
          report.changedDatabase = true;
          break;
        }
      }
    } catch (error) {
      report.warnings.push(`${state.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}

export interface PullReport {
  written: string[];
  deletedFiles: string[];
  /** Files the database has never seen, left as they are. */
  notApplied: string[];
  outside: OutsidePage[];
}

/**
 * Make the folder say what this install's database says (`adminium pull`).
 * A file the database has never seen is kept: it is new work that the next
 * `dev` applies.
 */
export async function pullProject(opts: { meta: MetaDb; store: ProjectFileStore; now?: () => number }): Promise<PullReport> {
  const now = opts.now ?? Date.now;
  const records = projectFilesRepo(opts.meta);
  const snapshot = await snapshotProject(opts.meta, opts.store);
  const report: PullReport = { written: [], deletedFiles: [], notApplied: [], outside: snapshot.outside };
  for (const state of snapshot.states) {
    if (state.db !== null) {
      if (state.file === null || !state.file.valid || state.file.hash !== state.db.hash) {
        await opts.store.write(state.path, fileText(state.db));
        report.written.push(state.path);
      }
      if (state.row?.hash !== state.db.hash || state.row.serverEditedAt !== null) {
        await records.record(state.path, state.db.hash, now());
      }
      continue;
    }
    if (state.file === null) {
      if (state.row !== null) await records.remove(state.path);
      continue;
    }
    if (state.row === null) {
      report.notApplied.push(state.path);
      continue;
    }
    await opts.store.remove(state.path);
    await records.remove(state.path);
    report.deletedFiles.push(state.path);
  }
  return report;
}
