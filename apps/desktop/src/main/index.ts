/**
 * The main-process entry (11-electron.md §2.2 "Boot sequence"), owned by 11-T01.
 *
 * This module is the ONLY place the boot sequence's ORDER is written down, and
 * it owns nothing else: `config.json` is 11-T03's, the utilityProcess and its
 * restart policy are 11-T02's, the window and its navigation lockdown are
 * 11-T05's. What lives here is the choreography between them, plus the two
 * app-lifecycle rules that have nowhere else to go — the single-instance lock
 * (§2.2 step 1) and the macOS activate / window-all-closed conventions (§14).
 *
 * WHY IT IS INJECTABLE. A real Electron app cannot be launched headlessly, so an
 * entry that reached for `app` and `BrowserWindow` at module scope would be
 * literally untestable — every boot-order bug would have to be found by hand, in
 * a packaged build, by a person. So `createDesktopApp` takes ports
 * ({@link DesktopBootDeps}) and all Electron wiring is confined to
 * {@link electronBootDeps}, which runs only when this module is genuinely the
 * Electron main entry (see {@link isElectronMain} at the bottom). The unit suite
 * drives the sequence with fakes; 11-T20's Playwright `_electron` suite covers
 * the real shell.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, ipcMain, safeStorage, shell } from 'electron';

import type { DesktopConfigPatch, DesktopPlatform } from '../preload/api.js';
import { createUngrantedCapabilityHost } from './capabilities/host.js';
import {
  configPathFor,
  createDefaultConfig,
  defaultDataDirFor,
  loadConfig,
  resolveSecret,
  saveConfig,
  type ConfigLogger,
  type DesktopConfig,
  type SecretStorage,
} from './config.js';
import { generateBootToken } from '../server/env.js';
import { registerIpcHandlers, type DesktopRuntimeSnapshot } from './ipc.js';
import { createDesktopLogging } from './logging.js';
import {
  createServerManager,
  type CreateServerManagerOptions,
  type ServerExit,
  type ServerManager,
  type ServerReadyInfo,
  type ServerState,
} from './server-manager.js';
import {
  createNativeDialogs,
  createWindowManager,
  type CrashAction,
  type CrashScreenInfo,
  type DesktopWindows,
} from './window.js';

// ─── Pure policy ─────────────────────────────────────────────────────────────

/**
 * Files a launch argument may name (§2.2 step 1; §9 "Restore/import … also
 * handles a backup zip passed as a launch argument"). `.zip` is the §9 backup
 * archive; the SQLite extensions are the ones §6's "Open an existing SQLite
 * file" dialog accepts, so a double-click behaves like that dialog.
 */
export const LAUNCH_FILE_EXTENSIONS: readonly string[] = ['.zip', '.sqlite', '.db', '.sqlite3'];

/**
 * The first launch argument naming a file we know how to open, or `null`.
 *
 * Pure, because argv is the one part of §2.2 step 1 with real edge cases and no
 * way to reproduce them by hand: Electron hands the second instance a full argv
 * whose head is the executable path and whose middle may carry Chromium switches
 * (`--allow-file-access-from-files`, `--original-process-start-time=…`). Options
 * are skipped rather than inspected, and the executable itself can never match,
 * because no extension listed above is one an executable carries.
 */
export function extractFileArgument(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith('-')) continue;
    const lower = arg.toLowerCase();
    if (LAUNCH_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return arg;
  }
  return null;
}

export interface AppUrlOptions {
  host: string;
  port: number;
  /** §2.2 step 2: no `config.json` ⇒ §6's wizard rather than the app. */
  firstRun: boolean;
  /**
   * §5. Present only while `config.singleUser` is on — with it off the
   * desktop-session route is not registered at all, and the SPA must land on the
   * standard login instead of waving a token nobody will accept.
   */
  bootToken?: string | undefined;
}

/**
 * The URL the window loads once the server is ready (§2.2 step 8).
 *
 * ALWAYS loopback, even when the server bound `0.0.0.0` because LAN share is on
 * (§8.3). The window is a local client: §2.4 locks navigation to the loopback
 * origin, and §5 has the boot-token exchange reject non-loopback peers
 * unconditionally — so a window that addressed itself over the LAN interface
 * would be refused by our own auth route, and would drop a session cookie on an
 * origin every other device on the network can reach.
 */
