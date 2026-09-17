// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app catalog client (b, G8-D1 to D5; 4c).
 *
 * The add-on catalog client's twin, with the same shape for the same reasons:
 * the off-switch is checked FIRST, before a URL exists, so there is no code path
 * from a disabled client to `fetch` (`app-network-isolation.test.ts` pins it
 * with a recording thrower); both addresses are compile-time constants; and the
 * transport is THE SAME FUNCTION the add-on client uses (`boundedRequest`):
 * exact hosts, redirects refused, streaming size caps, a timeout and the
 * caller's cancellation.
 *
 * ── WHAT IS DIFFERENT, AND WHY ──────────────────────────────────────────────
 *
 *  - ITS OWN SWITCH (R2). `apps.catalogEnabled` is a separate opt-in from the
 *    add-on one. An operator may want apps browsable online and add-ons not, or
 *    the reverse, and one switch could not say that.
 *  - ITS OWN DOCUMENT (R1). `/marketplace/v2/apps.json`, parsed `.strict()` by
 *    this schema only, so neither feed can break the other's servers by growing
 *    a field.
 *  - A MINIMUM THAT MEANS SOMETHING (G8-D2). Each row carries the
 *    `minAdminiumVersion` its release manifest declares. Release tooling refuses
 *    a minimum no published Adminium meets (48 A17), so a row above this
 *    server's version is a real "not yet" and is listed that way rather than
 *    offered.
 *
 * THE FINGERPRINT is the row's `integrity`: the release ledger's value, carried
 * by a feed the website builds from the ledger at a pinned commit. The app
 * store checks the downloaded bytes against it before unpacking anything.
 *
 * THE DISCLOSURE is the add-on client's: refreshing tells adminium.dev this
 * deployment's IP and Adminium version, and a download tells Cloudflare, which
 * serves downloads.adminium.dev, the same plus the exact app and version.
 */

import { settingsRepo, type MetaDb } from '@adminium/meta';
import { compareSemver } from '@adminium/manifest';
import { z } from 'zod';

import {
  ADD_ON_KEY_PATTERN,
  AddOnCatalogError,
  DOWNLOAD_HOST,
  EXACT_VERSION_PATTERN,
  MAX_CATALOG_BYTES,
  MAX_TARBALL_BYTES,
  boundedRequest,
  downloadUrlFor,
} from '../add-ons/catalog.js';
import { APP_VERSION } from '../version.js';

/** The static app feed the website emits. Never serves files. */
export const APP_CATALOG_ENDPOINT = 'https://adminium.dev/marketplace/v2/apps.json';

/** The settings-registry key behind the app catalog's default-off switch (R2). */
export const APP_CATALOG_ENABLED_SETTING = 'apps.catalogEnabled';

const localized = z.record(z.string(), z.string());

/**
 * One feed row, strict: a field this server does not know is a REFUSAL, which
 * is how "no price field by construction" holds here too.
 */
export const appCatalogEntrySchema = z
  .object({
    key: z.string().regex(ADD_ON_KEY_PATTERN),
    version: z.string().regex(EXACT_VERSION_PATTERN),
    /** The release ledger's value, `sha512-<base64>`. */
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
    name: localized,
    tagline: localized,
    categories: z.array(z.string()),
    capabilities: z.array(z.string()),
    /** `publisher.name` from the release manifest. */
    publisher: z.string().min(1),
    sides: z.array(z.enum(['staff', 'customer'])).min(1),
    /** The minimum the release manifest declares; this server refuses one above its version. */
    minAdminiumVersion: z.string().regex(EXACT_VERSION_PATTERN),
  })
  .strict();

export const appCatalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    generatedAt: z.string().min(1),
    apps: z.array(appCatalogEntrySchema),
  })
  .strict();

export type AppCatalogEntry = z.infer<typeof appCatalogEntrySchema>;
export type AppCatalog = z.infer<typeof appCatalogSchema>;

/** A cached document in the format this server reads, rather than any JSON at all. */
export function isCurrentAppCatalogFormat(document: unknown): boolean {
  return (
    typeof document === 'object' &&
    document !== null &&
    (document as { schemaVersion?: unknown }).schemaVersion === 2 &&
    Array.isArray((document as { apps?: unknown }).apps)
  );
}

