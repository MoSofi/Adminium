// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire DTOs for `/api/v1/add-ons` (26-add-on-runtime.md §5.1, 26-T06).
 *
 * Every `/api/` route in this server must carry a zod `schema` or registration
 * throws at boot (`app.ts`), so these are load-bearing rather than
 * documentation. They are also the OpenAPI source, which is generated from the
 * built output — see the route module's header for the regeneration order.
 *
 * THE SECRET RULE IS ENFORCED BY THE REPLY SHAPE (24 D15). None of the DTOs
 * below carries a `settings` value, a credential, or anything derived from one.
 * `connected` is a boolean and `expiresAt` a number, both readable from
 * `credentialStatus()` without decrypting a thing.
 */

import { z } from 'zod';

/** The manifest key grammar, restated for the wire (`@adminium/manifest`). */
const addOnKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);

/** A host app's `manifest_key` — what an add-on attaches TO (24 §5.7). */
const hostKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);

export const addOnKeyParams = z.object({ key: addOnKey });

/**
 * A bundle request. `file` is the manifest-relative path of a shipped asset —
 * matched against the paths the manifest DECLARES rather than accepted as a
 * path, so the route cannot be used to read an arbitrary file out of a package
 * even before the store's own containment check sees it.
 */
export const addOnBundleParams = z.object({
  key: addOnKey,
  /**
   * Fastify's wildcard param, carrying the nested path (`dist/client.js`).
   *
   * It has to be NAMED in this schema: zod strips unknown keys, so a params
   * schema that listed only `key` would hand the handler an object with the
   * wildcard removed — and the route would 404 on every real request while
   * every other test still passed.
   */
  '*': z.string().min(1).max(200),
});

/** One host this add-on is mounted on, and whether it is on there. */
export const addOnAttachmentDto = z.object({
  attachedTo: hostKey,
  enabled: z.boolean(),
});

/**
 * One installed add-on.
 *
 * `slots` and `provides` are lifted out of the stored manifest so a host does
 * not have to parse the whole document to know what to mount — this is the
 * reply `AddOnHost` reads in connected mode (§6).
 */
export const addOnDto = z.object({
  key: addOnKey,
  name: z.string(),
  version: z.string(),
  /** `none` | `api-key` | `oauth2` — what connecting this add-on requires. */
  connectKind: z.enum(['none', 'api-key', 'oauth2']),
  /** Whether a credential is stored. Never the credential itself (24 D15). */
  connected: z.boolean(),
  /** Epoch ms; null for a credential that does not expire, or none at all. */
  connectionExpiresAt: z.number().nullable(),
  attachments: z.array(addOnAttachmentDto),
  slots: z.array(z.object({ slot: z.string(), client: z.string(), order: z.number() })),
  provides: z.array(z.object({ contract: z.string(), version: z.number() })),
  /** Exact-hostname egress the manifest declares (24 D14). */
  networkAllow: z.array(z.string()),
  /**
   * Every client bundle this add-on ships, with the URL to fetch it from and
   * the SRI value to pin it to (26 §5.4).
   *
   * The URL is SERVED here rather than assembled by the host: the host reads
   * this list and uses what it is given, so the asset path is not a contract it
   * hardcodes and can move without breaking every host at once.
   *
   * `integrity` is derived from the sha256 the store recorded when the package
   * was unpacked — the same hash the serve path re-checks the bytes against, so
   * what a host pins and what the server refuses to serve cannot disagree.
   */
  bundles: z.array(
    z.object({
      path: z.string(),
      url: z.string(),
      integrity: z.string().regex(/^sha256-[A-Za-z0-9+/]+={0,2}$/),
    }),
  ),
});

export const addOnListReply = z.object({ addOns: z.array(addOnDto) });

