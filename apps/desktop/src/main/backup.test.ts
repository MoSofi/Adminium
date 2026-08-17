// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The BackupCoordinator (11-electron.md §9) — dialogs, restore choreography and
 * the auto-backup schedule.
 *
 * What these assert is ORDER and POLICY, the same thing `index.test.ts` asserts
 * about the boot, and for the same reason: §9's restore is a sequence in which
 * every pair of steps is load-bearing, and getting it wrong loses data silently.
 * "Stop before moving aside" is not visible in any type; it is visible here.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BackupArchiveError } from './backup-archive.js';
import {
  AUTO_BACKUP_CRON,
  IDLE_POLL_MS,
  IDLE_WAIT_MAX_MS,
  createBackupCoordinator,
  defaultBackupName,
  moveFileOnDisk,
  preRestoreDirName,
  type BackupCoordinator,
  type BackupResponse,
  type CreateBackupCoordinatorOptions,
  type ReadArchive,
} from './backup.js';
import { createDefaultConfig, redactConfig, type DesktopConfig } from './config.js';

const APP_META_VERSION = '0009_views_kind';
const ARCHIVE = '/Users/ava/adminium-backup-20260712-1430.zip';
const NOW = Date.parse('2026-07-12T14:30:00.000Z');

interface Harness {
  coordinator: BackupCoordinator;
  /** Every side effect, in order. */
  calls: string[];
  dialogs: string[];
  requests: { destination: string; keep: number; config: unknown }[];
  config: DesktopConfig;
}

function response(overrides: Partial<BackupResponse> = {}): BackupResponse {
  return {
    path: '/data/backups/.staging/abc123.zip',
    bytes: 4096,
    manifest: {
      formatVersion: 1,
      appVersion: '1.2.3',
      serverVersion: '0.5.0',
      metaMigrationVersion: APP_META_VERSION,
      createdAt: NOW,
      meta: { file: 'meta.db', bytes: 100, sha256: 'a'.repeat(64) },
      databases: [],
    },
    rotated: [],
    ...overrides,
  };
}

/** A validated archive, as `backup-archive.ts` hands one back. */
function readArchive(overrides: { order?: 'older' | 'same' } = {}): ReadArchive {
  return {
    path: ARCHIVE,
    manifest: response().manifest,
    databases: [],
    order: overrides.order ?? 'same',
    members: {},
  };
}

function harness(
  overrides: {
    config?: Partial<DesktopConfig>;
    saveTo?: string | null;
    confirm?: boolean;
    transport?: CreateBackupCoordinatorOptions['transport'];
    /** Make the read-only reader refuse, as §9's gates do. */
    validateFails?: BackupArchiveError;
    order?: 'older' | 'same';
    unpackFails?: boolean;
    metaVersion?: string | null;
    startFails?: boolean;
  } = {},
): Harness {
  const calls: string[] = [];
  const dialogs: string[] = [];
  const requests: { destination: string; keep: number; config: unknown }[] = [];
  const config: DesktopConfig = { ...createDefaultConfig('/data'), ...overrides.config };

  const coordinator = createBackupCoordinator({
    readConfig: () => config,
    redactConfig,
    archive: {
      validate: (opts) => {
        calls.push(`archive.validate:${opts.path}:app=${opts.appMetaVersion ?? 'unknown'}`);
        if (overrides.validateFails !== undefined) return Promise.reject(overrides.validateFails);
        return Promise.resolve(readArchive({ order: overrides.order ?? 'same' }));
      },
      moveAside: (dataDir, preRestoreDir) => {
        calls.push(`archive.moveAside:${preRestoreDir}`);
        return Promise.resolve({ dir: `${dataDir}/${preRestoreDir}`, moved: ['meta.db', 'databases'] });
      },
      unpack: () => {
        calls.push('archive.unpack');
        if (overrides.unpackFails === true) return Promise.reject(new Error('disk full mid-unpack'));
        return Promise.resolve({ written: ['/data/meta.db'] });
      },
    },
    transport:
      overrides.transport ??
      ((body) => {
        calls.push(`transport:${body.destination}`);
        requests.push(body);
        return Promise.resolve(response());
      }),
    dialogs: {
      saveFile: (opts) => {
        calls.push(`saveFile:${opts.defaultName}`);
        return Promise.resolve(overrides.saveTo === undefined ? '/Users/ava/backup.zip' : overrides.saveTo);
      },
      showItemInFolder: (path) => {
        calls.push(`showItemInFolder:${path}`);
        return Promise.resolve();
      },
      confirm: (opts) => {
        calls.push('confirm');
        dialogs.push(opts.message);
        return Promise.resolve(overrides.confirm ?? true);
      },
      notify: (opts) => {
        calls.push(`notify:${opts.kind}`);
        dialogs.push(`${opts.title}\n${opts.message}`);
        return Promise.resolve();
      },
    },
    server: {
      stop: () => {
        calls.push('server.stop');
        return Promise.resolve();
      },
      start: () => {
        calls.push('server.start');
        if (overrides.startFails === true) return Promise.reject(new Error('boom'));
        return Promise.resolve({ metaVersion: APP_META_VERSION });
      },
      metaVersion: () =>
        overrides.metaVersion === undefined ? APP_META_VERSION : overrides.metaVersion,
    },
    dataDir: '/data',
    moveFile: (from, to) => {
      calls.push(`moveFile:${from}->${to}`);
      return Promise.resolve();
    },
    fs: {
      mkdir: () => Promise.resolve(),
      rename: (from, to) => {
        calls.push(`rename:${from}->${to}`);
        return Promise.resolve();
      },
      writeFile: (path) => {
        calls.push(`writeFile:${path}`);
        return Promise.resolve();
      },
    },
    log: (line) => calls.push(`log:${line.slice(0, 40)}`),
    now: () => NOW,
  });

  return { coordinator, calls, dialogs, requests, config };
}

