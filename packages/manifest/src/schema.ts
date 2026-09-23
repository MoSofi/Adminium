// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Manifest spec v1, frozen at `manifestVersion: 1` for all of Adminium 1.x.
 * Pure Zod v4 + types — no `node:` imports — so the storefront and the
 * Electron shell can validate a manifest in the browser (the
 * `@adminium/manifest` package row).
 *
 * This module is the envelope: every block's shape and the cross-block rules.
 * The install PLANNER (planInstall / requiredSchema → create-or-map diff) and
 * the server-side installer are later layers that consume a validated manifest.
 */

import {
  addOnBlockSchema,
  addOnCategorySchema,
  i18nMessageSchema,
  isSlotId,
  type AddOnBlock,
  type I18nMessage,
} from '@adminium/add-on-contracts';
import { z } from 'zod';

/** Integer spec version, frozen at 1 for Adminium 1.x. */
export const MANIFEST_VERSION = 1;

/**
 * What kind of thing this manifest describes. OPTIONAL, defaulting to `"app"` —
 * which is the whole reason `manifestVersion` does not move: every manifest
 * written before wave 4 stays valid unchanged, and an additive optional field
 * with a back-compatible default is how a frozen spec grows without lying about
 * its version.
 */
export const MANIFEST_KINDS = ['app', 'add-on'] as const;
export const manifestKindSchema = z.enum(MANIFEST_KINDS);
export type ManifestKind = (typeof MANIFEST_KINDS)[number];

/** strict semver — `major.minor.patch` with optional pre-release/build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const semver = z.string().regex(SEMVER, 'must be strict semver (major.minor.patch)');

/**
 * An i18n message: a catalog key plus the English fallback rendered if absent.
 *
 * DEFINED IN `@adminium/add-on-contracts` since 51a and re-exported here under
 * its own name, so every importer of `@adminium/manifest` is unchanged. It
 * moved because an add-on's page title and nav-group label are written in a
 * manifest and read by a host through the contracts package — one shape, one
 * definition, rather than two that drift a `max()` apart.
 */
export { i18nMessageSchema, type I18nMessage };

// ── identity ─────────────────────────────────────────────────────────────────

/** Closed v1 storefront facet set. */
export const MANIFEST_CATEGORIES = [
  'commerce',
  'hospitality',
  'operations',
  'crm',
  'internal-tools',
] as const;
export const categorySchema = z.enum(MANIFEST_CATEGORIES);

/** The one publisher id v1 accepts unless `third-party-publishers` is on. */
export const FIRST_PARTY_PUBLISHER_ID = 'adminium';

export const publisherSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'publisher id must be ^[a-z][a-z0-9-]{1,39}$'),
    name: z.string().min(1).max(80),
    url: z.url().max(200).optional(),
  })
  .strict();
export type Publisher = z.infer<typeof publisherSchema>;

/**
 * Everything both kinds share. `categories` is deliberately NOT here: it splits
 * by kind (an add-on is not a vertical — D2), so each branch adds its own.
 */
export const identityShape = {
  key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'key must be ^[a-z][a-z0-9-]{1,79}$'),
  name: z.string().min(1).max(80),
  version: semver,
  publisher: publisherSchema,
  // SPDX id — the FRONTEND's license (informational; core is AGPL-3.0).
  license: z.string().min(1).max(80),
  description: i18nMessageSchema,
};

export const identitySchema = z
  .object({
    ...identityShape,
    categories: z.array(categorySchema).min(1),
  })
  .strict();

/**
 * Keys no app or add-on may ever take, because they would shadow a storefront
 * route or a data file (D17). Apps and add-ons share one key namespace.
 *
 * `dashboard` joined them for a different reason: it is the HOST KEY a stock
 * Adminium deployment attaches an add-on under, so an add-on `attaches:
 * [{app: '*'}]` resolves against it and the consent dialog has something to
 * enable and disable. Treating an empty `attachTo` as "the dashboard" was the
 * alternative and leaves nothing to switch off. Reserving the literal means
 * no app can also be called `dashboard` and make an attachment ambiguous.
 */
export const RESERVED_KEYS = [
  'apps',
  'add-on',
  'add-ons',
  'dashboard',
  'demo',
  'index',
  'search',
] as const;

// ── capabilities ─────────────────────────────────────────────────────────────

