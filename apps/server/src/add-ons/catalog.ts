// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on catalog client.
 *
 * Built on the telemetry client's precedent (`../telemetry/service.ts`): a
 * hardcoded first-party endpoint constant, an injectable `fetchImpl` so tests
 * can observe every call, and — the load-bearing part — THE OFF-SWITCH IS
 * CHECKED FIRST, before a payload is built or a URL is constructed. There is no
 * code path from a disabled client to `fetch`, which is what lets
 * `add-on-network-isolation.test.ts` prove D8's claim with a recording thrower
 * rather than by trusting a caught error.
 *
 * TWO HOSTNAMES, EXACTLY. `adminium.dev` serves the few-KB catalog index;
 * `downloads.adminium.dev` serves the files. Both are module constants, and so
 * is every address this client requests: a download URL is BUILT HERE from a
 * catalog row's key and exact version, never read out of remote data. The feed
 * carries no URL and no package name, so there is nothing in it that could
 * point a download at another host or another file. (Its v1 predecessor named
 * an npm package, and constraining that field to one value was the only thing
 * standing between whoever served the feed and a download of any package they
 * liked.)
 *
 * WHERE THE FINGERPRINT COMES FROM. The catalog row's `integrity` — the release
 * ledger's value, which the site's release sync checked against the file it
 * downloaded before it offered the release. Never from the download host: a folder that supplied both the
 * bytes and the hash they are checked against would be checking them against
 * themselves. The STORE verifies the downloaded bytes against it, in constant
 * time, before anything is unpacked.
 *
 * WHY THE D14 HOSTNAME *GRAMMAR* IS NOT IMPORTED HERE. That regex
 * (`add-on-contracts/src/add-on-block.ts`) exists to bound hostnames an add-on
 * DECLARES — attacker-controlled strings that must merely look like hostnames.
 * Here every destination is a compile-time constant, which is strictly stronger
 * than any grammar: a grammar accepts an infinite set, a constant accepts one.
 *
 * THE NETWORK IS AN INSTALL-TIME DEPENDENCY ONLY. Nothing here is reached at
 * boot or at serve time; an outage of either host cannot affect a running
 * deployment, and an air-gapped one never calls this module at all.
 *
 * THE DISCLOSURE, STATED. An online install tells adminium.dev and Cloudflare
 * (which serves downloads.adminium.dev) this deployment's IP, the time, the
 * Adminium version, and the exact add-on and version pulled. That is why the
 * toggle is default-off and why the docs page says so rather than leaving it to
 * be discovered.
 */

import {
  MARKETPLACE_FORMAT,
  addOnItemWireSchema,
  compareSemver,
  parseShelf,
  type AddOnItemWire,
  type ParsedShelf,
} from '@adminium/manifest';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { APP_VERSION } from '../version.js';

/**
 * The marketplace API's add-on shelf. Never serves files.
 *
 * THE LAST NEW ADDRESS. Released servers parsed the static feed they were
 * built against with a `.strict()` schema, so a field added to a document in
 * service broke every one of them at once: 0.2.3–0.2.8 read the frozen
 * `/marketplace/catalog.json`, 0.2.9–0.2.12 `/marketplace/v2/catalog.json`,
 * 0.3.0–0.3.5 `/marketplace/v3/catalog.json`, which the site still serves.
 * This API's items are read leniently and only their `release` strictly
 * (`@adminium/manifest` `marketplace-wire.ts`), so the site can grow a display
 * field without moving again.
 *
 * The request names this server's version (`?adminium=`), so the site offers
 * the newest release this version can install — and says when a newer one
 * needs a newer Adminium — rather than only its newest one.
 */
export const CATALOG_ENDPOINT = 'https://adminium.dev/api/v1/marketplace/add-ons';

/** The endpoint as requested: the shelf's address, naming this server's version. */
export function shelfUrl(endpoint: string, serverVersion: string = APP_VERSION): string {
  const url = new URL(endpoint);
  url.searchParams.set('adminium', serverVersion);
  return url.href;
}

/** The only host this client downloads a file from. */
export const DOWNLOAD_HOST = 'downloads.adminium.dev';

