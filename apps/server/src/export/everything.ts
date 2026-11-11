// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export everything" from Studio: the instance archive's export variant
 * (`archive/create.ts`, kind `export`), made on this server and downloaded ONCE.
 *
 * The file is the same one `adminium archive create --export` writes, by the
 * same writer: no password hashes, secrets, keys or tokens (`archive/policy.ts`
 * applies those rules; nothing here can ask for secrets, S17), unsigned, read
 * back by `adminium import-zip`.
 *
 * The rules this module keeps (security review S17):
 *  - ONE export at a time on this instance. While one is being made, or a
 *    made one waits for someone else's download, a new one is refused. The
 *    same session asking again throws its own waiting file away first.
 *  - The download id is random, bound to the user AND the session that asked
 *    for it, and good for one download within {@link EXPORT_DOWNLOAD_TTL_MS}
 *    of the file being ready. Someone else's session, a second download or a
 *    late one finds nothing.
 *  - The file is made inside the data dir ({@link EXPORT_EVERYTHING_DIR}), so
 *    it counts where the instance's disk is counted, and the whole folder is
 *    removed at every boot: a file a crash or a restart left behind never
 *    outlives the process that made it.
 *
 * The state lives in this process only. A restart forgets the export and the
 * boot sweep removes its file; the page then shows "Download everything" again.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DsnCrypto, MetaDb } from '@adminium/meta';

import { createArchive, type CreateArchiveOptions, type CreateArchiveResult } from '../archive/create.js';
import { ArchiveFormatError } from '../archive/format.js';
import type { ArchiveSigningKey } from '../archive/mac.js';

/** The folder inside the data dir that holds the file while it waits. Removed at boot. */
export const EXPORT_EVERYTHING_DIR = '.export-everything';

/** How long a made file waits for its one download. */
export const EXPORT_DOWNLOAD_TTL_MS = 10 * 60_000;

/** Who asked: the download is theirs, in that session only. */
export interface ExportBinding {
  userId: string;
  sessionId: string;
}

/** What the page is told. `percent` is whole numbers, 0 to 100. */
export type ExportView =
  | { id: string; state: 'preparing'; percent: number }
  | { id: string; state: 'ready'; percent: 100; fileName: string; bytes: number; expiresAt: number }
  | { id: string; state: 'failed'; message: string }
  | { id: string; state: 'expired' };

/** Why a download finds nothing to send. */
export type TakeRefusal = 'unknown' | 'preparing' | 'gone';

export interface TakenExport {
  path: string;
  fileName: string;
  bytes: number;
  /** Remove the file. Called once the download has ended, sent in full or not. */
  release: () => Promise<void>;
}

/** Another export is being made, or waits for someone else's download. */
export class ExportBusyError extends Error {
  override readonly name = 'ExportBusyError';
}

export interface ExportEverythingDeps {
  meta: MetaDb;
  dataDir: string;
  projectRoot: string | null;
  secret: string;
  dsnCrypto: DsnCrypto;
  signing: ArchiveSigningKey;
  /** The instance's display name, for the file's name (`branding.appName`). */
  appName: () => Promise<string>;
  now?: () => number;
  ttlMs?: number;
  /** The writer; a test hands in a slower or failing one. */
  build?: (opts: CreateArchiveOptions) => Promise<CreateArchiveResult>;
  log?: (message: string, error?: unknown) => void;
}

export interface ExportEverything {
  /** Remove whatever an earlier process left in {@link EXPORT_EVERYTHING_DIR}. Run once at boot. */
  sweep(): Promise<void>;
  /** Start making the file. Throws {@link ExportBusyError} when one is under way or waits for another session. */
  start(binding: ExportBinding): Promise<ExportView>;
  /** The export this session asked for, as it stands now; `null` when there is none. */
  current(binding: ExportBinding): Promise<ExportView | null>;
  /** Hand the file out, once. After this the id is spent, whatever happens to the download. */
  take(id: string, binding: ExportBinding): Promise<TakenExport | TakeRefusal>;
  /** Wait for a file under way to finish (tests, and a clean shutdown). */
  settled(): Promise<void>;
  /** Stop the expiry timer. */
  close(): void;
}

interface Job {
  id: string;
  binding: ExportBinding;
  path: string;
  state: 'preparing' | 'ready' | 'failed' | 'expired';
  percent: number;
  fileName: string;
  bytes: number;
  readyAt: number;
  message: string;
  run: Promise<void>;
}

const sameBinding = (a: ExportBinding, b: ExportBinding): boolean => a.userId === b.userId && a.sessionId === b.sessionId;

