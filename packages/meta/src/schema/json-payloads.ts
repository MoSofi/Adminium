// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the JSON payloads stored in adminium_* json columns.
 * Repos validate every JSON write against these — an invalid payload
 * never reaches the database (acceptance #7).
 *
 * Page config (`adminium_pages.config`) is deliberately opaque here: the
 * envelope schema is owned by `@adminium/engine/config` and validated at the
 * server route layer; `pagesRepo` persists already-validated JSON.
 */

import { z } from 'zod';

// --- shared -----------------------------------------------------------------

/** A soft reference to a source record — never a cross-boundary FK. */
export const recordRefSchema = z.object({
  connectionId: z.string(),
  /** Qualified source name, e.g. `public.orders`. */
  table: z.string(),
  /** Full PK map — supports composite keys. */
  pk: z.record(z.string(), z.unknown()),
  /** Display snapshot taken at write time. */
  label: z.string(),
});
export type RecordRef = z.infer<typeof recordRefSchema>;

/**
 * Width of the denormalized `adminium_audit_log.entity_table` / `entity_id`
 * columns (WS-A). 200 chars keeps the composite index inside MySQL's
 * 3072-byte InnoDB cap under utf8mb4 (2 × 200 × 4 + 8).
 */
export const AUDIT_ENTITY_KEY_MAX = 200;

/**
 * Canonical clamp for one audit entity key part. Applied on the WRITE side
 * (append + backfill) and again on the QUERY side, so an over-long id still
 * matches the row it wrote — truncation is consistent, never one-sided.
 */
export function auditEntityKeyPart(value: string): string {
  return value.length > AUDIT_ENTITY_KEY_MAX ? value.slice(0, AUDIT_ENTITY_KEY_MAX) : value;
}

/**
 * The denormalized per-record audit key derived from a RecordRef (30 WS-A).
 *
 * `entityId` reproduces the canonical `:recordId` string both sides already
 * use — `pkLabel` on the server, `rowIdOf` in the grid: a single-column PK is
 * its stringified value, a composite PK is the JSON tuple of its values in pk
 * insertion order (the order both writers build the map in).
 */
export function auditEntityKeyOf(ref: Pick<RecordRef, 'table' | 'pk'>): {
  entityTable: string;
  entityId: string;
} {
  const values = Object.values(ref.pk);
  const id = values.length === 1 ? String(values[0]) : JSON.stringify(values);
  return { entityTable: auditEntityKeyPart(ref.table), entityId: auditEntityKeyPart(id) };
}

/** The eight COMPILED locales. Still a closed set — see `builtinLocaleSchema`. */
export const LOCALES = ['en_US', 'de_DE', 'ar_EG', 'zh_CN', 'zh_TW', 'cs_CZ', 'da_DK', 'fr_FR'] as const;
export const builtinLocaleSchema = z.enum(LOCALES);
export type BuiltinLocale = z.infer<typeof builtinLocaleSchema>;

/** Canonical locale-id shape — mirrors `LOCALE_ID_RE` in `@adminium/i18n`. */
export const LOCALE_ID_RE = /^[a-z]{2,3}(_[A-Za-z0-9]{2,8}){0,2}$/;

/**
 * A locale id. SHAPE only: once admins can create locales, a stored id is not
 * drawn from a closed set and an enum here would reject every custom locale
 * at the persistence boundary.
 *
 * Widening this removes the only existence check that used to be free, so
 * EXISTENCE is now a contextual check the callers must make — and they must
 * make it on the config-bundle IMPORT path too, not only on the routes:
 * `settings['locale.default']` is `portable: true`, so a bundle exported from
 * an instance with a custom locale would otherwise set every user's effective
 * locale to an id that has no row and no bundle on the target instance.
 */
export const localeSchema = z.string().min(2).max(35).regex(LOCALE_ID_RE);
export type Locale = z.infer<typeof localeSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const accentSchema = z.enum(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);
export const densitySchema = z.enum(['comfortable', 'compact']);
export const dirSchema = z.enum(['ltr', 'rtl']);

// --- users / prefs ----------------------------------------------

export const userStatusSchema = z.enum(['active', 'invited', 'suspended']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Array of argon2id hashes. */
export const recoveryCodesSchema = z.array(z.string());

/** Non-theming client state: sidebar collapse, last-visited page, dismissed hints. */
export const uiStateSchema = z.record(z.string(), z.unknown());

// --- rbac --------------------------------------------------------------

export const resourceKindSchema = z.enum(['table', 'page', 'system']);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

export const tableActionsSchema = z.object({
  read: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
  export: z.boolean(),
  import: z.boolean(),
});
export type TableActions = z.infer<typeof tableActionsSchema>;

export const pageActionsSchema = z.object({
  view: z.boolean(),
  edit: z.boolean(),
});
export type PageActions = z.infer<typeof pageActionsSchema>;

/** resource_ref IS the action; the value is a single grant. */
export const systemActionsSchema = z.object({
  allowed: z.boolean(),
});
export type SystemActions = z.infer<typeof systemActionsSchema>;

export type PermissionActions = TableActions | PageActions | SystemActions;

/** v1 closed set of system action keys, extended per milestone. */
export const SYSTEM_ACTION_KEYS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'connections.manage',
  'schema.remap',
  'llm.run',
  'automations.manage', // rules + runs — gates BOTH pages, every rule write and every run read
  'webhooks.manage', // reserved — deferred feature, no v1 enforcement (RESERVED_SYSTEM_ACTION_KEYS)
  'api-keys.manage',
  'manifests.manage', // add-on + micro-SaaS install/connect/uninstall
  'audit.read',
  'sql.run', // reserved — deferred feature, no v1 enforcement (RESERVED_SYSTEM_ACTION_KEYS)
  // M7 wave 2 — data-io (T5) + scheduled reports (T6). `exports.manage` /
  // `imports.manage` gate seeing/downloading OTHER users' artifacts (lists are
  // mine-only without them); `reports.manage` gates the scheduled-reports
  // admin verbs. Email templates deliberately add NO key: PUT rides the
  // existing `settings.manage` (T6 supersedes the builders track's assumption)
  // — and campaigns ride it too.
  'exports.manage',
  'imports.manage',
  'reports.manage',
  // Jobs visibility/management: `jobs.read` gates GET /jobs and
  // reading/subscribing to OTHER users' jobs (owners always see their own via
  // the payload.userId convention); `jobs.manage` gates POST /jobs and
  // cancelling other users' jobs. Enforced by routes/jobs and the realtime
  // hub's jobs:<id> channel authorizer.
  'jobs.read',
  'jobs.manage',
  // Page lifecycle: create/rename/retemplate/duplicate/delete a page
  // and reorder the sidebar, via Studio → Pages. Distinct from the per-page
  // `page:<id>:edit` grant, which authorizes editing ONE page's stored layout
  // and is what `canEditLayout` reports; this one authorizes changing which
  // pages exist at all, so it is workspace-scoped rather than page-scoped.
  'pages.manage',
  // Schema authoring: create, alter, rename and
  // drop tables, columns and foreign keys on a connected database. Deliberately
  // NOT `schema.remap`, which changes only what Adminium displays and is undone
  // by deleting a row; this one changes the customer's database and is not.
  // Destructive steps additionally require Super Admin, the same
  // asymmetry the PII-unmask guard already enforces.
  'schema.ddl',
  // Files & storage. TWO keys, not one, and
  // neither is `settings.manage`:
  //
  //   `files.manage` is about OTHER PEOPLE'S FILES — seeing them, downloading
  //   them, restoring and deleting them, emptying the trash, the Files page.
  //   Without it a list is mine-only, exactly as `exports.manage` works. It is
  //   NOT what authorises uploading: that is the entity table's own
  //   create/update grant (D11), because a file attached to a record is that
  //   record's data and inherits its authority.
  //
  //   `storage.manage` is about WHERE BYTES LIVE — creating a destination,
  //   testing it, making it the default, moving files between destinations.
  //   That is infrastructure with a credential attached, and an admin who may
  //   tidy up other people's uploads has no business pointing the whole
  //   instance's storage at a bucket they control.
  'files.manage',
  'storage.manage',
  // Project folders: reading what a server changed so a developer can pull it
  // into the project (`GET /project/export`, the `pull --from` source). Read
  // only, but it reads every page and schema customization at once, which is
  // why it is a key of its own rather than riding `pages.manage`.
  'project.read',
] as const;
export type SystemActionKey = (typeof SYSTEM_ACTION_KEYS)[number];
export const systemActionKeySchema = z.enum(SYSTEM_ACTION_KEYS);

/**
 * Reserved keys — deferred features (automations, webhooks, manifest
 * administration, raw-SQL console; deferred per the v1-free pivot) with ZERO
 * enforcement points in v1: no route or realtime authorizer checks them. They
 * stay in {@link SYSTEM_ACTION_KEYS} because the grammar is a closed set that
 * stored grants round-trip through (removing a key would orphan persisted
 * `adminium_role_permissions` rows and break forward-compat), but no
 * permissions UI may OFFER them — letting an admin grant a key nothing checks
 * is misleading security UI. Author grantable lists from {@link
 * GRANTABLE_SYSTEM_ACTION_KEYS}; move a key out of here in the same change
 * that lands its first enforcement point.
 */
export const RESERVED_SYSTEM_ACTION_KEYS = [
  'webhooks.manage',
  // `manifests.manage` UN-RESERVED 2026-08-29
  // in the same change that landed its first enforcement point — the
  // `/api/v1/add-ons` routes. `automations.manage` UN-RESERVED 2026-09-08
  // in the same change that
  // landed ITS first enforcement point — the `/api/v1/automations` and
  // `/api/v1/automation-runs` routes. That is the rule this list documents,
  // honoured rather than quoted: a key becomes grantable when something checks
  // it, and not one commit earlier.
  'sql.run',
] as const satisfies readonly SystemActionKey[];
export type ReservedSystemActionKey = (typeof RESERVED_SYSTEM_ACTION_KEYS)[number];

/**
 * What a role editor / permissions surface may offer: the closed set minus
 * {@link RESERVED_SYSTEM_ACTION_KEYS}. Derived, so the two lists cannot
 * drift. (No dashboard roles page exists yet — apps/dashboard has no
 * `@adminium/meta` dependency — so when that page or its catalog endpoint
 * lands, THIS is the list it must be fed, not `SYSTEM_ACTION_KEYS`.)
 */
export const GRANTABLE_SYSTEM_ACTION_KEYS: readonly Exclude<
  SystemActionKey,
  ReservedSystemActionKey
>[] = SYSTEM_ACTION_KEYS.filter(
  (key): key is Exclude<SystemActionKey, ReservedSystemActionKey> =>
    !(RESERVED_SYSTEM_ACTION_KEYS as readonly string[]).includes(key),
);

export function permissionActionsSchemaFor(kind: ResourceKind): z.ZodType<PermissionActions> {
  switch (kind) {
    case 'table':
      return tableActionsSchema;
    case 'page':
      return pageActionsSchema;
    case 'system':
      return systemActionsSchema;
  }
}

// --- audit -------------------------------------------------------------

export const actorKindSchema = z.enum(['user', 'api-key', 'system', 'automation']);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const auditCategorySchema = z.enum([
  'auth',
  'data',
  'schema',
  'settings',
  'rbac',
  'connection',
  'llm',
  'automation',
  'export',
  'system',
  // Add-on acquisition and lifecycle: catalog
  // refresh, download, verify- and unpack-refusals, upload, staged, deleted,
  // upgraded. Its own category rather than a `system` action because an add-on
  // ships a server half that runs in-process — "what code arrived on
  // this deployment, from where, and did anything refuse it" is the question an
  // operator asks on its own, and it should not have to be sieved out of the
  // system log.
  'add-on',
  // Installing a micro-SaaS app: staged, installed,
  // uninstalled, and the two refusals. Its own category on the same argument
  // the add-on one is made on — an app surface is served at the dashboard's own
  // origin, inside the session boundary, so "what code arrived on this
  // deployment, from where, and did anything refuse it" is asked of apps too.
  'app',
]);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

/** `{ before, after }` images; PII-masked upstream; capped at 16 KB serialized. */
export const auditChangesSchema = z.object({
  before: z.record(z.string(), z.unknown()).nullish(),
  after: z.record(z.string(), z.unknown()).nullish(),
  _truncated: z.literal(true).optional(),
});
export type AuditChanges = z.infer<typeof auditChangesSchema>;

/** Serialized-size cap for `adminium_audit_log.changes`. */
export const AUDIT_CHANGES_MAX_BYTES = 16 * 1024;

// --- jobs ---------------------------------------------------------------

export const jobStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Kind-specific; the worker validates the concrete shape. */
export const jobPayloadSchema = z.record(z.string(), z.unknown());

// --- connections ---------------------------------------------------------

export const connectionEngineSchema = z.enum(['postgres', 'mysql', 'sqlite']);
export const connectionSourceKindSchema = z.enum(['dsn', 'schema-file']);
export const connectionStatusSchema = z.enum(['unconfigured', 'connected', 'error']);

export const connectionSslSchema = z.object({
  mode: z.enum(['require', 'verify-full', 'disable']),
  caFileId: z.string().nullish(),
});

export const connectionSettingsSchema = z.object({
  includedTables: z.array(z.string()).optional(),
  intent: z.enum(['full-admin', 'read-only-analytics', 'crud', 'support-console']).optional(),
  highVolumeUnchecked: z.boolean().optional(),
  placeholderRows: z.boolean().optional(),
});
export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;

// --- schema overrides: one row = one op ----------------------------------

const toneSchema = z.string();

export const overridePatchSchema = z.discriminatedUnion('op', [
  // Labels are min(1): the engine's `TableModel.label` forbids '' and an empty
  // rename is meaningless (the remap UI drops the op instead of staging '').
  // Rejecting at write time keeps last-write-wins + user>llm provenance
  // free of empty-string special cases on the read path.
  z.object({
    op: z.literal('table.label'),
    value: z.object({
      label: z.string().min(1),
      labelPlural: z.string().optional(),
      icon: z.string().optional(),
    }),
  }),
  z.object({ op: z.literal('table.exclude'), value: z.object({ excluded: z.boolean() }) }),
  z.object({ op: z.literal('table.keyField'), value: z.object({ column: z.string() }) }),
  z.object({ op: z.literal('column.label'), value: z.object({ label: z.string().min(1) }) }),
  z.object({
    op: z.literal('column.semanticType'),
    value: z.object({ semanticType: z.string(), currency: z.string().optional() }),
  }),
  z.object({
    op: z.literal('column.enumLabels'),
    value: z.object({
      labels: z.record(z.string(), z.string()),
      tones: z.record(z.string(), toneSchema).optional(),
    }),
  }),
  z.object({
    op: z.literal('column.pii'),
    value: z.object({ masked: z.boolean(), kind: z.string().optional() }),
  }),
  z.object({ op: z.literal('column.hidden'), value: z.object({ hidden: z.boolean() }) }),
  /*
   * ─── The four column RULES ───────────────────────────────────────────────
   *
   * An override row is `(op, value)` with `value` as JSON, so these need no
   * migration — the store has carried arbitrary ops since 0003. What they are
   * NOT is display: every other `column.*` op changes what a reader sees, and
   * these four change what the WRITE PATH does. That is why they are enforced
   * inside `crud/write-service.ts` rather than by the form, and why the
   * dialog, a CSV import, an automation and the public API all obey them.
   */
  z.object({
    op: z.literal('column.default'),
    value: z.object({
      /**
       * `database` and `none` store no value and exist to be SAID: `database`
       * is "a trigger or an expression fills this, leave it alone" and `none`
       * switches an implicit fill off (D14). Both are settings, not values.
       */
      kind: z.enum(['now', 'uuid', 'literal', 'current-user', 'database', 'none']),
      /** `literal` only. */
      text: z.string().max(1024).optional(),
      /** `current-user` only. */
      userField: z.enum(['id', 'name']).optional(),
      /** Fill on an update too — an `updated_at`. */
      onUpdate: z.boolean().optional(),
    }),
  }),
  z.object({
    op: z.literal('column.options'),
    /*
     * Either a named list (phase F's store, referenced BY KEY so a project file
     * carries it) or the values themselves. 500 is the ceiling because a list
     * longer than that is a lookup table, and the form says so.
     */
    value: z.union([
      z.object({ list: z.string().min(1).max(120) }),
      z.object({
        values: z
          .array(
            z.object({
              value: z.string().min(1).max(256),
              label: z.string().max(256).optional(),
              tone: toneSchema.optional(),
              description: z.string().max(512).optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    ]),
  }),
  /*
   * `required: true` only. "Not required" is the absence of the row, not a
   * row saying false: a stored `false` would read as "this column is optional",
   * which is a claim about the DATABASE that an override cannot make — the
   * column's own NOT NULL still decides.
   */
  z.object({ op: z.literal('column.required'), value: z.object({ required: z.literal(true) }) }),
  z.object({
    op: z.literal('column.validation'),
    value: z.object({
      format: z.enum(['email', 'url', 'phone']).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    op: z.literal('relation.add'),
    value: z.object({
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
      cardinality: z.enum(['many-to-one', 'one-to-one', 'one-to-many', 'many-to-many']),
    }),
  }),
  z.object({
    op: z.literal('relation.remove'),
    value: z.object({ fromColumn: z.string(), toTable: z.string() }),
  }),
  z.object({
    op: z.literal('relation.label'),
    value: z.object({ fromColumn: z.string(), label: z.string() }),
  }),
]);
export type OverridePatch = z.infer<typeof overridePatchSchema>;
export type OverrideOp = OverridePatch['op'];

/**
 * Provenance of an override row. The order is user > llm > heuristic, but
 * only the first two were ever representable — so the introspector's
 * auto-proposed PII masks were stored as `user`, and the LLM apply's
 * user-lock ("a user edit is never superseded") then made every machine guess
 * permanently uncorrectable. `auto` is that third tier: a proposal the engine
 * made, which an LLM apply may supersede and a user edit still outranks.
 *
 * Stored in a `varchar(6)` column (0003), which is why this is `auto` and not
 * the spec's longer word.
 */
export const overrideOriginSchema = z.enum(['user', 'llm', 'auto']);
export const overrideStatusSchema = z.enum(['active', 'disabled']);

// --- pages -----------------------------------------------------------

export const pageOriginSchema = z.enum(['generated', 'user', 'manifest', 'system', 'llm']);
export const navGroupSchema = z.enum(['workspace', 'library', 'planning', 'people', 'account']);

/**
 * Opaque: envelope validation is owned by `@adminium/engine/config` and runs
 * at the server route layer before the repo is called.
 */
export const pageConfigSchema = z.record(z.string(), z.unknown());

/** Saved-view payload. */
export const viewConfigSchema = z.object({
  filters: z.array(z.unknown()).optional(),
  sort: z.unknown().optional(),
  visibleColumns: z.array(z.string()).optional(),
  grouping: z.unknown().nullish(),
  widgetState: z.record(z.string(), z.unknown()).optional(),
});

// --- notifications ----------------------------------------------------

export const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

// --- llm runs -----------------------------------------

export const llmRunModeSchema = z.enum(['provider', 'byo']);

/**
 * `validation_status` — the outcome of the LAST response validation, kept from
 * 0006 as a secondary signal (drives the "some suggestions dropped" hint in the
 * run-history UI). Orthogonal to the run-lifecycle `status` machine below, which
 * 0007 adds as the authoritative state.
 */
export const llmValidationStatusSchema = z.enum(['pending', 'valid', 'partial', 'invalid']);

/**
 * `status` — the authoritative run-lifecycle machine. Transitions (enforced
 * by the server run-service, not the repo): draft → running |
 * awaiting_response running | awaiting_response → validated | failed |
 * discarded validated → applied | partially_applied | discarded applied |
 * partially_applied | failed | discarded → (terminal, immutable)
 */
export const llmRunStatusSchema = z.enum([
  'draft',
  'running',
  'awaiting_response',
  'validated',
  'applied',
  'partially_applied',
  'failed',
  'discarded',
]);
export type LlmRunStatus = z.infer<typeof llmRunStatusSchema>;

/** Builder inputs echoed onto the run — opaque here, validated upstream by
 * `buildPrompt`. */
export const llmRunSectionsSchema = z.array(z.string());
export const llmRunLocalesSchema = z.array(z.string()).min(1);
export const llmRunSamplingSchema = z
  .object({ maxValuesPerColumn: z.number().int().positive() })
  .nullable();

/** `review` — accepted/rejected suggestion-id lists persisted across re-review.
 * */
export const llmRunReviewSchema = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
});
export type LlmRunReview = z.infer<typeof llmRunReviewSchema>;

// --- automations ---------------

/**
 * A rule's stored shape is deliberately PERMISSIVE about completeness and
 * strict about structure.
 *
 * The step picker inserts a node before anyone has said which template it
 * sends or which table it writes, and that half-built rule has to survive a
 * save — the whole point of explicit save (D11) is that a person can put a
 * flow down and come back to it. So every setting an action needs is
 * nullable here, and "is this rule complete enough to switch on?" is a
 * SEPARATE predicate (`automationValidation.ts` on the server,
 * `model/validate.ts` in the dashboard) that the enable path runs and the
 * save path does not.
 *
 * What IS enforced here is shape that no later check could recover from:
 * one trigger, first; no branch inside a branch; unique node ids; the node
 * ceiling; a wait inside its bounds; an operator whose operand shape matches.
 */

/** Units a wait, a relative-time operand and the comp's DELAY node all share. */
export const automationDurationUnitSchema = z.enum(['minutes', 'hours', 'days']);
export type AutomationDurationUnit = z.infer<typeof automationDurationUnitSchema>;

const UNIT_MS: Record<AutomationDurationUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** Milliseconds for `{ amount, unit }` — one arithmetic, shared by waits and relative ops. */
export function automationDurationMs(amount: number, unit: AutomationDurationUnit): number {
  return amount * UNIT_MS[unit];
}

/** A wait may not exceed 30 days — longer than an operator can see in the Jobs
 * list. */
export const AUTOMATION_MAX_WAIT_MS = 30 * UNIT_MS.days;

/** Nodes per rule, branch children included. */
export const AUTOMATION_MAX_NODES = 40;

/**
 * The comp's five operators (Automation Rules 128-134), plus emptiness and
 * the four relative-time ops a schedule scan needs. Relative ops exist only
 * on date/time columns; the server refuses one on any other column, because
 * only a date column has bounds to compute.
 */
export const automationConditionOpSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'gt',
  'lt',
  'is_empty',
  'not_empty',
  'within_next',
  'within_last',
  'more_than_ago',
  'more_than_ahead',
]);
export type AutomationConditionOp = z.infer<typeof automationConditionOpSchema>;

const RELATIVE_OPS = ['within_next', 'within_last', 'more_than_ago', 'more_than_ahead'] as const;
const NO_OPERAND_OPS = ['is_empty', 'not_empty'] as const;
/** A count is a number: `contains` and the relative ops are meaningless on one.
 * */
const COUNT_OPS = ['is', 'is_not', 'gt', 'lt'] as const;

export function isRelativeAutomationOp(op: AutomationConditionOp): boolean {
  return (RELATIVE_OPS as readonly string[]).includes(op);
}

/** `{ amount: 2, unit: 'hours' }` — the operand of a relative-time op. 3650 days caps it at a decade. */
export const automationRelativeOperandSchema = z.object({
  amount: z.number().int().min(1).max(3650),
  unit: automationDurationUnitSchema,
});
export type AutomationRelativeOperand = z.infer<typeof automationRelativeOperandSchema>;

const automationOperandSchema = z.union([
  z.string().max(2000),
  z.number(),
  automationRelativeOperandSchema,
]);

/** A column of the record being processed. Empty = the person has not chosen one yet. */
const automationFieldLeftSchema = z.object({ field: z.string().max(128) });

/**
 * FILL F5 — "related records": count the rows of `<table>` whose
 * `<matchColumn>` equals this record's `<equalsField>`, optionally narrowed
 * by one more leaf. This is the owner's "has this customer missed an
 * appointment before?" and "did they claim the offer?", and it is the only
 * shape of related-record question v1 answers — which is why `where` is ONE
 * leaf and not a list: a second one has never been needed by an example, and
 * an unbounded nest here would need its own editor.
 */
const automationCountLeafSchema = z.object({
  left: automationFieldLeftSchema,
  op: automationConditionOpSchema,
  right: automationOperandSchema.optional(),
});

const automationCountLeftSchema = z.object({
  count: z.object({
    table: z.string().max(200),
    /** The column on the counted table. */
    matchColumn: z.string().max(128),
    /** The column on THIS record it must equal. */
    equalsField: z.string().max(128),
    where: automationCountLeafSchema.optional(),
  }),
});

function refineOperandShape(
  condition: { left: unknown; op: AutomationConditionOp; right?: unknown },
  ctx: z.RefinementCtx,
): void {
  const { op, right } = condition;
  if ((NO_OPERAND_OPS as readonly string[]).includes(op)) {
    if (right !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['right'], message: `${op} takes no value` });
    }
    return;
  }
  // `undefined` is "not filled in yet", which a draft is allowed to be.
  if (right === undefined) return;
  const relative = isRelativeAutomationOp(op);
  const isOperandObject = typeof right === 'object' && right !== null;
  if (relative && !isOperandObject) {
    ctx.addIssue({ code: 'custom', path: ['right'], message: `${op} needs an amount and a unit` });
  }
  if (!relative && isOperandObject) {
    ctx.addIssue({ code: 'custom', path: ['right'], message: `${op} needs a plain value` });
  }
}

export const automationConditionSchema = z
  .object({
    left: z.union([automationFieldLeftSchema, automationCountLeftSchema]),
    op: automationConditionOpSchema,
    right: automationOperandSchema.optional(),
  })
  .superRefine((condition, ctx) => {
    refineOperandShape(condition, ctx);
    if ('count' in condition.left) {
      if (!(COUNT_OPS as readonly string[]).includes(condition.op)) {
        ctx.addIssue({ code: 'custom', path: ['op'], message: `${condition.op} cannot compare a count` });
      }
      const nested = condition.left.count.where;
      if (nested) refineOperandShape(nested, ctx);
    }
  });
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

// --- the trigger ------------------------------------------------------------

export const automationRecordEventSchema = z.enum(['created', 'updated', 'deleted']);
export type AutomationRecordEvent = z.infer<typeof automationRecordEventSchema>;

/** The interval kinds the trigger inspector offers, as strings so the select round-trips. */
export const automationIntervalSchema = z.enum(['5', '10', '15', '30', '60']);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), everyMinutes: automationIntervalSchema }),
  z.object({
    kind: z.enum(['daily', 'weekly', 'monthly']),
    time: z.string().regex(HHMM),
    /** 0 = Sunday; weekly only. */
    dayOfWeek: z.number().int().min(0).max(6).nullish(),
    /** 1-28 only — no rule may silently skip February (the reports precedent). */
    dayOfMonth: z.number().int().min(1).max(28).nullish(),
    timezone: z.string().max(64),
  }),
]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

