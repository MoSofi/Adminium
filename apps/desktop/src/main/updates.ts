// SPDX-License-Identifier: AGPL-3.0-only
/**
 * UpdateManager — `electron-updater` integration (11-electron.md §11), owned by
 * 11-T16.
 *
 * ─── The one CORRECTNESS rule, restated because everything else bends to it ──
 *
 * `mode: "disabled"` (and `ADMINIUM_DISABLE_UPDATES=1`, resolved by
 * {@link resolveUpdateMode}) means the updater is **never initialized** — not
 * initialized-then-idle. §7 and the acceptance criteria promise an air-gapped
 * install makes zero non-loopback requests, and the offline smoke test asserts
 * it. `electron-updater`'s `autoUpdater` is a lazily-instantiated module getter
 * that, in some configurations, kicks a check on construction; so the rule here
 * is stronger than "don't call check" — it is "do not even READ the
 * `autoUpdater` export". {@link createUpdateManager} enforces that by returning
 * `null` for `disabled` BEFORE it calls {@link CreateUpdateManagerOptions.getUpdater},
 * and the real wiring (`main/index.ts`) resolves electron-updater with a
 * `createRequire` only inside that same lazily-invoked port — so a disabled boot
 * never loads the library at all.
 *
 * ─── Why this module injects everything ──────────────────────────────────────
 *
 * A real launch needs a display and a signed artifact, so the Playwright
 * `_electron` suite (11-T20) is where the packaged updater actually runs. What a
 * unit suite CAN pin — and must, because the correctness rule lives here — is
 * that `disabled` touches nothing, that `notify` schedules a launch check and a
 * daily one while `manual` schedules neither, and that autoUpdater events are
 * translated into the ONE §4 notification pipeline. So the updater
 * ({@link UpdaterPort}), the timers ({@link UpdateScheduler}) and the event sink
 * ({@link CreateUpdateManagerOptions.emit}) are all ports; `main/index.ts` binds
 * the real ones.
 */

import type { DesktopUpdateCheckResult, DesktopUpdateEvent } from '../preload/api.js';
import type { UpdateMode } from './config.js';

// ─── Feed & schedule constants (§11) ─────────────────────────────────────────

/**
 * §11: the feed is the `MoSofi/Adminium` repo's GitHub Releases. Desktop
 * builds are tagged `desktop-vX.Y.Z` (electron-builder.yml `vPrefixedTagName:
 * false`, 11-T13) and only those releases carry `latest*.yml`, so the GitHub
 * provider resolves the newest desktop release and nothing else in the monorepo.
 *
 * ─── THIS OWNER/REPO IS A SECURITY BOUNDARY, not a cosmetic label ────────────
 *
 * Whatever repository is named here is trusted to hand a shipped install its next
 * executable. `autoDownload` is false so a user click is required, but the prompt
 * the user clicks is in-app and looks authentic; and on Windows the downloaded
 * installer's Authenticode signature is NOT verified, because electron-updater's
 * NsisUpdater skips verification whenever `publisherName` is absent from
 * app-update.yml — which it is for as long as v1 Windows builds ship unsigned
 * (electron-builder.yml `win`). The sha512 in `latest.yml` is no help: it comes
 * from the same feed. So a wrong owner/repo here is a supply-chain hole, not a
 * dead link.
 *
 * `adminium/adminium` — which this pointed at until 2026-07-21 — is a REAL
 * GitHub organisation and repository belonging to an unrelated third party. It
 * is not ours and never was. The real repository is `MoSofi/Adminium`.
 *
 * Keep this the ONE definition: {@link RELEASES_URL}, the offline-asset
 * allowlist, and the updater test all derive from or assert against it, and
 * apps/desktop/electron-builder.yml + apps/desktop/dev-app-update.yml carry the
 * same owner/repo (YAML cannot import, so those two are checked by eye — change
 * all three together or a packaged build's generated `app-update.yml` silently
 * overrides what this file says).
 */
export const UPDATE_FEED: UpdaterFeed = { provider: 'github', owner: 'MoSofi', repo: 'Adminium' };

/**
 * §2.4 / §14 external-link policy: the human download page, offered when the
 * running package cannot self-replace (deb/rpm, {@link canSelfUpdate}).
 *
 * Derived from {@link UPDATE_FEED} rather than spelled out again — the two named
 * the same third-party repo before, and a hand-written copy is exactly how the
 * drift happened.
 */
