// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire shapes for `/api/v1/apps`.
 *
 * Mirrors `routes/add-ons/schema.ts` deliberately: the two surfaces acquire
 * bytes the same way, so an operator tool that can drive one can drive the
 * other, and a reviewer comparing them sees the differences rather than a
 * second dialect.
 */
import { z } from 'zod';

/**
 * `@adminium/manifest`'s identity grammar, restated.
 *
 * Restated rather than imported for the same reason `add-ons/store.ts` restates
 * it: this value becomes a PATH SEGMENT in the store and a URL segment under
 * `/apps/`, and a guard on a path should not be able to change out from under
 * this file when an unrelated package widens its schema.
 */
export const appKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,79}$/, 'an app key is lowercase letters, digits and hyphens');

export const appKeyParams = z.object({ key: appKey });

/**
 * Upload carries its bytes in the body, and the bundle names itself.
 *
 * The key and version are read from the bundle's own `manifest.json`. They
 * used to be asked for, and that was a question with one right answer that the
 * file already held: a bundle is served at the key its build baked into every
 * asset URL, so a typed key that differed was always going to be refused, one
 * step later. `key` and `version` remain as optional ASSERTIONS for a scripted
 * caller that wants to be told when it picked up the wrong file: given and
 * different from the manifest, the upload is refused before anything is
 * written.
 *
 * `expectedSha512` is the uploader's own hash of the file they are sending,
 * honesty about what that is worth applies here unchanged: for a tarball of
 * unknown origin it is self-referential, which is exactly why the hardened
 * unpack runs unconditionally rather than being skippable for a trusted source.
 */
export const uploadAppQuery = z.object({
  key: appKey.optional(),
  version: z.string().min(1).max(64).optional(),
  expectedSha512: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

export const stagedAppReply = z.object({
  key: appKey,
  version: z.string(),
  /** The manifest's display name, so the operator sees what was read. */
  name: z.string(),
  /** How many files the verified tree holds — the receipt for an unpack. */
  files: z.number(),
  integrity: z.string(),
  /** Which sides the package actually carries, in serve order. */
  sides: z.array(z.enum(['staff', 'customer'])),
});

/**
 * The plan preview.
 *
 * `connectionId` is required and is NOT inferred. An add-on can infer its
 * database from the host it attaches to; an app has no host, and guessing "the
 * only connection" on an instance that later grows a second one would silently
 * start planning against a different database than the operator meant.
 */
export const planAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  connectionId: z.string().min(1),
});

/**
 * What installing would do to the chosen database.
 *
 * Mirrors `routes/add-ons`' `installPlanDto` field for field, with `key` where
 * that one says `addOnKey` — the underlying `InstallPlan` carries the add-on
 * spelling for historical reasons and each route names it for its own reader.
 */
export const appInstallPlanDto = z.object({
  key: appKey,
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
   * True when applying this plan needs DDL on the data source — what the
   * consent dialog needs in order to say "this will create tables in your
   * database" BEFORE anyone agrees to it, which is a different question from
   * whether the install can proceed at all.
   */
  requiresSchemaChange: z.boolean(),
  /**
   * The columns a REUSED table is missing, as plan 35's `addColumns` edit —
   * what the update screen offers to run (with the exact statement shown)
   * instead of stopping at `COLUMNS_REQUIRED`. Empty lists when nothing is
   * missing. `blocked` columns cannot be added this way, and the update still
   * refuses while any remain.
   */
  /**
   * What is wrong with the manifest's PAGES, from the manifest alone — an
   * unbound calendar, a binding to a table it does not declare, a table that
   * cannot back its template. Reported, never a refusal: the install goes on
   * and such a page arrives empty. The app's own CI is where they are refused.
   */
  pageWarnings: z.array(
    z.object({
      page: z.string(),
      code: z.string(),
      message: z.string(),
      table: z.string().optional(),
    }),
  ),
  missingColumnsEdit: z.object({
    addColumns: z.array(
      z.object({
        table: z.string(),
        column: z.object({
          name: z.string(),
          logicalType: z.string(),
          nullable: z.literal(true),
          default: z.null(),
          maxLength: z.number().int().nullable(),
          numericPrecision: z.number().int().nullable(),
          numericScale: z.number().int().nullable(),
          comment: z.null(),
        }),
      }),
    ),
    values: z.array(z.object({ table: z.string(), column: z.string(), values: z.array(z.string()) })),
    blocked: z.array(
      z.object({
        table: z.string(),
        column: z.string(),
        reason: z.enum(['foreign-key', 'primary-key', 'unsupported-type']),
      }),
    ),
  }),
});

