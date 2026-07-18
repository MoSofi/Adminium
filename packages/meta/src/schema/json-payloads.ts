/**
 * Zod schemas for the JSON payloads stored in adminium_* json columns
 * (07-meta-store.md §3). Repos validate every JSON write against these —
 * an invalid payload never reaches the database (acceptance #7).
 *
 * Page config (`adminium_pages.config`) is deliberately opaque here: the
 * envelope schema is owned by `@adminium/engine/config` and validated at the
 * server route layer (§3.17); `pagesRepo` persists already-validated JSON.
 */

import { z } from 'zod';

// --- shared -----------------------------------------------------------------

/** §5.3 soft reference to a source record — never a cross-boundary FK. */
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

export const LOCALES = ['en_US', 'de_DE', 'ar_EG', 'zh_CN', 'zh_TW', 'cs_CZ', 'da_DK', 'fr_FR'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const accentSchema = z.enum(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);
export const densitySchema = z.enum(['comfortable', 'compact']);
export const dirSchema = z.enum(['ltr', 'rtl']);

// --- users / prefs (§3.3, §3.4) ----------------------------------------------

export const userStatusSchema = z.enum(['active', 'invited', 'suspended']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Array of argon2id hashes. */
export const recoveryCodesSchema = z.array(z.string());

/** Non-theming client state: sidebar collapse, last-visited page, dismissed hints. */
export const uiStateSchema = z.record(z.string(), z.unknown());

// --- rbac (§3.9) --------------------------------------------------------------

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

/** v1 closed set of system action keys (§3.9), extended per milestone. */
export const SYSTEM_ACTION_KEYS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'connections.manage',
  'schema.remap',
  'llm.run',
  'automations.manage',
  'webhooks.manage',
  'api-keys.manage',
  'manifests.manage',
  'audit.read',
  'sql.run',
  // M7 wave 2 — data-io (T5) + scheduled reports (T6). `exports.manage` /
  // `imports.manage` gate seeing/downloading OTHER users' artifacts (lists are
  // mine-only without them); `reports.manage` gates the scheduled-reports
  // admin verbs. Email templates deliberately add NO key: PUT rides the
  // existing `settings.manage` (T6 supersedes the builders track's assumption).
  'exports.manage',
  'imports.manage',
  'reports.manage',
  // Jobs visibility/management (08 §2.17): `jobs.read` gates GET /jobs and
  // reading/subscribing to OTHER users' jobs (owners always see their own via
  // the payload.userId convention); `jobs.manage` gates POST /jobs and
  // cancelling other users' jobs. Enforced by routes/jobs and the realtime
  // hub's jobs:<id> channel authorizer.
  'jobs.read',
  'jobs.manage',
] as const;
export type SystemActionKey = (typeof SYSTEM_ACTION_KEYS)[number];
export const systemActionKeySchema = z.enum(SYSTEM_ACTION_KEYS);

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

// --- audit (§3.11) -------------------------------------------------------------

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
]);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

/** `{ before, after }` images; PII-masked upstream; capped at 16 KB serialized. */
export const auditChangesSchema = z.object({
  before: z.record(z.string(), z.unknown()).nullish(),
  after: z.record(z.string(), z.unknown()).nullish(),
  _truncated: z.literal(true).optional(),
});
export type AuditChanges = z.infer<typeof auditChangesSchema>;

/** Serialized-size cap for `adminium_audit_log.changes` (§3.11). */
export const AUDIT_CHANGES_MAX_BYTES = 16 * 1024;

// --- jobs (§3.12) ---------------------------------------------------------------

export const jobStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Kind-specific; the worker validates the concrete shape. */
export const jobPayloadSchema = z.record(z.string(), z.unknown());

// --- connections (§3.13) ---------------------------------------------------------

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

// --- schema overrides (§3.15): one row = one op ----------------------------------

const toneSchema = z.string();

