// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kysely `MetaDB` interface — one table interface per adminium_* table
 * (BRIEF: 32 names, 31 physical tables + the `adminium_migrations` ledger;
 * `adminium_dashboards` is NOT a physical table — dashboards are
 * `adminium_pages` rows with `type='page-dashboard'`).
 *
 * The meta Kysely instance runs with `CamelCasePlugin`, so properties here are
 * camelCase while physical columns are snake_case.
 *
 * Column-type conventions:
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

/** migration ledger — owned exclusively by the runner. */
export interface AdminiumMigrationsTable {
  /** PK; migration basename, e.g. `0001_core_auth`. */
  name: string;
  /** SHA-256 of the migration contents at apply time. */
  checksum: string;
  appliedAt: Ts;
  durationMs: number;
  adminiumVersion: string;
}

/** global defaults — explicit super-admin overrides only. */
export interface AdminiumSettingsTable {
  /** PK; namespaced key, e.g. `appearance.accent`. */
  key: string;
  value: JsonColumn;
  updatedAt: Ts;
  updatedBy: Id | null;
}

/** One row per person who can sign in. */
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

/** one row per user; NULL axis = inherit. */
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

/** opaque session tokens — only the SHA-256 of the cookie value is stored. */
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

/** password-reset + invite-activation tokens. */
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

/** Named permission bundles; the built-ins ship with the store. */
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

/** per-table / per-page / system permission matrix. */
export interface AdminiumRolePermissionsTable {
  id: Id;
  roleId: Id;
  /** table | page | system */
  resourceKind: string;
  /** table: `<connectionId>/<schema.table>` · page: page id · system: action key. */
  resourceRef: string;
  actions: JsonColumn;
}

/** composite PK (user_id, role_id). */
export interface AdminiumUserRolesTable {
  userId: Id;
  roleId: Id;
  grantedBy: Id | null;
  createdAt: Ts;
}

/** Stripe-style keys; secret shown once, only hash stored. */
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

/** metadata for binaries Adminium itself stores. */
export interface AdminiumFilesTable {
  id: Id;
  /**
   * The driver that wrote the bytes, informational since 0024 —
   * `destination_id` is the authority. `'local'` on every pre-0024 row and
   * on every row that still lives on this server's disk.
   */
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
  // ── wave 0024 ─────────────────────────────────────────────────────────────
  /** NULL = this server's disk, the implicit destination. */
  destinationId: Id | null;
  /** NULL = an upload no record claims yet; the sweep collects it. */
  attachedAt: Ts | null;
  /** Sidecar linkage, 0016's denormalised `keysOf` shape plus the connection. */
  entityConnectionId: Id | null;
  entityTable: string | null;
  entityId: string | null;
}