export const MANIFEST_CAPABILITIES = [
  'hosted-only',
  'offline-required',
  'receipt-printer',
  'barcode-scanner',
  'payments',
  'file-storage',
  'email-delivery',
  'realtime',
  // Added by wave 4. Adding a capability key is a THREE-place change
  // and all three land together: here, `CAP_ICONS` in the website's
  // marketplace data (note `CAP_META` derives from it), and a
  // `marketplaceData.cap.<key>` label in all eight locales.
  /** The add-on's server code calls a third-party API. */
  'outbound-http',
  /** The host runs an OAuth 2.0 authorization-code flow on the add-on's behalf. */
  'oauth-connect',
] as const;
export const capabilitySchema = z.enum(MANIFEST_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

// ── compatibility ────────────────────────────────────────────────────────────

/** The three meta/data engines Adminium can talk to. */
export const MANIFEST_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;

export const compatibilitySchema = z
  .object({
    minAdminiumVersion: semver,
    maxAdminiumVersion: semver.optional(), // exclusive upper bound
    /**
     * Which data engines this app's `requiredSchema` actually works on.
     *
     * ADDED rather than dropped from the manifests. Thirteen shipped manifests
     * already carried `engines` and this `.strict()` schema rejected every one
     * — it is a spec field that never reached the code. The information is
     * real: an app whose schema uses Postgres-only DDL cannot be installed
     * against SQLite, and deleting the field to satisfy the validator would
     * have thrown away the only place that is written down.
     *
     * Optional and additive, so nothing that validated before stops.
     */
    engines: z.array(z.enum(MANIFEST_ENGINES)).min(1).optional(),
    requires: z.array(capabilitySchema).optional(),
  })
  .strict();

// ── requiredSchema (create-or-map) ───────────────────────────────────────────

/** Abstract column types the introspection engine emits (research). */
export const COLUMN_TYPES = [
  'id',
  'text',
  'int',
  'bigint',
  'decimal',
  'money',
  'float',
  'bool',
  'enum',
  'json',
  'date',
  'timestamptz',
  'uuid',
  'fk',
  'blob',
] as const;

/** Optional semantic pre-seed so widgets auto-instantiate. */
export const COLUMN_SEMANTICS = [
  'name',
  'money',
  'image',
  'email',
  'avatar',
  'geo-lat',
  'geo-lng',
] as const;

/** Structural role markers. */
export const COLUMN_ROLES = ['pk', 'created_at', 'updated_at'] as const;

/** A snake_case identifier: a table or column ref. */
const refSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');

/** A BCP 47 tag, the way every label map in a manifest is keyed (`de-DE`). */
const bcp47TagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'keyed by BCP 47 tag');

/** A label in several languages. US English is the one every reader falls back to. */
export const labelsSchema = z
  .record(bcp47TagSchema, z.string().min(1).max(120))
  .refine((labels) => labels['en-US'] !== undefined, { message: 'labels must include en-US' });

/** A text that is either one string, or the same text in several languages. */
const textOrLabels = z.union([z.string().min(1).max(256), labelsSchema]);

/**
 * A number the manifest states, or one the app's own settings row holds — so
 * a venue can change its capacity without a new release. `{table, column}`
 * reads the one row of that (one-row) table at write time.
 */
const numberOrSetting = z.union([
  z.number().int().nonnegative(),
  z.object({ table: refSchema, column: refSchema }).strict(),
]);

/**
 * The rules an app asks Adminium to keep on a column (written as column-rule
 * overrides at install). The first five are the rules an operator can set in
 * the column inspector; the rest are the ones Adminium DECIDES for a public
 * write, so a browser never picks a price, a number or a code:
 *
 *  - `copy`: take the value from the linked row (`via` is this table's
 *    foreign-key column, `from` a column of the row it points at).
 *  - `sequence`: the next number in this column's own counter.
 *  - `code`: a short random code (Crockford base 32), unique in the column.
 *  - `rollup`: a total over child rows, kept in step as they change.
 *  - `venueLocal`: a wall time with no zone is read in the venue's zone.
 *  - `personal`: whether the column is personal data, overriding the guess
 *    Adminium makes from its name.
 */
export const columnRulesSchema = z
  .object({
    options: z
      .union([
        z.object({ list: z.string().min(1).max(120) }).strict(),
        z
          .object({
            values: z
              .array(
                z
                  .object({ value: z.string().min(1).max(256), label: textOrLabels.optional(), tone: z.string().max(32).optional() })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict(),
      ])
      .optional(),
    enumLabels: z
      .object({
        labels: z.record(z.string().min(1), textOrLabels),
        tones: z.record(z.string().min(1), z.string().max(32)).optional(),
      })
      .strict()
      .optional(),
    required: z.literal(true).optional(),
    validation: z
      .object({
        format: z.enum(['email', 'url', 'phone']).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    copy: z
      .object({ via: refSchema, from: refSchema, mode: z.enum(['default', 'always']).optional() })
      .strict()
      .optional(),
    sequence: z.object({ start: z.number().int().min(1).optional() }).strict().optional(),
    code: z
      .object({
        prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,5}-?$/, 'an upper-case prefix, e.g. MR-').optional(),
        length: z.number().int().min(4).max(12),
      })
      .strict()
      .optional(),
    rollup: z
      .object({
        /** The child table, its foreign key back to this row, and what to add up. */
        from: refSchema,
        via: refSchema,
        sum: refSchema,
        /** Multiplied into `sum` per child row, e.g. `qty`. */
        times: refSchema.optional(),
        /** A child row whose column holds a value is left out — a voided line (`voided_at`). */
        unlessSet: refSchema.optional(),
      })
      .strict()
      .optional(),
    venueLocal: z.literal(true).optional(),
    /**
     * Whether the column holds personal data, when the app knows better than
     * a guess from its name: a venue's own `phone` and `address` are a
     * business's, and its guest page may show them. The operator can still
     * mark it otherwise.
     */
    personal: z.boolean().optional(),
  })
  .strict();
export type ColumnRules = z.infer<typeof columnRulesSchema>;

/**
 * A limit on how much of a slot rows may take — the booking guard. Only rows
 * whose `countWhere` column holds one of its values count (a cancelled booking
 * holds no seats).
 */
export const capacitySchema = z
  .object({
    slot: refSchema,
    amount: refSchema,
    perSlot: numberOrSetting,
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict().optional(),
    slotMinutes: numberOrSetting,
    windowDays: numberOrSetting.optional(),
    opens: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.object({ table: refSchema, column: refSchema }).strict()]).optional(),
    closes: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.object({ table: refSchema, column: refSchema }).strict()]).optional(),
    /** A table, a room: the limit applies per value of this column too. */
    resource: refSchema.optional(),
    /**
     * How many hours before its time a guest may still cancel through the
     * public API; later, only the venue can. Staff are never held to it.
     */
    cancelHours: numberOrSetting.optional(),
  })
  .strict();

