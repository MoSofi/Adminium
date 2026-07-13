/**
 * Kysely `MetaDB` interface — one table interface per adminium_* table
 * (BRIEF §6 / 07-meta-store.md §3: 32 names, 31 physical tables +
 * the `adminium_migrations` ledger; `adminium_dashboards` is NOT a physical
 * table — dashboards are `adminium_pages` rows with `type='page-dashboard'`).
 *
 * The meta Kysely instance runs with `CamelCasePlugin`, so properties here are
 * camelCase while physical columns are snake_case.
 *
 * Column-type conventions (07-meta-store.md §2.1):
 * - ids: type-prefixed ULIDs in char(36) → `string`
 * - ts:  epoch milliseconds UTC → `number`
 * - json: stored serialized; repos write strings and parse reads → {@link JsonColumn}
 * - bool: PG boolean / MySQL tinyint / SQLite integer → {@link BoolColumn}
 */

import type { ColumnType } from 'kysely';

/** Type-prefixed ULID (`usr_01J…`) in a char(36) column. */
export type Id = string;

/** Epoch milliseconds UTC. PG pools must parse int8 to number (values < 2^53). */
export type Ts = number;

/**
 * Opaque JSON payload. Writes are always `JSON.stringify(...)` strings
 * (portable across jsonb/json/text); reads may come back parsed (PG jsonb)
 * or as a string (SQLite) — repos normalize via `readJson()`.
 */
export type JsonColumn = ColumnType<unknown, string, string>;

/** Boolean column; SQLite/MySQL round-trip as 0/1 — repos coerce via `readBool()`. */
export type BoolColumn = ColumnType<boolean | 0 | 1, boolean | 0 | 1, boolean | 0 | 1>;

// ---------------------------------------------------------------------------
// wave 0001 — core auth
// ---------------------------------------------------------------------------

/** §3.1 migration ledger — owned exclusively by the runner. */
export interface AdminiumMigrationsTable {
  /** PK; migration basename, e.g. `0001_core_auth`. */
  name: string;
  /** SHA-256 of the migration contents at apply time. */
  checksum: string;
  appliedAt: Ts;
  durationMs: number;
  adminiumVersion: string;
}

/** §3.2 global defaults — explicit super-admin overrides only. */
export interface AdminiumSettingsTable {
  /** PK; namespaced key, e.g. `appearance.accent`. */
  key: string;
  value: JsonColumn;
  updatedAt: Ts;
  updatedBy: Id | null;
}

