// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Window management: BrowserWindow creation, the §2.4 security posture, the
 * navigation lockdown, window-state persistence (§14), and the two static
 * pre-server pages (§2.2 steps 6 and 9). Owned by 11-T05.
 *
 * The security rules here are §2.4's, and every one of them is also an
 * acceptance criterion, so they are written as data rather than as prose the
 * next editor can drift away from: {@link WEB_PREFERENCES} is the whole posture
 * in one frozen object, {@link decideNavigation} is the whole nav lockdown as a
 * pure function, and {@link ALLOWED_PERMISSIONS} is the (empty) permission
 * allow-list. All three are unit-tested — which matters more than usual here,
 * because a real Electron app cannot be launched headlessly (see
 * vitest.config.ts), so a posture regression would otherwise reach a packaged
 * build unchallenged.
 *
 * WHAT IS PURE AND WHY. Everything that decides something is a free function
 * over plain data; the factory at the bottom only wires those decisions to
 * Electron. The split is not decoration — `decideNavigation` is the function
 * standing between a hostile URL and the renderer, and it has to be testable
 * against a table of hostile URLs.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, dialog, screen, shell, type WebPreferences } from 'electron';

import type { OpenFileKind } from '../preload/api.js';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  configPathFor,
  loadConfig,
  saveConfig,
  type DesktopConfig,
} from './config.js';
import type { DesktopDialogs } from './ipc.js';

// ─── The §2.4 posture ────────────────────────────────────────────────────────

/**
 * §2.4, verbatim: "contextIsolation: true, nodeIntegration: false,
 * sandbox: true, webSecurity: true. No remote, no allowRunningInsecureContent."
 *
 * Stated exhaustively rather than relying on Electron's defaults. Several of
 * these ARE the defaults in Electron 43 — but "the default is safe" is a claim
 * about a dependency's minor version, and this object is a claim about our app.
 * The `satisfies` keeps it honest: a key Electron renames or drops fails
 * typecheck instead of silently becoming a no-op.
 */
export const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  // §2.4 does not name these two, but both re-open exactly what it closes:
  // `webviewTag` is a second navigable surface that the will-navigate lockdown
  // below does not see, and `experimentalFeatures` is unaudited web surface.
  webviewTag: false,
  experimentalFeatures: false,
}) satisfies WebPreferences;

/**
 * §2.4: "Permission request handler denies all Chromium permission prompts
 * (camera, geolocation, notifications use native paths instead)."
 *
 * Empty, and it is a `Set` rather than a bare `return false` so the shape of the
 * decision is "is it on the list?" from the start. When a native path does
 * eventually need a web permission, the diff is one entry here plus a test —
 * rather than someone reaching for `return true` inside the handler for the one
 * case they had in mind and widening it for every case they did not.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set<string>();

/** §2.4's handler, as a decision. Always `false` today — see {@link ALLOWED_PERMISSIONS}. */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

// ─── Navigation lockdown (§2.4) ──────────────────────────────────────────────

/**
 * The only schemes §2.4 lets out to the system browser: "every other URL goes to
 * `shell.openExternal` after an allowlist check (`https:` only)".
 *
 * `https:` only is the whole point, and the reason is that `shell.openExternal`
 * hands the string to the OS, which will happily act on schemes that are not the
 * web at all — `file:` opens a local file, and on Windows historic handlers have
 * turned `openExternal` into command execution. So this is not "which links are
 * useful", it is "which strings are safe to hand to the operating system".
 */
export const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set(['https:']);

export type NavigationDecision =
  /** Same origin as the running server: the SPA navigating within itself. */
  | { readonly action: 'allow' }
  /** Off-origin but safe to hand to the OS: opens in the system browser. */
  | { readonly action: 'external'; readonly url: string }
  /** Blocked outright, and not handed to the OS either. */
  | { readonly action: 'deny'; readonly reason: string };