/**
 * Whether this server meets a release's declared minimum. `current` is a
 * parameter for tests; production always asks about the running version.
 */
export function meetsMinimum(minimum: string, current: string = APP_VERSION): boolean {
  return compareSemver(current, minimum) >= 0;
}

/** The address one app release is downloaded from: `/apps/<key>/<key>-<version>.tgz`. */
export function appDownloadUrlFor(key: string, version: string, base = `https://${DOWNLOAD_HOST}`): string {
  return downloadUrlFor(key, version, base, 'apps');
}

export interface AppCatalogClientDeps {
  meta: MetaDb;
  /** `ADMINIUM_NETWORK_FEATURES`. When off, the client refuses before any URL is built. */
  networkFeatures: boolean;
  /** Tests only; production always reads {@link APP_CATALOG_ENDPOINT}. */
  endpoint?: string | undefined;
  /** Tests only; production always downloads from {@link DOWNLOAD_HOST}. */
  downloadBase?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
}

export interface AppCatalogClient {
  /** The gate: network features AND the app switch. No network. */
  isEnabled(): Promise<boolean>;
  /** Whether the environment permits online browsing at all, ignoring the stored setting. */
  networkFeaturesAllowed(): boolean;
  /** Fetch and validate the feed. Refuses without touching the network when off. */
  fetchCatalog(signal?: AbortSignal): Promise<AppCatalog>;
  /** Download one row's file. The STORE verifies it against the row's integrity. */
  fetchTarball(entry: Pick<AppCatalogEntry, 'key' | 'version'>, signal?: AbortSignal): Promise<Uint8Array>;
}

export function createAppCatalogClient(deps: AppCatalogClientDeps): AppCatalogClient {
  const endpoint = deps.endpoint ?? APP_CATALOG_ENDPOINT;
  const downloadBase = deps.downloadBase ?? `https://${DOWNLOAD_HOST}`;
  const settings = settingsRepo(deps.meta);
  const doFetch = (): typeof globalThis.fetch => deps.fetchImpl ?? globalThis.fetch;

  async function isEnabled(): Promise<boolean> {
    if (!deps.networkFeatures) return false;
    return (await settings.get(APP_CATALOG_ENABLED_SETTING)) === true;
  }

  /** Refuse BEFORE any URL exists. The isolation test pins the order. */
  async function assertEnabled(): Promise<void> {
    if (!deps.networkFeatures) {
      throw new AddOnCatalogError(
        'NETWORK_FEATURES_OFF',
        'ADMINIUM_NETWORK_FEATURES is off; the app catalog makes no outbound calls',
      );
    }
    if ((await settings.get(APP_CATALOG_ENABLED_SETTING)) !== true) {
      throw new AddOnCatalogError(
        'CATALOG_DISABLED',
        'the online app catalog is off; bundled and uploaded apps are available without it',
      );
    }
  }

  return {
    isEnabled,
    networkFeaturesAllowed: () => deps.networkFeatures,

    async fetchCatalog(signal) {
      await assertEnabled();
      const { bytes } = await boundedRequest(
        doFetch(),
        endpoint,
        'application/json',
        MAX_CATALOG_BYTES,
        'CATALOG_UNREACHABLE',
        signal,
      );
      let body: unknown;
      try {
        body = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch (err) {
        throw new AddOnCatalogError('CATALOG_UNREACHABLE', `${endpoint} did not return JSON: ${String(err)}`);
      }
      const parsed = appCatalogSchema.safeParse(body);
      if (!parsed.success) {
        throw new AddOnCatalogError(
          'CATALOG_MALFORMED',
          `app catalog does not match the expected schema: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
      }
      return parsed.data;
    },

    async fetchTarball(entry, signal) {
      await assertEnabled();
      const url = appDownloadUrlFor(entry.key, entry.version, downloadBase);
      const { bytes } = await boundedRequest(
        doFetch(),
        url,
        'application/octet-stream',
        MAX_TARBALL_BYTES,
        'TARBALL_UNREACHABLE',
        signal,
        'TARBALL_NOT_FOUND',
      );
      return bytes;
    },
  };
}
