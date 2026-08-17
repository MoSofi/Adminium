// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BackupCoordinator — native dialogs, "show in folder", restore choreography,
 * and the §9 auto-backup schedule (11-electron.md §9, §2.1).
 *
 * SCOPE, from §1 principle 2 ("The server is the only data owner"): this module
 * runs DIALOGS, not backups. The archive itself is produced inside the server
 * (`POST /api/v1/desktop/backup`), which already holds the connections and can
 * snapshot each SQLite file with better-sqlite3's online `backup()` API without
 * locking live writers. The single sanctioned exception is reading a backup zip
 * READ-ONLY to validate its manifest and checksums before a restore — which
 * lives next door in `backup-archive.ts`, so that this file cannot quietly grow
 * a second one.
 *
 * And from §9: a restore never deletes. Current data moves to
 * `<dataDir>/pre-restore-<ts>/` and stays there for the user to empty.
 *
 * ─── How this process talks to the server, and why it is the user's session ──
 *
 * The backup route is session-guarded (§9). Main has no cookie jar of its own —
 * but it OWNS the one the window uses: Electron's `session` holds the
 * `adminium_session` cookie the SPA got from §5's boot-token exchange, and main
 * can read it. So {@link BackupTransport} is "fetch, with the window's session
 * cookie attached", and the backup runs AS THE SIGNED-IN USER. That is not a
 * workaround, it is the correct principal: the audit row names a person, the
 * completion notification has an inbox to land in (`user_id` is NOT NULL), and
 * §5's "Require login on this device" keeps meaning something — with no session,
 * there is no backup, which is exactly right for an archive containing every row
 * in the install.
 *
 * ─── Copy ────────────────────────────────────────────────────────────────────
 *
 * The strings are en-US and live in {@link EN_US_BACKUP_LABELS}, mirroring
 * `menu.ts`'s {@link EN_US_MENU_LABELS} and for the same reason: `@adminium/i18n`
 * is not importable from the shell (§1 principle 2 / `.dependency-cruiser.cjs`
 * `desktop-shell-only`), and 11-T19 is the track that wires localized main-
 * process strings. The shape here is already a lookup + a `t` hook, so that
 * change is a different `t`, not a different module.
 */

import { copyFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Cron } from 'croner';

import {
  BackupArchiveError,
  moveDataAside,
  unpackArchive,
  validateArchive,
  type BackupManifest,
  type FsDeps,
  type MoveAsideResult,
  type UnpackResult,
  type ValidatedArchive,
} from './backup-archive.js';
import type { DesktopConfig } from './config.js';

// ─── Copy (§14 / 10-i18n-theming.md; 11-T19 localizes) ──────────────────────

export type BackupLabelKey =
  | 'save.title'
  | 'save.defaultName'
  | 'restore.confirm.title'
  | 'restore.confirm.body'
  | 'restore.confirm.ok'
  | 'restore.confirm.cancel'
  | 'restore.done.title'
  | 'restore.done.body'
  | 'restore.failed.title'
  | 'backup.failed.title'
  | 'backup.noSession';

export type BackupTranslate = (key: BackupLabelKey, vars?: Record<string, string>) => string;

/**
 * en-US, and the fallback until 11-T19.
 *
 * `restore.confirm.body` is §9's sentence, verbatim and non-negotiable: it is
 * the one screen where a user decides whether to replace their data, and the
 * promise it makes ("not deleted") is the promise {@link restoreFromArchive}
 * keeps by never removing the pre-restore folder.
 */
export const EN_US_BACKUP_LABELS: Readonly<Record<BackupLabelKey, string>> = Object.freeze({
  'save.title': 'Back up Adminium',
  'save.defaultName': 'adminium-backup.zip',
  'restore.confirm.title': 'Restore from backup?',
  'restore.confirm.body':
    'Replaces current data. Current data will be moved to {preRestore}, not deleted.',
  'restore.confirm.ok': 'Restore',
  'restore.confirm.cancel': 'Cancel',
  'restore.done.title': 'Restore complete',
  'restore.done.body': 'Adminium restored the backup from {createdAt}.',
  'restore.failed.title': 'Could not restore this backup',
  'backup.failed.title': 'Could not back up',
  'backup.noSession':
    'Sign in to Adminium first — a backup contains all of your data, so it needs an ' +
    'account behind it.',
});