/**
 * §2.4's navigation lockdown, for both `will-navigate` and
 * `setWindowOpenHandler`: "allow only `http://127.0.0.1:<port>`; every other URL
 * goes to `shell.openExternal` after an allowlist check (`https:` only)".
 *
 * @param target    the URL the renderer wants to go to.
 * @param appOrigin the serialized origin of the running server
 *                  (`http://127.0.0.1:<port>`), or `null` before the handshake
 *                  has resolved a port — during boot/crash there is no app
 *                  origin, and therefore nothing to allow.
 *
 * THE COMPARISON IS `URL.origin`, NEVER THE STRING. A `startsWith`/`includes`
 * check on the href is the classic form of this bug and it is wide open:
 * `http://127.0.0.1.evil.com/` starts with `http://127.0.0.1`, and
 * `https://evil.com/#http://127.0.0.1:5173` contains it. Parsing first means the
 * host is whatever the URL parser says it is — the same answer Chromium will
 * reach — rather than whatever the substring suggests. `origin` also pins the
 * PORT, so a second local service on another port is not our app either.
 *
 * AND THE SCHEME IS CHECKED SEPARATELY, because matching the origin is not
 * enough on its own. Some schemes INHERIT the origin of the URL inside them:
 * `new URL('blob:http://127.0.0.1:52341/…').origin` is `http://127.0.0.1:52341`,
 * exactly like the app's. So an origin-only check says "same origin, allow" and
 * navigates the window to a document the page minted with `URL.createObjectURL`
 * — attacker-authored markup running INSIDE the origin that holds the session
 * cookie. §2.4 says "allow only `http://127.0.0.1:<port>`", and a `blob:` URL is
 * not that, whatever its origin serializes to. Requiring the scheme to match the
 * app's closes `blob:` and anything else that inherits an origin.
 *
 * Note the ordering: an unparseable or non-`https:` URL reaches `deny` and is
 * NOT passed to `openExternal`. `javascript:`, `data:` and `file:` therefore go
 * nowhere at all, which is the only correct destination for them.
 */
export function decideNavigation(target: string, appOrigin: string | null): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { action: 'deny', reason: 'unparseable URL' };
  }

  // `URL.origin` serializes to the string "null" for opaque origins (`data:`,
  // `javascript:`, `file:`), so an `appOrigin` that was somehow "null" would
  // make all three same-origin. Parsing it instead of comparing strings gets
  // that for free — "null" does not parse — and yields the scheme to match.
  const app = appOrigin === null ? null : safeParse(appOrigin);
  if (app !== null && url.protocol === app.protocol && url.origin === app.origin) {
    return { action: 'allow' };
  }

  if (EXTERNAL_SCHEMES.has(url.protocol)) {
    return { action: 'external', url: url.toString() };
  }

  return { action: 'deny', reason: `blocked ${url.protocol} navigation to ${url.host || target}` };
}

/** `new URL`, as a value rather than an exception. */
function safeParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The loopback origin nav is locked to, from a URL the boot sequence produced
 * (`appUrl()` in index.ts). Returns `null` for anything unparseable or opaque,
 * which {@link decideNavigation} reads as "allow nothing".
 */
export function originOf(url: string): string | null {
  const parsed = safeParse(url);
  if (parsed === null) return null;
  return parsed.origin === 'null' ? null : parsed.origin;
}

// ─── Crash-page actions (§2.2 step 9) ────────────────────────────────────────

/** The actions §2.2 step 9 puts on the crash page. */
export type CrashAction = 'retry' | 'logs' | 'quit';

const CRASH_ACTIONS: ReadonlySet<string> = new Set<CrashAction>(['retry', 'logs', 'quit']);

/**
 * Reads a crash-page button press out of a navigation target, or `null` if the
 * navigation is not one.
 *
 * WHY A NAVIGATION AND NOT IPC. crash.html is shown when the server could not
 * start, so it must work when everything else is broken — and it is loaded from
 * `file://`, where §4's preload bridge (a loopback-page affordance, and 11-T04's
 * to define) is neither available nor something to grant to a page that renders
 * a raw server log excerpt. Its buttons are therefore plain
 * `<a href="?action=retry">` links: the click fires `will-navigate`, this
 * function reads it, and the handler preventDefaults. The page needs no script
 * of its own and runs under `script-src 'none'`, which for a page whose whole
 * job is to display untrusted-shaped log text is worth more than the
 * convenience of a click handler.
 *
 * Only same-document `file:` targets qualify, so this is not reachable from the
 * loopback SPA: a page on another origin navigating to `?action=quit` resolves
 * it against ITS origin, not `file:`, and falls through to the normal policy.
 */