/**
 * FILL F1 — the comp draws domain triggers ("A user signs up", "Payment
 * fails") that no product primitive can produce. What Adminium actually
 * observes is a record write and a clock, so those are the two kinds; the
 * sign-up example becomes "a record is created in users", and `watch` (D4)
 * is what makes that true for rows the customer's own app wrote.
 */
export const automationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('record'),
    event: automationRecordEventSchema,
    connectionId: z.string(),
    table: z.string().max(200),
    /** D4 — also poll for rows written outside Adminium. Ignored for `deleted` (no tombstones). */
    watch: z.boolean().default(true),
    /** `updated` only: fire only when THIS column's value changed. */
    changedColumn: z.string().max(128).nullish(),
    when: z.array(automationConditionSchema).max(8).optional(),
  }),
  z.object({
    kind: z.literal('schedule'),
    /** NULL only for a bare tick with no `forEach` — nothing to read. */
    connectionId: z.string().nullable(),
    schedule: automationScheduleSchema,
    forEach: z
      .object({
        table: z.string().max(200),
        where: z.array(automationConditionSchema).max(8),
        /** A record that matched before is not run again (the dedupe key drops the tick stamp). */
        once: z.boolean(),
      })
      .optional(),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

// --- actions -----------------------------------

/**
 * A value written to a column: a literal (which may carry `{{record.x}}`
 * tokens — D16) or `{ now: true }`, which is NOT a JS timestamp. Three
 * dialects have three different right answers for "now", and picking one in
 * JavaScript is how a value that works on SQLite writes garbage on MySQL
 * (the `$generate` lesson); the runner resolves this marker through the same
 * coercion the generated defaults use.
 */
export const automationWriteValueSchema = z.union([
  z.string().max(4000),
  z.object({ now: z.literal(true) }),
]);
export type AutomationWriteValue = z.infer<typeof automationWriteValueSchema>;

const automationValuesSchema = z.record(z.string().max(128), automationWriteValueSchema);

const automationEmailRecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), column: z.string().max(128) }),
  z.object({ kind: z.literal('fixed'), addresses: z.array(z.string().max(320)).max(20) }),
]);

