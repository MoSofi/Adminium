// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tables an installed app uses, per connection (wave 0039).
 *
 * One row per (connection, app, short name). It is how an install knows which
 * tables it made (and so which an uninstall may drop), how a reinstall
 * recognises its own leftovers, and — once apps are prefixed — how a short name
 * the app knows (`tickets`) becomes the real table (`pos_tickets`).
 *
 * ─── The states ────────────────────────────────────────────────────────────
 *
 *   pending   an install is about to create it
 *   created   this install created it (`owned`)
 *   adopted   it was already there, and the app uses it (not `owned`)
 *   shared    another app's table, used through a declared shape (not `owned`)
 *   released  the app was uninstalled and the table kept
 *   dropped   the app was uninstalled and the table dropped with its data
 *
 * A record is never deleted by an uninstall; its manifest row is, and the
 * foreign key sets `manifest_id` to NULL, so the next install of the same app
 * key re-attaches it ({@link appTablesRepo.attach}).
 */

import type { Selectable } from 'kysely';

import { newId } from '../ids.js';
import type { MetaDb } from '../connect.js';
import type { AdminiumAppTablesTable } from '../schema/tables.js';
import { packJson, readBool, readJson, writeBool } from './util.js';

export const APP_TABLE_STATES = ['pending', 'created', 'adopted', 'shared', 'released', 'dropped'] as const;
export type AppTableState = (typeof APP_TABLE_STATES)[number];

/** `app` — a table of the app's; `sample-ledger` — bookkeeping, hidden from pages and endpoints. */
export type AppTableRole = 'app' | 'sample-ledger';

/** A column rule the installer wrote, with the hash of what it wrote. */
export interface AppTableRule {
  op: string;
  table: string;
  column: string | null;
  valueHash: string;
  overrideId: string;
}

export interface AppTableRecord {
  id: string;
  appKey: string;
  manifestId: string | null;
  connectionId: string;
  ref: string;
  tableName: string;
  schemaName: string | null;
  owned: boolean;
  state: AppTableState;
  role: AppTableRole;
  prefix: string | null;
  shape: string | null;
  rules: AppTableRule[];
  createdAt: number;
  updatedAt: number;
  releasedAt: number | null;
}

export interface RecordAppTableInput {
  appKey: string;
  manifestId: string | null;
  connectionId: string;
  ref: string;
  tableName: string;
  schemaName?: string | null;
  owned: boolean;
  state: AppTableState;
  role?: AppTableRole;
  prefix?: string | null;
  shape?: string | null;
}

function parseRules(value: unknown): AppTableRule[] {
  const parsed = value === null || value === undefined ? [] : readJson<unknown>(value);
  if (!Array.isArray(parsed)) return [];
  // Parsed, never cast: a row written by a later version must not crash this one.
  return parsed.flatMap((entry): AppTableRule[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e['op'] !== 'string' || typeof e['table'] !== 'string') return [];
    if (typeof e['valueHash'] !== 'string' || typeof e['overrideId'] !== 'string') return [];
    const column = typeof e['column'] === 'string' ? e['column'] : null;
    return [{ op: e['op'], table: e['table'], column, valueHash: e['valueHash'], overrideId: e['overrideId'] }];
  });
}

function toRecord(row: Selectable<AdminiumAppTablesTable>): AppTableRecord {
  return {
    id: row.id,
    appKey: row.appKey,
    manifestId: row.manifestId,
    connectionId: row.connectionId,
    ref: row.ref,
    tableName: row.tableName,
    schemaName: row.schemaName,
    owned: readBool(row.owned),
    state: (APP_TABLE_STATES as readonly string[]).includes(row.state) ? (row.state as AppTableState) : 'adopted',
    role: row.role === 'sample-ledger' ? 'sample-ledger' : 'app',
    prefix: row.prefix,
    shape: row.shape,
    rules: parseRules(row.rules),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    releasedAt: row.releasedAt,
  };
}

