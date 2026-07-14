/**
 * Connect-wizard state + pure rules (09-generated-app.md §8.2, M5-T01/02/03).
 *
 * Everything decision-shaped lives here so the step components stay thin and
 * the rules are unit-testable without a DOM:
 * - DSN scheme validation / engine inference and the fields→DSN composer,
 * - provider quick-fill chips (ia-mapping §4 Surface B keepers),
 * - table-inclusion defaults (high-volume > 100k unchecked; join/system
 *   pre-hidden — 09 §8.2 step 3),
 * - meta-placement gating (read-only or DDL-less source ⇒ same-DB disabled,
 *   01-architecture.md §3.1),
 * - AdapterError code → remediation copy mapping,
 * - sessionStorage persistence (refresh-safe wizard, §8.2).
 */

import type { ConnectionEngine, DsnPrivileges, GenerateIntent, SchemaTable } from '../api.js';
import { t } from '../../i18n/t.js';

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

export interface FieldsInput {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: SslMode;
}

export const EMPTY_FIELDS: FieldsInput = {
  host: '',
  port: '5432',
  database: '',
  user: '',
  password: '',
  ssl: 'require',
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

export function composeDsn(fields: FieldsInput): string {
  const user = fields.user.length > 0 ? encodeURIComponent(fields.user) : '';
  const password = fields.password.length > 0 ? `:${encodeURIComponent(fields.password)}` : '';
  const auth = user.length > 0 ? `${user}${password}@` : '';
  const port = fields.port.length > 0 ? `:${fields.port}` : '';
  const ssl = fields.ssl === 'disable' ? '' : `?sslmode=${fields.ssl}`;
  return `postgres://${auth}${fields.host}${port}/${fields.database}${ssl}`;
}

export interface ProviderChip {
  key: string;
  label: string;
  dsn: string;
}

/** Quick-fill provider chips (Console + Connect Database comps). */
export const PROVIDER_CHIPS: readonly ProviderChip[] = [
  { key: 'supabase', label: 'Supabase', dsn: 'postgres://postgres.PROJECT:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres' },
  { key: 'neon', label: 'Neon', dsn: 'postgres://USER:PASSWORD@ep-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require' },
  { key: 'rds', label: 'RDS', dsn: 'postgres://USER:PASSWORD@mydb.abc123.us-east-1.rds.amazonaws.com:5432/postgres' },
  { key: 'planetscale', label: 'PlanetScale', dsn: 'mysql://USER:PASSWORD@aws.connect.psdb.cloud/mydb?ssl={"rejectUnauthorized":true}' },
  { key: 'localhost', label: 'localhost', dsn: 'postgres://postgres@localhost:5432/app_dev' },
];

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

/** `1,234,567` in mono; `—` when the estimate is unknown. */
export function formatRowEstimate(estimate: number | null): string {
  return estimate === null ? '—' : new Intl.NumberFormat('en-US').format(estimate);
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
  name: string;
  dsn: string;
  fields: FieldsInput;
  /** Parse preview for the schema-file mode (summary only — the model stays server-validated). */
  filePreview: {
    fileName: string;
    format: string;
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
  name: '',
  dsn: '',
  fields: EMPTY_FIELDS,
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
    return { ...INITIAL_WIZARD_STATE, ...parsed };
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

// --- step gating --------------------------------------------------------------------

export function effectiveDsn(state: WizardState): string {
  return state.mode === 'fields' ? composeDsn(state.fields) : state.dsn.trim();
}

export function effectiveEngine(state: WizardState): ConnectionEngine | null {
  if (state.mode === 'fields') return 'postgres';
  return engineForDsn(state.dsn);
}

/** Whether Continue is enabled on the `source` step. */
export function sourceStepValid(state: WizardState): boolean {
  if (state.name.trim().length === 0) return false;
  if (state.mode === 'dsn') {
    return state.dsn.trim().length > 0 && dsnValidationError(state.dsn) === null;
  }
  if (state.mode === 'fields') {
    return (
      state.fields.host.trim().length > 0 &&
      state.fields.database.trim().length > 0 &&
      state.fields.user.trim().length > 0
    );
  }
  return state.filePreview !== null;
}