export function parseCrashAction(target: string, crashPageUrl: string): CrashAction | null {
  let url: URL;
  let page: URL;
  try {
    url = new URL(target);
    page = new URL(crashPageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || url.pathname !== page.pathname) return null;
  const action = url.searchParams.get('action');
  return action !== null && CRASH_ACTIONS.has(action) ? (action as CrashAction) : null;
}

// ─── Window-state clamping (§14) ─────────────────────────────────────────────

/**
 * A display's WORK AREA — the usable rectangle, menu bar and taskbar already
 * subtracted. Electron's `Display.workArea`, narrowed to the four numbers this
 * needs so the clamp can be tested without a compositor.
 */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The §2.3 `config.window` body. */
export type WindowState = DesktopConfig['window'];

/**
 * How much of a restored window must land on a real display before we accept the
 * saved position. A window is dragged by its title bar, so "reachable" means the
 * TOP EDGE is grabbable — a window whose corner clips a display by a pixel is on
 * screen by area and unusable by hand.
 */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 48;

function overlap(a: DisplayArea, b: DisplayArea): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** Clamp with an inverted-range guard: when `hi < lo` the low bound wins. */
function clamp(value: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(value, lo), hi);
}

/**
 * §14: "bounds/maximized persisted to `config.window` (debounced), restored on
 * launch with off-screen correction. Min size 1024×700."
 *
 * The failure this exists to prevent is total: a window restored onto a display
 * that no longer exists (undocked laptop, unplugged TV, a monitor that moved to
 * the other side of the primary and took the negative coordinate space with it)
 * is rendered somewhere the user cannot see or reach, and the app looks like it
 * did not launch. There is no in-app recovery — the window that would show the
 * recovery UI is the one that is gone.
 *
 * The rules, in order:
 *  1. Size is at least §14's 1024×700, and never larger than the display it will
 *     sit on — a 1440×900 window restored onto a 1366×768 laptop panel must
 *     shrink, or clamping its position cannot make its right edge reachable.
 *     The minimum wins if the two conflict (a display smaller than 1024×700),
 *     because §14's minimum is a product constraint and Electron enforces it at
 *     `minWidth`/`minHeight` regardless of what we compute here.
 *  2. The display is the one the saved rect overlaps MOST — not the primary, and
 *     not the first that overlaps at all. A window straddling two monitors comes
 *     back on the one it mostly lived on.
 *  3. If no display shows a grabbable piece of it, the position is DROPPED
 *     rather than nudged, which hands Electron its own "center on the primary
 *     display" behaviour. Inventing coordinates here would be guessing at a
 *     layout we have just established we do not understand.
 *
 * `maximized` is carried through untouched: it is Electron's to apply, and a
 * maximized window is by construction on a real display.
 */
export function clampWindowState(state: WindowState, displays: readonly DisplayArea[]): WindowState {
  const maximized = state.maximized;

  // No display information at all (headless, or an Electron that has not yet
  // built its screen list). Enforce the minimum and change nothing else: without
  // a layout, "off-screen" is not a question that has an answer, and dropping a
  // good position would be a regression for every normal launch.
  if (displays.length === 0) {
    return {
      ...state,
      width: Math.max(MIN_WINDOW_WIDTH, state.width),
      height: Math.max(MIN_WINDOW_HEIGHT, state.height),
    };
  }

  // First run, or a position we previously dropped: let Electron center it.
  if (state.x === undefined || state.y === undefined) {
    return {
      width: Math.max(MIN_WINDOW_WIDTH, state.width),
      height: Math.max(MIN_WINDOW_HEIGHT, state.height),
      maximized,
    };
  }

  const saved: DisplayArea = {
    x: state.x,
    y: state.y,
    width: Math.max(MIN_WINDOW_WIDTH, state.width),
    height: Math.max(MIN_WINDOW_HEIGHT, state.height),
  };

  // Rule 2, with rule 3's grabbability applied per display: a sliver on each of
  // two monitors is not a window you can reach on either of them.
  let target: DisplayArea | null = null;
  let best = 0;
  for (const display of displays) {
    const { width, height } = overlap(saved, display);
    const area = width * height;
    if (width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT && area > best) {
      best = area;
      target = display;
    }
  }

  if (target === null) {
    return { width: saved.width, height: saved.height, maximized };
  }

  // Rule 1: fit the window to its display, but never below §14's minimum.
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(saved.width, target.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(saved.height, target.height));

  return {
    x: clamp(saved.x, target.x, target.x + target.width - width),
    y: clamp(saved.y, target.y, target.y + target.height - height),
    width,
    height,
    maximized,
  };
}

