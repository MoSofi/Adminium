// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The boot sequence, driven through `createDesktopApp`'s injected ports. No
 * Electron here — see the module header of index.ts and the `electron` alias
 * in vitest.config.ts for why that is possible at all.
 *
 * What these assert is ORDER and POLICY, because that is what actually
 * specifies and what a reader of the code cannot otherwise check: the lock
 * before the data directory, the splash before the handshake, the token only
 * when `singleUser`, loopback always. The Electron-facing halves (a real
 * BrowserWindow, a real utilityProcess) are Playwright `_electron` suite.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackupCoordinator } from './backup.js';
import { createDefaultConfig, type DesktopConfig, type UpdateMode } from './config.js';
import {
  projectUrl,
  CLASSIC_ONLY_SETTING,
  appUrl,
  applyConfigPatch,
  createDesktopApp,
  extractFileArgument,
  isElectronMain,
  type BackupWiring,
  type DesktopAppHost,
  type DesktopBootDeps,
  type DesktopBridgeContext,
  type DesktopConfigPort,
} from './index.js';
import type { ProbeResult } from './lan.js';
import type { MenuHandlers, MenuTranslate } from './menu.js';
import { realFolderDeps } from './projects.js';
import type {
  CreateServerManagerOptions,
  ServerExit,
  ServerManager,
  ServerReadyInfo,
  ServerState,
  KeptModels,
} from './server-manager.js';
import type { UpdateManager } from './updates.js';
import type { CrashAction, CrashScreenInfo, DesktopWindows } from './window.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

interface Harness {
  deps: DesktopBootDeps;
  /** Every window call, in order — the boot sequence's observable behaviour. */
  calls: string[];
  crashes: CrashScreenInfo[];
  loaded: string[];
  quit: () => boolean;
  quitCount: () => number;
  fireSecondInstance: (argv: readonly string[]) => void;
  fireActivate: () => void;
  fireWindowAllClosed: () => void;
  /** Electron's `before-quit`; returns whether the app was allowed to close. */
  fireBeforeQuit: () => boolean;
  fireExit: (exit: ServerExit) => void;
  fireCrashAction: (action: CrashAction) => void;
  emitState: (state: ServerState) => void;
  windowExists: { value: boolean };
  /** The context `registerBridge` was handed, or null if it was never called. */
  bridge: () => DesktopBridgeContext | null;
  saved: DesktopConfig[];
  managerOptions: () => CreateServerManagerOptions[];
  stopped: () => number;
  restarted: () => number;
  /** Every `restart()` argument, in order — rebind is only this. */
  restarts: () => { host?: string; port?: number }[];
  /** The coordinator wiring, or null if the boot never built one. */
  backupWiring: () => BackupWiring | null;
  /** The File/Help handlers, or null if the menu was never installed. */
  menuHandlers: () => MenuHandlers | null;
  /** The translator the last `installMenu` was given (`null` if never). */
  menuTranslate: () => MenuTranslate | null;
  /** How many times the menu was (re)installed — one per locale rebuild. */
  installMenuCount: () => number;
  autoBackupRunning: () => boolean;
  /** Every `createUpdateManager` input, in order. */
  updateManagerInputs: () => { mode: UpdateMode }[];
  /** How many times the boot `dispose()`d the updater (quit teardown). */
  updateDisposed: () => number;
}

const READY: ServerReadyInfo = {
  host: '127.0.0.1',
  port: 51234,
  url: 'http://127.0.0.1:51234',
  migrationsApplied: 9,
  metaVersion: '0009_views_kind',
  pid: 4242,
};

