// SPDX-License-Identifier: AGPL-3.0-only
/**
 * llmOverridesRepo — the LLM-sourced slice of `adminium_schema_overrides`
 * (06-llm-assist.md §8.3).
 *
 * The user remap editor writes single-locale correction ops (`table.label`,
 * `column.pii`, …) through {@link overridesRepo}; an LLM apply writes a
 * different, richer set of fields — localized label/description bundles, key
 * bundles, enum semantics, virtual relations and PII masks — whose values are
 * localized maps, not plain strings. Those never fit the remap `op` vocabulary,
 * so they live under their own namespaced ops (`llm.<field>`, {@link llmOverrideOp})
 * carrying `origin: 'llm'` + `llm_run_id`. Keeping the two namespaces disjoint
 * means the remap editor and the effective-schema resolver can tell a machine
 * suggestion from a human edit, and an LLM write can never masquerade as (or
 * silently clobber) a user edit.
 *
 * The repo is intentionally thin and transaction-friendly: every method operates
 * on the {@link MetaDb} handle it is constructed with, so the apply-EXECUTOR
 * (apps/server, T10b) can bind it to a Kysely transaction (`{ db: trx, dialect }`)
 * and upsert overrides + write pages in ONE transaction. `upsert` is idempotent
 * — keyed on `(connection, op, table, column)` it updates the existing `llm` row
 * in place rather than inserting a duplicate, which is what makes re-applying the
 * same run a no-op and re-applying a NEWER run supersede (new `llm_run_id`) the
 * prior one (§8.3 idempotency + provenance).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumSchemaOverridesTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readJson } from './util.js';

/**
 * §8.3 apply-target fields the LLM path writes to `adminium_schema_overrides`.
 * Mirrors `@adminium/llm` `OverrideField` (the pure planner's descriptor field);
 * kept as a local literal so `@adminium/meta` takes no dependency on the llm pkg.
 */
export const LLM_OVERRIDE_FIELDS = [
  'label',
  'key',
  'pii',
  'copy',
  'enum_semantics',
  'virtual_relation',
  'relation_suppressed',
] as const;
export type LlmOverrideField = (typeof LLM_OVERRIDE_FIELDS)[number];

const FIELD_SET: ReadonlySet<string> = new Set(LLM_OVERRIDE_FIELDS);

/** Column-scoped fields require `columnName`; table-scoped fields forbid it. */
const COLUMN_FIELDS: ReadonlySet<LlmOverrideField> = new Set<LlmOverrideField>([
  'label', // a column label bundle is column-scoped; a table label bundle is not (columnName decides)
  'pii',
  'enum_semantics',
]);

const OP_PREFIX = 'llm.';

/** The `adminium_schema_overrides.op` value persisted for an LLM `field`. */
export function llmOverrideOp(field: LlmOverrideField): string {
  return `${OP_PREFIX}${field}`;
}

/** Parse an `op` string back to its `field`, or `null` when it is not an LLM op. */
export function llmOverrideField(op: string): LlmOverrideField | null {
  if (!op.startsWith(OP_PREFIX)) return null;
  const field = op.slice(OP_PREFIX.length);
  return FIELD_SET.has(field) ? (field as LlmOverrideField) : null;
}

