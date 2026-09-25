// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row tools: actual customer data, read through the same pipeline the data
 * grid uses.
 *
 * Three things are true of every read here and are not configurable.
 *
 * THE TABLE IS CHECKED FIRST. `table:<connection>:<table>:read`, for the
 * person the turn runs as, before the connection is opened at all — a
 * forbidden table is answered from the permission set and the source database
 * is never dialled.
 *
 * VALUES LEAVE MASKED, WHOEVER IS ASKING. The grid shows an email address to
 * someone allowed to see it; sending it to a third-party model is a different
 * act, and it gets the stricter answer — `canReadPii: false` on every call,
 * with no way to pass anything else. What the draft then carries is a masked
 * address the person completes in the editor, where the real value never left
 * the building. A code Adminium makes (a shared link's) is masked the same
 * way, for everyone (`viewOrError`): it opens a page to whoever holds it.
 *
 * THE COUNT IS BOUNDED. At most {@link ROW_LIMIT_MAX} rows per call, and the
 * cap is applied to what the model asked for rather than refusing the call —
 * an over-large ask is a misunderstanding, not a failure.
 *
 * These tools exist only while the workspace's row-data setting is on. With it
 * off they are not in the catalogue and the prompt says why, so the model does
 * not spend a round-trip discovering their absence.
 */

import { ASSISTANT_MAX_ROWS_PER_CALL } from '@adminium/llm';

import { AppError } from '../../errors.js';
import { runList } from '../../crud/list.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { AssistantTool, AssistantToolDeps, AssistantToolOutcome } from '../types.js';
import { viewOrError } from './schema.js';

/** Rows one call may return. The contract's cap, not a second opinion about it. */
export const ROW_LIMIT_MAX = ASSISTANT_MAX_ROWS_PER_CALL;

/** Longest string cell that travels whole; the rest is cut with an ellipsis. */
export const CELL_MAX = 500;

function truncateCells(rows: Row[]): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === 'string' && value.length > CELL_MAX ? `${value.slice(0, CELL_MAX)}…` : value;
    }
    return out;
  });
}

/** What a resolved read needs: the view it resolved against and the table's id. */
interface ReadableTarget {
  view: SnapshotView;
  tableId: string;
}

/**
 * Resolve a connection and table for a row read, refusing BEFORE the source
 * database is opened. Shared by `read_rows` and `sample_record`.
 */
async function resolveReadable(
  deps: AssistantToolDeps,
  connectionId: string,
  tableName: string,
): Promise<{ target: ReadableTarget } | { error: { code: string; message: string } }> {
  const found = await viewOrError(deps, connectionId);
  if ('error' in found) return { error: found.error };
  let tableId: string;
  try {
    tableId = found.view.table(tableName).id;
  } catch {
    return {
      error: {
        code: 'UNKNOWN_TABLE',
        message: `${JSON.stringify(tableName)} is not a table on this connection. Use describe_schema first.`,
      },
    };
  }
  const canRead = await deps.canReadTable(connectionId);
  if (!(await canRead(tableId))) {
    return {
      error: {
        code: 'TABLE_FORBIDDEN',
        message: `You do not have read access to ${tableId}, so neither do I. Use describe_schema to see what is readable.`,
      },
    };
  }
  return { target: { view: found.view, tableId } };
}

export const readRowsTool: AssistantTool = {
  name: 'read_rows',
  description: `Rows from one table (at most ${String(ROW_LIMIT_MAX)} per call), with the total. Columns holding personal data come back empty — they are masked before they leave the instance.`,
  args: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      table: { type: 'string' },
      where: { type: 'string', description: 'Filter expression, the same one the data API takes.' },
      sort: { type: 'string', description: 'e.g. `created_at.desc`.' },
      columns: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', minimum: 1, maximum: ROW_LIMIT_MAX },
    },
    required: ['connectionId', 'table'],
    additionalProperties: false,
  },
  async run(args, deps): Promise<AssistantToolOutcome> {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : '';
    const tableName = typeof args.table === 'string' ? args.table : '';
    if (connectionId === '' || tableName === '') {
      return { error: { code: 'BAD_ARGS', message: 'read_rows needs a `connectionId` and a `table`.' } };
    }
    const gate = await resolveReadable(deps, connectionId, tableName);
    if ('error' in gate) return { error: gate.error };
    const { view, tableId } = gate.target;

    const asked = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : ROW_LIMIT_MAX;
    const limit = Math.min(Math.max(asked, 1), ROW_LIMIT_MAX);
    const columns = Array.isArray(args.columns)
      ? args.columns.filter((name): name is string => typeof name === 'string')
      : [];

    const table = view.table(tableId);
    const { db, dialect } = await deps.manager.data(connectionId);
    try {
      const listed = await runList({
        db,
        view,
        table,
        params: {
          limit,
          count: 'exact',
          ...(columns.length > 0 ? { select: columns.join(',') } : {}),
          ...(typeof args.where === 'string' && args.where !== '' ? { where: args.where } : {}),
          ...(typeof args.sort === 'string' && args.sort !== '' ? { order: args.sort } : {}),
        },
        // Always false. See this file's header.
        canReadPii: false,
        dialect,
      });
      return {
        result: {
          table: tableId,
          rows: truncateCells(listed.data),
          returned: listed.data.length,
          total: listed.page?.total ?? null,
        },
        tables: [`${connectionId}.${tableId}`],
      };
    } catch (error) {
      return { error: queryFailure(error) };
    }
  },
};

export const sampleRecordTool: AssistantTool = {
  name: 'sample_record',
  description:
    'One row of a table, to build a worked example from. Personal data comes back empty, the same as read_rows.',
  args: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      table: { type: 'string' },
      where: { type: 'string', description: 'Pick a particular row; omit for the first one.' },
    },
    required: ['connectionId', 'table'],
    additionalProperties: false,
  },
  async run(args, deps): Promise<AssistantToolOutcome> {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : '';
    const tableName = typeof args.table === 'string' ? args.table : '';
    if (connectionId === '' || tableName === '') {
      return { error: { code: 'BAD_ARGS', message: 'sample_record needs a `connectionId` and a `table`.' } };
    }
    const gate = await resolveReadable(deps, connectionId, tableName);
    if ('error' in gate) return { error: gate.error };
    const { view, tableId } = gate.target;
    const table = view.table(tableId);
    const { db, dialect } = await deps.manager.data(connectionId);
    try {
      const listed = await runList({
        db,
        view,
        table,
        params: {
          limit: 1,
          count: 'none',
          ...(typeof args.where === 'string' && args.where !== '' ? { where: args.where } : {}),
        },
        canReadPii: false,
        dialect,
      });
      const row = truncateCells(listed.data)[0] ?? null;
      return {
        result: { table: tableId, record: row },
        tables: [`${connectionId}.${tableId}`],
      };
    } catch (error) {
      return { error: queryFailure(error) };
    }
  },
};

/**
 * A query the source database refused.
 *
 * An {@link AppError} is one of ours — an unparseable filter, an unknown
 * column, a masked column named in a sort — and its sentence is exactly what
 * the model needs to try again. Anything else came from the driver, and its
 * text can carry SQL and schema detail the model was never shown, so it is
 * answered generically.
 */
function queryFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'QUERY_FAILED', message: 'The database refused that query.' };
}
