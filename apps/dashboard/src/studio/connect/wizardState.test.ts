/**
 * Pure wizard rules (M5-T01/02/03 + M9-T04): DSN validation + engine
 * inference, engine-picker sync (scheme rewrite, default-port swap, SQLite
 * file form), fields→DSN composition, provider-chip filtering, schema-file
 * format vocabulary, inclusion defaults (high-volume unchecked, join/system
 * pre-hidden) with per-source row-count degradation, meta-placement gating,
 * error-code hints, and sessionStorage persistence.
 */
import { describe, expect, it } from 'vitest';

import type { SchemaTable } from '../api.js';
import {
  HIGH_VOLUME_ROWS,
  INITIAL_WIZARD_STATE,
  composeDsn,
  defaultIncludedIds,
  dsnInputPatch,
  dsnValidationError,
  dsnWithEngine,
  effectiveDsn,
  effectiveEngine,
  engineForDsn,
  enginePickPatch,
  fileFormatFromImportFormat,
  formatRowEstimate,
  hintForErrorCode,
  loadWizardState,
  providerChipsFor,
  sameDbDisabledReason,
  saveWizardState,
  sourceStepValid,
  summarizeTables,
  type WizardState,
} from './wizardState.js';

function table(partial: Partial<SchemaTable> & { id: string }): SchemaTable {
  return {
    schema: 'public',
    name: partial.id.split('.')[1] ?? partial.id,
    columns: [],
    rowCountEstimate: null,
    ...partial,
  };
}

describe('DSN validation', () => {
  it('infers engines from schemes', () => {
    expect(engineForDsn('postgres://u@h:5432/db')).toBe('postgres');
    expect(engineForDsn('postgresql://u@h/db')).toBe('postgres');
    expect(engineForDsn('mysql://u@h/db')).toBe('mysql');
    expect(engineForDsn('mariadb://u@h/db')).toBe('mysql');
    expect(engineForDsn('sqlite:/data/app.db')).toBe('sqlite');
    expect(engineForDsn('mongodb://u@h/db')).toBeNull();
  });

  it('flags unknown schemes; empty input is untouched, not invalid', () => {
    expect(dsnValidationError('')).toBeNull();
    expect(dsnValidationError('postgres://u@h:5432/db')).toBeNull();
    expect(dsnValidationError('ftp://files')).toMatch(/Unrecognized scheme/);
    expect(dsnValidationError('postgres://')).toMatch(/Add host and database/);
  });

  it('composes a DSN from fields (auth, port, sslmode; url-encoded)', () => {
    expect(
      composeDsn({ host: 'db.acme.io', port: '5432', database: 'prod', user: 'ava', password: 'p@ss', ssl: 'require', file: '' }),
    ).toBe('postgres://ava:p%40ss@db.acme.io:5432/prod?sslmode=require');
    expect(
      composeDsn({ host: 'localhost', port: '', database: 'dev', user: '', password: '', ssl: 'disable', file: '' }),
    ).toBe('postgres://localhost/dev');
  });

  it('composes per engine: mysql scheme (no sslmode), sqlite file path (M9-T04)', () => {
    expect(
      composeDsn({ host: 'db.acme.io', port: '3306', database: 'prod', user: 'ava', password: '', ssl: 'require', file: '' }, 'mysql'),
    ).toBe('mysql://ava@db.acme.io:3306/prod');
    expect(
      composeDsn({ ...INITIAL_WIZARD_STATE.fields, file: '/var/data/app.db' }, 'sqlite'),
    ).toBe('sqlite:/var/data/app.db');
  });

  it('effectiveDsn composes in fields mode and trims in dsn mode', () => {
    const fieldsState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      mode: 'fields',
      fields: { host: 'h', port: '5432', database: 'd', user: 'u', password: '', ssl: 'disable', file: '' },
    };
    expect(effectiveDsn(fieldsState)).toBe('postgres://u@h:5432/d');
    expect(effectiveDsn({ ...INITIAL_WIZARD_STATE, dsn: '  postgres://u@h/db  ' })).toBe('postgres://u@h/db');
  });
});