const interpolate = (template: string, vars: Record<string, string> = {}): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);

const defaultTranslate: BackupTranslate = (key, vars) =>
  interpolate(EN_US_BACKUP_LABELS[key], vars);

// ─── Ports ──────────────────────────────────────────────────────────────────

/** What the server's `POST /desktop/backup` answers (`routes/desktop/schema.ts`). */
export interface BackupResponse {
  path: string;
  bytes: number;
  manifest: BackupManifest;
  rotated: string[];
}

/**
 * The one call this module makes to the server.
 *
 * A port rather than a `fetch` here, because "attach the window's session
 * cookie" needs Electron's `session` and "which port is the server on" changes
 * on every restart (§2.2 step 9 re-forks on a new :0 port) — neither of which a
 * unit test can supply and both of which the boot sequence already tracks.
 *
 * Resolves `null` when there is no session to speak of (first run; "Require
 * login on this device" with nobody signed in). Not an error: it is a normal
 * state with a normal answer, which is to say so.
 */
export type BackupTransport = (body: {
  destination: 'staged' | 'auto';
  keep: number;
  config: unknown;
}) => Promise<BackupResponse | null>;

/** §4's native dialogs, narrowed to what §9 uses (`main/window.ts` implements). */
export interface BackupDialogs {
  saveFile(opts: { kind: 'backup'; defaultName: string }): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
  /** True ⇒ the user pressed the destructive button. */
  confirm(opts: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }): Promise<boolean>;
  notify(opts: { title: string; message: string; kind: 'info' | 'error' }): Promise<void>;
}

/** The slice of `ServerManager` a restore drives (§9: stop → unpack → start). */
export interface BackupServerControl {
  stop(): Promise<void>;
  start(): Promise<{ metaVersion: string }>;
  /**
   * The newest migration THIS app ships, from the §2.2 step 7 handshake, or
   * `null` if no server has come up this boot. See `validateArchive`'s
   * `appMetaVersion` for why `null` refuses rather than skips.
   */
  metaVersion(): string | null;
}

/**
 * §9's "first idle moment after 03:00", as a port.
 *
 * Electron's `powerMonitor.getSystemIdleTime()` behind an interface, because it
 * is the one part of the schedule a test cannot wait for: the real thing answers
 * in seconds-since-last-input and a unit suite has neither input nor seconds.
 * Omitted ⇒ no idle wait at all, which is the honest degradation for a build
 * without a power monitor (and what the suites use to assert the 03:00 half
 * without the idle half).
 */
export interface IdleMonitor {
  /** True when the user has not touched the machine for a while. */
  isIdle(): Promise<boolean>;
  /** Sleep, injectable so the poll loop does not take four hours in a test. */
  wait(ms: number): Promise<void>;
}

/** A running cron schedule. `croner`'s `Cron` satisfies it. */
export interface ScheduleHandle {
  stop(): void;
}

/**
 * Create the §9 schedule. Injected for the same reason `server-manager.ts`
 * injects `fork` and `timers`: the only other way to observe a 03:00 tick is to
 * wait until 03:00.
 */
export type CreateSchedule = (cron: string, onTick: () => void) => ScheduleHandle;

const cronSchedule: CreateSchedule = (cron, onTick) =>
  // `protect: true` — croner skips a tick while the previous one is still
  // running. Belt to `exclusive`'s braces: a backup that somehow took 24 hours
  // must not have a second one queued behind it.
  new Cron(cron, { protect: true }, onTick);

