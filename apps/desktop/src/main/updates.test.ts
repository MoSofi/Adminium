// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The updater (11-electron.md §11), driven through injected ports — no Electron,
 * no electron-updater, no real timers. What these pin is exactly what the module
 * header calls unpinnable by the Playwright suite: the CORRECTNESS rule
 * (`disabled` constructs nothing and touches no network), the per-mode schedule
 * (`notify` checks on launch + daily, `manual` never), and the translation of
 * autoUpdater events into the ONE §4 notification pipeline.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi, type Mock } from 'vitest';

import type { DesktopUpdateEvent } from '../preload/api.js';
import {
  canSelfUpdate,
  compareDesktopTags,
  createUpdateManager,
  DESKTOP_RELEASES_API_URL,
  DESKTOP_TAG_PATTERN,
  feedForTag,
  FEED_REPO,
  LAUNCH_CHECK_GRACE_MS,
  MAX_RELEASE_PAGES,
  PERIODIC_CHECK_MS,
  RELEASES_URL,
  resolveDesktopRelease,
  resolveUpdateMode,
  type CreateUpdateManagerOptions,
  type UpdaterCheckResult,
  type UpdaterEventName,
  type UpdaterPort,
} from './updates.js';

/**
 * The REAL `GET /repos/MoSofi/Adminium/releases` payload, recorded 2026-08-18.
 * It is the actual regression case, not a hand-built one: it contains
 * `v0.2.1` — which is what `/releases/latest` answers and what the broken code
 * resolved — and `v0.2.2-rc.0`, which is newer still and first in the array.
 */
const RELEASES_FIXTURE: unknown = JSON.parse(
  readFileSync(new URL('../test/fixtures/github-releases.json', import.meta.url), 'utf8'),
);

/**
 * A `fetch` that answers one payload and RECORDS its calls. The recording is
 * the point: without asserting the URL, pointing the resolver back at
 * `/releases/latest` — the exact bug — leaves this whole suite green.
 */
function fakeFetch(payload: unknown, ok = true): Mock {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(payload),
      headers: new Headers(),
    } as unknown as Response),
  );
}

/**
 * A paginated `fetch`: each page answers with a `Link: rel="next"` pointing at
 * the following one.
 */
function pagedFetch(pages: unknown[]): Mock {
  let index = 0;
  return vi.fn(() => {
    const body = pages[index] ?? [];
    index += 1;
    const hasNext = index < pages.length;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      headers: new Headers(
        hasNext
          ? { link: `<https://api.github.com/repos/MoSofi/Adminium/releases?per_page=100&page=${index + 1}>; rel="next"` }
          : {},
      ),
    } as unknown as Response);
  });
}

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
  it('notify checks on launch after a 30 s grace and then every 24 h', async () => {
    const fake = fakeUpdater(null);
    const { scheduler, afters, everies } = fakeScheduler();

    createUpdateManager({
      mode: 'notify',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler,
      fetchImpl: fakeFetch(RELEASES_FIXTURE),
    });

    expect(afters).toHaveLength(1);
    expect(afters[0]?.ms).toBe(LAUNCH_CHECK_GRACE_MS);
    expect(everies).toHaveLength(1);
    expect(everies[0]?.ms).toBe(PERIODIC_CHECK_MS);

    // Nothing has checked yet — the grace has not elapsed.
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    // Firing the launch timer runs a check; the periodic one does too. Each
    // now resolves the release feed first, so the assertion has to await that
    // — a scheduled check is fire-and-forget by design (§11).
    afters[0]?.fn();
    everies[0]?.fn();
    await vi.waitFor(() => expect(fake.checkForUpdates).toHaveBeenCalledTimes(2));
  });

  it('manual never schedules a check — Help → "Check for updates…" only', async () => {
    const fake = fakeUpdater(null);
    const { scheduler, afters, everies } = fakeScheduler();

    const manager = createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler,
      fetchImpl: fakeFetch(RELEASES_FIXTURE),
    });

    expect(afters).toHaveLength(0);
    expect(everies).toHaveLength(0);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();

    // But an explicit check still works.
    await manager?.checkForUpdates();
    expect(fake.checkForUpdates).toHaveBeenCalledOnce();
  });
});

// ─── updater configuration (§11 verbatim) ────────────────────────────────────

