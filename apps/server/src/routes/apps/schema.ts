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

import { planReply } from '../schema-ddl/schema.js';

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
/**
 * The operator's answers on the check step: what to do with each table whose
 * name is taken (by its short name), and a different prefix for the whole app.
 */
export const installAnswers = {
  choices: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('reuse') }),
        z.object({ action: z.literal('share') }),
        z.object({ action: z.literal('rename-existing'), to: z.string().min(1).max(64) }),
      ]),
    )
    .optional(),
  altPrefix: z.string().min(2).max(40).optional(),
};

/**
 * What the install does with one add-on the app names: install or connect it
 * at `version` — the one the check offered — and, for one installed at a
 * version the app does not work with, `update: true` ("Update it too").
 */
export const appAddOnChoice = z
  .object({
    key: appKey,
    version: z.string().min(1).max(64),
    update: z.boolean().optional(),
  })
  .strict();

/** One app that uses an add-on, and how. */
const appNeedWire = z.object({
  app: appKey,
  appName: z.string(),
  status: z.string(),
  need: z.enum(['requires', 'feature', 'suggests']),
  range: z.string().nullable(),
  features: z.array(z.object({ id: z.string(), label: z.record(z.string(), z.string()) })),
});

/** An add-on's own install plan, as its consent dialog reads it. */
const addOnPlanWire = z.object({
  addOnKey: z.string(),
  version: z.string(),
  installable: z.boolean(),
  touchesData: z.boolean(),
  create: z.array(z.object({ ref: z.string(), columns: z.array(z.object({ ref: z.string(), type: z.string() })) })),
  reuse: z.array(z.object({ ref: z.string(), missingColumns: z.array(z.string()) })),
  references: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      to: z.string(),
      resolution: z.enum(['internal', 'host', 'unresolved']),
    }),
  ),
  problems: z.array(z.object({ code: z.string(), message: z.string(), table: z.string(), column: z.string().optional() })),
  requiresSchemaChange: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

/**
 * One add-on the app names, resolved against this server. `state` and
 * `source` are kept apart because the screen shows both: "Installed · v1.1.0 ·
 * Comes with Adminium".
 */
export const appAddOnRow = z.object({
  key: appKey,
  name: z.string(),
  /** `requires`, `feature` (a feature of the app needs it) or `suggests`. */
  need: z.enum(['requires', 'feature', 'suggests']),
  range: z.string(),
  /** Why the app wants it, per language (the manifest's words, not a translation key). */
  reason: z.record(z.string(), z.string()),
  /** Ticked on the check: always when required, as the manifest says when suggested. */
  checked: z.boolean(),
  features: z.array(z.object({ id: z.string(), label: z.record(z.string(), z.string()) })),
  state: z.enum(['attached', 'installed', 'outdated', 'absent', 'unavailable']),
  source: z.enum(['bundled', 'catalog', 'upload']).nullable(),
  installedVersion: z.string().nullable(),
  offeredVersion: z.string().nullable(),
  /** Whether the INSTALLED version falls in the app's range. */
  satisfiesRange: z.boolean(),
  /** Whether the offered version's bytes are on this server; false means "download it first". */
  staged: z.boolean(),
  /** Connected to this app and switched on there. */
  enabled: z.boolean(),
  /** What installing the app does to it: null (nothing), attach, install or update. */
  action: z.enum(['attach', 'install', 'update']).nullable(),
  /** The other apps that use it — "Also used by" beside "Update it too". */
  usedBy: z.array(appNeedWire),
  /** Its own install plan (install or update). Absent from the settings read. */
  plan: addOnPlanWire.nullable().optional(),
  /** What stands in the way. Any one refuses the install when the add-on is required or ticked. */
  problems: z.array(z.object({ code: z.string(), message: z.string() })),
});

/** What the install or update did to the add-ons — the done line ("Also installed: …"). */
export const addOnsDoneReply = z.object({
  installed: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })),
  updated: z.array(z.object({ key: z.string(), name: z.string(), from: z.string(), to: z.string() })),
  attached: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })),
});