function harness(
  overrides: {
    config?: Partial<DesktopConfig>;
    firstRun?: boolean;
    lock?: boolean;
    platform?: NodeJS.Platform;
    start?: () => Promise<ServerReadyInfo>;
    /** Make boot step 2 or 3 throw — the config.ts error classes. */
    load?: () => Promise<{ config: DesktopConfig; firstRun: boolean }>;
    resolveSecret?: () => Promise<{ secret: string; secretStorage: 'safeStorage' | 'plain' }>;
    /** The writability probe. Defaults to a usable directory. */
    ensureDataDir?: (dir: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
    restart?: (changes?: { host?: string; port?: number }) => Promise<ServerReadyInfo>;
    staticRoot?: string;
    /** The collision pre-flight verdict. Defaults to a free port. */
    probe?: ProbeResult;
    /** What File → "Restore from backup…"'s dialog returns. */
    pickedBackup?: string;
    managerState?: ServerState;
    /** The launch argv. */
    argv?: readonly string[];
    /**
     * What `deps.createUpdateManager` returns. `null` models the
     * `disabled`/air-gapped port contract; `undefined` (the default) gives the
     * recording fake below.
     */
    updates?: UpdateManager | null;
    /** The env kill-switch fact carried into the runtime snapshot. */
    updatesDisabledByEnv?: boolean;
  } = {},
): Harness {
  const calls: string[] = [];
  const crashes: CrashScreenInfo[] = [];
  const loaded: string[] = [];
  const saved: DesktopConfig[] = [];
  const managerOptions: CreateServerManagerOptions[] = [];
  const restarts: { host?: string; port?: number }[] = [];
  let quitCount = 0;
  let stopped = 0;
  let restarted = 0;
  const windowExists = { value: false };

  let backupWiring: BackupWiring | null = null;
  let menuHandlers: MenuHandlers | null = null;
  /** The translator the last `installMenu` used, and how many rebuilds ran. */
  let menuTranslate: MenuTranslate | null = null;
  let installMenuCount = 0;

  let secondInstance: (argv: readonly string[]) => void = () => undefined;
  let activate: () => void = () => undefined;
  let windowAllClosed: () => void = () => undefined;
  let beforeQuit: ((event: { preventDefault(): void }) => void) | null = null;
  let exitListener: (exit: ServerExit) => void = () => undefined;
  let stateListener: (state: ServerState) => void = () => undefined;
  let crashActionHandler: ((action: CrashAction) => void) | null = null;
  let bridge: DesktopBridgeContext | null = null;

  const config: DesktopConfig = { ...createDefaultConfig('/data'), ...overrides.config };

  const host: DesktopAppHost = {
    argv: overrides.argv ?? ['/Applications/Adminium.app/Contents/MacOS/Adminium'],
    platform: overrides.platform ?? 'darwin',
    requestSingleInstanceLock: () => {
      calls.push('lock');
      return overrides.lock ?? true;
    },
    onSecondInstance: (h) => {
      secondInstance = h;
    },
    onActivate: (h) => {
      activate = h;
    },
    onWindowAllClosed: (h) => {
      windowAllClosed = h;
    },
    onBeforeQuit: (h) => {
      beforeQuit = h;
    },
    whenReady: () => {
      calls.push('whenReady');
      return Promise.resolve();
    },
    quit: () => {
      quitCount += 1;
      calls.push('quit');
      // Electron re-emits `before-quit` on every `app.quit()`, including the one
      // the hook itself makes. Modelling that is the only way the "does it
      // actually close?" question has an answer here.
      beforeQuit?.({ preventDefault: () => calls.push('quit:prevented') });
    },
    relaunch: () => {
      calls.push('relaunch');
    },
  };

  const configPort: DesktopConfigPort = {
    ensureDataDir:
      overrides.ensureDataDir ??
      ((dir) => {
        calls.push(`config.ensureDataDir:${dir}`);
        return Promise.resolve({ ok: true as const });
      }),
    load:
      overrides.load ??
      (() => {
        calls.push('config.load');
        return Promise.resolve({ config, firstRun: overrides.firstRun ?? false });
      }),
    resolveSecret:
      overrides.resolveSecret ??
      (() => {
        calls.push('config.resolveSecret');
        return Promise.resolve({ secret: 'a'.repeat(32), secretStorage: 'safeStorage' as const });
      }),
    save: (next) => {
      calls.push('config.save');
      saved.push(next);
      return Promise.resolve();
    },
  };

  const windows: DesktopWindows = {
    showBoot: () => {
      calls.push('showBoot');
      windowExists.value = true;
      return Promise.resolve();
    },
    loadApp: (url) => {
      calls.push('loadApp');
      loaded.push(url);
      return Promise.resolve();
    },
    showCrash: (info) => {
      calls.push('showCrash');
      windowExists.value = true;
      crashes.push(info);
      return Promise.resolve();
    },
    focus: () => calls.push('focus'),
    reopen: () => {
      calls.push('reopen');
      return Promise.resolve();
    },
    exists: () => windowExists.value,
    handleFileArgument: (p) => calls.push(`handleFileArgument:${p}`),
    pendingFileArgument: () => null,
    broadcast: () => calls.push('broadcast'),
    setCrashActionHandler: (h) => {
      calls.push('setCrashActionHandler');
      crashActionHandler = h;
    },
  };

  // The coordinator, as a recorder. The boot sequence's job is to BUILD one,
  // wire the menu to it, start its schedule and route a `.zip` argument into it
  // — four wiring facts, each of which was previously absent and none of which a
  // test inside `backup.ts` could ever have noticed.
  let autoBackupRunning = false;
  // The updater, as a recorder. The wiring facts this pins: the boot must BUILD
  // one at step 5 (with the config mode), and `dispose()` it on quit — and the
  // `disabled` port returns `null`, which the boot must tolerate (menu item left
  // off, nothing to dispose).
  const updateManagerInputs: { mode: UpdateMode }[] = [];
  let updateDisposed = 0;
  const fakeUpdateManager: UpdateManager = {
    checkForUpdates: () => {
      calls.push('update.checkForUpdates');
      return Promise.resolve({ status: 'none' as const });
    },
    downloadUpdate: () => Promise.resolve(),
    quitAndInstall: () => undefined,
    dispose: () => {
      calls.push('update.dispose');
      updateDisposed += 1;
    },
  };
  const backupCoordinator: BackupCoordinator = {
    backupNow: () => {
      calls.push('backup.backupNow');
      return Promise.resolve();
    },
    restoreFrom: (path) => {
      calls.push(`backup.restoreFrom:${path}`);
      return Promise.resolve();
    },
    startAutoBackup: () => {
      calls.push('backup.startAutoBackup');
      autoBackupRunning = true;
      return () => {
        calls.push('backup.stopAutoBackup');
        autoBackupRunning = false;
      };
    },
  };

  // The token, as the REAL manager produces it: minted from the factory the
  // shell injects, once per fork — so `start` and `restart` each mint, and
  // `bootToken` reports the live child's.
  //
  // A fake that returned a fixed string here would make every assertion below
  // about the token vacuous: the shell used to mint once and close over the
  // value, and this fake's old `bootToken: 'unused'` could not tell the
  // difference — which is precisely how the same token survived every restart,
  // re-arming a fresh unconsumed guard for a second passwordless session.
  let mintBootToken: () => string = () => {
    throw new Error('the shell never handed ServerManager a createBootToken factory');
  };
  let liveBootToken: string | null = null;
  const fork = <T>(run: () => T): T => {
    liveBootToken = mintBootToken();
    return run();
  };

  const manager: ServerManager = {
    state: overrides.managerState ?? { status: 'ready', ...READY },
    get bootToken() {
      return liveBootToken;
    },
    project: null,
    setPrograms: () => undefined,
    setModels: () => undefined,
    onKeepModel: () => () => undefined,
    busy: () => Promise.resolve(null),
    start: () =>
      fork(
        overrides.start ??
          (() => {
            calls.push('server.start');
            return Promise.resolve(READY);
          }),
      ),
    stop: () => {
      stopped += 1;
      calls.push('server.stop');
      return Promise.resolve();
    },
    restart: (changes) => {
      restarted += 1;
      restarts.push(changes ?? {});
      calls.push('server.restart');
      // The REAL manager emits `ready` on a successful restart, and the
      // subscriber that listens is what navigates the window — so a fake that
      // only resolved would make every "did the window come back?" assertion
      // vacuously pass. The LAN toggle IS that navigation.
      //
      // A restart is a FORK, so it mints too — before `ready` fires, because
      // the subscriber reads `manager.bootToken` to build the URL.
      const done = overrides.restart ?? (() => Promise.resolve(READY));
      return fork(() => done(changes)).then((ready) => {
        stateListener({ status: 'ready', ...ready });
        return ready;
      });
    },
    onExit: (l) => {
      exitListener = l;
      return () => undefined;
    },
    subscribe: (l) => {
      stateListener = l;
      // The real manager replays the current state on subscribe; so does this,
      // because the port-guard that makes the replay harmless is under test.
      l({ status: 'ready', ...READY });
      return () => undefined;
    },
  };

  return {
    deps: {
      host,
      config: configPort,
      windows,
      createServerManager: (opts) => {
        managerOptions.push(opts);
        // The wiring fact this pins: the shell must hand the MINTER to the
        // manager, not a minted token. If it ever goes back to calling
        // `deps.createBootToken()` itself, `mintBootToken` stays unset and every
        // boot in this suite throws rather than quietly re-arming one token.
        mintBootToken = opts.createBootToken;
        return manager;
      },
      createBootToken: () => 'b'.repeat(64),
      probeLanPort: (probeHost, probePort) => {
        calls.push(`probeLanPort:${probeHost}:${String(probePort)}`);
        return Promise.resolve(overrides.probe ?? { ok: true });
      },
      logsDir: '/logs',
      serverEntry: '/app/out/server/index.js',
      staticRoot: overrides.staticRoot ?? '/app/out/dashboard',
      registerBridge: (context) => {
        calls.push('registerBridge');
        bridge = context;
      },
      showLogs: () => {
        calls.push('showLogs');
        return Promise.resolve();
      },
      pickBackupFile: () => {
        calls.push('pickBackupFile');
        return Promise.resolve(overrides.pickedBackup ?? null);
      },
      createBackup: (wiring) => {
        calls.push('createBackup');
        backupWiring = wiring;
        return backupCoordinator;
      },
      installMenu: ({ handlers, t }) => {
        calls.push('installMenu');
        menuHandlers = handlers;
        menuTranslate = t;
        installMenuCount += 1;
      },
      createUpdateManager: (input) => {
        calls.push(`createUpdateManager:${input.mode}`);
        updateManagerInputs.push(input);
        return overrides.updates === undefined ? fakeUpdateManager : overrides.updates;
      },
      updatesDisabledByEnv: overrides.updatesDisabledByEnv ?? false,
    },
    calls,
    crashes,
    loaded,
    saved,
    quit: () => quitCount > 0,
    quitCount: () => quitCount,
    fireSecondInstance: (argv) => secondInstance(argv),
    fireActivate: () => activate(),
    fireWindowAllClosed: () => windowAllClosed(),
    fireBeforeQuit: () => {
      let prevented = false;
      beforeQuit?.({
        preventDefault: () => {
          prevented = true;
        },
      });
      return !prevented;
    },
    fireExit: (e) => exitListener(e),
    fireCrashAction: (action) => crashActionHandler?.(action),
    emitState: (s) => stateListener(s),
    windowExists,
    bridge: () => bridge,
    managerOptions: () => managerOptions,
    stopped: () => stopped,
    restarted: () => restarted,
    restarts: () => restarts,
    backupWiring: () => backupWiring,
    menuHandlers: () => menuHandlers,
    menuTranslate: () => menuTranslate,
    installMenuCount: () => installMenuCount,
    autoBackupRunning: () => autoBackupRunning,
    updateManagerInputs: () => updateManagerInputs,
    updateDisposed: () => updateDisposed,
  };
}

// ─── extractFileArgument ─────────────────────────────────────────────────────

describe('extractFileArgument', () => {
  it('finds a backup zip and a SQLite file among real launch arguments', () => {
    expect(extractFileArgument(['/path/Adminium', '/Users/ava/adminium-backup.zip'])).toBe(
      '/Users/ava/adminium-backup.zip',
    );
    expect(extractFileArgument(['/path/Adminium', '/Users/ava/shop.sqlite3'])).toBe(
      '/Users/ava/shop.sqlite3',
    );
  });

  it('skips Chromium switches, which is the whole reason it is not argv[1]', () => {
    // Exactly the shape a second instance receives on Windows.
    expect(
      extractFileArgument([
        'C:\\Program Files\\Adminium\\Adminium.exe',
        '--allow-file-access-from-files',
        '--original-process-start-time=13360000000000000',
        'C:\\Users\\ava\\backup.zip',
      ]),
    ).toBe('C:\\Users\\ava\\backup.zip');
  });

  it('is null for a plain launch, and never mistakes the executable for a file', () => {
    expect(extractFileArgument(['/Applications/Adminium.app/Contents/MacOS/Adminium'])).toBeNull();
    expect(extractFileArgument([])).toBeNull();
  });

  it('matches extensions case-insensitively', () => {
    expect(extractFileArgument(['/x/Adminium', '/Users/ava/BACKUP.ZIP'])).toBe(
      '/Users/ava/BACKUP.ZIP',
    );
  });
});

// ─── appUrl ──────────────────────────────────────────────────────────────────

describe('appUrl', () => {
  it('carries the boot token for the single-user auto-login', () => {
    expect(appUrl({ host: '127.0.0.1', port: 51234, firstRun: false, bootToken: 'abc' })).toBe(
      'http://127.0.0.1:51234/?bootToken=abc',
    );
  });

  it('omits the token when there is none — the SPA then shows the login', () => {
    expect(appUrl({ host: '127.0.0.1', port: 51234, firstRun: false })).toBe(
      'http://127.0.0.1:51234/',
    );
  });

  it('lands on the wizard on first run, with no token: there is no user to log in as', () => {
    expect(appUrl({ host: '127.0.0.1', port: 4600, firstRun: true, bootToken: 'abc' })).toBe(
      'http://127.0.0.1:4600/desktop/setup',
    );
  });

  it('stays on loopback even when the server bound 0.0.0.0 for LAN share', () => {
    // The boot-token route rejects non-loopback peers unconditionally, so a
    // window addressing itself over the LAN interface would be refused by our
    // own auth route — and would drop a session cookie on a shared origin.
    expect(appUrl({ host: '0.0.0.0', port: 4600, firstRun: false, bootToken: 'abc' })).toBe(
      'http://127.0.0.1:4600/?bootToken=abc',
    );
    expect(appUrl({ host: '::', port: 4600, firstRun: false })).toBe('http://127.0.0.1:4600/');
  });

  it('percent-encodes the token rather than concatenating it', () => {
    expect(appUrl({ host: '127.0.0.1', port: 1, firstRun: false, bootToken: 'a b&c' })).toBe(
      'http://127.0.0.1:1/?bootToken=a+b%26c',
    );
  });
});

// ─── The sequence ────────────────────────────────────────────────────────────

describe('createDesktopApp boot sequence', () => {
  it('runs steps 1-8 in the documented order', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // The lock comes FIRST — before config.load, which is the first thing that
    // touches the data directory. A second instance opening the same SQLite
    // files with a second set of writers is the corruption this prevents.
    expect(h.calls[0]).toBe('lock');
    expect(h.calls).toEqual([
      'lock',
      'whenReady',
      // The bridge, before ANY window exists — see the next test.
      'registerBridge',
      // And the crash-page handler before the config steps, because those can
      // fail and the screen they open has a Quit button on it.
      'setCrashActionHandler',
      'config.load',
      'config.resolveSecret',
      // The coordinator, updater menu, between the config and the fork: all need
      // the dataDir (step 2) and the manager (step 5), the menu needs the
      // coordinator, and its "Check for updates…" item needs the updater — so the
      // updater is built before the menu. Before `showBoot`, so the File menu is
      // real from the first frame rather than appearing once the server answers.
      'createBackup',
      'createUpdateManager:notify',
      'installMenu',
      'backup.startAutoBackup',
      'server.start',
      'showBoot',
      'loadApp',
    ]);
  });

  it('registers the bridge before the first window is ever created', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // THE ordering assertion of this file. The preload reads
    // platform/versions with a blocking `sendSync` at load time and THROWS when
    // no handler answers — Electron then reports "Unable to load preload
    // script", `contextBridge.exposeInMainWorld` never runs, and
    // `window.adminiumDesktop` is undefined for the life of that window. Every
    // affordance dies with it (openFile, chooseDirectory, getRuntimeInfo,
    // setConfig, updates, capabilities, relaunch, showLogs), "Require login on
    // this device" toggle becomes unreachable. Nothing else in the suite can
    // catch this: the handlers are fully unit-tested in isolation, and it is the
    // WIRING that was absent.
    const bridgeAt = h.calls.indexOf('registerBridge');
    expect(bridgeAt).toBeGreaterThanOrEqual(0);
    for (const windowCall of ['showBoot', 'showCrash', 'loadApp', 'reopen'] as const) {
      const at = h.calls.indexOf(windowCall);
      if (at !== -1) expect(bridgeAt).toBeLessThan(at);
    }
  });

  it('registers the bridge even when the config cannot be loaded — the crash page opens a window too', async () => {
    const h = harness({ load: () => Promise.reject(new Error('config.json is not valid JSON')) });
    await createDesktopApp(h.deps).start();

    expect(h.calls.indexOf('registerBridge')).toBeLessThan(h.calls.indexOf('showCrash'));
  });

  it('paints the splash WITHOUT waiting for the handshake (steps 5-6)', async () => {
    let release: (info: ServerReadyInfo) => void = () => undefined;
    const h = harness({ start: () => new Promise<ServerReadyInfo>((r) => (release = r)) });

    const started = createDesktopApp(h.deps).start();
    await vi.waitFor(() => expect(h.calls).toContain('showBoot'));

    // The whole point: the server is still booting and the user already sees the
    // splash. Awaiting `ready` first would leave an empty window for up to 30 s.
    expect(h.calls).toContain('showBoot');
    expect(h.calls).not.toContain('loadApp');

    release(READY);
    await started;
    expect(h.calls).toContain('loadApp');
  });

  it('quits without booting a server when the lock is held', async () => {
    const h = harness({ lock: false });
    await createDesktopApp(h.deps).start();

    expect(h.quit()).toBe(true);
    expect(h.calls).toEqual(['lock', 'quit']);
    // Nothing touched the config or forked a server.
    expect(h.calls).not.toContain('config.load');
    expect(h.calls).not.toContain('server.start');
  });

  it('focuses the window and forwards a file argument on a second launch', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // A `.sqlite` — the wizard's "Open an existing SQLite file", which is the
    // SPA's. (A `.zip` goes to restore instead; see the wiring suite.)
    h.fireSecondInstance(['/path/Adminium', '/Users/ava/app.sqlite']);
    expect(h.calls).toContain('focus');
    expect(h.calls).toContain('handleFileArgument:/Users/ava/app.sqlite');
  });

  it('sends the window to the wizard on first run', async () => {
    const h = harness({ firstRun: true });
    await createDesktopApp(h.deps).start();
    expect(h.loaded).toEqual(['http://127.0.0.1:51234/desktop/setup']);
  });

  it('withholds the token when "Require login on this device" is on', async () => {
    const h = harness({ config: { singleUser: false } });
    await createDesktopApp(h.deps).start();
    // No token: the route is not even registered, so waving one would 403.
    expect(h.loaded).toEqual(['http://127.0.0.1:51234/']);
  });

  it('exposes the secret-storage mode and resolved port for the About screen', async () => {
    const h = harness();
    const app = createDesktopApp(h.deps);
    await app.start();
    expect(app.runtime).toEqual({
      dataDir: '/data',
      firstRun: false,
      secretStorage: 'safeStorage',
      serverPort: 51234,
    });
  });

  it('binds loopback with an ephemeral port unless LAN share is on', async () => {
    const seen: Array<{ host?: string | undefined; port?: number | undefined }> = [];
    const h = harness();
    const spied: DesktopBootDeps = {
      ...h.deps,
      createServerManager: (opts) => {
        seen.push({ host: opts.host, port: opts.port });
        return h.deps.createServerManager(opts);
      },
    };
    await createDesktopApp(spied).start();
    // Both omitted ⇒ the manager's 127.0.0.1 + :0 defaults. The shell must never
    // name 0.0.0.0 on its own.
    expect(seen).toEqual([{ host: undefined, port: undefined }]);

    const lan = harness({ config: { lanShare: { enabled: true, port: 4600 } } });
    await createDesktopApp({
      ...lan.deps,
      createServerManager: (opts) => {
        seen.push({ host: opts.host, port: opts.port });
        return lan.deps.createServerManager(opts);
      },
    }).start();
    expect(seen[1]).toEqual({ host: '0.0.0.0', port: 4600 });
  });

  it('tells the server what answer the user chose (singleUser)', async () => {
    // The seam died on: the shell puts `?bootToken=` in the URL below because
    // singleUser is true, but if the child is never told, `compose.ts`'s mirror
    // does not run, `adminium_settings.desktop.singleUser` keeps the registry
    // default `false`, and the route 403s the token this same boot minted.
    const on = harness({ config: { singleUser: true } });
    await createDesktopApp(on.deps).start();
    expect(on.managerOptions()[0]?.singleUser).toBe(true);
    expect(on.loaded[0]).toContain('bootToken=');

    const off = harness({ config: { singleUser: false } });
    await createDesktopApp(off.deps).start();
    expect(off.managerOptions()[0]?.singleUser).toBe(false);
  });

  it('points the server at the dashboard build, or a packaged app serves no SPA', async () => {
    const h = harness({ staticRoot: '/app/out/dashboard' });
    await createDesktopApp(h.deps).start();
    // Without this the window navigates to a booted, healthy server that 404s
    // its own SPA — a blank window that passes every gate we have. Dev hides it:
    // the server's own candidate list finds apps/dashboard/dist, which exists in
    // a checkout and not in an asar.
    expect(h.managerOptions()[0]?.staticRoot).toBe('/app/out/dashboard');
  });
});