// ─── Crash-page payload (§2.2 steps 7 and 9) ─────────────────────────────────

/** What the crash page renders (§2.2 steps 7 and 9). */
export interface CrashScreenInfo {
  /** Shown verbatim: already user-facing prose, never a raw stack. */
  reason: string;
  /** §9's `<userData>/logs/adminium-server.log` — the "Show logs" target. */
  logPath?: string | undefined;
  /** §2.2 step 7's "log excerpt", oldest line first. */
  excerpt?: readonly string[] | undefined;
  /** False once §2.2 step 9's crash budget is spent: hide "Restart server". */
  canRestart: boolean;
}

/**
 * `JSON.stringify` hardened for embedding inside a script-shaped string.
 *
 * U+2028/U+2029 are valid inside JSON strings and are LINE TERMINATORS in
 * JavaScript, so a log line carrying one would end the statement mid-literal and
 * turn the remainder of the excerpt into code. `<` is escaped against the same
 * family of problem. This payload carries raw server log output — the string in
 * this app most likely to contain something adversarial-shaped — so it is
 * escaped even though `executeJavaScript` is not an HTML parsing context today.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c');
}

/**
 * The script that fills crash.html's slots, as a string for
 * `webContents.executeJavaScript`.
 *
 * WHY INJECT RATHER THAN TEMPLATE THE HTML. crash.html has to exist as a real
 * file that renders standalone — it is the last thing shown when the rest of the
 * app has failed, and a page assembled at runtime by the process that just
 * failed is a page that can fail to be assembled. So the file is a static
 * skeleton and the only dynamic step is text going into slots.
 *
 * EVERY VALUE CROSSES AS DATA. The payload is a JSON literal bound to a function
 * parameter; nothing is interpolated into code, and the function only ever
 * assigns `textContent`. That is what makes it safe to display a raw log
 * excerpt — `<img onerror=…>` in a log line becomes those characters on the
 * screen rather than a node in the tree.
 */
export function crashRenderScript(info: CrashScreenInfo): string {
  return `(function (info) {
  var slot = function (name) { return document.querySelector('[data-slot="' + name + '"]'); };
  var set = function (name, text) { var el = slot(name); if (el) { el.textContent = text; } };
  var toggle = function (name, shown) { var el = slot(name); if (el) { el.hidden = !shown; } };

  set('reason', info.reason);
  set('log-path', info.logPath || '');
  toggle('log-path-row', Boolean(info.logPath));

  var excerpt = info.excerpt || [];
  set('excerpt', excerpt.join('\\n'));
  toggle('excerpt-row', excerpt.length > 0);

  // §2.2 step 9: once the 3-in-60 s budget is spent, restarting is not offered.
  toggle('retry', info.canRestart);
  toggle('logs', Boolean(info.logPath));
})(${jsonForScript(info)});`;
}

// ─── The manager ─────────────────────────────────────────────────────────────

