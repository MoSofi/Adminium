// SPDX-License-Identifier: AGPL-3.0-only
/**
 * overridesRepo — adminium_schema_overrides.
 *
 * One row = one correction op layered over the active snapshot (labels, type
 * overrides, relation add/suppress, enum semantics, PII masks, …). Payloads
 * are validated against the op vocabulary (`overridePatchSchema`) — an
 * invalid payload never reaches the database. The effective schema = active
 * snapshot + active ops applied in created_at order (later ops win per (op,
 * table, column) target — applied by the server, not here).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  overrideOriginSchema,
  overridePatchSchema,
  overrideStatusSchema,
  type OverrideOp,
  type OverridePatch,
} from '../schema/json-payloads.js';
import type { AdminiumSchemaOverridesTable } from '../schema/tables.js';
import { llmOverrideField, validateLlmOverride } from './llm-overrides.js';
import { MetaValidationError, packJson, readJson } from './util.js';

/** Ops that target a column and therefore require `columnName`. */
const COLUMN_OPS: ReadonlySet<string> = new Set([
  'column.label',
  'column.semanticType',
  'column.enumLabels',
  'column.pii',
  'column.hidden',
  'column.default',
  'column.options',
  'column.required',
  'column.validation',
]);

export interface SchemaOverride {
  id: string;
  connectionId: string;
  op: OverrideOp;
  tableName: string;
  columnName: string | null;
  value: Record<string, unknown>;
  origin: 'user' | 'llm' | 'auto';
  llmRunId: string | null;
  status: 'active' | 'disabled';
  /** Model confidence for `llm` rows (0008); null for the rest. */
  confidence?: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateOverrideInput {
  connectionId: string;
  op: string;
  /** Qualified source name, e.g. `public.customers`. */
  tableName: string;
  columnName?: string | null | undefined;
  value: unknown;
  origin?: 'user' | 'llm' | 'auto' | undefined;
  llmRunId?: string | null | undefined;
  status?: 'active' | 'disabled' | undefined;
  createdBy?: string | null | undefined;
}

/** One row of a project's `schema/<database>.json`, ready to store. */
export interface ProjectOverrideInput {
  op: string;
  tableName: string;
  columnName?: string | null | undefined;
  value: unknown;
  origin: 'user' | 'llm';
  status: 'active' | 'disabled';
  confidence?: number | null | undefined;
}

function decode(row: Selectable<AdminiumSchemaOverridesTable>): SchemaOverride {
  return {
    id: row.id,
    connectionId: row.connectionId,
    op: row.op as OverrideOp,
    tableName: row.tableName,
    columnName: row.columnName,
    value: readJson<Record<string, unknown>>(row.value),
    origin: row.origin as 'user' | 'llm' | 'auto',
    llmRunId: row.llmRunId,
    status: row.status as 'active' | 'disabled',
    confidence: row.confidence ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Validate one op + payload against the vocabulary; throws on failure. */
export function validateOverrideInput(input: CreateOverrideInput): OverridePatch {
  const parsed = overridePatchSchema.safeParse({ op: input.op, value: input.value });
  if (!parsed.success) {
    throw new MetaValidationError(
      `invalid override payload for op ${JSON.stringify(input.op)}`,
      parsed.error.issues,
    );
  }
  const needsColumn = COLUMN_OPS.has(parsed.data.op);
  const hasColumn = typeof input.columnName === 'string' && input.columnName.length > 0;
  if (needsColumn && !hasColumn) {
    throw new MetaValidationError(`op ${parsed.data.op} requires columnName`);
  }
  if (!needsColumn && hasColumn) {
    throw new MetaValidationError(`op ${parsed.data.op} is table-level — columnName must be null`);
  }
  if (input.tableName.length === 0) {
    throw new MetaValidationError('tableName must not be empty');
  }
  return parsed.data;
}

export function overridesRepo(meta: MetaDb) {
  const { db } = meta;

  interface OverrideInsertRow {
    id: string;
    connectionId: string;
    op: string;
    tableName: string;
    columnName: string | null;
    value: string;
    origin: string;
    llmRunId: string | null;
    status: string;
    /** Model confidence — always null for user-remap ops (LLM apply sets it).
     * */
    confidence: number | null;
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
  }

  function buildRow(input: CreateOverrideInput, at: number): OverrideInsertRow {
    const patch = validateOverrideInput(input);
    const origin = overrideOriginSchema.safeParse(input.origin ?? 'user');
    if (!origin.success) throw new MetaValidationError('invalid override origin', origin.error.issues);
    const status = overrideStatusSchema.safeParse(input.status ?? 'active');
    if (!status.success) throw new MetaValidationError('invalid override status', status.error.issues);
    return {
      id: newId('ovr'),
      connectionId: input.connectionId,
      op: patch.op,
      tableName: input.tableName,
      columnName: COLUMN_OPS.has(patch.op) ? (input.columnName as string) : null,
      value: packJson(patch.value),
      origin: origin.data,
      llmRunId: input.llmRunId ?? null,
      status: status.data,
      confidence: null,
      createdBy: input.createdBy ?? null,
      createdAt: at,
      updatedAt: at,
    };
  }

  return {
    async create(input: CreateOverrideInput, at: number = Date.now()): Promise<SchemaOverride> {
      const row = buildRow(input, at);
      await db.insertInto('adminium_schema_overrides').values(row).execute();
      return decode(row);
    },

    async findById(id: string): Promise<SchemaOverride | null> {
      const row = await db
        .selectFrom('adminium_schema_overrides')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** Ordered by created_at (application order); optionally filtered by status. */
    async listForConnection(
      connectionId: string,
      opts: { status?: 'active' | 'disabled' } = {},
    ): Promise<SchemaOverride[]> {
      let query = db
        .selectFrom('adminium_schema_overrides')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc');
      if (opts.status !== undefined) query = query.where('status', '=', opts.status);
      const rows = await query.execute();
      return rows.map(decode);
    },

    /**
     * Every ACTIVE row of one op, across every connection.
     *
     * "Which columns name this option list" is a workspace-wide question — a
     * list is not owned by a connection — and answering it by walking every
     * connection's overrides would mean the caller knowing the connections.
     */
    async listByOp(op: string): Promise<SchemaOverride[]> {
      const rows = await db
        .selectFrom('adminium_schema_overrides')
        .selectAll()
        .where('op', '=', op as never)
        .where('status', '=', 'active')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(decode);
    },

    /**
     * PUT semantics for the remap editor: replace the connection's override
     * set in one transaction. Every row is validated before any write
     * happens, so a bad payload leaves the set untouched.
     */
    async replaceForConnection(
      connectionId: string,
      inputs: Omit<CreateOverrideInput, 'connectionId'>[],
      at: number = Date.now(),
    ): Promise<SchemaOverride[]> {
      const rows = inputs.map((input) => buildRow({ ...input, connectionId }, at));
      return db.transaction().execute(async (trx) => {
        await trx.deleteFrom('adminium_schema_overrides').where('connectionId', '=', connectionId).execute();
        for (const row of rows) {
          await trx.insertInto('adminium_schema_overrides').values(row).execute();
        }
        return rows.map(decode);
      });
    },

    /**
     * Replace the connection's `user` and `llm` rows with the ones a project's
     * `schema/<database>.json` lists, in one transaction. `auto` rows are the
     * engine's own guesses, which every install derives again, so they stay.
     * The rows land in the given order, which is the order they are applied
     * in. Every row is checked before anything is written.
     */
    async replaceProjectRows(
      connectionId: string,
      inputs: readonly ProjectOverrideInput[],
      at: number = Date.now(),
    ): Promise<void> {
      const rows = inputs.map((input) => {
        const columnName = input.columnName ?? null;
        let value = input.value;
        if (llmOverrideField(input.op) !== null) {
          if (input.origin !== 'llm') {
            throw new MetaValidationError(`op ${input.op} is written by AI assist; its origin must be llm`);
          }
          if (input.tableName.length === 0) throw new MetaValidationError('tableName must not be empty');
          validateLlmOverride(input.op, columnName, input.value);
        } else {
          value = validateOverrideInput({ connectionId, ...input, columnName }).value;
        }
        const status = overrideStatusSchema.safeParse(input.status);
        if (!status.success) throw new MetaValidationError('invalid override status', status.error.issues);
        return {
          id: newId('ovr'),
          connectionId,
          op: input.op,
          tableName: input.tableName,
          columnName,
          value: packJson(value),
          origin: input.origin,
          llmRunId: null,
          status: status.data,
          confidence: input.confidence ?? null,
          createdBy: null,
          createdAt: at,
          updatedAt: at,
        };
      });
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('adminium_schema_overrides')
          .where('connectionId', '=', connectionId)
          .where('origin', '!=', 'auto')
          .execute();
        for (const row of rows) {
          await trx.insertInto('adminium_schema_overrides').values(row).execute();
        }
      });
    },

    /** Toggle a correction off without deleting it. */
    async setStatus(id: string, status: 'active' | 'disabled', at: number = Date.now()): Promise<boolean> {
      const valid = overrideStatusSchema.safeParse(status);
      if (!valid.success) throw new MetaValidationError('invalid override status', valid.error.issues);
      const res = await db
        .updateTable('adminium_schema_overrides')
        .set({ status: valid.data, updatedAt: at })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async delete(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_schema_overrides').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) === 1;
    },
  };
}

export type OverridesRepo = ReturnType<typeof overridesRepo>;
