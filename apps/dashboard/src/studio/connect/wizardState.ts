/**
 * Connect-wizard state + pure rules (09-generated-app.md §8.2,
 * M5-T01/02/03 + M9-T04).
 *
 * Everything decision-shaped lives here so the step components stay thin and
 * the rules are unit-testable without a DOM:
 * - engine picker rules (M9-T04): DSN scheme ↔ picker sync, scheme rewrite
 *   on engine switch, per-engine default ports, SQLite file-path form,
 * - DSN scheme validation / engine inference and the fields→DSN composer,
 * - provider quick-fill chips (ia-mapping §4 Surface B keepers), filtered
 *   per engine — the postgres row stays postgres-relevant only,
 * - schema-file format choice (8 formats + auto-detect, M9-T03/T04),
 * - table-inclusion defaults (high-volume > 100k unchecked; join/system
 *   pre-hidden — 09 §8.2 step 3),
 * - meta-placement gating (read-only or DDL-less source ⇒ same-DB disabled,
 *   01-architecture.md §3.1),
 * - AdapterError code → remediation copy mapping,
 * - sessionStorage persistence (refresh-safe wizard, §8.2).
 */
import { getFormatters } from '@adminium/i18n';

import type { ConnectionEngine, DsnPrivileges, GenerateIntent, SchemaTable } from '../api.js';
import { getI18nInstance, t } from '../../i18n/t.js';

// --- steps -------------------------------------------------------------------

export const WIZARD_STEP_IDS = ['intent', 'source', 'test', 'tables', 'meta', 'generate'] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export function wizardStepLabel(id: WizardStepId): string {
  switch (id) {
    case 'intent':
      return t('studio.wizard.step.intent', 'Intent');
    case 'source':
      return t('studio.wizard.step.source', 'Source');
    case 'test':
      return t('studio.wizard.step.test', 'Analyze');
    case 'tables':
      return t('studio.wizard.step.tables', 'Tables');
    case 'meta':
      return t('studio.wizard.step.meta', 'Meta storage');
    case 'generate':
      return t('studio.wizard.step.generate', 'Generate');
  }
}

// --- source mode -------------------------------------------------------------

export type SourceMode = 'dsn' | 'fields' | 'file';
export type SslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

/** Live engines the picker offers (M9-T04, gap-analysis §2.1). */
export const SOURCE_ENGINES: readonly ConnectionEngine[] = ['postgres', 'mysql', 'sqlite'];