export const RELEASES_URL = `https://github.com/${UPDATE_FEED.owner}/${UPDATE_FEED.repo}/releases`;

/** §11 `notify`: "check on launch (after a 30 s grace)". */
export const LAUNCH_CHECK_GRACE_MS = 30_000;

/** §11 `notify`: "+ every 24 h". */
export const PERIODIC_CHECK_MS = 24 * 60 * 60 * 1000;

/**
 * §11: "Also forced by env `ADMINIUM_DISABLE_UPDATES=1` (fleet admins)." Read by
 * {@link resolveUpdateMode}; the value is exactly `"1"` (a truthy-string check
 * would let `ADMINIUM_DISABLE_UPDATES=0` disable updates, which is the opposite
 * of what a fleet admin who typed a `0` meant).
 */
export const DISABLE_UPDATES_ENV = 'ADMINIUM_DISABLE_UPDATES';

// ─── Effective mode & platform capability (pure) ─────────────────────────────

/**
 * The mode this launch actually runs in: `config.updates.mode`, unless the env
 * kill-switch forces `disabled` (§11).
 *
 * Pure and exported so the env override is assertable without a boot — the env
 * path to `disabled` is one of the two the acceptance criteria name ("the
 * disabled path from BOTH config and the env var"), and it is the one a config
 * fixture cannot exercise.
 */
export function resolveUpdateMode(configMode: UpdateMode, env: NodeJS.ProcessEnv): UpdateMode {
  if (env[DISABLE_UPDATES_ENV] === '1') return 'disabled';
  return configMode;
}

/**
 * Can the running package replace itself in place? (§11)
 *
 * macOS (dmg/zip) and Windows (nsis) always can. On Linux only the **AppImage**
 * can — "AppImage auto-updates via the same feed; deb/rpm get notify-only
 * behavior with a 'download from GitHub' link (no self-replace)". The AppImage
 * runtime exports `APPIMAGE` with the running image's absolute path;
 * electron-updater's own `AppImageUpdater.isUpdaterActive()` refuses without it,
 * so this mirrors the library's gate rather than inventing a second one.
 *
 * A `false` here does not silence the update NOTICE — deb/rpm users still get the
 * `available` event so they know a version shipped — it only routes the download
 * to {@link RELEASES_URL} instead of a self-replace.
 */
export function canSelfUpdate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux') {
    const appImage = env.APPIMAGE;
    return typeof appImage === 'string' && appImage.length > 0;
  }
  // No other platform is a §10 build target; treat it as non-self-replacing.
  return false;
}

// ─── Ports (the electron-updater surface, narrowed) ──────────────────────────

/** §11: GitHub provider only. */
export interface UpdaterFeed {
  readonly provider: 'github';
  readonly owner: string;
  readonly repo: string;
}

/** `builder-util-runtime`'s `UpdateInfo`, narrowed to what an event needs. */
export interface UpdaterInfo {
  readonly version: string;
  /** The GitHub release body (§11 "release notes … rendered in-app"), or a list. */
  readonly releaseNotes?: string | ReadonlyArray<unknown> | null | undefined;
  readonly releaseName?: string | null | undefined;
}

/** `download-progress` payload, narrowed. */
export interface UpdaterProgress {
  readonly percent: number;
}

/** `AppUpdater.checkForUpdates()` result, narrowed. `null` ⇒ updater inactive. */
export interface UpdaterCheckResult {
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: UpdaterInfo;
}

/** electron-updater's logger contract (info/warn/error). */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
}

/** The autoUpdater events this module wires. */
export type UpdaterEventName =
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error';

/**
 * The slice of electron-updater's `AppUpdater` this module drives. The real
 * `autoUpdater` is assignable to it via an `as unknown as` cast (its typed
 * emitter and `PublishConfiguration` union are wider than we need); keeping the
 * port narrow is what lets a fake stand in for the unit suite.
 */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  fullChangelog: boolean;
  logger: UpdaterLogger | null;
  setFeedURL(options: UpdaterFeed): void;
  checkForUpdates(): Promise<UpdaterCheckResult | null>;
  downloadUpdate(): Promise<readonly string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: UpdaterEventName, listener: (payload: unknown) => void): unknown;
  removeAllListeners(event?: UpdaterEventName): unknown;
}

