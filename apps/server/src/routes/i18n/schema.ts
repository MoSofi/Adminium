// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the runtime-translations resource
 * (23-runtime-translations.md §6.1).
 *
 * SYNC NOTE: the client-side mirror lives in `apps/dashboard/src/api/i18n.ts`
 * (type-only copy — the dashboard may not import server runtime code, per the
 * 01-architecture.md §2.3 matrix). Change both together.
 */
import { z } from 'zod';
import { NAMESPACES } from '@adminium/i18n';
import { LOCALE_ID_RE } from '@adminium/meta';

/** Shape only — a locale id may name an admin-created locale (23 §5.3). */
export const localeIdParam = z.string().min(2).max(35).regex(LOCALE_ID_RE);

export const namespaceParam = z.enum(NAMESPACES);

/**
 * Key length is bounded by the column (`varchar(120)`), which in turn is
 * bounded by MySQL's composite-unique-index budget — see migration 0011.
 */
export const messageKey = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/);

// --- manifest ----------------------------------------------------------------

export const localeManifestEntry = z.object({
  locale: z.string(),
  tag: z.string(),
  english: z.string(),
  native: z.string(),
  dir: z.enum(['ltr', 'rtl']),
  fontHint: z.enum(['latin', 'arabic', 'cjk']),
  intlTag: z.string(),
  pluralCategories: z.array(z.string()),
  builtin: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  /** How many keys this locale overrides — the editor's "N customised". */
  overrideCount: z.number(),
});
export type LocaleManifestEntry = z.infer<typeof localeManifestEntry>;

export const i18nManifestReply = z.object({
  /** Monotonic stamp; every mutation bumps it (23 §3.4). */
  version: z.number(),
  locales: z.array(localeManifestEntry),
});

// --- bundle ------------------------------------------------------------------

export const bundleParams = z.object({ locale: localeIdParam, namespace: namespaceParam });

export const i18nBundleReply = z.object({
  locale: z.string(),
  namespace: z.string(),
  version: z.number(),
  /**
   * OVERRIDES ONLY, flat dotted keys — never the compiled bundle. The client
   * already has the compiled text; shipping it again would double the payload
   * and reintroduce the "late chunk clobbers an override" race that merging
   * inside the loader exists to prevent (23 §4.3).
   */
  overrides: z.record(z.string(), z.string()),
});

// --- key browser -------------------------------------------------------------

export const keyStateFilter = z.enum(['all', 'overridden', 'untranslated', 'stale']);