/** `Hollis Bakery` on 10 November 2026 → `hollis-bakery-2026-11-10.zip`. A name with no Latin letters or digits is `adminium`. */
export function exportFileName(appName: string, at: number): string {
  const slug = appName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${slug === '' ? 'adminium' : slug}-${new Date(at).toISOString().slice(0, 10)}.zip`;
}

export function createExportEverything(deps: ExportEverythingDeps): ExportEverything {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? EXPORT_DOWNLOAD_TTL_MS;
  const build = deps.build ?? createArchive;
  const log = deps.log ?? (() => undefined);
  const dir = join(resolve(deps.dataDir), EXPORT_EVERYTHING_DIR);
  let job: Job | null = null;
  let timer: NodeJS.Timeout | null = null;
  /** Ids already downloaded, with whose they were: asked again by the same session they answer "gone", not "unknown". */
  const spent = new Map<string, ExportBinding>();
  const spend = (taken: Job): void => {
    spent.set(taken.id, taken.binding);
    while (spent.size > 16) spent.delete(spent.keys().next().value as string);
  };

  const removeFile = async (path: string): Promise<void> => {
    await rm(path, { force: true }).catch((error: unknown) => log(`could not remove the export file ${path}`, error));
    await rm(`${path}.part`, { force: true }).catch(() => undefined);
  };

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** A ready file past its time is removed, and the slot says so to its own session. */
  const expireIfDue = async (): Promise<void> => {
    if (job?.state !== 'ready' || now() < job.readyAt + ttl) return;
    job.state = 'expired';
    clearTimer();
    await removeFile(job.path);
  };

  const view = (current: Job): ExportView => {
    switch (current.state) {
      case 'preparing':
        return { id: current.id, state: 'preparing', percent: current.percent };
      case 'ready':
        return { id: current.id, state: 'ready', percent: 100, fileName: current.fileName, bytes: current.bytes, expiresAt: current.readyAt + ttl };
      case 'failed':
        return { id: current.id, state: 'failed', message: current.message };
      case 'expired':
        return { id: current.id, state: 'expired' };
    }
  };

  const make = async (current: Job): Promise<void> => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const result = await build({
        meta: deps.meta,
        outPath: current.path,
        dataDir: deps.dataDir,
        projectRoot: deps.projectRoot,
        kind: 'export',
        secret: deps.secret,
        dsnCrypto: deps.dsnCrypto,
        signing: deps.signing,
        scratchRoot: dir,
        onProgress: (fraction) => {
          // The last percent belongs to the file being in place, which only `ready` says.
          current.percent = Math.min(99, Math.floor(fraction * 100));
        },
      });
      if (job !== current) {
        // Thrown away while it was being made (the same session started again).
        await removeFile(current.path);
        return;
      }
      current.bytes = result.bytes;
      current.readyAt = now();
      current.fileName = exportFileName(await deps.appName().catch(() => 'Adminium'), current.readyAt);
      current.percent = 100;
      current.state = 'ready';
      clearTimer();
      timer = setTimeout(() => void expireIfDue(), ttl + 1000);
      timer.unref();
    } catch (error) {
      await removeFile(current.path);
      if (job !== current) return;
      current.state = 'failed';
      current.message =
        error instanceof ArchiveFormatError
          ? [error.message, error.hint].filter((part) => part !== undefined && part !== '').join(' ')
          : 'The file could not be made. The server’s log says why.';
      log('Export everything failed', error);
    }
  };

  return {
    async sweep() {
      await rm(dir, { recursive: true, force: true });
    },

    async start(binding) {
      await expireIfDue();
      if (job !== null) {
        const mine = sameBinding(job.binding, binding);
        if (job.state === 'preparing') throw new ExportBusyError('An export is being made already. Wait for it to finish.');
        if (job.state === 'ready' && !mine) {
          throw new ExportBusyError('Another export waits for its download. Try again in a few minutes.');
        }
        // Mine and ready (asked again), or a failed or expired one: it goes.
        if (job.state === 'ready') await removeFile(job.path);
        clearTimer();
      }
      const id = randomBytes(16).toString('hex');
      const current: Job = {
        id,
        binding: { userId: binding.userId, sessionId: binding.sessionId },
        path: join(dir, `${id}.zip`),
        state: 'preparing',
        percent: 0,
        fileName: '',
        bytes: 0,
        readyAt: 0,
        message: '',
        run: Promise.resolve(),
      };
      job = current;
      current.run = make(current);
      return view(current);
    },

    async current(binding) {
      await expireIfDue();
      return job !== null && sameBinding(job.binding, binding) ? view(job) : null;
    },

    async take(id, binding) {
      await expireIfDue();
      // Someone else's id, or another session's, is not told apart from no id at all.
      if (job === null || job.id !== id || !sameBinding(job.binding, binding)) {
        const was = spent.get(id);
        return was !== undefined && sameBinding(was, binding) ? 'gone' : 'unknown';
      }
      if (job.state === 'preparing') return 'preparing';
      if (job.state !== 'ready') return 'gone';
      const taken = job;
      job = null;
      spend(taken);
      clearTimer();
      // A file removed from under the server (the disk, an operator) is gone, not an error.
      if ((await stat(taken.path).catch(() => null)) === null) return 'gone';
      return { path: taken.path, fileName: taken.fileName, bytes: taken.bytes, release: () => removeFile(taken.path) };
    },

    async settled() {
      await job?.run;
    },

    close() {
      clearTimer();
    },
  };
}