// ─── The bridge context ───────────────────────────────────────────

describe('the bridge context handed to registerBridge', () => {
  it('answers getRuntimeInfo with the live port and secret-storage mode', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    expect(h.bridge()?.runtime()).toEqual({
      dataDir: '/data',
      secretStorage: 'safeStorage',
      serverPort: 51234,
      updatesDisabledByEnv: false,
    });
  });

  it('carries the env update kill-switch into the runtime snapshot', async () => {
    const h = harness({ updatesDisabledByEnv: true });
    await createDesktopApp(h.deps).start();
    expect(h.bridge()?.runtime()).toMatchObject({ updatesDisabledByEnv: true });
  });

  it('reports no runtime before boot step 2, so getRuntimeInfo answers UNAVAILABLE', () => {
    const h = harness();
    // Not started: `registerBridge` has not run, and nothing can have asked.
    // The guard that matters is the one inside the context — assert it via a
    // boot that fails before the runtime exists.
    expect(h.bridge()).toBeNull();
  });

  it('merges and persists a setConfig patch', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    await h.bridge()?.writeConfig({ singleUser: false });

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]?.singleUser).toBe(false);
    // Everything else survives the merge.
    expect(h.saved[0]?.dataDir).toBe('/data');
    // And the live config is the patched one, so the next read agrees with disk.
    expect(h.bridge()?.readConfig().singleUser).toBe(false);
  });
});

// ─── LAN toggle, end to end through the real boot sequence ───────────────────

describe('the LAN share toggle', () => {
  it('REBINDS the child to 0.0.0.0:4600 when the toggle goes on', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    await h.bridge()?.writeConfig({ lanShare: { enabled: true, port: 4600 } });

    // The rebind is the feature. A toggle that wrote the file and left the child
    // on loopback would look identical in the panel and share nothing.
    expect(h.restarts()).toEqual([{ host: '0.0.0.0', port: 4600 }]);
    expect(h.saved.at(-1)?.lanShare).toEqual({ enabled: true, port: 4600 });
  });

  it('returns to loopback + an EPHEMERAL port when the toggle goes off', async () => {
    const h = harness({ config: { lanShare: { enabled: true, port: 4600 } } });
    await createDesktopApp(h.deps).start();

    await h.bridge()?.writeConfig({ lanShare: { enabled: false, port: 4600 } });

    // Port 0, not 4600. `restart()` REMEMBERS its last bind, so a disable that
    // only sent `{ host: '127.0.0.1' }` would leave a loopback server squatting
    // on the LAN port — visibly "off" while still holding the socket the next
    // enable has to probe.
    expect(h.restarts()).toEqual([{ host: '127.0.0.1', port: 0 }]);
    expect(h.saved.at(-1)?.lanShare.enabled).toBe(false);
  });

  it('persists the share state across launches', async () => {
    // The next boot forks from `config.json` — no toggle, no restart, just the
    // bind the file already asked for. This is the whole of "the share state
    // persists across launches"; `binds loopback … unless LAN share is on`
    // above covers the fork itself.
    const h = harness({ config: { lanShare: { enabled: true, port: 4601 } } });
    await createDesktopApp(h.deps).start();

    expect(h.managerOptions()[0]).toMatchObject({ host: '0.0.0.0', port: 4601 });
    expect(h.restarts()).toEqual([]);
  });

  it('refuses a busy port with LAN_PORT_IN_USE + a "Try" suggestion, changing NOTHING', async () => {
    const h = harness({ probe: { ok: false, reason: 'in-use' } });
    await createDesktopApp(h.deps).start();

    await expect(
      h.bridge()?.writeConfig({ lanShare: { enabled: true, port: 4600 } }),
    ).rejects.toThrow(/LAN_PORT_IN_USE: Port 4600 is already in use by another program\. Try 4601\./);

    // "Changing nothing" is the requirement, not a nicety: the toggle needs an
    // INLINE error, and only a failure with no side effects can be rendered by a
    // window that was never navigated away from.
    expect(h.saved).toHaveLength(0);
    expect(h.restarts()).toEqual([]);
    expect(h.bridge()?.readConfig().lanShare.enabled).toBe(false);
  });

  it('does not probe — or restart — when the toggle goes OFF', async () => {
    // Releasing a port cannot collide with anything, and a probe of the port we
    // are about to free would be asking whether we are still holding it.
    let probes = 0;
    const h = harness({ config: { lanShare: { enabled: true, port: 4600 } } });
    await createDesktopApp({
      ...h.deps,
      probeLanPort: (host, port) => {
        probes += 1;
        return h.deps.probeLanPort(host, port);
      },
    }).start();

    await h.bridge()?.writeConfig({ lanShare: { enabled: false, port: 4600 } });

    expect(probes).toBe(0);
  });

  it('leaves the server alone for a patch that does not touch lanShare', async () => {
    // The login toggle, update mode backup schedule all write
    // this same file, and none of them has any business
    // restarting the server.
    const h = harness();
    await createDesktopApp(h.deps).start();

    await h.bridge()?.writeConfig({ singleUser: false });
    await h.bridge()?.writeConfig({ updates: { mode: 'disabled' } });

    expect(h.restarts()).toEqual([]);
  });

  it('does not restart for a port edit while sharing is off', async () => {
    // Nothing is bound to the old port, so there is nothing to rebind; the new
    // number takes effect at the next enable.
    const h = harness();
    await createDesktopApp(h.deps).start();

    await h.bridge()?.writeConfig({ lanShare: { enabled: false, port: 4601 } });

    expect(h.restarts()).toEqual([]);
    expect(h.saved.at(-1)?.lanShare.port).toBe(4601);
  });

  it('reverts the file AND the bind when the rebind itself fails', async () => {
    // Otherwise a settings toggle bricks the app: no server now, and a config
    // that will fail the same way at every future launch.
    let calls = 0;
    const h = harness({
      restart: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('bind failed')) : Promise.resolve(READY);
      },
    });
    await createDesktopApp(h.deps).start();

    await expect(
      h.bridge()?.writeConfig({ lanShare: { enabled: true, port: 4600 } }),
    ).rejects.toThrow('bind failed');

    // Second restart = the revert, back to the bind that worked a moment ago.
    expect(h.restarts()).toEqual([
      { host: '0.0.0.0', port: 4600 },
      { host: '127.0.0.1', port: 0 },
    ]);
    expect(h.saved.at(-1)?.lanShare.enabled).toBe(false);
    expect(h.bridge()?.readConfig().lanShare.enabled).toBe(false);
  });
});