export interface DesktopWindows {
  /** §2.2 step 6: the bundled splash. Creates the window if it does not exist. */
  showBoot(): Promise<void>;
  /** §2.2 step 8: navigate to the loopback app URL. */
  loadApp(url: string): Promise<void>;
  /** §2.2 step 9: the bundled crash page. */
  showCrash(info: CrashScreenInfo): Promise<void>;
  /** §2.2 step 1: a second launch focuses the existing window. */
  focus(): void;
  /** §14: macOS `activate` with no window ⇒ re-create it and reload the app URL. */
  reopen(): Promise<void>;
  exists(): boolean;
  /** §2.2 step 1 / §9: a forwarded `.zip` / `.sqlite` launch argument. */
  handleFileArgument(path: string): void;
  /**
   * The launch file received but not yet delivered to the SPA, or `null`.
   *
   * READ THIS BEFORE WIRING §9's RESTORE FLOW (11-T12). The path is RETAINED,
   * not delivered: §4's bridge has no method that carries it, `IPC_CHANNELS` has
   * no channel for it, and the preload deliberately exposes no generic
   * `send(channel, …)` forwarding (see its header — that would be `ipcRenderer`
   * wearing a hat). An earlier version of this module pushed to a bespoke
   * `'adminium:file-argument'` channel and claimed in a comment that "the SPA
   * subscribes through §4's bridge"; nothing did, so a double-clicked
   * `adminium-backup-*.zip` was dropped with no error anywhere.
   *
   * Delivering it needs a new §4 method (`onFileArgument`, mirroring
   * `onUpdateEvent`: a one-way main → renderer push, a channel in
   * `IPC_CHANNELS`, and an entry in `api.d.ts`) — which is 11-T12's to add
   * alongside the restore flow that consumes it, and a change to the §4 contract
   * this file does not own. Until then the honest state is "held, and readable",
   * which is what this returns.
   */
  pendingFileArgument(): string | null;
  /**
   * Push to the live window's `webContents` — §4's one-way channels (today only
   * `onUpdateEvent`). A no-op while no window exists, which is the honest
   * answer: there is nobody to tell.
   */
  broadcast(channel: string, payload: unknown): void;
  /**
   * §2.2 step 9's Restart server / Show logs / Quit.
   *
   * A SETTER rather than a constructor option, and that is the whole point of
   * its existence: `retry` has to reach `ServerManager.restart()`, and the
   * manager does not exist when this manager is built — index.ts only learns the
   * dataDir and the secret at boot steps 2–3, so it constructs the window
   * manager first and the server manager later. Passing the handler at
   * construction time is therefore not expressible, and the version of this
   * contract that tried left all three buttons inert in production: the
   * navigation was cancelled and `opts.onCrashAction?.()` short-circuited on
   * undefined, on the one screen whose entire job is to offer a way out.
   */
  setCrashActionHandler(handler: (action: CrashAction) => void): void;
}

export interface CreateWindowManagerOptions {
  /** `app.getPath('userData')` — where `config.window` is persisted (§2.3). */
  userDataDir: string;
  /**
   * §2.2 step 9's initial crash-action handler. Almost always omitted:
   * {@link DesktopWindows.setCrashActionHandler} is how index.ts installs the
   * real one, because `retry` needs a ServerManager that does not exist yet at
   * construction time. Kept for tests that want a handler from the first frame.
   */
  onCrashAction?: ((action: CrashAction) => void) | undefined;
}

/** §14: "bounds/maximized persisted to `config.window` (debounced)". */
const PERSIST_DEBOUNCE_MS = 400;

const rendererDir = (): string => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const preloadEntry = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'index.cjs');