export function appUrl(opts: AppUrlOptions): string {
  const hostname = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1' : opts.host;
  const origin = `http://${hostname}:${String(opts.port)}`;
  // First run has no super-admin yet, so there is no session for a token to buy.
  if (opts.firstRun) return `${origin}/desktop/setup`;
  if (opts.bootToken === undefined) return `${origin}/`;
  const url = new URL('/', origin);
  url.searchParams.set('bootToken', opts.bootToken);
  return url.toString();
}

// ─── Ports ───────────────────────────────────────────────────────────────────

/**
 * Electron's `app`, narrowed to what §2.2 and §14 need. A port rather than the
 * real object because `app` is a sprawling EventEmitter bound to a live Chromium:
 * faking this shape is a page of code; faking `app` is not possible.
 */
export interface DesktopAppHost {
  /** `process.argv` of THIS launch. */
  readonly argv: readonly string[];
  /** `darwin` | `win32` | `linux` — drives the §14 window-all-closed convention. */
  readonly platform: NodeJS.Platform;
  requestSingleInstanceLock(): boolean;
  onSecondInstance(handler: (argv: readonly string[]) => void): void;
  onActivate(handler: () => void): void;
  onWindowAllClosed(handler: () => void): void;
  /**
   * Electron's `before-quit`. The ONLY moment at which the app is closing and
   * the child is still alive, which makes it the only place §9's graceful
   * shutdown can happen — see {@link DesktopApp.start}'s quit hook.
   */
  onBeforeQuit(handler: (event: QuitEvent) => void): void;
  whenReady(): Promise<void>;
  quit(): void;
}

/** Electron's `Event`, narrowed to the one member the quit hook needs. */
export interface QuitEvent {
  preventDefault(): void;
}

/** §2.2 steps 2 + 3, as the boot sequence needs them. Backed by 11-T03's config.ts. */
export interface DesktopConfigPort {
  /** Step 2. `firstRun` ⇔ `config.json` was absent; the config is then a default. */
  load(): Promise<{ config: DesktopConfig; firstRun: boolean }>;
  /**
   * Step 3. Returns the plaintext secret plus the storage mode the About screen
   * warns on (§13), persisting the config when resolution changed it (a freshly
   * generated secret, or a plaintext→safeStorage upgrade).
   */
  resolveSecret(config: DesktopConfig): Promise<{ secret: string; secretStorage: SecretStorage }>;
  /**
   * Persist a config the §4 bridge's `setConfig` has just patched (§2.3's atomic
   * write). Not part of the boot sequence — the boot's own writes are decided
   * inside {@link DesktopConfigPort.load} / {@link DesktopConfigPort.resolveSecret}
   * — but the same file, so the same port owns it.
   */
  save(config: DesktopConfig): Promise<void>;
}

/**
 * The live state §4's bridge reads and writes (`main/ipc.ts`'s ports).
 *
 * Handed to {@link DesktopBootDeps.registerBridge} rather than assembled inside
 * `electronBootDeps` because all three answers change as the boot progresses,
 * and only the boot sequence knows when: `runtime` is `null` until step 2 and
 * gains its port at step 7, and `config` is not read until step 2 either.
 */
export interface DesktopBridgeContext {
  /** `null` until §2.2 step 2 has run — `getRuntimeInfo` then answers UNAVAILABLE. */
  runtime: () => DesktopRuntimeSnapshot | null;
  /** The live `config.json` (§2.3). Throws before step 2. */
  readConfig: () => DesktopConfig;
  /** Merge a §4 patch into the live config and persist it. */
  writeConfig: (patch: DesktopConfigPatch) => Promise<void>;
}

/** What the boot sequence knows about itself; 11-T04's `getRuntimeInfo` reads it. */
export interface DesktopRuntimeState {
  readonly dataDir: string;
  readonly firstRun: boolean;
  /** §2.2-3 / §13: `plain` makes the About screen show its warning banner. */
  readonly secretStorage: SecretStorage;
  /** Resolved by the §2.2 step 7 handshake; `-1` until then. */
  readonly serverPort: number;
}