export interface CreateBackupCoordinatorOptions {
  /** The live `config.json` (§2.3) — `autoBackup`, and the body's redacted copy. */
  readConfig: () => DesktopConfig;
  /**
   * `config.json` minus its secrets — `main/config.ts`'s `redactConfig`, passed
   * in rather than called, so the ONE function allowed to decide what a redacted
   * config is stays the one that decides it (see that function's allow-list
   * comment). The server re-asserts on receipt regardless.
   */
  redactConfig: (config: DesktopConfig) => unknown;
  transport: BackupTransport;
  dialogs: BackupDialogs;
  server: BackupServerControl;
  /** §2.3 `dataDir` — where a restore unpacks and moves data aside. */
  dataDir: string;
  /** §9's "first idle moment". Omitted ⇒ the schedule fires at 03:00 flat. */
  idle?: IdleMonitor | undefined;
  /** §9's main-process log. */
  log?: ((line: string) => void) | undefined;
  t?: BackupTranslate | undefined;
  /** Test seams. */
  fs?: FsDeps | undefined;
  archive?: BackupArchiveOps | undefined;
  moveFile?: MoveFile | undefined;
  createSchedule?: CreateSchedule | undefined;
  now?: (() => number) | undefined;
}

/** Move a staged archive to the path the user picked in the save dialog. */
export type MoveFile = (from: string, to: string) => Promise<void>;

/** What `validateArchive` hands back: the archive plus its decoded members. */
export type ReadArchive = ValidatedArchive & { members: Record<string, Uint8Array> };

/**
 * `backup-archive.ts`'s three operations, as one port.
 *
 * Injected so §9's restore ORDER is assertable. That order — stop, move aside,
 * unpack, start — is the whole safety property, it is invisible in every type,
 * and getting it wrong loses data silently. Without a seam here the only way to
 * check it would be to run a real Electron app against a real disk, which is
 * 11-T20's job and not a thing that runs on every commit.
 *
 * Defaults to the real module, so production goes through the real reader and
 * nothing is faked outside a test.
 */
export interface BackupArchiveOps {
  validate(opts: { path: string; appMetaVersion: string | null; dataDir: string }): Promise<ReadArchive>;
  moveAside(dataDir: string, preRestoreDir: string): Promise<MoveAsideResult>;
  unpack(archive: ReadArchive, dataDir: string): Promise<UnpackResult>;
}

function realArchiveOps(fs: FsDeps | undefined): BackupArchiveOps {
  return {
    validate: (opts) => validateArchive(opts),
    moveAside: (dataDir, preRestoreDir) => moveDataAside(dataDir, preRestoreDir, fs),
    unpack: (archive, dataDir) => unpackArchive(archive, dataDir, fs),
  };
}

export interface BackupCoordinator {
  /** File → "Back up now…": `saveFile` dialog, then the server does the work. */
  backupNow(): Promise<void>;
  /** File → "Restore from backup…", and the §2.2 step-1 launch-argument path. */
  restoreFrom(zipPath: string): Promise<void>;
  /** §9's daily auto-backup. Starts the schedule; returns a stop function. */
  startAutoBackup(): () => void;
}

// ─── The coordinator ────────────────────────────────────────────────────────