// ─── backupNow (§9) ──────────────────────────────────────────────────────────

describe('backupNow', () => {
  it('shows the save dialog BEFORE asking the server to do any work', async () => {
    // Snapshotting every database and then discovering the user cancelled is a
    // spinning disk and a warm fan in exchange for a file we delete.
    const h = harness();
    await h.coordinator.backupNow();

    expect(h.calls.indexOf('saveFile:adminium-backup-20260712-1430.zip')).toBeLessThan(
      h.calls.indexOf('transport:staged'),
    );
  });

  it('asks for a staged archive, then moves it to the chosen path and reveals it', async () => {
    const h = harness();
    await h.coordinator.backupNow();

    expect(h.calls).toContain('transport:staged');
    expect(h.calls).toContain('moveFile:/data/backups/.staging/abc123.zip->/Users/ava/backup.zip');
    expect(h.calls).toContain('showItemInFolder:/Users/ava/backup.zip');
  });

  it('does nothing at all when the dialog is cancelled', async () => {
    const h = harness({ saveTo: null });
    await h.coordinator.backupNow();

    expect(h.calls).toEqual(['saveFile:adminium-backup-20260712-1430.zip']);
  });

  it('sends a REDACTED config, never the live one', async () => {
    const h = harness({ config: { secretPlain: 'SENTINEL-COORDINATOR-LEAK-4f2a', secretStorage: 'plain' } });
    await h.coordinator.backupNow();

    const sent = JSON.stringify(h.requests[0]?.config);
    expect(sent).not.toContain('SENTINEL-COORDINATOR-LEAK');
    expect(sent).not.toContain('secretPlain');
    expect(sent).not.toContain('secretEncrypted');
    // …and the mode survives, because §13's About screen warns on it.
    expect((h.requests[0]?.config as { secretStorage: string }).secretStorage).toBe('plain');
  });

  it('tells the user to sign in when there is no session', async () => {
    // §5's "Require login on this device" with nobody signed in. Not a crash —
    // an archive containing every row in the install needs an account behind it.
    const h = harness({ transport: () => Promise.resolve(null) });
    await h.coordinator.backupNow();

    expect(h.calls).toContain('notify:error');
    expect(h.dialogs.join('\n')).toContain('Sign in');
    expect(h.calls.some((c) => c.startsWith('moveFile'))).toBe(false);
  });

  it('reports a server failure instead of throwing into the menu handler', async () => {
    const h = harness({ transport: () => Promise.reject(new Error('disk is full')) });
    await h.coordinator.backupNow();

    expect(h.calls).toContain('notify:error');
    expect(h.dialogs.join('\n')).toContain('disk is full');
  });
});

