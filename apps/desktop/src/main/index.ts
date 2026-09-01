// SPDX-License-Identifier: AGPL-3.0-only
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

import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from 'electron';
import { z } from 'zod';

import type {
  DesktopBundledTextKind,
  DesktopConfigPatch,
  DesktopDiagnostics,
  DesktopMenuLabels,
  DesktopPlatform,
  DesktopUpdateEvent,
  SetDataDirOptions,
  SetDataDirResult,
} from '../preload/api.js';
import { backupManifestSchema } from './backup-archive.js';
import {
  createBackupCoordinator,
  IDLE_THRESHOLD_SECONDS,
  type BackupCoordinator,
  type BackupServerControl,
  type BackupTransport,
} from './backup.js';
import { createCapabilityHost, type CapabilityGrantReader } from './capabilities/host.js';
import { createEscposPrinterProvider } from './capabilities/printer-escpos.js';
import {
  configPathFor,
  createDefaultConfig,
  defaultDataDirFor,
  detectCloudSyncFolder,
  loadConfig,
  redactConfig,
  resolveSecret,
  saveConfig,
  type ConfigLogger,
  type DesktopConfig,
  type SecretStorage,
  type UpdateMode,
} from './config.js';
import {
  lanShareUrls,
  probeBindable,
  suggestNextPort,
  WILDCARD_HOST,
  type ProbeResult,
} from './lan.js';
import { buildAppMenu, menuTranslator, type MenuHandlers, type MenuTranslate } from './menu.js';
import { EPHEMERAL_PORT, generateBootToken, LOOPBACK_HOST } from '../server/env.js';
import { LAN_PORT_IN_USE, registerIpcHandlers, type DesktopRuntimeSnapshot } from './ipc.js';
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
  canSelfUpdate,
  createUpdateManager as buildUpdateManager,
  resolveUpdateMode,
  type UpdateManager,
  type UpdaterPort,
} from './updates.js';
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
  /**
   * Where in the SPA to land. Defaults to `/`.
   *
   * Exists for exactly one caller — §8.3's LAN toggle ({@link LAN_SHARE_PATH})
   * — and the constraint on it is that a MAIN-PROCESS CONSTANT is the only legal
   * argument. This string becomes the window's URL, and the window's URL is what
   * §2.4's navigation lockdown exists to control; a path that could be sourced
   * from the renderer would let the untrusted side choose where the trusted side
   * navigates. Nothing here validates it, because nothing here should have to.
   */
  path?: string | undefined;
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
  const path = opts.path ?? '/';
  if (opts.bootToken === undefined) return `${origin}${path}`;
  const url = new URL(path, origin);
  url.searchParams.set('bootToken', opts.bootToken);
  return url.toString();
}

/**
 * §5's two preconditions for putting a token in the window URL, in one place:
 * auto-login is enabled, and a token exists.
 *
 * Both are genuine `undefined` answers rather than an empty string, so this
 * spreads into {@link AppUrlOptions} instead of returning one — `bootToken: ''`
 * would be a token the server would compare and reject, and `appUrl` branches on
 * the KEY's absence.
 *
 * The second condition is not defensive padding: `ServerManager.bootToken` is
 * `null` until the first fork, and every caller here runs after `ready`. If it
 * is ever null at a call site, the honest URL is the one with no token — the SPA
 * then lands on the standard login rather than exchanging a `"null"` string.
 */
function bootTokenParam(singleUser: boolean, token: string | null): { bootToken?: string } {
  return singleUser && token !== null ? { bootToken: token } : {};
}

/**
 * Where §8.3's toggle sends the window after the rebind — the panel the user was
 * looking at when they flipped it (`app/router.tsx`'s `/settings/desktop`).
 *
 * A LAN toggle always reloads the window, because it always changes the port and
 * therefore the origin (§8.3: "Fixed port ⇒ stable URLs"; §2.1: loopback shares
 * are ephemeral). Landing on `/` would be the mechanically correct thing and the
 * wrong one: the URLs the user just turned on are ON this page, and the toggle's
 * entire purpose is to reveal them.
 */
export const LAN_SHARE_PATH = '/settings/desktop';

/**
 * Where §14's native "About Adminium" menu item sends the window (§13). The same
 * `/about` route the Settings → About panel uses — "the native menu item opens
 * the same panel" — so there is one About surface, not two.
 *
 * A MAIN-PROCESS CONSTANT for the reason {@link AppUrlOptions.path} demands one:
 * this string becomes the window's URL, and §2.4's navigation lockdown exists to
 * control that. Sourcing it from the renderer would let the untrusted side pick
 * where the trusted side navigates. The navigation is a full load (no boot token
 * — the session cookie is already set), which is why it works from any app state
 * and cannot silently break the way a "menu → push → SPA subscriber" chain can if
 * the subscriber is ever unmounted.
 */
export const ABOUT_PATH = '/about';

// ─── LAN share (§8.3) ────────────────────────────────────────────────────────

/** A bind for the server child: §2.2 step 5's `ADMINIUM_HOST` + `ADMINIUM_PORT`. */
export interface ServerBinding {
  host: string;
  port: number;
}

/**
 * The bind `config.lanShare` implies (§8.3, §2.4).
 *
 * The `false` arm is not "leave it alone" — it is the explicit loopback +
 * ephemeral pair, i.e. exactly what boot step 5 forks with when the toggle is
 * off. That matters for `restart()`: the manager REMEMBERS the last host and
 * port it was given, so a disable that only passed `{ host: '127.0.0.1' }` would
 * keep the fixed 4600 and leave a loopback server squatting on the LAN port —
 * visibly "off" and still holding the socket that the next enable has to probe.
 */
export function lanBindingFor(config: DesktopConfig): ServerBinding {
  return config.lanShare.enabled
    ? { host: WILDCARD_HOST, port: config.lanShare.port }
    : { host: LOOPBACK_HOST, port: EPHEMERAL_PORT };
}

/**
 * The bind a config change implies, or `null` when it implies none.
 *
 * `null` for every patch that does not touch `lanShare` — which is most of them
 * (§5's login toggle, §11's update mode, §9's backup schedule all write this
 * same file) and none of which has any business restarting the server. A port
 * edit while sharing is OFF is also `null`: nothing is bound to the old port, so
 * there is nothing to rebind, and the new number simply takes effect the next
 * time the toggle goes on.
 */