export const overridePatchSchema = z.discriminatedUnion('op', [
  // Labels are min(1): the engine's `TableModel.label` forbids '' and an empty
  // rename is meaningless (the remap UI drops the op instead of staging '').
  // Rejecting at write time keeps §3.15 last-write-wins + user>llm provenance
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

export const overrideOriginSchema = z.enum(['user', 'llm']);
export const overrideStatusSchema = z.enum(['active', 'disabled']);

// --- pages (§3.16/§3.17) -----------------------------------------------------------

export const pageOriginSchema = z.enum(['generated', 'user', 'manifest', 'system', 'llm']);
export const navGroupSchema = z.enum(['workspace', 'library', 'planning', 'people', 'account']);

/**
 * Opaque: envelope validation is owned by `@adminium/engine/config` and runs
 * at the server route layer before the repo is called (§3.17).
 */
export const pageConfigSchema = z.record(z.string(), z.unknown());

/** Saved-view payload (§3.18). */
export const viewConfigSchema = z.object({
  filters: z.array(z.unknown()).optional(),
  sort: z.unknown().optional(),
  visibleColumns: z.array(z.string()).optional(),
  grouping: z.unknown().nullish(),
  widgetState: z.record(z.string(), z.unknown()).optional(),
});

// --- notifications (§3.20/§3.21) ----------------------------------------------------

export const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

// --- llm runs (§3.19 / 06-llm-assist.md §7.4) -----------------------------------------

export const llmRunModeSchema = z.enum(['provider', 'byo']);

/**
 * `validation_status` — the outcome of the LAST response validation, kept from
 * 0006 as a secondary signal (drives the "some suggestions dropped" hint in the
 * run-history UI). Orthogonal to the run-lifecycle `status` machine below, which
 * 0007 adds as the authoritative state.
 */
export const llmValidationStatusSchema = z.enum(['pending', 'valid', 'partial', 'invalid']);

/**
 * `status` — the authoritative run-lifecycle machine (06-llm-assist.md §7.4).
 * Transitions (enforced by the server run-service, not the repo):
 *   draft → running | awaiting_response
 *   running | awaiting_response → validated | failed | discarded
 *   validated → applied | partially_applied | discarded
 *   applied | partially_applied | failed | discarded → (terminal, immutable)
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

/** Builder inputs echoed onto the run (§4.1) — opaque here, validated upstream by `buildPrompt`. */
export const llmRunSectionsSchema = z.array(z.string());
export const llmRunLocalesSchema = z.array(z.string()).min(1);
export const llmRunSamplingSchema = z
  .object({ maxValuesPerColumn: z.number().int().positive() })
  .nullable();

/** `review` — accepted/rejected suggestion-id lists persisted across re-review (§8.3). */
export const llmRunReviewSchema = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
});
export type LlmRunReview = z.infer<typeof llmRunReviewSchema>;

// --- automations (§3.22/§3.23) --------------------------------------------------------

export const automationTriggerSchema = z.object({
  event: z.string(),
  table: z.string().nullish(),
  schedule: z.string().nullish(),
});

export const automationGraphSchema = z.object({
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
});

export const automationRunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'skipped']);

// --- scheduled reports (§3.24) ---------------------------------------------------------

export const reportScheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  time: z.string(),
  timezone: z.string(),
});

export const reportRecipientsSchema = z.array(z.string());
export const reportFormatSchema = z.enum(['pdf', 'png']);

// --- exports / imports (§3.25/§3.26) ------------------------------------------------------

export const exportSourceSchema = z.object({
  kind: z.enum(['table', 'view', 'page']),
  table: z.string().nullish(),
  viewId: z.string().nullish(),
  filters: z.array(z.unknown()).optional(),
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

// --- files (§3.27) --------------------------------------------------------------------------

export const fileKindSchema = z.enum(['upload', 'export', 'import', 'branding', 'schema', 'archive']);

// --- email templates / webhooks / flags / manifests (§3.28–§3.32) -----------------------------

/** Block array — the concrete block schema is owned by 09-generated-app.md §email-editor. */
export const emailBlocksSchema = z.array(z.record(z.string(), z.unknown()));

/** Event keys, same grammar as automations (`record.created`, `export.ready`, `*`). */
export const webhookEventsSchema = z.array(z.string());

export const featureFlagEnvironmentSchema = z.object({
  enabled: z.boolean(),
  rollout: z.number().min(0).max(100),
  rules: z.array(z.unknown()),
});
export const featureFlagEnvironmentsSchema = z.record(z.string(), featureFlagEnvironmentSchema);

/** Envelope only — the full manifest spec is frozen in 13-marketplace.md. */
export const manifestDocSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    version: z.string(),
  })
  .loose();