/** The longest `maxLength` a text column may ask for (see `maxLength` below). */
export const MAX_TEXT_LENGTH = 1000;

/**
 * Why a column's `default` cannot be created, or `null` when it can.
 *
 * The rules are the ones every one of the three databases can honour with the
 * same meaning, so a manifest that validates installs the same everywhere:
 *
 *  - `now` only on a `timestamptz`, and a timestamp takes nothing else. A
 *    literal timestamp default is a fixed moment, which is never what a
 *    manifest author means.
 *  - `text` needs `maxLength`: MySQL gives an unbounded TEXT column no literal
 *    default, and a manifest must not install on two engines and fail on the
 *    third.
 *  - `json`, `blob`, `date`, keys and foreign keys take none.
 *  - an enum's default is one of its values, a number is a number, a boolean a
 *    boolean.
 */
export function defaultIssue(c: {
  type: string;
  role?: string | undefined;
  enum?: readonly string[] | undefined;
  maxLength?: number | undefined;
  default?: string | number | boolean | undefined;
}): string | null {
  const value = c.default;
  if (value === undefined) return null;
  if (c.role === 'pk') return 'a primary key takes no default; an int key numbers itself';
  switch (c.type) {
    case 'timestamptz':
      return value === 'now' ? null : 'a timestamptz default must be "now"';
    case 'text':
      if (typeof value !== 'string') return 'a text default must be a string';
      if (c.maxLength === undefined) return 'a text default needs maxLength (MySQL gives TEXT no default)';
      return value.length <= c.maxLength ? null : 'the default is longer than maxLength';
    case 'enum':
      return typeof value === 'string' && (c.enum ?? []).includes(value)
        ? null
        : 'an enum default must be one of its values';
    case 'int':
    case 'bigint':
      return typeof value === 'number' && Number.isInteger(value) ? null : 'an integer default must be a whole number';
    case 'decimal':
    case 'money':
    case 'float':
      return typeof value === 'number' ? null : 'a numeric default must be a number';
    case 'bool':
      return typeof value === 'boolean' ? null : 'a bool default must be true or false';
    default:
      return `a ${c.type} column takes no default`;
  }
}

export const requiredColumnSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'column ref must be a snake_case identifier'),
    type: z.enum(COLUMN_TYPES),
    semantic: z.enum(COLUMN_SEMANTICS).optional(),
    role: z.enum(COLUMN_ROLES).optional(),
    nullable: z.boolean().optional(),
    // enum values when `type: 'enum'`; fk target ref when `type: 'fk'`.
    enum: z.array(z.string().min(1)).optional(),
    references: z.string().optional(),
    /**
     * The value the DATABASE fills when an insert leaves the column out. A
     * literal of the column's own type, or the string `now` on a
     * `timestamptz` column. Without one, a NOT NULL column refuses every insert
     * that omits it — which is every insert an operator makes from a form that
     * does not show that column.
     *
     * Additive and optional: an older server refuses a manifest carrying it
     * (every block is `.strict()`), so an app that uses it raises
     * `minAdminiumVersion` to the release that reads it.
     */
    default: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
    /**
     * `text` only: a `varchar(n)` instead of unbounded `text`. Short text is
     * what a form, a unique index and MySQL's key limit all want. At most 1000
     * characters — MySQL counts four bytes per character against one 65,535-byte
     * row, so a few long columns would refuse the table.
     */
    maxLength: z.number().int().min(1).max(MAX_TEXT_LENGTH).optional(),
    /** Rules Adminium keeps on the column once installed (see `columnRulesSchema`). */
    rules: columnRulesSchema.optional(),
    /**
     * What a person calls the column — a form's field, a list's heading — in
     * every language the app speaks. Installed as the column's label, which
     * the operator can rename like any other.
     */
    label: textOrLabels.optional(),
  })
  .strict()
  .refine((c) => c.type !== 'enum' || (c.enum !== undefined && c.enum.length > 0), {
    message: 'an enum column must list its enum values',
    path: ['enum'],
  })
  .refine((c) => c.type !== 'fk' || c.references !== undefined, {
    message: 'a fk column must name its references target',
    path: ['references'],
  })
  .refine((c) => c.maxLength === undefined || c.type === 'text', {
    message: 'maxLength applies to a text column only',
    path: ['maxLength'],
  })
  .superRefine((c, ctx) => {
    const issue = defaultIssue(c);
    if (issue !== null) ctx.addIssue({ code: 'custom', message: issue, path: ['default'] });
  });

export const requiredTableSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'table ref must be a snake_case identifier'),
    columns: z.array(requiredColumnSchema).min(1),
    /**
     * A shape other apps may share, `<name>@<version>` (`menu@1`). Two apps
     * that declare the same shape can use one table between them.
     */
    shape: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/, 'a shape is <name>@<version>').optional(),
    capacity: capacitySchema.optional(),
    /**
     * What a person calls ONE row ("Category") and the table ("Categories"),
     * in every language the app speaks: a form's title and button, a page's
     * empty state, a link's field. Installed as the table's label. Without
     * them Adminium names the table from its real name (`pos_menu_categories`).
     */
    label: textOrLabels.optional(),
    labelPlural: textOrLabels.optional(),
    /** The column that names a row wherever another table links to it (a category's `name`). */
    keyField: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a column ref').optional(),
  })
  .strict()
  .refine(
    (t) => new Set(t.columns.map((c) => c.ref)).size === t.columns.length,
    { message: 'duplicate column ref in table', path: ['columns'] },
  )
  .refine((t) => t.keyField === undefined || t.columns.some((c) => c.ref === t.keyField), {
    message: 'keyField must name one of the table’s columns',
    path: ['keyField'],
  })
  .refine((t) => t.labelPlural === undefined || t.label !== undefined, {
    message: 'labelPlural needs a label',
    path: ['labelPlural'],
  });

