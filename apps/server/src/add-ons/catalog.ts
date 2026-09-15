// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on catalog client (32-add-on-distribution.md §4.2, D8/D9;
 * 48-self-hosted-downloads.md D3/D4/D7).
 *
 * Built on the telemetry client's precedent (`../telemetry/service.ts`): a
 * hardcoded first-party endpoint constant, an injectable `fetchImpl` so tests
 * can observe every call, and — the load-bearing part — THE OFF-SWITCH IS
 * CHECKED FIRST, before a payload is built or a URL is constructed. There is no
 * code path from a disabled client to `fetch`, which is what lets
 * `add-on-network-isolation.test.ts` prove D8's claim with a recording thrower
 * rather than by trusting a caught error.
 *
 * TWO HOSTNAMES, EXACTLY (24 D14). `adminium.dev` serves the few-KB catalog
 * index; `downloads.adminium.dev` serves the files. Both are module constants,
 * and so is every address this client requests: a download URL is BUILT HERE
 * from a catalog row's key and exact version (48 D4), never read out of remote
 * data. The feed carries no URL and no package name, so there is nothing in it
 * that could point a download at another host or another file. (Its v1
 * predecessor named an npm package, and constraining that field to one value
 * was the only thing standing between whoever served the feed and a download of
 * any package they liked.)
 *
 * WHERE THE FINGERPRINT COMES FROM (48 D3). The catalog row's `integrity` — the
 * release ledger's value, carried by a feed the website builds from the ledger
 * at a pinned SHA. Never from the download host: a folder that supplied both the
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

import { settingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { APP_VERSION } from '../version.js';

/**
 * The static feed the website emits (48 D7). Never serves files.
 *
 * `v2` IS A NEW ADDRESS, NOT A NEW FIELD. Released servers (0.2.3–0.2.8) parse
 * `/marketplace/catalog.json` with a `.strict()` v1 schema, so any change to
 * that document breaks every one of them at once. They keep reading the frozen
 * v1 address; this version reads its own.
 */
export const CATALOG_ENDPOINT = 'https://adminium.dev/marketplace/v2/catalog.json';

/** The only host this client downloads a file from (48 D1/D4). */
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
  | 'UNKNOWN_ADD_ON';

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

/** Every request says what it is; bot protection judges a bare runtime harshly (48 §4). */
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
 * 17 §2 IS ENFORCED BY CONSTRUCTION, NOT BY OMISSION: the object is `.strict()`,
 * so a feed carrying `price`, `licenseKey`, `tier`, or an availability teaser is
 * REFUSED rather than quietly ignored. A deferred-monetization rule that only
 * held because nobody happened to send the field would not be a rule.
 */
const localizedSchema = z.record(z.string(), z.string());

/**
 * One string out of a feed-supplied localized record, for a product locale
 * (40-add-on-browsing.md D2).
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
 *  4. `en`, the one key 32 §3 requires every feed row to carry.
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
/** EXACT — never a range, never `latest` (D9). */
export const EXACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)*$/;

export const catalogEntrySchema = z
  .object({
    key: z.string().regex(ADD_ON_KEY_PATTERN),
    version: z.string().regex(EXACT_VERSION_PATTERN),
    /** The release ledger's value, `sha512-<base64>` (48 D3). */
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
  })
  .strict();

export const catalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    generatedAt: z.string().min(1),
    addOns: z.array(catalogEntrySchema),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/**
 * Whether a cached document is in the format this server reads.
 *
 * The cache outlives an upgrade: a server that last refreshed on 0.2.8 holds a
 * v1 feed. Callers treat that as NO catalog — prompting a refresh — rather than
 * as a malformed one, which is what a failed parse alone would report.
 */
export function isCurrentCatalogFormat(document: unknown): boolean {
  return (
    typeof document === 'object' &&
    document !== null &&
    (document as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

/**
 * The one address a release of `key` at exactly `version` is downloaded from
 * (48 D1/D4): `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`.
 *
 * Built, then CHECKED: the grammars rule out every character that could move the
 * address, and the parsed URL must still carry exactly the path that was built
 * and the base's origin. A version's pre-release tail may hold `.` or `+`; the
 * check is what proves neither changes where the request goes. Pure — no I/O.
 */
export function downloadUrlFor(key: string, version: string, base = `https://${DOWNLOAD_HOST}`): string {
  if (!ADD_ON_KEY_PATTERN.test(key) || !EXACT_VERSION_PATTERN.test(version)) {
    throw new AddOnCatalogError(
      'DOWNLOAD_ADDRESS_MISMATCH',
      `refusing to build a download address from ${JSON.stringify(key)}@${JSON.stringify(version)}`,
    );
  }
  const path = `/add-ons/${key}/${key}-${version}.tgz`;
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

  /**
   * Every outbound request this module makes, with the three transport
   * properties the exact-hostname ruling actually requires.
   *
   * `redirect: 'manual'` IS THE LOAD-BEARING ONE. `fetch` follows redirects by
   * default, and the address is fixed *before* the request — so with the
   * default, a host answering `302 Location: https://evil.example/x.tgz` would
   * be followed silently and the "exactly two hostnames" guarantee (24 D14)
   * would hold only on paper. A redirect is therefore a typed REFUSAL rather
   * than something to re-check and follow: both hosts are first-party, neither
   * has any business bouncing us, and "refuse and say where it tried to send
   * us" is a far better failure than a redirect-following loop with a host
   * check in it.
   */
  async function request(
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
      response = await doFetch()(url, {
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
          'the add-on channel does not follow redirects',
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

  return {
    isEnabled,
    networkFeaturesAllowed: () => deps.networkFeatures,

    async fetchCatalog(signal) {
      await assertEnabled();

      const { bytes } = await request(
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

      const parsed = catalogSchema.safeParse(body);
      if (!parsed.success) {
        // A field the schema does not know about is a REFUSAL, not a warning:
        // that is how 17 §2's "no price fields by construction" is enforced.
        throw new AddOnCatalogError(
          'CATALOG_MALFORMED',
          `catalog does not match the expected schema: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
      }
      return parsed.data;
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
        // on its own: it is a publishing fault, not a network one (48 §4).
        'TARBALL_NOT_FOUND',
      );
      return bytes;
    },
  };
}