export const appInstallPlanReply = z.object({ plan: appInstallPlanDto });

export type AppInstallPlanDto = z.infer<typeof appInstallPlanDto>;

export const installAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  /**
   * The database the app's tables are created in, and the one its staff surface
   * reads afterwards.
   *
   * OPTIONAL IN THE SHAPE, REQUIRED IN PRACTICE. `requiredSchema.tables` is
   * `min(1)` on the app branch, so every valid app manifest declares at least
   * one table and every app install therefore needs a connection. It is
   * optional here so the refusal can be a sentence naming the tables that need
   * a home, rather than a schema rejection reading "Required" — and so that a
   * later manifest version permitting no tables does not need a wire change.
   */
  connectionId: z.string().min(1).optional(),
});

/** One side of an installed app, as the operator's list shows it. */
const installedSide = z.object({
  side: z.enum(['staff', 'customer']),
  /** Where it is served, no trailing slash. */
  prefix: z.string(),
  /**
   * False = the bundle carries no `surface.json`, so the blended placement is
   * unavailable and Studio says "rebuild" rather than showing an empty
   * section.
   */
  navAvailable: z.boolean(),
});

/** What the install actually did to the database, for the receipt. */
const appliedSchema = z.object({
  created: z.array(z.string()),
  reused: z.array(z.string()),
});

export const installedAppReply = z.object({
  key: appKey,
  version: z.string(),
  /** Absent when the app declares no tables and none were touched. */
  schema: appliedSchema.optional(),
  /** `file` (uploaded) — `marketplace` joins it when the feed ships. */
  source: z.string(),
  installedAt: z.number(),
  connectionId: z.string().nullable(),
  sides: z.array(installedSide),
  /**
   * The row is installed but nothing of it is on this server, so none of it is
   * served. A redeploy on a host with no disk is how this happens:
   * the meta row survives, the files do not. `sides` is empty then too, but
   * an empty list reads as "no frontends", which is a different thing.
   */
  missing: z.boolean(),
  /**
   * The manifest's pages, as install/update just wrote them. Absent on the
   * list route and for an app declaring none. `warnings` never mean the call
   * failed: a page that could not be bound was created empty, and shows the
   * "this page has no table" notice.
   */
  pages: z
    .object({
      created: z.array(z.string()),
      recomposed: z.array(z.string()),
      kept: z.array(z.string()),
      warnings: z.array(z.object({ page: z.string(), reason: z.string(), message: z.string() })),
    })
    .optional(),
});

export const appListReply = z.object({
  apps: z.array(installedAppReply),
  /**
   * Packages on disk that no row has installed yet — an upload that was
   * interrupted between staging and install, which the page offers to finish
   * or discard rather than leaving as bytes nobody can see.
   */
  staged: z.array(z.object({ key: appKey, version: z.string() })),
});

/**
 * One app this instance could install, as the browse surface shows it.
 *
 * Everything here is read off DISK — the packages in the app store (the bundled
 * set staged at boot, uploads, downloads) plus the app catalog the last refresh
 * cached there (b G8-D3). Browsing never reaches the network, which is what
 * makes the page work identically on an air-gapped install (restated for apps
 * in 47 step 4) and what stops a page load becoming an outbound call nobody
 * asked for.
 */