export function createWindowManager(opts: CreateWindowManagerOptions): DesktopWindows {
  const configPath = configPathFor(opts.userDataDir);
  const bootPage = resolve(rendererDir(), 'boot.html');
  const crashPage = resolve(rendererDir(), 'crash.html');
  const crashPageUrl = pathToFileUrl(crashPage);

  let win: BrowserWindow | null = null;
  /** The loopback origin nav is locked to; `null` whenever no server page is up. */
  let appOrigin: string | null = null;
  /**
   * Whether the crash page is the document currently loaded — the gate on
   * treating a `?action=` navigation as a button press.
   *
   * A flag rather than comparing `webContents.getURL()` against a path we
   * format ourselves: Electron's `loadFile` builds its own file: URL, and the
   * two spellings agreeing is a coincidence of platform (Windows drive letters
   * and UNC paths are exactly where it stops being one). If they disagreed, the
   * crash buttons would go dead — on the one screen whose entire job is to
   * offer a way out.
   */
  let showingCrash = false;
  /** §14's `activate`-with-no-window needs somewhere to go back to. */
  let lastAppUrl: string | null = null;
  /** A forwarded launch file, held until §4 has a way to carry it (11-T12). */
  let pendingFile: string | null = null;
  /** Late-bound — see {@link DesktopWindows.setCrashActionHandler}. */
  let crashActionHandler: ((action: CrashAction) => void) | null = opts.onCrashAction ?? null;
  let persistTimer: NodeJS.Timeout | null = null;
  /** In-flight window construction, so concurrent callers share one — see {@link create}. */
  let creating: Promise<BrowserWindow> | null = null;

  const displays = (): DisplayArea[] =>
    screen.getAllDisplays().map((display) => ({ ...display.workArea }));

  const currentState = (target: BrowserWindow): WindowState => {
    // Bounds while maximized/minimized are not the bounds to restore — Electron
    // reports the maximized rect, which saved as the "normal" size would make
    // un-maximizing a no-op on the next launch.
    const bounds = target.getNormalBounds();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: target.isMaximized(),
    };
  };

  const persistDebounced = (): void => {
    if (win === null || win.isDestroyed()) return;
    const state = currentState(win);
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void writeWindowState(configPath, state);
    }, PERSIST_DEBOUNCE_MS);
  };

  const build = async (): Promise<BrowserWindow> => {
    const state = clampWindowState(await readWindowState(configPath), displays());

    const created = new BrowserWindow({
      ...(state.x === undefined ? {} : { x: state.x }),
      ...(state.y === undefined ? {} : { y: state.y }),
      width: state.width,
      height: state.height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      // §2.2 step 6 paints the splash; showing the frame first is a white flash
      // on every launch.
      show: false,
      // §14: "standard OS chrome in v1 (no custom titlebar)".
      title: 'Adminium',
      webPreferences: { ...WEB_PREFERENCES, preload: preloadEntry() },
    });
    win = created;

    if (state.maximized) created.maximize();
    created.once('ready-to-show', () => {
      created.show();
    });

    // ── §2.4 navigation lockdown ──
    created.webContents.on('will-navigate', (event, target) => {
      // The crash page's buttons are links (see parseCrashAction) — checked
      // first, and only while the crash page is the one asking.
      if (showingCrash) {
        const action = parseCrashAction(target, crashPageUrl);
        if (action !== null) {
          event.preventDefault();
          // No `?.` — the navigation has just been cancelled, so a missing
          // handler is a dead button, not a no-op. index.ts installs one before
          // any crash page can be shown; if that ever regresses, this says so in
          // the main log rather than leaving the user to force-quit.
          if (crashActionHandler === null) {
            console.error(
              `[window] crash-page action "${action}" had no handler — ` +
                'setCrashActionHandler() was never called.',
            );
          } else {
            crashActionHandler(action);
          }
          return;
        }
      }
      const decision = decideNavigation(target, appOrigin);
      if (decision.action === 'allow') return;
      // Everything else leaves this window — to the system browser or nowhere.
      // Both start by not navigating.
      event.preventDefault();
      if (decision.action === 'external') void shell.openExternal(decision.url);
    });

    // `target="_blank"` and `window.open`. Denying the child is not optional: a
    // window created here would be a NEW BrowserWindow this manager never
    // configured, carrying none of the posture above and none of these handlers.
    created.webContents.setWindowOpenHandler(({ url }) => {
      const decision = decideNavigation(url, appOrigin);
      if (decision.action === 'external') void shell.openExternal(decision.url);
      return { action: 'deny' };
    });

    // A redirect can cross origins after `will-navigate` already allowed the
    // request, so the decision is re-made on the redirect itself.
    created.webContents.on('will-redirect', (event, target) => {
      if (decideNavigation(target, appOrigin).action !== 'allow') event.preventDefault();
    });

    // ── §2.4 permission handlers ──
    // Both, deliberately. `setPermissionRequestHandler` covers the prompts;
    // `setPermissionCheckHandler` covers the synchronous checks
    // (`navigator.permissions.query`, and the getUserMedia paths that never
    // raise a prompt). Denying only the first leaves the second at Chromium's
    // default, which is not "deny".
    const { session } = created.webContents;
    session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(isPermissionAllowed(permission));
    });
    session.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));

    // ── §14 window state ──
    created.on('resize', persistDebounced);
    created.on('move', persistDebounced);
    created.on('maximize', persistDebounced);
    created.on('unmaximize', persistDebounced);
    created.on('close', () => {
      // The debounce is a latency optimization, not a durability policy: a close
      // inside the debounce window would otherwise drop the last move.
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (!created.isDestroyed()) void writeWindowState(configPath, currentState(created));
    });
    created.on('closed', () => {
      if (win === created) win = null;
    });

    return created;
  };

  /**
   * The window, creating it if there is not one — at most once.
   *
   * The in-flight promise is what makes "at most once" true. `build` awaits the
   * config read before it constructs anything, so two callers that arrive during
   * that await would BOTH see `win === null`, and both would go on to construct
   * a BrowserWindow — §14 says single window, and the second one would be the
   * one holding the handlers while the first stayed on screen. The boot sequence
   * lines these calls up today (index.ts awaits each), but `manager.subscribe`
   * and `manager.onExit` both call in from event handlers, so the ordering is
   * not something this module gets to assume.
   */
  const create = (): Promise<BrowserWindow> => {
    if (win !== null && !win.isDestroyed()) return Promise.resolve(win);
    creating ??= build().finally(() => {
      creating = null;
    });
    return creating;
  };

  const focus = (): void => {
    if (win === null || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  };

  return {
    async showBoot(): Promise<void> {
      const target = await create();
      // The splash has no app origin — and neither does anything else until the
      // handshake lands. Clearing it means a server that died and is restarting
      // cannot leave a dead origin allowed.
      appOrigin = null;
      showingCrash = false;
      await target.loadFile(bootPage);
    },

    async loadApp(url: string): Promise<void> {
      const target = await create();
      appOrigin = originOf(url);
      showingCrash = false;
      lastAppUrl = url;
      await target.loadURL(url);
    },

    async showCrash(info: CrashScreenInfo): Promise<void> {
      const target = await create();
      appOrigin = null;
      showingCrash = true;
      await target.loadFile(crashPage);
      await target.webContents.executeJavaScript(crashRenderScript(info));
      if (!target.isVisible()) target.show();
    },

    focus,

    async reopen(): Promise<void> {
      const target = await create();
      // §14: `activate` re-creates the window. Where it goes depends on how far
      // the boot got — the app if it ever came up, the splash if it did not.
      showingCrash = false;
      if (lastAppUrl === null) {
        await target.loadFile(bootPage);
        return;
      }
      appOrigin = originOf(lastAppUrl);
      await target.loadURL(lastAppUrl);
    },

    exists(): boolean {
      return win !== null && !win.isDestroyed();
    },

    handleFileArgument(path: string): void {
      // Held, not delivered — see `pendingFileArgument`. The focus IS §2.2 step
      // 1's other half ("a second launch focuses the existing window") and works
      // today; the restore flow that consumes the path is 11-T12's.
      pendingFile = path;
      if (win === null || win.isDestroyed()) return;
      focus();
    },

    pendingFileArgument(): string | null {
      return pendingFile;
    },

    broadcast(channel: string, payload: unknown): void {
      if (win === null || win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    },

    setCrashActionHandler(handler: (action: CrashAction) => void): void {
      crashActionHandler = handler;
    },
  };
}

// ─── Native dialogs (§4, §2.1) ───────────────────────────────────────────────

/**
 * §4's four native affordances, over Electron's `dialog` and `shell`.
 *
 * HERE because §2.1 gives the dialogs to "the BackupCoordinator (dialogs + shell
 * reveal)" and the window manager, and of those two this is the module that
 * exists and owns the parent window. `main/ipc.ts` declares the shape it needs
 * ({@link DesktopDialogs}) and routes to it; this is the only implementation.
 *
 * The filter lists are keyed by §4's `kind` rather than supplied by the caller,
 * which is the point of that parameter: the renderer is the untrusted side
 * (§2.4), and a caller-chosen filter is a caller-chosen file type.
 *
 * FILTER NAMES ARE NOT LOCALIZED YET. §14 localizes menu labels via
 * `@adminium/i18n` at build time and 10-i18n-theming.md rebuilds them on locale
 * change; these strings belong to that same pass (11-T19) and are left in
 * English rather than given a second, private translation path.
 */
export function createNativeDialogs(): DesktopDialogs {
  // The focused window, else the only one there is. Parenting matters: on macOS
  // a parented dialog is a sheet attached to the window, and an unparented one
  // is a free-floating panel the user can lose behind the app.
  const parent = (): BrowserWindow | null =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

  const filtersFor = (kind: OpenFileKind): Electron.FileFilter[] => {
    switch (kind) {
      case 'sqlite':
        // §6 step 2's "Open an existing SQLite file".
        return [
          { name: 'SQLite database', extensions: ['sqlite', 'db', 'sqlite3'] },
          { name: 'All files', extensions: ['*'] },
        ];
      case 'schema':
        // §6 step 2's "From a schema file": the formats @adminium/schema-import
        // accepts (SQL/pg_dump, Prisma, Drizzle/TypeORM/Sequelize, schema.rb,
        // Django models, JSON).
        return [
          { name: 'Schema file', extensions: ['sql', 'prisma', 'rb', 'py', 'json', 'ts', 'js'] },
          { name: 'All files', extensions: ['*'] },
        ];
      case 'backup':
        return [
          { name: 'Adminium backup', extensions: ['zip'] },
          { name: 'All files', extensions: ['*'] },
        ];
      case 'any':
        return [{ name: 'All files', extensions: ['*'] }];
    }
  };

  const showOpen = async (options: Electron.OpenDialogOptions): Promise<string | null> => {
    const window = parent();
    const result =
      window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    // §4: "return absolute paths or null on cancel". `canceled` and an empty
    // list are the same answer, and both happen — checking only `canceled`
    // would index into nothing on some platforms.
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  };

  return {
    openFile: (opts) =>
      showOpen({
        properties: ['openFile'],
        filters: filtersFor(opts.kind),
      }),

    chooseDirectory: (opts) =>
      showOpen({
        title: opts.title,
        // §6 step 1's "Change…": the data directory may not exist yet, so the
        // dialog has to be able to make it.
        properties: ['openDirectory', 'createDirectory'],
        ...(opts.defaultPath === undefined ? {} : { defaultPath: opts.defaultPath }),
      }),

    async saveFile(opts): Promise<string | null> {
      const window = parent();
      const options: Electron.SaveDialogOptions = {
        defaultPath: opts.defaultName,
        filters: filtersFor(opts.kind === 'backup' ? 'backup' : 'any'),
        // The OS asks before clobbering; we do not add a second confirmation.
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      };
      const result =
        window === null
          ? await dialog.showSaveDialog(options)
          : await dialog.showSaveDialog(window, options);
      if (result.canceled) return null;
      return result.filePath === '' ? null : result.filePath;
    },

    showItemInFolder(path: string): Promise<void> {
      // Synchronous in Electron; §4 types it as a promise because every other
      // bridge method is one and a lone sync method is a trap for the caller.
      shell.showItemInFolder(path);
      return Promise.resolve();
    },
  };
}

/** `file:///…` for a native path, via WHATWG rules (spaces, `#`, Windows drives). */
function pathToFileUrl(path: string): string {
  const slashed = path.split('\\').join('/');
  return new URL(`file://${slashed.startsWith('/') ? '' : '/'}${slashed}`).href;
}

/**
 * Read `config.window`, or the schema default if there is no config yet.
 *
 * Never throws. This runs on the path that CREATES the window, and a window that
 * fails to open is an app that failed to launch — a corrupt or unreadable
 * config.json must cost the user their saved bounds, not their session.
 */
async function readWindowState(configPath: string): Promise<WindowState> {
  const fallback: WindowState = { width: 1440, height: 900, maximized: false };
  try {
    const result = await loadConfig(configPath);
    return result.status === 'loaded' ? result.config.window : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Persist `config.window` (§14), read-modify-write.
 *
 * Best-effort, and it SKIPS a missing config.json rather than creating one: on
 * first run `config.json` is written by the boot sequence once a secret exists
 * (index.ts's `electronConfigPort`), and a window-state save racing ahead of it
 * would write a default config whose `secretEncrypted` is null — handing the
 * next boot a config that exists, claims first run is over, and has no secret.
 */
async function writeWindowState(configPath: string, state: WindowState): Promise<void> {
  try {
    const result = await loadConfig(configPath);
    if (result.status !== 'loaded') return;
    const next: DesktopConfig = { ...result.config, window: state };
    await saveConfig(configPath, next);
  } catch {
    // A window bound is not worth a failed boot or a crash dialog.
  }
}