export const automationActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    /** A LIVE template's key; the runner refuses an archived one rather than
     * falling back. */
    templateKey: z.string().max(120).nullable().default(null),
    to: automationEmailRecipientSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('notification'),
    to: z
      .union([
        z.object({ roles: z.array(z.string()).max(20) }),
        z.object({ users: z.array(z.string()).max(50) }),
      ])
      .nullable()
      .default(null),
    title: z.string().max(200).default(''),
    body: z.string().max(2000).nullable().default(null),
  }),
  z.object({
    kind: z.literal('record.create'),
    table: z.string().max(200).nullable().default(null),
    values: automationValuesSchema.default({}),
  }),
  z.object({
    /** Writes back to THIS record; a related row is a residual. */
    kind: z.literal('record.update'),
    values: automationValuesSchema.default({}),
  }),
  z.object({
    /*
     * DRAW A DOCUMENT (as ruled by D55).
     *
     * A separate `adminium_record_triggers` table was designed with its own
     * matcher. It was not built: plan 42 had already shipped the indexed
     * lookup, the `when` condition, the 60 s undo window, the per-row dedupe
     * key and the delay-by-origin rule that specified, and O4's only
     * objection to reusing them — that `automations.manage` was still
     * reserved — went away when 42 un-reserved it. So a document profile's
     * trigger IS a rule, and this is the step it runs.
     *
     * ONE FIELD, and that is the point: everything about HOW the document is
     * made — the mapping, the paper, the formats, the number prefix, the
     * provider — lives on the profile, where an operator edits it in Studio
     * with the provider's own slot labels in front of them. Copying any of it
     * into the rule would give a document two sources of truth.
     */
    kind: z.literal('document.render'),
    /** `adminium_document_profiles.id`. Null while the step is being authored. */
    profileId: z.string().max(36).nullable().default(null),
  }),
  z.object({
    kind: z.literal('webhook'),
    url: z.string().max(2000).nullable().default(null),
    method: z.enum(['POST', 'PUT']).default('POST'),
    /** `slack` is a webhook with a `{ text }` body and a host check — D10. */
    bodyKind: z.enum(['json', 'text', 'slack']).default('json'),
    body: z.string().max(8000).nullable().default(null),
    headerName: z.string().max(120).nullable().default(null),
    /** Sealed with the SMTP-secret cipher; never read back over the wire. */
    headerValueEncrypted: z.string().max(4000).nullable().default(null),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

// --- the graph (the comp's nested-list model, not a DAG) --------------------

const automationNodeIdSchema = z.string().min(1).max(40);
const automationNodeTitleSchema = z.string().max(120);
const automationNodeSubSchema = z.string().max(200).nullish();

const automationNodeBase = {
  id: automationNodeIdSchema,
  title: automationNodeTitleSchema,
  sub: automationNodeSubSchema,
};

const automationTriggerNodeSchema = z.object({ ...automationNodeBase, kind: z.literal('trigger') });

const automationActionNodeSchema = z.object({
  ...automationNodeBase,
  kind: z.literal('action'),
  /** The comp's "Continue on error" toggle card (115-149). */
  onError: z.boolean().default(false),
  action: automationActionSchema,
});

/** The comp's "Only continue if" — a filter, not a fork. */
const automationFilterNodeSchema = z.object({
  ...automationNodeBase,
  kind: z.literal('condition'),
  onError: z.boolean().default(false),
  condition: automationConditionSchema,
});

const automationWaitNodeSchema = z
  .object({
    ...automationNodeBase,
    kind: z.literal('wait'),
    amount: z.number().int().min(1).max(3650),
    unit: automationDurationUnitSchema,
  })
  .superRefine((node, ctx) => {
    if (automationDurationMs(node.amount, node.unit) > AUTOMATION_MAX_WAIT_MS) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A wait may not exceed 30 days' });
    }
  });

const automationStopNodeSchema = z.object({ ...automationNodeBase, kind: z.literal('stop') });

/** Everything a BRANCH may contain — which is everything but a trigger and another branch (comp 570). */
const automationBranchChildSchema = z.discriminatedUnion('kind', [
  automationActionNodeSchema,
  automationFilterNodeSchema,
  automationStopNodeSchema,
]).or(automationWaitNodeSchema);

const automationBranchSchema = z.object({
  id: automationNodeIdSchema,
  label: z.string().max(60),
  nodes: z.array(automationBranchChildSchema).max(20),
});
export type AutomationBranch = z.infer<typeof automationBranchSchema>;

const automationBranchNodeSchema = z.object({
  ...automationNodeBase,
  kind: z.literal('branch'),
  condition: automationConditionSchema,
  /** Two, as drawn — branch 0 on true, branch 1 on false. */
  branches: z.tuple([automationBranchSchema, automationBranchSchema]),
});

export const automationNodeSchema = z
  .discriminatedUnion('kind', [
    automationTriggerNodeSchema,
    automationActionNodeSchema,
    automationFilterNodeSchema,
    automationStopNodeSchema,
    automationBranchNodeSchema,
  ])
  .or(automationWaitNodeSchema);
export type AutomationNode = z.infer<typeof automationNodeSchema>;

function collectNodeIds(nodes: readonly AutomationNode[], out: string[]): void {
  for (const node of nodes) {
    out.push(node.id);
    if (node.kind === 'branch') {
      for (const branch of node.branches) {
        out.push(branch.id);
        collectNodeIds(branch.nodes as readonly AutomationNode[], out);
      }
    }
  }
}

export const automationGraphSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(automationNodeSchema).min(1).max(AUTOMATION_MAX_NODES),
  })
  .superRefine((graph, ctx) => {
    const triggers = graph.nodes.filter((node) => node.kind === 'trigger');
    if (triggers.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'A rule has exactly one trigger' });
    } else if (graph.nodes[0]?.kind !== 'trigger') {
      ctx.addIssue({ code: 'custom', path: ['nodes', 0], message: 'The trigger is the first node' });
    }
    const ids: string[] = [];
    collectNodeIds(graph.nodes, ids);
    if (ids.length > AUTOMATION_MAX_NODES) {
      ctx.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `A rule holds at most ${AUTOMATION_MAX_NODES} steps`,
      });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'Step ids must be unique' });
    }
  });