export const requiredSchemaSchema = z
  .object({
    tables: z.array(requiredTableSchema).min(1),
    /**
     * Adminium names every table `<app key>_<ref>` (`pos_tickets`), and tells
     * the app the real names at boot. Opt-in, because an app built before it
     * hard-codes its table names. Apps only: an add-on uses its host's tables.
     */
    prefixed: z.literal(true).optional(),
  })
  .strict()
  .refine((s) => new Set(s.tables.map((t) => t.ref)).size === s.tables.length, {
    message: 'duplicate table ref in requiredSchema',
    path: ['tables'],
  });

// ── pages ────────────────────────────────────────────────────────────────────

export const pageNavSchema = z
  .object({
    group: z.string().min(1).max(80),
    icon: z.string().min(1).max(60),
    order: z.number().int(),
  })
  .strict();

export const pageSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'page ref must be a kebab-case identifier'),
    template: z.string().min(1).max(80),
    title: i18nMessageSchema,
    nav: pageNavSchema,
    // page-local table ref → requiredSchema table ref (resolved at install).
    bindings: z.record(z.string(), z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    /**
     * The page's title in other languages, keyed by BCP 47 tag (`de-DE`)
     *. `title.fallback` stays the English; the sidebar shows the
     * operator's language until the operator renames the page.
     */
    titles: z
      .record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'titles are keyed by BCP 47 tag'), z.string().min(1).max(120))
      .optional(),
  })
  .strict();

// ── roles ────────────────────────────────────────────────────────────────────

export const roleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'role key must be a kebab-case identifier'),
    name: z.string().min(1).max(80),
    cloneFrom: z.string().optional(),
    // grant strings validated against the RBAC grammar at install time.
    permissions: z.array(z.string().min(1)).optional(),
    /** Opens the app's own screens and never the dashboard (a till cashier). */
    screensOnly: z.boolean().optional(),
  })
  .strict();

// ── settings ─────────────────────────────────────────────────────────────────

const settingBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'setting key must be snake_case'),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  label: i18nMessageSchema.optional(),
  /*
   * The sentence UNDER the field, where a label alone cannot carry the
   * answer. Every variant below is `.strict()`, so a manifest that wrote
   * `help` without this line was rejected rather than ignored — which is why
   * it rides the same release as `RESERVED_KEYS` above rather than waiting
   * for a settings form to need it.
   */
  help: i18nMessageSchema.optional(),
};

export const settingSchema = z.discriminatedUnion('type', [
  z.object({ ...settingBase, type: z.literal('string'), default: z.string().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('number'),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      unit: z.string().max(20).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('enum'),
      enum: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('file'),
      accept: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('json'), default: z.unknown().optional() }).strict(),
]);

// ── seeds ────────────────────────────────────────────────────────────────────