export const connectionParams = z.object({ id: z.string().min(1).max(64) });

/** The rules a shape set on a connection, still as it set them (`GET /connections/:id/shape-rules`). */
export const shapeRulesReply = z.object({
  rules: z.array(
    z.object({
      tableName: z.string(),
      columnName: z.string().nullable(),
      op: z.string(),
      addOn: z.string(),
      /** The add-on's own name: "Set by Invoices & Receipts". */
      addOnName: z.string(),
      /** What switching it off stops guaranteeing: numbers, totals, edits of a sent document, or a kept value. */
      guarantee: z.enum(['numbers', 'totals', 'edits', 'kept']),
    }),
  ),
});

export const planAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  connectionId: z.string().min(1),
  ...installAnswers,
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
  /**
   * The manifest's rules the install will skip because they would show a
   * column kept from readers — a secret, or masked personal data — of a
   * table it reuses: only an operator shows one, in Studio. Never a
   * refusal; absent when there is none.
   */
  ruleWarnings: z.array(z.object({ table: z.string(), column: z.string(), message: z.string() })).optional(),
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
  /**
   * The plan's identity: a hash of what it would do and of the
   * live tables it was made from. The install sends it back, and a database
   * that changed in between answers 409 `SCHEMA_DRIFT` instead of doing
   * something the operator never saw.
   */
  checksum: z.string(),
  /**
   * Each table's class, action, what the check step offers, and the safe edits
   * a reused table needs. Absent for an add-on.
   */
  tables: z
    .array(
      z.object({
        ref: z.string(),
        table: z.string(),
        class: z.enum(['new', 'own-leftover', 'shared', 'taken']),
        action: z.enum(['create', 'reuse', 'share', 'rename-existing', 'undecided']),
        offers: z.array(z.enum(['reuse', 'share', 'rename-existing', 'alt-prefix'])),
        reuseRefusal: z.string().optional(),
        renameExistingTo: z.string().optional(),
        sharedWith: z.string().optional(),
        /** From an earlier install that used the table it found rather than making it. */
        adopted: z.literal(true).optional(),
        edits: z.array(
          z.object({
            kind: z.enum(['add-column', 'widen', 'set-identity', 'enum-values']),
            column: z.string(),
            from: z.string().optional(),
            to: z.string().optional(),
            values: z.array(z.string()).optional(),
          }),
        ),
        blocked: z.array(z.object({ column: z.string(), reason: z.string() })),
        /** The columns the app declares for it. */
        columns: z.array(z.object({ ref: z.string(), type: z.string() })),
      }),
    )
    .optional(),
  /** Short name → real table. */
  names: z.record(z.string(), z.string()).optional(),
  /** The app ships sample data, which can be added once it is installed. */
  sampleData: z.boolean().optional(),
  /**
   * The add-on settings the app's roles would be given (`addOn:<key>:settings`),
   * for the check step to show before anyone agrees: those settings are
   * shared by every app the add-on serves. Absent when none.
   */
  addOnGrants: z
    .array(z.object({ role: z.string(), roleName: z.string(), addOn: z.string(), grant: z.literal('settings') }))
    .optional(),
  /**
   * What the app's guests could do through the public API, as it asks, for
   * the check step to show and the installer to allow or not. Absent for an
   * app asking for none.
   */
  publicAccess: z
    .object({
      endpoints: z.array(
        z.object({
          ref: z.string(),
          table: z.string(),
          methods: z.array(z.string()),
          select: z.array(z.string()),
          writable: z.array(z.string()),
          claim: z.array(z.string()).nullable(),
          /** `availability` answers free or full per slot, never a row. */
          kind: z.enum(['records', 'availability']),
          /** A guest's create here is confirmed by email. */
          confirms: z.boolean(),
          /** Answered by a later release: listed, not made now. */
          pending: z.boolean(),
          issues: z.array(z.string()),
        }),
      ),
      warnings: z.array(z.object({ code: z.string(), message: z.string() })),
      /** Making the app's key needs `system:api-keys:manage`. */
      canGrant: z.boolean(),
    })
    .optional(),
  /**
   * The add-ons the app names, each with its state, its source and its own
   * plan. Absent for an app that names none — its check is exactly as before.
   */
  addOns: z.array(appAddOnRow).optional(),
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
  /**
   * The `checksum` of the plan the operator reviewed. When present, the install
   * re-plans from the live database and refuses with 409 `SCHEMA_DRIFT` if the
   * plan came out different. Optional so a scripted install that never showed
   * anyone a plan keeps working.
   */
  planChecksum: z.string().min(1).max(128).optional(),
  /**
   * The check step's "Allow this public access". Absent means allowed — the
   * box starts ticked — for an app that asks for any.
   */
  publicAccess: z.boolean().optional(),
  /**
   * The add-ons to install, connect or update with the app. A required one
   * that needs only installing or connecting is done without being listed; a
   * suggested one only when listed; an update only with `update: true`.
   */
  addOns: z.array(appAddOnChoice).max(16).optional(),
  ...installAnswers,
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
  /**
   * Where this side opens: its mapped host when it has one, else its prefix.
   * Absent from an older server.
   */
  openUrl: z.string().optional(),
  /** `on`, switched `off` by the operator, or the whole app `disabled`. */
  state: z.enum(['on', 'off', 'disabled']).optional(),
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
   * The row's status. `installing` is an install that
   * stopped part way: not served, and finished by installing again. Absent
   * from an older server.
   */
  status: z.enum(['installing', 'installed', 'disabled', 'error']).optional(),
  /**
   * Set when the app is prefixed now and this install's tables still carry
   * the plain names they were made or found with: the prefix they would get,
   * and how many. The page offers the rename. Absent otherwise.
   */
  oldTableNames: z.object({ prefix: z.string(), count: z.number() }).optional(),
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
  /**
   * The column rules and option lists the manifest asked for, as install or
   * update just wrote them. A skipped rule is one the operator already keeps,
   * or one the database cannot. Absent where pages are.
   */
  rules: z
    .object({
      written: z.number(),
      removed: z.number(),
      lists: z.array(z.string()),
      skipped: z.array(z.object({ table: z.string(), column: z.string(), op: z.string(), reason: z.string() })),
    })
    .optional(),
  /** The manifest's roles made now, and the grants given now (each once). Absent where pages are. */
  roles: z.object({ created: z.array(z.string()), seeded: z.number() }).optional(),
  /** The public endpoints the manifest asked for, saved now, and the guests' key if one was made now. */
  publicAccess: z
    .object({
      endpoints: z.array(z.string()),
      keyId: z.string().nullable(),
      /** Every key made now, by purpose: the guests' (`customer`) and a second one's (`kiosk`). */
      keys: z.record(z.string(), z.string()),
      /** An update's change the app's own key may not take; the endpoint stays as it was. */
      skipped: z.array(z.object({ ref: z.string(), reason: z.string() })),
    })
    .optional(),
  /**
   * The emails the manifest declares: whether its outbox is defined now, and
   * each template language written, kept (the operator edited it), skipped
   * (the name is someone else's) or removed (no longer shipped, unedited).
   */
  outbox: z
    .object({
      defined: z.boolean(),
      templates: z.object({
        written: z.array(z.string()),
        kept: z.array(z.string()),
        skipped: z.array(z.object({ key: z.string(), locale: z.string(), reason: z.string() })),
        removed: z.number(),
      }),
    })
    .optional(),
  /** The add-ons installed, updated or connected along with the app. Absent for an app that names none. */
  addOns: addOnsDoneReply.optional(),
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
  /**
   * A newer release on disk that cannot update the installed version in
   * place: its manifest's `updatesFrom` leaves this version out. Uninstalling
   * first is the way to it, and the page says so rather than offering it.
   */
  cannotUpdate: z.object({ version: z.string(), updatesFrom: z.string() }).nullable(),
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