// ─── Ports (timers) ──────────────────────────────────────────────────────────

/**
 * The two schedules §11 asks for, as an injectable seam so the unit suite can
 * fire them by hand rather than waiting 30 s (or 24 h). Each returns a canceller
 * that {@link UpdateManager.dispose} calls.
 */
export interface UpdateScheduler {
  /** Run `fn` once, `ms` from now. */
  after(ms: number, fn: () => void): () => void;
  /** Run `fn` every `ms`. */
  every(ms: number, fn: () => void): () => void;
}

/**
 * The default timers. Both are `unref`'d: an update check must never be the
 * reason the app stays alive at quit — the schedule serves the app, not the
 * reverse.
 */
export const nodeUpdateScheduler: UpdateScheduler = {
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    if (typeof handle.unref === 'function') handle.unref();
    return () => {
      clearTimeout(handle);
    };
  },
  every(ms, fn) {
    const handle = setInterval(fn, ms);
    if (typeof handle.unref === 'function') handle.unref();
    return () => {
      clearInterval(handle);
    };
  },
};

// ─── The manager ─────────────────────────────────────────────────────────────

export interface CreateUpdateManagerOptions {
  /** §11: `notify` (default) | `manual` | `disabled`. Env override pre-applied. */
  mode: UpdateMode;
  /**
   * Resolve the electron-updater `autoUpdater`. Called at most ONCE, and NEVER
   * in `disabled` mode — accessing the export constructs the platform updater
   * (§11's correctness rule). A function rather than a value so a disabled boot
   * can avoid even loading the library (`main/index.ts` `require`s it in here).
   */
  getUpdater: () => UpdaterPort;
  /**
   * Push a §4 update event into the ONE notification pipeline (`onUpdateEvent`,
   * §11). The renderer turns it into an `adminium_notifications` entry.
   */
  emit: (event: DesktopUpdateEvent) => void;
  /** {@link canSelfUpdate} for this launch: deb/rpm route downloads to GitHub. */
  canSelfUpdate: boolean;
  /** Injected for the suite; defaults to {@link nodeUpdateScheduler}. */
  scheduler?: UpdateScheduler | undefined;
  /** §9's main log. Failed checks are logged here and stay silent (§11). */
  log?: ((line: string) => void) | undefined;
  /** Feed override (dev/tests); defaults to {@link UPDATE_FEED}. */
  feed?: UpdaterFeed | undefined;
  /** Releases page override (tests); defaults to {@link RELEASES_URL}. */
  releasesUrl?: string | undefined;
}

/** §4's three update methods, plus teardown. */
export interface UpdateManager {
  /** §4: `{ status: "available" | "none" | "error"; version? }`. Never throws. */
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
  /** Cancel the schedules and detach the autoUpdater listeners. */
  dispose(): void;
}

/**
 * Build the updater for `opts.mode`, or `null` when there must not be one.
 *
 * `null` is the whole contract for `disabled`: `main/ipc.ts`'s `updates` getter
 * answers §4 `UNAVAILABLE` for it, and — because {@link CreateUpdateManagerOptions.getUpdater}
 * is not called on this path — electron-updater's `autoUpdater` is never
 * constructed and never touches the network.
 */
