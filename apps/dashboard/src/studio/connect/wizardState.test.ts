/**
 * Pure wizard rules (M5-T01/02/03): DSN validation + engine inference,
 * fields→DSN composition, inclusion defaults (high-volume unchecked,
 * join/system pre-hidden), meta-placement gating, error-code hints, and
 * sessionStorage persistence.
 */
import { describe, expect, it } from 'vitest';

import type { SchemaTable } from '../api.js';
import {
  HIGH_VOLUME_ROWS,
  INITIAL_WIZARD_STATE,
  composeDsn,
  defaultIncludedIds,
  dsnValidationError,
  effectiveDsn,
  engineForDsn,
  formatRowEstimate,
  hintForErrorCode,
  loadWizardState,
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
      composeDsn({ host: 'db.acme.io', port: '5432', database: 'prod', user: 'ava', password: 'p@ss', ssl: 'require' }),
    ).toBe('postgres://ava:p%40ss@db.acme.io:5432/prod?sslmode=require');
    expect(
      composeDsn({ host: 'localhost', port: '', database: 'dev', user: '', password: '', ssl: 'disable' }),
    ).toBe('postgres://localhost/dev');
  });

  it('effectiveDsn composes in fields mode and trims in dsn mode', () => {
    const fieldsState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      mode: 'fields',
      fields: { host: 'h', port: '5432', database: 'd', user: 'u', password: '', ssl: 'disable' },
    };
    expect(effectiveDsn(fieldsState)).toBe('postgres://u@h:5432/d');
    expect(effectiveDsn({ ...INITIAL_WIZARD_STATE, dsn: '  postgres://u@h/db  ' })).toBe('postgres://u@h/db');
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

  it('formats row estimates mono-style', () => {
    expect(formatRowEstimate(1_234_567)).toBe('1,234,567');
    expect(formatRowEstimate(null)).toBe('—');
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

  it('source step gating per mode', () => {
    const base = { ...INITIAL_WIZARD_STATE, name: 'Prod' };
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'postgres://u@h/db' })).toBe(true);
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'nope://x' })).toBe(false);
    expect(sourceStepValid({ ...base, mode: 'dsn', dsn: 'postgres://u@h/db', name: ' ' })).toBe(false);
    expect(
      sourceStepValid({
        ...base,
        mode: 'fields',
        fields: { host: 'h', port: '5432', database: 'd', user: 'u', password: '', ssl: 'require' },
      }),
    ).toBe(true);
    expect(sourceStepValid({ ...base, mode: 'file', filePreview: null })).toBe(false);
    expect(
      sourceStepValid({
        ...base,
        mode: 'file',
        filePreview: { fileName: 'a.sql', format: 'sql-ddl', tables: 2, columns: 8, warnings: [] },
      }),
    ).toBe(true);
  });
});