/**
 * An update may carry the check's answers for a new version's tables, and the
 * checksum of the plan the operator saw. No body updates as before.
 */
export const updateAppBody = z
  .object({
    planChecksum: z.string().min(1).max(128).optional(),
    choices: installAnswers.choices,
    /** As the install's: the add-ons the new version needs, installed, connected or updated first. */
    addOns: z.array(appAddOnChoice).max(16).optional(),
  })
  // A POST with no body at all arrives as null.
  .nullish();

/** One table the rename to the app's prefix would move. */
const prefixRename = z.object({ ref: z.string(), from: z.string(), to: z.string() });

/**
 * What renaming an install's tables to the app's prefix would do: EVERY table
 * that carries a plain name, and the schema editor's own plan for the renames.
 */
export const renameTablesPlanReply = z.object({
  prefix: z.string(),
  connectionId: z.string(),
  tables: z.array(prefixRename),
  plan: planReply,
});

export const renameTablesBody = z.object({
  /** The `plan.checksum` the operator reviewed; a database that moved answers SCHEMA_DRIFT. */
  checksum: z.string().min(1).max(128),
});

export const renameTablesReply = z.object({
  prefix: z.string(),
  renamed: z.array(prefixRename),
  changeId: z.string(),
});

// ── One app's own settings page ─────────────────────────────────────────────