describe('applyConfigPatch', () => {
  const base = createDefaultConfig('/data');

  it('applies exactly the five bridge keys', () => {
    const next = applyConfigPatch(base, {
      singleUser: false,
      lanShare: { enabled: true, port: 4601 },
      updates: { mode: 'disabled' },
      telemetryOptIn: true,
      autoBackup: { enabled: false, keep: 3 },
    });
    expect(next.singleUser).toBe(false);
    expect(next.lanShare).toEqual({ enabled: true, port: 4601 });
    expect(next.updates).toEqual({ mode: 'disabled' });
    expect(next.telemetryOptIn).toBe(true);
    expect(next.autoBackup).toEqual({ enabled: false, keep: 3 });
  });

  it('leaves the secret, dataDir and version untouched — they are not keys', () => {
    const withSecret: DesktopConfig = { ...base, secretPlain: 'shhh', secretStorage: 'plain' };
    // The app's own screens' language and theme, as picked in the dashboard; `null` is the system's language again.
    expect(applyConfigPatch(withSecret, { language: 'de-DE', theme: 'dark' })).toMatchObject({ language: 'de-DE', theme: 'dark', secretPlain: 'shhh' });
    expect(applyConfigPatch({ ...withSecret, language: 'de-DE' }, { language: null }).language).toBeNull();
    const next = applyConfigPatch(withSecret, { telemetryOptIn: true });
    expect(next.secretPlain).toBe('shhh');
    expect(next.dataDir).toBe('/data');
    expect(next.version).toBe(base.version);
  });

  it('treats a present-but-undefined key as "not set", never as a write', () => {
    // `{ ...config, ...patch }` writes `singleUser: undefined` here — a config
    // body that fails its own schema on save, over a flag that decides whether
    // a password is required.
    const next = applyConfigPatch(base, { singleUser: undefined });
    expect(next.singleUser).toBe(base.singleUser);
    expect(next).toEqual(base);
  });
});

// ─── Failure + restart rendering (steps 7 and 9) ─────────────────────────────

describe('createDesktopApp failure handling', () => {
  it('shows the crash screen with the log excerpt when the handshake never lands', async () => {
    const error = Object.assign(new Error('The server did not report readiness within 30s.'), {
      detail: { logPath: '/logs/adminium-server.log', excerpt: ['boom'], exitCode: null },
    });
    const h = harness({ start: () => Promise.reject(error) });
    await createDesktopApp(h.deps).start();

    expect(h.crashes).toEqual([
      {
        reason: 'The server did not report readiness within 30s.',
        logPath: '/logs/adminium-server.log',
        excerpt: ['boom'],
        canRestart: true,
      },
    ]);
    // A failed boot must not navigate anywhere.
    expect(h.calls).not.toContain('loadApp');
  });

  it('stays silent while the manager is restarting, showing the splash', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.calls.length = 0;

    h.fireExit({ code: 0, signal: null, willRestart: true, giveUp: false, logPath: '/logs/s.log' });
    expect(h.calls).toEqual(['showBoot']);
    expect(h.crashes).toHaveLength(0);
  });

  it('offers a restart on a crash, but not once the 3-in-60s cap trips', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.fireExit({ code: 1, signal: null, willRestart: false, giveUp: false, logPath: '/logs/s.log' });
    expect(h.crashes.at(-1)).toEqual({
      reason: 'The Adminium server stopped unexpectedly (exit code 1).',
      logPath: '/logs/s.log',
      canRestart: true,
    });

    h.fireExit({ code: 1, signal: null, willRestart: false, giveUp: true, logPath: '/logs/s.log' });
    expect(h.crashes.at(-1)?.canRestart).toBe(false);
  });

  it('re-navigates to the new port after a restart, and ignores the subscribe replay', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    // `subscribe` replayed `ready` on the SAME port during start(); the guard
    // must have made that a no-op rather than a second navigation.
    expect(h.loaded).toEqual(['http://127.0.0.1:51234/?bootToken=' + 'b'.repeat(64)]);

    // A re-forked child listens on :0 again, so it comes back somewhere else.
    // The window has to follow or it stays pointed at a dead origin.
    h.emitState({ ...READY, status: 'ready', port: 62000, url: 'http://127.0.0.1:62000' });
    expect(h.loaded.at(-1)).toBe('http://127.0.0.1:62000/?bootToken=' + 'b'.repeat(64));
  });

  it.each([
    ['a config.json from a newer build (downgrade)', 'Update Adminium first'],
    ['a damaged config.json', 'config.json is not valid JSON'],
  ])('shows the crash screen when boot step 2 throws on %s', async (_label, message) => {
    // Unguarded these escape `start()` as a floating rejection: `whenReady` has
    // fired but `showBoot` is step 6, so NO window was ever created and
    // 'window-all-closed' can never fire either. The process sits in the dock
    // forever showing nothing — no window, no dialog, no log line.
    const h = harness({ load: () => Promise.reject(new Error(message)) });
    await createDesktopApp(h.deps).start();

    expect(h.crashes).toEqual([{ reason: message, canRestart: false }]);
    expect(h.calls).not.toContain('server.start');
  });

  it('shows the crash screen when the secret cannot be resolved', async () => {
    // The Linux autostart race: gnome-keyring has not started, safeStorage
    // reports no backend, and config.json holds an ENCRYPTED secret. config.ts
    // refuses to mint a replacement (it would orphan every encrypted DSN), so
    // it throws — and the user must see why.
    const reason = 'config.json holds a safeStorage-encrypted ADMINIUM_SECRET, but…';
    const h = harness({ resolveSecret: () => Promise.reject(new Error(reason)) });
    await createDesktopApp(h.deps).start();

    // canRestart: false — re-forking the server does not start a keyring.
    expect(h.crashes).toEqual([{ reason, canRestart: false }]);
  });
});

// ─── The crash page's buttons ────────────────────────────────────────────────

describe('crash-page actions', () => {
  it('installs a handler at all — without one all three buttons are inert', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    expect(h.calls).toContain('setCrashActionHandler');
  });

  it('points Quit at app.quit()', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.fireCrashAction('quit');
    expect(h.quit()).toBe(true);
  });

  it('works on the crash page a FAILED CONFIG opened, which no server ever backed', async () => {
    // The ordering trap: the handler is installed from `start()`, and the config
    // crash returns early from the middle of it. Install it after the
    // ServerManager — the natural place, since `retry` needs one — and this
    // screen gets no handler at all: an app that failed to read its own
    // config.json, showing a Quit button that does nothing.
    const h = harness({ load: () => Promise.reject(new Error('config.json is not valid JSON')) });
    await createDesktopApp(h.deps).start();

    expect(h.crashes).toHaveLength(1);
    h.fireCrashAction('quit');
    expect(h.quit()).toBe(true);
    h.fireCrashAction('logs');
    expect(h.calls).toContain('showLogs');
    // Retry is a no-op rather than a crash: there is no server to restart, and
    // `canRestart: false` means the button is not rendered in the first place.
    expect(() => h.fireCrashAction('retry')).not.toThrow();
  });

  it('points Show logs at the log folder', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.fireCrashAction('logs');
    expect(h.calls).toContain('showLogs');
  });

  it('points Restart server at ServerManager.restart(), through the splash', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.calls.length = 0;

    h.fireCrashAction('retry');
    await vi.waitFor(() => expect(h.restarted()).toBe(1));
    // The splash first: the crash page must not sit there while the server
    // boots. `loadApp` is the `ready` the restart itself produced — the fake
    // emits it exactly where the real manager does.
    expect(h.calls).toEqual(['showBoot', 'server.restart', 'loadApp']);
  });

  it('re-navigates after a retry even when the server comes back on the SAME port', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.loaded.length = 0;

    // The subscribe listener suppresses a `ready` on the port it is already on
    // — a guard that exists to make the replay-on-subscribe harmless. After a
    // retry it would strand the window on the splash forever, so the retry
    // clears the port first. `READY` is the SAME port the boot landed on, which
    // is what makes this the regression test and not a tautology.
    h.fireCrashAction('retry');
    await vi.waitFor(() => expect(h.restarted()).toBe(1));
    expect(h.loaded.at(-1)).toBe('http://127.0.0.1:51234/?bootToken=' + 'b'.repeat(64));
  });

  it('shows the crash screen again when the retry itself fails', async () => {
    const h = harness({ restart: () => Promise.reject(new Error('port 4600 is still in use')) });
    await createDesktopApp(h.deps).start();
    h.crashes.length = 0;

    h.fireCrashAction('retry');
    await vi.waitFor(() => expect(h.crashes).toHaveLength(1));
    expect(h.crashes[0]?.reason).toBe('port 4600 is still in use');
  });
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

describe('the quit path', () => {
  it('stops the server before letting the app close (WAL checkpoint)', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // The first `before-quit` must be cancelled: the child is still alive, and
    // killing it abruptly skips Fastify's onClose hooks — so the pools are not
    // disposed and `wal_checkpoint(TRUNCATE)` never runs, leaving WAL sidecars
    // next to every database on every quit.
    expect(h.fireBeforeQuit()).toBe(false);
    await vi.waitFor(() => expect(h.stopped()).toBe(1));
    // And then it really does quit — a hook that cancels and never re-quits is
    // an app you cannot close.
    expect(h.quit()).toBe(true);
  });

  it('does not cancel the second before-quit, or the app could never exit', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.fireBeforeQuit();
    await vi.waitFor(() => expect(h.stopped()).toBe(1));
    // `app.quit()` re-emits `before-quit`; that pass must fall through.
    expect(h.calls).not.toContain('quit:prevented');
    expect(h.fireBeforeQuit()).toBe(true);
    // Stopping is not attempted twice.
    expect(h.stopped()).toBe(1);
  });

  it('stops the server when the last window closes off macOS', async () => {
    const h = harness({ platform: 'win32' });
    await createDesktopApp(h.deps).start();

    h.fireWindowAllClosed();
    await vi.waitFor(() => expect(h.stopped()).toBe(1));
  });
});

// ─── Lifecycle conventions ───────────────────────────────────────────────────

describe('window lifecycle conventions', () => {
  it('quits with the last window off macOS, and never on it', async () => {
    const mac = harness({ platform: 'darwin' });
    await createDesktopApp(mac.deps).start();
    mac.fireWindowAllClosed();
    expect(mac.quit()).toBe(false);

    const win = harness({ platform: 'win32' });
    await createDesktopApp(win.deps).start();
    win.fireWindowAllClosed();
    expect(win.quit()).toBe(true);
  });

  it('re-creates the window on macOS activate, but only when there is none', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.windowExists.value = true;
    h.fireActivate();
    expect(h.calls).not.toContain('reopen');

    h.windowExists.value = false;
    h.fireActivate();
    expect(h.calls).toContain('reopen');
  });
});