export function lanBindingChange(
  previous: DesktopConfig,
  next: DesktopConfig,
): ServerBinding | null {
  const was = previous.lanShare;
  const now = next.lanShare;
  if (was.enabled === now.enabled && was.port === now.port) return null;
  if (!was.enabled && !now.enabled) return null;
  return lanBindingFor(next);
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
  /**
   * Queue a restart of this app, then end it — §14's "relaunch", and the only
   * way §6 step 1's data-directory change can take effect.
   *
   * On the host rather than a free function because it is app lifecycle, and
   * because the boot sequence is now its second caller: §4's `relaunch()` port
   * was the first, and two Electron `app.relaunch()` call sites would be two
   * chances to forget the `quit()` that actually ends the process.
   */
  relaunch(): void;
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
   * §6 step 1: can the app actually use `dir` as its data directory? Creates it
   * (and its parents) when absent.
   *
   * A port, not an inline `mkdir`, for the reason everything else here is one:
   * this module holds the boot ORDER and touches no I/O, so a `node:fs` import
   * would make the sequence untestable in exactly the place a data-directory
   * change most needs a test.
   *
   * It must be answered BEFORE the write. A `dataDir` that cannot be created is
   * a config.json that boots into a crash screen on the very next launch — and
   * since the next launch is the whole point of a data-dir change, that failure
   * would arrive with no UI left to report it.
   */
  ensureDataDir(dir: string): Promise<{ ok: true } | { ok: false; reason: string }>;
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
  /** §6 step 1's data-directory change — gate, write, relaunch. */
  setDataDir: (opts: SetDataDirOptions) => Promise<SetDataDirResult>;
  /**
   * §14: the renderer's localized menu labels. Stores them and rebuilds the
   * native menu (see {@link DesktopBootDeps.installMenu}). Registered with the
   * §4 bridge like the other ports here, so `main/ipc.ts`'s `setMenuLabels`
   * handler routes a push straight to it.
   */
  setMenuLabels: (labels: DesktopMenuLabels) => void;
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
  /**
   * §8.3's collision pre-flight: can the child bind `host:port` right now?
   *
   * A port because it opens a real socket, which a unit suite cannot do
   * deterministically — a free port on the test runner is not a fact, it is a
   * race. `main/lan.ts`'s `probeBindable` is the production implementation and
   * explains why this runs BEFORE the restart rather than being discovered by
   * it.
   */
  probeLanPort: (host: string, port: number) => Promise<ProbeResult>;
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
   * §6 step 2 card 4: the path to `resources/demo/demo-seed.mjs`, which the
   * server imports to seed the demo database (11-T08).
   *
   * Optional for the same reason `staticRoot` is — the suites do not pass it —
   * but the shipped app always does ({@link bundledDemoSeedScript}). Omitted ⇒
   * the server registers no demo route and the wizard's fourth card is dead.
   */
  demoSeedScript?: string | undefined;
  /**
   * 32-T11: `resources/add-ons-bundle`, the pre-verified bundled add-on set the
   * embedded server seeds copy-if-absent at boot. Optional for the reason
   * `demoSeedScript` is — the suites do not pass it — but the shipped app
   * always does ({@link bundledAddOnsBundleDir}). Passing a path that does not
   * exist is fine (dev runs, where the fetch never ran): `buildServerEnv` emits
   * the variable only when the directory is really there.
   */
  bundledAddOnsDir?: string | undefined;
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
  /**
   * 11-T12 (§9). A FACTORY, for the same reason `createServerManager` is one:
   * the coordinator needs the `dataDir` (step 2) and the ServerManager (step 5),
   * neither of which exists when the deps are built.
   *
   * `electronBootDeps` supplies the parts that need Electron — the native
   * dialogs, `powerMonitor`, and the transport that reaches the server carrying
   * the WINDOW'S session cookie (see `backup.ts`'s header). The boot sequence
   * supplies the parts only it knows.
   */
  createBackup: (wiring: BackupWiring) => BackupCoordinator;
  /**
   * §14's native menu, (re)installed. A port because `Menu.setApplicationMenu`
   * needs a ready app and real Electron, and because the File items it wires
   * (§9's "Back up now…" / "Restore from backup…") only have handlers once the
   * coordinator above exists — which is why this is CALLED from the boot
   * sequence rather than at module scope in `menu.ts`.
   *
   * Takes BOTH the handlers and the {@link MenuTranslate} because §14's "menu
   * rebuilds on locale change" makes install a repeated act: the boot sequence
   * calls this once at step 5 with the en-US default, then again every time the
   * renderer pushes a new locale ({@link DesktopBridgeContext.setMenuLabels}),
   * carrying the same handlers and a fresh `t`.
   */
  installMenu: (opts: { handlers: MenuHandlers; t: MenuTranslate }) => void;
  /**
   * File → "Restore from backup…" — §4's `openFile({ kind: 'backup' })`.
   *
   * Separate from the coordinator because the coordinator takes a PATH: §9's
   * other two entry points (the launch argument, and Settings → Desktop →
   * Backups) already have one, and a `restoreFrom()` that opened its own dialog
   * could not serve them.
   */
  pickBackupFile: () => Promise<string | null>;
  /**
   * §11 (11-T16). Build the updater for this launch, or `null` when there must
   * not be one. A port — like `createServerManager` / `createBackup` — because
   * the mode lives in `config.json` (known at step 2) and the updater needs
   * electron-updater plus the ipc event sink, neither of which a unit suite can
   * supply.
   *
   * `null` is the CORRECTNESS contract for `disabled` (§11): the port resolves
   * the `ADMINIUM_DISABLE_UPDATES=1` override (a `process.env` fact this
   * Electron-free sequence must not read) and, on that path, never even loads
   * electron-updater — so an air-gapped install makes zero non-loopback requests.
   * The boot owns only WHEN this is called (step 5, after the config load that
   * carries the mode) and WHAT it wires to (the Help menu's "Check for updates…",
   * and — through the port's own closure — the ipc `updates` getter).
   */
  createUpdateManager: (input: { mode: UpdateMode }) => UpdateManager | null;
  /**
   * §11: does the env kill-switch (`ADMINIUM_DISABLE_UPDATES=1`) force updates
   * off for this launch? A `process.env` fact this Electron-free sequence must
   * not read itself — the same reason `createUpdateManager` resolves the override
   * behind its own port — so it is injected as a boot constant and carried into
   * the runtime snapshot (`DesktopRuntimeSnapshot.updatesDisabledByEnv`) so §13's
   * About panel reports the mode the updater actually runs in, not the raw config.
   */
  updatesDisabledByEnv: boolean;
}

/** What {@link DesktopBootDeps.createBackup} needs from the boot sequence (§9). */
export interface BackupWiring {
  /** The live `config.json` — `autoBackup`, and the redacted copy for the zip. */
  readConfig: () => DesktopConfig;
  /** §2.3 `dataDir`: where a restore unpacks and moves the old data aside. */
  dataDir: string;
  /** Stop/start/`metaVersion` — §9's restore drives the child through these. */
  server: BackupServerControl;
  /**
   * `http://127.0.0.1:<port>`, or `null` before the §2.2 step 7 handshake.
   *
   * A getter, not a string: the child listens on `:0` and comes back on a
   * DIFFERENT port after every restart (§2.2 step 9), so a captured origin would
   * be stale the first time the LAN toggle flipped — and a backup posting to a
   * dead port is a failure the user sees as "backup broken".
   */
  serverOrigin: () => string | null;
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
  /**
   * `null` until step 5, for the same reason `manager` is: §9's coordinator
   * needs the dataDir and the ServerManager. The file-argument router below is
   * installed at step 1 and reads this rather than closing over it — a
   * double-click that lands before the boot finishes must not be handed to
   * `undefined`.
   */
  let backup: BackupCoordinator | null = null;
  /** §9's croner handle. Stopped on quit so it cannot fire into a closing app. */
  let stopAutoBackup: (() => void) | null = null;
  /**
   * §11's updater, `null` until step 5 and `null` forever in `disabled` mode
   * (11-T16). Held here — rather than a step-5 const — for the quit hook below,
   * which `dispose()`s it so its 30 s / 24 h schedules cannot fire into a closing
   * app (the same reason `stopAutoBackup` lives at this scope).
   */
  let updateManager: UpdateManager | null = null;
  /**
   * Where the NEXT `ready` should land the window, consumed once (§8.3).
   *
   * A one-shot rather than a parameter because the `subscribe` listener that
   * navigates is a single handler for every restart in the app's life — a crash
   * recovery, the 3-in-60 s policy's re-fork, and §8.3's toggle all arrive at it
   * as the same `ready`. Only the toggle knows the user was mid-flow on a
   * particular page, so only the toggle leaves a note; everything else finds
   * `null` and gets `/`, which is the right answer for a restart nobody asked
   * for.
   */
  let pendingAppPath: string | null = null;

