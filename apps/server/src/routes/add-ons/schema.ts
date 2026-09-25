// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire DTOs for `/api/v1/add-ons`.
 *
 * Every `/api/` route in this server must carry a zod `schema` or registration
 * throws at boot (`app.ts`), so these are load-bearing rather than
 * documentation. They are also the OpenAPI source, which is generated from the
 * built output — see the route module's header for the regeneration order.
 *
 * THE SECRET RULE IS ENFORCED BY THE REPLY SHAPE. None of the DTOs below
 * carries a `settings` value, a credential, or anything derived from one.
 * `connected` is a boolean and `expiresAt` a number, both readable from
 * `credentialStatus()` without decrypting a thing.
 */

import { z } from 'zod';

/** The manifest key grammar, restated for the wire (`@adminium/manifest`). */
const addOnKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);

/** A host app's `manifest_key` — what an add-on attaches TO. */
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

/** A feature of an app that works only with an add-on: its id and its label per language. */
export const featureNeedDto = z.object({ id: z.string(), label: z.record(z.string(), z.string()) });

/** One installed app's need of an add-on. */
export const appNeedDto = z.object({
  app: hostKey,
  appName: z.string(),
  /** `installed`, `disabled` or `installing` — a switched-off app still holds its need. */
  status: z.string(),
  /** `requires` (it cannot run without), `feature` (a feature stops), `suggests`. */
  need: z.enum(['requires', 'feature', 'suggests']),
  /** The add-on versions the app works with. */
  range: z.string().nullable(),
  features: z.array(featureNeedDto),
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
 * reply `AddOnHost` reads in connected mode.
 */
export const addOnDto = z.object({
  key: addOnKey,
  name: z.string(),
  version: z.string(),
  /** `none` | `api-key` | `oauth2` — what connecting this add-on requires. */
  connectKind: z.enum(['none', 'api-key', 'oauth2']),
  /** Whether a credential is stored. Never the credential itself. */
  connected: z.boolean(),
  /**
   * Installed according to the meta store, but its files are not on this
   * server, so none of it loads.
   *
   * This list used to be a pure meta read, so a redeploy on a host with no disk
   * left it describing an add-on that was entirely gone — its version, its
   * slots, and `connected: true`, because the credential row survives the
   * volume. Everything else in this DTO stays as the meta store has it: it is
   * what WAS installed, which is what the operator needs in order to put it
   * back.
   */
  missing: z.boolean(),
  /** Epoch ms; null for a credential that does not expire, or none at all. */
  connectionExpiresAt: z.number().nullable(),
  attachments: z.array(addOnAttachmentDto),
  slots: z.array(z.object({ slot: z.string(), client: z.string(), order: z.number() })),
  provides: z.array(z.object({ contract: z.string(), version: z.number() })),
  /** Exact-hostname egress the manifest declares. */
  networkAllow: z.array(z.string()),
  /**
   * Every client bundle this add-on ships, with the URL to fetch it from and
   * the SRI value to pin it to.
   *
   * The URL is SERVED here rather than assembled by the host: the host reads
   * this list and uses what it is given, so the asset path is not a contract it
   * hardcodes and can move without breaking every host at once.
   *
   * `integrity` is derived from the sha256 the store recorded when the package
   * was unpacked — the same hash the serve path re-checks the bytes against, so
   * what a host pins and what the server refuses to serve cannot disagree.
   */
  /**
   * What this add-on's settings panel is FOR — the manifest's own `settings[]`
   * declaration, plus the non-secret values currently stored.
   *
   * ─── Why the declaration travels with the DTO ──────────────────────────
   *
   * Studio's settings form used to be one hard-coded `api_key` input, which
   * broke the moment an add-on declared two secrets — `shipping-dhl` has done
   * since wave 4, and its connect could not be completed from the page. A form
   * generated from the manifest fixes that class of defect rather than that
   * one instance, and the manifest is where the declaration already lives.
   *
   * ─── AND WHY `values` CARRIES NO SECRET ────────────────────────────────
   *
   * A secret belongs in the encrypted credentials table and is written through
   * CONNECT, never through the settings PUT. The repo refuses a key the
   * manifest marks `secret`, and this DTO never carries one back: `values` is
   * the non-secret half, read in clear because it IS in clear.
   */
  settings: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      required: z.boolean(),
      secret: z.boolean(),
      /** `{key, fallback}` — rendered only when the add-on's messages are registered. */
      label: z.object({ key: z.string(), fallback: z.string() }).nullable(),
      help: z.object({ key: z.string(), fallback: z.string() }).nullable(),
      /** For `enum`; empty otherwise. */
      options: z.array(z.string()),
    }),
  ),
  /** The stored NON-SECRET values. Never a credential. */
  settingValues: z.record(z.string(), z.unknown()),
  bundles: z.array(
    z.object({
      path: z.string(),
      url: z.string(),
      integrity: z.string().regex(/^sha256-[A-Za-z0-9+/]+={0,2}$/),
    }),
  ),
  /**
   * The installed apps that name this add-on, and how — read BEFORE a click,
   * so the page can say "Point of Sale's Emailed receipts will switch off"
   * instead of learning it from a refusal. An app that `requires` it (in any
   * status, a switched-off one included) makes removing it a 409.
   */
  usedBy: z.array(appNeedDto),
});