/**
 * The backup/restore, seen from the boot sequence — i.e. the WIRING.
 *
 * These exist because `backup.ts` and `menu.ts` both compiled, unit-tested green
 * and were called by NOTHING: `createBackupCoordinator` threw a scaffold error
 * nobody ever hit, and `buildAppMenu` built a template nobody ever installed, so
 * every launch had no File menu and no way to reach a backup. An
 * injected-dependency test inside those modules structurally cannot catch that —
 * it injects its own deps and never exercises the production path. What can
 * catch it is asserting, from the entry point, that the ports were CALLED.
 */
describe('backup/restore wiring', () => {
  it('builds the coordinator, installs the menu, and starts the auto-backup schedule', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // The three that were absent. If any of these regresses to "never called",
    // the feature is gone from the product and nothing else here would notice.
    expect(h.calls).toContain('createBackup');
    expect(h.calls).toContain('installMenu');
    expect(h.calls).toContain('backup.startAutoBackup');
    expect(h.autoBackupRunning()).toBe(true);
  });

  it('gives the coordinator a LIVE config view, not the boot snapshot', async () => {
    // The scheduler re-reads on every tick precisely so "Automatic backups:
    // off" takes effect tonight rather than next launch. Wiring it to the
    // step-2 snapshot — which is what the rest of the boot uses — would make
    // that toggle, and `keep`, silently inert: the settings panel would write
    // config.json, report success, and change nothing until a relaunch.
    const h = harness();
    await createDesktopApp(h.deps).start();
    expect(h.backupWiring()?.readConfig().autoBackup).toEqual({ enabled: true, keep: 7 });

    await h.bridge()?.writeConfig({ autoBackup: { enabled: false, keep: 3 } });

    expect(h.backupWiring()?.readConfig().autoBackup).toEqual({ enabled: false, keep: 3 });
  });

  it('gives the coordinator the real dataDir, config and server control', async () => {
    const h = harness({ config: { dataDir: '/data/adminium' } });
    await createDesktopApp(h.deps).start();

    const wiring = h.backupWiring();
    expect(wiring).not.toBeNull();
    expect(wiring?.dataDir).toBe('/data/adminium');
    expect(wiring?.readConfig().autoBackup.keep).toBe(7);
    // The refusal rule needs THIS app's migration version, and the
    // handshake is its only source. `null` here would make every
    // restore refuse.
    expect(wiring?.server.metaVersion()).toBe('0009_views_kind');
    expect(wiring?.serverOrigin()).toBe('http://127.0.0.1:51234');
  });

  it('reports no server origin or metaVersion before the handshake', async () => {
    // The honest pre-`ready` answer. `validateArchive` turns a null metaVersion
    // into a refusal rather than a skipped check — see its `appMetaVersion`.
    const h = harness({ managerState: { status: 'starting', attempt: 0 } });
    await createDesktopApp(h.deps).start();

    expect(h.backupWiring()?.serverOrigin()).toBeNull();
    expect(h.backupWiring()?.server.metaVersion()).toBeNull();
  });

  it('wires File → "Back up now…" to the coordinator', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // An unwired command renders DISABLED. A handler that is `undefined`
    // here is a greyed-out menu item, which is exactly what shipped.
    expect(h.menuHandlers()?.backupNow).toBeTypeOf('function');
    h.menuHandlers()?.backupNow?.();
    expect(h.calls).toContain('backup.backupNow');
  });

  it('wires File → "Restore from backup…" through the open dialog', async () => {
    const h = harness({ pickedBackup: '/Users/ava/adminium-backup-20260712-1430.zip' });
    await createDesktopApp(h.deps).start();

    h.menuHandlers()?.restore?.();
    await vi.waitFor(() => {
      expect(h.calls).toContain(
        'backup.restoreFrom:/Users/ava/adminium-backup-20260712-1430.zip',
      );
    });
  });

  it('rebuilds the native menu with localized labels on a locale push', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // Step 5 installs the menu once, in the en-US boot default — no labels have
    // been pushed yet (has no SPA to resolve them).
    const initialInstalls = h.installMenuCount();
    expect(initialInstalls).toBeGreaterThan(0);
    expect(h.menuTranslate()?.('file')).toBe('File');
    expect(h.menuTranslate()?.('help.about')).toBe('About Adminium');

    // The SPA resolved its i18n and pushed a locale (`setMenuLabels` →
    // `ipc.ts` → this bridge port). The menu rebuilds with the same handlers and
    // the pushed labels — this is "menu rebuilds on locale change".
    h.bridge()?.setMenuLabels({
      file: 'Datei',
      'file.newDatabase': 'Neue lokale Datenbank…',
      'file.openSqlite': 'SQLite-Datei öffnen…',
      'file.backupNow': 'Jetzt sichern…',
      'file.restore': 'Aus Sicherung wiederherstellen…',
      edit: 'Bearbeiten',
      view: 'Ansicht',
      window: 'Fenster',
      help: 'Hilfe',
      'help.docs': 'Adminium-Dokumentation',
      'help.shortcuts': 'Tastaturkürzel',
      'help.logs': 'Protokolle anzeigen',
      'help.checkForUpdates': 'Nach Updates suchen…',
      'help.about': 'Über Adminium',
    });

    expect(h.installMenuCount()).toBe(initialInstalls + 1);
    expect(h.menuTranslate()?.('file')).toBe('Datei');
    expect(h.menuTranslate()?.('help.about')).toBe('Über Adminium');
    // The rebuild keeps the File/Help commands wired — a locale change must not
    // silently disable "Back up now…".
    expect(h.menuHandlers()?.backupNow).toBeTypeOf('function');
  });

  it('does not restore when the open dialog is cancelled', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.menuHandlers()?.restore?.();
    await vi.waitFor(() => {
      expect(h.calls).toContain('pickBackupFile');
    });
    expect(h.calls.some((call) => call.startsWith('backup.restoreFrom'))).toBe(false);
  });

  it('routes a.zip launch argument straight into the restore flow', async () => {
    // "also handles a backup zip passed as a launch argument". It never
    // reaches the SPA — the whole restore runs in main — which is why
    // `window.ts`'s `pendingFileArgument` note does not block this half.
    const h = harness({ argv: ['/Applications/Adminium.app', '/Users/ava/backup.zip'] });
    await createDesktopApp(h.deps).start();

    expect(h.calls).toContain('backup.restoreFrom:/Users/ava/backup.zip');
    // And NOT to the SPA: a backup zip is not the wizard's business.
    expect(h.calls).not.toContain('handleFileArgument:/Users/ava/backup.zip');
  });

  it('still hands a .sqlite launch argument to the SPA, not the restore flow', async () => {
    // "Open an existing SQLite file" IS the wizard's, and
    // routing it into a restore would try to unzip a database.
    const h = harness({ argv: ['/Applications/Adminium.app', '/Users/ava/app.sqlite'] });
    await createDesktopApp(h.deps).start();

    expect(h.calls).toContain('handleFileArgument:/Users/ava/app.sqlite');
    expect(h.calls.some((call) => call.startsWith('backup.restoreFrom'))).toBe(false);
  });

  it('routes a .zip from a second instance into the restore flow too', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.fireSecondInstance(['/Applications/Adminium.app', '/Users/ava/second.zip']);
    expect(h.calls).toContain('backup.restoreFrom:/Users/ava/second.zip');
  });

  it('stops the auto-backup schedule on quit, before the server goes down', async () => {
    // A 03:00 tick during teardown would post to a server mid-shutdown, and the
    // manager would classify the resulting exit as a crash on the way out.
    const h = harness();
    await createDesktopApp(h.deps).start();
    expect(h.autoBackupRunning()).toBe(true);

    h.fireBeforeQuit();
    expect(h.autoBackupRunning()).toBe(false);
    expect(h.calls.indexOf('backup.stopAutoBackup')).toBeLessThan(
      h.calls.lastIndexOf('server.stop'),
    );
  });
});

// ─── updater wiring ─────────────────────────────────────────────────

describe('the updater is built at step 5 and wired to the menu + quit', () => {
  it('builds the updater with the config mode, once, after the config load', async () => {
    const h = harness({ config: { updates: { mode: 'notify' } } });
    await createDesktopApp(h.deps).start();

    // THE WIRING FACT: `createUpdateManager` was actually called — the same class
    // of proof the backup coordinator and the menu get, a grep for the call site
    // rather than a passing unit test of a module nobody invokes.
    expect(h.updateManagerInputs()).toEqual([{ mode: 'notify' }]);
    // …and after the coordinator/menu exist, so its "Check for updates" handler
    // has something to reach.
    expect(h.calls.indexOf('createBackup')).toBeLessThan(
      h.calls.indexOf('createUpdateManager:notify'),
    );
    expect(h.calls.indexOf('createUpdateManager:notify')).toBeLessThan(
      h.calls.indexOf('installMenu'),
    );
  });

  it('passes the mode straight through — disabled stays disabled here (the port resolves the env)', async () => {
    const h = harness({ config: { updates: { mode: 'disabled' } }, updates: null });
    await createDesktopApp(h.deps).start();
    expect(h.updateManagerInputs()).toEqual([{ mode: 'disabled' }]);
  });

  it('wires the Help menu "Check for updates…" to the updater when one exists', async () => {
    const h = harness({ config: { updates: { mode: 'manual' } } });
    await createDesktopApp(h.deps).start();

    expect(h.menuHandlers()?.checkForUpdates).toBeTypeOf('function');
    h.menuHandlers()?.checkForUpdates?.();
    expect(h.calls).toContain('update.checkForUpdates');
  });

  it('leaves the menu item unwired when updates are disabled (the port returned null)', async () => {
    const h = harness({ config: { updates: { mode: 'disabled' } }, updates: null });
    await createDesktopApp(h.deps).start();
    // `menu.ts` renders an unwired handler DISABLED, so "off" is a real state,
    // not a dead-but-clickable item.
    expect(h.menuHandlers()?.checkForUpdates).toBeUndefined();
  });

  it('disposes the updater on quit, so its 30 s / 24 h schedules cannot fire into a closing app', async () => {
    const h = harness({ config: { updates: { mode: 'notify' } } });
    await createDesktopApp(h.deps).start();
    expect(h.updateDisposed()).toBe(0);

    h.fireBeforeQuit();
    expect(h.updateDisposed()).toBe(1);
    // Before the server stop, on the same beat as the auto-backup schedule — a
    // check landing mid-teardown would post to a server we are stopping.
    expect(h.calls.indexOf('update.dispose')).toBeLessThan(h.calls.lastIndexOf('server.stop'));
  });

  it('tolerates a disabled updater on quit — nothing to dispose', async () => {
    const h = harness({ config: { updates: { mode: 'disabled' } }, updates: null });
    await createDesktopApp(h.deps).start();
    expect(() => h.fireBeforeQuit()).not.toThrow();
    expect(h.updateDisposed()).toBe(0);
  });
});