export interface DesktopBootDeps {
  host: DesktopAppHost;
  /** 11-T03. */
  config: DesktopConfigPort;
  /** 11-T05. */
  windows: DesktopWindows;
  /**
   * 11-T02. A factory rather than an instance, because the boot sequence only
   * learns the dataDir and the secret at steps 2–3.
   */
  createServerManager: (opts: CreateServerManagerOptions) => ServerManager;
  /** §2.2 step 4 — 32 random bytes, hex, per boot. Never persisted, never logged. */
  createBootToken: () => string;
  /** §9's `<userData>/logs`; the manager rotates `adminium-server.log` in it. */
  logsDir: string;
  /** Absolute path to the forked bundle — `out/server/index.js` (§2.1). */
  serverEntry: string;
  /**
   * §3: the dashboard build, for `ADMINIUM_STATIC_ROOT`.
   *
   * The window navigates to `http://127.0.0.1:<port>/` (§2.2 step 8) and the
   * embedded server is what answers — so a server that was never told where the
   * SPA is serves a 404 and the app is a blank window over a healthy backend.
   * Optional only because the dev loop has no copied build and the server's own
   * candidate list finds `apps/dashboard/dist` instead; a packaged app has no
   * such fallback (§3 copies the build to `out/dashboard`, and
   * `@adminium/dashboard` is a devDependency electron-builder prunes), which is
   * exactly why omitting it here was invisible in dev and fatal in production.
   */
  staticRoot?: string | undefined;
  /**
   * 11-T04. Wire §4's `ipcMain` handlers — called ONCE, before the first window.
   *
   * A port rather than a call to `registerIpcHandlers` inside `start()`, for the
   * reason every other Electron touch here is one: the handler set needs
   * `ipcMain`, native dialogs, the CapabilityHost and the updater, none of which
   * a unit test can supply. What the sequence owns — and what a test must be
   * able to assert — is the ORDER: this must run before `windows.showBoot()`,
   * because the preload reads §4's `platform`/`versions` with a `sendSync` at
   * load time and THROWS if nothing answers, which fails the whole preload and
   * leaves `window.adminiumDesktop` undefined for the life of the window.
   */
  registerBridge: (context: DesktopBridgeContext) => void;
  /** Help → "Show logs" (§9) and the crash page's `logs` button: reveal `<userData>/logs`. */
  showLogs: () => Promise<void>;
}

export interface DesktopApp {
  start(): Promise<void>;
  /** Filled in as the sequence progresses; `null` until step 2 has run. */
  readonly runtime: DesktopRuntimeState | null;
}

// ─── The boot sequence ───────────────────────────────────────────────────────

/**
 * Wire §2.2 steps 1–9. The step numbers in the comments are the doc's, and
 * keeping them in the source is deliberate: the ORDER *is* the specification
 * here, and reordering it fails silently. Splash after the handshake is a blank
 * window for up to 30 s; the lock after `whenReady` is two servers writing one
 * data directory.
 *
 * Note what is NOT here: the restart policy. It belongs to the ServerManager,
 * which is the only thing that knows how many children have died and when. The
 * shell renders the outcome and holds no opinion about it.
 */
