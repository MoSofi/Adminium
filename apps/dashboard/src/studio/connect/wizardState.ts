// SPDX-License-Identifier: AGPL-3.0-only
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
 *
 * WHERE THE SHARED RULES LIVE NOW (M7 Wave 4): the DSN grammar (scheme→engine,
 * validation, placeholders, quick-fill chips, scheme rewrite) and the
 * table-inclusion defaults moved to `@adminium/widgets`, where they back the
 * annex §10 `connection-string-field` and `table-inclusion-checklist` widgets.
 * They were BORN here, and this module now consumes them: `@adminium/widgets`
 * may never import `apps/*`, and a second copy of "what is a valid DSN" or "how
 * big is too big" would drift — the wizard and the widget would disagree about
 * the same database. What stays here is what is genuinely wizard-only: the
 * 3-engine vocabulary this build can connect to, the host/port FIELDS form (the
 * inverse of the DSN grammar), the `SchemaTable` → `InclusionTable` mapping, and
 * the translated copy. The thin wrappers below keep every existing call site —
 * and this module's unit tests — pointed at the same names as before.
 */
import { isPreHiddenTable } from '@adminium/engine';
import { getFormatters } from '@adminium/i18n';
import {
  HIGH_VOLUME_ROWS,
  defaultIncludedIds,
  dsnPlaceholder as dsnPlaceholderFor,
  dsnValidationCode,
  dsnWithEngine as dsnWithEngineFor,
  engineForDsn as engineForDsnIn,
  isHighVolume,
  providerChipsFor as providerChipsForEngine,
  type DsnEngine,
  type DsnProviderChip,
  type InclusionTable,
} from '@adminium/widgets';

import type { LlmLocale, LlmSection } from '../ai/api.js';
import type { ConnectionEngine, DsnPrivileges, GenerateIntent, SchemaTable } from '../api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { ENRICH_SECTIONS, LOCKED_LOCALE, type EnrichIntent } from './enrichState.js';

// --- steps -------------------------------------------------------------------