export const seedSchema = z
  .object({
    table: z.string().min(1),
    // inline rows, or a reference to a bundled seeds/<file> dataset.
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    file: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => (s.rows === undefined) !== (s.file === undefined), {
    message: 'a seed provides exactly one of `rows` or `file`',
  });

// ── widgets (optional custom bundles) ────────────────────────────────────────

export const manifestWidgetSchema = z
  .object({
    id: z.string().min(1).max(80),
    entry: z.string().min(1),
  })
  .strict();

// ── frontend ─────────────────────────────────────────────────────────────────

export const FRONTEND_KINDS = ['spa', 'electron', 'none'] as const;

export const frontendEnvVarSchema = z
  .object({
    required: z.boolean(),
    example: z.string().optional(),
  })
  .strict();

/**
 * Which of the three sides a frontend is.
 *
 * The product rule this exists to make CHECKABLE: a micro-SaaS is the Adminium
 * dashboard (mandatory, and never declared here — it comes from introspection)
 * plus a staff side, a customer side, or both. At least one, or it is not a
 * micro-SaaS but somebody's own build.
 */
export const FRONTEND_SIDES = ['staff', 'customer'] as const;

export const frontendSchema = z
  .object({
    /**
     * REQUIRED, and the whole point of the array form. Without it the split
     * lives only in prose and nothing can enforce rule.
     */
    side: z.enum(FRONTEND_SIDES),
    kind: z.enum(FRONTEND_KINDS),
    entry: z.string().min(1).optional(),
    env: z.record(z.string(), frontendEnvVarSchema).optional(),
    /**
     * The view names this side owns, e.g. `{ book, visits }`.
     *
     * RE-ADMITTED, not newly invented. Eleven shipped manifests already carry
     * this key and the `.strict()` schema rejected every one of them — while
     * being, per the fleet audit, "the only machine-readable record of the
     * staff/customer split anywhere in the fleet". Deleting it during
     * normalization was the tempting move and would have made rule
     * permanently uncheckable.
     */
    routes: z.record(z.string(), z.string()).optional(),
    /**
     * Where a STAFF side opens by default: inside the dashboard, or on its own
     * address (a till). The operator can change it; absent means inside.
     */
    placement: z.enum(['internal', 'external']).optional(),
    /** Whether the side starts switched on. Absent means on. */
    enabled: z.boolean().optional(),
  })
  .strict();

// ── the app's sidebar, public access and sample data ─────────────────────────

/** A heading in the app's own sidebar section; pages name it in `nav.group`. */
/**
 * A list of answers the app ships, for a column's `options: {list}`. Installed
 * as the option list `<appKey>-<name>`, which the operator can then edit like
 * any other; a list of that key they already made is left alone.
 */
export const optionListSchema = z
  .object({
    label: textOrLabels,
    values: z
      .array(
        z
          .object({ value: z.string().min(1).max(256), label: textOrLabels.optional(), tone: z.string().max(32).optional() })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const navGroupSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a nav group key is kebab-case'),
    label: labelsSchema,
    order: z.number().int(),
  })
  .strict();

/**
 * What the app's public screens may do with one table, through the one
 * browser key the install creates. `GET` reads, `POST` creates; `PATCH` only
 * behind a claim (a guest changing their own booking), on a narrow writable
 * list. `availability` answers free or full per slot and never a row.
 */
export const publicAccessSchema = z
  .object({
    table: refSchema,
    kind: z.enum(['records', 'availability']).optional(),
    methods: z.array(z.enum(['GET', 'POST', 'PATCH'])).min(1),
    select: z.array(refSchema).optional(),
    writable: z.array(refSchema).optional(),
    filters: z
      .array(
        z
          .object({
            column: refSchema,
            op: z.enum(['eq', 'neq', 'in', 'gte', 'lte']),
            value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
          })
          .strict(),
      )
      .optional(),
    /** Values the server writes, whatever the browser sends (`status: confirmed`). */
    defaults: z.record(refSchema, z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** Proving you know a row's details, e.g. `{match: [code, mobile]}`. */
    claim: z.object({ match: z.array(refSchema).min(1).max(3) }).strict().optional(),
    /**
     * The confirmation Adminium emails when a guest creates a row here: the
     * column holding their address, the columns the email shows, the app's
     * one-row venue table, and the path under the guest side that manages it.
     */
    confirm: z
      .object({
        template: z.enum(['booking-confirmation']),
        to: refSchema,
        code: refSchema.optional(),
        when: refSchema.optional(),
        party: refSchema.optional(),
        name: refSchema.optional(),
        venue: z
          .object({ table: refSchema, name: refSchema.optional(), address: refSchema.optional(), phone: refSchema.optional() })
          .strict()
          .optional(),
        link: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PublicAccess = z.infer<typeof publicAccessSchema>;

/** The bundled sample data file, inside the package's `seeds/` folder. */
export const sampleDataSchema = z
  .object({
    file: z.string().regex(/^seeds\/[a-z0-9][a-z0-9._-]*\.json$/, 'a file in seeds/, ending .json'),
  })
  .strict();

// ── the manifest envelope ─────────────────────────────────────────────────────

/**
 * The two envelope-wide rules, as plain predicates over the shape both branches
 * share. They are attached to EACH BRANCH below rather than to the union: a
 * `.refine()` on a `z.discriminatedUnion` would run against the union type and
 * lose the narrowing, and moving them up there is how they get silently dropped
 * (first implementer note).
 */
interface SharedEnvelope {
  capabilities?: Capability[] | undefined;
  compatibility: z.infer<typeof compatibilitySchema>;
}

/** Hosted-only and offline-required are mutually exclusive. */
const capabilitiesNotContradictory = (m: SharedEnvelope): boolean =>
  !(
    (m.capabilities?.includes('hosted-only') ?? false) &&
    (m.capabilities?.includes('offline-required') ?? false)
  );

/** maxAdminiumVersion (exclusive) must be strictly above the min. */
const compatibilityWindowOrdered = (m: SharedEnvelope): boolean =>
  m.compatibility.maxAdminiumVersion === undefined ||
  compareSemver(m.compatibility.maxAdminiumVersion, m.compatibility.minAdminiumVersion) > 0;

const CAPS_MESSAGE = {
  message: 'hosted-only and offline-required are mutually exclusive',
  path: ['capabilities'] as const,
};
const WINDOW_MESSAGE = {
  message: 'maxAdminiumVersion must be greater than minAdminiumVersion',
  path: ['compatibility'] as const,
};

/**
 * At most one entry per side.
 *
 * Two `customer` frontends is not a richer app; it is an ambiguity — a
 * publishable key is minted against ONE side, so a second entry claiming the
 * same one leaves the installer and the key-minting UI with no way to say which
 * bundle a key belongs to.
 */
function sidesAreDistinct(m: { frontends: readonly { side: string }[] }): boolean {
  const seen = new Set<string>();
  for (const f of m.frontends) {
    if (seen.has(f.side)) return false;
    seen.add(f.side);
  }
  return true;
}

const SIDES_MESSAGE = {
  message: 'each side may appear at most once in `frontends`',
  path: ['frontends'] as const,
};

/** The prefix Adminium gives an app's tables: its key, `-` as `_`, then `_`. */
export function prefixFor(appKey: string): string {
  return `${appKey.replace(/-/g, '_')}_`;
}

/** The longest real table name every engine accepts (Postgres: 63 bytes). */
export const MAX_TABLE_NAME = 63;

/**
 * Every name a manifest's own blocks use must name something the manifest
 * declares: a rule's columns, a capacity's columns, a public table and the
 * columns it reads and writes. Checked here so an app's CI refuses a typo long
 * before an operator's install would.
 */
export function appReferenceIssues(m: {
  key: string;
  requiredSchema: { tables: readonly RequiredTableShape[]; prefixed?: true | undefined };
  publicAccess?: readonly PublicAccess[] | undefined;
  optionLists?: Readonly<Record<string, unknown>> | undefined;
}): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const tables = new Map(m.requiredSchema.tables.map((t) => [t.ref, t]));
  const has = (table: string, column: string): boolean =>
    tables.get(table)?.columns.some((c) => c.ref === column) ?? false;

  m.requiredSchema.tables.forEach((table, t) => {
    const at = (...rest: (string | number)[]) => ['requiredSchema', 'tables', t, ...rest];
    if (m.requiredSchema.prefixed === true && prefixFor(m.key).length + table.ref.length > MAX_TABLE_NAME) {
      out.push({ path: at('ref'), message: `"${prefixFor(m.key)}${table.ref}" is longer than ${String(MAX_TABLE_NAME)} characters` });
    }
    table.columns.forEach((column, c) => {
      const rules = column.rules;
      if (rules === undefined) return;
      const here = (...rest: string[]) => at('columns', c, 'rules', ...rest);
      // A list the app ships, or one Adminium has built in; nothing else exists
      // on every install.
      if (rules.options !== undefined && 'list' in rules.options) {
        const list = rules.options.list;
        if (!list.startsWith('builtin:') && m.optionLists?.[list] === undefined) {
          out.push({ path: here('options', 'list'), message: `"${list}" is not one of the app's option lists` });
        }
      }
      if (rules.copy !== undefined) {
        const via = table.columns.find((x) => x.ref === rules.copy!.via);
        if (via?.type !== 'fk' || via.references === undefined) {
          out.push({ path: here('copy', 'via'), message: `"${rules.copy.via}" is not a foreign key of "${table.ref}"` });
        } else if (!has(via.references, rules.copy.from)) {
          out.push({ path: here('copy', 'from'), message: `"${via.references}" has no column "${rules.copy.from}"` });
        }
      }
      if (rules.rollup !== undefined) {
        const r = rules.rollup;
        const child = tables.get(r.from);
        const via = child?.columns.find((x) => x.ref === r.via);
        if (child === undefined) {
          out.push({ path: here('rollup', 'from'), message: `"${r.from}" is not a table of this app` });
        } else if (via?.type !== 'fk' || via.references !== table.ref) {
          out.push({ path: here('rollup', 'via'), message: `"${r.from}.${r.via}" does not point at "${table.ref}"` });
        } else {
          for (const name of [r.sum, ...(r.times === undefined ? [] : [r.times]), ...(r.unlessSet === undefined ? [] : [r.unlessSet])]) {
            if (!has(r.from, name)) out.push({ path: here('rollup'), message: `"${r.from}" has no column "${name}"` });
          }
        }
      }
      if ((rules.sequence !== undefined || rules.code !== undefined) && column.role === 'pk') {
        out.push({ path: here(), message: 'a primary key numbers itself; it takes no sequence or code rule' });
      }
    });
    const cap = table.capacity;
    if (cap !== undefined) {
      for (const [name, value] of [['slot', cap.slot], ['amount', cap.amount], ['resource', cap.resource], ['countWhere', cap.countWhere?.column]] as const) {
        if (value !== undefined && !has(table.ref, value)) {
          out.push({ path: at('capacity', name), message: `"${table.ref}" has no column "${value}"` });
        }
      }
      for (const [name, value] of Object.entries(cap)) {
        if (typeof value === 'object' && value !== null && 'table' in value && 'column' in value) {
          const setting = value as { table: string; column: string };
          if (!has(setting.table, setting.column)) {
            out.push({ path: at('capacity', name), message: `"${setting.table}" has no column "${setting.column}"` });
          }
        }
      }
    }
  });

  (m.publicAccess ?? []).forEach((entry, i) => {
    const at = (...rest: (string | number)[]) => ['publicAccess', i, ...rest];
    const table = tables.get(entry.table);
    if (table === undefined) {
      out.push({ path: at('table'), message: `"${entry.table}" is not a table of this app` });
      return;
    }
    for (const list of ['select', 'writable'] as const) {
      for (const column of entry[list] ?? []) {
        if (!has(entry.table, column)) out.push({ path: at(list), message: `"${entry.table}" has no column "${column}"` });
      }
    }
    for (const column of [...(entry.claim?.match ?? []), ...(entry.filters ?? []).map((f) => f.column), ...Object.keys(entry.defaults ?? {})]) {
      if (!has(entry.table, column)) out.push({ path: at(), message: `"${entry.table}" has no column "${column}"` });
    }
    // A change to an existing row, from a browser, only behind a claim: the
    // guest reaches their own row and nothing else.
    if (entry.methods.includes('PATCH') && entry.claim === undefined) {
      out.push({ path: at('methods'), message: 'PATCH is allowed only with a claim' });
    }
    // Nothing a server decides may be written by a browser.
    for (const column of entry.writable ?? []) {
      const rules = table.columns.find((c) => c.ref === column)?.rules;
      if (rules?.copy !== undefined || rules?.sequence !== undefined || rules?.code !== undefined || rules?.rollup !== undefined) {
        out.push({ path: at('writable'), message: `"${column}" is decided by Adminium and cannot be written publicly` });
      }
    }
    if (entry.confirm !== undefined) {
      const c = entry.confirm;
      for (const [name, column] of [['to', c.to], ['code', c.code], ['when', c.when], ['party', c.party], ['name', c.name]] as const) {
        if (column !== undefined && !has(entry.table, column)) out.push({ path: at('confirm', name), message: `"${entry.table}" has no column "${column}"` });
      }
      if (!entry.methods.includes('POST')) out.push({ path: at('confirm'), message: 'a confirmation is sent on a create, and this entry creates nothing' });
      if (c.venue !== undefined) {
        if (!tables.has(c.venue.table)) {
          out.push({ path: at('confirm', 'venue', 'table'), message: `"${c.venue.table}" is not a table of this app` });
        } else {
          for (const [name, column] of [['name', c.venue.name], ['address', c.venue.address], ['phone', c.venue.phone]] as const) {
            if (column !== undefined && !has(c.venue.table, column)) {
              out.push({ path: at('confirm', 'venue', name), message: `"${c.venue.table}" has no column "${column}"` });
            }
          }
        }
      }
    }
    if (entry.kind === 'availability') {
      if (table.capacity === undefined) out.push({ path: at('kind'), message: `"${entry.table}" declares no capacity to answer from` });
      if (entry.methods.some((method) => method !== 'GET')) out.push({ path: at('methods'), message: 'availability is read-only' });
    }
  });
  return out;
}

/** What `appReferenceIssues` reads of a table. */
interface RequiredTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    references?: string | undefined;
    rules?: ColumnRules | undefined;
  }[];
  capacity?: z.infer<typeof capacitySchema> | undefined;
}

export const appManifestSchema = z
  .object({
    kind: z.literal('app'),
    manifestVersion: z.literal(MANIFEST_VERSION),
    ...identitySchema.shape,
    compatibility: compatibilitySchema,
    requiredSchema: requiredSchemaSchema,
    pages: z.array(pageSchema).min(1),
    roles: z.array(roleSchema).optional(),
    settings: z.array(settingSchema).optional(),
    seeds: z.array(seedSchema).optional(),
    widgets: z.array(manifestWidgetSchema).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    /**
     * ONE OR MORE SIDES. Replaces the singular `frontend`.
     *
     * `minItems: 1` is the gate: a manifest declaring no side does not validate,
     * which is what turns "dashboard mandatory, staff optional, customer
     * optional, at least one" from a slogan into something CI can hold. Two
     * repos (factory-ops, hotel-reservations) could never validate under the old
     * required-singular shape however their `requiredSchema` was repaired.
     */
    frontends: z.array(frontendSchema).min(1),
    navGroups: z.array(navGroupSchema).max(12).optional(),
    /** Keyed by a kebab-case name; a column names one with `options: {list: name}`. */
    optionLists: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'a list name is kebab-case'), optionListSchema).optional(),
    publicAccess: z.array(publicAccessSchema).max(32).optional(),
    sampleData: sampleDataSchema.optional(),
  })
  .strict()
  .refine(capabilitiesNotContradictory, { ...CAPS_MESSAGE, path: [...CAPS_MESSAGE.path] })
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] })
  .refine(sidesAreDistinct, { ...SIDES_MESSAGE, path: [...SIDES_MESSAGE.path] })
  .superRefine((m, ctx) => {
    for (const issue of appReferenceIssues(m)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

/**
 * `pages`, `roles` and `frontends` are absent from this branch on purpose, and
 * leaving the fields off a `.strict()` schema entirely is a stronger guarantee
 * than a lint rule.
 *
 * WHAT CHANGED, AND WHAT DID NOT. An add-on may now own a dashboard page — but
 * it declares that page as CODE, inside `addOn.pages`, never as a `pages` entry
 * up here. The two are
 * different things wearing one word: a `pages` row is a generated page, a
 * `template` the engine renders with `bindings` and `config`, and an add-on
 * still cannot install one. Roles and frontends remain refused outright.
 *
 * So the absence of `pages` from this object is no longer "an add-on has no
 * pages". It is "an add-on's pages are not the engine's page templates", which
 * is a narrower promise and the one this shape actually keeps.
 */
export const addOnManifestSchema = z
  .object({
    kind: z.literal('add-on'),
    manifestVersion: z.literal(MANIFEST_VERSION),
    ...identityShape,
    categories: z.array(addOnCategorySchema).min(1),
    compatibility: compatibilitySchema,
    addOn: addOnBlockSchema,
    // An add-on may bring its own tables — kept on disconnect (D16).
    requiredSchema: requiredSchemaSchema.optional(),
    settings: z.array(settingSchema).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    widgets: z.array(manifestWidgetSchema).optional(),
  })
  .strict()
  .refine(capabilitiesNotContradictory, { ...CAPS_MESSAGE, path: [...CAPS_MESSAGE.path] })
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] })
  .refine((m) => m.requiredSchema?.prefixed !== true, {
    message: 'an add-on uses its host app\'s tables, so its own cannot be prefixed',
    path: ['requiredSchema', 'prefixed'],
  });

