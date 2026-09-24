// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Running a project action: a button on a record, a row menu or the bulk bar
 * that calls the project's own code.
 *
 * `POST /project/actions/:id` names the database, the table and the selected
 * ids. The server checks the person may use the action (its `permission` on
 * that table, and read), loads the rows the way the data API shows them to
 * that person, runs the action with a time limit (60 s by default) and writes
 * a `project.action` audit entry with the outcome. The action's label and
 * messages are the developer's own text and are not translated.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Connection, MetaDb, RecordRef } from '@adminium/meta';

import type { ConnectionManager } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { canReadPii, maskRow, type Row } from '../../crud/mask.js';
import { fetchByPk, parseRecordId, pkLabel } from '../../crud/records.js';
import { HookRejectedError, type WriteContext } from '../../crud/write-service.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { getPrincipal } from '../../rbac/principal.js';
import type { ActionPermission, ProjectDb, ProjectUser, RecordId } from './define.js';
import { recordKey, type ProjectDbScope } from './db.js';
import { projectLogger, withTimeLimit, type ProjectLogFn } from './hooks.js';
import type { LoadedAction, ProjectCode } from './load.js';

export const ACTION_TIMEOUT_MS = 60_000;
/** The most rows one run may be handed; the bulk bar's own cap. */
export const MAX_ACTION_IDS = 1000;
const MAX_MESSAGE = 500;

export interface ActionRunnerDeps {
  app: FastifyInstance;
  meta: MetaDb;
  manager: ConnectionManager;
  code: () => ProjectCode;
  db: (scope: ProjectDbScope) => ProjectDb;
  log: ProjectLogFn;
}

/** What the dashboard needs to draw an action's button. */
export interface ActionSummary {
  id: string;
  label: string;
  icon: string | null;
  confirm: string | null;
  bulk: boolean;
  permission: ActionPermission;
  database: string;
  connectionId: string;
  /** The table id pages use, such as `public.orders`. */
  table: string;
}

export interface ActionRunInput {
  id: string;
  database: string;
  table: string;
  ids: readonly unknown[];
}

export interface ActionRunResult {
  message: string | null;
  refresh: boolean;
}

/** Thrown by `fail()`, so the action stops where it called it. */
class ActionStopped extends Error {
  override readonly name = 'ActionStopped';
}

interface Placed {
  action: LoadedAction;
  connection: Connection;
  view: SnapshotView;
  table: ResolvedTable;
}

const permissionOf = (action: LoadedAction): ActionPermission => action.definition.permission ?? 'update';