export function createDesktopApp(deps: DesktopBootDeps): DesktopApp {
  const { host, windows } = deps;
  let runtime: DesktopRuntimeState | null = null;
  /** The live `config.json` — `null` until step 2, then always current. */
  let config: DesktopConfig | null = null;
  /**
   * `null` until step 5. The crash-action handler and the quit hook are both
   * installed BEFORE that (they have to be — a boot can fail at step 2, and the
   * crash page it opens has a Quit button), so both read this rather than close
   * over a manager that does not exist yet.
   */
  let manager: ServerManager | null = null;

  return {
    get runtime() {
      return runtime;
    },

    async start(): Promise<void> {
      // Step 1. Before anything touches the data dir: a second copy of this app
      // opens the same SQLite files with a second set of writers, which is the
      // corruption §6's cloud-sync warning exists to prevent — self-inflicted.
      if (!host.requestSingleInstanceLock()) {
        host.quit();
        return;
      }
      host.onSecondInstance((argv) => {
        windows.focus();
        const file = extractFileArgument(argv);
        if (file !== null) windows.handleFileArgument(file);
      });

      // §14: single window; closing the last one quits everywhere but macOS,
      // where `activate` re-creates it.
      host.onWindowAllClosed(() => {
        if (host.platform !== 'darwin') host.quit();
      });
      host.onActivate(() => {
        if (!windows.exists()) void windows.reopen();
      });

      await host.whenReady();

      // §4's bridge, BEFORE anything can create a window — which is why it is
      // here and not next to the ServerManager it has nothing to do with. The
      // preload runs `sendSync(bootstrap)` at load time and throws when nothing
      // answers, so a window created before this line has no bridge AT ALL:
      // `window.adminiumDesktop` is undefined, every §4 affordance is dead, and
      // §5's "Require login on this device" is unreachable. That includes the
      // crash screen below — a boot that fails at step 2 still opens a window.
      deps.registerBridge({
        runtime: () =>
          runtime === null
            ? null
            : {
                dataDir: runtime.dataDir,
                secretStorage: runtime.secretStorage,
                serverPort: runtime.serverPort,
              },
        readConfig: () => {
          if (config === null) {
            throw new Error('the desktop config has not been loaded yet (§2.2 step 2).');
          }
          return config;
        },
        writeConfig: async (patch) => {
          if (config === null) {
            throw new Error('the desktop config has not been loaded yet (§2.2 step 2).');
          }
          const next = applyConfigPatch(config, patch);
          await deps.config.save(next);
          config = next;
        },
      });

      // §2.2 step 9's three buttons, and §9's graceful shutdown. BOTH before the
      // config steps below, because those can fail — and the crash screen they
      // open is a real window with a real Quit button on it. Installed after the
      // bridge only because nothing can press a button before a window exists.
      //
      // The handlers read `manager` rather than closing over one: it does not
      // exist until step 5 (the shell only learns the dataDir and the secret at
      // steps 2–3), which is exactly why passing `onCrashAction` to
      // `createWindowManager` cannot work and left all three buttons inert.
      windows.setCrashActionHandler((action: CrashAction) => {
        if (action === 'quit') {
          host.quit();
          return;
        }
        if (action === 'logs') {
          void deps.showLogs();
          return;
        }
        // A config-error crash has no server to restart and renders no Restart
        // button (`canRestart: false`), so this is unreachable rather than
        // silent — but a dead branch on this screen is not worth the risk.
        const target = manager;
        if (target === null) return;
        void (async () => {
          await windows.showBoot();
          // Clearing the port is what lets the re-navigation happen: the
          // `subscribe` listener below suppresses a `ready` on the port it is
          // already on, and a restart that lands on the SAME port would
          // otherwise leave the window on the splash forever.
          if (runtime !== null) runtime = { ...runtime, serverPort: -1 };
          try {
            await target.restart();
            // `subscribe` navigates on the resulting `ready`.
          } catch (error) {
            await windows.showCrash(crashFromStartError(error));
          }
        })();
      });

      // §9's graceful shutdown, and the only hook from which it can happen.
      // Without it the child is always killed abruptly: Fastify's `onClose`
      // hooks never run, so pools are not disposed and the
      // `wal_checkpoint(TRUNCATE)` that makes the `.sqlite` files
      // self-contained at rest never happens — every quit leaves WAL sidecars
      // next to every database, which is precisely what the manager's
      // shutdown-then-kill ordering was written to prevent.
      //
      // `stop()` also flips the manager's intent, so the child's exit is
      // classified EXPECTED. That matters as much as the checkpoint: without
      // it, an exit during teardown is "unexpected", the restart policy
      // re-forks a server while the app is closing, and the `onExit` listener
      // below builds a BrowserWindow on the way out.
      let stopping = false;
      host.onBeforeQuit((event) => {
        // The second pass — our own `host.quit()` re-emits `before-quit`.
        // Letting it through is what actually ends the app.
        if (stopping) return;
        const target = manager;
        // No child yet (a quit during boot steps 1–4): nothing to shut down, and
        // cancelling the quit to await nothing would hang the app instead.
        if (target === null) return;
        stopping = true;
        event.preventDefault();
        void target.stop().finally(() => {
          host.quit();
        });
      });

      // Steps 2 and 3, guarded. Everything config.ts raises here is a condition
      // the USER can act on and the crash page exists to name: a config.json
      // from a newer build (downgrade), a damaged or hand-edited one, or a
      // safeStorage-encrypted secret with no keyring to decrypt it (the Linux
      // autostart race). Unguarded, all three escape `start()` into a floating
      // rejection — and because `showBoot` is step 6, NO window was ever
      // created, so `window-all-closed` can never fire either: the process sits
      // in the dock forever showing nothing, with no dialog and no log line.
      // `canRestart: false` because none of them is fixed by forking the server
      // again; the messages config.ts raises already say what to do instead.
      let firstRun: boolean;
      let secret: string;
      try {
        // Step 2 — a missing config.json means first-run mode (§6).
        const loaded = await deps.config.load();
        config = loaded.config;
        firstRun = loaded.firstRun;
        // Step 3 — safeStorage, or the flagged plaintext fallback.
        const resolved = await deps.config.resolveSecret(loaded.config);
        secret = resolved.secret;
        runtime = {
          dataDir: loaded.config.dataDir,
          firstRun,
          secretStorage: resolved.secretStorage,
          serverPort: -1,
        };
      } catch (error) {
        await windows.showCrash({
          reason: error instanceof Error ? error.message : String(error),
          canRestart: false,
        });
        return;
      }
      const loadedConfig = config;

      // Step 4.
      const bootToken = deps.createBootToken();

      // Step 5.
      manager = deps.createServerManager({
        entry: deps.serverEntry,
        dataDir: loadedConfig.dataDir,
        secret,
        bootToken,
        logsDir: deps.logsDir,
        telemetryOptIn: loadedConfig.telemetryOptIn,
        // §5's mirror. The child writes this into `adminium_settings` at boot
        // and the auto-login route reads it back; without it the route refuses
        // the very token this boot puts in the window URL at step 8.
        singleUser: loadedConfig.singleUser,
        // §3: where the SPA is. See DesktopBootDeps.staticRoot.
        ...(deps.staticRoot === undefined ? {} : { staticRoot: deps.staticRoot }),
        // §2.4: loopback unless the user opted into LAN share (§8.3). Omitting
        // both is not laziness — the manager defaults to 127.0.0.1 + port 0, so
        // the shell cannot bind every interface by forgetting something.
        ...(loadedConfig.lanShare.enabled
          ? { host: '0.0.0.0', port: loadedConfig.lanShare.port }
          : {}),
      });

      // Steps 5 and 6, in the doc's order and for the doc's reason: the fork is
      // started but NOT awaited, so the splash paints while the server migrates.
      // Awaiting the handshake first leaves an empty window on screen for as
      // long as the boot takes — which, on a first run with migrations to apply,
      // is the longest it will ever be.
      const started = manager.start();
      await windows.showBoot();

      // Step 7 — the handshake (or its 30 s timeout) resolves the real port. The
      // child listens on :0, so its `ready` message is the only place that
      // number exists.
      let ready: ServerReadyInfo;
      try {
        ready = await started;
      } catch (error) {
        await windows.showCrash(crashFromStartError(error));
        return;
      }
      runtime = { ...runtime, serverPort: ready.port };

      // Step 8. The token rides in the URL only while `singleUser` is on — with
      // it off the desktop-session route is not registered (§5) and the SPA must
      // fall through to the standard login.
      await windows.loadApp(
        appUrl({
          host: ready.host,
          port: ready.port,
          firstRun,
          ...(loadedConfig.singleUser ? { bootToken } : {}),
        }),
      );

      // Step 9. The POLICY is the manager's — it is the only thing that knows
      // how many children have died and when — so the shell only renders what it
      // reports. `onExit` fires for UNEXPECTED post-`ready` exits only, which is
      // why the try/catch above cannot double-report the same failure.
      manager.onExit((exit: ServerExit) => {
        if (exit.willRestart) {
          // "Silent restart" means no crash dialog — not a live window pointed
          // at a port nobody is listening on any more.
          void windows.showBoot();
          return;
        }
        void windows.showCrash({
          reason:
            exit.code === null
              ? `The Adminium server stopped unexpectedly (signal ${exit.signal ?? 'unknown'}).`
              : `The Adminium server stopped unexpectedly (exit code ${String(exit.code)}).`,
          logPath: exit.logPath,
          // §2.2 step 9: once the 3-in-60 s cap trips, restarting is the user's
          // move, not ours.
          canRestart: !exit.giveUp,
        });
      });

      // A restart re-forks the child, which listens on :0 again and therefore
      // comes back on a DIFFERENT port — so the window has to be sent to the new
      // origin or it stays pointed at a dead one. `subscribe` replays the
      // current state immediately; the port guard makes that replay a no-op.
      // (The boot token survives: it is ours, not the child's, so the SPA's
      // exchange still works against the new process.)
      manager.subscribe((state: ServerState) => {
        if (state.status !== 'ready') return;
        if (runtime !== null && state.port === runtime.serverPort) return;
        runtime = runtime === null ? runtime : { ...runtime, serverPort: state.port };
        void windows.loadApp(
          appUrl({
            host: state.host,
            port: state.port,
            firstRun,
            ...(loadedConfig.singleUser ? { bootToken } : {}),
          }),
        );
      });

      // A file handed to us on the command line is a restore/open request (§9),
      // and it can only be acted on once the SPA is up to render the flow.
      const launchFile = extractFileArgument(host.argv);
      if (launchFile !== null) windows.handleFileArgument(launchFile);
    },
  };
}

