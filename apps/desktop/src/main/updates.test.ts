/**
 * The updater (11-electron.md §11), driven through injected ports — no Electron,
 * no electron-updater, no real timers. What these pin is exactly what the module
 * header calls unpinnable by the Playwright suite: the CORRECTNESS rule
 * (`disabled` constructs nothing and touches no network), the per-mode schedule
 * (`notify` checks on launch + daily, `manual` never), and the translation of
 * autoUpdater events into the ONE §4 notification pipeline.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';

import type { DesktopUpdateEvent } from '../preload/api.js';
import {
  canSelfUpdate,
  createUpdateManager,
  LAUNCH_CHECK_GRACE_MS,
  PERIODIC_CHECK_MS,
  RELEASES_URL,
  resolveUpdateMode,
  UPDATE_FEED,
  type CreateUpdateManagerOptions,
  type UpdaterCheckResult,
  type UpdaterEventName,
  type UpdaterPort,
} from './updates.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

interface FakeUpdater {
  updater: UpdaterPort;
  fire: (event: UpdaterEventName, payload: unknown) => void;
  setFeedURL: Mock;
  checkForUpdates: Mock;
  downloadUpdate: Mock;
  quitAndInstall: Mock;
  removeAllListeners: Mock;
}

function fakeUpdater(result: UpdaterCheckResult | null = null): FakeUpdater {
  const listeners = new Map<UpdaterEventName, Array<(payload: unknown) => void>>();
  const setFeedURL = vi.fn();
  const checkForUpdates = vi.fn(() => Promise.resolve(result));
  const downloadUpdate = vi.fn(() => Promise.resolve(['/tmp/Adminium.dmg']));
  const quitAndInstall = vi.fn();
  const removeAllListeners = vi.fn();
  const updater: UpdaterPort = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    fullChangelog: true,
    logger: null,
    setFeedURL,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return updater;
    },
    removeAllListeners(event) {
      removeAllListeners(event);
      return updater;
    },
  };
  return {
    updater,
    fire: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    setFeedURL,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    removeAllListeners,
  };
}

interface Scheduled {
  ms: number;
  fn: () => void;
  cancel: Mock;
}

function fakeScheduler(): {
  scheduler: NonNullable<CreateUpdateManagerOptions['scheduler']>;
  afters: Scheduled[];
  everies: Scheduled[];
} {
  const afters: Scheduled[] = [];
  const everies: Scheduled[] = [];
  return {
    scheduler: {
      after: (ms, fn) => {
        const cancel = vi.fn();
        afters.push({ ms, fn, cancel });
        return cancel;
      },
      every: (ms, fn) => {
        const cancel = vi.fn();
        everies.push({ ms, fn, cancel });
        return cancel;
      },
    },
    afters,
    everies,
  };
}

const available = (version: string, extra: Record<string, unknown> = {}): UpdaterCheckResult => ({
  isUpdateAvailable: true,
  updateInfo: { version, ...extra },
});

// ─── resolveUpdateMode (§11: the env kill-switch) ────────────────────────────

describe('resolveUpdateMode', () => {
  it('passes the config mode through when the env var is unset', () => {
    expect(resolveUpdateMode('notify', {})).toBe('notify');
    expect(resolveUpdateMode('manual', {})).toBe('manual');
    expect(resolveUpdateMode('disabled', {})).toBe('disabled');
  });

  it('forces disabled when ADMINIUM_DISABLE_UPDATES=1, whatever the config says', () => {
    expect(resolveUpdateMode('notify', { ADMINIUM_DISABLE_UPDATES: '1' })).toBe('disabled');
    expect(resolveUpdateMode('manual', { ADMINIUM_DISABLE_UPDATES: '1' })).toBe('disabled');
  });

  it('only "1" disables — a stray "0" is not a fleet admin asking for updates off', () => {
    expect(resolveUpdateMode('notify', { ADMINIUM_DISABLE_UPDATES: '0' })).toBe('notify');
    expect(resolveUpdateMode('notify', { ADMINIUM_DISABLE_UPDATES: 'true' })).toBe('notify');
  });
});

// ─── canSelfUpdate (§11: deb/rpm are notify-only) ────────────────────────────

describe('canSelfUpdate', () => {
  it('is always true on macOS and Windows', () => {
    expect(canSelfUpdate('darwin', {})).toBe(true);
    expect(canSelfUpdate('win32', {})).toBe(true);
  });

  it('is true on Linux only inside an AppImage (APPIMAGE set)', () => {
    expect(canSelfUpdate('linux', { APPIMAGE: '/opt/Adminium.AppImage' })).toBe(true);
    expect(canSelfUpdate('linux', {})).toBe(false);
    expect(canSelfUpdate('linux', { APPIMAGE: '' })).toBe(false);
  });
});

// ─── disabled: the CORRECTNESS rule ──────────────────────────────────────────

describe('disabled mode never initializes the updater', () => {
  it('returns null and NEVER touches the electron-updater autoUpdater', () => {
    const getUpdater = vi.fn<() => UpdaterPort>(() => {
      throw new Error('the updater must not be constructed in disabled mode');
    });
    const emit = vi.fn();
    const { scheduler, afters, everies } = fakeScheduler();

    const manager = createUpdateManager({
      mode: 'disabled',
      getUpdater,
      emit,
      canSelfUpdate: true,
      scheduler,
    });

    expect(manager).toBeNull();
    // The whole acceptance criterion, as a spy: the autoUpdater is never even
    // asked for, so it cannot be constructed and cannot make a request.
    expect(getUpdater).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(afters).toHaveLength(0);
    expect(everies).toHaveLength(0);
  });

  it('is reached from the env kill-switch too (config notify + ADMINIUM_DISABLE_UPDATES=1)', () => {
    const getUpdater = vi.fn<() => UpdaterPort>(() => {
      throw new Error('the updater must not be constructed');
    });
    const manager = createUpdateManager({
      mode: resolveUpdateMode('notify', { ADMINIUM_DISABLE_UPDATES: '1' }),
      getUpdater,
      emit: vi.fn(),
      canSelfUpdate: true,
    });
    expect(manager).toBeNull();
    expect(getUpdater).not.toHaveBeenCalled();
  });
});

// ─── notify vs manual: check timing (§11) ────────────────────────────────────

describe('check scheduling', () => {
  it('notify checks on launch after a 30 s grace and then every 24 h', () => {
    const fake = fakeUpdater(null);
    const { scheduler, afters, everies } = fakeScheduler();

    createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler,
    });

    expect(afters).toHaveLength(1);
    expect(afters[0]?.ms).toBe(LAUNCH_CHECK_GRACE_MS);
    expect(everies).toHaveLength(1);
    expect(everies[0]?.ms).toBe(PERIODIC_CHECK_MS);

    // Nothing has checked yet — the grace has not elapsed.
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    // Firing the launch timer runs a check; the periodic one does too.
    afters[0]?.fn();
    everies[0]?.fn();
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('manual never schedules a check — Help → "Check for updates…" only', () => {
    const fake = fakeUpdater(null);
    const { scheduler, afters, everies } = fakeScheduler();

    const manager = createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler,
    });

    expect(afters).toHaveLength(0);
    expect(everies).toHaveLength(0);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();

    // But an explicit check still works.
    void manager?.checkForUpdates();
    expect(fake.checkForUpdates).toHaveBeenCalledOnce();
  });
});

// ─── updater configuration (§11 verbatim) ────────────────────────────────────

describe('the updater is configured per §11', () => {
  it('disables auto-download / auto-install / prerelease / downgrade and sets the GitHub feed', () => {
    const fake = fakeUpdater(null);
    createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
    });

    expect(fake.updater.autoDownload).toBe(false);
    expect(fake.updater.autoInstallOnAppQuit).toBe(false);
    expect(fake.updater.allowPrerelease).toBe(false);
    expect(fake.updater.allowDowngrade).toBe(false);
    expect(fake.setFeedURL).toHaveBeenCalledWith(UPDATE_FEED);
    expect(UPDATE_FEED).toEqual({ provider: 'github', owner: 'adminium', repo: 'adminium' });
  });
});

// ─── checkForUpdates result mapping (§4) ─────────────────────────────────────

describe('checkForUpdates maps the autoUpdater result to §4', () => {
  const build = (result: UpdaterCheckResult | null): { manager: ReturnType<typeof createUpdateManager> } => {
    const fake = fakeUpdater(result);
    return {
      manager: createUpdateManager({
        mode: 'manual',
        getUpdater: () => fake.updater,
        emit: vi.fn(),
        canSelfUpdate: true,
        scheduler: fakeScheduler().scheduler,
      }),
    };
  };

  it('available', async () => {
    const { manager } = build(available('1.4.0'));
    expect(await manager?.checkForUpdates()).toEqual({ status: 'available', version: '1.4.0' });
  });

  it('none when the feed reports no update', async () => {
    const { manager } = build({ isUpdateAvailable: false, updateInfo: { version: '1.3.0' } });
    expect(await manager?.checkForUpdates()).toEqual({ status: 'none' });
  });

  it('none when the updater is inactive (null result)', async () => {
    const { manager } = build(null);
    expect(await manager?.checkForUpdates()).toEqual({ status: 'none' });
  });

  it('error — and stays silent (no throw) — when the check rejects (offline is normal)', async () => {
    const fake = fakeUpdater(null);
    fake.checkForUpdates.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND github.com'));
    const emit = vi.fn();
    const manager = createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit,
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
    });
    expect(await manager?.checkForUpdates()).toEqual({ status: 'error' });
    // §11: a failed check does not raise a notification.
    expect(emit).not.toHaveBeenCalled();
  });
});

// ─── event translation → the ONE notification pipeline (§4 onUpdateEvent) ─────

describe('autoUpdater events become §4 update events', () => {
  function wired(canSelf = true): { fake: FakeUpdater; emitted: DesktopUpdateEvent[] } {
    const fake = fakeUpdater(null);
    const emitted: DesktopUpdateEvent[] = [];
    createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: (event) => emitted.push(event),
      canSelfUpdate: canSelf,
      scheduler: fakeScheduler().scheduler,
    });
    return { fake, emitted };
  }

  it('update-available → { type: available, version, message: release body }', () => {
    const { fake, emitted } = wired();
    fake.fire('update-available', { version: '1.4.0', releaseNotes: '### Fixes\n- things' });
    expect(emitted).toEqual([
      { type: 'available', version: '1.4.0', message: '### Fixes\n- things' },
    ]);
  });

  it('download-progress → { type: progress, percent } rounded to an integer', () => {
    const { fake, emitted } = wired();
    fake.fire('download-progress', { percent: 42.7 });
    expect(emitted).toEqual([{ type: 'progress', percent: 43 }]);
  });

  it('update-downloaded → { type: downloaded, version }', () => {
    const { fake, emitted } = wired();
    fake.fire('update-downloaded', { version: '1.4.0' });
    expect(emitted).toEqual([{ type: 'downloaded', version: '1.4.0' }]);
  });

  it('a raw autoUpdater error event stays silent — a failed check must not notify (§11)', () => {
    // electron-updater fires `error` for a failed CHECK as much as a failed
    // download; surfacing it here would turn every offline launch into a toast.
    const { fake, emitted } = wired();
    fake.fire('error', new Error('getaddrinfo ENOTFOUND github.com'));
    expect(emitted).toEqual([]);
  });

  it('on a non-self-replacing package the available message points at GitHub', () => {
    const { fake, emitted } = wired(false);
    fake.fire('update-available', { version: '1.4.0', releaseNotes: 'notes' });
    expect(emitted[0]?.type).toBe('available');
    expect(emitted[0]?.message).toContain(RELEASES_URL);
    expect(emitted[0]?.message).toContain('1.4.0');
  });
});

// ─── deb/rpm: no self-replace (§11) ──────────────────────────────────────────

describe('non-self-replacing packages route the download to GitHub', () => {
  it('downloadUpdate rejects with the releases URL and never calls the updater', async () => {
    const fake = fakeUpdater(null);
    const manager = createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: false,
      scheduler: fakeScheduler().scheduler,
    });
    await expect(manager?.downloadUpdate()).rejects.toThrow(RELEASES_URL);
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
  });

  it('quitAndInstall is a no-op (there is nothing to install in place)', () => {
    const fake = fakeUpdater(null);
    const manager = createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: false,
      scheduler: fakeScheduler().scheduler,
    });
    manager?.quitAndInstall();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();
  });
});

// ─── self-replacing: download / install delegate ─────────────────────────────

describe('self-replacing packages delegate download + install', () => {
  it('downloadUpdate and quitAndInstall reach the updater', async () => {
    const fake = fakeUpdater(null);
    const manager = createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
    });
    await manager?.downloadUpdate();
    manager?.quitAndInstall();
    expect(fake.downloadUpdate).toHaveBeenCalledOnce();
    expect(fake.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('a failed download DOES surface — the user started it — as an event and a rejection', async () => {
    const fake = fakeUpdater(null);
    fake.downloadUpdate.mockRejectedValueOnce(new Error('disk full'));
    const emitted: DesktopUpdateEvent[] = [];
    const manager = createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: (event) => emitted.push(event),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
    });
    await expect(manager?.downloadUpdate()).rejects.toThrow('disk full');
    expect(emitted).toEqual([{ type: 'error', message: 'disk full' }]);
  });
});

// ─── dispose ─────────────────────────────────────────────────────────────────

describe('dispose', () => {
  it('cancels both schedules and detaches the autoUpdater listeners', () => {
    const fake = fakeUpdater(null);
    const { scheduler, afters, everies } = fakeScheduler();
    const manager = createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler,
    });

    manager?.dispose();
    expect(afters[0]?.cancel).toHaveBeenCalledOnce();
    expect(everies[0]?.cancel).toHaveBeenCalledOnce();
    expect(fake.removeAllListeners).toHaveBeenCalled();
  });
});