export function createBackupCoordinator(
  opts: CreateBackupCoordinatorOptions,
): BackupCoordinator {
  const t = opts.t ?? defaultTranslate;
  const log = opts.log ?? ((): void => {});
  const now = opts.now ?? Date.now;
  const move = opts.moveFile ?? moveFileOnDisk;
  const archiveOps = opts.archive ?? realArchiveOps(opts.fs);

  /**
   * Nothing in here may overlap itself. A backup running while a restore stops
   * the server would post to a dead port; two restores at once would race over
   * `<dataDir>`, and the loser would move the WINNER's freshly-unpacked data
   * into a second pre-restore folder. The menu, the settings panel, the launch
   * argument and the scheduler are four independent triggers into three async
   * functions, so "the user cannot click twice" is not a property this code has.
   */
  let busy = false;
  const exclusive = async <T>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    if (busy) {
      log(`[backup] ignoring ${what}: another backup or restore is already running`);
      return undefined;
    }
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  };

  async function backupNow(): Promise<void> {
    await exclusive('backupNow', async () => {
      // The dialog FIRST. Producing an archive and then discovering the user
      // cancelled would snapshot every database for nothing — on a laptop, that
      // is a spinning disk and a warm fan in exchange for a file we delete.
      const target = await opts.dialogs.saveFile({
        kind: 'backup',
        defaultName: defaultBackupName(now()),
      });
      if (target === null) return;

      try {
        const config = opts.readConfig();
        const response = await opts.transport({
          destination: 'staged',
          keep: config.autoBackup.keep,
          config: opts.redactConfig(config),
        });
        if (response === null) {
          await opts.dialogs.notify({
            title: t('backup.failed.title'),
            message: t('backup.noSession'),
            kind: 'error',
          });
          return;
        }

        // The server wrote into its staging dir; the user's chosen path is
        // ours to write. See `routes/desktop/index.ts` for why the path never
        // travels the other way.
        await move(response.path, target);
        log(`[backup] wrote ${target} (${String(response.bytes)} bytes)`);
        await opts.dialogs.showItemInFolder(target);
      } catch (error) {
        await reportFailure('backup.failed.title', error);
      }
    });
  }

  async function restoreFrom(zipPath: string): Promise<void> {
    await exclusive('restoreFrom', async () => {
      let archive: ReadArchive;
      try {
        // §9 step 1: read-only, before anything is touched. This is the whole
        // reason the flow has a validation phase — every refusal below happens
        // while the user's data is still exactly where it was.
        archive = await archiveOps.validate({
          path: zipPath,
          appMetaVersion: opts.server.metaVersion(),
          // The target, not the archive: `assertRestorablePaths` needs to know
          // where THIS install keeps its databases to decide whether the
          // archive's can land correctly.
          dataDir: opts.dataDir,
        });
      } catch (error) {
        await reportFailure('restore.failed.title', error);
        return;
      }

      const preRestore = preRestoreDirName(now());
      const confirmed = await opts.dialogs.confirm({
        title: t('restore.confirm.title'),
        // §9's sentence. The path is interpolated because a promise about where
        // data goes is worth nothing if the user cannot go look.
        message: t('restore.confirm.body', { preRestore: join(opts.dataDir, preRestore) }),
        confirmLabel: t('restore.confirm.ok'),
        cancelLabel: t('restore.confirm.cancel'),
      });
      if (!confirmed) return;

      // Did anything actually get moved? `moveAside` is all-or-nothing and rolls
      // itself back, so a failure INSIDE it leaves the pre-restore folder empty
      // — and appending "Your data is in <pre-restore>" to a message that just
      // said "Nothing has been changed" is a self-contradiction that sends the
      // user hunting through an empty folder. Only the unpack/start phases past
      // a SUCCESSFUL move have data in there to point at.
      let movedAside = false;
      try {
        await restoreValidated(archive, preRestore, () => {
          movedAside = true;
        });
      } catch (error) {
        // The server is stopped. If the move succeeded, say where the old copy
        // is — that sentence is the difference between "I broke it" and "it is
        // in that folder".
        await reportFailure(
          'restore.failed.title',
          error,
          movedAside ? join(opts.dataDir, preRestore) : undefined,
        );
        // Best effort: get the app back to a running state either way. A failed
        // restore that also leaves the app dead is two problems.
        await opts.server.start().catch(() => undefined);
        return;
      }

      await opts.dialogs.notify({
        title: t('restore.done.title'),
        message: t('restore.done.body', {
          createdAt: new Date(archive.manifest.createdAt).toLocaleString(),
        }),
        kind: 'info',
      });
    });
  }

  /**
   * §9's flow, past the point of no return: stop → move aside → unpack → start.
   *
   * The order is the safety property and every pair of steps is load-bearing.
   * Stopping FIRST means nothing is writing to `meta.db` while it is renamed —
   * a live server would keep its file handle, and on Windows the rename would
   * simply fail. Moving aside BEFORE unpacking means the old data is intact and
   * addressable at the moment the new data lands, so a failure between them
   * loses nothing. Starting LAST is what fast-forwards an older backup: `firstRun`
   * runs the migration ledger over whatever `meta.db` it now finds (§9: "the
   * migration runner fast-forwards an older backup"), which needs no code here —
   * only the ordering.
   */
  async function restoreValidated(
    archive: ReadArchive,
    preRestore: string,
    /** Called once the move aside has actually happened — see `restoreFrom`. */
    onMovedAside: () => void,
  ): Promise<void> {
    log(
      `[backup] restoring ${archive.path} (created ${new Date(
        archive.manifest.createdAt,
      ).toISOString()}, meta ${archive.manifest.metaMigrationVersion}, ${String(
        archive.databases.length,
      )} local database(s), order=${archive.order})`,
    );

    await opts.server.stop();

    const aside = await archiveOps.moveAside(opts.dataDir, preRestore);
    onMovedAside();
    log(`[backup] moved ${aside.moved.join(', ') || '(nothing)'} to ${aside.dir}`);

    await archiveOps.unpack(archive, opts.dataDir);

    const ready = await opts.server.start();
    log(`[backup] restore complete; server back up at meta ${ready.metaVersion}`);
  }

  /**
   * §9's auto-backup: "daily at first idle moment after 03:00 via croner",
   * rotating to `autoBackup.keep`.
   *
   * WHY THE SCHEDULE IS HERE AND THE WORK IS NOT. The server owns the archive
   * (§1 principle 2) and it has a croner scheduler of its own — so a reader is
   * right to ask why this is not a server schedule like telemetry's. Two
   * reasons, and the second is decisive:
   *
   *  1. `autoBackup.enabled`/`keep` live in `config.json`, which the main
   *     process owns (§2.3) and the child cannot read. A server-side schedule
   *     would need a whole mirror channel (the `ADMINIUM_DESKTOP_SINGLE_USER`
   *     dance) to learn two numbers.
   *  2. "The first idle moment after 03:00" is a fact about the HUMAN, not about
   *     the process. Only the main process can observe it — `powerMonitor` is an
   *     Electron API, and there is no version of it inside a utilityProcess. A
   *     server-side schedule could implement "03:00" and would have to silently
   *     drop "idle", which is the half that keeps a backup from freezing the
   *     laptop mid-sentence.
   *
   * So: main decides WHEN, the server decides WHAT. Which is exactly the split
   * §2.1 draws — "BackupCoordinator (dialogs + shell reveal; work runs in
   * server)".
   */
  function startAutoBackup(): () => void {
    const schedule = (opts.createSchedule ?? cronSchedule)(AUTO_BACKUP_CRON, () => {
      void runScheduledBackup();
    });
    log(`[backup] auto-backup scheduled (${AUTO_BACKUP_CRON}, local time)`);
    return () => {
      schedule.stop();
    };
  }

  async function runScheduledBackup(): Promise<void> {
    // Read per tick, never captured: the settings panel can turn this off at
    // any moment, and a schedule holding a snapshot of the answer would keep
    // taking backups the user switched off (and rotate to the old `keep`).
    if (!opts.readConfig().autoBackup.enabled) {
      log('[backup] auto-backup is off; skipping this tick');
      return;
    }

    await waitForIdle();

    await exclusive('scheduled backup', async () => {
      // RE-READ after the wait, and re-check `enabled`. The idle wait can last
      // hours (see IDLE_WAIT_MAX_MS), which is long enough for the user to wake
      // up, open Settings and turn auto-backup off — and a tick that decided at
      // 03:00 would then run at 07:00 against an answer the user has since
      // changed. "Per tick" has to mean per DECISION, not per timer fire.
      const config = opts.readConfig();
      if (!config.autoBackup.enabled) {
        log('[backup] auto-backup was turned off while waiting for an idle moment; skipping');
        return;
      }
      try {
        const response = await opts.transport({
          destination: 'auto',
          keep: config.autoBackup.keep,
          config: opts.redactConfig(config),
        });
        if (response === null) {
          // Nobody is signed in. Not an error and NOT a dialog: it is 03:00 and
          // there is no one to tell. The next tick tries again.
          log('[backup] auto-backup skipped: no signed-in session');
          return;
        }
        log(
          `[backup] auto-backup wrote ${response.path} (${String(response.bytes)} bytes)` +
            (response.rotated.length > 0 ? `; rotated out ${response.rotated.join(', ')}` : ''),
        );
      } catch (error) {
        // Logged, never a dialog. An unattended failure at 03:00 must not put a
        // modal in front of a laptop that someone opens at 09:00 — §9 routes
        // completion through the notification centre for exactly this reason,
        // and a failure belongs in the log the crash screen already points at.
        log(`[backup] auto-backup failed: ${messageOf(error)}`);
      }
    });
  }

  /**
   * §9's "first idle moment after 03:00".
   *
   * Polls rather than subscribes because Electron exposes idle as a QUERY
   * (`powerMonitor.getSystemIdleTime()`), not an event — there is no
   * `did-become-idle`. Gives up after {@link IDLE_WAIT_MAX_MS} and backs up
   * anyway: a machine someone is using at 04:00 still deserves a backup, and
   * "wait for idle" is a courtesy, not a precondition. Injected via
   * {@link CreateBackupCoordinatorOptions.idle} so the wait is testable without
   * six hours of wall clock.
   */
  async function waitForIdle(): Promise<void> {
    const idle = opts.idle;
    if (idle === undefined) return;
    // Bounded by POLL COUNT, not by the clock. `now` is injectable, and a
    // deadline compared against an injected clock that does not advance is an
    // infinite loop — the wait would never expire and the schedule would hang
    // forever, silently, having taken no backup. A counter cannot be stopped by
    // a clock that stands still.
    const maxPolls = Math.max(1, Math.ceil(IDLE_WAIT_MAX_MS / IDLE_POLL_MS));
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (await idle.isIdle()) return;
      await idle.wait(IDLE_POLL_MS);
    }
    log('[backup] no idle moment found; backing up anyway');
  }

  async function reportFailure(
    titleKey: BackupLabelKey,
    error: unknown,
    preRestoreDir?: string,
  ): Promise<void> {
    const detail = messageOf(error);
    log(`[backup] ${titleKey}: ${detail}`);
    await opts.dialogs.notify({
      title: t(titleKey),
      message: preRestoreDir === undefined ? detail : `${detail}\n\nYour data is in ${preRestoreDir}`,
      kind: 'error',
    });
  }

  return { backupNow, restoreFrom, startAutoBackup };
}