/** The settings-registry key behind D8's default-off browse-online toggle. */
export const CATALOG_ENABLED_SETTING = 'addOns.catalogEnabled';

/** Refusals that are the operator's to see, typed so routes can map them. */
export type CatalogRefusal =
  | 'CATALOG_DISABLED'
  | 'NETWORK_FEATURES_OFF'
  | 'CATALOG_UNREACHABLE'
  | 'CATALOG_MALFORMED'
  | 'DOWNLOAD_ADDRESS_MISMATCH'
  | 'REDIRECTED'
  | 'RESPONSE_TOO_LARGE'
  | 'TARBALL_NOT_FOUND'
  | 'TARBALL_UNREACHABLE'
  | 'UNKNOWN_ADD_ON'
  | 'UNKNOWN_APP'
  /** Listed as coming soon: there is nothing to download yet. */
  | 'NOT_RELEASED'
  /** An app whose manifest names a minimum Adminium above this server's version
   * (b G8-D2). */
  | 'REQUIRES_NEWER_ADMINIUM'
  /** A download whose manifest claims the publisher `local`, which only a file put there by hand may. */
  | 'LOCAL_FROM_CATALOG'
  /** The key is held by an app made on this install: a download would overwrite or replace it. */
  | 'PUBLISHER_CHANGED';

/**
 * Response caps and a wall-clock budget.
 *
 * The archive limits in `archive.ts` bound what is UNPACKED; they can do nothing
 * about a response body, because by the time they see it the bytes are already
 * in memory. So the transport caps the read itself, streaming and aborting —
 * otherwise a download host answering with an endless body is an OOM that no
 * amount of unpack hardening prevents.
 */
export const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
export const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
/** Per-request budget: a host that accepts a connection and never answers. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Every request says what it is; bot protection judges a bare runtime harshly.
 * */
export const USER_AGENT = `Adminium/${APP_VERSION}`;

export class AddOnCatalogError extends Error {
  override readonly name = 'AddOnCatalogError';
  readonly reason: CatalogRefusal;