export const keysQuery = z.object({
  locale: localeIdParam,
  namespace: namespaceParam.optional(),
  /** First key segment (`widgets`, `templates`, …) — the editor's primary axis. */
  group: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
  state: keyStateFilter.default('all'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const keyRow = z.object({
  namespace: z.string(),
  key: z.string(),
  /** en-US authored text. */
  source: z.string(),
  /** Compiled translation for this locale (absent for a custom locale). */
  builtin: z.string().nullable(),
  /** The admin override, or null when there is no row. `''` = render nothing. */
  override: z.string().nullable(),
  /** The override was authored against a different en-US text. */
  stale: z.boolean(),
  /** Blanking this key is refused — it feeds an accessible name (23 §3.3). */
  a11yCritical: z.boolean(),
  updatedAt: z.number().nullable(),
});
export type KeyRowView = z.infer<typeof keyRow>;

export const keysReply = z.object({
  items: z.array(keyRow),
  total: z.number(),
  /** Group → key count, for the editor's navigation rail. */
  groups: z.array(z.object({ group: z.string(), count: z.number() })),
  version: z.number(),
});

// --- writes ------------------------------------------------------------------

export const upsertKeyBody = z.object({
  locale: localeIdParam,
  namespace: namespaceParam,
  key: messageKey,
  /** `''` is the deliberate-blank state, allowed only off the a11y list. */
  value: z.string().max(4000),
});

export const deleteKeyQuery = z.object({
  locale: localeIdParam,
  namespace: namespaceParam,
  key: messageKey,
});

export const bulkKeysBody = z.object({
  items: z.array(upsertKeyBody).min(1).max(1000),
});

export const writeKeyReply = z.object({
  ok: z.literal(true),
  version: z.number(),
  row: keyRow.nullable(),
});

export const bulkKeysReply = z.object({
  ok: z.literal(true),
  version: z.number(),
  written: z.number(),
  /** Item-wise rejections — a bad row never fails the whole batch silently. */
  rejected: z.array(
    z.object({ namespace: z.string(), key: z.string(), reason: z.string() }),
  ),
});

// --- locale CRUD -------------------------------------------------------------

export const createLocaleBody = z.object({
  locale: localeIdParam,
  english: z.string().min(1).max(80),
  native: z.string().min(1).max(80),
  dir: z.enum(['ltr', 'rtl']),
  fontHint: z.enum(['latin', 'arabic', 'cjk']),
  /** A REAL BCP-47 tag whose Intl behaviour this locale borrows (23 §5.6). */
  intlTag: z.string().min(2).max(35),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
  /** Seed every key from this locale — defaults OFF (23 §7). */
  copyFrom: localeIdParam.optional(),
});

export const patchLocaleBody = z.object({
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  english: z.string().min(1).max(80).optional(),
  native: z.string().min(1).max(80).optional(),
  dir: z.enum(['ltr', 'rtl']).optional(),
  fontHint: z.enum(['latin', 'arabic', 'cjk']).optional(),
  intlTag: z.string().min(2).max(35).optional(),
});

export const localeParams = z.object({ locale: localeIdParam });

export const deleteLocaleQuery = z.object({
  /**
   * Where users who preferred the deleted locale land. `inherit` NULLs their
   * override so they follow the workspace default again — the state they were
   * in before they ever chose (23 §5.7).
   */
  reassignTo: z.union([z.literal('inherit'), localeIdParam]).default('inherit'),
});

export const localeMutationReply = z.object({
  ok: z.literal(true),
  version: z.number(),
  locale: localeManifestEntry.nullable(),
});

export const deleteLocaleReply = z.object({
  ok: z.literal(true),
  version: z.number(),
  /** What the delete touched, so the UI can be honest about blast radius. */
  reassignedUsers: z.number(),
  deletedOverrides: z.number(),
  deletedEmailTemplates: z.number(),
  workspaceDefaultReset: z.boolean(),
});

// --- format-error sink -------------------------------------------------------

export const formatFailuresReply = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      lng: z.string(),
      message: z.string(),
      at: z.number(),
      count: z.number(),
    }),
  ),
});

// --- transfer (23 §3.6) ------------------------------------------------------

export const translationExportReply = z.object({
  formatVersion: z.literal(1),
  locale: z.string(),
  exportedKeys: z.number(),
  entries: z.record(z.string(), z.record(z.string(), z.string())),
});

/** The uploaded document — validated structurally by `parseImport`. */
export const translationImportBody = z.object({
  formatVersion: z.literal(1),
  locale: z.string().optional(),
  exportedKeys: z.number().optional(),
  entries: z.record(z.string(), z.record(z.string(), z.string())),
});

export const importQuery = z.object({
  /**
   * Opt-in for `errors` and sign-in copy. Off by default because an import is
   * an untrusted-content channel: without this it could silently rewrite what
   * users are told when something fails (23 §3.6).
   *
   * NOT `z.coerce.boolean()`. That runs `Boolean(value)` on the query STRING,
   * and `Boolean('false') === true` — so an explicit `?includeSensitive=false`
   * would opt IN. On a flag whose whole job is to make overwriting error and
   * sign-in copy a deliberate act, defaulting to "yes" on the word "false" is
   * the worst possible failure direction.
   */
  includeSensitive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const translationImportReply = z.object({
  ok: z.literal(true),
  version: z.number(),
  written: z.number(),
  rejected: z.array(z.object({ namespace: z.string(), key: z.string(), reason: z.string() })),
  /** How many sensitive entries the file carried, opted in or not. */
  sensitiveCount: z.number(),
});