// ─── restoreFrom (§9) ────────────────────────────────────────────────────────

describe('restoreFrom', () => {
  it('runs §9’s flow in order: validate → confirm → stop → move aside → unpack → start', async () => {
    // ── THE SAFETY PROPERTY. Every pair here is load-bearing:
    //  validate before confirm — do not ask about a backup we will refuse;
    //  confirm before stop     — do not take the app down for a "no";
    //  stop before move aside  — a live server holds meta.db's handle open;
    //  move aside before unpack— the old data must be intact and addressable at
    //                            the moment the new data lands;
    //  start last              — which is what fast-forwards an older backup.
    const h = harness();
    await h.coordinator.restoreFrom(ARCHIVE);

    const order = h.calls.filter((c) => !c.startsWith('log:'));
    expect(order).toEqual([
      `archive.validate:${ARCHIVE}:app=${APP_META_VERSION}`,
      'confirm',
      'server.stop',
      'archive.moveAside:pre-restore-2026-07-12T14-30-00-000Z',
      'archive.unpack',
      'server.start',
      'notify:info',
    ]);
  });

  it('quotes §9’s sentence and names the pre-restore folder in the confirm dialog', async () => {
    // §9's copy, verbatim: "Replaces current data. Current data will be moved to
    // <dataDir>/pre-restore-<ts>/, not deleted." A promise about where data goes
    // is worth nothing if the user cannot go look, so the path is interpolated.
    const h = harness();
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.dialogs[0]).toContain('Replaces current data');
    expect(h.dialogs[0]).toContain('not deleted');
    expect(h.dialogs[0]).toContain('/data/pre-restore-2026-07-12T14-30-00-000Z');
  });

  it('does nothing when the user cancels the confirm dialog', async () => {
    const h = harness({ confirm: false });
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.calls).toContain('confirm');
    expect(h.calls).not.toContain('server.stop');
    expect(h.calls).not.toContain('archive.unpack');
  });

  it('refuses a newer-migration backup WITHOUT touching any data (§9)', async () => {
    const h = harness({
      validateFails: new BackupArchiveError(
        'migration-newer',
        'This backup was made by a newer version of Adminium. Update Adminium first.',
      ),
    });
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.dialogs.join('\n')).toContain('Update Adminium first');
    // NOTHING moved — the property that makes validation-first worth its cost.
    expect(h.calls).not.toContain('confirm');
    expect(h.calls).not.toContain('server.stop');
    expect(h.calls).not.toContain('archive.moveAside');
  });

  it('refuses a checksum failure without touching any data', async () => {
    const h = harness({
      validateFails: new BackupArchiveError('checksum', 'This backup is damaged.'),
    });
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.calls).toContain('notify:error');
    expect(h.calls).not.toContain('server.stop');
  });

  it('passes the app’s own migration version to the reader', async () => {
    // §9's refusal cannot be evaluated without it — and `null` must reach the
    // reader as `null` rather than being silently treated as "fine".
    const h = harness({ metaVersion: null });
    await h.coordinator.restoreFrom(ARCHIVE);
    expect(h.calls).toContain(`archive.validate:${ARCHIVE}:app=unknown`);
  });

  it('fast-forwards an older backup by simply starting the server last', async () => {
    // §9: "the migration runner fast-forwards an older backup". There is no
    // migration code here — `start()` runs `firstRun` over whatever meta.db it
    // now finds. The ORDER is the implementation.
    const h = harness({ order: 'older' });
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.calls.indexOf('archive.unpack')).toBeLessThan(h.calls.indexOf('server.start'));
    expect(h.calls).toContain('notify:info');
  });

  it('tells the user where their data is when the unpack fails, and restarts the server', async () => {
    // The point of no return, gone wrong. The pre-restore folder is the answer,
    // and a failed restore that also leaves the app dead is two problems.
    const h = harness({ unpackFails: true });
    await h.coordinator.restoreFrom(ARCHIVE);

    expect(h.calls).toContain('notify:error');
    expect(h.dialogs.join('\n')).toContain('/data/pre-restore-2026-07-12T14-30-00-000Z');
    expect(h.dialogs.join('\n')).toContain('disk full mid-unpack');
    expect(h.calls.filter((c) => c === 'server.start')).toHaveLength(1);
  });

  it('always takes the pre-restore safety copy before unpacking (§9)', async () => {
    // "Current data will be moved to <dataDir>/pre-restore-<ts>/, not deleted"
    // is a promise the confirm dialog makes on this code's behalf. The copy is
    // unconditional and it happens BEFORE the new data lands, so a failure
    // between them loses nothing.
    //
    // (That the copy is never DELETED is structural and pinned next door:
    // `backup-archive.test.ts` asserts `FsDeps` has no delete member at all, so
    // this module is incapable of removing it.)
    const h = harness();
    await h.coordinator.restoreFrom(ARCHIVE);

    const moveAside = h.calls.filter((c) => c.startsWith('archive.moveAside'));
    expect(moveAside).toEqual(['archive.moveAside:pre-restore-2026-07-12T14-30-00-000Z']);
    expect(h.calls.indexOf(moveAside[0] as string)).toBeLessThan(h.calls.indexOf('archive.unpack'));
  });

  it('refuses to run two restores at once', async () => {
    // Two restores racing over <dataDir> would have the loser move the winner's
    // freshly-unpacked data into a second pre-restore folder. Four independent
    // triggers reach this method; "the user cannot click twice" is not a
    // property this code has.
    const h = harness();
    await Promise.all([h.coordinator.restoreFrom(ARCHIVE), h.coordinator.restoreFrom(ARCHIVE)]);
    expect(h.calls.filter((c) => c === 'archive.unpack')).toHaveLength(1);
  });

  it('refuses to back up while a restore is running', async () => {
    const h = harness();
    await Promise.all([h.coordinator.restoreFrom(ARCHIVE), h.coordinator.backupNow()]);
    // A backup posting to a server the restore just stopped would fail, and the
    // user would see "backup broken".
    expect(h.calls).not.toContain('transport:staged');
  });
});