  /**
   * §14's menu state, held across rebuilds. `menuLabels` is the last locale the
   * renderer pushed (`null` ⇒ the en-US boot menu, §2.2 step 6); `menuHandlers`
   * is the command set assembled at step 5. "The menu rebuilds on locale change"
   * makes install a repeated act — a push after step 5 rebuilds with the new
   * labels and the SAME handlers — so both go through {@link rebuildMenu}, the
   * one place that turns the pair into an installed native menu. A push that
   * arrives before step 5 (it cannot: the renderer that sends it only loads at
   * step 8) would still be safe — the empty `menuHandlers` gives a titles-only
   * menu that step 5 immediately supersedes.
   */
  let menuLabels: DesktopMenuLabels | null = null;
  let menuHandlers: MenuHandlers = {};
  const rebuildMenu = (): void => {
    deps.installMenu({ handlers: menuHandlers, t: menuTranslator(menuLabels) });
  };

  /**
   * §2.2 step 1 / §9: what to do with a file the OS handed us.
   *
   * A `.zip` is a backup and belongs to §9's restore, which runs ENTIRELY in
   * this process — validate, confirm, stop, unpack, start — and needs no SPA at
   * all. That matters: `window.ts`'s `pendingFileArgument` note says delivering a
   * launch file to the renderer needs a new §4 bridge method, and for a backup it
   * turns out nothing does. Everything else (`.sqlite`, `.db`, `.sqlite3`) is
   * §6 step 2's "Open an existing SQLite file", which IS the wizard's, and is
   * still held for 11-T07 to collect.
   */
  const routeFileArgument = (file: string): void => {
    if (!file.toLowerCase().endsWith('.zip')) {
      windows.handleFileArgument(file);
      return;
    }
    const coordinator = backup;
    if (coordinator === null) {
      // Pre-step-5: nothing can restore yet. Hold it the same way a `.sqlite`
      // is held rather than dropping it silently — the boot below drains
      // `pendingFileArgument()` once the coordinator exists.
      windows.handleFileArgument(file);
      return;
    }
    void coordinator.restoreFrom(file);
  };