export const addOnListReply = z.object({ addOns: z.array(addOnDto) });

/** What installing WOULD do — the consent dialog's document. */
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
  /**
   * Advice that does not stop the install: the manifest names app keys this
   * server does not know (every published add-on names apps an instance may
   * never install).
   */
  warnings: z.array(z.string()).optional(),
});

export const installPlanReply = z.object({ plan: installPlanDto });

/**
 * Install takes a STAGED-PACKAGE REFERENCE, never a manifest body
 * (amended seam).
 *
 * The bytes must already be on local disk in the add-on store, verified
 * against the hash the packument and the release ledger agreed on. A route that
 * accepted a manifest document would be a route that installs code nobody
 * checked — runs an add-on's server half in this process.
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

/** Enable or disable on one host (PATCH). */
export const patchAddOnBody = z.object({
  attachedTo: hostKey,
  enabled: z.boolean(),
});

export const patchAddOnReply = z.object({
  addOn: addOnDto,
  /** Switched off for an app that used it for a feature: the features that stop. */
  features: z.array(appNeedDto).optional(),
});

/** `POST /add-ons/:key/attachments` — mount an installed add-on on one more host. */
export const attachAddOnBody = z.object({ app: hostKey }).strict();

export const attachAddOnReply = z.object({
  addOn: addOnDto,
  /** `attached` (a new host), `enabled` (switched back on there), or null (already so). */
  change: z.enum(['attached', 'enabled']).nullable(),
});

export const uninstallAddOnReply = z.object({
  key: addOnKey,
  /**
   * Stated back to the caller because it is the promise the confirm dialog
   * made, and a reply that merely said `ok` would leave the UI asserting it
   * on its own.
   */
  tablesKept: z.boolean(),
  packageRemoved: z.boolean(),
  /** The apps that used it for a feature, and the features that stopped. */
  features: z.array(appNeedDto).optional(),
});

/**
 * Connect. One route shape for all three kinds; this wave serves `api-key`
 * (T07) and refuses `oauth2` as not-yet (T08).
 *
 * `credentials` is a flat map of the add-on's OWN `secret: true` setting keys to
 * their values — `{ api_key: "…", account_number: "…" }` for shipping-dhl. Keys
 * are validated against the manifest, so an unrecognised one is refused rather
 * than stored: a credential store that accepts whatever it is sent is a
 * credential store nobody can audit.
 *
 * There is no reply DTO carrying any of it back. The only readable facts about a
 * connection are `connected`, `connectionExpiresAt` and the granted scopes — all
 * on `addOnDto`, all derivable without decrypting anything.
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
   * Said back for the same reason uninstall says it: the confirm dialog
   * promised it, and a reply that only said `ok` would leave the UI asserting
   * the promise on its own.
   */
  credentialsDeleted: z.boolean(),
  tablesKept: z.boolean(),
});