export const appCatalogEntry = z.object({
  key: appKey,
  /** The version on disk — not necessarily the installed one. */
  version: z.string(),
  name: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  /** `publisher.name` — the comp's "by {publisher}" byline. */
  publisher: z.string(),
  /**
   * The manifest's declared capabilities, which are what the comp's feature
   * chips actually are once the invented ones are dropped: a shipped app really
   * says `payments`, `email-delivery`, `realtime`.
   */
  capabilities: z.array(z.string()),
  sides: z.array(z.enum(['staff', 'customer'])),
  installed: z.boolean(),
  /** Set when a DIFFERENT version is installed than the one staged. */
  installedVersion: z.string().nullable(),
  /**
   * False when the package's own `manifest.json` could not be read.
   *
   * The row is still returned: bytes on disk that the page cannot describe are
   * exactly the ones an operator needs to see in order to discard them, and
   * hiding them is how a store grows packages nobody can account for.
   */
  readable: z.boolean(),
  /**
   * Where the row comes from. `disk`: a package in the app store, installable
   * with no network. `catalog`: offered only by the cached app catalog, so
   * installing it downloads first.
   */
  source: z.enum(['disk', 'catalog']),
  /** `available` rows are catalog-only; `staged` rows are on disk and not installed. */
  /**
   * `missing` — installed according to the meta store, but its files are not
   * on this server. Before this state, such an app was labelled
   * `installed` here, or left out of the reply when the cached feed did not
   * carry it either.
   */
  state: z.enum(['installed', 'staged', 'available', 'missing']),
  /**
   * For an installed app: the newest version above the installed one that this
   * server can use, from disk or from the catalog. A catalog version whose
   * minimum is above this server does not count (see `needsNewerAdminium`).
   */
  updateTo: z.string().nullable(),
  /** True when `updateTo` is already in the store, so updating needs no download. */
  updateStaged: z.boolean(),
  /**
   * A catalog version this server cannot take, and why (48 G8-D2): the
   * available row itself, or an installed app's newer release. Listed so the
   * page can say "needs Adminium 0.2.9" instead of hiding the app.
   */
  needsNewerAdminium: z
    .object({ version: z.string(), minAdminiumVersion: z.string() })
    .nullable(),
});

export const appCatalogReply = z.object({
  apps: z.array(appCatalogEntry),
  /** When the cached app catalog was fetched; null when none is cached (or it is unreadable). */
  catalogFetchedAt: z.number().nullable(),
  /** Whether online browsing is on: `ADMINIUM_NETWORK_FEATURES` AND `apps.catalogEnabled`. */
  onlineEnabled: z.boolean(),
});

/**
 * The online app catalog's switch (48 R2, G8-D3): its own setting,
 * `apps.catalogEnabled`, beside the add-on one and never the same.
 *
 * On `manifests.manage` rather than under `/settings/*` for the add-on switch's
 * reason: whether this deployment talks to adminium.dev is not the authority to
 * rename a workspace.
 */
export const appCatalogSettingsBody = z.object({ enabled: z.boolean() });

export const appCatalogSettingsReply = z.object({
  /** The EFFECTIVE state: an environment veto keeps it off whatever was stored. */
  onlineEnabled: z.boolean(),
  /** True when `ADMINIUM_NETWORK_FEATURES` is overriding the stored setting. */
  vetoed: z.boolean(),
});

export const appJobReply = z.object({ jobId: z.string() });

/** One catalog release to download into the store (48 G8-D5). */
export const downloadAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
});

/** An update's receipt (48 G8-D6). */
export const updateAppReply = z.object({
  app: installedAppReply,
  from: z.string(),
  to: z.string(),
  /** Older version directories removed once the update succeeded (D11). */
  pruned: z.array(z.string()),
});

export const stagedAppParams = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
});

export const discardStagedAppReply = z.object({
  key: appKey,
  version: z.string(),
  discarded: z.boolean(),
});

export const uninstallAppReply = z.object({
  key: appKey,
  uninstalled: z.boolean(),
});
