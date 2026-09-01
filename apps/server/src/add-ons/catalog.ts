// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on catalog client (32-add-on-distribution.md §4.2, D2/D7/D8/D9).
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
 * index; `registry.npmjs.org` serves the packument and the tarball. Both are
 * module constants. The tarball URL is the one address that arrives as REMOTE
 * DATA (out of the packument), so its hostname is compared for exact equality
 * against {@link REGISTRY_HOST} before it is fetched.
 *
 * WHY THE D14 HOSTNAME *GRAMMAR* IS NOT IMPORTED HERE. That regex
 * (`add-on-contracts/src/add-on-block.ts`) exists to bound hostnames an add-on
 * DECLARES — attacker-controlled strings that must merely look like hostnames.
 * Here every destination is either a compile-time constant or checked with
 * `===` against one, which is strictly stronger than any grammar: a grammar
 * accepts an infinite set, equality accepts one. (`add-on-contracts` is also
 * not a dependency of this app today, and the regex is module-local rather than
 * exported, so importing it would mean widening both.)
 *
 * NPM IS AN INSTALL-TIME DEPENDENCY ONLY (D2). Nothing here is reached at boot
 * or at serve time; a registry outage cannot affect a running deployment, and
 * an air-gapped one never calls this module at all.
 *
 * THE DISCLOSURE, STATED. An online install tells npm this deployment's IP, the
 * time, and the exact `package@version` pulled. That is why the toggle is
 * default-off and why the docs page says so rather than leaving it to be
 * discovered.
 */

import { settingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

/** The static feed the website emits (D6). Never serves tarballs. */
export const CATALOG_ENDPOINT = 'https://adminium.dev/marketplace/catalog.json';

/** The only registry host this client will talk to (D2). */
export const REGISTRY_HOST = 'registry.npmjs.org';

/** The settings-registry key behind D8's default-off browse-online toggle. */
export const CATALOG_ENABLED_SETTING = 'addOns.catalogEnabled';

/** Refusals that are the operator's to see, typed so routes can map them. */
export type CatalogRefusal =
  | 'CATALOG_DISABLED'
  | 'NETWORK_FEATURES_OFF'
  | 'CATALOG_UNREACHABLE'
  | 'CATALOG_MALFORMED'
  | 'PACKUMENT_UNREACHABLE'
  | 'VERSION_NOT_PUBLISHED'
  | 'LEDGER_MISMATCH'
  | 'FOREIGN_TARBALL_HOST'
  | 'REDIRECTED'
  | 'RESPONSE_TOO_LARGE'
  | 'TARBALL_UNREACHABLE'
  | 'UNKNOWN_ADD_ON';

/**
 * Response caps and a wall-clock budget.
 *
 * The archive limits in `archive.ts` bound what is UNPACKED; they can do nothing
 * about a response body, because by the time they see it the bytes are already
 * in memory. So the transport caps the read itself, streaming and aborting —
 * otherwise `registry.npmjs.org` answering with an endless body is an OOM that
 * no amount of unpack hardening prevents.
 */
export const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
export const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
export const MAX_PACKUMENT_BYTES = 8 * 1024 * 1024;
/** Per-request budget: a host that accepts a connection and never answers. */
export const REQUEST_TIMEOUT_MS = 30_000;

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

/** The one npm scope this deployment will pull an add-on from (D1/D2). */
export const NPM_SCOPE = '@adminiumjs';

export const catalogEntrySchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
    /**
     * `@adminiumjs/add-on-<key>` (D1) — and checked against the key by the
     * refinement below, not merely documented.
     *
     * WHY THIS IS A SECURITY CHECK AND NOT TIDINESS. `pinRelease` builds the
     * packument URL from this field, so whoever writes the feed chooses which
     * npm package a download actually fetches. The D7 cross-check does NOT
     * cover it: an attacker who can serve the feed supplies BOTH the package
     * name and the `integrity` it is compared against, so naming
     * `evil-package` with `evil-package`'s real hash passes the ledger leg
     * intact. Constraining the name to the one value D1 says it must have is
     * free and closes that entirely — the feed can no longer point a key at a
     * package the key does not name.
     */
    npmPackage: z.string().min(1).max(214),
    /** EXACT — never a range, never `latest` (D9). */
    version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)*$/),
    /** The release ledger's value, `sha512-<base64>` (D7 leg 2). */
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
  .strict()
  .refine((entry) => entry.npmPackage === `${NPM_SCOPE}/add-on-${entry.key}`, {
    path: ['npmPackage'],
    message: `npmPackage must be exactly ${NPM_SCOPE}/add-on-<key>`,
  });

export const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    addOns: z.array(catalogEntrySchema),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** What a download needs after the two-leg trust check has passed. */
export interface PinnedRelease {
  key: string;
  npmPackage: string;
  version: string;
  /** Agreed by BOTH the packument and the ledger (D7 legs 1 + 2). */
  integrity: string;
  tarballUrl: string;
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
  registryBase?: string | undefined;
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
   * D7 legs 1 + 2 for one entry: pin `dist.integrity` from the packument, then
   * cross-check it against the ledger value the catalog carries. A disagreement
   * refuses — it means the registry is serving bytes the publish pipeline did
   * not record.
   */
  pinRelease(entry: CatalogEntry, signal?: AbortSignal): Promise<PinnedRelease>;
  /** Download the pinned tarball. The hash is verified by the STORE, not here. */
  fetchTarball(pinned: PinnedRelease, signal?: AbortSignal): Promise<Uint8Array>;
}

