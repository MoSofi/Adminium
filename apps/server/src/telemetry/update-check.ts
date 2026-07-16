/**
 * Self-host update-available check (M10-T04): compares the running build
 * against the latest public release so a self-hoster learns a security fix
 * exists without subscribing to anything.
 *
 * GATING — the deliberate choice, per the track brief ("gate the check behind
 * the telemetry/update preference so an opted-out instance makes no outbound
 * call; state your choice and make it testable"):
 *
 *   The check is gated on its OWN setting, `updates.checkEnabled`, which is
 *   default-false — NOT on `telemetry.enabled`.
 *
 * Why its own key rather than reusing the telemetry answer: the two disclose
 * different things and deserve different answers. Telemetry pushes a document
 * about the instance; an update check pulls a version list but still discloses
 * the instance's IP + `User-Agent` version to whoever serves it. An operator
 * who declines telemetry may still want security notices, and one who accepts
 * telemetry has not thereby agreed to a periodic beacon. Both default OFF, both
 * are asked on the same first-run consent screen, and both are editable later.
 *
 * When the setting is false, `check()` returns `{ status: 'disabled' }` before
 * touching `fetch` — `telemetry-network-isolation.test.ts` asserts that with
 * all outbound network disabled. Requests carry NO instance id and no payload:
 * an update check is a plain GET, so it is not a telemetry channel in disguise.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

/** The public release feed for the AGPL repo (01-architecture.md §9). */
export const UPDATE_FEED_URL = 'https://api.github.com/repos/adminium/adminium/releases/latest';
export const RELEASES_PAGE_URL = 'https://github.com/adminium/adminium/releases';

/** Don't re-check more than once an hour, however often About is opened. */
export const UPDATE_CACHE_TTL_MS = 3_600_000;

export type UpdateCheckResult =
  /** Opted out — no outbound call was made. */
  | { status: 'disabled' }
  | { status: 'current'; current: string }
  | { status: 'update-available'; current: string; latest: string; url: string }
  /** Feed unreachable/unparseable — never surfaced as an error to the user. */
  | { status: 'unknown'; current: string };

/**
 * Compares `major.minor.patch`, ignoring a leading `v` and any
 * prerelease/build suffix. Returns <0, 0, >0 (a vs b). A prerelease of X is
 * treated AS X: `0.5.0-rc.1` never reports "0.5.0 available", which would be a
 * false alarm on the release it already is.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const core = v.trim().replace(/^v/, '').split(/[-+]/)[0] ?? '';
    const parts = core.split('.').map((n) => Number.parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0].map((n) => (Number.isNaN(n) ? 0 : n));
  };
  const [aMajor, aMinor, aPatch] = parse(a) as [number, number, number];
  const [bMajor, bMinor, bPatch] = parse(b) as [number, number, number];
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

export interface UpdateCheckDeps {
  meta: MetaDb;
  /** The running build (apps/server package.json). */
  version: string;
  feedUrl?: string | undefined;
  releasesUrl?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
  cacheTtlMs?: number | undefined;
}

export interface UpdateCheckService {
  /** Reads `updates.checkEnabled`; no network. */
  isEnabled(): Promise<boolean>;
  check(): Promise<UpdateCheckResult>;
}

export function createUpdateCheckService(deps: UpdateCheckDeps): UpdateCheckService {
  const { meta, version } = deps;
  const feedUrl = deps.feedUrl ?? UPDATE_FEED_URL;
  const releasesUrl = deps.releasesUrl ?? RELEASES_PAGE_URL;
  const now = deps.now ?? (() => Date.now());
  const cacheTtlMs = deps.cacheTtlMs ?? UPDATE_CACHE_TTL_MS;
  const settings = settingsRepo(meta);

  let cache: { at: number; result: UpdateCheckResult } | null = null;

  async function isEnabled(): Promise<boolean> {
    return settings.get('updates.checkEnabled');
  }

  async function fetchLatest(): Promise<string | null> {
    const doFetch = deps.fetchImpl ?? globalThis.fetch;
    try {
      const response = await doFetch(feedUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const tag = (body as { tag_name?: unknown } | null)?.tag_name;
      return typeof tag === 'string' && tag.length > 0 ? tag : null;
    } catch {
      return null;
    }
  }

  return {
    isEnabled,

    async check(): Promise<UpdateCheckResult> {
      // FIRST: opted out ⇒ no fetch, no cache read, nothing.
      if (!(await isEnabled())) return { status: 'disabled' };

      if (cache !== null && now() - cache.at < cacheTtlMs) return cache.result;

      const latest = await fetchLatest();
      const result: UpdateCheckResult =
        latest === null
          ? { status: 'unknown', current: version }
          : compareVersions(latest, version) > 0
            ? { status: 'update-available', current: version, latest: latest.replace(/^v/, ''), url: releasesUrl }
            : { status: 'current', current: version };

      // Don't cache a transient failure — the next open should retry.
      if (result.status !== 'unknown') cache = { at: now(), result };
      return result;
    },
  };
}