/** What installing WOULD do — the consent dialog's document (§7). */
export const installPlanDto = z.object({
  addOnKey,
  version: z.string(),
  installable: z.boolean(),
  touchesData: z.boolean(),
  create: z.array(
    z.object({
      ref: z.string(),
      columns: z.array(z.object({ ref: z.string(), type: z.string() })),
    }),
  ),
  reuse: z.array(z.object({ ref: z.string(), missingColumns: z.array(z.string()) })),
  references: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      to: z.string(),
      resolution: z.enum(['internal', 'host', 'unresolved']),
    }),
  ),
  problems: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      table: z.string(),
      column: z.string().optional(),
    }),
  ),
  /**
   * True when applying this plan needs DDL on the data source.
   *
   * Surfaced separately from `installable` because it is what the consent
   * dialog needs in order to say "this will create tables in your database"
   * BEFORE anyone agrees to it — which is a different question from whether the
   * install can proceed at all.
   */
  requiresSchemaChange: z.boolean(),
});

export const installPlanReply = z.object({ plan: installPlanDto });

/**
 * Install takes a STAGED-PACKAGE REFERENCE, never a manifest body
 * (32-add-on-distribution.md §4.3's amended seam).
 *
 * The bytes must already be on local disk in the add-on store, verified
 * against the hash the packument and the release ledger agreed on. A route that
 * accepted a manifest document would be a route that installs code nobody
 * checked — and 24 D13 runs an add-on's server half in this process.
 */
export const installAddOnBody = z.object({
  key: addOnKey,
  version: z.string().min(1).max(64),
  /** Host app keys to attach on install; each must be in the manifest's `attaches`. */
  attachTo: z.array(hostKey).default([]),
});

export const installAddOnReply = z.object({
  addOn: addOnDto,
  plan: installPlanDto,
});

/** Enable or disable on one host (§5.1's PATCH). */
export const patchAddOnBody = z.object({
  attachedTo: hostKey,
  enabled: z.boolean(),
});

export const patchAddOnReply = z.object({ addOn: addOnDto });

export const uninstallAddOnReply = z.object({
  key: addOnKey,
  /**
   * Stated back to the caller because it is the promise the confirm dialog
   * made (24 D16 / 26 D5), and a reply that merely said `ok` would leave the
   * UI asserting it on its own.
   */
  tablesKept: z.boolean(),
  packageRemoved: z.boolean(),
});

/**
 * Connect (§5.1, D2). One route shape for all three kinds; this wave serves
 * `api-key` (T07) and refuses `oauth2` as not-yet (T08).
 *
 * `credentials` is a flat map of the add-on's OWN `secret: true` setting keys to
 * their values — `{ api_key: "…", account_number: "…" }` for shipping-dhl. Keys
 * are validated against the manifest, so an unrecognised one is refused rather
 * than stored: a credential store that accepts whatever it is sent is a
 * credential store nobody can audit.
 *
 * There is no reply DTO carrying any of it back. The only readable facts about a
 * connection are `connected`, `connectionExpiresAt` and the granted scopes — all
 * on `addOnDto`, all derivable without decrypting anything (24 D15).
 */
export const connectAddOnBody = z.object({
  credentials: z.record(
    z.string().regex(/^[a-z][a-z0-9_]*$/),
    z.string().min(1).max(4096),
  ),
});

export const connectAddOnReply = z.object({ addOn: addOnDto });

export const disconnectAddOnReply = z.object({
  key: addOnKey,
  /**
   * Said back for the same reason uninstall says it (24 D16 / 26 D5): the
   * confirm dialog promised it, and a reply that only said `ok` would leave the
   * UI asserting the promise on its own.
   */
  credentialsDeleted: z.boolean(),
  tablesKept: z.boolean(),
});

// ─── Acquisition (32-add-on-distribution.md §4.3) ───────────────────────────

/**
 * One row of the browse surface: an add-on this deployment could install.
 *
 * `source` says where the bytes would come from, and it is the field that makes
 * the page honest on an air-gapped install — `bundled` needs no network at all,
 * `catalog` needs the online toggle. `state` says whether anything has to be
 * downloaded first.
 */
export const catalogEntryDto = z.object({
  key: addOnKey,
  name: z.string(),
  version: z.string(),
  source: z.enum(['bundled', 'catalog']),
  /**
   * `installed` — already running here.
   * `staged` — bytes verified and on disk, nothing installed yet.
   * `available` — would have to be downloaded.
   */
  state: z.enum(['installed', 'staged', 'available']),
  /** Set when an installed add-on has a NEWER version staged or offered. */
  upgradeTo: z.string().nullable(),
});