const appSide = z.enum(['staff', 'customer']);

/**
 * Change one app's settings. Every field is optional and only what is sent
 * changes: its display name (null = the app's own), where its staff screens
 * live, the connection its staff side reads (null = infer), which sides are
 * switched off, and the values of the settings its manifest declares.
 */
export const appSettingsBody = z
  .object({
    name: z.string().trim().min(1).max(60).nullable().optional(),
    placement: z.enum(['internal', 'external']).optional(),
    connectionId: z.string().min(1).nullable().optional(),
    off: z.array(appSide).max(2).optional(),
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const appSettingsReply = z.object({
  key: appKey,
  /** The operator's own name, or null for the app's. */
  name: z.string().nullable(),
  placement: z.enum(['internal', 'external']),
  connectionId: z.string().nullable(),
  off: z.array(appSide),
  /** Every declared, non-secret setting, with its default where none was saved. */
  values: z.record(z.string(), z.unknown()),
  /** This app's mapped hosts. */
  domains: z.record(z.string(), z.object({ side: appSide, instance: z.string().optional() })),
  /** What each of those settings is, so a page can draw its control. Secrets never appear. */
  declared: z.array(
    z.object({
      key: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'enum', 'file', 'json']),
      enum: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      /** The manifest's English label and help. */
      label: z.string().optional(),
      help: z.string().optional(),
    }),
  ),
  /** The add-ons the app names, each with its state and source. Absent for an app that names none. */
  addOns: z.array(appAddOnRow).optional(),
});

/**
 * What one app's settings page shows beside its settings: the connection it
 * reads, every table it uses (with the snapshot's row estimate, never a live
 * count), and its recent activity from the audit log.
 */
export const appOverviewReply = z.object({
  key: appKey,
  connection: z.object({ id: z.string(), name: z.string(), engine: z.string() }).nullable(),
  tables: z.array(
    z.object({
      ref: z.string(),
      table: z.string(),
      state: z.string(),
      /** `sample-ledger`: Adminium's list of the sample rows it added, made on the first add. */
      role: z.enum(['app', 'sample-ledger']),
      /** The last introspection's estimate; null when it has none. */
      rows: z.number().nullable(),
    }),
  ),
  activity: z.array(
    z.object({ action: z.string(), at: z.number(), actor: z.string() }),
  ),
});

export const appStatusReply = z.object({
  key: appKey,
  status: z.enum(['installing', 'installed', 'disabled', 'error']),
});

const appDomainTarget = z.object({ side: appSide, instance: z.string().min(1).max(40).optional() });

/** This app's hosts, all of them: the ones left out are unmapped. Other apps' hosts are untouched. */
export const appDomainsBody = z.object({ domains: z.record(z.string(), appDomainTarget) }).strict();
export const appDomainsReply = z.object({ domains: z.record(z.string(), appDomainTarget) });