  constructor(reason: CatalogRefusal, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * The feed's wire schema.
 *
 * THE ABSENCE OF PRICING IS ENFORCED BY CONSTRUCTION, NOT BY OMISSION: the object is `.strict()`,
 * so a feed carrying `price`, `licenseKey`, `tier`, or an availability teaser is
 * REFUSED rather than quietly ignored. A deferred-monetization rule that only
 * held because nobody happened to send the field would not be a rule.
 */
const localizedSchema = z.record(z.string(), z.string());

/** What a row shows beside its name: the byline, the icon, when it last changed. Shared with the app catalog. */
export const displayFields = {
  author: z.string().optional(),
  iconTint: z.string().optional(),
  iconPaths: z.array(z.string()).optional(),
  monogram: z.string().optional(),
  lastUpdatedAt: z.string().optional(),
};

/**
 * One string out of a feed-supplied localized record, for a product
 * locale.
 *
 * ── WHY THIS IS NOT A LOOKUP ────────────────────────────────────────────────
 *
 * THE TWO SIDES DO NOT SHARE A KEY SPACE, and assuming they did is the defect
 * this replaces. The product speaks `en_US`, `de_DE`, `zh_CN`, `ar_EG`; the
 * feed the website emits speaks `en`, `de`, `zh-cn`, `ar`. The browse route
 * used to read `entry.name['en_US']`, a key the feed has NEVER carried, so the
 * `?? key` fallback fired on every row and every catalog-sourced add-on was
 * labelled with its own slug.
 *
 * ── THE ORDER, AND WHY EACH LEG EARNS ITS PLACE ─────────────────────────────
 *
 *  1. the tag verbatim — a future feed that does speak `en_US` is honoured
 *     without a code change, and it costs one property read;
 *  2. the tag normalised (`_`→`-`, lowercased) — `zh_CN` → `zh-cn`. THIS LEG IS
 *     LOAD-BEARING AND MUST PRECEDE 3: Chinese is the case where the language
 *     subtag alone is not a locale anybody publishes, so a `zh` lookup misses
 *     and Simplified would silently render as English;
 *  3. the language subtag — `en_US` → `en`, `ar_EG` → `ar`, which is how six of
 *     the eight resolve;
 * 4. `en`, the one key requires every feed row to carry.
 *
 * Returns `null` rather than a placeholder when every leg misses: the caller
 * knows what it has locally (a staged manifest's name, or the key) and this
 * module does not.
 */
export function pickLocalized(
  record: Record<string, string> | undefined,
  locale: string,
): string | null {
  if (record === undefined) return null;
  const normalized = locale.replace(/_/g, '-').toLowerCase();
  const language = normalized.split('-')[0] ?? normalized;
  for (const candidate of [locale, normalized, language, 'en']) {
    const value = record[candidate];
    // A feed row carrying `"de": ""` is a missing translation, not a name.
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** An add-on key: the grammar the store, the payloads and the download path share. */
export const ADD_ON_KEY_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
/**
 * EXACT — never a range, never `latest` (D9).
 *
 * The prerelease/build tail is ONE optional group, not a repeated one. Repeating
 * `[-+][0-9A-Za-z.-]+` made the pattern ambiguous, because the tail class also
 * contains `-`: `-a-b` could be one segment or two, and a version that fails to
 * match backtracks through every split. `0.0.0+` followed by 22 `--` pairs took
 * 9.7 SECONDS to reject; 4 pairs fewer took 207 ms, which is the doubling that
 * gives it away. Since every accepted string is `[-+]` followed by more of the
 * same alphabet, one group accepts exactly what the repeated form did.
 */
export const EXACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/;

export const catalogEntrySchema = z
  .object({
    key: z.string().regex(ADD_ON_KEY_PATTERN),
    version: z.string().regex(EXACT_VERSION_PATTERN),
    /** The release ledger's value, `sha512-<base64>`. */
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
    provides: z
      .array(z.object({ contract: z.string(), version: z.number().int().positive() }).strict())
      .default([]),
    attaches: z
      .array(z.object({ app: z.string(), range: z.string().optional() }).strict())
      .default([]),
    categories: z.array(z.string()).default([]),
    capabilities: z.array(z.string()).default([]),
    connect: z.object({ kind: z.enum(['none', 'api-key', 'oauth2']) }).strict(),
    network: z.object({ allow: z.array(z.string()).default([]) }).strict().default({ allow: [] }),
    name: localizedSchema,
    tagline: localizedSchema,
    /**
     * The minimum the release manifest declares; this server refuses a row
     * above its own version.
     *
     * v3's one new field, and the reason the feed moved address. An add-on's
     * host support lands in the ENGINE, not in the add-on: `add-on-invoices`
     * 1.0.2 needs the rail rows an installed add-on contributes, which is
     * engine code first released in 0.3.0. Without a floor in the feed a 0.2.9
     * server downloaded it, installed it, and failed at runtime — the worst of
     * the three available outcomes, because nothing in the failure named a
     * version.
     *
     * WHAT THIS FIELD CANNOT DO is correct a manifest. It carries what the
     * release DECLARES, and `add-on-invoices` 1.0.2 declares 0.2.12 while
     * needing 0.3.0, so a 0.2.12 server is still told yes. The floor is only
     * as good as the number the publisher put in it; this makes the number
     * mean something, it does not verify it.
     */
    minAdminiumVersion: z.string().regex(EXACT_VERSION_PATTERN),
    ...displayFields,
    /** A newer release than this one, which needs a newer Adminium. */
    newerRelease: z
      .object({ version: z.string().regex(EXACT_VERSION_PATTERN), minAdminiumVersion: z.string().regex(EXACT_VERSION_PATTERN) })
      .strict()
      .optional(),
  })
  .strict();

/**
 * An add-on the shelf lists and this server cannot download: `coming-soon`
 * has no release at all; `too-new` has only releases above this server
 * (the newest one named, so the page can say which Adminium it needs).
 */
export const unavailableEntrySchema = z
  .object({
    key: z.string().regex(ADD_ON_KEY_PATTERN),
    availability: z.enum(['coming-soon', 'too-new']),
    version: z.string().regex(EXACT_VERSION_PATTERN).nullable(),
    minAdminiumVersion: z.string().regex(EXACT_VERSION_PATTERN).nullable(),
    name: localizedSchema,
    tagline: localizedSchema,
    categories: z.array(z.string()).default([]),
    capabilities: z.array(z.string()).default([]),
    ...displayFields,
  })
  .strict();

/**
 * The catalog as this server keeps it: the API's shelf, projected
 * ({@link addOnCatalogFromShelf}) and cached. `format` names the wire format
 * it was read from, so a cache from 0.3.5 or earlier (a `schemaVersion` feed)
 * reads as no catalog and the page asks for a refresh.
 */
export const catalogSchema = z
  .object({
    format: z.literal(MARKETPLACE_FORMAT),
    generatedAt: z.string().min(1),
    addOns: z.array(catalogEntrySchema),
    unavailable: z.array(unavailableEntrySchema).default([]),
    /** Items this server could not read (a release in a form it does not know), for the refresh's audit row. */
    skipped: z.array(z.object({ key: z.string().nullable(), reason: z.string() }).strict()).default([]),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type UnavailableEntry = z.infer<typeof unavailableEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** The display facts every catalog row may carry, off the API item. */
export interface DisplayFacts {
  author?: string | undefined;
  iconTint?: string | undefined;
  iconPaths?: string[] | undefined;
  monogram?: string | undefined;
  lastUpdatedAt?: string | undefined;
}

/** An item's display facts, flattened onto a row. */
export function displayFactsOf(item: {
  author: { name: string };
  art: { tint?: string | undefined; iconPaths?: string[] | undefined; monogram?: string | undefined };
  lastUpdatedAt: string;
}): DisplayFacts {
  return {
    ...(item.author.name === '' ? {} : { author: item.author.name }),
    ...(item.art.tint === undefined ? {} : { iconTint: item.art.tint }),
    ...(item.art.iconPaths === undefined ? {} : { iconPaths: item.art.iconPaths }),
    ...(item.art.monogram === undefined ? {} : { monogram: item.art.monogram }),
    lastUpdatedAt: item.lastUpdatedAt,
  };
}

/**
 * The add-on shelf as this server keeps it. An item offering a release is a
 * catalog row in the shape the store and the routes have always read; one
 * listed as coming soon, or offering only releases above this server, is
 * `unavailable`; one with neither (no release of any kind) is not listed.
 */
export function addOnCatalogFromShelf(shelf: ParsedShelf<AddOnItemWire>): Catalog {
  const addOns: CatalogEntry[] = [];
  const unavailable: UnavailableEntry[] = [];
  for (const item of shelf.items) {
    const display = displayFactsOf(item);
    const listed = { key: item.key, name: item.name, tagline: item.tagline, capabilities: item.capabilities, ...display };
    if (item.availability === 'coming-soon') {
      unavailable.push({ ...listed, availability: 'coming-soon', version: null, minAdminiumVersion: null, categories: [] });
      continue;
    }
    const release = item.release;
    if (release !== null) {
      addOns.push({
        ...listed,
        version: release.version,
        integrity: release.integrity,
        provides: release.provides,
        attaches: release.attaches,
        categories: release.categories,
        capabilities: release.capabilities,
        connect: release.connect,
        network: release.network,
        minAdminiumVersion: release.minAdminiumVersion,
        ...(item.newerRelease === undefined ? {} : { newerRelease: item.newerRelease }),
      });
      continue;
    }
    if (item.newerRelease !== undefined) {
      unavailable.push({
        ...listed,
        availability: 'too-new',
        version: item.newerRelease.version,
        minAdminiumVersion: item.newerRelease.minAdminiumVersion,
        categories: [],
      });
    }
  }
  return { format: MARKETPLACE_FORMAT, generatedAt: shelf.generatedAt, addOns, unavailable, skipped: shelf.skipped };
}

/**
 * Why a listed item cannot be downloaded, or null when it is not listed as
 * unavailable: coming soon has nothing to download (`NOT_RELEASED`); a
 * too-new one needs a newer Adminium, the same refusal a too-new row always
 * got.
 */
export function unavailableRefusal(
  listed: { key: string; availability: 'coming-soon' | 'too-new'; version: string | null; minAdminiumVersion: string | null } | undefined,
): AddOnCatalogError | null {
  if (listed === undefined) return null;
  if (listed.availability === 'coming-soon') {
    return new AddOnCatalogError('NOT_RELEASED', `"${listed.key}" is coming soon; there is no release to download yet`);
  }
  return new AddOnCatalogError(
    'REQUIRES_NEWER_ADMINIUM',
    `"${listed.key}" ${listed.version ?? ''} needs Adminium ${listed.minAdminiumVersion ?? 'newer than this one'} or later; this server is ${APP_VERSION}`,
  );
}

/**
 * Whether a cached document is in the format this server reads.
 *
 * The cache outlives an upgrade: a server that last refreshed on 0.3.5 or
 * earlier holds a v1, v2 or v3 feed. Callers treat any of them as NO catalog —
 * prompting a refresh — rather than as a malformed one, which is what a failed
 * parse alone would report; and a v2 row carries no `minAdminiumVersion`, so
 * reading one would mean either inventing a floor or reinstating the hole.
 */
export function isCurrentCatalogFormat(document: unknown): boolean {
  return (
    typeof document === 'object' &&
    document !== null &&
    (document as { format?: unknown }).format === MARKETPLACE_FORMAT &&
    Array.isArray((document as { addOns?: unknown }).addOns)
  );
}

/**
 * `compatibility.minAdminiumVersion` read out of a document that did NOT
 * validate, or null. Every block of a manifest is `.strict()`, so a release
 * using a field this server does not know yet fails the parse; reading its
 * floor first lets the refusal say "needs a newer Adminium" rather than
 * "unrecognized key".
 */
export function lenientMinimum(document: unknown): string | null {
  if (typeof document !== 'object' || document === null) return null;
  const compatibility = (document as { compatibility?: unknown }).compatibility;
  if (typeof compatibility !== 'object' || compatibility === null) return null;
  const minimum = (compatibility as { minAdminiumVersion?: unknown }).minAdminiumVersion;
  return typeof minimum === 'string' && /^\d+\.\d+\.\d+/.test(minimum) ? minimum : null;
}

/**
 * Whether this server meets a release's declared minimum — the one rule behind
 * every `REQUIRES_NEWER_ADMINIUM` refusal, for add-ons and for apps.
 *
 * IT LIVES HERE, in the module both catalog clients already share, rather than
 * in either one of them. `apps/catalog.ts` imports this file for its
 * transport, its grammars and its error type; the add-on side importing the
 * comparison back out of it would be a cycle, and a second copy of a
 * version comparison is how the two halves of a rule drift apart.
 *
 * `compareSemver` reads the numeric triple and ignores any prerelease tail, so
 * a `0.3.0-rc.0` server meets a `0.3.0` floor. That is deliberate: an rc is
 * built from the release it is a candidate for and carries the same host
 * support, and treating it as older would block every add-on release against
 * the very builds that exist to test them.
 *
 * `current` is a parameter for tests; production always asks about the
 * running version.
 */
export function meetsMinimum(minimum: string, current: string = APP_VERSION): boolean {
  return compareSemver(current, minimum) >= 0;
}

/**
 * The one address a release of `key` at exactly `version` is downloaded
 * from: `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`.
 *
 * Built, then CHECKED: the grammars rule out every character that could move the
 * address, and the parsed URL must still carry exactly the path that was built
 * and the base's origin. A version's pre-release tail may hold `.` or `+`; the
 * check is what proves neither changes where the request goes. Pure — no I/O.
 */
export function downloadUrlFor(
  key: string,
  version: string,
  base = `https://${DOWNLOAD_HOST}`,
  /** `apps` for an app release; add-ons are the default and every existing
   * caller. */
  folder: 'add-ons' | 'apps' = 'add-ons',
): string {
  if (!ADD_ON_KEY_PATTERN.test(key) || !EXACT_VERSION_PATTERN.test(version)) {
    throw new AddOnCatalogError(
      'DOWNLOAD_ADDRESS_MISMATCH',
      `refusing to build a download address from ${JSON.stringify(key)}@${JSON.stringify(version)}`,
    );
  }
  const path = `/${folder}/${key}/${key}-${version}.tgz`;
  const origin = new URL(base).origin;
  const url = new URL(path, origin);
  if (url.pathname !== path || url.origin !== origin) {
    throw new AddOnCatalogError(
      'DOWNLOAD_ADDRESS_MISMATCH',
      `the download address for ${key}@${version} resolved to ${url.href}, not ${origin}${path}`,
    );
  }
  return url.href;
}

/**
 * Every outbound request the catalog clients make, add-ons and apps alike
 * (b G8-D4), with the three transport properties the exact-hostname
 * ruling actually requires.
 *
 * `redirect: 'manual'` IS THE LOAD-BEARING ONE. `fetch` follows redirects by
 * default, and the address is fixed *before* the request — so with the
 * default, a host answering `302 Location: https://evil.example/x.tgz` would
 * be followed silently and the "exactly two hostnames" guarantee would hold
 * only on paper. A redirect is therefore a typed REFUSAL rather than
 * something to re-check and follow: both hosts are first-party, neither has
 * any business bouncing us, and "refuse and say where it tried to send us"
 * is a far better failure than a redirect-following loop with a host
 * check in it.
 */
export async function boundedRequest(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  accept: string,
  maxBytes: number,
  what: CatalogRefusal,
  signal?: AbortSignal,
  notFound?: CatalogRefusal,
): Promise<{ bytes: Uint8Array; response: Response }> {
  // The caller's cancellation composed with our own budget. A job that is
  // cancelled mid-download must actually stop the request: checking
  // `ctx.signal.aborted` BETWEEN steps cannot interrupt an await already in
  // flight, so without this a cancelled download held a socket and kept
  // filling memory until the 30s timeout fired.
  const budget = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const composed = signal === undefined ? budget : AbortSignal.any([signal, budget]);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept, 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal: composed,
    });
  } catch (err) {
    throw new AddOnCatalogError(what, `request to ${url} failed: ${String(err)}`);
  }

  // `redirect: 'manual'` surfaces a 3xx as an ordinary response (an opaque
  // one in some runtimes, where `status` reads 0) rather than following it.
  if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
    throw new AddOnCatalogError(
      'REDIRECTED',
      `${url} answered with a redirect to ${response.headers.get('location') ?? '<opaque>'}; ` +
        'the download channel does not follow redirects',
    );
  }
  if (response.status === 404 && notFound !== undefined) {
    throw new AddOnCatalogError(notFound, `${url} responded 404`);
  }
  if (!response.ok) {
    throw new AddOnCatalogError(what, `${url} responded ${response.status}`);
  }

  // A declared over-cap length is refused before a byte is read; a body that
  // lies about its length is caught by the streaming cap below.
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AddOnCatalogError(
      'RESPONSE_TOO_LARGE',
      `${url} declares ${declared} bytes, over the ${maxBytes}-byte limit`,
    );
  }

  const body = response.body;
  if (body === null) {
    // No stream to meter (an empty body, or a stubbed Response in a test):
    // fall back to the buffered read, still bounded by the check above.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new AddOnCatalogError(
        'RESPONSE_TOO_LARGE',
        `${url} returned ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit`,
      );
    }
    return { bytes, response };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancel rather than drain: the point is to stop receiving.
        await reader.cancel();
        throw new AddOnCatalogError(
          'RESPONSE_TOO_LARGE',
          `${url} sent more than the ${maxBytes}-byte limit`,
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof AddOnCatalogError) throw err;
    throw new AddOnCatalogError(what, `reading ${url} failed: ${String(err)}`);
  }

  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes, response };
}

