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
 * §11: the feed is the `MoSofi/Adminium` repo's GitHub Releases, and the tag
 * series is `desktop-vX.Y.Z` — which this module resolves ITSELF rather than
 * letting electron-updater's GitHub provider do it.
 *
 * ─── Why we do not use the `github` provider (this was a live bug) ───────────
 *
 * With `allowPrerelease: false`, `GitHubProvider.getLatestVersion()` resolves
 * the tag through `getLatestTagName()`, which GETs
 * `https://github.com/<owner>/<repo>/releases/latest`. GitHub's "latest" is a
 * single STORED pointer for the whole repository, not a per-series sort — and
 * this repository publishes TWO interleaved tag series, `vX.Y.Z` for npm/Docker
 * and `desktop-vX.Y.Z` for this app. The pointer sat on `v0.2.1`, an npm release
 * that carries no installers, so every shipped install resolved that tag and
 * then 404'd fetching `releases/download/v0.2.1/latest-mac.yml`. Because the
 * failure is in TAG resolution — before a per-platform channel file is chosen —
 * Windows and Linux failed identically. `vPrefixedTagName` did not help and
 * never could: electron-updater reads it nowhere.
 *
 * So: {@link resolveDesktopRelease} picks the newest `desktop-v*` release out of
 * the releases LIST endpoint, and {@link feedForTag} pins electron-updater to
 * that one release's asset directory with the `generic` provider. This is the
 * same read `apps/server/src/telemetry/update-check.ts` already performs for the
 * server series, and for the same documented reason.
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
 * Keep this the ONE definition: {@link RELEASES_URL}, {@link DESKTOP_RELEASES_API_URL}
 * and the updater test all derive from or assert against it. (The offline-asset
 * check is a different thing that used to be listed here — it scans BUNDLED
 * assets for remote references and has no bearing on this constant; note that
 * resolution now also reaches `api.github.com`, a second host, which is why the
 * air-gap guarantee is enforced by `mode: "disabled"` rather than by a host
 * list.) apps/desktop/electron-builder.yml + apps/desktop/dev-app-update.yml
 * name the same owner/repo (YAML cannot import, so those two are checked by
 * eye) — but note they do NOT override this file: `setFeedURL` assigns
 * electron-updater's provider eagerly, and the generated `app-update.yml` is
 * read only when `setFeedURL` was never called.
 */
export const FEED_REPO = { owner: 'MoSofi', repo: 'Adminium' } as const;

/**
 * §2.4 / §14 external-link policy: the human download page, offered when the
 * running package cannot self-replace (deb/rpm, {@link canSelfUpdate}).
 *
 * Derived from {@link FEED_REPO} rather than spelled out again — the two named
 * the same third-party repo before, and a hand-written copy is exactly how the
 * drift happened. `apps/server/test/docs-contract.test.ts` pins this literal.
 */
export const RELEASES_URL = `https://github.com/${FEED_REPO.owner}/${FEED_REPO.repo}/releases`;

/**
 * The releases LIST endpoint — deliberately NOT `/releases/latest`.
 *
 * `/releases/latest` answers with the repository's single stored "latest"
 * pointer, which any release in either tag series can hold. Reading the list and
 * picking the newest release whose tag is OUR series is the only correct read.
 * Same endpoint, same reasoning, and the same trap as
 * `apps/server/src/telemetry/update-check.ts` — see its comment, which describes
 * this exact failure for the server series.
 */
export const DESKTOP_RELEASES_API_URL = `https://api.github.com/repos/${FEED_REPO.owner}/${FEED_REPO.repo}/releases?per_page=100`;

/**
 * How many pages of the release list to walk before giving up.
 *
 * WHY PAGINATE AT ALL — this is the original bug in a second costume. The list
 * is repository-wide and date-sorted, and the `v*` series is far denser than
 * ours: a single unpaginated page would work until 100 npm releases sit newer
 * than the newest desktop release, at which point our tag falls off the window,
 * resolution returns null, and every install silently stops updating. Reading
 * one repo-wide window and hoping the sparse series is inside it is exactly the
 * assumption `/releases/latest` made.
 *
 * The cap is what stops a repo with thousands of releases turning one check into
 * an unbounded crawl; 5 × 100 is far past any plausible gap.
 */
export const MAX_RELEASE_PAGES = 5;

/**
 * Per-request ceiling on release resolution. Short on purpose: this runs before
 * every check, including the one behind a button the user is watching.
 */
export const RESOLVE_TIMEOUT_MS = 10_000;

/**
 * Desktop release tags. Anchored, and deliberately STABLE-ONLY.
 *
 * Two reasons it rejects a `-rc` suffix rather than mirroring the server
 * pattern. First, under the `generic` provider `allowPrerelease` is read by
 * nothing (only `GitHubProvider` consults it), so this regex is the only thing
 * standing between a release-candidate tag and every stable install. Second, the
 * GitHub `prerelease` flag cannot be relied on as the guard on its own — it is
 * set by whoever publishes. The flag is checked too, in
 * {@link resolveDesktopRelease}; this is the belt.
 *
 * Anchoring also makes the tag safe to interpolate into a URL: no `/`, no `..`,
 * no percent-encoding can match.
 */