export const catalogBrowseReply = z.object({
  addOns: z.array(catalogEntryDto),
  /**
   * When the online catalog was last fetched, or null on a deployment that has
   * never browsed online — which is the air-gapped steady state, not an error.
   */
  catalogFetchedAt: z.number().nullable(),
  /** Whether browsing online is switched on at all (D8). */
  onlineEnabled: z.boolean(),
});

export const refreshCatalogReply = z.object({ jobId: z.string() });

/**
 * The online-catalog switch (32 §4.4, D8, O1).
 *
 * A settings-registry boolean (`addOns.catalogEnabled`) with a route of its
 * own rather than a row in `/settings/*`, and the reason is 26 D3: those routes
 * are gated on `settings.manage`, and the whole point of un-reserving
 * `manifests.manage` was that installing an add-on is not the same authority as
 * changing a workspace setting. A switch that decides whether this deployment
 * talks to a registry belongs with the add-on routes and their permission.
 */
export const catalogSettingsBody = z.object({ enabled: z.boolean() });

export const catalogSettingsReply = z.object({
  /**
   * What the switch is now — which is NOT always what was asked for.
   *
   * `ADMINIUM_NETWORK_FEATURES=off` and desktop air-gap mode veto the setting
   * outright (O1), so an operator can turn this on and have it stay off. The
   * reply says the effective state so the page can show that rather than a
   * toggle that springs back with no explanation.
   */
  onlineEnabled: z.boolean(),
  /** True when an environment veto is overriding the stored setting. */
  vetoed: z.boolean(),
});

export const downloadAddOnBody = z.object({
  key: addOnKey,
  version: z.string().min(1).max(64),
});

export const downloadAddOnReply = z.object({ jobId: z.string() });

/**
 * The sideload upload's query (D4).
 *
 * The TARBALL is the raw request body — this server has no `@fastify/multipart`
 * and its established idiom for a binary upload is a scoped content-type parser
 * plus a route-scoped `bodyLimit` (`routes/imports`). So the two scalars that
 * would have been the other multipart parts travel as query parameters instead.
 *
 * `expectedSha512` is the operator's, and D4 is honest about what that is worth:
 * for a tarball of unknown origin it is self-referential, and the hardened
 * unpack is the only defence left — which is exactly why the unpack is
 * unconditional rather than trusted-source-skippable.
 */
export const uploadAddOnQuery = z.object({
  key: addOnKey,
  version: z.string().min(1).max(64),
  expectedSha512: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

export const stagedPackageReply = z.object({
  key: addOnKey,
  version: z.string(),
  /** How many files the verified tree holds — the receipt for an unpack. */
  files: z.number(),
  integrity: z.string(),
});

export const stagedParams = z.object({
  key: addOnKey,
  version: z.string().min(1).max(64),
});

export const discardStagedReply = z.object({
  key: addOnKey,
  version: z.string(),
  discarded: z.boolean(),
});

export const upgradeAddOnReply = z.object({
  addOn: addOnDto,
  from: z.string(),
  to: z.string(),
  /** Older version directories removed once the upgrade verified (D11). */
  pruned: z.array(z.string()),
});

/**
 * Start an OAuth connect (26-T08).
 *
 * The client id and secret are the OPERATOR's — they come from registering an
 * application with the third party, so they are per-deployment and cannot ship
 * in a manifest. Adminium holds them; the add-on never receives the secret
 * (acceptance #2).
 */
export const startOAuthBody = z.object({
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(4096),
  /** Where the provider sends the browser back. Echoed into the exchange. */
  redirectUri: z.string().url().max(2048),
});

export const startOAuthReply = z.object({
  /** Send the browser here. Carries the PKCE challenge, never the verifier. */
  authorizeUrl: z.string(),
  state: z.string(),
});

/**
 * Complete an OAuth connect.
 *
 * A POST rather than a GET callback on purpose: the provider redirects the
 * browser to a dashboard page, which reads the query and posts it here. That
 * keeps the side-effecting route a POST — so it carries CSRF protection, the
 * audit marker and rate limiting — instead of a GET that mutates, which this
 * server's route ratchets would not even see.
 */
export const completeOAuthBody = z.object({
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096),
});

export type AddOnDto = z.infer<typeof addOnDto>;
export type InstallPlanDto = z.infer<typeof installPlanDto>;