/** The packument fields this client reads. Everything else is ignored. */
const packumentSchema = z.object({
  versions: z.record(
    z.string(),
    z.object({
      dist: z.object({
        tarball: z.string().url(),
        integrity: z.string().optional(),
        shasum: z.string().optional(),
      }),
    }),
  ),
});

export function createCatalogClient(deps: CatalogClientDeps): CatalogClient {
  const endpoint = deps.endpoint ?? CATALOG_ENDPOINT;
  const registryBase = deps.registryBase ?? `https://${REGISTRY_HOST}`;
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

  /** Exact-host equality (D14), applied to the one URL that is remote data. */
  function assertRegistryHost(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AddOnCatalogError('FOREIGN_TARBALL_HOST', `tarball URL is unparseable: ${url}`);
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== REGISTRY_HOST) {
      throw new AddOnCatalogError(
        'FOREIGN_TARBALL_HOST',
        `tarball URL points at ${parsed.protocol}//${parsed.hostname}, not https://${REGISTRY_HOST}`,
      );
    }
  }

  const doFetch = (): typeof globalThis.fetch => deps.fetchImpl ?? globalThis.fetch;

  /**
   * Every outbound request this module makes, with the three transport
   * properties the exact-hostname ruling actually requires.
   *
   * `redirect: 'manual'` IS THE LOAD-BEARING ONE. `fetch` follows redirects by
   * default, and the host check necessarily runs on the URL *before* the
   * request — so with the default, `registry.npmjs.org` answering `302 Location:
   * https://evil.example/x.tgz` would be followed silently and the "exactly two
   * hostnames" guarantee (24 D14) would hold only on paper. A redirect is
   * therefore a typed REFUSAL rather than something to re-check and follow:
   * both endpoints are first-party or first-party-pinned, neither has any
   * business bouncing us, and "refuse and say where it tried to send us" is a
   * far better failure than a redirect-following loop with a host check in it.
   */
  async function request(
    url: string,
    accept: string,
    maxBytes: number,
    what: CatalogRefusal,
    signal?: AbortSignal,
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
        headers: { accept },
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

  /** Reads a capped JSON body. */
  async function requestJson(
    url: string,
    accept: string,
    maxBytes: number,
    what: CatalogRefusal,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { bytes } = await request(url, accept, maxBytes, what, signal);
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch (err) {
      throw new AddOnCatalogError(what, `${url} did not return JSON: ${String(err)}`);
    }
  }

  return {
    isEnabled,
    networkFeaturesAllowed: () => deps.networkFeatures,

    async fetchCatalog(signal) {
      await assertEnabled();

      const body = await requestJson(
        endpoint,
        'application/json',
        MAX_CATALOG_BYTES,
        'CATALOG_UNREACHABLE',
        signal,
      );

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

    async pinRelease(entry, signal) {
      await assertEnabled();

      const url = `${registryBase}/${entry.npmPackage.replace('/', '%2f')}`;
      const body = await requestJson(
        url,
        // The abbreviated packument: smaller, and it carries `dist`.
        'application/vnd.npm.install-v1+json',
        MAX_PACKUMENT_BYTES,
        'PACKUMENT_UNREACHABLE',
        signal,
      );

      const packument = packumentSchema.safeParse(body);
      if (!packument.success) {
        throw new AddOnCatalogError(
          'PACKUMENT_UNREACHABLE',
          `packument for ${entry.npmPackage} is not readable`,
        );
      }

      // D9: the EXACT version, never a dist-tag. `latest` is never consulted.
      const published = packument.data.versions[entry.version];
      if (published === undefined) {
        throw new AddOnCatalogError(
          'VERSION_NOT_PUBLISHED',
          `${entry.npmPackage}@${entry.version} is not published`,
        );
      }
      const fromPackument = published.dist.integrity;
      if (fromPackument === undefined) {
        throw new AddOnCatalogError(
          'VERSION_NOT_PUBLISHED',
          `${entry.npmPackage}@${entry.version} has no dist.integrity`,
        );
      }

      // D7: the two legs must agree. They share an origin only at publish time,
      // so a disagreement means one of them was tampered with at rest.
      if (fromPackument !== entry.integrity) {
        throw new AddOnCatalogError(
          'LEDGER_MISMATCH',
          `registry reports ${fromPackument} for ${entry.npmPackage}@${entry.version}, ` +
            `the release ledger records ${entry.integrity}`,
        );
      }

      assertRegistryHost(published.dist.tarball);

      return {
        key: entry.key,
        npmPackage: entry.npmPackage,
        version: entry.version,
        integrity: fromPackument,
        tarballUrl: published.dist.tarball,
      };
    },

    async fetchTarball(pinned, signal) {
      await assertEnabled();
      // Re-checked here rather than trusted from `pinRelease`: this is the call
      // that actually opens a socket, so it carries its own host check.
      assertRegistryHost(pinned.tarballUrl);

      const { bytes } = await request(
        pinned.tarballUrl,
        'application/octet-stream',
        MAX_TARBALL_BYTES,
        'TARBALL_UNREACHABLE',
        signal,
      );
      return bytes;
    },
  };
}