describe('isElectronMain', () => {
  it('is false under plain Node, which is what keeps importing this module inert', () => {
    // If this ever returns true in a test runner, the module-scope guard at the
    // bottom of index.ts would boot a real app during the suite.
    expect(isElectronMain()).toBe(false);
  });
});

// ─── a project folder (plan 66, spec 05) ─────────────────────────────────────

describe('createDesktopApp opening a project folder', () => {
  const ROOT = '/Users/someone/Adminium/juniper';
  const PROJECT_READY = { ...READY, port: 4700, url: 'http://127.0.0.1:4700' };

  function projectHarness(over: { busy?: { kind: string; sessionId: string | null } | null; confirm?: boolean; startFails?: Error; restartFails?: Error; ownerHasPassword?: boolean | null; keptPortFree?: boolean; exportTo?: string } = {}) {
    const h = harness();
    const opts: CreateServerManagerOptions[] = [];
    const shown: Array<{ url: string; preview: boolean }> = [];
    const sessions: Array<string | null> = [];
    const confirmed: string[] = [];
    const restarts: Array<{ host?: string; port?: number; mode?: 'design' | 'serve' }> = [];
    const awake: boolean[] = [];
    const savedAs: Array<{ title: string; defaultName: string }> = [];
    const revealed: string[] = [];
    let sharedShown = 0;
    /** The words each question was asked with: the page's, or none yet. */
    const said: Array<string | null> = [];
    /** What the running server was told of the app's programs. */
    const told: string[] = [];
    /** The keys it was told, each time; and the way a saved model comes up from it. */
    const modelsTold: KeptModels[] = [];
    let keepModel: (values: Partial<Record<string, string | null>>) => void = () => undefined;
    /** Whether the last look found a git: the test's to change. */
    const git = { found: false, looks: 0, fetched: 0 };
    let stops = 0;
    let stateListener: (s: ServerState) => void = () => undefined;
    let exitListener: (e: ServerExit) => void = () => undefined;
    let mode: 'design' | 'serve' = 'design';
    let managerState: ServerState = { status: 'ready', ...PROJECT_READY };
    const manager: ServerManager = {
      get state() {
        return managerState;
      },
      bootToken: 'c'.repeat(64),
      get project() {
        return { root: ROOT, mode };
      },
      setPrograms: (value) => void told.push(value),
      setModels: (models) => void modelsTold.push(models),
      onKeepModel: (listener) => {
        keepModel = listener;
        return () => undefined;
      },
      busy: () => Promise.resolve(over.busy ?? null),
      start: () => (over.startFails === undefined ? Promise.resolve(PROJECT_READY) : Promise.reject(over.startFails)),
      stop: () => {
        stops += 1;
        h.calls.push('server.stop');
        return Promise.resolve();
      },
      restart: async (changes) => {
        restarts.push(changes ?? {});
        if (over.restartFails !== undefined && changes?.mode === 'serve') throw over.restartFails;
        if (changes?.mode !== undefined) mode = changes.mode;
        // The port is asked for as a real fork asks: by the mode it is about to start in.
        const port = changes?.mode === undefined ? 4701 : await (opts[0]?.project?.pickPort(changes.mode) ?? Promise.resolve(4701));
        const next = { ...PROJECT_READY, port, url: `http://127.0.0.1:${String(port)}` };
        managerState = { status: 'ready', ...next };
        stateListener({ status: 'ready', ...next });
        return next;
      },
      onExit: (l) => {
        exitListener = l;
        return () => undefined;
      },
      subscribe: (l) => {
        stateListener = l;
        l({ status: 'ready', ...PROJECT_READY });
        return () => undefined;
      },
    };
    const deps: DesktopBootDeps = {
      ...h.deps,
      windows: {
        ...h.deps.windows,
        loadApp: (url, o) => {
          shown.push({ url, preview: o?.preview === true });
          return Promise.resolve();
        },
        useProjectSession: (root) => void sessions.push(root),
        showShared: () => {
          sharedShown += 1;
          return Promise.resolve();
        },
      },
      createServerManager: (o) => {
        opts.push(o);
        return manager;
      },
      openProject: { root: ROOT },
      pickProjectPort: () => Promise.resolve(4700),
      bundledAppsDir: '/app/apps-bundle',
      projectEnv: { PATH: '/usr/bin:/bin', ADMINIUM_SECRET: 'from the shell' },
      // Looked up before the fork, and it may take a moment (git is looked for): the boot waits for it.
      projectPrograms: () => {
        git.looks += 1;
        return Promise.resolve(git.found ? '{"binary":"/app/Adminium","git":"/data/git/bin/git"}' : '{"binary":"/app/Adminium"}');
      },
      projectGit: {
        found: () => git.found,
        bytes: 62_348_987,
        platform: 'darwin',
        fetch: () => {
          git.fetched += 1;
          git.found = true;
          return Promise.resolve('/data/git/bin/git');
        },
      },
      exporting: {
        saveAs: (o) => {
          savedAs.push(o);
          return Promise.resolve(over.exportTo === undefined ? null : over.exportTo);
        },
        showInFolder: (path) => {
          revealed.push(path);
          return Promise.resolve();
        },
        stamp: () => ({ system: 'darwin', chip: 'arm64', engine: '0.3.22' }),
      },
      sharing: { hostname: () => 'Office-Mac.local', isFree: () => Promise.resolve(over.keptPortFree ?? true), keepAwake: (on) => void awake.push(on) },
      startScreen: {
        folder: { home: '/Users/someone', platform: 'darwin', exists: () => true, list: () => [], isInsideApp: () => false, real: (path: string) => path } as never,
        chooseDirectory: () => Promise.resolve(null),
        classicUsed: () => false,
        folderFacts: () => Promise.resolve({ ownerHasPassword: over.ownerHasPassword === undefined ? true : over.ownerHasPassword } as never),
      },
      confirmStopBusy: (busy, why, words) => {
        confirmed.push(why === 'share' ? `share:${busy.kind}` : busy.kind);
        said.push(words?.keepWorking ?? null);
        return Promise.resolve(over.confirm ?? true);
      },
    };
    return { h, deps, opts, shown, sessions, confirmed, restarts, awake, savedAs, revealed, sharedShown: () => sharedShown, said, told, modelsTold, saveModel: (values: Partial<Record<string, string | null>>) => keepModel(values), git, stops: () => stops, manager, fireExit: (e: ServerExit) => exitListener(e), emit: (state: ServerState) => stateListener(state) };
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it('serves the folder, not the classic workspace: no secret, no backup, no schedule', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();

    expect(p.opts).toHaveLength(1);
    expect(p.opts[0]).toMatchObject({ project: { root: ROOT, mode: 'design', bundledAppsDir: '/app/apps-bundle', programs: '{"binary":"/app/Adminium"}' }, staticRoot: '/app/out/dashboard' });
    for (const name of ['dataDir', 'secret', 'singleUser', 'host', 'port']) expect(p.opts[0]).not.toHaveProperty(name);
    // The person's environment, as a terminal's server has it (the manager strips what main decides).
    expect(p.opts[0]?.inheritEnv).toEqual({ PATH: '/usr/bin:/bin', ADMINIUM_SECRET: 'from the shell' });
    // Resolving the classic secret may write to the key store; a project has its own in its .env.
    expect(p.h.calls).not.toContain('config.resolveSecret');
    expect(p.h.calls).not.toContain('createBackup');
    expect(p.h.autoBackupRunning()).toBe(false);
    expect(p.h.backupWiring()).toBeNull();
    // The menu's two backup entries have no handler, which is how the menu disables them.
    expect(p.h.menuHandlers()).not.toHaveProperty('backupNow');
    expect(p.h.menuHandlers()).not.toHaveProperty('restore');
    expect(p.h.menuHandlers()?.showLogs).toBeTypeOf('function');
  });

  it('offers to keep versions when no git was found, and a download tells the running server without a restart', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();
    const offer = p.h.bridge()?.project?.versions?.() ?? null;
    expect(offer?.state()).toEqual({ on: false, declined: false, megabytes: 62, appleTools: true, download: { phase: 'idle' } });

    // "Not now" is kept for this computer, in the app's own file.
    expect((await offer?.notNow())?.declined).toBe(true);
    expect(p.h.bridge()?.readConfig().versionsDeclined).toBe(true);

    expect(offer?.download().download).toEqual({ phase: 'downloading', received: 0, total: 62_348_987 });
    await settle();
    expect(p.git.fetched).toBe(1);
    // Looked for again (the stand-ins are made again), and the server that is running was told.
    expect(p.told).toEqual(['{"binary":"/app/Adminium","git":"/data/git/bin/git"}']);
    expect(offer?.state()).toMatchObject({ on: true, declined: false, download: { phase: 'idle' } });
    expect(p.h.bridge()?.readConfig().versionsDeclined).toBe(false);
  });

  it('tells the project’s server the keys the app keeps, and keeps what its model screen saves', async () => {
    const p = projectHarness();
    let kept: KeptModels = { values: { ADMINIUM_AI_MODEL: 'ollama/llama3' }, keeping: 'key-store' };
    const keep = vi.fn((patch: Partial<Record<string, string | null>>) => {
      const values = { ...kept.values } as Record<string, string>;
      for (const [name, value] of Object.entries(patch)) {
        if (value === null) Reflect.deleteProperty(values, name);
        else if (value !== undefined) values[name] = value;
      }
      kept = { ...kept, values };
      return kept;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createDesktopApp({ ...p.deps, models: { read: () => kept, keep } }).start();
    expect(p.modelsTold).toEqual([{ values: { ADMINIUM_AI_MODEL: 'ollama/llama3' }, keeping: 'key-store' }]);
    // Never part of what the server was started with.
    expect(JSON.stringify(p.opts[0])).not.toContain('ollama/llama3');

    p.saveModel({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(keep).toHaveBeenCalledWith({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(p.modelsTold.at(-1)).toEqual({ values: { ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_MODEL: 'anthropic/claude' }, keeping: 'key-store' });
    // A store that cannot write is a line in the log, not a crash of the app.
    keep.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    expect(() => p.saveModel({ ADMINIUM_AI_MODEL: 'x' })).not.toThrow();
    expect(p.modelsTold).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    error.mockRestore();
  });

  describe('"Export this project…"', () => {
    let scratch: string;
    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'adminium-export-boot-'));
    });
    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });
    const exportOf = (p: ReturnType<typeof projectHarness>) => p.h.bridge()?.project?.exporting?.() ?? null;

    it('asks where to save first, and a cancel stops nothing', async () => {
      const p = projectHarness();
      await createDesktopApp(p.deps).start();
      await expect(exportOf(p)?.run({ kind: 'apps', title: 'Export Juniper' })).resolves.toEqual({ status: 'cancelled' });
      expect(p.savedAs).toEqual([{ title: 'Export Juniper', defaultName: 'juniper.zip' }]);
      expect(p.stops()).toBe(0);
      expect(exportOf(p)?.takeResult()).toBeNull();
    });

    it('never exports under a turn: the files would be caught half-written', async () => {
      const p = projectHarness({ busy: { kind: 'turn', sessionId: 'ds_1' }, exportTo: '/tmp/x.zip' });
      await createDesktopApp(p.deps).start();
      await expect(exportOf(p)?.run({ kind: 'everything', title: 't' })).resolves.toEqual({ status: 'busy' });
      expect(p.savedAs).toEqual([]);
      expect(p.stops()).toBe(0);
    });

    it('stops the project for the file, starts it again as it was, and says how it went once to the page that comes back', async () => {
      // The harness's folder does not exist: the ZIP cannot be made, and the project still comes back.
      const p = projectHarness({ exportTo: join(scratch, 'juniper.zip') });
      await createDesktopApp(p.deps).start();
      const exporting = exportOf(p);
      const result = await exporting?.run({ kind: 'everything', title: 't' });
      expect(result?.status).toBe('failed');
      expect(p.stops()).toBe(1);
      expect(p.restarts).toEqual([{ mode: 'design', host: '127.0.0.1' }]);
      // Pointed at the project's page again, though the port may be the one it had.
      expect(p.shown).toHaveLength(2);
      expect(exporting?.takeResult()).toMatchObject({ status: 'failed' });
      expect(exporting?.takeResult()).toBeNull();
      await exporting?.show();
      expect(p.revealed).toEqual([]);
    });
  });

  describe('Build and Share', () => {
    const shareOf = (p: ReturnType<typeof projectHarness>) => p.h.bridge()?.project?.sharing?.() ?? null;

    it('Share serves the project on the network with the Designer off, keeps its port, and shows the addresses', async () => {
      const p = projectHarness();
      await createDesktopApp(p.deps).start();
      const sharing = shareOf(p);
      expect(sharing?.info()).toBeNull();
      await expect(sharing?.share()).resolves.toEqual({ status: 'shared' });
      expect(p.restarts).toEqual([{ mode: 'serve', host: '0.0.0.0' }]);
      // The window holds the app's own page, not the project's (its Designer is off).
      expect(p.sharedShown()).toBe(1);
      expect(p.shown).toHaveLength(1);
      expect(p.awake).toEqual([true]);
      expect(sharing?.info()).toMatchObject({ name: 'Juniper', port: 4700, changedFrom: null, language: null, theme: 'system' });
      expect(p.h.bridge()?.project?.info()).toMatchObject({ mode: 'serve' });
      // A second "Share" while shared changes nothing.
      await expect(sharing?.share()).resolves.toEqual({ status: 'shared' });
      expect(p.restarts).toHaveLength(1);
    });

    it('never shares a project whose owner has no password: other devices could not sign in', async () => {
      const p = projectHarness({ ownerHasPassword: false });
      await createDesktopApp(p.deps).start();
      await expect(shareOf(p)?.share()).resolves.toEqual({ status: 'needs-password' });
      expect(p.restarts).toEqual([]);
      expect(p.awake).toEqual([]);
    });

    it('asks before it stops a turn to share, in its own words, and "keep working" shares nothing', async () => {
      const p = projectHarness({ busy: { kind: 'turn', sessionId: 'ds_1' }, confirm: false });
      await createDesktopApp(p.deps).start();
      await expect(shareOf(p)?.share()).resolves.toEqual({ status: 'kept-working' });
      expect(p.confirmed).toEqual(['share:turn']);
      expect(p.restarts).toEqual([]);
    });

    it('a share that cannot start goes back to building on this computer only, and says why', async () => {
      const p = projectHarness({ restartFails: new Error('EADDRINUSE') });
      await createDesktopApp(p.deps).start();
      await expect(shareOf(p)?.share()).resolves.toEqual({ status: 'failed', detail: 'EADDRINUSE' });
      expect(p.restarts).toEqual([{ mode: 'serve', host: '0.0.0.0' }, { mode: 'design', host: '127.0.0.1' }]);
      expect(p.awake).toEqual([]);
      expect(shareOf(p)?.info()).toBeNull();
    });

    it('"Go back to building" is this computer only again, lets it sleep, and opens the Designer', async () => {
      const p = projectHarness();
      await createDesktopApp(p.deps).start();
      const sharing = shareOf(p);
      // Building already: nothing to do.
      await expect(sharing?.build()).resolves.toBe(true);
      expect(p.restarts).toEqual([]);
      await sharing?.share();
      await expect(sharing?.build()).resolves.toBe(true);
      expect(p.restarts.at(-1)).toEqual({ mode: 'design', host: '127.0.0.1' });
      expect(p.awake).toEqual([true, false]);
      expect(p.shown.at(-1)).toMatchObject({ preview: true });
      expect(sharing?.info()).toBeNull();
    });

    it('from the addresses: the project’s dashboard, in the window, and back to the addresses', async () => {
      const p = projectHarness();
      await createDesktopApp(p.deps).start();
      const sharing = shareOf(p);
      // Not shared: neither does anything.
      await sharing?.openDashboard();
      await sharing?.showShared();
      expect(p.shown).toHaveLength(1);
      expect(p.sharedShown()).toBe(0);
      await sharing?.share();
      await sharing?.openDashboard();
      expect(p.shown.at(-1)).toEqual({ url: 'http://127.0.0.1:4700/', preview: false });
      await sharing?.showShared();
      expect(p.sharedShown()).toBe(2);
    });

    it('a build that cannot share has no sharing to offer', async () => {
      const p = projectHarness();
      Reflect.deleteProperty(p.deps, 'sharing');
      await createDesktopApp(p.deps).start();
      expect(shareOf(p)).toBeNull();
    });
  });

  it('opens the Designer with the one-use token after #, on a cookie jar of the project’s own, the preview allowed', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();
    expect(p.sessions).toEqual([ROOT]);
    expect(p.shown).toEqual([{ url: `http://127.0.0.1:4700/design#designToken=${'c'.repeat(64)}`, preview: true }]);
    expect(p.h.bridge()?.runtime()).toMatchObject({ dataDir: ROOT, serverPort: 4700, secretStorage: 'plain' });
  });

  it('refuses the classic workspace’s network switch and data folder while the project is open', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();
    const bridge = p.h.bridge();
    await expect(bridge?.writeConfig({ lanShare: { enabled: true, port: 4600 } })).rejects.toThrow(CLASSIC_ONLY_SETTING);
    await expect(bridge?.setDataDir({ dir: '/elsewhere' })).rejects.toThrow(CLASSIC_ONLY_SETTING);
    expect(p.h.restarted()).toBe(0);
    // A setting that is the app's own still saves.
    await expect(bridge?.writeConfig({ telemetryOptIn: false })).resolves.toBeUndefined();
  });

  it('quits at once when nothing is running', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();
    expect(p.h.fireBeforeQuit()).toBe(false);
    await settle();
    expect(p.confirmed).toEqual([]);
    expect(p.stops()).toBe(1);
    expect(p.h.quit()).toBe(true);
  });

  it('asks before it ends a turn, and “keep working” leaves the app whole', async () => {
    const p = projectHarness({ busy: { kind: 'turn', sessionId: 'ds_1' }, confirm: false });
    await createDesktopApp(p.deps).start();
    expect(p.h.fireBeforeQuit()).toBe(false);
    await settle();
    expect(p.confirmed).toEqual(['turn']);
    expect(p.stops()).toBe(0);
    expect(p.h.quit()).toBe(false);
    expect(p.h.updateDisposed()).toBe(0);
    // Asked in English until the project's page hands over its own language's words, then in those.
    expect(p.said).toEqual([null]);
    p.h.bridge()?.project?.setStopWords?.({ turn: 't', start: 's', save: 'v', restore: 'r', style: 'y', other: 'o', quitDetail: 'q', closeDetail: 'c', quitAnyway: 'qa', closeAnyway: 'ca', keepWorking: 'Weiterarbeiten', shareDetail: 'sd', shareAnyway: 'sa' });
    // Asked again the next time, not remembered as a no.
    p.h.fireBeforeQuit();
    await settle();
    expect(p.confirmed).toEqual(['turn', 'turn']);
    expect(p.said).toEqual([null, 'Weiterarbeiten']);
  });

  it('and on a yes stops the server first, then quits', async () => {
    const p = projectHarness({ busy: { kind: 'turn', sessionId: 'ds_1' }, confirm: true });
    await createDesktopApp(p.deps).start();
    p.h.fireBeforeQuit();
    await settle();
    expect(p.stops()).toBe(1);
    expect(p.h.quit()).toBe(true);
    // The second pass, our own quit, goes through.
    expect(p.h.fireBeforeQuit()).toBe(true);
  });

  it('a start that fails shows the server’s own words, with a way to try again', async () => {
    const p = projectHarness({ startFails: new Error('The Adminium server failed to start (project): This project is already running (in a terminal), on port 4711.') });
    await createDesktopApp(p.deps).start();
    expect(p.shown).toEqual([]);
    expect(p.h.crashes.at(-1)?.reason).toContain('already running (in a terminal), on port 4711');
  });

  it('a project that stops is not restarted: the crash page’s button is the way on, and it follows the new port', async () => {
    const p = projectHarness();
    await createDesktopApp(p.deps).start();
    p.fireExit({ code: 1, signal: null, willRestart: false, giveUp: true, logPath: '/logs/server.log' });
    await settle();
    expect(p.h.crashes.at(-1)).toMatchObject({ reason: 'This project stopped unexpectedly (exit code 1).', canRestart: true });
    p.h.fireCrashAction('retry');
    await settle();
    expect(p.shown.at(-1)).toEqual({ url: `http://127.0.0.1:4701/design#designToken=${'c'.repeat(64)}`, preview: true });
    expect(p.h.bridge()?.runtime()).toMatchObject({ serverPort: 4701 });
  });

  it('a build with none of the optional folders and no updater still opens the project', async () => {
    const p = projectHarness();
    const bare: DesktopBootDeps = { ...p.deps, createUpdateManager: () => null };
    for (const name of ['staticRoot', 'bundledAddOnsDir', 'bundledAppsDir', 'projectEnv', 'projectPrograms'] as const) Reflect.deleteProperty(bare, name);
    await createDesktopApp(bare).start();
    expect(p.opts[0]).not.toHaveProperty('staticRoot');
    expect(p.opts[0]).not.toHaveProperty('inheritEnv');
    expect(p.opts[0]?.project).toEqual({ root: ROOT, mode: 'design', pickPort: expect.any(Function) as unknown });
    expect(p.h.menuHandlers()).not.toHaveProperty('checkForUpdates');
    expect(p.shown).toHaveLength(1);

    // A stop with no exit code (a signal) has its own words.
    p.fireExit({ code: null, signal: 'SIGKILL', willRestart: false, giveUp: true, logPath: '/logs/server.log' });
    await settle();
    expect(p.h.crashes.at(-1)?.reason).toBe('This project stopped unexpectedly.');
    // A state that is not "ready" moves nothing.
    p.emit({ status: 'starting', attempt: 0 });
    expect(p.shown).toHaveLength(1);
  });

  it('a build that cannot pick a port says so instead of forking', async () => {
    const p = projectHarness();
    await createDesktopApp({ ...p.deps, pickProjectPort: undefined }).start();
    expect(p.opts).toHaveLength(0);
    expect(p.h.crashes.at(-1)?.reason).toBe('This build cannot open a project folder.');
  });
});