/** §3.3 */
export interface AdminiumUsersTable {
  id: Id;
  /** Lowercased; unique. */
  email: string;
  name: string;
  /** argon2id; NULL while status='invited'. Hashing happens in the server. */
  passwordHash: string | null;
  /** active | invited | suspended */
  status: string;
  totpSecretEncrypted: string | null;
  totpEnabled: BoolColumn;
  /** JSON array of argon2id hashes. */
  recoveryCodes: JsonColumn | null;
  /** Soft ref → adminium_files (created in a later wave; no FK). */
  avatarFileId: Id | null;
  lastLoginAt: Ts | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.4 one row per user; NULL axis = inherit. */
export interface AdminiumUserPrefsTable {
  /** PK; FK → adminium_users CASCADE. */
  userId: Id;
  theme: string | null;
  accent: string | null;
  density: string | null;
  locale: string | null;
  /** ltr | rtl; NULL = derived from locale. */
  dir: string | null;
  uiState: JsonColumn | null;
  updatedAt: Ts;
}

/** §3.5 opaque session tokens — only the SHA-256 of the cookie value is stored. */
export interface AdminiumSessionsTable {
  id: Id;
  tokenHash: string;
  userId: Id;
  createdAt: Ts;
  expiresAt: Ts;
  lastSeenAt: Ts;
  ip: string | null;
  userAgent: string | null;
  revokedAt: Ts | null;
}

/** §3.6 password-reset + invite-activation tokens. */
export interface AdminiumPasswordResetsTable {
  id: Id;
  userId: Id;
  /** reset | invite */
  kind: string;
  tokenHash: string;
  expiresAt: Ts;
  usedAt: Ts | null;
  createdAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0002 — rbac
// ---------------------------------------------------------------------------

/** §3.8 */
export interface AdminiumRolesTable {
  id: Id;
  /** unique; built-ins: super-admin, admin, editor, viewer. */
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: BoolColumn;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.9 per-table / per-page / system permission matrix. */
export interface AdminiumRolePermissionsTable {
  id: Id;
  roleId: Id;
  /** table | page | system */
  resourceKind: string;
  /** table: `<connectionId>/<schema.table>` · page: page id · system: action key. */
  resourceRef: string;
  actions: JsonColumn;
}

/** §3.10 composite PK (user_id, role_id). */
export interface AdminiumUserRolesTable {
  userId: Id;
  roleId: Id;
  grantedBy: Id | null;
  createdAt: Ts;
}

/** §3.7 Stripe-style keys; secret shown once, only hash stored. */
export interface AdminiumApiKeysTable {
  id: Id;
  name: string;
  /** Display fragment, e.g. `adm_live_4f2…`. */
  prefix: string;
  tokenHash: string;
  /** The key acts with this role's permissions. */
  roleId: Id;
  createdBy: Id | null;
  lastUsedAt: Ts | null;
  expiresAt: Ts | null;
  revokedAt: Ts | null;
  createdAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0003 — connections & schema
// ---------------------------------------------------------------------------

/** §3.27 metadata for binaries Adminium itself stores. */
export interface AdminiumFilesTable {
  id: Id;
  /** v1: local only. */
  storage: string;
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /** upload | export | import | branding | schema | archive */
  kind: string;
  /** RecordRef soft reference. */
  entity: JsonColumn | null;
  uploadedBy: Id | null;
  createdAt: Ts;
  deletedAt: Ts | null;
}

/** §3.13 one row per configured source database. */
export interface AdminiumConnectionsTable {
  id: Id;
  name: string;
  /** postgres | mysql | sqlite */
  engine: string;
  /** dsn | schema-file */
  sourceKind: string;
  introspectDsnEncrypted: string | null;
  dataDsnEncrypted: string | null;
  schemaFileId: Id | null;
  readOnly: BoolColumn;
  ssl: JsonColumn | null;
  settings: JsonColumn;
  /** unconfigured | connected | error */
  status: string;
  lastTestedAt: Ts | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.14 immutable record of one introspection / schema-import run. */
export interface AdminiumSchemaSnapshotsTable {
  id: Id;
  connectionId: Id;
  /** introspection | schema-import */
  source: string;
  importFormat: string | null;
  engineVersion: string | null;
  /** Normalized schema model (05-introspection-engine.md) — opaque here. */
  schema: JsonColumn;
  stats: JsonColumn | null;
  checksum: string;
  /** Exactly one active per connection (app-enforced in a transaction). */
  isActive: BoolColumn;
  createdBy: Id | null;
  createdAt: Ts;
}

/** §3.15 one row = one correction op layered over the active snapshot. */
export interface AdminiumSchemaOverridesTable {
  id: Id;
  connectionId: Id;
  op: string;
  tableName: string;
  columnName: string | null;
  value: JsonColumn;
  /** user | llm */
  origin: string;
  /** Soft ref → adminium_llm_runs (created in a later wave; no FK). */
  llmRunId: Id | null;
  /** active | disabled */
  status: string;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0004 — pages & views
// ---------------------------------------------------------------------------

/** §3.16 every navigable page of the Generated App, dashboards included. */
export interface AdminiumPagesTable {
  id: Id;
  /** NULL for connection-independent pages. */
  connectionId: Id | null;
  slug: string;
  /** Page-template id, e.g. page-dashboard, page-crud, … */
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  /** Opaque validated envelope (§3.17) — validation lives at the server route layer. */
  config: JsonColumn;
  /** generated | user | manifest | system */
  origin: string;
  /** Soft ref → adminium_manifests (created in a later wave; no FK). */
  manifestId: Id | null;
  generatedFromSnapshotId: Id | null;
  /** Optimistic concurrency: writes send expected revision. */
  revision: number;
  isEnabled: BoolColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.18 saved filters/layouts. NULL user_id = shared workspace view. */
export interface AdminiumViewsTable {
  id: Id;
  pageId: Id;
  userId: Id | null;
  name: string;
  config: JsonColumn;
  isDefault: BoolColumn;
  createdAt: Ts;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0005 — ops (jobs / audit / notifications)
// ---------------------------------------------------------------------------

/** §3.12 table-backed job queue (no Redis). */
export interface AdminiumJobsTable {
  id: Id;
  kind: string;
  payload: JsonColumn;
  /** pending | running | succeeded | failed | cancelled */
  status: string;
  priority: number;
  runAt: Ts;
  attempts: number;
  maxAttempts: number;
  /** Worker id `<hostname>:<pid>`. */
  lockedBy: string | null;
  /** Stale after 5 min ⇒ reclaimable. */
  lockedAt: Ts | null;
  /** Unique (NULLs exempt); cleared on completion. */
  dedupeKey: string | null;
  lastError: string | null;
  createdAt: Ts;
  startedAt: Ts | null;
  finishedAt: Ts | null;
}

/** §3.11 append-only audit trail; actor label denormalized. */
export interface AdminiumAuditLogTable {
  id: Id;
  createdAt: Ts;
  /** user | api-key | system | automation */
  actorKind: string;
  /** No FK — retention outlives principals. */
  actorId: string | null;
  actorLabel: string;
  category: string;
  /** Dotted verb, e.g. `record.update`. */
  action: string;
  connectionId: string | null;
  /** RecordRef. */
  entity: JsonColumn | null;
  /** { before, after }; capped at 16 KB serialized. */
  changes: JsonColumn | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** §3.20 */
export interface AdminiumNotificationsTable {
  id: Id;
  userId: Id;
  kind: string;
  actorLabel: string;
  title: string;
  body: string | null;
  entity: JsonColumn | null;
  actionUrl: string | null;
  readAt: Ts | null;
  createdAt: Ts;
}

/** §3.21 composite PK (user_id, event_key). */
export interface AdminiumNotificationPrefsTable {
  userId: Id;
  eventKey: string;
  channels: JsonColumn;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0006 — platform (llm / automation / delivery / marketplace)
// ---------------------------------------------------------------------------

/** §3.19 one enrichment attempt (provider API or BYO paste). */
export interface AdminiumLlmRunsTable {
  id: Id;
  connectionId: Id;
  snapshotId: Id;
  /** provider | byo */
  mode: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  promptHash: string;
  responseRaw: string | null;
  responseJson: JsonColumn | null;
  /** pending | valid | partial | invalid */
  validationStatus: string;
  validationErrors: JsonColumn | null;
  appliedAt: Ts | null;
  appliedBy: Id | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  createdBy: Id | null;
  createdAt: Ts;
}

/** §3.22 trigger→condition→action rules. */
export interface AdminiumAutomationsTable {
  id: Id;
  /** NULL = meta-level automation. */
  connectionId: Id | null;
  name: string;
  description: string | null;
  enabled: BoolColumn;
  trigger: JsonColumn;
  graph: JsonColumn;
  lastRunAt: Ts | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.23 */
export interface AdminiumAutomationRunsTable {
  id: Id;
  automationId: Id;
  /** Soft ref — job rows are GC'd sooner. */
  jobId: string | null;
  /** running | succeeded | failed | skipped */
  status: string;
  triggerEvent: JsonColumn;
  trace: JsonColumn | null;
  error: string | null;
  startedAt: Ts;
  finishedAt: Ts | null;
}

/** §3.24 */
export interface AdminiumScheduledReportsTable {
  id: Id;
  pageId: Id;
  name: string;
  schedule: JsonColumn;
  recipients: JsonColumn;
  /** pdf | png */
  format: string;
  enabled: BoolColumn;
  lastRunAt: Ts | null;
  nextRunAt: Ts | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.25 */
export interface AdminiumExportsTable {
  id: Id;
  connectionId: Id | null;
  requestedBy: Id;
  source: JsonColumn;
  /** csv | json | xlsx */
  format: string;
  /** processing | ready | failed | cancelled | expired */
  status: string;
  fileId: Id | null;
  rowCount: number | null;
  error: string | null;
  createdAt: Ts;
  completedAt: Ts | null;
  expiresAt: Ts | null;
}

/** §3.26 import wizard state. */
export interface AdminiumImportsTable {
  id: Id;
  connectionId: Id;
  tableName: string;
  requestedBy: Id;
  fileId: Id;
  mapping: JsonColumn;
  options: JsonColumn;
  /** validating | ready | running | succeeded | failed | cancelled */
  status: string;
  stats: JsonColumn | null;
  errorReportFileId: Id | null;
  createdAt: Ts;
  startedAt: Ts | null;
  finishedAt: Ts | null;
}

/** §3.28 overrides of built-in email templates; unique (key, locale). */
export interface AdminiumEmailTemplatesTable {
  id: Id;
  key: string;
  locale: string;
  name: string;
  subject: string;
  blocks: JsonColumn;
  enabled: BoolColumn;
  isBuiltinCopy: BoolColumn;
  updatedBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.29 */
export interface AdminiumWebhooksTable {
  id: Id;
  name: string;
  url: string;
  secretEncrypted: string;
  events: JsonColumn;
  enabled: BoolColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.30 */
export interface AdminiumWebhookDeliveriesTable {
  id: Id;
  webhookId: Id;
  event: string;
  payload: JsonColumn;
  attempt: number;
  success: BoolColumn;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  createdAt: Ts;
}

/** §3.31 */
export interface AdminiumFeatureFlagsTable {
  id: Id;
  key: string;
  name: string;
  description: string | null;
  environments: JsonColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** §3.32 installed micro-SaaS modules. */
export interface AdminiumManifestsTable {
  id: Id;
  manifestKey: string;
  version: string;
  /** marketplace | file */
  source: string;
  manifest: JsonColumn;
  licenseKeyEncrypted: string | null;
  connectionId: Id | null;
  /** installed | disabled | error */
  status: string;
  installedBy: Id | null;
  installedAt: Ts;
  updatedAt: Ts;
}

/** §3.33 drives the sidebar "what's new" badge. PK user_id. */
export interface AdminiumChangelogSeenTable {
  userId: Id;
  version: string;
  seenAt: Ts;
}

// ---------------------------------------------------------------------------

/** The full meta-store database — every adminium_* table (BRIEF §6). */
export interface MetaDB {
  adminium_migrations: AdminiumMigrationsTable;
  adminium_settings: AdminiumSettingsTable;
  adminium_users: AdminiumUsersTable;
  adminium_user_prefs: AdminiumUserPrefsTable;
  adminium_sessions: AdminiumSessionsTable;
  adminium_password_resets: AdminiumPasswordResetsTable;
  adminium_roles: AdminiumRolesTable;
  adminium_role_permissions: AdminiumRolePermissionsTable;
  adminium_user_roles: AdminiumUserRolesTable;
  adminium_api_keys: AdminiumApiKeysTable;
  adminium_files: AdminiumFilesTable;
  adminium_connections: AdminiumConnectionsTable;
  adminium_schema_snapshots: AdminiumSchemaSnapshotsTable;
  adminium_schema_overrides: AdminiumSchemaOverridesTable;
  adminium_pages: AdminiumPagesTable;
  adminium_views: AdminiumViewsTable;
  adminium_jobs: AdminiumJobsTable;
  adminium_audit_log: AdminiumAuditLogTable;
  adminium_notifications: AdminiumNotificationsTable;
  adminium_notification_prefs: AdminiumNotificationPrefsTable;
  adminium_llm_runs: AdminiumLlmRunsTable;
  adminium_automations: AdminiumAutomationsTable;
  adminium_automation_runs: AdminiumAutomationRunsTable;
  adminium_scheduled_reports: AdminiumScheduledReportsTable;
  adminium_exports: AdminiumExportsTable;
  adminium_imports: AdminiumImportsTable;
  adminium_email_templates: AdminiumEmailTemplatesTable;
  adminium_webhooks: AdminiumWebhooksTable;
  adminium_webhook_deliveries: AdminiumWebhookDeliveriesTable;
  adminium_feature_flags: AdminiumFeatureFlagsTable;
  adminium_manifests: AdminiumManifestsTable;
  adminium_changelog_seen: AdminiumChangelogSeenTable;
}

/** Every physical table name, in dependency-safe creation order. */
export const META_TABLE_NAMES = [
  'adminium_migrations',
  'adminium_users',
  'adminium_user_prefs',
  'adminium_sessions',
  'adminium_password_resets',
  'adminium_settings',
  'adminium_roles',
  'adminium_role_permissions',
  'adminium_user_roles',
  'adminium_api_keys',
  'adminium_files',
  'adminium_connections',
  'adminium_schema_snapshots',
  'adminium_schema_overrides',
  'adminium_pages',
  'adminium_views',
  'adminium_jobs',
  'adminium_audit_log',
  'adminium_notifications',
  'adminium_notification_prefs',
  'adminium_llm_runs',
  'adminium_automations',
  'adminium_automation_runs',
  'adminium_scheduled_reports',
  'adminium_exports',
  'adminium_imports',
  'adminium_email_templates',
  'adminium_webhooks',
  'adminium_webhook_deliveries',
  'adminium_feature_flags',
  'adminium_manifests',
  'adminium_changelog_seen',
] as const satisfies readonly (keyof MetaDB)[];
