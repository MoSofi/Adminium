// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD'S OWN ACTION: `POST /data/:connectionId/:table/:recordId/actions/:actionId`.
 *
 * A table's states may name buttons (`states.actions`). Two of the four kinds
 * change the row: a `move` (to the state the rule names, with the columns it
 * sets) and a `set` (columns only, in the states it names). The browser sends
 * the action's id, the state it saw the row in and the few values the action
 * asks for — never the target state, never a value the rule sets. What is
 * written is read from the rule here, and saved by the PATCH's own body
 * (`changeRecord`), so the hooks, the lock, the effects, the postings, the
 * audit row and the Undo are the PATCH's.
 *
 * A `link` is a place to go and a `child` is a plain create on the child
 * table: neither has a route of its own.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { StateActionRule } from '../../connections/effective-schema.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { parseRecordId } from '../../crud/records.js';
import { StateMoveRefused } from '../../crud/states.js';
import { NotFoundError, ValidationFailedError } from '../../errors.js';
import { recordActionBody, recordActionParams, recordMutationReply } from './schema.js';

type MoveAction = Extract<StateActionRule, { move: unknown }>;
type SetAction = Extract<StateActionRule, { in: string[]; set: unknown }> & { ask?: string[] };

/** The two kinds this route makes; a link or a child form is not found here. */
function changing(action: StateActionRule | undefined): MoveAction | SetAction | null {
  if (action === undefined) return null;
  if ('move' in action) return action;
  if ('link' in action || 'child' in action) return null;
  return 'set' in action ? (action as SetAction) : null;
}

/** As much of the data routes' context as an action reads; the rest is theirs to carry. */
interface ActionContext {
  table: ResolvedTable;
}

export interface RecordActionDeps<Context extends ActionContext, Changed> {
  contextFor(request: FastifyRequest, action: 'update'): Promise<Context>;
  changeRecord(
    request: FastifyRequest,
    ctx: Context,
    recordId: string,
    body: { values: Row; from?: string | undefined; seen?: Record<string, string | number | boolean | null> | undefined },
    own: { values: Row; judged: Row },
  ): Promise<Changed>;
  /** The values a form typed, as a PATCH reads them: unknown, secret and unreadable columns refused. */
  asked(ctx: Context, values: Row): Row;
  /** One value the rule sets, as the column stores it. */
  fixed(ctx: Context, column: string, value: unknown): unknown;
}

export function recordActionRoutes<Context extends ActionContext, Changed>(instance: FastifyInstance, deps: RecordActionDeps<Context, Changed>): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/data/:connectionId/:table/:recordId/actions/:actionId',
    { schema: { params: recordActionParams, body: recordActionBody, response: { 200: recordMutationReply } } },
    async (request) => {
      const ctx = await deps.contextFor(request, 'update');
      const states = ctx.table.table?.states;
      const action = changing(states?.actions?.find((candidate) => candidate.id === request.params.actionId));
      // No such action, and no such record, are one answer.
      if (states === undefined || action === null) throw new NotFoundError('Record not found.', { pk: parseRecordId(ctx.table, request.params.recordId) });

      // Only what the action asks for is the caller's to type.
      const typed = request.body.values ?? {};
      const ask = new Set(action.ask ?? []);
      const strangers = Object.keys(typed).filter((column) => !ask.has(column));
      if (strangers.length > 0) {
        throw new ValidationFailedError('This action takes only the values it asks for.', {
          fields: Object.fromEntries(strangers.map((column) => [column, { code: 'not-writable' }])),
        });
      }
      const asked = Object.keys(typed).length === 0 ? {} : deps.asked(ctx, typed);

      // What the rule sets is the rule's, at this server's time, whatever was typed.
      const now = new Date().toISOString();
      const set: Row = {};
      for (const [column, value] of Object.entries(action.set ?? {})) {
        set[column] = deps.fixed(ctx, column, value !== null && typeof value === 'object' ? now : value);
      }

      if ('move' in action) {
        const to = action.move.to;
        // A move from the state it leads to moves nothing: the roles, what it waits for and the role's limit are all
        // judged on a state that changes, so a row already there is refused here — never given the move's columns again.
        if (request.body.from === to) {
          throw new StateMoveRefused(`This ${ctx.table.name} row is ${to} already.`, { column: states.column, from: request.body.from, to });
        }
        const moved = { [states.column]: to };
        // A move's own columns are the move's, as a timed move's are: the role's limit is asked about the state and what was typed.
        return deps.changeRecord(request, ctx, request.params.recordId, { values: {}, from: request.body.from }, { values: { ...asked, ...set, ...moved }, judged: { ...moved, ...asked } }) as Promise<never>;
      }
      if (!action.in.includes(request.body.from)) {
        throw new StateMoveRefused(`This is not done while a ${ctx.table.name} row is ${request.body.from}.`, { column: states.column, from: request.body.from });
      }
      // Nothing moves, so the state the page saw is a plain condition of the change; and every column it writes is the role's to answer for.
      const values = { ...asked, ...set };
      return deps.changeRecord(request, ctx, request.params.recordId, { values: {}, seen: { [states.column]: request.body.from } }, { values, judged: values }) as Promise<never>;
    },
  );
}