// ─── Constants + helpers ────────────────────────────────────────────────────

/**
 * §9: "daily at 03:00". LOCAL time, unlike the server's UTC schedules — the
 * whole point of the hour is that the user is asleep, and 03:00 UTC is the
 * middle of the working day in half the world.
 */
export const AUTO_BACKUP_CRON = '0 3 * * *';

/** How long the idle wait holds out before backing up anyway. */
export const IDLE_WAIT_MAX_MS = 4 * 60 * 60 * 1000;
export const IDLE_POLL_MS = 5 * 60 * 1000;
/** §9's "idle": no input for this long. */
export const IDLE_THRESHOLD_SECONDS = 60;

/** `adminium-backup-20260712-1430.zip` — §9's shape, for the save dialog. */
export function defaultBackupName(at: number): string {
  const iso = new Date(at).toISOString();
  return `adminium-backup-${iso.slice(0, 10).replace(/-/g, '')}-${iso
    .slice(11, 16)
    .replace(':', '')}.zip`;
}

/**
 * `<dataDir>/pre-restore-<ts>` (§9).
 *
 * Also stated in `apps/server/src/backup/format.ts`, which is a duplication the
 * import graph forces: the shell may not import the server at RUNTIME (it would
 * load Fastify into the main process to read a string), and this is the process
 * that creates the folder. `backup-format-parity.test.ts` pins the two.
 */
export function preRestoreDirName(at: number): string {
  return `pre-restore-${new Date(at).toISOString().replace(/[:.]/g, '-')}`;
}

/**
 * Move the staged archive onto the user's chosen path.
 *
 * `rename` first, `copy`+`unlink` on EXDEV — because the save dialog's whole
 * purpose is to let the user pick anywhere, and "anywhere" routinely means a USB
 * stick, an external drive, or a network volume. A bare `rename` works in
 * development (staging and Desktop are the same disk) and throws EXDEV the first
 * time a real user saves a backup to the thing they bought to keep backups on.
 *
 * The source is deleted only after the copy resolves, so an interrupted copy
 * leaves the staged archive intact rather than nothing at all.
 */
export const moveFileOnDisk: MoveFile = async (from, to) => {
  try {
    await rename(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }
  await copyFile(from, to);
  await rm(from, { force: true }).catch(() => undefined);
};

function messageOf(error: unknown): string {
  if (error instanceof BackupArchiveError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