// ─── Acquisition ────────────────────────────────────────────────────────────

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
   * `missing` — installed according to the meta store, but its files are not
   *   on this server, so none of it loads. A redeploy on a host with
   *   no disk is how this happens. Before this state existed such a row was
   *   either labelled `installed`, or — when the cached feed did not carry it
   *   either, which is every uploaded add-on and every air-gapped install —
   *   left out of the reply altogether while the meta store still said
   *   installed.
   */
  state: z.enum(['installed', 'staged', 'available', 'missing']),
  /**
   * Set when an installed add-on has a NEWER version staged or offered.
   *
   * Never a version this server is too old for: the button acts on this, and
   * the download route refuses such a release, so offering it would be an
   * action that cannot succeed. That case is `needsNewerAdminium` instead.
   */
  upgradeTo: z.string().nullable(),
  /**
   * A catalogue release this server cannot take, and the version it needs.
   *
   * Either the row itself (nothing installed, and the only release offered is
   * above this server's version) or an installed add-on's newer release.
   * LISTED RATHER THAN HIDDEN, the app shelf's ruling: an operator who cannot
   * find an add-on the site advertises has no way to discover that the answer
   * is an Adminium upgrade, while a row that says which version it needs is a
   * decision they can act on.
   */
  needsNewerAdminium: z
    .object({ version: z.string(), minAdminiumVersion: z.string() })
    .nullable(),
  /**
   * One line about what it does, in the CALLER'S locale where the feed has one.
   * Null rather than a placeholder when neither the cached feed nor the staged
   * manifest has anything — the card drops the line instead of printing an
   * apology for it.
   */
  tagline: z.string().nullable(),
  /**
   * Category slugs, VERBATIM (vocabulary: artwork, delivery, payments, email,
   * data). Not an enum: the feed types these `z.array(z.string())` and a future
   * add-on may carry a slug this build has no label for. The dashboard renders
   * an unknown slug as itself rather than dropping the row.
   */
  categories: z.array(z.string()),
  /**
   * Whether installing will ask for a credential — the one permission-shaped
   * fact a card carries. Everything else about what an add-on may reach belongs
   * to the install plan, which is the security surface.
   */
  connectKind: z.enum(['none', 'api-key', 'oauth2']),
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
 * The online-catalog switch.
 *
 * A settings-registry boolean (`addOns.catalogEnabled`) with a route of its
 * own rather than a row in `/settings/*`, and the reason is: those routes are
 * gated on `settings.manage`, and the whole point of un-reserving
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
 * plus a route-scoped `bodyLimit` (`routes/imports`). So the scalars that would
 * have been the other multipart parts travel as query parameters instead.
 *
 * The package names itself: its key and version are read from its own
 * `manifest.json`, inside the bytes `expectedSha512` verifies. They used to be
 * typed, and a typed key that differed from the manifest staged and installed
 * under a key the add-on's own bundle URLs do not use, so it served nothing.
 * `key` and `version` remain as optional ASSERTIONS for a scripted caller: given
 * and different from the manifest, the upload is refused before anything is
 * written.
 *
 * `expectedSha512` is the operator's, and D4 is honest about what that is worth:
 * for a tarball of unknown origin it is self-referential, and the hardened
 * unpack is the only defence left — which is exactly why the unpack is
 * unconditional rather than trusted-source-skippable.
 */
export const uploadAddOnQuery = z.object({
  key: addOnKey.optional(),
  version: z.string().min(1).max(64).optional(),
  expectedSha512: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

export const stagedPackageReply = z.object({
  key: addOnKey,
  version: z.string(),
  /** The manifest's display name, so the operator sees what was read. */
  name: z.string(),
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
 * Start an OAuth connect.
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

/**
 * `PUT /add-ons/:key/settings` — the non-secret half of an add-on's
 * configuration.
 *
 * A PARTIAL patch, because the panel edits one field at a time and a full
 * replace would mean every panel sending the whole object back — which is how
 * one tab's stale copy silently reverts another's save.
 */
export const addOnSettingsBody = z
  .object({ values: z.record(z.string(), z.unknown()) })
  .strict();

export const addOnSettingsReply = z.object({
  key: addOnKey,
  values: z.record(z.string(), z.unknown()),
  updatedAt: z.number(),
});