/** Where bytes may be written. */
export interface AdminiumStorageDestinationsTable {
  id: Id;
  name: string;
  /** local | s3 | webdav */
  driver: string;
  /** Non-secret driver config; Zod-validated in the repo. */
  config: JsonColumn;
  /** `enc:v1:` token; NULL for `local`, which has no credential. */
  secretEncrypted: string | null;
  isDefault: BoolColumn;
  /** untested | ok | error */
  status: string;
  lastTestedAt: Ts | null;
  lastError: string | null;
  /** Disabled ≠ deleted: takes no new files, still serves the ones it holds. */
  disabledAt: Ts | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** one row per configured source database. */
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
  /** Adapter remediation hint for {@link lastError} — never a secret. */
  lastErrorHint: string | null;
  /**
   * The BUSINESS's IANA zone — never the READER's. A `timestamptz` rendered
   * through the reader's zone puts a 15:00 booking at 16:00 with no error
   * anywhere, so a browser zone is never written here.
   *
   * `null` means "not configured". New rows rarely carry it: `create` seeds the
   * server's own zone so a hosted surface has something to render (0018), and
   * {@link timezoneSource} is what separates that seed from a real decision.
   */
  timezone: string | null;
  /**
   * Who chose {@link timezone}: `'operator'`, `'host'` (seeded from the server's
   * zone), or `null` for unknown — every row predating wave 0018 — which must
   * render as no claim rather than as a guess (see the migration).
   */
  timezoneSource: string | null;
  /** ISO-4217. Null when this business's data carries no money. */
  currency: string | null;
  /**
   * When an operator PAUSED this source (wave 0019); null while it is serving.
   *
   * Deliberately not a {@link status} value: status is a probe's reading and is
   * overwritten by the next test, whereas a pause is an intent that has to
   * survive one — see the migration.
   */
  disabledAt: Ts | null;
  /**
   * What the last capability probe said about DDL on this connection's role
   * (wave 0023). `null` = never probed, which every pre-0023 row is.
   *
   * A **UI hint**, not a guard: the Studio hides schema authoring without a
   * round trip. Whether a given step may run is decided per target at plan
   * time, because a role can own one table and not another and one boolean
   * cannot say so.
   */
  canDdl: BoolColumn | null;
  /**
   * Manual ER-diagram node positions (M18). Per connection rather than per
   * user — the diagram is a shared map — and its own column rather than a key
   * in {@link settings}, which is written whole under `connections.manage`.
   */
  diagramLayout: JsonColumn | null;
  /**
   * The key a project's `adminium.config.ts` names this database by (wave
   * 0033), e.g. `main`. Null when the connection belongs to no project.
   */
  projectKey: string | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * One applied (or attempted) DDL plan.
 *
 * The row is written `running` BEFORE the first statement (D3/): an apply is
 * re-runnable rather than transactional, because MySQL commits every DDL
 * statement implicitly, so a crash halfway must leave evidence rather than a
 * status that claims a state the database is not in.
 */
export interface AdminiumSchemaChangesTable {
  id: Id;
  connectionId: Id;
  /** The plan checksum the apply was authorised against. */
  planChecksum: string;
  /** running | applied | partial | failed */
  status: string;
  /** The ordered steps with their outcomes — Zod-validated in the repo. */
  steps: JsonColumn;
  /** Worst hazard in the plan, denormalised so a history list needs no parse. */
  hazard: string;
  baseSnapshotId: Id | null;
  /** The snapshot re-introspection produced; null until it does. */
  resultSnapshotId: Id | null;
  error: string | null;
  /**
   * Rows the operator confirmed they had seen before a rewrite ran (D18).
   *
   * NULL is the common case and is meaningful: most plans warn about no rows at
   * all, and 0 would read as "they acknowledged zero rows", which is a
   * different claim. Migration `0025`.
   */
  acknowledgedRows: number | null;
  createdBy: Id | null;
  startedAt: Ts;
  finishedAt: Ts | null;
}

/** immutable record of one introspection / schema-import run. */
export interface AdminiumSchemaSnapshotsTable {
  id: Id;
  connectionId: Id;
  /** introspection | schema-import */
  source: string;
  importFormat: string | null;
  engineVersion: string | null;
  /** Normalized schema model — opaque here. */
  schema: JsonColumn;
  stats: JsonColumn | null;
  checksum: string;
  /** Exactly one active per connection (app-enforced in a transaction). */
  isActive: BoolColumn;
  createdBy: Id | null;
  createdAt: Ts;
}

/** one row = one correction op layered over the active snapshot. */
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
  /**
   * Per-suggestion model confidence for `origin: 'llm'` rows (0008); NULL for
   * user-remap rows. Insert-optional so `overridesRepo` need not set it.
   */
  confidence: ColumnType<number | null, number | null | undefined, number | null>;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0004 — pages & views
// ---------------------------------------------------------------------------

/** every navigable page of the Generated App, dashboards included. */
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
  /** Opaque validated envelope — validation lives at the server route layer. */
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

/** saved filters/layouts. NULL user_id = shared workspace view. */
export interface AdminiumViewsTable {
  id: Id;
  pageId: Id;
  userId: Id | null;
  /** `'filters'` (saved page-crud grid state) | `'layout'` (per-user dashboard override). */
  kind: string;
  name: string;
  config: JsonColumn;
  isDefault: BoolColumn;
  createdAt: Ts;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0005 — ops (jobs / audit / notifications)
// ---------------------------------------------------------------------------

/** table-backed job queue (no Redis). */
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

/** append-only audit trail; actor label denormalized. */
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
  /**
   * Denormalized from `entity` at write time (WS-A) so the per-record
   * activity feed is an indexed lookup, not a JSON scan: the ref's qualified
   * table and its canonical record-id string (`pkLabel` form), both clamped
   * by `auditEntityKeyPart`. Null when the entry has no record entity.
   */
  entityTable: string | null;
  entityId: string | null;
  /** { before, after }; capped at 16 KB serialized. */
  changes: JsonColumn | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** One in-app notification, per user. */
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

/** composite PK (user_id, event_key). */
export interface AdminiumNotificationPrefsTable {
  userId: Id;
  eventKey: string;
  channels: JsonColumn;
  updatedAt: Ts;
}

// ---------------------------------------------------------------------------
// wave 0006 — platform (llm / automation / delivery / marketplace)
// ---------------------------------------------------------------------------

/**
 * One enrichment attempt (provider API or BYO paste). Columns through
 * `duration_ms` ship in 0006; 0007_llm_runs adds the run-lifecycle machine
 * (`status`), the builder inputs (`sections`, `locales`, `sampling`), chunk
 * progress, the flattened `prompt_text`, and the `review` id-lists. `mode`
 * ('provider' | 'byo') is the path discriminator the doc calls `path`;
 * `validation_status` is kept as a secondary validation-outcome signal (see
 * json-payloads.ts).
 */
export interface AdminiumLlmRunsTable {
  id: Id;
  connectionId: Id;
  snapshotId: Id;
  /** provider | byo — the `path` discriminator. */
  mode: string;
  /** NULL for BYO runs — never recorded (telemetry-free guarantee). */
  provider: string | null;
  model: string | null;
  promptVersion: string;
  promptHash: string;
  /** Full flattened prompt(s); enables re-download of BYO prompts (0007). */
  promptText: string | null;
  /** Requested decision groups — json string array (0007). */
  sections: JsonColumn | null;
  /** Requested output locales — json string array (0007). */
  locales: JsonColumn | null;
  /** Sampling opt-in: null = sample-free; else `{ maxValuesPerColumn }` (0007).
   * */
  sampling: JsonColumn | null;
  /** 1/1 when unchunked (0007). */
  chunksTotal: number;
  chunksReceived: number;
  responseRaw: string | null;
  responseJson: JsonColumn | null;
  /**
   * draft | running | awaiting_response | validated | applied |
   * partially_applied | failed | discarded — the machine
   * (0007).
   */
  status: string;
  /** pending | valid | partial | invalid — last-validation outcome (0006). */
  validationStatus: string;
  validationErrors: JsonColumn | null;
  /** Accepted/rejected suggestion-id lists — json (0007). */
  review: JsonColumn | null;
  appliedAt: Ts | null;
  appliedBy: Id | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  createdBy: Id | null;
  createdAt: Ts;
}

/** trigger→condition→action rules. */
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
  /** Next schedule tick; NULL for record-triggered rules (0028). */
  nextRunAt: Ts | null;
  /** `{ value, frontierPk }` — the watch poller's keyset position (0028). */
  watchCursor: JsonColumn | null;
  /** The comp's ROI segment; NULL = not stated (0028, 42 F6). */
  timeSavedMinutes: number | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** One run of one automation, with its outcome. */
export interface AdminiumAutomationRunsTable {
  id: Id;
  automationId: Id;
  /** Soft ref — job rows are GC'd sooner. */
  jobId: string | null;
  /** pending | running | waiting | succeeded | failed | skipped | cancelled. */
  status: string;
  triggerEvent: JsonColumn;
  trace: JsonColumn | null;
  error: string | null;
  /** UNIQUE occurrence identity; NULL = nothing to collapse on (0028). */
  dedupeKey: string | null;
  /** When a pending/waiting run resumes (0028). */
  wakeAt: Ts | null;
  /** Sum of step durations, waits excluded (0028). */
  durationMs: number | null;
  /** dashboard | public | bulk | watch | schedule | test | automation (0028). */
  origin: string;
  startedAt: Ts;
  finishedAt: Ts | null;
}

/** A page, on a schedule, delivered as a file. */
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

/** One export job and the artifact it produced. */
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

/** import wizard state. */
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

/**
 * Email documents — templates AND campaigns; unique (key, locale). Wave 0026 added everything after
 * `updatedBy`. Status is derived, never stored: a template's Draft/Live is
 * `enabled`, a campaign's is its latest `adminium_email_runs` row.
 */
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
  /** template | campaign */
  kind: string;
  /** transactional | lifecycle | marketing */
  category: string;
  /** Which starter minted the family; NULL for blank and built-in documents. */
  starter: string | null;
  needsTranslation: BoolColumn;
  /** Delete is archive. */
  archivedAt: Ts | null;
  preheader: string;
  /** NULL reads as '' (MySQL forbids a DEFAULT on text). */
  footer: string | null;
  /** `EmailBrand`; NULL = workspace defaults. */
  brand: JsonColumn | null;
  /** `EmailAttachment[]`; NULL reads as []. */
  attachments: JsonColumn | null;
  createdBy: Id | null;
}

/** Saved reusable email blocks, workspace-wide. */
export interface AdminiumEmailBlocksTable {
  id: Id;
  name: string;
  /** One `{ id, block, data, style }` record. */
  block: JsonColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** One row per campaign send; counts, never per-recipient rows. */
export interface AdminiumEmailRunsTable {
  id: Id;
  templateId: Id;
  /** scheduled | running | sent | failed | cancelled */
  status: string;
  /** `EmailAudience` */
  audience: JsonColumn;
  scheduledAt: Ts;
  startedAt: Ts | null;
  finishedAt: Ts | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /** ≤100 `{ to, error }` records. */
  failures: JsonColumn | null;
  jobId: Id | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * The AUTHORED invoice source behind `/invoices` (wave 0027): one row per
 * template or invoice, the same envelope in `body`. Not the render register
 * (`adminium_documents`, — a later wave). `(topic, lang)` names one member of
 * a language family; `position` is the manager's sort key; `origin_id` is a
 * soft ref with no FK.
 */
/**
 * The operator's answer to "which columns of which table make one of these
 * documents". Generated in Studio from the provider's own
 * `describe(kind)`, so the slot ids inside `mapping` are the PROVIDER's
 * vocabulary and this table never has an opinion about them.
 */
export interface AdminiumDocumentProfilesTable {
  id: Id;
  /** SOFT ref to `manifests.manifestKey` — no FK, so uninstall cannot cascade. */
  addOnKey: string;
  /** The provider's kind: `invoice`, `receipt`, `label-sheet`. */
  kind: string;
  name: string;
  connectionId: Id;
  /** Qualified source name, e.g. `public.orders`. */
  table: string;
  /** `{ slotId → {column} | {ref, column} | {collection: {...}} }`. */
  mapping: JsonColumn;
  /** Prefix, paper, formats, locale. */
  options: JsonColumn;
  /** `{event, when?}` or NULL when nothing fires this profile. */
  trigger: JsonColumn | null;
  /** `{store, email?, writeBack?}`. */
  deliver: JsonColumn;
  enabled: BoolColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * THE REGISTER: what was ISSUED, frozen.
 *
 * Not `adminium_invoice_documents`, which holds what a person typed and can
 * edit again. A row here carries the whole `subject` it was rendered from, so
 * a document stays what it was after the source row is edited, archived or
 * deleted — which is the only behaviour an issued document can have.
 */
export interface AdminiumDocumentsTable {
  id: Id;
  /** SET NULL, never CASCADE — a deleted profile must not unmake a document. */
  profileId: Id | null;
  addOnKey: string;
  kind: string;
  connectionId: Id | null;
  /** The full `RecordRef`; NULL for a request-shaped intent. */
  entity: JsonColumn | null;
  /** Denormalised from `entity` for the index (the 0016 pattern). */
  entityTable: string | null;
  entityId: string | null;
  /** The frozen `DocumentSubject`. */
  subject: JsonColumn;
  /** NULL until a render succeeds and the CAS claims one. */
  number: string | null;
  fileId: Id | null;
  htmlFileId: Id | null;
  locale: string;
  format: string;
  /** rendered | failed | voided | skipped */
  status: string;
  error: string | null;
  /** sent | pending-review | not-sent:smtp-unconfigured | not-sent:no-email | skipped */
  delivery: string | null;
  sentAt: Ts | null;
  /** Soft ref — a job row is pruned long before the document is. */
  jobId: Id | null;
  requestedBy: Id | null;
  /** user | system | api-key */
  actorKind: string;
  /** `{column, value}`, stamped LAST for an intent row. */
  claim: JsonColumn | null;
  renderedAt: Ts | null;
  voidedAt: Ts | null;
  voidReason: string | null;
  createdAt: Ts;
}

/**
 * The number source, claimed by compare-and-set. `key` is a profile id, or
 * `<addOnKey>:<kind>:<connectionId>` for a profile-less intent.
 */
export interface AdminiumDocumentSequencesTable {
  key: string;
  next: number;
  updatedAt: Ts;
}

/**
 * An add-on's own NON-SECRET values — the settings panel's store.
 *
 * A secret never lands here: it belongs in 0021's encrypted credentials
 * table, and the repo refuses a key the manifest marks `secret` so a mistake
 * at the route layer cannot put one in a table read back in clear.
 */
export interface AdminiumAddOnSettingsTable {
  /** SOFT ref to `manifests.manifestKey` — no FK. */
  addOnKey: string;
  values: JsonColumn;
  updatedBy: Id | null;
  updatedAt: Ts;
}

export interface AdminiumInvoiceDocumentsTable {
  id: Id;
  /** template | invoice */
  kind: string;
  name: string;
  /** draft | sent | paid | live | overdue — the comp's five, shared by both kinds. */
  status: string;
  /** recurring | services | receipts | sales | logistics | other */
  topic: string;
  /** en | de | fr | es | pt | ja */
  lang: string;
  /** Denormalised from `body.number`. */
  number: string;
  /** Which starter minted it; NULL for blank documents. */
  starter: string | null;
  /** The template an invoice was built from; no FK on purpose. */
  originId: Id | null;
  position: number;
  /** The envelope (`InvoiceBody` on the server). */
  body: JsonColumn;
  /** `InvoiceSummary` — the card facts, written on every save. */
  summary: JsonColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** The authored report source behind `/report-builder`. */
export interface AdminiumReportDocumentsTable {
  id: Id;
  /** template | report */
  kind: string;
  name: string;
  /** draft | sent | live — the comp's three, shared by both kinds. */
  status: string;
  /** Which starter minted it; NULL for blank documents. */
  starter: string | null;
  /** The template a report was built from; no FK on purpose. */
  originId: Id | null;
  position: number;
  /** The envelope (`ReportBody` on the server) — header plus a block ARRAY. */
  body: JsonColumn;
  /** `ReportSummary` — the card facts, written on every save. */
  summary: JsonColumn;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * Runtime locale registry. SPARSE: a built-in locale has a row only when an
 * admin deviates from the compiled defaults, and on such a row only
 * `enabled`/`sortOrder` are writable (the rest are read from the compiled
 * registry). Custom locales carry the full record.
 */
export interface AdminiumLocalesTable {
  id: Id;
  locale: string;
  isBuiltin: BoolColumn;
  enabled: BoolColumn;
  sortOrder: number;
  english: string | null;
  native: string | null;
  /** 'ltr' | 'rtl' — custom locales only. */
  dir: string | null;
  /** latin | arabic | cjk — custom locales only. */
  fontHint: string | null;
  /** Real BCP-47 tag a custom locale borrows Intl behaviour from. */
  intlTag: string | null;
  pluralCategories: JsonColumn | null;
  updatedBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * Sparse UI-string override overlay; unique (scope, locale,
 * namespace, key). No row = built-in; row with text = override; row
 * with '' = deliberately blank.
 */
export interface AdminiumTranslationsTable {
  id: Id;
  /** Reserved for a possible per-app string set; always 'workspace' in v1. */
  scope: string;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  /** en-US source this override was authored against (staleness badge). */
  sourceText: string | null;
  updatedBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** An outbound webhook subscription. */
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

/** One delivery attempt of one webhook, with its response. */
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

/** Feature flags, evaluated per workspace. */
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

/** installed micro-SaaS modules. */
export interface AdminiumManifestsTable {
  id: Id;
  manifestKey: string;
  version: string;
  /** marketplace | file */
  source: string;
  manifest: JsonColumn;
  /**
   * 17 defers licences BY NAME, so nothing reads or writes this. Shipped in
   * 0006 and left in place by 0020 rather than dropped: it is empty, and
   * dropping a column is the one thing a migration cannot take back.
   */
  licenseKeyEncrypted: string | null;
  connectionId: Id | null;
  /** installed | disabled | error */
  status: string;
  /** app | add-on (`@adminium/manifest` MANIFEST_KINDS). Added by 0020. */
  kind: string;
  /**
   * `sha512-<base64>` of the copy held in the storage destination, or NULL when
   * no copy is held — no destination configured, or a row predating 0037.
   *
   * The destination's own listing cannot stand in for this: it is not a record
   * of what was installed, so a pruned or edited bucket would be obeyed rather
   * than detected. Added by 0037.
   */
  packageIntegrity: string | null;
  /**
   * The `adminium_files` row holding that copy (`kind = 'package'`, which keeps
   * it out of the upload sweep). NULL exactly when `packageIntegrity` is.
   * Added by 0037.
   */
  packageFileId: Id | null;
  installedBy: Id | null;
  installedAt: Ts;
  updatedAt: Ts;
}

/**
 * Which host apps an installed add-on is attached to, and whether it is on for
 * each (as amended, O3 resolved to a join table — see `0020`'s header).
 *
 * `attached_to` holds the HOST's `manifest_key` by value rather than by FK: a
 * generated app is not necessarily a row in `adminium_manifests` (only an
 * INSTALLED micro-SaaS is), so an FK here would refuse the ordinary case.
 */
export interface AdminiumManifestAttachmentsTable {
  id: Id;
  manifestId: Id;
  /** The host app's `manifest_key`. */
  attachedTo: string;
  /** NULL = enabled on this host; epoch ms when it was switched off. */
  disabledAt: Ts | null;
  createdAt: Ts;
}

/**
 * The secret a connected add-on was given — one row per connected add-on, never
 * per attachment (see `0021`'s header).
 *
 * `payload` is AES-256-GCM ciphertext over the whole envelope; `expiresAt` and
 * `scopes` sit outside it because deciding whether to refresh must not require
 * decrypting a token. Deleted on disconnect, which keeps every table the add-on
 * brought.
 */
export interface AdminiumAddOnCredentialsTable {
  id: Id;
  manifestId: Id;
  /** api-key | oauth2 */
  kind: string;
  /** AES-256-GCM ciphertext. Never logged, never served to a browser. */
  payload: string;
  expiresAt: Ts | null;
  scopes: JsonColumn | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** drives the sidebar "what's new" badge. PK user_id. */
export interface AdminiumChangelogSeenTable {
  userId: Id;
  version: string;
  seenAt: Ts;
}

/**
 * The scope document.
 *
 * One row per (connection, side) the operator publishes. `document` holds the
 * resources, their logical refs, the `expose` allow-list and the mandatory
 * predicate; it is re-validated by `compileScope` on every read from disk and
 * never trusted.
 */
export interface AdminiumPublicScopesTable {
  id: Id;
  connectionId: Id;
  /** `staff` | `customer` — the `frontends[]` side this scope serves. */
  side: string;
  name: string;
  /**
   * IANA zone. A COLUMN rather than a `document` field because the serializer
   * needs it without parsing the whole document first.
   */
  timezone: string;
  document: string;
  /** Manifest key this was seeded from, or null when authored in Studio (O2). */
  proposedFromManifest: string | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * The publishable key.
 *
 * Separate from `adminium_api_keys` on two load-bearing properties: the secret
 * is re-readable (it lives in a public bundle and must survive a rebuild), and
 * a token from this table is never an `RbacPrincipal`, which is what makes it
 * inert on every other route by construction.
 */
export interface AdminiumPublicKeysTable {
  id: Id;
  name: string;
  /** Display fragment, e.g. `adm_pub_4f2a91cd`. */
  prefix: string;
  tokenHash: string;
  /** AES-GCM envelope — the re-readable copy. Never leaves the server as-is. */
  tokenEncrypted: string;
  scopeId: Id;
  side: string;
  /**
   * Manifest key of the hosted app surface this key is bound to, or null for a
   * key that serves no hosted surface (standalone builds, integrations). Read
   * by the `surface-config.json` route to pick the newest live customer key
   * for an app; never a principal, like the key itself.
   */
  appKey: string | null;
  /** JSON string array narrowing `ADMINIUM_PUBLIC_API_ORIGINS`; `[]` = no narrowing. */
  origins: string;
  expiresAt: Ts | null;
  revokedAt: Ts | null;
  lastUsedAt: Ts | null;
  createdBy: Id | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/**
 * The end-customer session.
 *
 * There is deliberately no `userId`: an end customer is not an
 * `adminium_users` row, and this table is the whole of what a claimed customer
 * is. `grants` is stored RESOLVED so editing a scope cannot retroactively widen
 * a session already in someone's browser.
 */
export interface AdminiumPublicSessionsTable {
  id: Id;
  keyId: Id;
  tokenHash: string;
  grants: string;
  expiresAt: Ts;
  createdAt: Ts;
  lastSeenAt: Ts | null;
}

/** One-time challenge for the `email-code` tier. */
export interface AdminiumPublicChallengesTable {
  id: Id;
  keyId: Id;
  ref: string;
  /** Hashed, not stored plain — a challenge table is otherwise a customer address list. */
  destinationHash: string;
  codeHash: string;
  /** On the row, not in the in-process limiter, so the bound survives a restart. */
  attempts: number;
  consumedAt: Ts | null;
  expiresAt: Ts;
  createdAt: Ts;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// wave 0034 — project files
// ---------------------------------------------------------------------------

/**
 * What this instance last applied from a project folder, one row per file
 * (`pages/<slug>.json`, `schema/<database>.json`). See migration 0034.
 */
export interface AdminiumProjectFilesTable {
  /** The file path inside the project, with `/`. */
  path: string;
  /** Hash of the version last applied or written; `''` when none was agreed on. */
  hash: string;
  appliedAt: Ts;
  /** When this server first noticed its copy differs from `hash`; NULL while they agree. */
  serverEditedAt: Ts | null;
  /** Hash of this server's copy at that time, or `deleted`; NULL while they agree. */
  serverHash: string | null;
}

// ---------------------------------------------------------------------------
// wave 0035 — option lists
// ---------------------------------------------------------------------------

/**
 * A named set of answers a column accepts. Referenced by `key`,
 * never by id, because a `column.options` rule travels in a project file and
 * plan 49's gate refuses an instance id in one.
 */
export interface AdminiumOptionListsTable {
  id: string;
  /** The slug a rule names, unique in the workspace. */
  key: string;
  name: string;
  /** JSON `[{ value, label?, tone?, description? }]`, in the order they render. */
  items: string;
  /** `custom`, or `copy:<builtin key>` for an editable copy of a built-in. */
  origin: string;
  createdAt: Ts;
  updatedAt: Ts;
}

/** The full meta-store database — every adminium_* table (BRIEF). */
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
  adminium_storage_destinations: AdminiumStorageDestinationsTable;
  adminium_connections: AdminiumConnectionsTable;
  adminium_schema_snapshots: AdminiumSchemaSnapshotsTable;
  adminium_schema_overrides: AdminiumSchemaOverridesTable;
  adminium_schema_changes: AdminiumSchemaChangesTable;
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
  adminium_email_blocks: AdminiumEmailBlocksTable;
  adminium_email_runs: AdminiumEmailRunsTable;
  adminium_invoice_documents: AdminiumInvoiceDocumentsTable;
  adminium_report_documents: AdminiumReportDocumentsTable;
  adminium_document_profiles: AdminiumDocumentProfilesTable;
  adminium_documents: AdminiumDocumentsTable;
  adminium_document_sequences: AdminiumDocumentSequencesTable;
  adminium_add_on_settings: AdminiumAddOnSettingsTable;
  adminium_webhooks: AdminiumWebhooksTable;
  adminium_webhook_deliveries: AdminiumWebhookDeliveriesTable;
  adminium_feature_flags: AdminiumFeatureFlagsTable;
  adminium_manifests: AdminiumManifestsTable;
  adminium_manifest_attachments: AdminiumManifestAttachmentsTable;
  adminium_add_on_credentials: AdminiumAddOnCredentialsTable;
  adminium_changelog_seen: AdminiumChangelogSeenTable;
  adminium_locales: AdminiumLocalesTable;
  adminium_translations: AdminiumTranslationsTable;
  adminium_public_scopes: AdminiumPublicScopesTable;
  adminium_public_keys: AdminiumPublicKeysTable;
  adminium_public_sessions: AdminiumPublicSessionsTable;
  adminium_public_challenges: AdminiumPublicChallengesTable;
  adminium_project_files: AdminiumProjectFilesTable;
  adminium_option_lists: AdminiumOptionListsTable;
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
  'adminium_storage_destinations',
  'adminium_files',
  'adminium_connections',
  'adminium_schema_snapshots',
  'adminium_schema_overrides',
  'adminium_schema_changes',
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
  'adminium_email_blocks',
  'adminium_email_runs',
  'adminium_invoice_documents',
  'adminium_report_documents',
  'adminium_document_profiles',
  'adminium_documents',
  'adminium_document_sequences',
  'adminium_add_on_settings',
  'adminium_webhooks',
  'adminium_webhook_deliveries',
  'adminium_feature_flags',
  'adminium_manifests',
  'adminium_manifest_attachments',
  'adminium_add_on_credentials',
  'adminium_changelog_seen',
  'adminium_locales',
  'adminium_translations',
  'adminium_public_scopes',
  'adminium_public_keys',
  'adminium_public_sessions',
  'adminium_public_challenges',
  'adminium_project_files',
  'adminium_option_lists',
] as const satisfies readonly (keyof MetaDB)[];