describe('engine picker rules (M9-T04)', () => {
  it('dsnInputPatch drags the picker along when the scheme is recognized', () => {
    expect(dsnInputPatch('mysql://u@h/db', 'postgres')).toEqual({ dsn: 'mysql://u@h/db', engine: 'mysql' });
    expect(dsnInputPatch('mariadb://u@h/db', 'postgres')).toEqual({ dsn: 'mariadb://u@h/db', engine: 'mysql' });
    // Unrecognized/partial input never flips the picker.
    expect(dsnInputPatch('post', 'mysql')).toEqual({ dsn: 'post' });
    expect(dsnInputPatch('postgres://u@h/db', 'postgres')).toEqual({ dsn: 'postgres://u@h/db' });
  });

  it('dsnWithEngine rewrites schemes between network engines and resets across sqlite', () => {
    expect(dsnWithEngine('postgres://u@h:5432/db', 'mysql')).toBe('mysql://u@h:5432/db');
    expect(dsnWithEngine('mysql://u@h/db', 'postgres')).toBe('postgres://u@h/db');
    expect(dsnWithEngine('mariadb://u@h/db', 'mysql')).toBe('mariadb://u@h/db'); // already mysql-family
    expect(dsnWithEngine('postgres://u@h/db', 'sqlite')).toBe(''); // host/port → file path: nothing to carry
    expect(dsnWithEngine('sqlite:/data/app.db', 'postgres')).toBe('');
    expect(dsnWithEngine('', 'mysql')).toBe('');
  });

  it('enginePickPatch swaps untouched default ports and keeps custom ones', () => {
    const state: WizardState = { ...INITIAL_WIZARD_STATE, mode: 'fields' };
    expect(enginePickPatch(state, 'mysql')).toEqual({
      engine: 'mysql',
      fields: { ...state.fields, port: '3306' },
    });
    const custom = { ...state, fields: { ...state.fields, port: '6543' } };
    expect(enginePickPatch(custom, 'mysql')).toEqual({ engine: 'mysql' });
    expect(enginePickPatch(state, 'postgres')).toEqual({}); // no-op on same engine
  });

  it('enginePickPatch rewrites a present DSN', () => {
    const state: WizardState = { ...INITIAL_WIZARD_STATE, dsn: 'postgres://u@h/db' };
    expect(enginePickPatch(state, 'mysql')).toMatchObject({ engine: 'mysql', dsn: 'mysql://u@h/db' });
    expect(enginePickPatch(state, 'sqlite')).toMatchObject({ engine: 'sqlite', dsn: '' });
  });

  it('effectiveEngine: dsn scheme wins, fields mode uses the picker, file mode has none', () => {
    expect(effectiveEngine({ ...INITIAL_WIZARD_STATE, dsn: 'mysql://u@h/db', engine: 'postgres' })).toBe('mysql');
    expect(effectiveEngine({ ...INITIAL_WIZARD_STATE, dsn: '', engine: 'sqlite' })).toBe('sqlite');
    expect(effectiveEngine({ ...INITIAL_WIZARD_STATE, mode: 'fields', engine: 'mysql' })).toBe('mysql');
    expect(effectiveEngine({ ...INITIAL_WIZARD_STATE, mode: 'file' })).toBeNull();
  });

  it('provider chips are filtered per engine — the postgres row stays postgres-only', () => {
    expect(providerChipsFor('postgres').every((chip) => chip.dsn.startsWith('postgres://'))).toBe(true);
    expect(providerChipsFor('mysql').map((chip) => chip.key)).toEqual(['planetscale']);
    expect(providerChipsFor('sqlite')).toEqual([]);
  });
});

describe('schema-file format vocabulary (M9-T04)', () => {
  it('maps engine ImportFormat names onto the wizard short names', () => {
    expect(fileFormatFromImportFormat('sql-ddl')).toBe('sql');
    expect(fileFormatFromImportFormat('json-ir')).toBe('json');
    expect(fileFormatFromImportFormat('prisma')).toBe('prisma');
    expect(fileFormatFromImportFormat('mystery')).toBeNull();
  });
});

describe('table inclusion defaults (M5-T02)', () => {
  const tables = summarizeTables([
    table({
      id: 'public.customers',
      rowCountEstimate: 1_200,
      columns: [
        { name: 'id', logicalType: 'integer' },
        { name: 'email', logicalType: 'text', semantics: { flags: { pii: 'email', maskedByDefault: true } } },
      ],
    }),
    table({ id: 'public.sessions', rowCountEstimate: HIGH_VOLUME_ROWS + 1 }),
    table({ id: 'public.orders_products', semantics: { role: 'join-table' } }),
    table({ id: 'public.adminium_pages', system: true }),
    table({ id: 'public.exactly_at_threshold', rowCountEstimate: HIGH_VOLUME_ROWS }),
  ]);

  it('counts PII columns per table', () => {
    expect(tables.find((t) => t.id === 'public.customers')?.piiColumns).toBe(1);
    expect(tables.find((t) => t.id === 'public.sessions')?.piiColumns).toBe(0);
  });

  it('high volume means STRICTLY above 100k rows', () => {
    expect(tables.find((t) => t.id === 'public.sessions')?.highVolume).toBe(true);
    expect(tables.find((t) => t.id === 'public.exactly_at_threshold')?.highVolume).toBe(false);
  });

  it('join and system tables are pre-hidden', () => {
    expect(tables.find((t) => t.id === 'public.orders_products')?.preHidden).toBe(true);
    expect(tables.find((t) => t.id === 'public.adminium_pages')?.preHidden).toBe(true);
  });

  it('defaults: visible minus high-volume', () => {
    expect(defaultIncludedIds(tables)).toEqual(['public.customers', 'public.exactly_at_threshold']);
  });

  it('formats row estimates mono-style, degrading per source quality (M9-T04)', () => {
    expect(formatRowEstimate(1_234_567)).toBe('1,234,567');
    expect(formatRowEstimate(null)).toBe('—');
    // MySQL: approximate — never presented as exact (05 §4.2).
    expect(formatRowEstimate(1_234_567, 'approximate')).toBe('≈ 1,234,567');
    // Schema files: no live database — an em-dash beats a wrong number.
    expect(formatRowEstimate(1_234_567, 'none')).toBe('—');
    expect(formatRowEstimate(null, 'approximate')).toBe('—');
  });
});

