/**
 * Launching and instrumenting the built Electron app (11-electron.md §2, 11-T20).
 *
 * Everything here is main-process reach: Playwright's `_electron` connects to the
 * real main process, so `electronApp.evaluate(...)` runs code INSIDE it — which
 * is the only place §7's network deny-all (`session.webRequest`), §2.4's
 * external-link policy (`shell.openExternal`), and §9's native dialogs
 * (`dialog.showSaveDialog`) can be observed or stubbed. The renderer-facing
 * assertions live in the specs; this file is the seam to the trusted side.
 *
 * The evaluate callbacks are serialized to the main process, so they close over
 * nothing but their `arg` and store state on `globalThis` (the one object that
 * survives between evaluate calls in a single main process).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { DESKTOP_MAIN_ENTRY, assertDesktopBuilt } from './paths.js';

export interface LaunchOptions {
  /** Reuse a data dir across launches (the crash/WAL test relaunches the same one). */
  userDataDir?: string;
  /** Extra env layered over `process.env` (e.g. `ADMINIUM_DISABLE_UPDATES=1`). */
  env?: Record<string, string>;
  /** Extra Chromium/Electron args, appended after the app entry + user-data-dir. */
  extraArgs?: string[];
}

export interface LaunchedDesktop {
  app: ElectronApplication;
  /** The isolated `userData` root (`config.json`, `data/`, `logs/`) for this launch. */
  userDataDir: string;
}

/**
 * Launch `out/main/index.js` under Electron against a hermetic `userData` dir.
 *
 * `--user-data-dir` is what makes each run a clean first-run: Electron derives
 * `app.getPath('userData')` from it, and the desktop config (`config.json`) and
 * the default data directory (`<userData>/data`, 11-T03) both hang off that —
 * so a fresh temp dir means no `config.json`, which is §2.2 step 2's definition
 * of first-run.
 */
export async function launchDesktop(opts: LaunchOptions = {}): Promise<LaunchedDesktop> {
  assertDesktopBuilt();
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'adminium-desktop-e2e-'));

  // `process.env` carries `undefined` values that Playwright's typed `env` rejects;
  // copy the defined ones, then layer the test's overrides.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, opts.env ?? {});

  const app = await electron.launch({
    args: [DESKTOP_MAIN_ENTRY, `--user-data-dir=${userDataDir}`, ...(opts.extraArgs ?? [])],
    env,
    timeout: 60_000,
  });
  return { app, userDataDir };
}

/**
 * The main window, once it has left the bundled splash for the loopback SPA
 * (§2.2 step 8). The splash and crash pages are `file://`; the app is
 * `http://127.0.0.1:<port>/`, so waiting for that origin is the readiness signal.
 *
 * A crash screen instead is turned into an actionable failure — it is almost
 * always the native-ABI prerequisite (see {@link assertDesktopBuilt}).
 */
export async function waitForAppWindow(
  app: ElectronApplication,
  opts: { timeout?: number } = {},
): Promise<Page> {
  const page = await app.firstWindow({ timeout: 30_000 });
  const timeout = opts.timeout ?? 120_000;
  try {
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout });
  } catch (error) {
    const url = page.url();
    if (url.includes('crash.html')) {
      const reason = await page
        .locator('[data-slot="reason"]')
        .textContent()
        .catch(() => null);
      throw new Error(
        'The desktop app reached the crash screen instead of the app. This usually means the ' +
          'utilityProcess server failed to boot — most often a Node-ABI better-sqlite3 (rebuild ' +
          `native modules for Electron before running this suite). Crash reason: ${reason ?? '(unknown)'}`,
      );
    }
    throw new Error(
      `The desktop window never reached the loopback origin (current URL: ${url}). Cause: ${String(error)}`,
    );
  }
  return page;
}

/** The window's live loopback origin, for building absolute in-app URLs. */
export function appOrigin(page: Page): string {
  return new URL(page.url()).origin;
}

// ─── §7 offline deny-all (renderer network layer) ────────────────────────────

/**
 * §7's mechanism, verbatim: "`session.webRequest` deny-all except `127.0.0.1`".
 * Every non-loopback `http(s)` request the renderer attempts is CANCELLED and
 * recorded; {@link readBlockedRequests} reads the log back, and the smoke test
 * asserts it is empty (no Google Fonts, no Leaflet/tile fetches, no CDN).
 *
 * Install this BEFORE the SPA loads (immediately after launch): the server boot
 * takes seconds, so the filter is in place long before the first paint. Opaque
 * and non-network schemes (`file:`, `data:`, `devtools:`) are allowed — they are
 * not the network the guarantee is about.
 */
