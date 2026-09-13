// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire shapes for `/api/v1/apps` (47-app-installation.md §1 step 1).
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
 * Upload carries its identity in the query and its bytes in the body.
 *
 * `expectedSha512` is the uploader's own hash of the file they are sending, and
 * 32 D4's honesty about what that is worth applies here unchanged: for a
 * tarball of unknown origin it is self-referential, which is exactly why the
 * hardened unpack runs unconditionally rather than being skippable for a
 * trusted source.
 */
export const uploadAppQuery = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  expectedSha512: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

export const stagedAppReply = z.object({
  key: appKey,
  version: z.string(),
  /** How many files the verified tree holds — the receipt for an unpack. */
  files: z.number(),
  integrity: z.string(),
  /** Which sides the package actually carries, in serve order. */
  sides: z.array(z.enum(['staff', 'customer'])),
});

/**
 * The plan preview (47-app-installation.md O2).
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
});

export const appInstallPlanReply = z.object({ plan: appInstallPlanDto });

export type AppInstallPlanDto = z.infer<typeof appInstallPlanDto>;

export const installAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  /**
   * The database the app's tables are created in, and the one its staff surface
   * reads afterwards (29 D9).
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
   * unavailable and Studio says "rebuild" rather than showing an empty section
   * (29 D7).
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
  /** `file` (uploaded) — `marketplace` joins it when the feed ships (47 §1). */
  source: z.string(),
  installedAt: z.number(),
  connectionId: z.string().nullable(),
  sides: z.array(installedSide),
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
 * Everything here is read off DISK — the bundled set staged at boot plus
 * anything uploaded. Browsing never reaches the network, which is what makes
 * the page work identically on an air-gapped install (40 §4.3, restated for
 * apps in 47 step 4) and what stops a page load becoming an outbound call
 * nobody asked for.
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
});

export const appCatalogReply = z.object({ apps: z.array(appCatalogEntry) });

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
