/**
 * connectionsRepo — adminium_connections (07-meta-store.md §3.13).
 *
 * One row per configured source database. DSNs are stored encrypted; this
 * package stays crypto-agnostic — the caller (apps/server) provides
 * {@link DsnCrypto} closures built from its secret handling
 * (01-architecture.md §3/§7). Repos never see key material.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  connectionEngineSchema,
  connectionSettingsSchema,
  connectionSourceKindSchema,
  connectionSslSchema,
  connectionStatusSchema,
  type ConnectionSettings,
} from '../schema/json-payloads.js';
import type { AdminiumConnectionsTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

/** Caller-provided AES closures — meta never touches key material. */
export interface DsnCrypto {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

export interface ConnectionSsl {
  mode: 'require' | 'verify-full' | 'disable';
  caFileId?: string | null | undefined;
}

/** Decoded connection row. DSNs stay encrypted — use `getDsns()` to decrypt. */
export interface Connection {
  id: string;
  name: string;
  engine: string;
  sourceKind: string;
  introspectDsnEncrypted: string | null;
  dataDsnEncrypted: string | null;
  schemaFileId: string | null;
  readOnly: boolean;
  ssl: ConnectionSsl | null;
  settings: ConnectionSettings;
  status: string;
  lastTestedAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** Remediation copy for {@link lastError}, from the adapter (05 §3). */
  lastErrorHint: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Decrypted per-role DSNs (01-architecture.md §3 privilege model). */
export interface ConnectionDsns {
  introspectDsn: string | null;
  /** Falls back to the introspect DSN in single-role setups (§3.13). */
  dataDsn: string | null;
}

export interface CreateConnectionInput {
  name: string;
  engine: string;
  sourceKind?: string;
  /** Plaintext DSNs — encrypted before they reach the database. */
  introspectDsn?: string | null;
  dataDsn?: string | null;
  schemaFileId?: string | null;
  readOnly?: boolean;
  ssl?: ConnectionSsl | null;
  settings?: ConnectionSettings;
  status?: string;
  createdBy?: string | null;
}

export interface UpdateConnectionInput {
  name?: string;
  introspectDsn?: string | null;
  dataDsn?: string | null;
  readOnly?: boolean;
  ssl?: ConnectionSsl | null;
  settings?: ConnectionSettings;
  status?: string;
  lastError?: string | null;
  lastErrorHint?: string | null;
}

export interface ConnectionTestOutcome {
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
  /** The failure's remediation hint, when the adapter supplied one. */
  errorHint?: string | null;
  /** Probe result — a read-only data role flips the app read-only (§3.13). */
  readOnly?: boolean;
}

function decode(row: Selectable<AdminiumConnectionsTable>): Connection {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    sourceKind: row.sourceKind,
    introspectDsnEncrypted: row.introspectDsnEncrypted,
    dataDsnEncrypted: row.dataDsnEncrypted,
    schemaFileId: row.schemaFileId,
    readOnly: readBool(row.readOnly),
    ssl: readJsonOrNull<ConnectionSsl>(row.ssl),
    settings: readJson<ConnectionSettings>(row.settings),
    status: row.status,
    lastTestedAt: row.lastTestedAt,
    lastLatencyMs: row.lastLatencyMs,
    lastError: row.lastError,
    lastErrorHint: row.lastErrorHint,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function connectionsRepo(meta: MetaDb, crypto: DsnCrypto) {
  const { db } = meta;

  function encryptOrNull(dsn: string | null | undefined): string | null {
    if (dsn === null || dsn === undefined || dsn.length === 0) return null;
    return crypto.encrypt(dsn);
  }

  function validate(input: CreateConnectionInput): {
    engine: string;
    sourceKind: string;
    settings: ConnectionSettings;
    ssl: ConnectionSsl | null;
    status: string;
  } {
    const engine = connectionEngineSchema.safeParse(input.engine);
    if (!engine.success) {
      throw new MetaValidationError(`unknown connection engine ${JSON.stringify(input.engine)}`, engine.error.issues);
    }
    const sourceKind = connectionSourceKindSchema.safeParse(input.sourceKind ?? 'dsn');
    if (!sourceKind.success) {
      throw new MetaValidationError('invalid source_kind', sourceKind.error.issues);
    }
    if (sourceKind.data === 'dsn' && (input.introspectDsn === undefined || input.introspectDsn === null)) {
      throw new MetaValidationError('introspectDsn is required when source_kind = dsn (§3.13)');
    }
    if (sourceKind.data === 'schema-file' && (input.schemaFileId === undefined || input.schemaFileId === null)) {
      throw new MetaValidationError('schemaFileId is required when source_kind = schema-file (§3.13)');
    }
    const settings = connectionSettingsSchema.safeParse(input.settings ?? {});
    if (!settings.success) {
      throw new MetaValidationError('invalid connection settings payload', settings.error.issues);
    }
    const ssl = input.ssl === null || input.ssl === undefined ? null : connectionSslSchema.safeParse(input.ssl);
    if (ssl !== null && !ssl.success) {
      throw new MetaValidationError('invalid ssl payload', ssl.error.issues);
    }
    const status = connectionStatusSchema.safeParse(input.status ?? 'unconfigured');
    if (!status.success) {
      throw new MetaValidationError('invalid connection status', status.error.issues);
    }
    return {
      engine: engine.data,
      sourceKind: sourceKind.data,
      settings: settings.data,
      ssl: ssl === null ? null : (ssl.data as ConnectionSsl),
      status: status.data,
    };
  }

  return {
    async create(input: CreateConnectionInput, at: number = Date.now()): Promise<Connection> {
      const valid = validate(input);
      const row = {
        id: newId('conn'),
        name: input.name,
        engine: valid.engine,
        sourceKind: valid.sourceKind,
        introspectDsnEncrypted: encryptOrNull(input.introspectDsn),
        dataDsnEncrypted: encryptOrNull(input.dataDsn),
        schemaFileId: input.schemaFileId ?? null,
        readOnly: writeBool(meta, input.readOnly ?? false),
        ssl: valid.ssl === null ? null : packJson(valid.ssl),
        settings: packJson(valid.settings),
        status: valid.status,
        lastTestedAt: null,
        lastLatencyMs: null,
        lastError: null,
        lastErrorHint: null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_connections').values(row).execute();
      const created = await this.findById(row.id);
      if (created === null) throw new MetaValidationError('connection insert did not persist');
      return created;
    },

    async findById(id: string): Promise<Connection | null> {
      const row = await db
        .selectFrom('adminium_connections')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async list(): Promise<Connection[]> {
      const rows = await db.selectFrom('adminium_connections').selectAll().orderBy('createdAt', 'asc').execute();
      return rows.map(decode);
    },

    /** Decrypt the stored DSNs; `dataDsn` falls back to the introspect DSN. */
    async getDsns(id: string): Promise<ConnectionDsns | null> {
      const row = await this.findById(id);
      if (row === null) return null;
      const introspectDsn =
        row.introspectDsnEncrypted === null ? null : crypto.decrypt(row.introspectDsnEncrypted);
      const dataDsn = row.dataDsnEncrypted === null ? introspectDsn : crypto.decrypt(row.dataDsnEncrypted);
      return { introspectDsn, dataDsn };
    },

    async update(id: string, patch: UpdateConnectionInput, at: number = Date.now()): Promise<Connection | null> {
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.introspectDsn !== undefined) set.introspectDsnEncrypted = encryptOrNull(patch.introspectDsn);
      if (patch.dataDsn !== undefined) set.dataDsnEncrypted = encryptOrNull(patch.dataDsn);
      if (patch.readOnly !== undefined) set.readOnly = writeBool(meta, patch.readOnly);
      if (patch.lastError !== undefined) set.lastError = patch.lastError;
      if (patch.lastErrorHint !== undefined) set.lastErrorHint = patch.lastErrorHint;
      if (patch.ssl !== undefined) {
        if (patch.ssl === null) {
          set.ssl = null;
        } else {
          const ssl = connectionSslSchema.safeParse(patch.ssl);
          if (!ssl.success) throw new MetaValidationError('invalid ssl payload', ssl.error.issues);
          set.ssl = packJson(ssl.data);
        }
      }
      if (patch.settings !== undefined) {
        const settings = connectionSettingsSchema.safeParse(patch.settings);
        if (!settings.success) {
          throw new MetaValidationError('invalid connection settings payload', settings.error.issues);
        }
        set.settings = packJson(settings.data);
      }
      if (patch.status !== undefined) {
        const status = connectionStatusSchema.safeParse(patch.status);
        if (!status.success) throw new MetaValidationError('invalid connection status', status.error.issues);
        set.status = status.data;
      }
      await db
        .updateTable('adminium_connections')
        .set(set as never)
        .where('id', '=', id)
        .execute();
      return this.findById(id);
    },

    /** Persist a test/probe outcome (health chip fields, §3.13). */
    async recordTestResult(id: string, outcome: ConnectionTestOutcome, at: number = Date.now()): Promise<void> {
      const set: Record<string, unknown> = {
        lastTestedAt: at,
        lastLatencyMs: outcome.latencyMs ?? null,
        lastError: outcome.ok ? null : (outcome.error ?? 'connection test failed'),
        // Cleared on success alongside lastError — a stale hint next to a
        // healthy connection reads as an unresolved problem.
        lastErrorHint: outcome.ok ? null : (outcome.errorHint ?? null),
        status: outcome.ok ? 'connected' : 'error',
        updatedAt: at,
      };
      if (outcome.readOnly !== undefined) set.readOnly = writeBool(meta, outcome.readOnly);
      await db
        .updateTable('adminium_connections')
        .set(set as never)
        .where('id', '=', id)
        .execute();
    },

    /** FK CASCADE removes the connection's snapshots and overrides. */
    async delete(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_connections').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) === 1;
    },
  };
}

export type ConnectionsRepo = ReturnType<typeof connectionsRepo>;