export type AutomationGraph = z.infer<typeof automationGraphSchema>;

// --- runs -----------------------------------------------------------

/**
 * DEPARTURE D9 — seven statuses where Workflow Logs draws three. `pending`
 * and `waiting` are forced by D7's undo window and D8's suspended waits (a
 * run that sleeps for two days is neither running nor finished); `cancelled`
 * is a rule switched off mid-wait. The comp's three FILTERS still cover them:
 * "Running" counts pending + running + waiting.
 */
export const automationRunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

/**
 * Who caused the event — the undo mapping queries this as a column (0028).
 * `hook` and `action` are writes a project's own code made.
 */
export const automationOriginSchema = z.enum([
  'dashboard',
  'public',
  'bulk',
  'watch',
  'schedule',
  'test',
  'automation',
  'hook',
  'action',
]);
export type AutomationOrigin = z.infer<typeof automationOriginSchema>;

export const automationEventNameSchema = z.enum([
  'record.created',
  'record.updated',
  'record.deleted',
  'schedule.tick',
  'test',
]);

/** What the run was started BY. `snapshot` is PII-masked at this boundary. */
export const automationTriggerEventSchema = z.object({
  event: automationEventNameSchema,
  origin: automationOriginSchema,
  /** Set when `origin` is `automation` — the rule whose write caused this. */
  ruleId: z.string().nullish(),
  /** Loop guard: refused above 3. */
  hops: z.number().int().min(0).max(16).default(0),
  record: recordRefSchema.nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: z.number().int(),
});
export type AutomationTriggerEvent = z.infer<typeof automationTriggerEventSchema>;