/**
 * Merge §4's `setConfig` patch into the live `config.json` body (§2.3).
 *
 * Key by key rather than `{ ...config, ...patch }`, for two reasons that are the
 * same reason:
 *
 *  - `exactOptionalPropertyTypes`. A patch is `{ singleUser?: boolean | undefined }`,
 *    so `{ ...config, ...patch }` splices an EXPLICIT `undefined` over a
 *    required field whenever a key is present-but-undefined — the settings panel
 *    sending `{ singleUser: undefined }` would write `singleUser: undefined` to
 *    disk, which `saveConfig`'s schema then rejects (or, without it, would boot
 *    into a config with no answer for whether a password is required).
 *  - It is an ALLOW-LIST, like `redactConfig`. `dataDir`, `secretEncrypted`,
 *    `secretPlain`, `version` and `window` cannot be reached from here even if a
 *    future patch type grew one by accident — the same defence-in-depth
 *    `main/ipc.ts`'s `strictObject` provides one layer up, stated where the
 *    write actually happens.
 *
 * Pure and exported so the five keys are assertable without a boot.
 */
export function applyConfigPatch(config: DesktopConfig, patch: DesktopConfigPatch): DesktopConfig {
  const next: DesktopConfig = { ...config };
  if (patch.singleUser !== undefined) next.singleUser = patch.singleUser;
  if (patch.lanShare !== undefined) next.lanShare = { ...patch.lanShare };
  if (patch.updates !== undefined) next.updates = { ...patch.updates };
  if (patch.telemetryOptIn !== undefined) next.telemetryOptIn = patch.telemetryOptIn;
  if (patch.autoBackup !== undefined) next.autoBackup = { ...patch.autoBackup };
  return next;
}