export function engineLabel(engine: ConnectionEngine): string {
  switch (engine) {
    case 'postgres':
      return t('studio.source.engine.postgres', 'PostgreSQL');
    case 'mysql':
      return t('studio.source.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('studio.source.engine.sqlite', 'SQLite');
  }
}

/** Network engines only — SQLite is file-path based (05 §4.3). */
export const DEFAULT_PORTS: Readonly<Record<ConnectionEngine, string>> = {
  postgres: '5432',
  mysql: '3306',
  sqlite: '',
};

export function dsnPlaceholder(engine: ConnectionEngine): string {
  switch (engine) {
    case 'postgres':
      return 'postgres://user:password@host:5432/database';
    case 'mysql':
      return 'mysql://user:password@host:3306/database';
    case 'sqlite':
      return 'sqlite:/absolute/path/app.db';
  }
}

export interface FieldsInput {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: SslMode;
  /** SQLite only — absolute database file path (05 §4.3). */
  file: string;
}

export const EMPTY_FIELDS: FieldsInput = {
  host: '',
  port: '5432',
  database: '',
  user: '',
  password: '',
  ssl: 'require',
  file: '',
};

/** DSN scheme → engine (live validation on the mono input). */
const SCHEME_ENGINES: ReadonlyArray<[RegExp, ConnectionEngine]> = [
  [/^postgres(ql)?:\/\//i, 'postgres'],
  [/^mysql:\/\//i, 'mysql'],
  [/^mariadb:\/\//i, 'mysql'],
  [/^sqlite:/i, 'sqlite'],
];

export function engineForDsn(dsn: string): ConnectionEngine | null {
  for (const [pattern, engine] of SCHEME_ENGINES) {
    if (pattern.test(dsn.trim())) return engine;
  }
  return null;
}

/** `null` when valid; a translated error otherwise. */
export function dsnValidationError(dsn: string): string | null {
  const trimmed = dsn.trim();
  if (trimmed.length === 0) return null; // empty = untouched, not invalid
  if (engineForDsn(trimmed) === null) {
    return t(
      'studio.source.dsn.invalidScheme',
      'Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:',
    );
  }
  if (/^(postgres|postgresql|mysql|mariadb):\/\/$/i.test(trimmed)) {
    return t('studio.source.dsn.incomplete', 'Add host and database, e.g. postgres://user@host:5432/db');
  }
  return null;
}

export function composeDsn(fields: FieldsInput, engine: ConnectionEngine = 'postgres'): string {
  if (engine === 'sqlite') return `sqlite:${fields.file.trim()}`;
  const user = fields.user.length > 0 ? encodeURIComponent(fields.user) : '';
  const password = fields.password.length > 0 ? `:${encodeURIComponent(fields.password)}` : '';
  const auth = user.length > 0 ? `${user}${password}@` : '';
  const port = fields.port.length > 0 ? `:${fields.port}` : '';
  // sslmode is a libpq concept — mysql2 takes TLS options outside the URI.
  const ssl = engine === 'postgres' && fields.ssl !== 'disable' ? `?sslmode=${fields.ssl}` : '';
  return `${engine}://${auth}${fields.host}${port}/${fields.database}${ssl}`;
}

/**
 * Rewrite a DSN's scheme to match a newly picked engine. Network engines
 * swap schemes in place; to/from SQLite (a file path, not host/port) there
 * is nothing meaningful to carry over — the input resets.
 */
export function dsnWithEngine(dsn: string, engine: ConnectionEngine): string {
  const trimmed = dsn.trim();
  if (trimmed.length === 0) return trimmed;
  const current = engineForDsn(trimmed);
  if (current === engine) return trimmed;
  if (current === null || current === 'sqlite' || engine === 'sqlite') return '';
  return trimmed.replace(/^[a-z]+:\/\//i, `${engine}://`);
}

export interface ProviderChip {
  key: string;
  label: string;
  engine: ConnectionEngine;
  dsn: string;
}

/**
 * Quick-fill provider chips (Console + Connect Database comps), shown only
 * for the engine they belong to — the postgres row stays postgres-relevant
 * only (M9-T04).
 */
export const PROVIDER_CHIPS: readonly ProviderChip[] = [
  { key: 'supabase', label: 'Supabase', engine: 'postgres', dsn: 'postgres://postgres.PROJECT:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres' },
  { key: 'neon', label: 'Neon', engine: 'postgres', dsn: 'postgres://USER:PASSWORD@ep-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require' },
  { key: 'rds', label: 'RDS', engine: 'postgres', dsn: 'postgres://USER:PASSWORD@mydb.abc123.us-east-1.rds.amazonaws.com:5432/postgres' },
  { key: 'localhost', label: 'localhost', engine: 'postgres', dsn: 'postgres://postgres@localhost:5432/app_dev' },
  { key: 'planetscale', label: 'PlanetScale', engine: 'mysql', dsn: 'mysql://USER:PASSWORD@aws.connect.psdb.cloud/mydb?ssl={"rejectUnauthorized":true}' },
];

export function providerChipsFor(engine: ConnectionEngine): ProviderChip[] {
  return PROVIDER_CHIPS.filter((chip) => chip.engine === engine);
}

// --- schema-file format choice (M9-T03/T04) -----------------------------------

/**
 * Wizard-facing format vocabulary — MIRROR of `@adminium/schema-import`'s
 * `FORMATS` (the package pulls the TypeScript compiler for its AST parsers,
 * so the browser bundle never imports it; the server accepts these short
 * names directly). Change both together.
 */
export const FILE_FORMATS = ['sql', 'prisma', 'drizzle', 'typeorm', 'sequelize', 'rails', 'django', 'json'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];
export type FileFormatChoice = 'auto' | FileFormat;

/** Engine `ImportFormat` (reply vocabulary) → wizard short name. */
const IMPORT_FORMAT_TO_FILE: Readonly<Record<string, FileFormat>> = {
  'sql-ddl': 'sql',
  'json-ir': 'json',
  prisma: 'prisma',
  drizzle: 'drizzle',
  typeorm: 'typeorm',
  sequelize: 'sequelize',
  rails: 'rails',
  django: 'django',
};

export function fileFormatFromImportFormat(format: string): FileFormat | null {
  return IMPORT_FORMAT_TO_FILE[format] ?? null;
}

export function fileFormatLabel(format: FileFormat): string {
  switch (format) {
    case 'sql':
      return t('studio.source.format.sql', 'SQL DDL / pg_dump');
    case 'prisma':
      return t('studio.source.format.prisma', 'Prisma schema');
    case 'drizzle':
      return t('studio.source.format.drizzle', 'Drizzle ORM');
    case 'typeorm':
      return t('studio.source.format.typeorm', 'TypeORM entities');
    case 'sequelize':
      return t('studio.source.format.sequelize', 'Sequelize models');
    case 'rails':
      return t('studio.source.format.rails', 'Rails schema.rb');
    case 'django':
      return t('studio.source.format.django', 'Django models.py');
    case 'json':
      return t('studio.source.format.json', 'Adminium JSON');
  }
}

// --- table inclusion (M5-T02) --------------------------------------------------

/** 05: row estimate above this ⇒ ops-volume table ⇒ starts unchecked. */
export const HIGH_VOLUME_ROWS = 100_000;

export interface WizardTable {
  id: string;
  rowEstimate: number | null;
  /** Columns whose classifier flagged PII. */
  piiColumns: number;
  highVolume: boolean;
  /** Join/system tables are pre-hidden — never listed as includable. */
  preHidden: boolean;
}

export function summarizeTables(tables: readonly SchemaTable[]): WizardTable[] {
  return tables.map((table) => {
    const role = table.semantics?.role ?? 'entity';
    const rowEstimate = table.rowCountEstimate;
    return {
      id: table.id,
      rowEstimate,
      piiColumns: table.columns.filter((column) => {
        const pii = column.semantics?.flags?.pii;
        return pii !== null && pii !== undefined;
      }).length,
      highVolume: rowEstimate !== null && rowEstimate > HIGH_VOLUME_ROWS,
      preHidden: table.system === true || role === 'join-table' || role === 'system',
    };
  });
}

/** Default inclusion: everything visible except high-volume ops tables. */
export function defaultIncludedIds(tables: readonly WizardTable[]): string[] {
  return tables.filter((table) => !table.preHidden && !table.highVolume).map((table) => table.id);
}

/** How trustworthy row counts are for the source — @adminium/engine vocabulary. */
export type RowEstimateQuality = 'estimate' | 'approximate' | 'none';

/**
 * `1,234,567` in mono; `≈ 1,234,567` where the engine only estimates
 * approximately (MySQL TABLE_ROWS — 05 §4.2); `—` when the source cannot
 * provide counts at all (never wrong data — M9-T04).
 */
export function formatRowEstimate(estimate: number | null, quality: RowEstimateQuality = 'estimate'): string {
  if (estimate === null || quality === 'none') return '—';
  const tag = getI18nInstance()?.language ?? 'en-US';
  const formatted = getFormatters(tag).number(estimate);
  return quality === 'approximate' ? `≈ ${formatted}` : formatted;
}

// --- meta placement (M5-T03) ----------------------------------------------------

export type MetaPlacement = 'same-db' | 'separate-db';

/**
 * 01 §3.1 decision tree, wizard-side mirror of
 * `ConnectionManager.enforceMetaPlacement` (the server independently
 * re-validates — 409 META_PLACEMENT_INVALID on bypass).
 */
export function sameDbDisabledReason(input: {
  readOnly: boolean;
  privileges: DsnPrivileges | null;
  sourceIsFile: boolean;
}): string | null {
  if (input.sourceIsFile) {
    return t(
      'studio.meta.sameDb.disabledFile',
      'A schema file has no live database — choose a separate database for Adminium’s own tables.',
    );
  }
  if (input.readOnly || input.privileges?.canWrite === false) {
    return t(
      'studio.meta.sameDb.disabledReadOnly',
      'Your role is read-only — Adminium never writes to this database. Choose a separate database for Adminium’s own tables.',
    );
  }
  if (input.privileges !== null && !input.privileges.canDDL) {
    return t(
      'studio.meta.sameDb.disabledNoDdl',
      'This role cannot run DDL — Adminium migrations need CREATE TABLE. Choose a separate database for Adminium’s own tables.',
    );
  }
  return null;
}

// --- adapter error remediation ---------------------------------------------------

/** AdapterError code (05 §3) → remediation copy for the wizard error state. */
export function hintForErrorCode(code: string): string {
  switch (code) {
    case 'AUTH':
      return t('studio.test.hint.auth', 'Authentication failed — check the user name and password in your DSN.');
    case 'HOST_UNREACHABLE':
      return t(
        'studio.test.hint.hostUnreachable',
        'Host unreachable — check the hostname and port, and that the database accepts connections from this machine (allowlist our IPs).',
      );
    case 'TLS':
      return t(
        'studio.test.hint.tls',
        'TLS negotiation failed — try sslmode=require, or upload the CA certificate your server expects.',
      );
    case 'PERMISSION':
      return t(
        'studio.test.hint.permission',
        'The role connected but lacks schema-read privileges — grant USAGE on the schema to your introspection role.',
      );
    case 'TIMEOUT':
      return t('studio.test.hint.timeout', 'The database did not answer in time — check network path and load, then retry.');
    case 'META_PLACEMENT_INVALID':
      return t(
        'studio.test.hint.metaPlacement',
        'This source cannot host Adminium’s meta tables — continue with a separate meta database.',
      );
    default:
      return t('studio.test.hint.unknown', 'Connection failed — verify the DSN and retry.');
  }
}

// --- persisted state (refresh-safe wizard) -----------------------------------------

export interface WizardState {
  step: WizardStepId;
  intent: GenerateIntent;
  mode: SourceMode;
  /** Picked engine (M9-T04); DSN mode keeps this in sync with the scheme. */
  engine: ConnectionEngine;
  name: string;
  dsn: string;
  fields: FieldsInput;
  /** Schema-file format choice — 'auto' defers to server-side detection. */
  fileFormat: FileFormatChoice;
  /** Parse preview for the schema-file mode (summary only — the model stays server-validated). */
  filePreview: {
    fileName: string;
    /** Engine `ImportFormat` actually used ('sql-ddl', 'prisma', …). */
    format: string;
    /** True when the format came from auto-detection (vs forced by the user). */
    detected: boolean;
    tables: number;
    columns: number;
    warnings: string[];
  } | null;
  /** Set once step 3 created the connection. */
  connectionId: string | null;
  readOnly: boolean;
  privileges: DsnPrivileges | null;
  includedTables: string[] | null;
  metaPlacement: MetaPlacement | null;
  separateMetaDsn: string;
  separateMetaTested: boolean;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 'intent',
  intent: 'full-admin',
  mode: 'dsn',
  engine: 'postgres',
  name: '',
  dsn: '',
  fields: EMPTY_FIELDS,
  fileFormat: 'auto',
  filePreview: null,
  connectionId: null,
  readOnly: false,
  privileges: null,
  includedTables: null,
  metaPlacement: null,
  separateMetaDsn: '',
  separateMetaTested: false,
};

const STORAGE_KEY = 'adminium-studio-connect';

export function loadWizardState(): WizardState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return INITIAL_WIZARD_STATE;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    if (typeof parsed !== 'object' || parsed === null) return INITIAL_WIZARD_STATE;
    return {
      ...INITIAL_WIZARD_STATE,
      ...parsed,
      // Nested objects merge field-wise so states persisted before a shape
      // change (e.g. pre-M9 `fields` without `file`) stay well-formed.
      fields: { ...INITIAL_WIZARD_STATE.fields, ...(parsed.fields ?? {}) },
    };
  } catch {
    return INITIAL_WIZARD_STATE;
  }
}

export function saveWizardState(state: WizardState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/serialization failures degrade to a non-resumable wizard.
  }
}

export function clearWizardState(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --- engine picker rules (M9-T04) -----------------------------------------------------

/**
 * Patch for a DSN keystroke: the scheme is the source of truth in DSN mode,
 * so a recognized scheme drags the engine picker along.
 */
export function dsnInputPatch(dsn: string, currentEngine: ConnectionEngine): Partial<WizardState> {
  const inferred = engineForDsn(dsn);
  return { dsn, ...(inferred !== null && inferred !== currentEngine ? { engine: inferred } : {}) };
}

/**
 * Patch for an engine-picker click: rewrites the DSN scheme (network engines)
 * or resets it (to/from SQLite — file path, not host/port), and swaps the
 * fields-mode default port when the user has not customized it.
 */
export function enginePickPatch(state: WizardState, engine: ConnectionEngine): Partial<WizardState> {
  if (engine === state.engine) return {};
  const patch: Partial<WizardState> = { engine };
  if (state.fields.port === DEFAULT_PORTS[state.engine] || state.fields.port.length === 0) {
    patch.fields = { ...state.fields, port: DEFAULT_PORTS[engine] };
  }
  if (state.dsn.trim().length > 0) {
    patch.dsn = dsnWithEngine(state.dsn, engine);
  }
  return patch;
}

// --- step gating --------------------------------------------------------------------

export function effectiveDsn(state: WizardState): string {
  return state.mode === 'fields' ? composeDsn(state.fields, state.engine) : state.dsn.trim();
}

export function effectiveEngine(state: WizardState): ConnectionEngine | null {
  if (state.mode === 'file') return null;
  if (state.mode === 'fields') return state.engine;
  return engineForDsn(state.dsn) ?? state.engine;
}

/** Whether Continue is enabled on the `source` step. */
export function sourceStepValid(state: WizardState): boolean {
  if (state.name.trim().length === 0) return false;
  if (state.mode === 'dsn') {
    return state.dsn.trim().length > 0 && dsnValidationError(state.dsn) === null;
  }
  if (state.mode === 'fields') {
    if (state.engine === 'sqlite') return state.fields.file.trim().length > 0;
    return (
      state.fields.host.trim().length > 0 &&
      state.fields.database.trim().length > 0 &&
      state.fields.user.trim().length > 0
    );
  }
  return state.filePreview !== null;
}