describe('meta placement gating (M5-T03, 01 §3.1)', () => {
  const rw = { canReadSchema: true, canRead: true, canWrite: true, canDDL: true };

  it('writable + DDL-capable source allows same-DB', () => {
    expect(sameDbDisabledReason({ readOnly: false, privileges: rw, sourceIsFile: false })).toBeNull();
  });

  it('read-only source disables same-DB with the manager copy', () => {
    expect(
      sameDbDisabledReason({ readOnly: true, privileges: { ...rw, canWrite: false }, sourceIsFile: false }),
    ).toMatch(/read-only/);
  });

  it('DDL-less source disables same-DB (migrations need CREATE TABLE)', () => {
    expect(sameDbDisabledReason({ readOnly: false, privileges: { ...rw, canDDL: false }, sourceIsFile: false })).toMatch(
      /CREATE TABLE/,
    );
  });

  it('schema file always requires a separate meta store', () => {
    expect(sameDbDisabledReason({ readOnly: false, privileges: null, sourceIsFile: true })).toMatch(/schema file/);
  });
});

describe('error hints', () => {
  it('maps the AdapterError codes to remediation copy', () => {
    expect(hintForErrorCode('AUTH')).toMatch(/password/i);
    expect(hintForErrorCode('HOST_UNREACHABLE')).toMatch(/allowlist/i);
    expect(hintForErrorCode('TLS')).toMatch(/sslmode/i);
    expect(hintForErrorCode('SOMETHING_ELSE')).toMatch(/verify the DSN/i);
  });
});

describe('persistence + step gating', () => {
  it('round-trips through sessionStorage and tolerates garbage', () => {
    saveWizardState({ ...INITIAL_WIZARD_STATE, step: 'meta', name: 'Prod', connectionId: 'conn_9' });
    const restored = loadWizardState();
    expect(restored.step).toBe('meta');
    expect(restored.connectionId).toBe('conn_9');

    window.sessionStorage.setItem('adminium-studio-connect', '{broken json');
    expect(loadWizardState()).toEqual(INITIAL_WIZARD_STATE);
  });

  it('backfills fields persisted before a shape change (pre-M9 state without file)', () => {
    const preM9Fields: Partial<typeof INITIAL_WIZARD_STATE.fields> = { ...INITIAL_WIZARD_STATE.fields };
    delete preM9Fields.file;
    window.sessionStorage.setItem(
      'adminium-studio-connect',
      JSON.stringify({ step: 'source', name: 'Prod', fields: { ...preM9Fields, host: 'db.acme.io' } }),
    );
    const restored = loadWizardState();
    expect(restored.fields.host).toBe('db.acme.io');
    expect(restored.fields.file).toBe('');
    expect(restored.engine).toBe('postgres');
    expect(restored.fileFormat).toBe('auto');
  });

  it('source step gating per mode', () => {
    const base = { ...INITIAL_WIZARD_STATE, name: 'Prod' };
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'postgres://u@h/db' })).toBe(true);
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'nope://x' })).toBe(false);
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'postgres://u@h/db', name: ' ' })).toBe(false);
    expect(
      sourceStepValid({
        ...base,
        mode: 'fields',
        fields: { host: 'h', port: '5432', database: 'd', user: 'u', password: '', ssl: 'require', file: '' },
      }),
    ).toBe(true);
    // SQLite fields mode is a file path, not host/port (05 §4.3).
    expect(sourceStepValid({ ...base, mode: 'fields', engine: 'sqlite' })).toBe(false);
    expect(
      sourceStepValid({
        ...base,
        mode: 'fields',
        engine: 'sqlite',
        fields: { ...INITIAL_WIZARD_STATE.fields, file: '/var/data/app.db' },
      }),
    ).toBe(true);
    expect(sourceStepValid({ ...base, mode: 'file', filePreview: null })).toBe(false);
    expect(
      sourceStepValid({
        ...base,
        mode: 'file',
        filePreview: { fileName: 'a.sql', format: 'sql-ddl', detected: true, tables: 2, columns: 8, warnings: [] },
      }),
    ).toBe(true);
  });
});