export const DESKTOP_TAG_PATTERN = /^desktop-v\d+\.\d+\.\d+$/;

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

// ─── Release resolution (§11) ────────────────────────────────────────────────

/**
 * Compare two `desktop-v` tags by `major.minor.patch`. Returns <0, 0, >0.
 *
 * NOT `apps/server`'s `compareVersions`: that one strips a leading `v` and then
 * `parseInt`s each part, so every `desktop-v*` tag parses to `[0,0,0]` and all
 * of them tie. A tie would silently degrade selection to array order, which is
 * publish order — and "most recently published" is not "highest version".
 */
export function compareDesktopTags(a: string, b: string): number {
  const parse = (tag: string): [number, number, number] => {
    const parts = tag.slice('desktop-v'.length).split('.').map((n) => Number.parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

/**
 * Pick the newest desktop release out of a GitHub releases LIST payload.
 *
 * Pure, so the trap case is unit-testable against a recorded payload: the list
 * contains `v0.2.1` (what `/releases/latest` answers, and what the old code
 * resolved) and `v0.2.2-rc.0` (newer still), and neither may be chosen.
 *
 * Selection is by HIGHEST VERSION, never by array position — the endpoint sorts
 * by publish date, and a patch to an older desktop line would otherwise win.
 */
export function resolveDesktopRelease(payload: unknown): DesktopRelease | null {
  if (!Array.isArray(payload)) return null;
  let best: DesktopRelease | null = null;
  let bestTag = '';
  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; body?: unknown };
    if (row.draft === true || row.prerelease === true) continue;
    const tag = row.tag_name;
    if (typeof tag !== 'string' || !DESKTOP_TAG_PATTERN.test(tag)) continue;
    if (best !== null && compareDesktopTags(tag, bestTag) <= 0) continue;
    const notes = typeof row.body === 'string' && row.body.trim() !== '' ? row.body : undefined;
    best = { tag, version: tag.slice('desktop-v'.length), notes };
    bestTag = tag;
  }
  return best;
}

/** Pin electron-updater to one release's asset directory. */
export function feedForTag(tag: string): UpdaterFeed {
  return {
    provider: 'generic',
    url: `${RELEASES_URL}/download/${tag}`,
    useMultipleRangeRequest: false,
  };
}

// ─── Ports (the electron-updater surface, narrowed) ──────────────────────────

/**
 * §11: a `generic` feed pinned to ONE resolved release's asset directory.
 *
 * `useMultipleRangeRequest: false` is not optional and not cosmetic.
 * `BaseGitHubProvider` hardcodes it false; the generic branch of
 * electron-updater's `providerFactory` infers it TRUE for any URL that is not
 * `s3.amazonaws.com`, which includes github.com. GitHub's asset CDN answers a
 * multipart Range request with HTTP 501, so leaving it on silently turns every
 * differential (delta) download into a full re-download. This field is what
 * preserves the behaviour we had under the GitHub provider.
 */
export interface UpdaterFeed {
  readonly provider: 'generic';
  /** The release asset directory. No trailing slash needed, no query string. */
  readonly url: string;
  readonly useMultipleRangeRequest: false;
}

/** One release from the LIST endpoint, narrowed to what the updater needs. */
export interface DesktopRelease {
  /** e.g. `desktop-v0.2.1` — matched {@link DESKTOP_TAG_PATTERN}. */
  readonly tag: string;
  /** The tag with its `desktop-v` prefix stripped, e.g. `0.2.1`. */
  readonly version: string;
  /**
   * The GitHub release body, carried because the `generic` provider does NOT
   * back-fill `releaseNotes`/`releaseName` — `GitHubProvider` took those from
   * the Atom feed, and our `latest*.yml` carry neither key. Without it the §4
   * `available` event's `message` would go from populated to always-undefined.
   *
   * HONEST CAVEAT: nothing renders that message today. `DesktopUpdateToaster`
   * and the About card both read only `event.version`
   * (apps/dashboard/src/desktop/updates.tsx), so `message` on `available` is
   * plumbing that predates this change and is still unconsumed. It is kept
   * correct rather than dropped so that whoever wires release notes into the
   * About card finds a populated field instead of a silent empty one — but do
   * not read its presence as evidence that notes are shown.
   */
  readonly notes: string | undefined;
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
  /** Releases page override (tests); defaults to {@link RELEASES_URL}. */
  releasesUrl?: string | undefined;
  /** Releases LIST endpoint override (tests); defaults to {@link DESKTOP_RELEASES_API_URL}. */
  releasesApiUrl?: string | undefined;
  /**
   * Injected so the unit suite never reaches the network — the same seam
   * `apps/server/src/telemetry/update-check.ts` uses. Defaults to
   * `globalThis.fetch`, and is never CALLED in `disabled` mode (no manager) nor
   * before an explicit check in `manual` mode, which the §7 air-gap criterion
   * requires and the suite asserts.
   */
  fetchImpl?: typeof globalThis.fetch | undefined;
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
  const releasesUrl = opts.releasesUrl ?? RELEASES_URL;
  const releasesApiUrl = opts.releasesApiUrl ?? DESKTOP_RELEASES_API_URL;
  const log = opts.log ?? ((): void => {});
  /**
   * The release the most recent successful resolution picked, held so the
   * `update-available` handler can supply the notes the `generic` provider does
   * not carry. Set immediately before every `checkForUpdates()`.
   */
  let resolved: DesktopRelease | null = null;

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
  // NO `setFeedURL` here. The feed names one resolved release, so it is set in
  // `check()` immediately before each check — which is also what lets a
  // long-running app pick up a release published after launch. Construction must
  // stay network-free (the §7 air-gap criterion and the offline smoke test).

  updater.on('update-available', (payload) => {
    const info = payload as UpdaterInfo;
    // deb/rpm cannot self-replace, so the notice points at the download page
    // instead of the release body it would otherwise render in-app.
    const message = canSelf
      ? releaseNotesText(info, resolved)
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
      const release = await resolveRelease(releasesApiUrl, opts.fetchImpl);
      // `error`, NOT `none`. A rate-limited or unreachable API is not evidence
      // that we are current, and `none` renders as "You are on the latest
      // version." — which would be the same class of lie this whole change
      // exists to remove.
      if (release === null) {
        log('[updater] check failed: no desktop release could be resolved from the release feed');
        return { status: 'error' };
      }
      resolved = release;
      updater.setFeedURL(feedForTag(release.tag));

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
function releaseNotesText(info: UpdaterInfo, resolved: DesktopRelease | null): string | undefined {
  const notes = info.releaseNotes;
  if (typeof notes === 'string' && notes.trim() !== '') return notes;
  const name = info.releaseName;
  if (typeof name === 'string' && name.trim() !== '') return name;
  // The `generic` provider carries neither field (only `GitHubProvider`
  // back-filled them, from the Atom feed), and our `latest*.yml` files have no
  // `releaseNotes` key — so in practice this fallback is the ONLY source of
  // release notes, not a last resort.
  return resolved?.notes;
}

/**
 * Fetch the releases list and pick our newest one. `null` on any failure — the
 * caller maps that to §4 `error`, never to "up to date".
 *
 * Deliberately a plain GET with no credentials and no payload: an update check
 * is not a telemetry channel. `Accept` pins the API version so a future default
 * cannot reshape the response under us.
 *
 * KNOWN LIMIT, recorded rather than papered over: unauthenticated api.github.com
 * allows 60 requests/hour/IP, and the old github.com path had no such quota. At
 * two checks per install per day this is ample for individuals, and thin behind
 * a large NAT where many installs share an egress IP. An in-process TTL cache
 * would NOT fix that case — the requests come from different processes — so it
 * is not implemented here rather than implemented for the appearance of a fix.
 * What matters is that exhaustion is honest: a 403 returns null, which `check()`
 * maps to §4 `error`, never to "you are on the latest version".
 */
async function resolveRelease(
  apiUrl: string,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<DesktopRelease | null> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let url: string | null = apiUrl;

  for (let page = 0; page < MAX_RELEASE_PAGES && url !== null; page += 1) {
    const response = await doFetch(url, {
      headers: { accept: 'application/vnd.github+json' },
      // Without this an undici fetch waits out its 300 s default on a network
      // that drops rather than resets — a captive portal or a silently
      // blackholing firewall — so an explicit "Check for updates…" would hang
      // for five minutes with no feedback. The abort rejects, and `check()`'s
      // catch maps that to §4 `error`.
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const release = resolveDesktopRelease(await response.json());
    // Page order is publish order, and the newest desktop release is on the
    // first page that contains ANY desktop release — so the first hit wins and
    // there is no reason to keep walking.
    if (release !== null) return release;

    url = nextPageUrl(response.headers.get('link'));
  }
  return null;
}

/**
 * The `rel="next"` target from a GitHub `Link` header, or `null` at the end.
 *
 * Parsed rather than constructed by incrementing a `page=` parameter, because
 * the header is what GitHub itself says comes next — and it carries the opaque
 * cursor parameters that a hand-built URL would drop.
 */
function nextPageUrl(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  for (const part of linkHeader.split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(part);
    if (match?.[1] === undefined) continue;
    // Only ever follow GitHub's own API host: the header is server-controlled,
    // and following it blindly would let a compromised or spoofed response walk
    // us onto another origin.
    const next = new URL(match[1]);
    if (next.origin !== 'https://api.github.com') return null;
    return next.toString();
  }
  return null;
}

/** electron-updater reports `percent` as a float; §4's event is an integer 0–100. */
function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

const toLine = (message: unknown): string =>
  typeof message === 'string' ? message : String(message);