  /**
   * §8.3's toggle, end to end: "flipping the toggle updates `config.lanShare` …
   * and gracefully restarts the utilityProcess with `ADMINIUM_HOST=0.0.0.0`,
   * `ADMINIUM_PORT=4600`".
   *
   * ─── The order is the whole design, and each step earns its place ───────────
   *
   * 1. **Probe before writing.** §8.3 wants "an inline error with a 'Try 4601'
   *    suggestion", and only a failure that changes NOTHING can be rendered
   *    inline: the moment this function writes or restarts, the window navigates
   *    to a new origin (step 4) and the renderer awaiting this call is gone, so
   *    an error thrown after that point has nobody left to show it to. Probing
   *    first keeps the overwhelmingly common failure — a port something else
   *    already holds — inside one IPC round-trip with no side effects at all.
   *    See `lan.ts`'s `probeBindable` for why this is a pre-flight and not a
   *    lock.
   * 2. **Write, then restart.** The reverse order would leave a server bound to
   *    the LAN with a `config.json` that says it is not — and `config.json` is
   *    what the NEXT boot reads (§2.2 step 5), so a crash in the window between
   *    the two would resolve to "silently sharing on the next launch".
   * 3. **Revert on failure, both halves.** A restart that fails leaves the app
   *    with no server AND a config that will fail the same way at every future
   *    launch: a brick, made by a settings toggle. So the file goes back and the
   *    child is brought up on loopback, which is the bind that was working sixty
   *    milliseconds ago.
   * 4. The window's re-navigation is `subscribe`'s, not this function's — a
   *    restart produces a `ready` and that listener already exists to handle
   *    every one of them. All this does is leave {@link pendingAppPath} so the
   *    reload lands back on the panel.
   */
  const applyLanShare = async (
    previous: DesktopConfig,
    next: DesktopConfig,
    binding: ServerBinding,
  ): Promise<void> => {
    const target = manager;
    if (target === null) {
      // No child yet — a toggle during boot steps 1–4. There is nothing to
      // rebind because there is nothing bound; step 5 forks against this file.
      await deps.config.save(next);
      config = next;
      return;
    }

    // Step 1. Only when going ON: releasing a port cannot collide with anything.
    if (next.lanShare.enabled) {
      const probe = await deps.probeLanPort(binding.host, binding.port);
      if (!probe.ok) throw lanBindError(binding.port, probe);
    }

    // Step 2.
    await deps.config.save(next);
    config = next;
    pendingAppPath = LAN_SHARE_PATH;

    try {
      await target.restart(binding);
      // `subscribe` navigates on the resulting `ready`.
    } catch (error) {
      // Step 3. Put the file back FIRST: if the rebind below also fails, the
      // crash screen's Restart button re-forks from `config`, and it must find
      // the bind that worked rather than the one that just did not.
      pendingAppPath = null;
      await deps.config.save(previous);
      config = previous;
      try {
        await target.restart(lanBindingFor(previous));
      } catch (revertError) {
        // Both binds are gone. Nothing is listening and the window is pointed at
        // a dead port, so this is the one path here that owes the user a screen
        // — `restart()` rejects rather than emitting an exit, so `onExit` will
        // never fire and without this the app is a blank window forever.
        await windows.showCrash(crashFromStartError(revertError));
      }
      throw error;
    }
  };

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
        if (file !== null) routeFileArgument(file);
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
                // §11: a boot constant (the env var does not change mid-session),
                // so it is safe to read straight off the injected dep here — and
                // it makes `getRuntimeInfo` truthful the moment a runtime exists
                // (step 2), not only once the updater is built (step 5).
                updatesDisabledByEnv: deps.updatesDisabledByEnv,
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
          const previous = config;
          const next = applyConfigPatch(previous, patch);
          const binding = lanBindingChange(previous, next);
          if (binding === null) {
            await deps.config.save(next);
            config = next;
            return;
          }
          await applyLanShare(previous, next, binding);
        },
        /**
         * §6 step 1's "Change…", end to end: gate, write, relaunch.
         *
         * WHY THIS RELAUNCHES THE APP rather than restarting the child. The
         * server was forked against `ADMINIUM_DATA_DIR` at step 5 and derives
         * `ADMINIUM_META_DSN` from it; §9's BackupCoordinator captured the same
         * value at step 5 for the same reason. Both are snapshots of a decision
         * this boot already made, and there is no in-place way to un-make it —
         * which is precisely why §6 step 1 says to choose NOW, and calls a later
         * change "a guarded operation (quit-and-move instructions)".
         *
         * The wizard survives it because the wizard was never the thing that
         * knew: §6 gates `/desktop/setup` server-side on "desktop runtime + zero
         * users", so the relaunched app lands back in the wizard — at step 1,
         * now showing the directory the user picked.
         */
        setDataDir: async (input): Promise<SetDataDirResult> => {
          if (config === null) {
            throw new Error('the desktop config has not been loaded yet (§2.2 step 2).');
          }
          const dir = resolve(input.dir);
          // Nothing to do, and therefore nothing to relaunch for. This is the
          // wizard's ordinary Continue with the default directory untouched:
          // treating it as a change would restart the app on every first run.
          if (dir === config.dataDir) return { status: 'applied', dataDir: dir };

          // §6 step 1's blocking warning, enforced HERE rather than in the
          // renderer. The renderer cannot see `detectCloudSyncFolder`, so this
          // is the only place the check can be a gate instead of a suggestion.
          const warning = detectCloudSyncFolder(dir);
          if (warning !== null && input.acknowledgeCloudSync !== true) {
            return { status: 'cloud-sync-blocked', warning };
          }

          const probe = await deps.config.ensureDataDir(dir);
          if (!probe.ok) return { status: 'unusable', reason: probe.reason };

          // Write first, relaunch second — the whole point is that the NEXT boot
          // reads this. A relaunch before the write would silently discard it.
          const next: DesktopConfig = { ...config, dataDir: dir };
          await deps.config.save(next);
          config = next;
          host.relaunch();
          return { status: 'applied', dataDir: dir };
        },
        // §14: a locale push from the SPA. Store it and rebuild the native menu
        // with the same handlers — this is "the menu rebuilds on locale change",
        // and it is wired to the §4 `setMenuLabels` channel through `ipc.ts`.
        setMenuLabels: (labels) => {
          menuLabels = labels;
          rebuildMenu();
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
        // §9's schedule, before anything else: a 03:00 tick that landed during
        // teardown would post a backup to a server we are in the middle of
        // stopping, and the manager would classify the resulting failure as a
        // crash on the way out.
        stopAutoBackup?.();
        stopAutoBackup = null;
        // §11: cancel the updater's launch/periodic schedules and detach its
        // autoUpdater listeners on the same beat, so a check cannot fire into a
        // closing app. `null` in `disabled` mode and before step 5 — both no-ops.
        updateManager?.dispose();
        updateManager = null;
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

      // Step 5. Step 4's token is minted by the manager, once per FORK — see
      // `CreateServerManagerOptions.createBootToken`. The shell must therefore
      // read `manager.bootToken` at each navigation instead of closing over a
      // value: a `const` here would be a token every restart invalidates, and
      // (worse, before the manager owned the mint) one that every restart
      // re-armed for a second passwordless session.
      manager = deps.createServerManager({
        entry: deps.serverEntry,
        dataDir: loadedConfig.dataDir,
        secret,
        createBootToken: deps.createBootToken,
        logsDir: deps.logsDir,
        telemetryOptIn: loadedConfig.telemetryOptIn,
        // §5's mirror. The child writes this into `adminium_settings` at boot
        // and the auto-login route reads it back; without it the route refuses
        // the very token this boot puts in the window URL at step 8.
        singleUser: loadedConfig.singleUser,
        // §3: where the SPA is. See DesktopBootDeps.staticRoot.
        ...(deps.staticRoot === undefined ? {} : { staticRoot: deps.staticRoot }),
        // §6: where the demo seed script is. See DesktopBootDeps.demoSeedScript.
        ...(deps.demoSeedScript === undefined ? {} : { demoSeedScript: deps.demoSeedScript }),
        // 32-T11: where the bundled add-on set is. See DesktopBootDeps.bundledAddOnsDir.
        ...(deps.bundledAddOnsDir === undefined
          ? {}
          : { bundledAddOnsDir: deps.bundledAddOnsDir }),
        // §2.4: loopback unless the user opted into LAN share (§8.3). Omitting
        // both is not laziness — the manager defaults to 127.0.0.1 + port 0, so
        // the shell cannot bind every interface by forgetting something.
        ...(loadedConfig.lanShare.enabled
          ? { host: '0.0.0.0', port: loadedConfig.lanShare.port }
          : {}),
      });
      const startedManager = manager;

      // §9's coordinator, and §14's menu — both here, because both need the
      // manager that only just came into existence.
      //
      // THIS IS THE WIRING. `createBackupCoordinator` and `buildAppMenu` were
      // each called by NOTHING before this line, which meant §9's backup/restore
      // and the entire native menu bar were absent from every launch while both
      // modules compiled, unit-tested green, and looked finished. That is the
      // failure this codebase has now shipped five times (`registerIpcHandlers`
      // never called; `staticRoot` never passed). The grep that proves it is
      // fixed is a grep for THIS call site, not a passing test.
      backup = deps.createBackup({
        // `config`, NOT `loadedConfig`. The two differ the moment the settings
        // panel writes: `writeConfig` reassigns the outer `config`, and
        // `loadedConfig` is the step-2 snapshot the rest of this function uses
        // for values the SERVER FORK froze anyway (dataDir, singleUser). §9's
        // scheduler is the opposite case — it re-reads on every tick precisely
        // so "Automatic backups: off" takes effect at 03:00 tonight rather than
        // next launch. Handing it the snapshot would make that toggle, and
        // `keep`, silently inert.
        readConfig: () => config ?? loadedConfig,
        // dataDir is genuinely immutable for this boot: the server was forked
        // against it at step 5, and §6 step 1 makes changing it a
        // quit-and-move operation. The snapshot is the honest source here.
        dataDir: loadedConfig.dataDir,
        server: {
          stop: () => startedManager.stop(),
          start: async () => {
            const ready = await startedManager.start();
            return { metaVersion: ready.metaVersion };
          },
          // §2.2 step 7's handshake is the only source (`protocol.ts`); `null`
          // before it, which `validateArchive` turns into a refusal rather than
          // a skipped check.
          metaVersion: () =>
            startedManager.state.status === 'ready' ? startedManager.state.metaVersion : null,
        },
        serverOrigin: () =>
          startedManager.state.status === 'ready'
            ? `http://127.0.0.1:${String(startedManager.state.port)}`
            : null,
      });
      const coordinator = backup;

      // §11's updater (11-T16). Created HERE, after the config load that carries
      // `updates.mode`, and BEFORE the menu that wires its "Check for updates…"
      // item. THIS IS THE WIRING: `deps.createUpdateManager` is the same class of
      // call as `createBackup` above, and the port feeds two consumers from one
      // manager — the ipc `updates` getter (so §4's checkForUpdates /
      // downloadUpdate / quitAndInstall reach it from the SPA) and the Help menu
      // below. `null` in `disabled` mode (or under `ADMINIUM_DISABLE_UPDATES=1`,
      // which the port resolves): the correctness rule (§11) — nothing is
      // constructed, so an air-gapped install makes zero non-loopback requests.
      // `notify` mode schedules its own launch + daily checks; nothing here
      // drives them.
      updateManager = deps.createUpdateManager({ mode: loadedConfig.updates.mode });

      // §14: assemble the menu's command handlers ONCE, here at step 5 — File's
      // backup/restore (§9's coordinator), Help's Show Logs, and (when the
      // updater exists) Help's Check for updates. `rebuildMenu` turns them plus
      // the current labels into the installed menu; a later locale push
      // (`setMenuLabels`) rebuilds with these SAME handlers and the new `t`.
      //
      // THIS IS THE WIRING: `deps.installMenu` is reached only through
      // `rebuildMenu`, and `rebuildMenu` was called by nothing before this line —
      // so the whole native menu bar, and its locale rebuild, would otherwise be
      // absent from every launch while `menu.ts` compiled and unit-tested green.
      menuHandlers = {
        backupNow: () => void coordinator.backupNow(),
        restore: () => {
          void (async () => {
            // The open dialog is §4's, and the coordinator does not own one —
            // it takes a path (§9's launch-argument path hands it one directly).
            const file = await deps.pickBackupFile();
            if (file !== null) await coordinator.restoreFrom(file);
          })();
        },
        showLogs: () => void deps.showLogs(),
        // §13 / §14: "About Adminium" opens the SAME `/about` panel the Settings
        // surface uses. A window navigation, not an IPC push to the SPA: the
        // route exists and the server serves it, so this cannot regress into a
        // dead item the way a push whose renderer subscriber went unmounted would
        // (the exact "green but broken" shape §7's crash-page note warns about).
        // Guarded on `ready` because before the handshake there is no origin to
        // navigate to — the item is reachable only after the app is up anyway.
        about: () => {
          const state = startedManager.state;
          if (state.status !== 'ready') return;
          void windows.loadApp(
            appUrl({ host: state.host, port: state.port, firstRun: false, path: ABOUT_PATH }),
          );
        },
        // §11 / §14 Help → "Check for updates…". In `manual` mode this is the
        // ONLY check path; in `notify` it supplements the scheduled ones. `null`
        // (disabled) leaves the item disabled via `menu.ts`'s unwired-handler
        // rule. An `available` result surfaces through the ONE notification
        // pipeline (`onUpdateEvent`); a `none`/`error` result is the SPA button's
        // to render (§13 About / Settings), not this native item's.
        ...(updateManager === null
          ? {}
          : { checkForUpdates: (): void => void updateManager?.checkForUpdates() }),
      };
      rebuildMenu();

      // §9's daily 03:00 auto-backup. Started here rather than lazily on the
      // first tick because a schedule nobody constructs is a schedule that never
      // fires — the same bug as the two above, one layer down.
      stopAutoBackup = coordinator.startAutoBackup();

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
      //
      // Read from the manager, never cached: it minted this token for the child
      // that just reported `ready`, and the next restart mints another.
      await windows.loadApp(
        appUrl({
          host: ready.host,
          port: ready.port,
          firstRun,
          ...bootTokenParam(loadedConfig.singleUser, manager.bootToken),
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
        // §8.3's toggle leaves a path here; every other restart finds none and
        // lands on `/`. Consumed as soon as a `ready` arrives — INCLUDING the
        // one the port guard below discards, which is the case that matters: a
        // rebind that happened to land on the same port navigates nowhere, and a
        // note left behind by it would hijack the next crash recovery's URL.
        const path = pendingAppPath;
        pendingAppPath = null;
        if (runtime !== null && state.port === runtime.serverPort) return;
        runtime = runtime === null ? runtime : { ...runtime, serverPort: state.port };
        void windows.loadApp(
          appUrl({
            host: state.host,
            port: state.port,
            firstRun,
            // The RESTARTED child's token, not the one this app launched with.
            // `manager` re-mints per fork, so the URL below carries a token the
            // process now listening has actually heard of — and the previous
            // one is dead rather than re-armed for a second free session (§5).
            ...bootTokenParam(loadedConfig.singleUser, manager?.bootToken ?? null),
            ...(path === null ? {} : { path }),
          }),
        );
      });

      // A file handed to us on the command line is a restore/open request (§9),
      // and it can only be acted on once the SPA is up to render the flow.
      const launchFile = extractFileArgument(host.argv);
      if (launchFile !== null) routeFileArgument(launchFile);
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
 * §8.3's port collision, as the code + message §4's bridge carries.
 *
 * The suggested port is IN THE MESSAGE rather than in a structured field because
 * the wire has no room for one: `main/ipc.ts` maps a throw onto `{ code,
 * message }` and nothing else survives the crossing (see `api.d.ts`'s
 * `DesktopBridgeErrorLike` on why even `code` is duplicated into the prefix). So
 * the settings form parses the number back out — one regex, pinned by a test on
 * both sides — which is a smaller price than a second error channel.
 *
 * `refused` is deliberately NOT `LAN_PORT_IN_USE`. An EACCES on a privileged
 * port, or a bind the OS rejects for its own reasons, is not a collision, and
 * "Try 4601" is advice that cannot work for it: 4601 is privileged too if 4600
 * was. It falls through as `INTERNAL` carrying the OS's own message, which at
 * least names the real problem.
 */
function lanBindError(port: number, probe: Extract<ProbeResult, { ok: false }>): Error {
  if (probe.reason !== 'in-use') {
    return new Error(
      `The Adminium server could not bind port ${String(port)}: ${probe.message}`,
    );
  }
  const suggestion = suggestNextPort(port);
  return new Error(
    `${LAN_PORT_IN_USE}: Port ${String(port)} is already in use by another program.` +
      (suggestion === null ? '' : ` Try ${String(suggestion)}.`),
  );
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

/**
 * `resources/demo/demo-seed.mjs` — the §6 step 2 seed script the server imports
 * to build the demo database (11-T08).
 *
 * `out/main/` → `../../resources/demo/`, which resolves identically in dev (the
 * repo's `apps/desktop/resources/`) and in a packaged build (§10's
 * `files: [out/**, resources/**]` keeps that relative layout inside the app).
 *
 * PACKAGING NOTE for 11-T13: `resources/demo/**` must be listed in
 * `asarUnpack`. The server reaches this file with a real `import()`, and an
 * asar-packed path is not something the ESM loader can be relied on to open —
 * unpacked, it is an ordinary file on disk and the import is ordinary too.
 */
function bundledDemoSeedScript(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'resources',
    'demo',
    'demo-seed.mjs',
  );
}

/**
 * `resources/add-ons-bundle/` — the pre-verified bundled add-on set (32-T11):
 * six first-party tarballs + `.integrity` sidecars the desktop-release workflow
 * fetches against the exact pins in `scripts/release/add-ons-bundle.json`.
 *
 * The same `../../resources` arithmetic {@link bundledDemoSeedScript} uses, for
 * the same both-worlds reason: §10's `files: [out/**, resources/**]` keeps the
 * relative layout inside a packaged app. In dev the directory simply does not
 * exist (the fetch output is .gitignored), and `buildServerEnv` omits
 * `ADMINIUM_BUNDLED_ADD_ONS` for an absent directory, so the server's own
 * CWD-relative default stands and the boot seed no-ops.
 */
function bundledAddOnsBundleDir(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'resources',
    'add-ons-bundle',
  );
}

/**
 * `out/main/` → `../../resources/` — §13's `LICENSE` and `THIRD-PARTY-NOTICES.txt`.
 *
 * The same `../../resources` arithmetic {@link bundledDemoSeedScript} uses, and
 * the same reason it holds in both dev and a packaged build: §10's
 * `files: [out/**, resources/**]` keeps that relative layout inside the app.
 * `scripts/generate-notices.mjs` writes both files here at build; a dev run that
 * never ran it legitimately has neither, and {@link readBundledDocument} returns
 * `null` rather than throwing.
 */
function bundledResourcesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources');
}