export function createUpdateManager(opts: CreateUpdateManagerOptions): UpdateManager | null {
  // THE correctness rule, and the first line for a reason: everything below this
  // point may read `getUpdater()`, and reading it constructs the updater.
  if (opts.mode === 'disabled') return null;

  const { emit, canSelfUpdate: canSelf } = opts;
  const scheduler = opts.scheduler ?? nodeUpdateScheduler;
  const feed = opts.feed ?? UPDATE_FEED;
  const releasesUrl = opts.releasesUrl ?? RELEASES_URL;
  const log = opts.log ?? ((): void => {});

  // Construct + configure ONCE, now that a non-disabled mode has committed us to
  // an updater. `autoDownload: false` is §11's "downloads only on user action";
  // `autoInstallOnAppQuit: false` keeps install on the explicit "Restart to
  // update" (`quitAndInstall`) rather than surprising the user on an ordinary
  // quit; `allowPrerelease`/`allowDowngrade: false` are §11 verbatim.
  const updater = opts.getUpdater();
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.fullChangelog = false;
  updater.logger = {
    info: (message) => log(`[updater] ${toLine(message)}`),
    warn: (message) => log(`[updater] warn ${toLine(message)}`),
    error: (message) => log(`[updater] error ${toLine(message)}`),
  };
  updater.setFeedURL(feed);

  updater.on('update-available', (payload) => {
    const info = payload as UpdaterInfo;
    // deb/rpm cannot self-replace, so the notice points at the download page
    // instead of the release body it would otherwise render in-app.
    const message = canSelf
      ? releaseNotesText(info)
      : `A newer version (${info.version}) is available. Download it from ${releasesUrl}`;
    emit({ type: 'available', version: info.version, ...(message === undefined ? {} : { message }) });
  });
  updater.on('download-progress', (payload) => {
    const progress = payload as UpdaterProgress;
    emit({ type: 'progress', percent: clampPercent(progress.percent) });
  });
  updater.on('update-downloaded', (payload) => {
    const info = payload as UpdaterInfo;
    emit({ type: 'downloaded', version: info.version });
  });
  updater.on('error', (payload) => {
    // LOG ONLY — no notification. §11: "Failed checks in notify mode log and
    // stay silent (offline is normal)." The autoUpdater fires this event for a
    // failed CHECK just as much as a failed download, so raising a notification
    // here would turn every offline launch into an error toast. The one error
    // §11 does surface — a download the user actually started — is emitted from
    // `downloadUpdate` below, where the intent is unambiguous.
    log(`[updater] error: ${payload instanceof Error ? payload.message : String(payload)}`);
  });

  const check = async (): Promise<DesktopUpdateCheckResult> => {
    try {
      const result = await updater.checkForUpdates();
      if (result === null || !result.isUpdateAvailable) return { status: 'none' };
      return { status: 'available', version: result.updateInfo.version };
    } catch (error) {
      // §11: "Failed checks in notify mode log and stay silent (offline is
      // normal)." Returned as `error` for an explicit caller (the About/Settings
      // button awaits this), never thrown and never emitted as a notification.
      log(`[updater] check failed: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'error' };
    }
  };

  const cancels: Array<() => void> = [];
  // §11: `notify` checks on launch after a 30 s grace + every 24 h; `manual`
  // never auto-checks (Help → "Check for updates…" only). `disabled` never
  // reaches here.
  if (opts.mode === 'notify') {
    cancels.push(scheduler.after(LAUNCH_CHECK_GRACE_MS, () => void check()));
    cancels.push(scheduler.every(PERIODIC_CHECK_MS, () => void check()));
  }

  return {
    checkForUpdates: check,
    async downloadUpdate(): Promise<void> {
      if (!canSelf) {
        // deb/rpm/pacman (§11 "no self-replace"): the SPA's Download action lands
        // here, and the honest answer is the GitHub page — surfaced as the error
        // message the bridge carries to the user.
        throw new Error(
          `This installation type cannot update itself. Download the latest release from ${releasesUrl}`,
        );
      }
      try {
        await updater.downloadUpdate();
      } catch (error) {
        // The one error §11 surfaces as a notification: a download the user
        // STARTED ("Download → progress") that then stalled. Distinct from a
        // failed check, which stays silent (the `error` listener above only
        // logs). Emitted AND rethrown, so the SPA's button and the notification
        // centre both learn of it.
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    quitAndInstall(): void {
      if (!canSelf) {
        log('[updater] quitAndInstall ignored: this package type does not self-replace');
        return;
      }
      updater.quitAndInstall();
    },
    dispose(): void {
      for (const cancel of cancels) cancel();
      cancels.length = 0;
      updater.removeAllListeners();
    },
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** The release body for the `available` event, or `undefined` if there is none. */
function releaseNotesText(info: UpdaterInfo): string | undefined {
  const notes = info.releaseNotes;
  if (typeof notes === 'string' && notes.trim() !== '') return notes;
  const name = info.releaseName;
  if (typeof name === 'string' && name.trim() !== '') return name;
  return undefined;
}

/** electron-updater reports `percent` as a float; §4's event is an integer 0–100. */
function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

const toLine = (message: unknown): string =>
  typeof message === 'string' ? message : String(message);