describe('the updater is configured per §11', () => {
  it('disables auto-download / auto-install / prerelease / downgrade', () => {
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
    // Pinned to the REAL repository. `adminium/adminium` is an unrelated third
    // party's org+repo, and whatever is named here is trusted to serve a shipped
    // install its next installer (unsigned on Windows ⇒ no signature check), so
    // this assertion is a supply-chain guard, not a spelling test.
    expect(FEED_REPO).toEqual({ owner: 'MoSofi', repo: 'Adminium' });
    expect(RELEASES_URL).toBe('https://github.com/MoSofi/Adminium/releases');
    expect(DESKTOP_RELEASES_API_URL).toBe(
      'https://api.github.com/repos/MoSofi/Adminium/releases?per_page=100',
    );
  });

  it('sets NO feed at construction — resolution is per-check and must not touch the network', () => {
    const fake = fakeUpdater(null);
    const fetchImpl = fakeFetch(RELEASES_FIXTURE);
    createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
      fetchImpl,
    });

    expect(fake.setFeedURL).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ─── Release resolution: the bug this suite exists to prevent ────────────────

/**
 * THE REGRESSION. Every case below fails against the pre-2026-08-18 code, which
 * let electron-updater resolve the tag from `/releases/latest` — a single stored
 * pointer for the whole repository, which sat on the npm series' `v0.2.1` and
 * carried no installers, so every shipped install 404'd on `latest-mac.yml`.
 */
describe('resolveDesktopRelease picks our tag series out of the real feed', () => {
  it('picks desktop-v0.2.1 from the recorded payload, not v0.2.1 and not the rc', () => {
    const release = resolveDesktopRelease(RELEASES_FIXTURE);

    expect(release?.tag).toBe('desktop-v0.2.1');
    expect(release?.version).toBe('0.2.1');
    // The two traps, stated explicitly so a future reader knows they are the point:
    // `v0.2.1` is what /releases/latest answers, and `v0.2.2-rc.0` is both newer
    // and FIRST in the array.
    expect(release?.tag).not.toBe('v0.2.1');
    expect(release?.tag).not.toBe('v0.2.2-rc.0');
    // Pinned on the pattern itself, not only on the selection outcome. Widening
    // the pattern to admit the npm series still happens to select the desktop
    // tag through the comparator, so selection alone does not prove exclusivity
    // — these two assertions are what actually hold the series apart.
    expect(DESKTOP_TAG_PATTERN.test('v0.2.1')).toBe(false);
    expect(DESKTOP_TAG_PATTERN.test('v0.2.2-rc.0')).toBe(false);
  });

  it('builds a feed pinned to that release, with multi-range off', () => {
    expect(feedForTag('desktop-v0.2.1')).toEqual({
      provider: 'generic',
      url: 'https://github.com/MoSofi/Adminium/releases/download/desktop-v0.2.1',
      // GitHub's asset CDN answers a multipart Range with 501; leaving this on
      // silently degrades every delta download to a full one.
      useMultipleRangeRequest: false,
    });
  });

  it('selects by highest version, never by list position or publish date', () => {
    const release = resolveDesktopRelease([
      { tag_name: 'desktop-v0.9.0', draft: false, prerelease: false, body: 'older line' },
      { tag_name: 'desktop-v0.10.0', draft: false, prerelease: false, body: 'newest' },
      { tag_name: 'desktop-v0.9.1', draft: false, prerelease: false, body: 'patch, published last' },
    ]);
    expect(release?.tag).toBe('desktop-v0.10.0');
    // The comparator must not be apps/server's, which parses every desktop tag
    // to [0,0,0] and would leave all three tied.
    expect(compareDesktopTags('desktop-v0.10.0', 'desktop-v0.9.0')).toBeGreaterThan(0);
  });

  it('skips drafts and prereleases, and refuses a release-candidate tag outright', () => {
    expect(
      resolveDesktopRelease([
        { tag_name: 'desktop-v0.3.0', draft: true, prerelease: false },
        { tag_name: 'desktop-v0.2.5', draft: false, prerelease: true },
        { tag_name: 'desktop-v0.2.1', draft: false, prerelease: false },
      ])?.tag,
    ).toBe('desktop-v0.2.1');

    // Belt as well as braces: desktop-release.yml derives --prerelease from the
    // tag, but under the `generic` provider `allowPrerelease` is read by nothing,
    // so the pattern is the only guard that cannot be forgotten at publish time.
    expect(DESKTOP_TAG_PATTERN.test('desktop-v0.3.0-rc.1')).toBe(false);
    expect(
      resolveDesktopRelease([
        { tag_name: 'desktop-v0.3.0-rc.1', draft: false, prerelease: false },
      ]),
    ).toBeNull();
  });

  it('rejects anything that could escape the download path when interpolated', () => {
    for (const tag of ['desktop-v0.2.1/../../evil', 'desktop-v0.2.1%2F..', 'desktop-v../0.2.1']) {
      expect(DESKTOP_TAG_PATTERN.test(tag)).toBe(false);
    }
    expect(resolveDesktopRelease([{ tag_name: '../../evil', draft: false, prerelease: false }])).toBeNull();
  });

  it('returns null for a payload that is not a release list', () => {
    expect(resolveDesktopRelease(null)).toBeNull();
    expect(resolveDesktopRelease({ message: 'API rate limit exceeded' })).toBeNull();
    expect(resolveDesktopRelease([])).toBeNull();
  });
});

describe('a check resolves the feed before every check', () => {
  const build = (fetchImpl: Mock, result: UpdaterCheckResult | null = null) => {
    const fake = fakeUpdater(result);
    const manager = createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit: vi.fn(),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
      fetchImpl,
    });
    return { fake, manager };
  };

  it('pins the feed to the resolved release, and re-resolves on the next check', async () => {
    const fetchImpl = fakeFetch(RELEASES_FIXTURE);
    const { fake, manager } = build(fetchImpl);

    await manager?.checkForUpdates();

    // WHICH URL. Without this, restoring the original bug — pointing resolution
    // back at /releases/latest — leaves every other assertion in this file green.
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(DESKTOP_RELEASES_API_URL);
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('/releases/latest');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { accept: 'application/vnd.github+json' },
    });

    // The literal URL too, so a refactor of FEED_REPO cannot quietly retarget it.
    expect(DESKTOP_RELEASES_API_URL).toBe(
      'https://api.github.com/repos/MoSofi/Adminium/releases?per_page=100',
    );
    expect(fake.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://github.com/MoSofi/Adminium/releases/download/desktop-v0.2.1',
      useMultipleRangeRequest: false,
    });

    // ORDER. Swapping these two lines re-creates the production bug on the first
    // check of every session, and nothing else in this file would notice.
    expect(fake.setFeedURL.mock.invocationCallOrder[0]).toBeLessThan(
      fake.checkForUpdates.mock.invocationCallOrder[0] as number,
    );

    // Re-resolved rather than cached: a long-running app must see a release
    // published after launch. Asserted on the FETCH, not on setFeedURL — a
    // caching implementation would still call setFeedURL twice.
    await manager?.checkForUpdates();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('walks past a page full of the other tag series', async () => {
    // The original bug in a second costume: the list is repository-wide and
    // date-sorted, and `v*` is far denser than `desktop-v*`. A single page would
    // resolve nothing here and every install would silently stop updating.
    const npmPage = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `v9.${i}.0`,
      draft: false,
      prerelease: false,
    }));
    const fetchImpl = pagedFetch([
      npmPage,
      [{ tag_name: 'desktop-v0.2.1', draft: false, prerelease: false, body: 'notes' }],
    ]);
    const { fake, manager } = build(fetchImpl);

    await manager?.checkForUpdates();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('page=2');
    expect(fake.setFeedURL).toHaveBeenCalledWith(feedForTag('desktop-v0.2.1'));
  });

  it('stops walking at the page cap rather than crawling forever', async () => {
    const endless = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]),
        headers: new Headers({
          link: '<https://api.github.com/repos/MoSofi/Adminium/releases?page=99>; rel="next"',
        }),
      } as unknown as Response),
    );
    const { manager } = build(endless as unknown as Mock);

    expect(await manager?.checkForUpdates()).toEqual({ status: 'error' });
    expect(endless).toHaveBeenCalledTimes(MAX_RELEASE_PAGES);
  });

  it('never follows a next link off api.github.com', async () => {
    const offHost = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]),
        headers: new Headers({ link: '<https://evil.example/releases>; rel="next"' }),
      } as unknown as Response),
    );
    const { manager } = build(offHost as unknown as Mock);

    expect(await manager?.checkForUpdates()).toEqual({ status: 'error' });
    // Followed once (the real endpoint) and stopped — the header is
    // server-controlled and must never be able to walk us onto another origin.
    expect(offHost).toHaveBeenCalledTimes(1);
  });

  it('reports `error`, never `none`, when the feed cannot be read', async () => {
    // A rate-limited API rendered as `none` would print "You are on the latest
    // version." — the same lie in a new place.
    const rateLimited = build(fakeFetch({ message: 'API rate limit exceeded' }, false));
    expect(await rateLimited.manager?.checkForUpdates()).toEqual({ status: 'error' });
    expect(rateLimited.fake.checkForUpdates).not.toHaveBeenCalled();

    const noDesktopRelease = build(fakeFetch([{ tag_name: 'v0.2.1', draft: false, prerelease: false }]));
    expect(await noDesktopRelease.manager?.checkForUpdates()).toEqual({ status: 'error' });

    const offline = build(vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))));
    expect(await offline.manager?.checkForUpdates()).toEqual({ status: 'error' });
  });

  it('carries the release body into the available notification', async () => {
    const fake = fakeUpdater(null);
    const emitted: DesktopUpdateEvent[] = [];
    const manager = createUpdateManager({
      mode: 'manual',
      getUpdater: () => fake.updater,
      emit: (event) => emitted.push(event),
      canSelfUpdate: true,
      scheduler: fakeScheduler().scheduler,
      fetchImpl: fakeFetch([
        { tag_name: 'desktop-v9.9.9', draft: false, prerelease: false, body: 'Fixes the updater.' },
      ]),
    });

    await manager?.checkForUpdates();
    // electron-updater's `generic` provider parses the yml and nothing else: it
    // back-fills neither `releaseNotes` nor `releaseName` (only `GitHubProvider`
    // did, from the Atom feed), and our published latest*.yml carry neither key.
    // So an event with an empty info object is exactly what the real provider
    // emits, and the resolved body is the ONLY source of notes.
    fake.fire('update-available', { version: '9.9.9' });

    expect(emitted).toEqual([{ type: 'available', version: '9.9.9', message: 'Fixes the updater.' }]);
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
        // Not optional: a check resolves the release feed first, so without this
        // seam these cases would reach api.github.com and pass or fail on
        // whether the machine happens to be online.
        fetchImpl: fakeFetch(RELEASES_FIXTURE),
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
      fetchImpl: fakeFetch(RELEASES_FIXTURE),
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