export const automationTraceStatusSchema = z.enum(['ok', 'fail', 'run', 'skip', 'wait']);

export const automationTraceStepSchema = z.object({
  nodeId: automationNodeIdSchema,
  /** The node's title AS IT WAS when the run happened — the rule may be edited later. */
  name: z.string().max(200),
  kind: z.enum(['trigger', 'action', 'condition', 'branch', 'wait', 'stop']),
  status: automationTraceStatusSchema,
  startedAt: z.number().int(),
  durationMs: z.number().int().nullable(),
  /** The comp's log box — "250 OK · delivered to …", "evaluated → true". */
  log: z.string().max(2000).nullable(),
});
export type AutomationTraceStep = z.infer<typeof automationTraceStepSchema>;

export const automationTraceSchema = z.object({
  version: z.literal(1),
  steps: z.array(automationTraceStepSchema).max(400),
  /** Where a suspended run picks up: the index path into the graph (D8). */
  resume: z.array(z.number().int()).max(8).nullable(),
});
export type AutomationTrace = z.infer<typeof automationTraceSchema>;

/**
 * The watch poller's position — a KEYSET, not a scalar.
 *
 * Ten rows can carry the same `created_at` to the millisecond, and a cursor
 * of "the last timestamp I saw" either loses nine of them (`>`) or re-reads
 * all ten every minute for ever (`>=`). So the position is the pair the query
 * actually orders by: the column's value AND the primary key of the last row
 * consumed at that value. The next tick asks for
 * `col > value OR (col = value AND pk > frontier)`, which makes progress
 * unconditionally — even when a tie block is larger than one batch.
 */
