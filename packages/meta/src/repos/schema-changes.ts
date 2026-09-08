// SPDX-License-Identifier: AGPL-3.0-only
/**
 * schemaChangesRepo — `adminium_schema_changes` (35-schema-authoring.md §3.5,
 * D3, 35-T09, 35-T36).
 *
 * The record of what an apply did to a customer's database.
 *
 * ─── Ledger-first, and why that is not fussiness ───────────────────────────
 *
 * {@link start} is called BEFORE the first statement leaves the process, and
 * the row it writes says `running`. D3 says an apply is re-runnable rather
 * than transactional, because MySQL commits every DDL statement implicitly —
 * so a failure halfway leaves a database in a state that neither "succeeded"
 * nor "failed" describes, and a crash leaves no in-process record at all.
 *
 * A row that stays `running` is therefore the honest outcome of a killed
 * worker, and {@link unfinishedFor} is what turns it into something the
 * operator sees: the next plan tells them a previous apply did not finish,
 * instead of quietly planning against a schema half way between two shapes.
 *
 * ─── `steps` round-trips through Zod ───────────────────────────────────────
 *
 * The column is opaque `json` in the schema and validated here, which is the
 * discipline every other json column in this store follows. The outcome
 * vocabulary is closed: a step either ran, failed, or never started, and
 * "never started" is a distinct fact from "failed" when reporting a partial.
 */

import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { MetaValidationError, packJson, readJson } from './util.js';

export const SCHEMA_CHANGE_STATUSES = ['running', 'applied', 'partial', 'failed'] as const;
export type SchemaChangeStatus = (typeof SCHEMA_CHANGE_STATUSES)[number];

/**
 * What became of one step. `pending` is not a synonym for `failed`: after a
 * partial apply the operator needs to know which statements never ran, because
 * those are the ones a re-apply will complete.
 */
export const stepOutcomeSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  table: z.string().min(1),
  column: z.string().nullable().default(null),
  hazard: z.string().min(1),
  outcome: z.enum(['pending', 'succeeded', 'failed', 'skipped']).default('pending'),
  /** The exact statements compiled for this step — the D2 preview, recorded. */
  sql: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
});
export type StepOutcome = z.infer<typeof stepOutcomeSchema>;

const stepsSchema = z.array(stepOutcomeSchema);

export interface SchemaChange {
  id: string;
  connectionId: string;
  planChecksum: string;
  status: SchemaChangeStatus;
  steps: StepOutcome[];
  hazard: string;
  baseSnapshotId: string | null;
  resultSnapshotId: string | null;
  /** Rows the operator confirmed before a rewrite ran (D18); null when none. */
  acknowledgedRows: number | null;
  error: string | null;
  createdBy: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface StartSchemaChangeInput {
  connectionId: string;
  planChecksum: string;
  hazard: string;
  steps: StepOutcome[];
  baseSnapshotId?: string | null;
  createdBy?: string | null;
  /** Rows the operator confirmed before a rewrite ran (D18). */
  acknowledgedRows?: number | null;
}

interface Row {
  id: string;
  connectionId: string;
  planChecksum: string;
  status: string;
  steps: unknown;
  hazard: string;
  baseSnapshotId: string | null;
  resultSnapshotId: string | null;
  acknowledgedRows: number | null;
  error: string | null;
  createdBy: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function decode(row: Row): SchemaChange {
  return {
    id: row.id,
    connectionId: row.connectionId,
    planChecksum: row.planChecksum,
    status: row.status as SchemaChangeStatus,
    steps: stepsSchema.parse(readJson(row.steps)),
    hazard: row.hazard,
    baseSnapshotId: row.baseSnapshotId,
    resultSnapshotId: row.resultSnapshotId,
    acknowledgedRows: row.acknowledgedRows,
    error: row.error,
    createdBy: row.createdBy,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function schemaChangesRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    /**
     * Write the `running` row. Called before the first statement — see the
     * header. Returns the id the apply reports progress against.
     */
    async start(input: StartSchemaChangeInput, at: number = Date.now()): Promise<SchemaChange> {
      if (input.planChecksum.length === 0) {
        throw new MetaValidationError('plan checksum must not be empty');
      }
      const row = {
        id: newId('sch'),
        connectionId: input.connectionId,
        planChecksum: input.planChecksum,
        status: 'running' satisfies SchemaChangeStatus,
        steps: packJson(stepsSchema.parse(input.steps)),
        hazard: input.hazard,
        baseSnapshotId: input.baseSnapshotId ?? null,
        resultSnapshotId: null,
        // D18: what the operator confirmed they had seen, recorded WITH the
        // authorisation rather than after it. Null when the plan warned about
        // no rows at all, which is most of them.
        acknowledgedRows: input.acknowledgedRows ?? null,
        error: null,
        createdBy: input.createdBy ?? null,
        startedAt: at,
        finishedAt: null,
      };
      await db.insertInto('adminium_schema_changes').values(row as never).execute();
      return decode({ ...row, steps: row.steps } as Row);
    },

    /**
     * Record progress. Called after each step so a killed worker leaves a row
     * that says how far it got — the whole reason the ledger exists.
     */
    async recordSteps(id: string, steps: StepOutcome[]): Promise<void> {
      await db
        .updateTable('adminium_schema_changes')
        .set({ steps: packJson(stepsSchema.parse(steps)) } as never)
        .where('id', '=', id)
        .execute();
    },

    /** Close the row out. `status` is derived by the caller from the outcomes. */
    async finish(
      id: string,
      input: {
        status: Exclude<SchemaChangeStatus, 'running'>;
        steps: StepOutcome[];
        resultSnapshotId?: string | null;
        error?: string | null;
      },
      at: number = Date.now(),
    ): Promise<void> {
      if (!SCHEMA_CHANGE_STATUSES.includes(input.status)) {
        throw new MetaValidationError(`invalid schema-change status ${JSON.stringify(input.status)}`);
      }
      await db
        .updateTable('adminium_schema_changes')
        .set({
          status: input.status,
          steps: packJson(stepsSchema.parse(input.steps)),
          resultSnapshotId: input.resultSnapshotId ?? null,
          error: input.error ?? null,
          finishedAt: at,
        } as never)
        .where('id', '=', id)
        .execute();
    },

    async findById(id: string): Promise<SchemaChange | null> {
      const row = await db
        .selectFrom('adminium_schema_changes')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : decode(row as unknown as Row);
    },

    /** This connection's applies, newest first — the history surface. */
    async listForConnection(connectionId: string, limit = 50): Promise<SchemaChange[]> {
      const rows = await db
        .selectFrom('adminium_schema_changes')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      return rows.map((row) => decode(row as unknown as Row));
    },

    /**
     * A `running` row for this connection — an apply that never reported an
     * outcome. The next plan surfaces it (35-T36): the operator is told the
     * schema may be part-way between two shapes rather than being handed a
     * plan built on that assumption without being told.
     */
    async unfinishedFor(connectionId: string): Promise<SchemaChange | null> {
      const row = await db
        .selectFrom('adminium_schema_changes')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('status', '=', 'running')
        .orderBy('startedAt', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? null : decode(row as unknown as Row);
    },
  };
}

export type SchemaChangesRepo = ReturnType<typeof schemaChangesRepo>;