/**
 * A pre-`ready` failure (§2.2 step 7). `ServerStartError` already carries the
 * log excerpt and path the crash page wants; anything else that got thrown gets
 * its message shown and nothing invented around it.
 */
function crashFromStartError(error: unknown): CrashScreenInfo {
  const detail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? (error as { detail: { logPath?: string; excerpt?: readonly string[] } }).detail
      : undefined;
  return {
    reason: error instanceof Error ? error.message : String(error),
    ...(detail?.logPath === undefined ? {} : { logPath: detail.logPath }),
    ...(detail?.excerpt === undefined ? {} : { excerpt: detail.excerpt }),
    // A first boot failing is not the 3-in-60 s cap: the cause is often
    // something the user can fix (a locked data dir, a busy port) and retry.
    canRestart: true,
  };
}

// ─── Electron wiring ─────────────────────────────────────────────────────────

/** `out/main/index.js` → `out/server/index.js` — §2.1's fork entry. */
function bundledServerEntry(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');
}

/**
 * `out/main/index.js` → `out/dashboard` — where electron.vite.config.ts's
 * `copyDashboardBuild()` puts the SPA (§3).
 *
 * Passed unconditionally, including in dev where the directory does not exist:
 * `resolveStaticRoot` treats the override as the FIRST candidate and falls
 * through to `apps/dashboard/dist` when it holds no `index.html`, so the dev
 * loop is unaffected and a packaged build — where that fallback is absent,
 * because `@adminium/dashboard` is a devDependency electron-builder prunes —
 * gets the copy. Guarding this with an `existsSync` would buy nothing and would
 * reintroduce the failure: in dev the guard hides the bug, in production the
 * check passes anyway.
 */
function bundledStaticRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
}

/** §10's three build targets, as §4's `platform` narrows them. */
function desktopPlatform(): DesktopPlatform {
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform;
  // §10 builds for exactly three; anything else is not a platform this app was
  // shipped for, and §4's `platform` has no honest value to report.
  throw new Error(`Adminium Desktop does not support the "${platform}" platform.`);
}

/**
 * 11-T03's config module is a set of pure functions over an explicit path, not a
 * stateful store — so this adapter is where the two `config.json` writes the
 * boot sequence may perform get decided.
 *
 * FIRST RUN PERSISTS. `load()` returns a default without writing; `resolveSecret`
 * writes when it minted one. That ordering matters: the secret must have a home
 * before the server encrypts anything with it (a DSN saved by §6 step 2 is
 * unreadable if the next boot generates a different secret), while `firstRun`
 * stays a statement about THIS boot's starting URL rather than a claim that the
 * wizard was finished. §6's wizard is gated server-side on "zero users", so a
 * user who quits halfway lands back in it next launch even though `config.json`
 * now exists.
 */
function electronConfigPort(userDataDir: string, logger: ConfigLogger): DesktopConfigPort {
  const path = configPathFor(userDataDir);
  return {
    async load() {
      const result = await loadConfig(path, { logger });
      if (result.status === 'missing') {
        return { config: createDefaultConfig(defaultDataDirFor(userDataDir)), firstRun: true };
      }
      // A config migrated forward (§2.3 "versioned") is written back now that we
      // know it loaded cleanly — loadConfig deliberately leaves that to us.
      if (result.migratedFrom !== null) await saveConfig(path, result.config);
      return { config: result.config, firstRun: false };
    },
    async resolveSecret(config) {
      const resolved = resolveSecret(config, safeStorage, { logger });
      if (resolved.changed) await saveConfig(path, resolved.config);
      return { secret: resolved.secret, secretStorage: resolved.storage };
    },
    save: (config) => saveConfig(path, config),
  };
}

/**
 * config.ts's {@link ConfigLogger} over §9's main-process log.
 *
 * Without this the two call sites above default to config.ts's `silentLogger`,
 * and the §2.2 step-3 plaintext-secret warning — the one that justifies §13's
 * About-screen banner — is discarded. That is a support failure with no
 * symptom: an engineer reading `<userData>/logs` after a "my secret is in
 * cleartext" report finds nothing, and a config.json that silently migrated
 * versions leaves no record it ever did.
 *
 * `write` already stamps each line, and the sink is message-only by design (see
 * config.ts's ConfigLogger) — the level is a prefix rather than a field so no
 * caller can pass a payload with a secret spread into it.
 */
function mainProcessConfigLogger(write: (line: string) => void): ConfigLogger {
  return {
    info: (message) => {
      write(`[config] ${message}`);
    },
    warn: (message) => {
      write(`[config] WARN ${message}`);
    },
  };
}