export async function installOfflineDenyAll(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app: electronApp, session }) => {
    type Store = { __adminiumBlocked?: string[]; __adminiumOfflineInstalled?: boolean };
    const store = globalThis as unknown as Store;
    if (store.__adminiumOfflineInstalled === true) return;
    store.__adminiumOfflineInstalled = true;
    store.__adminiumBlocked = [];

    await electronApp.whenReady();

    const isLoopbackHost = (host: string): boolean =>
      host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';

    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let host = '';
      let scheme = '';
      try {
        const parsed = new URL(details.url);
        host = parsed.hostname;
        scheme = parsed.protocol;
      } catch {
        // Opaque/relative — not a network request the deny-all governs.
      }
      const isNetwork = scheme === 'http:' || scheme === 'https:';
      if (isNetwork && !isLoopbackHost(host)) {
        (store.__adminiumBlocked ??= []).push(details.url);
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    });
  });
}

/** The URLs the deny-all cancelled since it was installed (§7 asserts this is empty). */
export async function readBlockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const store = globalThis as unknown as { __adminiumBlocked?: string[] };
    return store.__adminiumBlocked ?? [];
  });
}

// ─── §2.4 external-link policy ────────────────────────────────────────────────

/**
 * Record every `shell.openExternal(url)` instead of handing the URL to the OS.
 * §2.4 sends off-origin `https:` navigations and `target="_blank"` links to the
 * system browser through this exact call, so recording it is how the E2E proves
 * "external links open the system browser" without a real browser opening in CI.
 */
export async function stubExternalOpen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const store = globalThis as unknown as { __adminiumExternalOpens?: string[] };
    store.__adminiumExternalOpens = [];
    const patch = shell as unknown as { openExternal: (url: string) => Promise<void> };
    patch.openExternal = async (url: string): Promise<void> => {
      (store.__adminiumExternalOpens ??= []).push(url);
    };
  });
}

/** The URLs handed to `shell.openExternal` since {@link stubExternalOpen}. */
export async function readExternalOpens(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const store = globalThis as unknown as { __adminiumExternalOpens?: string[] };
    return store.__adminiumExternalOpens ?? [];
  });
}

// ─── §9 backup dialogs ────────────────────────────────────────────────────────

/**
 * Auto-answer the native save dialog and completion message box the
 * BackupCoordinator shows (§9), so "Back up now…" runs unattended and writes the
 * archive to `savePath`. `shell.showItemInFolder` is neutered too — a CI runner
 * has no file browser to reveal into.
 */
export async function stubBackupDialogs(app: ElectronApplication, savePath: string): Promise<void> {
  await app.evaluate(
    ({ dialog, shell }, target) => {
      const d = dialog as unknown as {
        showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath: string }>;
        showMessageBox: (...args: unknown[]) => Promise<{ response: number }>;
      };
      d.showSaveDialog = async () => ({ canceled: false, filePath: target });
      d.showMessageBox = async () => ({ response: 0 });
      (shell as unknown as { showItemInFolder: (path: string) => void }).showItemInFolder = () => {
        /* no reveal in CI */
      };
    },
    savePath,
  );
}

/**
 * Fire a native menu item by a substring of its (localized) label — the way §9's
 * "Back up now…" is invoked. Returns whether an item matched. The default
 * en-US label is "Back up now…" (menu.ts `EN_US_MENU_LABELS`).
 */
export async function triggerMenuItem(app: ElectronApplication, labelIncludes: string): Promise<boolean> {
  return app.evaluate(({ Menu }, needle) => {
    const menu = Menu.getApplicationMenu();
    if (menu === null) return false;
    type ClickableItem = {
      label?: string;
      submenu?: { items: ClickableItem[] };
      click?: (...args: unknown[]) => void;
    };
    const walk = (items: ClickableItem[]): boolean => {
      for (const item of items) {
        if (
          typeof item.label === 'string' &&
          item.label.includes(needle) &&
          typeof item.click === 'function'
        ) {
          item.click();
          return true;
        }
        if (item.submenu !== undefined && walk(item.submenu.items)) return true;
      }
      return false;
    };
    return walk(menu.items as unknown as ClickableItem[]);
  }, labelIncludes);
}

// ─── lifecycle ────────────────────────────────────────────────────────────────

/**
 * SIGKILL the app — the crash/WAL test's "kill the app mid-write" (§9). No
 * `before-quit`, so the graceful `wal_checkpoint(TRUNCATE)` never runs: the
 * `.sqlite` files are left with their `-wal` sidecars exactly as an unclean
 * termination leaves them, which is the state WAL recovery must survive.
 */
export function killDesktop(app: ElectronApplication): void {
  app.process().kill('SIGKILL');
}

/** Close the app cleanly and (optionally) remove its temp data dir. */
export async function closeDesktop(app: ElectronApplication, userDataDir?: string): Promise<void> {
  await app.close().catch(() => undefined);
  if (userDataDir !== undefined) rmSync(userDataDir, { recursive: true, force: true });
}