export interface LlmOverride {
  id: string;
  connectionId: string;
  field: LlmOverrideField;
  /** Qualified source name, e.g. `public.customers`. */
  tableName: string;
  columnName: string | null;
  /** Localized/structured value, or `null` for an explicit clear (a PII rejection). */
  value: Record<string, unknown> | null;
  /** Per-suggestion model confidence 0..1 (§8.3). */
  confidence: number | null;
  llmRunId: string | null;
  status: 'active' | 'disabled';
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertLlmOverrideInput {
  connectionId: string;
  field: LlmOverrideField;
  tableName: string;
  columnName?: string | null;
  /** Object value (localized maps where applicable) or `null` for a clear. */
  value: Record<string, unknown> | null;
  /** Per-suggestion model confidence 0..1 (§8.3). */
  confidence?: number | null;
  llmRunId?: string | null;
  createdBy?: string | null;
}

export interface UpsertLlmOverrideResult {
  override: LlmOverride;
  /** `inserted` — no prior `llm` row for this target; `updated` — superseded one. */
  action: 'inserted' | 'updated';
  /** The row as it was BEFORE this upsert, for single-transaction undo (null on insert). */
  before: LlmOverride | null;
}

function decode(row: Selectable<AdminiumSchemaOverridesTable>): LlmOverride {
  const field = llmOverrideField(row.op);
  if (field === null) {
    throw new MetaValidationError(`not an llm override op: ${JSON.stringify(row.op)}`);
  }
  return {
    id: row.id,
    connectionId: row.connectionId,
    field,
    tableName: row.tableName,
    columnName: row.columnName,
    value: readJson<Record<string, unknown> | null>(row.value),
    confidence: row.confidence,
    llmRunId: row.llmRunId,
    status: row.status as 'active' | 'disabled',
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Value must be a plain JSON object or `null` — a hallucinated scalar never reaches the DB. */
function assertValue(field: LlmOverrideField, value: unknown): asserts value is Record<string, unknown> | null {
  if (value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new MetaValidationError(`llm override ${field} value must be an object or null`);
  }
}

function assertColumnShape(field: LlmOverrideField, columnName: string | null): void {
  const needsColumn = COLUMN_FIELDS.has(field);
  // `label` is dual-scoped (table bundle OR column bundle); only the strictly
  // column-only fields (pii, enum_semantics) demand a column here.
  if (field !== 'label' && needsColumn && (columnName === null || columnName.length === 0)) {
    throw new MetaValidationError(`llm override ${field} requires columnName`);
  }
}

export function llmOverridesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findLlmRow(
    connectionId: string,
    op: string,
    tableName: string,
    columnName: string | null,
  ): Promise<Selectable<AdminiumSchemaOverridesTable> | undefined> {
    let q = db
      .selectFrom('adminium_schema_overrides')
      .selectAll()
      .where('connectionId', '=', connectionId)
      .where('origin', '=', 'llm')
      .where('op', '=', op)
      .where('tableName', '=', tableName);
    q = columnName === null ? q.where('columnName', 'is', null) : q.where('columnName', '=', columnName);
    return q.executeTakeFirst();
  }

  return {
    /**
     * Idempotent upsert of one §8.3 LLM override, keyed on
     * `(connection, op, table, column)`. Inserts a fresh `origin: 'llm'` row or
     * updates the existing one in place (value + superseding `llm_run_id`),
     * returning the prior state for undo. Never touches `origin: 'user'` rows.
     */
    async upsert(input: UpsertLlmOverrideInput, at: number = Date.now()): Promise<UpsertLlmOverrideResult> {
      if (!FIELD_SET.has(input.field)) {
        throw new MetaValidationError(`unknown llm override field ${JSON.stringify(input.field)}`);
      }
      if (input.tableName.length === 0) throw new MetaValidationError('tableName must not be empty');
      const columnName = input.columnName ?? null;
      assertColumnShape(input.field, columnName);
      assertValue(input.field, input.value);

      const op = llmOverrideOp(input.field);
      const confidence = input.confidence ?? null;
      const existing = await findLlmRow(input.connectionId, op, input.tableName, columnName);
      const packed = packJson(input.value);

      if (existing !== undefined) {
        const before = decode(existing);
        await db
          .updateTable('adminium_schema_overrides')
          .set({
            value: packed,
            confidence,
            llmRunId: input.llmRunId ?? null,
            status: 'active',
            updatedAt: at,
          })
          .where('id', '=', existing.id)
          .execute();
        return {
          override: {
            ...before,
            value: input.value,
            confidence,
            llmRunId: input.llmRunId ?? null,
            status: 'active',
            updatedAt: at,
          },
          action: 'updated',
          before,
        };
      }

      const row = {
        id: newId('ovr'),
        connectionId: input.connectionId,
        op,
        tableName: input.tableName,
        columnName,
        value: packed,
        origin: 'llm',
        confidence,
        llmRunId: input.llmRunId ?? null,
        status: 'active',
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_schema_overrides').values(row).execute();
      return { override: decode(row as Selectable<AdminiumSchemaOverridesTable>), action: 'inserted', before: null };
    },

    /** Restore a prior row image captured by {@link upsert} (undo of an `updated` write). */
    async restore(before: LlmOverride, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_schema_overrides')
        .set({
          value: packJson(before.value),
          confidence: before.confidence,
          llmRunId: before.llmRunId,
          status: before.status,
          updatedAt: at,
        })
        .where('id', '=', before.id)
        .execute();
    },

    /** Delete a row inserted by this apply (undo of an `inserted` write). */
    async deleteById(id: string): Promise<void> {
      await db.deleteFrom('adminium_schema_overrides').where('id', '=', id).execute();
    },

    /** All `origin: 'llm'` overrides for a connection, in application order. */
    async listForConnection(connectionId: string): Promise<LlmOverride[]> {
      const rows = await db
        .selectFrom('adminium_schema_overrides')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('origin', '=', 'llm')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(decode);
    },
  };
}

export type LlmOverridesRepo = ReturnType<typeof llmOverridesRepo>;
