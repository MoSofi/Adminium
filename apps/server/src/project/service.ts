// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project sync inside a running server.
 *
 * - **Triggers.** A write request that can change pages or schema
 *   customizations calls `databaseChanged()`. In dev the folder is watched as
 *   well, and a cheap fingerprint of both sides is polled once a second, so a
 *   file saved by an editor, or a page changed by a CLI command, is picked up
 *   too.
 * - **One run at a time.** Triggers are debounced and runs never overlap; a
 *   trigger during a run schedules one more.
 * - **What a run does.** In dev it brings files and database in step. On a
 *   server it only updates the "changed on server" flags: files there change
 *   with a deploy, and are applied at the next start.
 *
 * Studio reads `status()` and resolves conflicts through `resolve()`; `pull
 * --from` reads `changes()`.
 */

import { watch } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import nodePath from 'node:path';

import { projectFilesRepo, type MetaDb } from '@adminium/meta';

import { applyPageFile, applySchemaFile, deletePage } from './apply-files.js';
import { hasCodePage } from './client-build.js';
import { diskFileStore, type ProjectFileStore } from './file-store.js';
import { contentHash } from './json.js';
import { PAGES_DIR, SCHEMA_DIR, fromProjectPath, parseProjectPath, type PathApi } from './paths.js';
import { ABSENT, fileText, type OutsidePage } from './project-files.js';
import { adoptAsProjectPage } from './project-pages.js';
import {
  reconcileProject,
  snapshotProject,
  statusOf,
  type PathStatus,
  type ReconcileReport,
  type SyncMode,
} from './reconcile.js';

/** What `start` tells the server about the project it runs. */
export interface ProjectServerOptions {
  root: string;
  mode: SyncMode;
  log: (message: string) => void;
  warn: (message: string) => void;
}

/**
 * The API routes that can change pages or schema customizations: the page
 * routes, the connection routes (overrides, generation, schema changes,
 * deleting a connection) and AI assist's apply. A successful write to any of
 * them is the sync's signal that the database moved.
 */
export const CONFIG_WRITE_ROUTES = ['/api/v1/pages', '/api/v1/connections', '/api/v1/llm'] as const;

