// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The aggregate tool: a total, a breakdown or a series, computed by the source
 * database.
 *
 * It runs the SAME compiler the dashboard's widgets run, over the same
 * descriptor shape, so a number the assistant puts in a report block is a
 * number a widget would show for the same question — and the report's *Run
 * full preview* can re-execute the stored descriptor later and get today's
 * answer.
 *
 * Reusing that compiler also inherits the two refusals that matter: the table
 * is checked against the acting person's grants before anything is opened, and
 * the compiler itself refuses a descriptor that names a masked column rather
 * than aggregating personal data behind a total.
 */

import { connectionTenantConfig } from '@adminium/meta';
import { queryDescriptorSchema } from '@adminium/engine/config';

import { AppError } from '../../errors.js';
import type { Row } from '../../crud/mask.js';
import { compileWidgetQuery, resolveSource } from '../../widget-data/compiler.js';
import { shapeRows, toNumber } from '../../widget-data/shapers.js';
import type { AssistantTool, AssistantToolOutcome } from '../types.js';
import { ROW_LIMIT_MAX } from './rows.js';
import { viewOrError } from './schema.js';

export const aggregateTool: AssistantTool = {
  name: 'aggregate',
  description: `One computed answer from a table — a total, a breakdown by a column, or a series over time — using the same query descriptor the dashboard widgets use. At most ${String(ROW_LIMIT_MAX)} groups.`,
  args: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      descriptor: {
        type: 'object',
        description:
          'A query descriptor: `shape`, `source` (the table), `aggregations`, optional `groupBy`, `bucket`, `window`, `filters`, `limit`.',
      },
    },
    required: ['connectionId', 'descriptor'],
    additionalProperties: false,
  },
  async run(args, deps): Promise<AssistantToolOutcome> {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : '';
    const raw = args.descriptor;
    if (connectionId === '' || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { error: { code: 'BAD_ARGS', message: 'aggregate needs a `connectionId` and a `descriptor` object.' } };
    }

    const found = await viewOrError(deps, connectionId);
    if ('error' in found) return { error: found.error };
    const view = found.view;

    // Parsed, never cast: a descriptor the model half-remembered is the
    // ordinary case, and the schema's own complaint is what tells it which
    // field it got wrong. The connection id is the TOOL's argument, written
    // over whatever the descriptor carried, so the two cannot disagree about
    // which database is being read.
    const parsed = queryDescriptorSchema.safeParse({ ...(raw as Record<string, unknown>), connectionId });
    if (!parsed.success) {
      return {
        error: {
          code: 'BAD_DESCRIPTOR',
          message: parsed.error.issues
            .slice(0, 6)
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; '),
        },
      };
    }
    // The row cap applies to a grouped answer as much as to a list of rows.
    const descriptor = { ...parsed.data, limit: Math.min(parsed.data.limit ?? ROW_LIMIT_MAX, ROW_LIMIT_MAX) };

    let tableId: string;
    try {
      tableId = resolveSource(view, descriptor).id;
    } catch (error) {
      return { error: refusal(error, 'That descriptor does not name a table on this connection.') };
    }
    const canRead = await deps.canReadTable(connectionId);
    if (!(await canRead(tableId))) {
      return {
        error: {
          code: 'TABLE_FORBIDDEN',
          message: `You do not have read access to ${tableId}, so neither do I.`,
        },
      };
    }

    const { db, dialect } = await deps.manager.data(connectionId);
    try {
      const compiled = compileWidgetQuery({
        db,
        view,
        descriptor,
        // Always masked, like every other read that leaves the instance. The
        // compiler answers COLUMN_FORBIDDEN for a descriptor that aggregates a
        // masked column, which is the refusal this argument buys.
        canReadPii: false,
        dialect,
        timezone: (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? undefined,
      });
      const rows = (await compiled.query.execute()) as Row[];
      const priorRows = compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Row[]);
      let total: number | undefined;
      if (compiled.count !== null) {
        const countRow = (await compiled.count.executeTakeFirst()) as { total?: unknown } | undefined;
        total = toNumber(countRow?.total);
      }
      const shaped = shapeRows({ compiled, rows, priorRows, total, canReadPii: false, connectionId });
      return {
        result: { table: tableId, shape: compiled.shape, data: shaped },
        tables: [`${connectionId}.${tableId}`],
      };
    } catch (error) {
      return { error: refusal(error, 'The database refused that query.') };
    }
  },
};

/** Ours is quotable; anything else could carry SQL the model never saw. */
function refusal(error: unknown, fallback: string): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'QUERY_FAILED', message: fallback };
}