export const automationWatchCursorSchema = z.object({
  column: z.string().max(128),
  value: z.union([z.string(), z.number()]).nullable(),
  /** Full pk map of the last row read AT `value`; null before the first row. */
  frontierPk: z.record(z.string(), z.unknown()).nullable(),
});
export type AutomationWatchCursor = z.infer<typeof automationWatchCursorSchema>;

// --- scheduled reports
// ---------------------------------------------------------

export const reportScheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  time: z.string(),
  timezone: z.string(),
});

export const reportRecipientsSchema = z.array(z.string());
export const reportFormatSchema = z.enum(['pdf', 'png']);

// --- exports / imports ------------------------------------------------------

/**
 * One column of an export DEFINITION: the row key
 * it reads and the header it is written under, plus — for a projection — the
 * same `lookup` / `reverse` / `derived` block a `page-crud` column carries.
 * Shape only; the server resolves every name against the snapshot.
 */
export const exportColumnSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  lookup: z
    .object({ path: z.array(z.string().min(1)).min(1).max(3), select: z.string().min(1) })
    .optional(),
  reverse: z
    .object({ table: z.string().min(1), fkColumn: z.string().min(1), agg: z.literal('count') })
    .optional(),
  derived: z.object({ ref: z.string().min(1) }).optional(),
});

export const exportOptionsSchema = z.object({
  headerRow: z.boolean().optional(),
  fileName: z.string().max(120).optional(),
});

export const exportSourceSchema = z.object({
  kind: z.enum(['table', 'view', 'page']),
  table: z.string().nullish(),
  viewId: z.string().nullish(),
  filters: z.array(z.unknown()).optional(),
  // The builder's definition, all optional so every stored row (and every
  // scheduled report) parses exactly as before.
  columns: z.array(exportColumnSchema).max(64).optional(),
  /** A `CrudDerivedConfig`; meta cannot import the leaf, the server validates it. */
  derived: z.unknown().optional(),
  options: exportOptionsSchema.optional(),
});
export const exportFormatSchema = z.enum(['csv', 'json', 'xlsx']);
export const exportStatusSchema = z.enum(['processing', 'ready', 'failed', 'cancelled', 'expired']);

export const importMappingSchema = z.object({
  columns: z.array(z.object({ from: z.string(), to: z.string().nullable() })),
});
export const importOptionsSchema = z.object({
  mode: z.enum(['insert', 'upsert']).optional(),
  matchColumn: z.string().nullish(),
  skipInvalid: z.boolean().optional(),
});
export const importStatsSchema = z.object({
  total: z.number().int(),
  inserted: z.number().int().optional(),
  updated: z.number().int().optional(),
  skipped: z.number().int().optional(),
});
export const importStatusSchema = z.enum(['validating', 'ready', 'running', 'succeeded', 'failed', 'cancelled']);

// --- files
// --------------------------------------------------------------------------