/** §13's `readBundledText` kind → the file `generate-notices.mjs` stages. */
const BUNDLED_DOCUMENT_FILE: Readonly<Record<DesktopBundledTextKind, string>> = {
  license: 'LICENSE',
  'third-party-notices': 'THIRD-PARTY-NOTICES.txt',
};

/**
 * §13's in-app licence viewers, over the packaged resources dir. `null` — not a
 * throw — when the file is absent: the notices are a BUILD artifact
 * (`generate-notices.mjs`), so a `pnpm --filter @adminium/desktop dev` run has
 * none, and the viewer shows "not available in this build" rather than an error.
 * `readFile` also fails closed on anything unreadable, which is the same answer.
 */
async function readBundledDocument(kind: DesktopBundledTextKind): Promise<string | null> {
  try {
    return await readFile(join(bundledResourcesDir(), BUNDLED_DOCUMENT_FILE[kind]), 'utf8');
  } catch {
    return null;
  }
}

/**
 * §13's "Copy diagnostic info … dataDir size" — the total bytes under `dir`,
 * walked breadth-first with a bounded, error-tolerant traversal.
 *
 * Off the main thread's critical path (it answers an on-demand button, not a
 * paint), and every failure — an unreadable entry, a vanished file mid-walk, a
 * symlink loop the depth cap severs — is swallowed into "count what we can":
 * a diagnostics figure is a rough total the user pastes into a bug report, and
 * a partial one is worth more than an error where a number should be. Symlinks
 * are NOT followed (`stat` on the entry, not its target's tree) and depth is
 * capped, so the walk terminates on any directory shape.
 */