export function isConfigWrite(method: string, routeUrl: string | undefined): boolean {
  if (routeUrl === undefined || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return CONFIG_WRITE_ROUTES.some((prefix) => routeUrl === prefix || routeUrl.startsWith(`${prefix}/`));
}

/** The file-system calls the folder watch and the fingerprint make; tests pass fakes. */
export interface ProjectWatchFs {
  /** Call `onEvent` when something in `dir` changes. */
  watch(dir: string, onEvent: () => void): { close(): void };
  mkdir(dir: string): Promise<void>;
  /** Null when the file is gone. */
  stat(file: string): Promise<{ mtimeMs: number; size: number } | null>;
}

const nodeWatchFs: ProjectWatchFs = {
  watch: (dir, onEvent) => {
    const watcher = watch(dir, { persistent: false }, () => {
      onEvent();
    });
    watcher.on('error', () => undefined);
    return watcher;
  },
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  stat: (file) => stat(file).catch(() => null),
};

export interface ProjectServiceOptions {
  meta: MetaDb;
  root: string;
  mode: SyncMode;
  log: (message: string) => void;
  warn: (message: string) => void;
  /** Files were applied: open dashboards and caches should reload. */
  onApplied?: () => void;
  store?: ProjectFileStore;
  now?: () => number;
  debounceMs?: number;
  /** How often dev compares fingerprints; 0 turns polling off. */
  pollMs?: number;
  /** Watch the folder in dev. Default true. */
  watchFiles?: boolean;
  /** The platform's path functions; tests pass `path.win32`. */
  pathApi?: PathApi;
  fs?: ProjectWatchFs;
}

export interface ProjectStatusEntry {
  path: string;
  kind: 'page' | 'schema';
  /** The page's address, or the database key of a schema file. */
  name: string;
  /** The page on this instance, when there is one. */
  pageId: string | null;
  status: Exclude<PathStatus, 'in-sync'>;
  serverEditedAt: number | null;
  problems?: string[];
}

export interface ProjectStatus {
  mode: SyncMode;
  entries: ProjectStatusEntry[];
  /** Pages no project file can hold, with the reason. */
  outside: OutsidePage[];
}

export interface ProjectChange {
  path: string;
  status: 'changed-on-server' | 'conflict' | 'not-in-project';
  /** The server's copy, or null when the server deleted it. */
  content: string | null;
}

export interface ProjectService {
  readonly root: string;
  readonly mode: SyncMode;
  /** Bring files and database in step now, and say what happened. */
  reconcile(opts?: { applyFiles?: boolean }): Promise<ReconcileReport>;
  /** A write request may have changed pages or schema customizations. */
  databaseChanged(): void;
  /** Start watching (dev) and polling. */
  start(): void;
  close(): Promise<void>;
  status(): Promise<ProjectStatus>;
  /** Settle a conflict: keep this server's copy, or apply the project's. */
  resolve(path: string, keep: 'server' | 'project'): Promise<void>;
  changes(): Promise<ProjectChange[]>;
  /** The page and schema files in the folder, sorted. */
  files(): Promise<string[]>;
  /** Resolves once no run is scheduled or running. */
  idle(): Promise<void>;
}

export class ProjectResolveError extends Error {
  override readonly name = 'ProjectResolveError';
}

export function createProjectService(opts: ProjectServiceOptions): ProjectService {
  const { meta, root, mode } = opts;
  const pathApi = opts.pathApi ?? nodePath;
  const fs = opts.fs ?? nodeWatchFs;
  const store = opts.store ?? diskFileStore(root, pathApi);
  const now = opts.now ?? Date.now;
  const debounceMs = opts.debounceMs ?? 100;
  const codePage = (slug: string): boolean => hasCodePage(root, slug);
  const pollMs = opts.pollMs ?? (mode === 'dev' ? 1000 : 0);

  let chain: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;
  let poller: NodeJS.Timeout | null = null;
  let watchers: { close(): void }[] = [];
  let closed = false;
  let fingerprint: string | null = null;
  /** Invalid files already reported, by path, with the hash reported. */
  const reportedInvalid = new Map<string, string>();

  const describeReport = (report: ReconcileReport): void => {
    for (const path of report.applied) opts.log(`Applied ${path}.`);
    for (const path of report.written) opts.log(`Wrote ${path}.`);
    for (const path of report.deletedFiles) opts.log(`Deleted ${path}; what it described is gone.`);
    for (const path of report.removed) opts.log(`Removed what ${path} described; its file was deleted.`);
    for (const path of report.replacedByCode) {
      opts.log(`${path} was replaced by a page of code; the page keeps its address, grants and views.`);
    }
    for (const path of report.flagged) opts.log(`${path} was changed on this server; pull it into the project.`);
    for (const warning of report.warnings) opts.warn(warning);
    const seen = new Set<string>();
    for (const invalid of report.invalid) {
      seen.add(invalid.path);
      const key = contentHash(invalid.problems);
      if (reportedInvalid.get(invalid.path) === key) continue;
      reportedInvalid.set(invalid.path, key);
      opts.warn(`${invalid.path} was not applied:\n  ${invalid.problems.join('\n  ')}`);
    }
    for (const path of reportedInvalid.keys()) if (!seen.has(path)) reportedInvalid.delete(path);
  };

  const run = async (applyFiles: boolean): Promise<ReconcileReport> => {
    const report = await reconcileProject({ meta, store, mode, now, applyFiles, hasCodePage: codePage });
    describeReport(report);
    if (report.changedDatabase) opts.onApplied?.();
    fingerprint = await takeFingerprint().catch(() => null);
    return report;
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const schedule = (): void => {
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void enqueue(() => run(mode === 'dev')).catch((error: unknown) => {
        opts.warn(`Could not sync the project files: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, debounceMs);
    timer.unref();
  };

  /** Cheap summary of both sides; a change means a run is due. */
  const takeFingerprint = async (): Promise<string> => {
    const [pages, overrides, connections] = await Promise.all([
      meta.db
        .selectFrom('adminium_pages')
        .select((eb) => [eb.fn.countAll().as('count'), eb.fn.max('updatedAt').as('latest')])
        .executeTakeFirst(),
      meta.db
        .selectFrom('adminium_schema_overrides')
        .select((eb) => [eb.fn.countAll().as('count'), eb.fn.max('updatedAt').as('latest')])
        .executeTakeFirst(),
      meta.db.selectFrom('adminium_connections').select(['id', 'projectKey']).where('projectKey', 'is not', null).execute(),
    ]);
    const files: string[] = [];
    for (const key of await store.list()) {
      const info = await fs.stat(fromProjectPath(root, key, pathApi));
      files.push(`${key}:${String(info?.mtimeMs ?? 0)}:${String(info?.size ?? 0)}`);
    }
    return contentHash({ pages, overrides, connections, files });
  };

  const poll = async (): Promise<void> => {
    const current = await takeFingerprint().catch(() => null);
    if (current !== null && current !== fingerprint) {
      fingerprint = current;
      schedule();
    }
  };

  const service: ProjectService = {
    root,
    mode,

    reconcile: (reconcileOpts = {}) => enqueue(() => run(reconcileOpts.applyFiles ?? true)),

    databaseChanged: schedule,

    start() {
      if (closed) return;
      if (mode === 'dev' && opts.watchFiles !== false) {
        for (const dir of [PAGES_DIR, SCHEMA_DIR]) {
          const absolute = pathApi.join(root, dir);
          void fs
            .mkdir(absolute)
            .then(() => {
              if (closed) return;
              watchers.push(fs.watch(absolute, schedule));
            })
            .catch(() => undefined);
        }
      }
      if (pollMs > 0) {
        void takeFingerprint()
          .then((value) => {
            fingerprint ??= value;
          })
          .catch(() => undefined);
        poller = setInterval(() => {
          void poll();
        }, pollMs);
        poller.unref();
      }
    },

    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      if (poller !== null) clearInterval(poller);
      for (const watcher of watchers) watcher.close();
      watchers = [];
      await chain;
    },

    async status() {
      const snapshot = await snapshotProject(meta, store);
      const entries: ProjectStatusEntry[] = [];
      for (const state of snapshot.states) {
        const status = statusOf(state);
        if (status === 'in-sync') continue;
        const kind = parseProjectPath(state.path);
        if (kind === null) continue;
        entries.push({
          path: state.path,
          kind: kind.kind,
          name: kind.kind === 'page' ? kind.slug : kind.key,
          pageId: state.db?.pageId ?? null,
          status,
          serverEditedAt: state.row?.serverEditedAt ?? null,
          ...(state.file !== null && !state.file.valid ? { problems: state.file.problems } : {}),
        });
      }
      return { mode, entries, outside: snapshot.outside };
    },

    resolve: (path, keep) =>
      enqueue(async () => {
        const snapshot = await snapshotProject(meta, store);
        const state = snapshot.states.find((candidate) => candidate.path === path);
        if (state === undefined) throw new ProjectResolveError(`${path} is not a project file`);
        if (state.file !== null && !state.file.valid) {
          throw new ProjectResolveError(`${path} is not valid; fix the file first`);
        }
        const status = statusOf(state);
        if (status !== 'conflict' && status !== 'changed-on-server') {
          throw new ProjectResolveError(`${path} has nothing to resolve`);
        }
        const records = projectFilesRepo(meta);
        const fileHash = state.file === null ? ABSENT : state.file.hash;
        if (keep === 'server') {
          // The project's version is now the one this server has seen; the
          // page stays flagged until the project catches up with it.
          await records.record(path, fileHash, now());
          await records.flagServerEdit(path, state.db === null ? ABSENT : state.db.hash, now());
          return;
        }
        const kind = parseProjectPath(path);
        if (state.file === null) {
          if (kind?.kind === 'page' && state.db?.pageId != null) {
            if (codePage(kind.slug)) await adoptAsProjectPage(meta, state.db.pageId, now());
            else await deletePage(meta, state.db.pageId);
          }
          if (kind?.kind === 'schema') {
            const connectionId = snapshot.refs.connectionOf(kind.key);
            if (connectionId !== null) await applySchemaFile(meta, connectionId, [], now());
          }
          await records.remove(path);
        } else if (state.file.kind === 'page') {
          const slugs = new Set(
            snapshot.states.flatMap((candidate) => {
              const other = parseProjectPath(candidate.path);
              return candidate.file !== null && other?.kind === 'page' ? [other.slug] : [];
            }),
          );
          await applyPageFile(meta, state.file.doc, snapshot.refs, now(), (slug) => slugs.has(slug));
          await records.record(path, state.file.hash, now());
        } else {
          const connectionId = snapshot.refs.connectionOf(state.file.key);
          if (connectionId === null) throw new ProjectResolveError(`${path} names a database with no connection`);
          await applySchemaFile(meta, connectionId, state.file.rows, now());
          await records.record(path, state.file.hash, now());
        }
        opts.log(`Applied ${path} from the project, replacing this server's copy.`);
        opts.onApplied?.();
      }),

    files: () => store.list(),

    async changes() {
      const snapshot = await snapshotProject(meta, store);
      const out: ProjectChange[] = [];
      for (const state of snapshot.states) {
        const status = statusOf(state);
        if (status !== 'changed-on-server' && status !== 'conflict' && status !== 'not-in-project') continue;
        out.push({ path: state.path, status, content: state.db === null ? null : fileText(state.db) });
      }
      return out;
    },

    idle: async () => {
      while (timer !== null) {
        await new Promise((resolveWait) => setTimeout(resolveWait, debounceMs));
      }
      await chain;
    },
  };
  return service;
}