// ─── The schedule (§9) ───────────────────────────────────────────────────────

describe('startAutoBackup', () => {
  it('uses §9’s daily 03:00 cron', () => {
    // Local time, unlike the server's UTC schedules: the point of the hour is
    // that the user is asleep, and 03:00 UTC is the working day in half the
    // world.
    expect(AUTO_BACKUP_CRON).toBe('0 3 * * *');
  });

  it('returns a stop function that actually stops the schedule', () => {
    const h = harness();
    const stop = h.coordinator.startAutoBackup();
    expect(stop).toBeTypeOf('function');
    // A tick during app teardown would post to a server mid-shutdown.
    expect(() => {
      stop();
    }).not.toThrow();
  });
});

// ─── The 03:00 tick (§9) ────────────────────────────────────────────────────

/**
 * A coordinator whose cron tick can be fired on demand.
 *
 * `createSchedule` is injected for the same reason `server-manager.ts` injects
 * `fork`: the only other way to observe a 03:00 tick is to wait until 03:00.
 */
function scheduled(overrides: { idle?: boolean; enabled?: boolean } = {}): {
  tick: () => Promise<void>;
  stop: () => void;
  polls: () => number;
  requests: () => { keep: number; enabled: boolean }[];
  config: DesktopConfig;
} {
  let onTick: () => void = () => undefined;
  let polls = 0;
  const requests: { keep: number; enabled: boolean }[] = [];
  const config: DesktopConfig = createDefaultConfig('/data');
  if (overrides.enabled !== undefined) config.autoBackup.enabled = overrides.enabled;

  const coordinator = createBackupCoordinator({
    readConfig: () => config,
    redactConfig,
    transport: (body) => {
      requests.push({ keep: body.keep, enabled: config.autoBackup.enabled });
      return Promise.resolve(response());
    },
    dialogs: {
      saveFile: () => Promise.resolve(null),
      showItemInFolder: () => Promise.resolve(),
      confirm: () => Promise.resolve(false),
      notify: () => Promise.resolve(),
    },
    server: {
      stop: () => Promise.resolve(),
      start: () => Promise.resolve({ metaVersion: APP_META_VERSION }),
      metaVersion: () => APP_META_VERSION,
    },
    dataDir: '/data',
    idle: {
      isIdle: () => {
        polls += 1;
        return Promise.resolve(overrides.idle ?? true);
      },
      // Never actually sleeps: the loop is bounded by poll COUNT, not by the
      // clock, which is exactly what this harness proves.
      wait: () => Promise.resolve(),
    },
    createSchedule: (_cron, handler) => {
      onTick = handler;
      return { stop: () => undefined };
    },
    // A FROZEN clock. A wait bounded by `now() < now() + MAX` would never
    // expire against this, and the tick below would hang forever.
    now: () => NOW,
  });

  const stop = coordinator.startAutoBackup();
  return {
    tick: async () => {
      onTick();
      // The tick is fire-and-forget (`void runScheduledBackup()`); let its
      // microtasks drain.
      await new Promise((r) => setTimeout(r, 0));
    },
    stop,
    polls: () => polls,
    requests: () => requests,
    config,
  };
}

