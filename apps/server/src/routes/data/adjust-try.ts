// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PRICE TRIED BEFORE IT IS SAVED: `POST /data/:connectionId/:table/try`.
 *
 * Somebody setting up an offer wants to see what it would do to a real order
 * before switching it on. They name a SAVED row of a table whose price an
 * add-on lowers; they may put other codes in place of the ones typed on it,
 * suppose a guest or a signed-in customer, and hand in an offer that is not
 * saved yet. The answer is the order's own figures as they would stand, each
 * line's reduction, what applied, the codes that do not stand with why, and
 * — when asked — a reason for every offer that did not apply.
 *
 * Nothing is written: no transaction, no lock, no use recorded, no guess
 * counted. No price is ever made up on a page: the lines and their prices are
 * the stored row's. For somebody who reads the order and its lines and may
 * change the add-on's offers; limited per user, because every call runs the
 * add-on's code.
 */
import { ADJUST_CODES_MAX, ADJUST_EXPLAIN_REASONS, ADJUST_REASONS } from '@adminium/add-on-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { appliedReply } from '../../crud/adjust/replies.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { WriteTarget } from '../../crud/write-context.js';
import type { RecordWriteService } from '../../crud/write-service.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { auditExempt } from '../../audit/coverage.js';
import { appliedSchema, dataTableParams, toldSchema } from './schema.js';

const scalar = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

export const priceTryBody = z
  .object({
    /** The key of a saved row of the table. */
    row: z.union([z.string().min(1).max(200), z.number()]),
    /** Codes tried in place of the ones typed on the row. */
    codes: z.array(z.string().min(1).max(64)).max(ADJUST_CODES_MAX).optional(),
    /** An offer not saved yet, by the columns of the add-on's offers table: it stands in for the stored offer of its key, or joins the others. */
    draft: z.record(z.string().min(1).max(64), scalar).optional(),
    explain: z.boolean().optional(),
    buyer: z.enum(['guest', 'customer']).optional(),
    /** The moment the try is judged at; now when absent. */
    at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const priceTryReply = z.object({
  /** The row's own columns as they would stand: its totals, its reduction, what follows from them. */
  data: z.record(z.string(), z.unknown()),
  lines: z.array(z.object({ table: z.string(), key: z.string(), discount: z.string() })),
  applied: appliedSchema,
  told: toldSchema,
  /** The codes that do not stand, each with why: a try lists them and never fails for one. */
  refused: z.array(z.object({ typed: z.string(), reason: z.enum(ADJUST_REASONS), params: z.object({ amount: z.string().optional(), max: z.string().optional(), name: z.string().optional() }).optional() })),
  explain: z.array(z.object({ offer: z.string(), name: z.string(), applies: z.boolean(), reason: z.enum(ADJUST_EXPLAIN_REASONS).optional(), amount: z.string().optional() })).optional(),
});

/** As much of the data routes' context as a try reads. */
interface TryContext {
  connectionId: string;
  view: SnapshotView;
  readView: SnapshotView;
  table: ResolvedTable;
  readTable: ResolvedTable;
  target: WriteTarget;
  unmasked: boolean;
}

export interface PriceTryDeps<Context extends TryContext> {
  writes: Pick<RecordWriteService, 'tryPrice'>;
  contextFor(request: FastifyRequest, action: 'read'): Promise<Context>;
  /** The stored row by a key as a body carries one, or undefined. */
  rowOf(ctx: Context, key: string | number): Promise<Row | undefined>;
  /** A row as this caller reads the table. */
  shown(ctx: Context, row: Row): Row;
  /** The language the caller reads the dashboard in. */
  localeOf(request: FastifyRequest): Promise<string>;
}

export function priceTryRoutes<Context extends TryContext>(instance: FastifyInstance, deps: PriceTryDeps<Context>): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/data/:connectionId/:table/try',
    {
      config: { rateLimitBucket: 'price-try', audit: auditExempt('a try reads and writes nothing') },
      schema: { params: dataTableParams, body: priceTryBody, response: { 200: priceTryReply } },
    },
    async (request) => {
      const ctx = await deps.contextFor(request, 'read');
      const body = request.body;
      const tried = await deps.writes.tryPrice({
        target: ctx.target,
        // Read only once the caller is known to read everything a try shows: a row that is not there answers as any missing row does.
        order: async () => {
          const row = await deps.rowOf(ctx, body.row);
          if (row === undefined) throw new NotFoundError('Record not found.', { pk: body.row });
          return row;
        },
        typed: body.codes,
        draft: body.draft,
        explain: body.explain,
        buyer: body.buyer,
        at: body.at === undefined ? undefined : new Date(body.at),
        locale: await deps.localeOf(request),
        may: async ({ read, update }) => {
          for (const [action, tables] of [['read', read], ['update', update]] as const) {
            for (const table of tables) {
              const permission = `table:${ctx.connectionId}:${table}:${action}`;
              if (await request.can(permission)) continue;
              await instance.rbac.audit(request, { category: 'rbac', action: 'permission.denied', connectionId: ctx.connectionId, changes: { after: { permission, method: request.method, url: request.url } } });
              throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
            }
          }
        },
      });
      const nameOf = (id: string): string => ctx.view.table(id).name;
      const answer = appliedReply(tried, {
        locale: await deps.localeOf(request),
        places: tried.places,
        lineOf: (line) => {
          const found = tried.lines.find((candidate) => candidate.line === line);
          // The order is its own line: the reduction is the order's.
          return found === undefined || found.table === ctx.table.id ? null : `${nameOf(found.table)}:${found.key}`;
        },
        columnOf: () => tried.typed?.column ?? '',
      });
      // An offer is named to somebody who reads the column it is named by.
      const named = tried.label !== undefined && ctx.readView.table(tried.offers).columns.get(tried.label)?.unreadable !== true;
      return {
        data: deps.shown(ctx, tried.order),
        lines: tried.lines.map((line) => ({ table: nameOf(line.table), key: line.key, discount: line.discount })),
        applied: answer.applied,
        told: answer.told,
        refused: tried.refused,
        ...(tried.explain === undefined ? {} : { explain: tried.explain.map((entry) => ({ ...entry, name: named ? entry.name : '' })) }),
      };
    },
  );
}