export interface CatalogClientDeps {
  meta: MetaDb;
  /**
   * `ADMINIUM_NETWORK_FEATURES`. When off, this client refuses before any URL
   * is built — the same posture the flag already documents for webhooks, OAuth
   * and provider-AI offers.
   */
  networkFeatures: boolean;
  endpoint?: string | undefined;
  /** Tests only; production always downloads from {@link DOWNLOAD_HOST}. */
  downloadBase?: string | undefined;
  /** Injected so tests can observe calls; defaults to the global fetch. */
  fetchImpl?: typeof globalThis.fetch | undefined;
}

export interface CatalogClient {
  /** The single gate: network features AND the opt-in toggle. No network. */
  isEnabled(): Promise<boolean>;
  /**
   * Whether the ENVIRONMENT permits online browsing at all, ignoring the
   * stored setting. Pure; no I/O.
   *
   * `isEnabled()` folds the two together, which is right for every caller that
   * only wants to know whether to proceed. The settings ROUTE needs them apart:
   * `ADMINIUM_NETWORK_FEATURES=off` and desktop air-gap mode veto the toggle
   * (O1), so an operator can switch it on and have it stay off — and a toggle
   * that springs back with no explanation is worse than one that is absent.
   */
  networkFeaturesAllowed(): boolean;
  /**
   * Fetch + validate the feed. Refuses without touching the network if off.
   *
   * `signal` is the CALLER's cancellation (a job's `ctx.signal`), composed with
   * this module's own request timeout. Without it a cancelled job would keep an
   * in-flight request alive until the timeout expired — `signal.aborted` checks
   * between steps cannot interrupt an await that is already running.
   */
  fetchCatalog(signal?: AbortSignal): Promise<Catalog>;
  /**
   * Download one catalog row's file from the address {@link downloadUrlFor}
   * builds. The hash is verified by the STORE against `entry.integrity`, not
   * here — this returns bytes, never a verdict on them.
   */
  fetchTarball(entry: Pick<CatalogEntry, 'key' | 'version'>, signal?: AbortSignal): Promise<Uint8Array>;
}

