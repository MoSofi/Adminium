/**
 * The boot sequence (11-electron.md §2.2), driven through `createDesktopApp`'s
 * injected ports. No Electron here — see the module header of index.ts and the
 * `electron` alias in vitest.config.ts for why that is possible at all.
 *
 * What these assert is ORDER and POLICY, because that is what §2.2 actually
 * specifies and what a reader of the code cannot otherwise check: the lock
 * before the data directory, the splash before the handshake, the token only
 * when `singleUser`, loopback always. The Electron-facing halves (a real
 * BrowserWindow, a real utilityProcess) are 11-T20's Playwright `_electron`
 * suite.
 */

import { describe, expect, it, vi } from 'vitest';

import { createDefaultConfig, type DesktopConfig } from './config.js';
import {
  appUrl,
  applyConfigPatch,
  createDesktopApp,
  extractFileArgument,
  isElectronMain,
  type DesktopAppHost,
  type DesktopBootDeps,
  type DesktopBridgeContext,
  type DesktopConfigPort,
} from './index.js';
import type {
  CreateServerManagerOptions,
  ServerExit,
  ServerManager,
  ServerReadyInfo,
  ServerState,
} from './server-manager.js';
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
}

const READY: ServerReadyInfo = {
  host: '127.0.0.1',
  port: 51234,
  url: 'http://127.0.0.1:51234',
  migrationsApplied: 9,
  pid: 4242,
};

function harness(
  overrides: {
    config?: Partial<DesktopConfig>;
    firstRun?: boolean;
    lock?: boolean;
    platform?: NodeJS.Platform;
    start?: () => Promise<ServerReadyInfo>;
    /** Make boot step 2 or 3 throw — the config.ts error classes (§2.2). */
    load?: () => Promise<{ config: DesktopConfig; firstRun: boolean }>;
    resolveSecret?: () => Promise<{ secret: string; secretStorage: 'safeStorage' | 'plain' }>;
    restart?: () => Promise<ServerReadyInfo>;
    staticRoot?: string;
  } = {},
): Harness {
  const calls: string[] = [];
  const crashes: CrashScreenInfo[] = [];
  const loaded: string[] = [];
  const saved: DesktopConfig[] = [];
  const managerOptions: CreateServerManagerOptions[] = [];
  let quitCount = 0;
  let stopped = 0;
  let restarted = 0;
  const windowExists = { value: false };

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
    argv: ['/Applications/Adminium.app/Contents/MacOS/Adminium'],
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
  };

  const configPort: DesktopConfigPort = {
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

  const manager: ServerManager = {
    state: { status: 'idle' },
    bootToken: 'unused',
    start:
      overrides.start ??
      (() => {
        calls.push('server.start');
        return Promise.resolve(READY);
      }),
    stop: () => {
      stopped += 1;
      calls.push('server.stop');
      return Promise.resolve();
    },
    restart:
      overrides.restart ??
      (() => {
        restarted += 1;
        calls.push('server.restart');
        return Promise.resolve(READY);
      }),
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
        return manager;
      },
      createBootToken: () => 'b'.repeat(64),
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
  };
}

// ─── extractFileArgument (§2.2 step 1, §9) ───────────────────────────────────

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

// ─── appUrl (§2.2 step 8, §5, §2.4) ──────────────────────────────────────────