/**
 * What a stored file IS. `document` joined on 2026-09-10: the bytes a
 * `document-render@1` provider produced for one register row.
 *
 * A KIND RATHER THAN A FLAG ON `export`, because the two differ in every way
 * that matters downstream: an export is a snapshot of a query somebody ran and
 * is disposable, while a document is a thing that was ISSUED to somebody and
 * may have to be produced again years later. They get different retention
 * (`retention.documentsDays`, default null — kept forever), different routes,
 * and different answers to "may this be swept".
 */
export const fileKindSchema = z.enum([
  'upload',
  'export',
  'import',
  'branding',
  'schema',
  'archive',
  'document',
]);

// --- storage destinations --------------------------------------

export const storageDriverSchema = z.enum(['local', 's3', 'webdav']);
export type StorageDriverKind = z.infer<typeof storageDriverSchema>;

/**
 * A base URL under which this destination's objects are readable WITHOUT
 * Adminium — a CDN in front of a public bucket, a WebDAV share behind a
 * reverse proxy. Optional everywhere and used for ONE thing: minting a `url`
 * reference to store in the user's own column. It is never used to render
 * an `<img>` — the dashboard's CSP is `default-src 'self'` and a
 * cross-origin thumbnail is blocked — and never as a read path for Adminium
 * itself, which always goes back through the driver.
 */
const publicBaseUrl = z.string().url().max(400).optional();

/**
 * A key prefix inside the destination. `invoices/` and `avatars/` on one
 * bucket are two destinations that differ only here, which is the cheap way to
 * share a bucket without sharing a namespace.
 */
const keyPrefix = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'a prefix is path-safe characters and may not start with a separator')
  .optional();

export const localDestinationConfigSchema = z.object({
  /**
   * Absolute path to the storage root. This is the "host it on the server, in
   * a directory I choose" case (a mounted volume, an SMB mount, a NAS path) —
   * NOT this server's default disk, which is the implicit destination and has
   * no row at all.
   */
  root: z.string().min(1).max(400),
});

export const s3DestinationConfigSchema = z.object({
  /**
   * Full origin of the S3-compatible API, e.g.
   * `https://nyc3.digitaloceanspaces.com`, `https://<id>.r2.cloudflarestorage.com`,
   * `http://127.0.0.1:9000`. Empty means AWS itself, whose endpoint is derived
   * from the region.
   */
  endpoint: z.string().url().max(400).optional(),
  /** `auto` for R2 and Tigris; a real region for AWS and Spaces. */
  region: z.string().min(1).max(60),
  bucket: z.string().min(1).max(200),
  prefix: keyPrefix,
  /**
   * `<endpoint>/<bucket>/<key>` rather than `<bucket>.<endpoint>/<key>`. True
   * for MinIO, Garage and most self-hosted targets; false for AWS and the
   * managed providers that issue per-bucket hostnames.
   */
  forcePathStyle: z.boolean(),
  publicBaseUrl,
});

export const webdavDestinationConfigSchema = z.object({
  /** Collection URL, e.g. `https://nas.example.com/remote.php/dav/files/ava`. */
  url: z.string().url().max(400),
  prefix: keyPrefix,
  publicBaseUrl,
});

/**
 * Discriminating on the driver is done by the repo (which knows the row's
 * `driver` column) rather than by a Zod union on the payload: the config has
 * no `driver` field of its own, and duplicating one inside the json would give
 * two places to disagree about what a row is.
 */
export const storageDestinationConfigSchema = z.union([
  localDestinationConfigSchema,
  s3DestinationConfigSchema,
  webdavDestinationConfigSchema,
]);

export type LocalDestinationConfig = z.infer<typeof localDestinationConfigSchema>;
export type S3DestinationConfig = z.infer<typeof s3DestinationConfigSchema>;
export type WebdavDestinationConfig = z.infer<typeof webdavDestinationConfigSchema>;
export type StorageDestinationConfig = z.infer<typeof storageDestinationConfigSchema>;

export const storageDestinationStatusSchema = z.enum(['untested', 'ok', 'error']);
export type StorageDestinationStatus = z.infer<typeof storageDestinationStatusSchema>;

/** Per-driver config parser — the repo's single entry point. */
export function parseStorageDestinationConfig(
  driver: StorageDriverKind,
  value: unknown,
): StorageDestinationConfig {
  switch (driver) {
    case 'local':
      return localDestinationConfigSchema.parse(value);
    case 's3':
      return s3DestinationConfigSchema.parse(value);
    case 'webdav':
      return webdavDestinationConfigSchema.parse(value);
  }
}

// --- email templates / webhooks / flags / manifests
// -----------------------------

/**
 * Block array — the OPEN envelope. The concrete per-kind data shapes are owned
 * by `apps/server/src/email/document.ts`: an unknown kind must round-trip
 * through the repo byte-identical so a row a newer server wrote is never
 * rejected by an older one.
 */
export const emailBlocksSchema = z.array(z.record(z.string(), z.unknown()));

// --- email documents ----------------------------

/** `template` (bound to a flow, sent by the product) | `campaign` (a send-out).
 * */
export const emailDocumentKindSchema = z.enum(['template', 'campaign']);
export type EmailDocumentKind = z.infer<typeof emailDocumentKindSchema>;

/** The comp's three categories (receipt · sprout · megaphone). */
export const emailCategorySchema = z.enum(['transactional', 'lifecycle', 'marketing']);
export type EmailCategory = z.infer<typeof emailCategorySchema>;

/**
 * The twelve logo marks the comp's Branding panel offers (comp 1559), plus
 * `logo` for the workspace's own logo when one is set. Each of the twelve
 * ships as a white PNG the renderer attaches by CID — SVG does not render
 * in mail — so the set is closed here rather than "any Lucide name".
 */
export const EMAIL_MARKS = [
  'hexagon',
  'circle',
  'square',
  'triangle',
  'gem',
  'zap',
  'flame',
  'leaf',
  'star',
  'heart',
  'command',
  'box',
] as const;
export const emailMarkSchema = z.enum([...EMAIL_MARKS, 'logo']);
export type EmailMark = z.infer<typeof emailMarkSchema>;

/** Per-document brand & sender. `fromEmail` must be a configured sender —
 * checked by the server, not here. */
export const emailBrandSchema = z.object({
  name: z.string().max(80),
  mark: emailMarkSchema,
  /** Six-digit hex; the mail's `bgcolor` and the canvas's gradient. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fromName: z.string().max(120),
  fromEmail: z.string().max(320),
});
export type EmailBrand = z.infer<typeof emailBrandSchema>;

/**
 * What travels with every send. A `file` attachment names a library file whose
 * bytes are read at delivery; a `generated` one names a `{{token}}` the caller
 * fills with a file id per recipient.
 */
export const emailAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1).max(40), kind: z.literal('file'), fileId: z.string().min(1).max(36) }),
  z.object({
    id: z.string().min(1).max(40),
    kind: z.literal('generated'),
    label: z.string().max(120),
    token: z.string().max(80),
  }),
]);
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;
export const emailAttachmentsSchema = z.array(emailAttachmentSchema).max(20);