export function createCatalogClient(deps: CatalogClientDeps): CatalogClient {
  const endpoint = deps.endpoint ?? CATALOG_ENDPOINT;
  const downloadBase = deps.downloadBase ?? `https://${DOWNLOAD_HOST}`;
  const settings = settingsRepo(deps.meta);

  async function isEnabled(): Promise<boolean> {
    if (!deps.networkFeatures) return false;
    return (await settings.get(CATALOG_ENABLED_SETTING)) === true;
  }

  /** Refuse BEFORE any URL exists. Order matters; the isolation test pins it. */
  async function assertEnabled(): Promise<void> {
    if (!deps.networkFeatures) {
      throw new AddOnCatalogError(
        'NETWORK_FEATURES_OFF',
        'ADMINIUM_NETWORK_FEATURES is off; the add-on catalog makes no outbound calls',
      );
    }
    if ((await settings.get(CATALOG_ENABLED_SETTING)) !== true) {
      throw new AddOnCatalogError(
        'CATALOG_DISABLED',
        'the online add-on catalog is off; the bundled set is available without it',
      );
    }
  }

  const doFetch = (): typeof globalThis.fetch => deps.fetchImpl ?? globalThis.fetch;

  const request = (
    url: string,
    accept: string,
    maxBytes: number,
    what: CatalogRefusal,
    signal?: AbortSignal,
    notFound?: CatalogRefusal,
  ): Promise<{ bytes: Uint8Array; response: Response }> =>
    boundedRequest(doFetch(), url, accept, maxBytes, what, signal, notFound);

  return {
    isEnabled,
    networkFeaturesAllowed: () => deps.networkFeatures,

    async fetchCatalog(signal) {
      await assertEnabled();

      const { bytes } = await request(
        shelfUrl(endpoint),
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

      // Item by item: a release in a form this server does not know refuses
      // that item — which is how "no price reaches an install" holds by
      // construction — and the rest of the shelf is still offered.
      const shelf = parseShelf(addOnItemWireSchema, body);
      if (shelf === null) {
        throw new AddOnCatalogError('CATALOG_MALFORMED', `${endpoint} did not answer in ${MARKETPLACE_FORMAT}`);
      }
      return addOnCatalogFromShelf(shelf);
    },

    async fetchTarball(entry, signal) {
      await assertEnabled();
      // D9: the EXACT version the row names. `latest` is never consulted, and
      // there is no index on the download host to consult it in.
      const url = downloadUrlFor(entry.key, entry.version, downloadBase);

      const { bytes } = await request(
        url,
        'application/octet-stream',
        MAX_TARBALL_BYTES,
        'TARBALL_UNREACHABLE',
        signal,
        // The catalog offers a version the download host does not have. Named
        // on its own: it is a publishing fault, not a network one.
        'TARBALL_NOT_FOUND',
      );
      return bytes;
    },
  };
}