/** This app's extra instances, all of them. */
export const appInstancesBody = z
  .object({ instances: z.array(z.object({ slug: z.string(), connectionId: z.string().min(1) })).max(32) })
  .strict();
export const appInstancesReply = z.object({
  instances: z.array(z.object({ slug: z.string(), connectionId: z.string() })),
});

// ── Sample data ─────────────────────────────────────────────────────────────

const tableCount = z.object({ ref: z.string(), count: z.number() });

export const sampleStatusReply = z.object({
  /** The app ships a sample bundle. */
  offered: z.boolean(),
  loaded: z.boolean(),
  total: z.number(),
  /** When it was added (epoch ms), or null. */
  addedAt: z.number().nullable(),
  tables: z.array(tableCount),
  /** What an add would write, when the app offers sample data and none is loaded. */
  available: z.object({ total: z.number(), tables: z.array(tableCount), assets: z.number() }).nullable(),
});

export const sampleRemovePlanReply = z.object({
  tables: z.array(tableCount),
  /** Sample rows your own records still use: kept. */
  kept: z.array(
    z.object({
      ref: z.string(),
      label: z.string().nullable(),
      /** What the record is called now (its label column), when it has one. */
      title: z.string().nullable(),
      usedBy: z.number(),
    }),
  ),
  /** Sample rows changed since they were added, and which columns. */
  changed: z.array(
    z.object({ ref: z.string(), label: z.string().nullable(), title: z.string().nullable(), columns: z.array(z.string()) }),
  ),
  total: z.number(),
});

export const sampleRemoveBody = z.object({ keepChanged: z.boolean().default(true) }).strict();

export const sampleRemoveReply = z.object({
  removed: z.number(),
  kept: z.number(),
  byTable: z.record(z.string(), z.number()),
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

/**
 * What uninstalling would remove and keep, for the dialog to say before
 * anything happens. Deleting a role takes its members' membership and its
 * `adm_sk_` keys with it (hard-deleted, not revoked), so both are counted.
 */
export const uninstallPlanReply = z.object({
  key: appKey,
  pages: z.object({
    /** Untouched since install: deleted with their grants. */
    removed: z.array(z.object({ slug: z.string(), title: z.string() })),
    /** Edited by someone: kept as ordinary pages. */
    kept: z.array(z.object({ slug: z.string(), title: z.string() })),
  }),
  keys: z.number(),
  endpoints: z.number(),
  roles: z.array(z.object({ slug: z.string(), name: z.string(), members: z.number(), apiKeys: z.number() })),
  tables: z.array(
    z.object({
      table: z.string(),
      /** Made by this app and named by nothing else: the one kind the option may drop. */
      droppable: z.boolean(),
    }),
  ),
  hosts: z.array(z.string()),
  /** Column rules the app wrote that are still as it wrote them: taken back. */
  rules: z.number(),
  /** Discarding data is Super Admin's alone; the dialog offers the drop only when this is true. */
  canDropTables: z.boolean(),
  /**
   * The add-ons connected to the app. They stay installed — they are shared —
   * and only their link to this app goes (the Kept line).
   */
  addOns: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })).optional(),
});

/** Uninstall. Dropping the app's own tables needs the app's key typed back. */
export const uninstallAppBody = z
  .object({
    dropTables: z.boolean().optional(),
    confirmKey: z.string().max(64).optional(),
  })
  .nullish();

export const uninstallAppReply = z.object({
  key: appKey,
  uninstalled: z.boolean(),
  /** What went. Absent from an older server. */
  removed: z
    .object({
      pages: z.number(),
      keys: z.number(),
      endpoints: z.number(),
      roles: z.number(),
      rules: z.number().optional(),
      /** The app's email templates nobody edited. */
      emails: z.number().optional(),
    })
    .optional(),
  /** What stayed: pages someone edited, and every table not dropped. */
  kept: z
    .object({
      pages: z.number(),
      tables: z.array(z.string()),
      /** Add-ons that stay installed; their link to this app is gone. */
      addOns: z.array(z.string()).optional(),
    })
    .optional(),
  dropped: z.array(z.string()).optional(),
});