/** The eight style axes of one block, the comp's defaults being the absent value (comp 1407-1419). */
export const emailBlockStyleSchema = z.object({
  pad: z.enum(['none', 's', 'm', 'l']).optional(),
  bg: z.enum(['none', 'soft', 'tint', 'accent', 'dark']).optional(),
  fg: z.enum(['auto', 'strong', 'muted', 'accent', 'white']).optional(),
  size: z.enum(['s', 'm', 'l']).optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  border: z.enum(['none', 'thin', 'dashed']).optional(),
  radius: z.enum(['none', 'md', 'lg']).optional(),
  full: z.boolean().optional(),
});
export type EmailBlockStyle = z.infer<typeof emailBlockStyleSchema>;

/**
 * A structural edit the editor mirrors onto a document's other language
 * variants (collected in the session, applied by the save). The algebra is
 * the comp's `applyOp` (comp 1317-1323); `applyEmailBlockOps` in the repo
 * is its implementation.
 */
export const emailMirrorOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('insert'),
    index: z.number().int().min(0),
    block: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal('delete'), index: z.number().int().min(0) }),
  z.object({ kind: z.literal('move'), from: z.number().int().min(0), to: z.number().int().min(0) }),
]);
export type EmailMirrorOp = z.infer<typeof emailMirrorOpSchema>;
export const emailMirrorOpsSchema = z.array(emailMirrorOpSchema).max(200);

/** Who a campaign goes to. `users` is phase 1; a table audience joins in the
 * next wave (O1). */
export const emailAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('users'), roleIds: z.array(z.string().min(1)).max(50).optional() }),
]);
export type EmailAudience = z.infer<typeof emailAudienceSchema>;

export const emailRunStatusSchema = z.enum(['scheduled', 'running', 'sent', 'failed', 'cancelled']);
export type EmailRunStatus = z.infer<typeof emailRunStatusSchema>;

/** How many `{ to, error }` records a run keeps — enough to diagnose, never a per-recipient ledger. */
export const EMAIL_RUN_FAILURES_MAX = 100;
export const emailRunFailuresSchema = z
  .array(z.object({ to: z.string(), error: z.string().max(500) }))
  .max(EMAIL_RUN_FAILURES_MAX);
export type EmailRunFailure = z.infer<typeof emailRunFailuresSchema>[number];

// --- invoice documents ---------------------------------------

/** `template` (a reusable design) | `invoice` (a document built from one, or from scratch). */
export const invoiceDocumentKindSchema = z.enum(['template', 'invoice']);
export type InvoiceDocumentKind = z.infer<typeof invoiceDocumentKindSchema>;

/** The comp's five-value vocabulary, shared by both kinds (comp 1393, 1579). */
export const invoiceStatusSchema = z.enum(['draft', 'sent', 'paid', 'live', 'overdue']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * The family key (comp `topics()`, 1173-1180) plus `other` for a row that
 * names none. The first key is `recurring`, not the comp's word — 34 Appendix
 * D.2 renames the key as well as the label, because a key leaks into group
 * anchors and every row's summary.
 */
export const invoiceTopicSchema = z.enum(['recurring', 'services', 'receipts', 'sales', 'logistics', 'other']);
export type InvoiceTopic = z.infer<typeof invoiceTopicSchema>;

/**
 * The six DOCUMENT languages (comp `langs()` 1183-1192) — the
 * customer's, not the admin UI's locale. The enum's order IS the comp's
 * fixed order (1185-1190): language groups always run this way.
 */
export const invoiceLangSchema = z.enum(['en', 'de', 'fr', 'es', 'pt', 'ja']);
export type InvoiceLang = z.infer<typeof invoiceLangSchema>;
export const INVOICE_LANG_ORDER: readonly InvoiceLang[] = invoiceLangSchema.options;

/**
 * The envelope — the OPEN record. The per-field shape is owned by
 * `apps/server/src/invoices/document.ts` (the email rule, `emailBlocksSchema`
 * above): a body a newer server wrote must round-trip through the repo
 * byte-identical so an older one never rejects it.
 */
export const invoiceBodySchema = z.record(z.string(), z.unknown());
export type InvoiceBodyRecord = z.infer<typeof invoiceBodySchema>;

/**
 * What the manager's card and row read without decoding the body, written
 * by the server on every save. Mirrors `InvoiceSummaryFacts` in
 * `apps/dashboard/src/invoices/api.ts` exactly.
 */
export const invoiceSummarySchema = z.object({
  number: z.string(),
  customerName: z.string(),
  /** The sheet's title word — RECEIPT picks the receipt glyph (comp 1435). */
  title: z.string(),
  logoText: z.string(),
  logoIcon: z.string(),
  accent: z.string(),
  currency: z.string(),
  cents: z.boolean(),
  /** The ladder's total in integer minor units (the money law). */
  totalMinor: z.number(),
  /** How many line items — the thumbnail draws up to three rows (comp 1432). */
  itemCount: z.number().int(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

// --- report documents -----------------------------------------

/** `template` (a reusable layout) | `report` (a document built from one, or from scratch). */
export const reportDocumentKindSchema = z.enum(['template', 'report']);
export type ReportDocumentKind = z.infer<typeof reportDocumentKindSchema>;

/**
 * The comp's three-value vocabulary, shared by both kinds (comp `statusMeta`
 * 563). `sent` reads *Published* on the surface; the KEY is the comp's own
 * state key, kept the way 0027 kept its five.
 */
export const reportStatusSchema = z.enum(['draft', 'sent', 'live']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

/**
 * The envelope — the OPEN record. The per-field shape is owned by
 * `apps/server/src/report-documents/document.ts` (the email/invoice rule): a
 * body a newer server wrote must round-trip through the repo byte-identical
 * so an older one never rejects it.
 */
export const reportBodySchema = z.record(z.string(), z.unknown());
export type ReportBodyRecord = z.infer<typeof reportBodySchema>;

/**
 * What the manager's card and row draw without decoding the body, written by
 * the server on every save. Exactly the inputs of the comp's `cards`
 * (584-591) and `starters` (570-576) thumbnails. Mirrors `ReportSummaryFacts`
 * in `apps/dashboard/src/report-builder/api.ts`.
 */
export const reportSummarySchema = z.object({
  reportTitle: z.string(),
  kicker: z.string(),
  accent: z.string(),
  blockCount: z.number().int(),
  /** The comp draws at most three KPI boxes (`Math.min(3, kpis.length)`, 584). */
  kpiCount: z.number().int(),
  /** The first bar/line block's values, at most six (584-591). */
  series: z.array(z.number()),
  /** The starter's icon, carried on the row so a rename never changes it. */
  starterIcon: z.string(),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

/** Event keys, same grammar as automations (`record.created`, `export.ready`, `*`). */
export const webhookEventsSchema = z.array(z.string());

export const featureFlagEnvironmentSchema = z.object({
  enabled: z.boolean(),
  rollout: z.number().min(0).max(100),
  rules: z.array(z.unknown()),
});
export const featureFlagEnvironmentsSchema = z.record(z.string(), featureFlagEnvironmentSchema);

/** Envelope only — the full manifest spec is frozen. */
export const manifestDocSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    version: z.string(),
  })
  .loose();