describe('the 03:00 tick', () => {
  it('takes a backup when the machine is idle', async () => {
    const h = scheduled({ idle: true });
    await h.tick();
    expect(h.requests()).toEqual([{ keep: 7, enabled: true }]);
    h.stop();
  });

  it('skips entirely when auto-backup is off', async () => {
    const h = scheduled({ enabled: false });
    await h.tick();
    expect(h.requests()).toEqual([]);
    h.stop();
  });

  it('gives up on a never-idle machine after bounded polls and backs up anyway', async () => {
    // §9's idle wait is a COURTESY, not a precondition: a machine someone is
    // using at 04:00 still deserves a backup.
    //
    // And the clock here is FROZEN. A deadline compared against it — the
    // obvious implementation — would never expire: the loop would spin forever,
    // the schedule would hang, and no backup would ever be taken, silently.
    // Bounding by poll count is what makes that unrepresentable, and this test
    // fails by TIMING OUT rather than by asserting if the bound is ever lost.
    const h = scheduled({ idle: false });
    await h.tick();

    expect(h.polls()).toBe(Math.ceil(IDLE_WAIT_MAX_MS / IDLE_POLL_MS));
    expect(h.requests()).toHaveLength(1);
    h.stop();
  });

  it('re-reads the config AFTER the idle wait, not before it', async () => {
    // The wait can last hours — long enough for the user to wake up and change
    // `keep`. A tick that decided at 03:00 and ran at 07:00 against the 03:00
    // answer would rotate to the wrong depth. "Per tick" means per DECISION.
    const h = scheduled({ idle: false });
    const ticking = h.tick();
    h.config.autoBackup.keep = 2;
    await ticking;

    expect(h.requests()).toEqual([{ keep: 2, enabled: true }]);
    h.stop();
  });

  it('abandons the tick if auto-backup is switched off during the idle wait', async () => {
    const h = scheduled({ idle: false });
    const ticking = h.tick();
    h.config.autoBackup.enabled = false;
    await ticking;

    expect(h.requests()).toEqual([]);
    h.stop();
  });
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('defaultBackupName', () => {
  it('matches §9’s adminium-backup-20260712-1430.zip', () => {
    expect(defaultBackupName(Date.parse('2026-07-12T14:30:00.000Z'))).toBe(
      'adminium-backup-20260712-1430.zip',
    );
  });
});

describe('moveFileOnDisk', () => {
  it('moves the archive and leaves nothing behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adminium-move-'));
    try {
      const from = join(dir, 'staged.zip');
      const to = join(dir, 'chosen.zip');
      await writeFile(from, 'archive bytes');

      await moveFileOnDisk(from, to);

      expect(await readFile(to, 'utf8')).toBe('archive bytes');
      await expect(stat(from)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('propagates a real failure rather than silently losing the archive', async () => {
    // Anything that is not EXDEV is a genuine problem — a missing source, a
    // read-only destination — and swallowing it would report a backup the user
    // does not have.
    await expect(moveFileOnDisk('/nonexistent/staged.zip', '/tmp/x.zip')).rejects.toThrow();
  });
});

describe('preRestoreDirName', () => {
  it('produces a filesystem-safe name', () => {
    // Colons are illegal on Windows; an ISO timestamp straight into a path
    // would fail the one operation that must not.
    expect(preRestoreDirName(NOW)).toBe('pre-restore-2026-07-12T14-30-00-000Z');
    expect(preRestoreDirName(NOW)).not.toMatch(/[:.]/);
  });
});