/** The real ports. Never called under vitest — see the module header. */
export function electronBootDeps(): DesktopBootDeps {
  const userDataDir = app.getPath('userData');
  // §9: `<userData>/logs`, which is exactly what Electron's `logs` path is.
  const logsDir = app.getPath('logs');
  const logging = createDesktopLogging({ logsDir });
  const mainLog = (line: string): void => {
    logging.main.write(line);
  };
  const windows = createWindowManager({ userDataDir });
  const showLogs = async (): Promise<void> => {
    // §9: "Help → 'Show logs' reveals the folder." `openPath` returns a
    // NON-EMPTY string on failure rather than throwing, which is a shape worth
    // logging: a bridge that reports success while nothing opened is worse than
    // one that reports the reason.
    const error = await shell.openPath(logsDir);
    if (error !== '') mainLog(`[main] could not open the logs folder: ${error}`);
  };

  return {
    host: {
      argv: process.argv,
      platform: process.platform,
      requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
      onSecondInstance: (handler) => {
        app.on('second-instance', (_event, argv) => {
          handler(argv);
        });
      },
      onActivate: (handler) => {
        app.on('activate', () => {
          handler();
        });
      },
      onWindowAllClosed: (handler) => {
        app.on('window-all-closed', () => {
          handler();
        });
      },
      onBeforeQuit: (handler) => {
        app.on('before-quit', (event) => {
          handler(event);
        });
      },
      whenReady: () => app.whenReady(),
      quit: () => {
        app.quit();
      },
    },
    config: electronConfigPort(userDataDir, mainProcessConfigLogger(mainLog)),
    windows,
    logsDir,
    showLogs,
    createServerManager,
    createBootToken: generateBootToken,
    serverEntry: bundledServerEntry(),
    staticRoot: bundledStaticRoot(),

    registerBridge: (context) => {
      registerIpcHandlers({
        ipc: ipcMain,
        // §4's two synchronous properties. `versions.app` is `app.getVersion()`
        // and exists ONLY here: a sandboxed preload's polyfilled `process` knows
        // electron/chrome/node and nothing about the app itself, which is the
        // whole reason the bootstrap channel exists.
        bootstrap: {
          platform: desktopPlatform(),
          versions: {
            app: app.getVersion(),
            electron: process.versions.electron ?? '',
            chrome: process.versions.chrome ?? '',
            node: process.versions.node,
          },
        },
        broadcast: (channel, payload) => {
          windows.broadcast(channel, payload);
        },
        ...context,
        dialogs: createNativeDialogs(),
        /**
         * §11 is 11-T16's, and `null` is its contract for "not wired", not a
         * placeholder: the three update channels answer §4's `UNAVAILABLE`
         * rather than rejecting with Electron's "No handler registered" prose.
         * It also satisfies §11's one CORRECTNESS rule for free — an updater
         * that is never constructed cannot make a network request, which is
         * what the air-gapped acceptance criterion asserts.
         */
        updates: null,
        // §12's registry, grant table and consent flow are 11-T17's. This host
        // lists nothing and refuses every invoke with the typed
        // CAPABILITY_NOT_GRANTED §12 specifies for an ungranted call.
        capabilities: createUngrantedCapabilityHost(),
        showLogs,
        relaunch: () => {
          // §14. `relaunch()` only QUEUES the restart — it is `quit()` that ends
          // this process, and the `before-quit` hook that stops the server
          // gracefully on the way out.
          app.relaunch();
          app.quit();
        },
        log: mainLog,
      });
    },
  };
}

/**
 * True only in a real Electron main process. `process.type` is set by Electron
 * itself (`browser` in main, `renderer` in a window, `utility` in a
 * utilityProcess) and is undefined under plain Node — which makes this a fact
 * about the runtime rather than an env-var convention a test could get wrong.
 * Without the guard, importing this module in a unit test would boot the app.
 */
export function isElectronMain(): boolean {
  return process.versions.electron !== undefined && process.type === 'browser';
}

if (isElectronMain()) {
  void createDesktopApp(electronBootDeps()).start();
}