export function createActionRunner(deps: ActionRunnerDeps) {
  const connections = deps.manager.connections;

  /** Where an action's table is, or null when the database or table is not there. */
  async function place(action: LoadedAction): Promise<Placed | null> {
    const connection = await connections.findByProjectKey(action.database);
    if (connection === null) return null;
    let view: SnapshotView;
    let table: ResolvedTable;
    try {
      view = await loadSnapshotView(deps.meta, connection.id);
      table = view.table(action.definition.table);
    } catch {
      return null;
    }
    return { action, connection, view, table };
  }

  async function allowed(request: FastifyRequest, placed: Placed): Promise<boolean> {
    const prefix = `table:${placed.connection.id}:${placed.table.id}`;
    return (await request.can(`${prefix}:${permissionOf(placed.action)}`)) && (await request.can(`${prefix}:read`));
  }

  async function list(request: FastifyRequest): Promise<ActionSummary[]> {
    const out: ActionSummary[] = [];
    for (const action of deps.code().actions.values()) {
      const placed = await place(action);
      if (placed === null || !(await allowed(request, placed))) continue;
      out.push({
        id: action.id,
        label: action.definition.label,
        icon: action.definition.icon ?? null,
        confirm: action.definition.confirm ?? null,
        bulk: action.definition.bulk === true,
        permission: permissionOf(action),
        database: action.database,
        connectionId: placed.connection.id,
        table: placed.table.id,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  function keyOf(table: ResolvedTable, id: unknown): Row {
    if (typeof id === 'string') return parseRecordId(table, id);
    if (typeof id === 'number' || (typeof id === 'object' && id !== null && !Array.isArray(id))) {
      return recordKey(table, id as RecordId);
    }
    throw new ValidationFailedError('Each id must be a string, a number or an object of key columns.', {});
  }

  async function run(request: FastifyRequest, input: ActionRunInput): Promise<ActionRunResult> {
    const action = deps.code().actions.get(input.id);
    if (action === undefined) throw new NotFoundError(`There is no project action "${input.id}".`, { id: input.id });
    const placed = await place(action);
    if (placed === null) {
      throw new NotFoundError(`The action "${action.id}" is for a table this server does not have.`, { id: action.id });
    }
    let named: string | null = null;
    try {
      named = placed.view.table(input.table).id;
    } catch {
      named = null;
    }
    if (input.database !== action.database || named !== placed.table.id) {
      throw new ValidationFailedError(`The action "${action.id}" belongs to ${action.database} ${placed.table.id}.`, {
        id: action.id,
      });
    }
    if (!(await allowed(request, placed))) {
      const permission = `table:${placed.connection.id}:${placed.table.id}:${permissionOf(action)}`;
      await deps.app.rbac.audit(request, {
        category: 'rbac',
        action: 'permission.denied',
        connectionId: placed.connection.id,
        changes: { after: { permission, method: request.method, url: request.url } },
      });
      throw new ForbiddenError('You do not have access to this action.', 'TABLE_FORBIDDEN', { permission });
    }
    if (input.ids.length === 0 || input.ids.length > MAX_ACTION_IDS) {
      throw new ValidationFailedError(`An action runs on 1 to ${String(MAX_ACTION_IDS)} records.`, {});
    }
    if (input.ids.length > 1 && action.definition.bulk !== true) {
      throw new ValidationFailedError(`The action "${action.id}" runs on one record at a time.`, { id: action.id });
    }

    const { db: raw, dialect } = await deps.manager.data(placed.connection);
    const unmasked = await canReadPii(request, placed.connection.id, placed.table.id);
    const keys = input.ids.map((id) => keyOf(placed.table, id));
    const records: Row[] = [];
    for (const pk of keys) {
      const row = await fetchByPk(raw, placed.table, pk);
      if (row === undefined) throw new NotFoundError('Record not found.', { pk });
      records.push(maskRow(row, placed.table, unmasked));
    }

    const principal = getPrincipal(request);
    const user: ProjectUser = {
      kind: principal?.kind ?? 'system',
      id: principal?.id ?? null,
      name: principal?.label ?? 'Adminium',
    };
    const context: WriteContext = {
      origin: 'action',
      hops: 0,
      actor: { kind: user.kind, id: user.id, label: user.name },
      request,
    };
    let failed: string | null = null;
    const fail = (message: string): never => {
      failed = String(message).slice(0, MAX_MESSAGE);
      throw new ActionStopped(failed);
    };

    const audit = async (outcome: 'succeeded' | 'rejected' | 'failed', message: string | null): Promise<void> => {
      const entity: RecordRef | null =
        keys.length === 1
          ? {
              connectionId: placed.connection.id,
              table: placed.table.id,
              pk: keys[0] as Row,
              label: pkLabel(placed.table, keys[0] as Row),
            }
          : null;
      await deps.app.rbac.audit(request, {
        category: 'data',
        action: 'project.action',
        connectionId: placed.connection.id,
        entity,
        changes: {
          after: {
            action: action.id,
            table: placed.table.id,
            ids: keys.map((pk) => pkLabel(placed.table, pk)),
            outcome,
            message,
          },
        },
      });
    };

    let result: unknown;
    try {
      result = await withTimeLimit(
        action.definition.timeout ?? ACTION_TIMEOUT_MS,
        (signal) =>
          action.definition.run({
            record: records[0] as Row,
            records,
            database: action.database,
            table: placed.table.id,
            user,
            db: deps.db({ database: action.database, raw, dialect, context }),
            log: projectLogger(deps.log, action.source),
            signal,
            fail,
          }),
        action.source,
      );
    } catch (error) {
      if (failed !== null || error instanceof ActionStopped) {
        const message = failed ?? (error as Error).message;
        await audit('rejected', message);
        throw new AppError(422, 'VALIDATION_FAILED', message, { action: action.id });
      }
      if (error instanceof HookRejectedError) {
        await audit('rejected', error.message);
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      deps.log('error', `The project action ${action.source} failed: ${reason}`, { file: action.source });
      await audit('failed', reason.slice(0, MAX_MESSAGE));
      throw new AppError(500, 'ACTION_FAILED', `The action "${action.definition.label}" failed. The details are in the server log.`, {
        action: action.id,
      });
    }

    const returned = (typeof result === 'object' && result !== null ? result : {}) as {
      message?: unknown;
      refresh?: unknown;
    };
    const message = typeof returned.message === 'string' ? returned.message.slice(0, MAX_MESSAGE) : null;
    await audit('succeeded', message);
    return { message, refresh: returned.refresh !== false };
  }

  return { list, run };
}

export type ActionRunner = ReturnType<typeof createActionRunner>;