export function appTablesRepo(meta: MetaDb) {
  const { db } = meta;

  async function find(connectionId: string, appKey: string, ref: string): Promise<AppTableRecord | null> {
    const row = await db
      .selectFrom('adminium_app_tables')
      .selectAll()
      .where('connectionId', '=', connectionId)
      .where('appKey', '=', appKey)
      .where('ref', '=', ref)
      .executeTakeFirst();
    return row === undefined ? null : toRecord(row);
  }

  return {
    find,

    /** Every record of one app on one connection, in the order they were made. */
    async forInstall(connectionId: string, appKey: string): Promise<AppTableRecord[]> {
      const rows = await db
        .selectFrom('adminium_app_tables')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('appKey', '=', appKey)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toRecord);
    },

    /** Every record on one connection, of every app. */
    async forConnection(connectionId: string): Promise<AppTableRecord[]> {
      const rows = await db
        .selectFrom('adminium_app_tables')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toRecord);
    },

    /** Every app that records a real table — "who else uses this?" */
    async byTable(connectionId: string, tableName: string): Promise<AppTableRecord[]> {
      const rows = await db
        .selectFrom('adminium_app_tables')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', '=', tableName)
        .execute();
      return rows.map(toRecord);
    },

    /**
     * Write a record, or bring an existing one up to date — idempotent on
     * (connection, app, short name), so a resumed install re-running this step
     * does not collide with its first attempt.
     *
     * An existing record keeps `owned` once it is true: a table this app
     * created stays this app's, even when a later install finds it already
     * there and would otherwise call it adopted.
     */
    async record(input: RecordAppTableInput, at: number = Date.now()): Promise<AppTableRecord> {
      const held = await find(input.connectionId, input.appKey, input.ref);
      if (held !== null) {
        const owned = held.owned || input.owned;
        // A table this app created — found again by a resumed install, or by a
        // reinstall after an uninstall kept it — is still `created`, not adopted.
        const state = held.owned && input.state === 'adopted' ? 'created' : input.state;
        await db
          .updateTable('adminium_app_tables')
          .set({
            manifestId: input.manifestId,
            tableName: input.tableName,
            schemaName: input.schemaName ?? held.schemaName,
            owned: writeBool(meta, owned),
            state,
            role: input.role ?? held.role,
            prefix: input.prefix ?? held.prefix,
            shape: input.shape ?? held.shape,
            releasedAt: null,
            updatedAt: at,
          })
          .where('id', '=', held.id)
          .execute();
        return (await find(input.connectionId, input.appKey, input.ref)) as AppTableRecord;
      }
      const values = {
        id: newId('atb'),
        appKey: input.appKey,
        manifestId: input.manifestId,
        connectionId: input.connectionId,
        ref: input.ref,
        tableName: input.tableName,
        schemaName: input.schemaName ?? null,
        owned: writeBool(meta, input.owned),
        state: input.state,
        role: input.role ?? 'app',
        prefix: input.prefix ?? null,
        shape: input.shape ?? null,
        rules: null,
        createdAt: at,
        updatedAt: at,
        releasedAt: null,
      };
      await db.insertInto('adminium_app_tables').values(values).execute();
      return (await find(input.connectionId, input.appKey, input.ref)) as AppTableRecord;
    },

    /** Move one record to a new state (`pending` → `created`, …). */
    async setState(id: string, state: AppTableState, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_app_tables')
        .set({
          state,
          updatedAt: at,
          ...(state === 'released' || state === 'dropped' ? { releasedAt: at } : {}),
        })
        .where('id', '=', id)
        .execute();
    },

    /** Replace the column rules the installer wrote for one table. */
    async setRules(id: string, rules: readonly AppTableRule[], at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_app_tables')
        .set({ rules: packJson(rules), updatedAt: at })
        .where('id', '=', id)
        .execute();
    },

    /**
     * Re-attach an app's leftover records to a fresh install's manifest row.
     * The foreign key set them to NULL when the previous row went.
     */
    async attach(connectionId: string, appKey: string, manifestId: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_app_tables')
        .set({ manifestId, updatedAt: at })
        .where('connectionId', '=', connectionId)
        .where('appKey', '=', appKey)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    },

    /** Short name → real table, for the tables this install actually has. */
    async realNames(connectionId: string, appKey: string): Promise<Record<string, string>> {
      const rows = await db
        .selectFrom('adminium_app_tables')
        .select(['ref', 'tableName', 'state'])
        .where('connectionId', '=', connectionId)
        .where('appKey', '=', appKey)
        .execute();
      const out: Record<string, string> = {};
      for (const row of rows) {
        if (row.state === 'dropped' || row.state === 'pending') continue;
        out[row.ref] = row.tableName;
      }
      return out;
    },
  };
}