describe('projectUrl', () => {
  it('is the Designer with its token after #, or the front door when shared', () => {
    expect(projectUrl({ port: 4700, mode: 'design', token: 'ab' })).toBe('http://127.0.0.1:4700/design#designToken=ab');
    expect(projectUrl({ port: 4700, mode: 'design', token: null })).toBe('http://127.0.0.1:4700/design');
    expect(projectUrl({ port: 4712, mode: 'serve', token: 'ab' })).toBe('http://127.0.0.1:4712/');
    // "Open dashboard" on Start: the same one-use token, taken on the dashboard's front door.
    expect(projectUrl({ port: 4700, mode: 'design', token: 'ab', land: 'dashboard' })).toBe('http://127.0.0.1:4700/#designToken=ab');
    expect(projectUrl({ port: 4700, mode: 'design', token: null, land: 'dashboard' })).toBe('http://127.0.0.1:4700/');
  });
});

// ─── the first screens ───────────────────────────────────────────────────────

describe('createDesktopApp opening on Start', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  function startHarness(over: { classicUsed?: boolean; pendingFile?: string | null; firstRun?: boolean } = {}) {
    const h = harness({ firstRun: over.firstRun ?? false });
    const sessions: Array<string | null> = [];
    const projectOptions: CreateServerManagerOptions[] = [];
    const deps: DesktopBootDeps = {
      ...h.deps,
      windows: {
        ...h.deps.windows,
        showStart: () => {
          h.calls.push('showStart');
          return Promise.resolve();
        },
        pendingFileArgument: () => over.pendingFile ?? null,
        useProjectSession: (root) => void sessions.push(root),
      },
      createServerManager: (o) => {
        if (o.project !== undefined) projectOptions.push(o);
        return h.deps.createServerManager(o);
      },
      pickProjectPort: () => Promise.resolve(4700),
      startScreen: {
        folder: { home: '/home/ava', appDir: '/opt/Adminium', platform: 'linux', exists: () => false, real: (path) => path, list: () => null },
        chooseDirectory: () => Promise.resolve(null),
        classicUsed: () => over.classicUsed ?? false,
      },
    };
    return { h, deps, sessions, projectOptions };
  }

  it('shows Start and starts nothing until the person chooses', async () => {
    const s = startHarness();
    void createDesktopApp(s.deps).start();
    await settle();
    expect(s.h.calls).toContain('showStart');
    // The app's own menu is in place before Start is shown, not Electron's default one.
    expect(s.h.calls.indexOf('installMenu')).toBeGreaterThanOrEqual(0);
    expect(s.h.calls.indexOf('installMenu')).toBeLessThan(s.h.calls.indexOf('showStart'));
    for (const never of ['config.resolveSecret', 'server.start', 'showBoot', 'createBackup']) expect(s.h.calls).not.toContain(never);
    // The bridge answers Start's calls only while Start is what the window holds.
    expect(s.h.bridge()?.start?.()).not.toBeNull();
    expect(s.h.bridge()?.start?.()?.state()).toMatchObject({ firstLaunch: true, recent: [], proposedParent: '/home/ava/Adminium' });
  });

  it('"Use my own database" goes on into the classic workspace as a launch without Start does', async () => {
    const s = startHarness({ classicUsed: true });
    const started = createDesktopApp(s.deps).start();
    await settle();
    s.h.bridge()?.start?.()?.useClassic();
    await started;
    const after = s.h.calls.slice(s.h.calls.indexOf('showStart') + 1);
    expect(after.filter((call) => ['config.resolveSecret', 'server.start', 'showBoot', 'loadApp'].includes(call))).toEqual(['config.resolveSecret', 'server.start', 'showBoot', 'loadApp']);
    expect(s.h.loaded[0]).not.toContain('/desktop/setup');
    // Start is gone: its calls are no longer answered.
    expect(s.h.bridge()?.start?.()).toBeNull();
  });

  it('sends a classic workspace that was never set up to its setup, whether or not config.json exists', async () => {
    // config.json was written by Start itself (a project was remembered), so "first run" is read from the data folder.
    const s = startHarness({ classicUsed: false, firstRun: false });
    const started = createDesktopApp(s.deps).start();
    await settle();
    s.h.bridge()?.start?.()?.useClassic();
    await started;
    expect(s.h.loaded[0]).toMatch(/\/desktop\/setup$/);
  });

  it('skips Start for a file handed to the app at launch: that belongs to the classic workspace', async () => {
    const s = startHarness({ pendingFile: '/home/ava/backup.zip' });
    await createDesktopApp(s.deps).start();
    expect(s.h.calls).not.toContain('showStart');
    expect(s.h.calls).toContain('server.start');
  });

  it('boots the project a person opens from Start, on its own cookie jar, with no classic secret', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-boot-start-')));
    try {
      const root = join(home, 'shop');
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
      const s = startHarness();
      const deps: DesktopBootDeps = { ...s.deps, startScreen: { ...s.deps.startScreen!, folder: { ...realFolderDeps('/opt/Adminium', 'linux'), home } } };
      const started = createDesktopApp(deps).start();
      await settle();
      const start = s.h.bridge()?.start?.();
      // Asked first: nothing of the folder is started on a first open.
      await expect(start?.openProject({ path: root })).resolves.toMatchObject({ status: 'trust-needed' });
      expect(s.projectOptions).toEqual([]);
      await expect(start?.openProject({ path: root, agreed: true })).resolves.toEqual({ status: 'opened' });
      await started;

      expect(s.projectOptions).toHaveLength(1);
      expect(s.projectOptions[0]?.project).toMatchObject({ root, mode: 'design' });
      expect(s.sessions).toEqual([root]);
      expect(s.h.calls).not.toContain('config.resolveSecret');
      expect(s.h.calls).not.toContain('createBackup');
      // Remembered, in the app's own config, with what was agreed to.
      expect(s.h.saved.at(-1)?.projects).toMatchObject([{ path: root, name: 'Shop', state: 'building' }]);
      expect(s.h.saved.at(-1)?.projects[0]?.trusted).toMatch(/^[0-9a-f]{64}$/);
      expect(s.h.bridge()?.start?.()).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('"Close project" stops its server, takes back the app’s cookie jar and shows Start again; the next choice boots as the first did', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-boot-close-')));
    try {
      const root = join(home, 'shop');
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      mkdirSync(join(root, 'hooks'));
      writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
      const s = startHarness({ classicUsed: true });
      let live: { root: string; mode: 'design' | 'serve' } | null = null;
      let busy: { kind: string; sessionId: string | null } | null = null;
      const asked: string[] = [];
      const deps: DesktopBootDeps = {
        ...s.deps,
        startScreen: { ...s.deps.startScreen!, folder: { ...realFolderDeps('/opt/Adminium', 'linux'), home } },
        createServerManager: (o) => {
          const made = s.deps.createServerManager(o);
          if (o.project === undefined) return made;
          live = { root: o.project.root, mode: 'design' };
          // The fake manager is the classic one: as a project's it says which folder it serves.
          return Object.create(made, { project: { get: () => live }, busy: { value: () => Promise.resolve(busy) } }) as typeof made;
        },
        confirmStopBusy: (_busy, why) => {
          asked.push(why);
          return Promise.resolve(false);
        },
      };
      void createDesktopApp(deps).start();
      await settle();
      await s.h.bridge()?.start?.()?.openProject({ path: root, agreed: true });
      await settle();
      const bridge = s.h.bridge();
      expect(bridge?.project?.info()).toEqual({ root, displayPath: '~/shop', name: 'Shop', mode: 'design' });

      // In the middle of a turn, and the person keeps working: nothing is stopped.
      busy = { kind: 'turn', sessionId: 'ds_1' };
      await expect(bridge?.project?.close()).resolves.toBe(false);
      expect(asked).toEqual(['close']);
      expect(s.h.stopped()).toBe(0);
      expect(bridge?.project?.info()).not.toBeNull();

      // The Designer changed the folder's code while it was open.
      writeFileSync(join(root, 'hooks', 'on-save.ts'), 'export default 1;\n');
      busy = null;
      const shownBefore = s.h.calls.filter((call) => call === 'showStart').length;
      await expect(bridge?.project?.close()).resolves.toBe(true);
      await settle();
      expect(s.h.stopped()).toBe(1);
      expect(s.sessions).toEqual([root, null]);
      expect(s.h.calls.filter((call) => call === 'showStart')).toHaveLength(shownBefore + 1);
      expect(bridge?.project?.info()).toBeNull();
      // Start is back, lists the project, and does not ask about the app's own changes.
      const start = bridge?.start?.();
      expect(start?.state().recent).toMatchObject([{ path: root, name: 'Shop', missing: false }]);
      await expect(start?.openProject({ path: root })).resolves.toEqual({ status: 'opened' });
      await settle();
      expect(s.projectOptions).toHaveLength(2);
      // And from there the classic workspace is one choice away, as at launch.
      await expect(bridge?.project?.close()).resolves.toBe(true);
      await settle();
      bridge?.start?.()?.useClassic();
      await settle();
      expect(s.h.calls).toContain('config.resolveSecret');
      expect(bridge?.project?.info()).toBeNull();
      await expect(bridge?.project?.close()).resolves.toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('without the screens (every boot before them) goes to the classic workspace at once', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    expect(h.calls).not.toContain('showStart');
    expect(h.bridge()?.start?.()).toBeNull();
  });
});