async function directorySizeBytes(dir: string): Promise<number> {
  const MAX_DEPTH = 32;
  let total = 0;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          /* vanished mid-walk — count what we can */
        }
      }
    }
  };
  await walk(dir, 0);
  return total;
}

/**
 * §9's backup transport: `POST /api/v1/desktop/backup`, carrying the WINDOW'S
 * session cookie.
 *
 * ─── Why the cookie, spelled out where it happens ────────────────────────────
 *
 * The route is session-guarded (§9), and the main process has no session of its
 * own — but it owns the one the window uses. `session.defaultSession.cookies` is
 * the same jar the SPA's `adminium_session` cookie landed in when §5's
 * boot-token exchange ran, and reading it here is what makes the backup run as
 * THE SIGNED-IN USER: the audit row names a person, `adminium_notifications` has
 * an inbox to land in (`user_id` is NOT NULL), and §5's "Require login on this
 * device" keeps meaning something. No session ⇒ `null` ⇒ the coordinator says
 * "sign in first", which is the right answer for an archive containing every row
 * in the install.
 *
 * The cookie is read PER CALL, never cached: sessions expire, the user can sign
 * out, and a captured `Cookie` header would turn a 401 into a mystery.
 */
function electronBackupTransport(serverOrigin: () => string | null): BackupTransport {
  return async (body) => {
    const origin = serverOrigin();
    // Pre-handshake, or mid-restart. Not an error — there is simply no server to
    // ask yet, and the schedule's next tick will find one.
    if (origin === null) return null;

    const cookies = await session.defaultSession.cookies.get({
      url: origin,
      name: SESSION_COOKIE_NAME,
    });
    const cookie = cookies[0];
    if (cookie === undefined) return null;

    const response = await fetch(`${origin}/api/v1/desktop/backup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${cookie.name}=${cookie.value}`,
      },
      body: JSON.stringify(body),
    });

    // 401 ONLY. It means "the cookie we found is stale", which is the same
    // user-visible fact as having no cookie at all: sign in.
    //
    // 403 is NOT that, and collapsing the two would be actively misleading. The
    // route returns 403 for a non-loopback peer AND for a signed-in user
    // without `system:settings:manage` — so an editor clicking "Back up now"
    // would be told to "sign in first" while already signed in, advice that
    // cannot work and that hides the real answer (they need a super admin).
    // It falls through to the error path below, where the server's own message
    // — written for a person — is what they see.
    if (response.status === 401) return null;
    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        `the Adminium server refused the backup (HTTP ${String(response.status)})${
          detail === null ? '' : `: ${detail}`
        }`,
      );
    }
    // Parsed, not cast. This is a cross-process boundary and `main/ipc.ts`'s
    // rule applies to it: a shape change in the route should surface here,
    // naming the field, rather than as an undefined deref inside the move.
    const parsed = backupReplySchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `the Adminium server sent a backup reply this build does not understand: ${parsed.error.issues
          .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data.data;
  };
}

/**
 * The §1.4 error envelope's `message`, or `null`.
 *
 * The envelope is `{ error: { code, message, requestId } }`; showing a user the
 * raw JSON of that would be worse than showing them nothing. Falls back to the
 * body text for a failure that never reached the error handler (a proxy, a
 * socket reset).
 */
async function readErrorMessage(response: Response): Promise<string | null> {
  const body = await response.text().catch(() => '');
  if (body === '') return null;
  try {
    const envelope = JSON.parse(body) as { error?: { message?: unknown } };
    const message = envelope.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body.slice(0, 400);
}

/**
 * §9's reply (`routes/desktop/schema.ts`).
 *
 * The manifest arm REUSES `backup-archive.ts`'s schema rather than restating it:
 * that module already mirrors the server's contract and
 * `backup-format-parity.test.ts` already pins the two together, so borrowing it
 * gets the strictness for free and keeps the number of copies at two. A third
 * — here, unpinned — is exactly how the set would drift.
 */
const backupReplySchema = z.object({
  data: z.object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    manifest: backupManifestSchema,
    rotated: z.array(z.string()),
  }),
});

/**
 * §12's grant reader: `GET /api/v1/desktop/capability-grants`, carrying the
 * WINDOW'S session cookie. `electronBackupTransport`'s sibling, and its reasons
 * are the same one word for word — the route is session-guarded, main has no
 * session of its own but owns the window's cookie jar, and the cookie is read
 * PER CALL because a captured one turns a stale-session 401 into a mystery.
 *
 * The `CapabilityHost` calls this on every invoke to gate against a live grant
 * (`main/capabilities/host.ts`). `null` — no server yet, no cookie, or a 401 — is
 * read by the host as "no grants", so an invoke made before sign-in (or after a
 * revoke that also killed the session) fails closed with CAPABILITY_NOT_GRANTED
 * rather than reaching a provider.
 */
function electronCapabilityGrantReader(
  serverOrigin: () => string | null,
): CapabilityGrantReader {
  return async () => {
    const origin = serverOrigin();
    if (origin === null) return null;

    const cookies = await session.defaultSession.cookies.get({
      url: origin,
      name: SESSION_COOKIE_NAME,
    });
    const cookie = cookies[0];
    if (cookie === undefined) return null;

    const response = await fetch(`${origin}/api/v1/desktop/capability-grants`, {
      method: 'GET',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    // 401 = the cookie is stale: the same user-visible fact as no cookie, and the
    // same answer — nothing is granted to honour until sign-in. Any other non-2xx
    // is a real fault the host logs and surfaces as INTERNAL.
    if (response.status === 401) return null;
    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        `the Adminium server refused the capability-grant read (HTTP ${String(response.status)})${
          detail === null ? '' : `: ${detail}`
        }`,
      );
    }
    // Parsed, not cast — `main/ipc.ts`'s cross-process rule: a shape change in the
    // route surfaces here naming the field, not as an undefined deref in the gate.
    const parsed = capabilityGrantsReplySchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `the Adminium server sent a capability-grant reply this build does not understand: ${parsed.error.issues
          .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data.data.grants;
  };
}