export const WIZARD_STEP_IDS = ['intent', 'source', 'test', 'tables', 'meta', 'enrich', 'generate'] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export function wizardStepLabel(id: WizardStepId): string {
  switch (id) {
    case 'intent':
      return t('studio:wizard.step.intent', 'Intent');
    case 'source':
      return t('studio:wizard.step.source', 'Source');
    case 'test':
      return t('studio:wizard.step.test', 'Analyze');
    case 'tables':
      return t('studio:wizard.step.tables', 'Tables');
    case 'meta':
      return t('studio:wizard.step.meta', 'Meta storage');
    case 'enrich':
      return t('studio:wizard.step.enrich', 'Enrich');
    case 'generate':
      return t('studio:wizard.step.generate', 'Generate');
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
      return t('studio:source.engine.postgres', 'PostgreSQL');
    case 'mysql':
      return t('studio:source.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('studio:source.engine.sqlite', 'SQLite');
  }
}

/** Network engines only — SQLite is file-path based (05 §4.3). */
export const DEFAULT_PORTS: Readonly<Record<ConnectionEngine, string>> = {
  postgres: '5432',
  mysql: '3306',
  sqlite: '',
};

export function dsnPlaceholder(engine: ConnectionEngine): string {
  return dsnPlaceholderFor(engine);
}

/**
 * Narrow the widgets-side engine vocabulary onto the one this build connects to.
 * Exhaustive rather than a cast: if `DsnEngine` grows a scheme Adminium learns
 * to speak, this stops compiling until someone decides whether the wizard should
 * offer it — which is the moment that decision should be made.
 */
export function asConnectionEngine(engine: DsnEngine | null): ConnectionEngine | null {
  switch (engine) {
    case 'postgres':
    case 'mysql':
    case 'sqlite':
      return engine;
    case 'mongodb':
    case 'mssql':
    case null:
      return null;
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

/**
 * The engine a DSN names — restricted to `SOURCE_ENGINES`, so a scheme the
 * widgets-side grammar can parse but this build cannot connect to (`mongodb://`)
 * still reads as unrecognised here, exactly as it always has.
 */
export function engineForDsn(dsn: string): ConnectionEngine | null {
  return asConnectionEngine(engineForDsnIn(dsn, SOURCE_ENGINES));
}

/** `null` when valid; a translated error otherwise (the widget returns a CODE). */
export function dsnValidationError(dsn: string): string | null {
  const code = dsnValidationCode(dsn, SOURCE_ENGINES);
  if (code === null) return null;
  return code === 'invalid-scheme'
    ? t('studio:source.dsn.invalidScheme', 'Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:')
    : t('studio:source.dsn.incomplete', 'Add host and database, e.g. postgres://user@host:5432/db');
}

/** The translated copy the lifted `ConnectionStringField` renders per code. */
export function dsnErrorText(): Record<'invalid-scheme' | 'incomplete', string> {
  return {
    'invalid-scheme': t(
      'studio:source.dsn.invalidScheme',
      'Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:',
    ),
    incomplete: t('studio:source.dsn.incomplete', 'Add host and database, e.g. postgres://user@host:5432/db'),
  };
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
 * Rewrite a DSN's scheme to match a newly picked engine. Network engines swap
 * schemes in place; to/from SQLite (a file path, not host/port) there is nothing
 * meaningful to carry over — the input resets.
 *
 * `SOURCE_ENGINES` is threaded through for the same reason it is everywhere else
 * in this module: a scheme this build cannot connect to (`mongodb://`,
 * `sqlserver://`) is UNRECOGNISED here, so picking an engine resets the field and
 * forces a clean retype — instead of rewriting the scheme in place and handing
 * back a valid-looking `mysql://…@cluster0.mongodb.net/db`.
 */
export function dsnWithEngine(dsn: string, engine: ConnectionEngine): string {
  return dsnWithEngineFor(dsn, engine, SOURCE_ENGINES);
}

/** A quick-fill chip, narrowed to the engines this build can connect to. */
export interface ProviderChip extends Omit<DsnProviderChip, 'engine'> {
  engine: ConnectionEngine;
}

/**
 * Quick-fill provider chips (Console + Connect Database comps), shown only for
 * the engine they belong to — the postgres row stays postgres-relevant only
 * (M9-T04). `providerChipsForEngine` filters on `chip.engine === engine`, so
 * re-stamping `engine` here is a re-type of a value that is already exactly
 * that, not a coercion.
 */
export function providerChipsFor(engine: ConnectionEngine): ProviderChip[] {
  return providerChipsForEngine(engine, SOURCE_ENGINES).map((chip) => ({ ...chip, engine }));
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
      return t('studio:source.format.sql', 'SQL DDL / pg_dump');
    case 'prisma':
      return t('studio:source.format.prisma', 'Prisma schema');
    case 'drizzle':
      return t('studio:source.format.drizzle', 'Drizzle ORM');
    case 'typeorm':
      return t('studio:source.format.typeorm', 'TypeORM entities');
    case 'sequelize':
      return t('studio:source.format.sequelize', 'Sequelize models');
    case 'rails':
      return t('studio:source.format.rails', 'Rails schema.rb');
    case 'django':
      return t('studio:source.format.django', 'Django models.py');
    case 'json':
      return t('studio:source.format.json', 'Adminium JSON');
  }
}

// --- table inclusion (M5-T02) --------------------------------------------------

/**
 * The inclusion RULES (>100k unchecked, join/system pre-hidden) and the shape
 * they read now live in `@adminium/widgets` behind `table-inclusion-checklist` —
 * re-exported here so every existing call site and test keeps its import.
 */
export { HIGH_VOLUME_ROWS, defaultIncludedIds };
/** One includable table, as the checklist widget and its rules see it. */
export type WizardTable = InclusionTable;

/**
 * Reduce `@adminium/engine`'s introspected tables to what the inclusion rules
 * read. This mapping stays wizard-side: `SchemaTable` is the app's own
 * dependency, and the widget binds a §3 `record-list` instead — `InclusionTable`
 * is where the two meet.
 */
export function summarizeTables(tables: readonly SchemaTable[]): WizardTable[] {
  return tables.map((table) => {
    const rowEstimate = table.rowCountEstimate;
    return {
      id: table.id,
      rowEstimate,
      piiColumns: table.columns.filter((column) => {
        const pii = column.semantics?.flags?.pii;
        return pii !== null && pii !== undefined;
      }).length,
      highVolume: isHighVolume(rowEstimate),
      preHidden: isPreHiddenTable(table),
    };
  });
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
      'studio:meta.sameDb.disabledFile',
      'A schema file has no live database — choose a separate database for Adminium’s own tables.',
    );
  }
  if (input.readOnly || input.privileges?.canWrite === false) {
    return t(
      'studio:meta.sameDb.disabledReadOnly',
      'Your role is read-only — Adminium never writes to this database. Choose a separate database for Adminium’s own tables.',
    );
  }
  if (input.privileges !== null && !input.privileges.canDDL) {
    return t(
      'studio:meta.sameDb.disabledNoDdl',
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
      return t('studio:test.hint.auth', 'Authentication failed — check the user name and password in your DSN.');
    case 'HOST_UNREACHABLE':
      return t(
        'studio:test.hint.hostUnreachable',
        'Host unreachable — check the hostname and port, and that the database accepts connections from this machine (allowlist our IPs).',
      );
    case 'TLS':
      return t(
        'studio:test.hint.tls',
        'TLS negotiation failed — try sslmode=require, or upload the CA certificate your server expects.',
      );
    case 'PERMISSION':
      return t(
        'studio:test.hint.permission',
        'The role connected but lacks schema-read privileges — grant USAGE on the schema to your introspection role.',
      );
    case 'TIMEOUT':
      return t('studio:test.hint.timeout', 'The database did not answer in time — check network path and load, then retry.');
    case 'META_PLACEMENT_INVALID':
      return t(
        'studio:test.hint.metaPlacement',
        'This source cannot host Adminium’s meta tables — continue with a separate meta database.',
      );
    default:
      return t('studio:test.hint.unknown', 'Connection failed — verify the DSN and retry.');
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
  /**
   * Enrich-with-AI step (06-llm-assist.md §10.2): the chosen intent and the
   * shared options. The created run + prompt artifact stay in component memory
   * (too heavy for sessionStorage) — only these lightweight choices persist.
   */
  enrichIntent: EnrichIntent | null;
  enrichSections: LlmSection[];
  /** Always contains `en_US` (locked on — §5.1 rule 5). */
  enrichLocales: LlmLocale[];
  enrichSampling: boolean;
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
  enrichIntent: null,
  enrichSections: [...ENRICH_SECTIONS],
  enrichLocales: [LOCKED_LOCALE],
  enrichSampling: false,
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