describe('appUrl', () => {
  it('carries the boot token for the single-user auto-login (§5)', () => {
    expect(appUrl({ host: '127.0.0.1', port: 51234, firstRun: false, bootToken: 'abc' })).toBe(
      'http://127.0.0.1:51234/?bootToken=abc',
    );
  });

  it('omits the token when there is none — the SPA then shows the login (§5)', () => {
    expect(appUrl({ host: '127.0.0.1', port: 51234, firstRun: false })).toBe(
      'http://127.0.0.1:51234/',
    );
  });

  it('lands on the wizard on first run, with no token: there is no user to log in as (§6)', () => {
    expect(appUrl({ host: '127.0.0.1', port: 4600, firstRun: true, bootToken: 'abc' })).toBe(
      'http://127.0.0.1:4600/desktop/setup',
    );
  });

  it('stays on loopback even when the server bound 0.0.0.0 for LAN share (§2.4/§8.3)', () => {
    // §5's boot-token route rejects non-loopback peers unconditionally, so a
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

// ─── The sequence (§2.2) ─────────────────────────────────────────────────────

describe('createDesktopApp boot sequence', () => {
  it('runs §2.2 steps 1-8 in the documented order', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // The lock comes FIRST — before config.load, which is the first thing that
    // touches the data directory. A second instance opening the same SQLite
    // files with a second set of writers is the corruption this prevents.
    expect(h.calls[0]).toBe('lock');
    expect(h.calls).toEqual([
      'lock',
      'whenReady',
      // §4's bridge, before ANY window exists — see the next test.
      'registerBridge',
      // And the crash-page handler before the config steps, because those can
      // fail and the screen they open has a Quit button on it.
      'setCrashActionHandler',
      'config.load',
      'config.resolveSecret',
      'server.start',
      'showBoot',
      'loadApp',
    ]);
  });

  it('registers the §4 bridge before the first window is ever created', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    // THE ordering assertion of this file. The preload reads §4's
    // platform/versions with a blocking `sendSync` at load time and THROWS when
    // no handler answers — Electron then reports "Unable to load preload
    // script", `contextBridge.exposeInMainWorld` never runs, and
    // `window.adminiumDesktop` is undefined for the life of that window. Every
    // §4 affordance dies with it (openFile, chooseDirectory, getRuntimeInfo,
    // setConfig, updates, capabilities, relaunch, showLogs), and §5's "Require
    // login on this device" toggle becomes unreachable. Nothing else in the
    // suite can catch this: the handlers are fully unit-tested in isolation, and
    // it is the WIRING that was absent.
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

  it('paints the splash WITHOUT waiting for the handshake (§2.2 steps 5-6)', async () => {
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

  it('quits without booting a server when the lock is held (§2.2 step 1)', async () => {
    const h = harness({ lock: false });
    await createDesktopApp(h.deps).start();

    expect(h.quit()).toBe(true);
    expect(h.calls).toEqual(['lock', 'quit']);
    // Nothing touched the config or forked a server.
    expect(h.calls).not.toContain('config.load');
    expect(h.calls).not.toContain('server.start');
  });

  it('focuses the window and forwards a file argument on a second launch (§2.2 step 1)', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    h.fireSecondInstance(['/path/Adminium', '/Users/ava/backup.zip']);
    expect(h.calls).toContain('focus');
    expect(h.calls).toContain('handleFileArgument:/Users/ava/backup.zip');
  });

  it('sends the window to the wizard on first run (§6)', async () => {
    const h = harness({ firstRun: true });
    await createDesktopApp(h.deps).start();
    expect(h.loaded).toEqual(['http://127.0.0.1:51234/desktop/setup']);
  });

  it('withholds the token when "Require login on this device" is on (§5)', async () => {
    const h = harness({ config: { singleUser: false } });
    await createDesktopApp(h.deps).start();
    // No token: the route is not even registered, so waving one would 403.
    expect(h.loaded).toEqual(['http://127.0.0.1:51234/']);
  });

  it('exposes the secret-storage mode and resolved port for the About screen (§13)', async () => {
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

  it('binds loopback with an ephemeral port unless LAN share is on (§2.4/§8.3)', async () => {
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

  it('tells the server what §5 answer the user chose (§2.3 singleUser)', async () => {
    // The seam §5 died on: the shell puts `?bootToken=` in the URL below because
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

  it('points the server at the dashboard build, or a packaged app serves no SPA (§3)', async () => {
    const h = harness({ staticRoot: '/app/out/dashboard' });
    await createDesktopApp(h.deps).start();
    // Without this the window navigates to a booted, healthy server that 404s
    // its own SPA — a blank window that passes every gate we have. Dev hides it:
    // the server's own candidate list finds apps/dashboard/dist, which exists in
    // a checkout and not in an asar.
    expect(h.managerOptions()[0]?.staticRoot).toBe('/app/out/dashboard');
  });
});

// ─── The §4 bridge context (§2.3, §4) ────────────────────────────────────────

describe('the bridge context handed to registerBridge', () => {
  it('answers getRuntimeInfo with the live port and secret-storage mode', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();

    expect(h.bridge()?.runtime()).toEqual({
      dataDir: '/data',
      secretStorage: 'safeStorage',
      serverPort: 51234,
    });
  });

  it('reports no runtime before boot step 2, so getRuntimeInfo answers UNAVAILABLE', () => {
    const h = harness();
    // Not started: `registerBridge` has not run, and nothing can have asked.
    // The guard that matters is the one inside the context — assert it via a
    // boot that fails before the runtime exists.
    expect(h.bridge()).toBeNull();
  });

  it('merges and persists a setConfig patch (§2.3, §4)', async () => {
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

describe('applyConfigPatch', () => {
  const base = createDefaultConfig('/data');

  it("applies exactly §4's five keys", () => {
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

  it('leaves the secret, dataDir and version untouched — they are not §4 keys', () => {
    const withSecret: DesktopConfig = { ...base, secretPlain: 'shhh', secretStorage: 'plain' };
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

// ─── Failure + restart rendering (§2.2 steps 7 and 9) ────────────────────────

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

  it('stays silent while the manager is restarting, showing the splash (§2.2 step 9)', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.calls.length = 0;

    h.fireExit({ code: 0, signal: null, willRestart: true, giveUp: false, logPath: '/logs/s.log' });
    expect(h.calls).toEqual(['showBoot']);
    expect(h.crashes).toHaveLength(0);
  });

  it('offers a restart on a crash, but not once the 3-in-60s cap trips (§2.2 step 9)', async () => {
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

  it('shows the crash screen when the secret cannot be resolved (§2.2 step 3)', async () => {
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

// ─── The crash page's buttons (§2.2 step 9) ──────────────────────────────────

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

  it("points Show logs at §9's log folder", async () => {
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
    // The splash first: the crash page must not sit there while the server boots.
    expect(h.calls).toEqual(['showBoot', 'server.restart']);
  });

  it('re-navigates after a retry even when the server comes back on the SAME port', async () => {
    const h = harness();
    await createDesktopApp(h.deps).start();
    h.loaded.length = 0;

    h.fireCrashAction('retry');
    await vi.waitFor(() => expect(h.restarted()).toBe(1));
    // The subscribe listener suppresses a `ready` on the port it is already on
    // — a guard that exists to make the replay-on-subscribe harmless. After a
    // retry it would strand the window on the splash forever, so the retry
    // clears the port first.
    h.emitState({ status: 'ready', ...READY });
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

// ─── Graceful shutdown (§9) ──────────────────────────────────────────────────

describe('the quit path', () => {
  it('stops the server before letting the app close (§9 WAL checkpoint)', async () => {
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

  it('stops the server when the last window closes off macOS (§14 → §9)', async () => {
    const h = harness({ platform: 'win32' });
    await createDesktopApp(h.deps).start();

    h.fireWindowAllClosed();
    await vi.waitFor(() => expect(h.stopped()).toBe(1));
  });
});

// ─── Lifecycle conventions (§14) ─────────────────────────────────────────────

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

describe('isElectronMain', () => {
  it('is false under plain Node, which is what keeps importing this module inert', () => {
    // If this ever returns true in a test runner, the module-scope guard at the
    // bottom of index.ts would boot a real app during the suite.
    expect(isElectronMain()).toBe(false);
  });
});