/**
 * §12's grant-list reply (`routes/desktop-capabilities/schema.ts`).
 *
 * A local mirror, like `backupReplySchema` above and for the same reason: a
 * runtime import of the server's schema would pull Fastify into the main process.
 * The shapes are pinned by `host.ts`'s `_CapabilityGrantMatchesServer` assertion,
 * so this stays honest.
 */
const capabilityGrantsReplySchema = z.object({
  data: z.object({
    grants: z.array(
      z.object({
        manifestId: z.string(),
        capabilityId: z.string(),
        grantedAt: z.number(),
      }),
    ),
  }),
});

/**
 * The session cookie's name (`auth/sessions.ts`).
 *
 * Restated rather than imported for the reason `backup-archive.ts`'s schema is:
 * an `import { SESSION_COOKIE } from '@adminium/server'` would load Fastify into
 * the main process to read a string. Exported so
 * `backup-format-parity.test.ts` can pin it against the server's — a typo here
 * is not a crash, it is a backup that silently reports "sign in first" forever.
 */
export const SESSION_COOKIE_NAME = 'adminium_session';

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
    async ensureDataDir(dir) {
      try {
        // `recursive` makes an existing directory a success rather than EEXIST,
        // which is the common case: the user picks a folder that is already
        // there. The write probe is separate because `mkdir` on an existing
        // read-only directory succeeds — the failure §6 step 1 must catch is a
        // location the app cannot WRITE, and only writing proves that.
        await mkdir(dir, { recursive: true });
        await access(dir, constants.W_OK);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
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
  const dialogs = createNativeDialogs();
  /** §14's relaunch — one implementation, two callers (the host and §4's port). */
  const relaunchApp = (): void => {
    // `relaunch()` only QUEUES the restart. It is `quit()` that ends this
    // process, and the `before-quit` hook that stops the server gracefully on
    // the way out.
    app.relaunch();
    app.quit();
  };
  const showLogs = async (): Promise<void> => {
    // §9: "Help → 'Show logs' reveals the folder." `openPath` returns a
    // NON-EMPTY string on failure rather than throwing, which is a shape worth
    // logging: a bridge that reports success while nothing opened is worse than
    // one that reports the reason.
    const error = await shell.openPath(logsDir);
    if (error !== '') mainLog(`[main] could not open the logs folder: ${error}`);
  };

  // ── §11's updater plumbing (11-T16) ──
  // electron-updater is a CJS dependency; `require` it lazily so a unit test that
  // imports this module never loads it, and — the correctness rule — so a
  // `disabled` boot never even resolves it (`createUpdateManager`'s `getUpdater`
  // below is the only reader, and `buildUpdateManager` skips it in disabled mode).
  const requireFromMain = createRequire(import.meta.url);
  /**
   * The ONE update-notification sink (§4 `onUpdateEvent`), assigned when
   * `registerBridge` registers the ipc handlers (their typed `emitUpdateEvent`).
   * A no-op until then; `registerBridge` (boot step 2) always runs before the
   * step-5 `createUpdateManager` call whose `emit` closes over this.
   */
  let emitUpdateEvent: (event: DesktopUpdateEvent) => void = () => {};
  /**
   * The live updater, so the ipc `updates` getter can reach it after step 5.
   * `null` before then, and forever in `disabled` mode (§11) — which is exactly
   * the `UNAVAILABLE` the getter's consumers expect.
   */
  let updateManager: UpdateManager | null = null;

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
      relaunch: relaunchApp,
    },
    config: electronConfigPort(userDataDir, mainProcessConfigLogger(mainLog)),
    windows,
    logsDir,
    showLogs,
    createServerManager,

    // ── §11's updater (11-T16) ──
    // Delegates to `updates.ts`'s pure factory, adding the three parts only this
    // Electron side can: the env override (`process.env`), the lazily-`require`d
    // electron-updater, and the platform's self-replace capability.
    createUpdateManager: ({ mode }) => {
      updateManager = buildUpdateManager({
        // The env kill-switch is a `process.env` fact the Electron-free boot
        // sequence must not read; resolve it HERE. `disabled` ⇒ `buildUpdateManager`
        // returns null WITHOUT calling `getUpdater`, so electron-updater is never
        // even `require`d and never touches the network (§11 correctness rule).
        mode: resolveUpdateMode(mode, process.env),
        getUpdater: (): UpdaterPort => {
          // Reading the `autoUpdater` export CONSTRUCTS the platform updater
          // (§11 warns it checks on construction in some configs), so this runs
          // only for notify/manual, at most once — never in `disabled`, never in
          // the vitest program that imports this module.
          const updaterModule: unknown = requireFromMain('electron-updater');
          return (updaterModule as { autoUpdater: unknown }).autoUpdater as UpdaterPort;
        },
        // The ONE §4 notification pipeline. `emitUpdateEvent` is bound by
        // `registerBridge` (boot step 2), which always runs before this (step 5).
        emit: (event) => emitUpdateEvent(event),
        canSelfUpdate: canSelfUpdate(process.platform, process.env),
        log: mainLog,
        // Chromium's network stack, NOT Node's. electron-updater fetches the
        // channel file and the installer through `electron.net`, which honours
        // the system/PAC proxy, proxy authentication and the OS trust store;
        // Node's global `fetch` (undici) honours none of those. Resolving the
        // release on undici while downloading it on Chromium would mean that on
        // any managed machine — corporate proxy, TLS-intercepting middlebox —
        // every check fails at the resolve step even though the download would
        // have worked. `net.fetch` is `fetch`-shaped, so the port's type is
        // unchanged and the unit suite keeps its plain-`fetch` default.
        fetchImpl: (input, init) =>
          (requireFromMain('electron') as typeof import('electron')).net.fetch(
            input as string,
            init,
          ),
      });
      return updateManager;
    },
    // §11: the env kill-switch as a boot constant for the runtime snapshot.
    // Reuses `resolveUpdateMode`'s exact `ADMINIUM_DISABLE_UPDATES=1` rule (a
    // truthy-string check would let `=0` disable updates) so the About panel and
    // the updater agree on what "air-gapped" means.
    updatesDisabledByEnv: resolveUpdateMode('notify', process.env) === 'disabled',

    // ── §9's backup/restore (11-T12) ──
    pickBackupFile: () => dialogs.openFile({ kind: 'backup' }),
    createBackup: (wiring) =>
      createBackupCoordinator({
        readConfig: wiring.readConfig,
        // `redactConfig` and not a local re-implementation: `main/config.ts`
        // builds the redacted body as an explicit ALLOW-LIST precisely so a
        // secret-bearing field added later cannot leak by default, and there
        // must be exactly one function that decides that. The server asserts on
        // receipt regardless (`assertNoSecrets`), which is the belt to this
        // brace.
        redactConfig,
        transport: electronBackupTransport(wiring.serverOrigin),
        dialogs: {
          saveFile: (opts) => dialogs.saveFile(opts),
          showItemInFolder: (path) => dialogs.showItemInFolder(path),
          confirm: async (opts) => {
            const parent =
              BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
            const options: Electron.MessageBoxOptions = {
              type: 'warning',
              buttons: [opts.confirmLabel, opts.cancelLabel],
              // Cancel is the DEFAULT and the escape route. This dialog replaces
              // every database in the install; the button a stray Return key
              // presses must be the one that does nothing.
              defaultId: 1,
              cancelId: 1,
              title: opts.title,
              message: opts.title,
              detail: opts.message,
            };
            const result =
              parent === null
                ? await dialog.showMessageBox(options)
                : await dialog.showMessageBox(parent, options);
            return result.response === 0;
          },
          notify: async (opts) => {
            const parent =
              BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
            const options: Electron.MessageBoxOptions = {
              type: opts.kind === 'error' ? 'error' : 'info',
              buttons: ['OK'],
              title: opts.title,
              message: opts.title,
              detail: opts.message,
            };
            if (parent === null) await dialog.showMessageBox(options);
            else await dialog.showMessageBox(parent, options);
          },
        },
        server: wiring.server,
        dataDir: wiring.dataDir,
        // §9's "first idle moment after 03:00". `powerMonitor` is a main-process
        // API and has no equivalent inside the utilityProcess — which is the
        // reason the schedule lives here at all (see `backup.ts`'s header).
        idle: {
          isIdle: () =>
            Promise.resolve(powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS),
          wait: (ms) =>
            new Promise((resolve_) => {
              setTimeout(resolve_, ms);
            }),
        },
        log: mainLog,
      }),

    // ── §14's native menu ──
    // `isDev`: §14 allows Toggle Developer Tools "in dev builds only".
    // `app.isPackaged` is Electron's own answer and cannot be spoofed by an env
    // var a user copied off a forum, which is what makes it the right gate for a
    // menu item that runs arbitrary script against the loopback origin (§2.4).
    installMenu: ({ handlers, t }) => {
      buildAppMenu({
        platform: process.platform,
        isDev: !app.isPackaged,
        handlers,
        // §14's localized labels, resolved by the renderer and pushed over
        // `setMenuLabels`; `menuTranslator(null)` (the boot menu) falls back to
        // en-US. The boot sequence rebuilds through this same port on every
        // locale change.
        t,
      });
    },
    createBootToken: generateBootToken,
    // §8.3's collision pre-flight, on a real socket. Not `probeBindable`
    // directly: the port's signature is `(host, port)` and `probeBindable`'s
    // third parameter is its own test seam, which the boot sequence has no
    // business forwarding.
    probeLanPort: (host, port) => probeBindable(host, port),
    serverEntry: bundledServerEntry(),
    staticRoot: bundledStaticRoot(),
    demoSeedScript: bundledDemoSeedScript(),
    bundledAddOnsDir: bundledAddOnsBundleDir(),

    registerBridge: (context) => {
      const handlers = registerIpcHandlers({
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
        /**
         * §8.3's "reachable URLs … for each non-internal interface, via
         * `os.networkInterfaces()`".
         *
         * THIS IS THE WIRING. `main/ipc.ts` has accepted this port since 11-T04
         * and nothing ever passed it, so its `?? (() => [])` default answered
         * every call: `getRuntimeInfo().lanShare.urls` was `[]` in every build
         * that has ever run, and the panel §8.3 describes had nothing to list.
         * Another unused export that typechecks — the failure this codebase has
         * now shipped five times.
         *
         * `context.readConfig()` per call, not a captured port: the number the
         * user just typed into the panel is in `config.json`, and `ipc.ts` only
         * reaches this getter once it has already read the config and found
         * sharing ON — so there is no pre-boot call to guard against here.
         */
        lanShareUrls: () => lanShareUrls(context.readConfig().lanShare.port),
        dialogs: createNativeDialogs(),
        /**
         * §11 (11-T16). A GETTER over the outer `updateManager`, which the
         * step-5 `createUpdateManager` port assigns AFTER this bridge registers
         * (registerBridge is boot step 2). Until then, and forever in `disabled`
         * mode, it reads `null` — the contract the three update channels answer
         * §4 `UNAVAILABLE` for, which also satisfies §11's correctness rule: an
         * updater that is never constructed cannot make a network request.
         */
        updates: () => updateManager,
        // §12's capability plumbing (11-T17). The host gates EVERY invoke on a
        // fresh read of the grant table over loopback — the same session-cookie
        // transport §9's backup uses — and the escpos stub is v1's one provider.
        // The origin is derived from the LIVE runtime snapshot, not captured: the
        // child's port moves on every restart (§2.2 step 9), so a captured string
        // would post to a dead port the first time LAN share flipped.
        capabilities: createCapabilityHost({
          readGrants: electronCapabilityGrantReader(() => {
            const rt = context.runtime();
            return rt === null || rt.serverPort < 0
              ? null
              : `http://127.0.0.1:${String(rt.serverPort)}`;
          }),
          providers: [createEscposPrinterProvider()],
          log: mainLog,
        }),
        // §13's About panel data.
        //
        // THIS IS THE WIRING: `main/ipc.ts` registered the two channels the moment
        // it was written, but they reject with §4's INTERNAL "no port" until this
        // object supplies one — the About panel's "Copy diagnostic info" and its
        // two licence viewers would be dead the same way `getRuntimeInfo`'s
        // `lanShareUrls` was before it got a getter here.
        //
        // `getDiagnostics` walks the data directory for the ONE diagnostics figure
        // the renderer cannot compute; it reads `dataDir` off the live runtime
        // snapshot (`0` before boot, when there is nothing to size). `readBundledText`
        // serves the packaged `LICENSE` / `THIRD-PARTY-NOTICES.txt` — files only
        // the main process can locate — to §13's in-app viewers.
        getDiagnostics: async (): Promise<DesktopDiagnostics> => {
          const rt = context.runtime();
          return { dataDirBytes: rt === null ? 0 : await directorySizeBytes(rt.dataDir) };
        },
        readBundledText: (kind) => readBundledDocument(kind),
        showLogs,
        relaunch: relaunchApp,
        log: mainLog,
      });
      // §11: the ipc's typed emitter IS the ONE notification pipeline (§4
      // onUpdateEvent). Bind it now, before the step-5 `createUpdateManager`
      // whose `emit` forwards through it, so an update event reaches the SPA's
      // notification centre unchanged.
      emitUpdateEvent = handlers.emitUpdateEvent;
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