/**
 * The envelope. A document with no `kind` is treated as an app before the union
 * discriminates, which is what keeps every pre-wave-4 manifest valid.
 */
export const manifestSchema = z.preprocess(
  (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).kind === undefined
      ? { ...(v as Record<string, unknown>), kind: 'app' }
      : v,
  z.discriminatedUnion('kind', [appManifestSchema, addOnManifestSchema]),
);

export type AppManifest = z.infer<typeof appManifestSchema>;
export type AddOnManifest = z.infer<typeof addOnManifestSchema>;

/** One table an add-on declares under `requiredSchema`. */
export type RequiredTable = z.infer<typeof requiredTableSchema>;
/** One column of a {@link RequiredTable}. */
export type RequiredColumn = z.infer<typeof requiredColumnSchema>;
export type Manifest = AppManifest | AddOnManifest;

export type { AddOnBlock };

/** Narrowing helper — the discriminant is the only thing worth branching on. */
export function isAddOnManifest(m: Manifest): m is AddOnManifest {
  return m.kind === 'add-on';
}

/**
 * Cross-block rules the envelope cannot express, each with its issue
 * code. Runs only for `kind: "add-on"`; returns [] for an app.
 */
export function addOnIssues(
  m: Manifest,
  ctx: {
    /** Installed app keys, so `attaches` can be checked. Omit to skip. */
    knownAppKeys?: readonly string[];
    /** The host app's `requiredSchema` table refs. Omit to skip the scope check. */
    hostTables?: readonly string[];
  } = {},
): { code: string; path: string; message: string }[] {
  if (!isAddOnManifest(m)) return [];
  const out: { code: string; path: string; message: string }[] = [];
  const block = m.addOn;

  // ATTACH_TARGET_UNKNOWN — every target is a known app key or "*".
  if (ctx.knownAppKeys !== undefined) {
    block.attaches.forEach((target, i) => {
      if (target.app !== '*' && !ctx.knownAppKeys!.includes(target.app)) {
        out.push({
          code: 'ATTACH_TARGET_UNKNOWN',
          path: `addOn.attaches.${i}.app`,
          message: `attaches to an unknown app key "${target.app}"`,
        });
      }
    });
  }

  // SLOT_UNKNOWN — belt and braces; the schema enum already refuses these.
  (block.slots ?? []).forEach((fill, i) => {
    if (!isSlotId(fill.slot)) {
      out.push({
        code: 'SLOT_UNKNOWN',
        path: `addOn.slots.${i}.slot`,
        message: `"${fill.slot}" is not in the closed slot registry`,
      });
    }
  });

  /*
   * THERE IS NO NAV_GROUP_UNKNOWN CHECK HERE, AND THAT IS DELIBERATE.
   *
   * A page whose group is neither built in nor declared is refused by
   * `addOnBlockSchema` itself, and these cross-block rules run only on a
   * manifest that has already parsed — so a check here could never fire. It was
   * written, and removed once its own test proved it unreachable: the refusal
   * arrived as a schema issue with no code.
   *
   * SLOT_UNKNOWN above is the same shape and is kept, labelled "belt and
   * braces". One unreachable branch is not a reason for a second: this
   * repository has shipped four features that passed every test and could not
   * be called, and a validator branch nobody can reach is where that starts.
   */

  // SCOPE_OUT_OF_RANGE — a `records:<table>:<verb>` scope must name a table this
  // add-on can actually reach: one of the host app's, or one of its own.
  const reachable = new Set<string>([
    ...(m.requiredSchema?.tables ?? []).map((t) => t.ref),
    ...(ctx.hostTables ?? []),
  ]);
  (block.scopes ?? []).forEach((scope, i) => {
    const [domain, table] = scope.split(':');
    if (domain !== 'records') return;
    if (table === undefined || table.length === 0) {
      out.push({
        code: 'SCOPE_OUT_OF_RANGE',
        path: `addOn.scopes.${i}`,
        message: `"${scope}" names no table`,
      });
      return;
    }
    if (ctx.hostTables !== undefined && !reachable.has(table)) {
      out.push({
        code: 'SCOPE_OUT_OF_RANGE',
        path: `addOn.scopes.${i}`,
        message: `"${scope}" reaches a table neither the host app nor this add-on declares`,
      });
    }
  });

  // NETWORK_ALLOW_REQUIRED — outbound-http without an allow-list is a hole.
  const wantsHttp = m.capabilities?.includes('outbound-http') ?? false;
  if (wantsHttp && (block.network?.allow.length ?? 0) === 0) {
    out.push({
      code: 'NETWORK_ALLOW_REQUIRED',
      path: 'addOn.network.allow',
      message: 'outbound-http requires a non-empty allow-list of exact https hostnames',
    });
  }

  // CAPABILITY_CONFLICT — an oauth2 connect needs the capability that runs it.
  if (block.connect.kind === 'oauth2' && !(m.capabilities?.includes('oauth-connect') ?? false)) {
    out.push({
      code: 'CAPABILITY_CONFLICT',
      path: 'capabilities',
      message: 'connect.kind "oauth2" requires the oauth-connect capability',
    });
  }

  // FRONTEND_SECRET_LEAK — publicSettings may never name a secret setting.
  const secrets = new Set((m.settings ?? []).filter((s) => s.secret === true).map((s) => s.key));
  (block.publicSettings ?? []).forEach((key, i) => {
    if (secrets.has(key)) {
      out.push({
        code: 'FRONTEND_SECRET_LEAK',
        path: `addOn.publicSettings.${i}`,
        message: `"${key}" is marked secret and must never reach the client bundle`,
      });
    }
  });

  return out;
}

/**
 * Numeric semver compare on the release triple (pre-release/build ignored —
 * enough for the compatibility-window and upgrade ordering checks). Returns
 * <0, 0, >0. Exported for the installer's upgrade rule.
 */
export function compareSemver(a: string, b: string): number {
  const triple = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const [a1 = 0, a2 = 0, a3 = 0] = triple(a);
  const [b1 = 0, b2 = 0, b3 = 0] = triple(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}
