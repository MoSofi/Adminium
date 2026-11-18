// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/views` — how many times strangers saw some things of one
 * add-on install, per day (`views/counter.ts` counts them).
 *
 *   ?installId=<adminium_manifests id>&kind=page|form-page|form-opened|form-sent
 *     (the install may instead be named as the add-on kit names it, by the
 *     `X-Adminium-Install` header; `?installId=` wins, since a funnel reads
 *     a forms install's counts from the pages add-on's page)
 *   &things=<key>,<key>…      (at most 50)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD   (both included, at most 400 days)
 *   [&place=<page key>]       (a form's counts on one page only)
 *
 * Answers each thing's days that have views (a day with none has no row),
 * with `countingSince` and the level, so a funnel can say "counting started
 * on …" or "counting is off".
 *
 * ─── Who may ───────────────────────────────────────────────────────────────
 * Whoever may read the counted things' own table, and nobody else: the
 * forms table for a form's kinds, the pages table for `page` (the add-on's
 * `addOn.forms.forms` and `addOn.landing.pages` words). A role without read
 * there is refused (403), as is one held to some of its rows: the counts are
 * of every row and would tell them of the others. An install that is not
 * there, or that declares no such table, is not found (404). A signed-in
 * person or a staff key (`requireAuth`); staff only.
 */
import { formsOf, isAddOnManifest, landingOf, validateManifest, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, realTableOf, settingsRepo, viewDaysRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { INSTALL_HEADER } from '../../installs/resolve.js';
import { VIEW_KINDS, type ViewKind } from '../../views/counter.js';

export interface ViewCountsRouteDeps {
  meta: MetaDb;
}

/** The most things one read names, and the longest range it covers. */
export const VIEWS_THINGS_MAX = 50;
export const VIEWS_DAYS_MAX = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const viewsQuery = z.object({
  installId: z.string().min(1).max(64).optional(),
  kind: z.enum(VIEW_KINDS),
  things: z.string().min(1).max(VIEWS_THINGS_MAX * 65),
  from: z.string().regex(DAY),
  to: z.string().regex(DAY),
  place: z.string().max(64).optional(),
});

export const viewCountsReply = z.object({
  data: z.object({
    level: z.enum(['off', 'counts', 'visitor']),
    countingSince: z.number().nullable(),
    things: z.array(z.object({ thing: z.string(), days: z.array(z.object({ day: z.string(), place: z.string(), views: z.number() })) })),
  }),
});

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading view counts never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading view counts never reads a credential');
  },
};

/** The ref of the table a kind's things are rows of, as an add-on's manifest names it; null when it names none. */
export function countedTableRef(manifest: AddOnManifest, kind: ViewKind): string | null {
  // A page is a row of the landing word's pages table (`addOn.landing.pages`), read as the pages door reads it.
  if (kind === 'page') return landingOf(manifest)?.pages ?? null;
  return formsOf(manifest)?.forms ?? null;
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function viewCountsRoutes(deps: ViewCountsRouteDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  return async (app) => {
    app.get('/views', { preHandler: [app.requireAuth], schema: { querystring: viewsQuery, response: { 200: viewCountsReply } } }, async (request) => {
      const { kind, from, to, place } = request.query;
      const header = request.headers[INSTALL_HEADER];
      const installId = request.query.installId ?? (typeof header === 'string' && header.length > 0 && header.length <= 64 ? header : undefined);
      if (installId === undefined) throw new ValidationFailedError('Name the install the counts are of (`installId`, or the X-Adminium-Install header).', { field: 'installId' });
      const things = [...new Set(request.query.things.split(',').map((one) => one.trim()).filter((one) => one !== ''))];
      if (things.length === 0 || things.length > VIEWS_THINGS_MAX || things.some((one) => one.length > 64)) throw new ValidationFailedError(`Name from 1 to ${String(VIEWS_THINGS_MAX)} things, each a row key.`, { field: 'things' });
      const span = (dayNumber(to) - dayNumber(from)) / DAY_MS;
      if (!Number.isFinite(span) || span < 0 || span >= VIEWS_DAYS_MAX) throw new ValidationFailedError(`Ask for a range of 1 to ${String(VIEWS_DAYS_MAX)} days, from before to.`, { field: 'from' });

      // The install, its manifest, and the table its counted things are rows of.
      const found = await manifestsRepo(meta, NO_SECRETS).findById(installId);
      const notHere = () => new NotFoundError('There are no counts for that here.', { installId });
      if (found === null || found.row.kind !== 'add-on' || found.row.connectionId === null) throw notHere();
      const read = validateManifest(found.document);
      if (!read.ok || !isAddOnManifest(read.manifest)) throw notHere();
      const ref = countedTableRef(read.manifest, kind);
      if (ref === null) throw notHere();
      const connectionId = found.row.connectionId;
      const record = (await appTablesRepo(meta).forConnection(connectionId)).find((one) => one.appKey === found.row.manifestKey && one.ref === ref && ['created', 'adopted', 'shared'].includes(one.state));
      const view = await loadSnapshotView(meta, connectionId, { forOthers: true }).catch(() => null);
      let tableId: string | null = null;
      try {
        tableId = record === undefined || view === null ? null : view.table(realTableOf(record)).id;
      } catch {
        tableId = null;
      }
      if (tableId === null) throw notHere();

      // Whoever may read the counted rows' table, whole.
      if (!(await request.can(`table:${connectionId}:${tableId}:read`))) throw new ForbiddenError('You may not read what these counts are of.', 'FORBIDDEN', { installId });
      const set = await app.rbac.resolve(request);
      if (set.superAdmin !== true && view !== null) {
        const context = await rowLimitContextOf(meta, set, connectionId, view.model);
        if (context !== null && isRowLimited(context, tableId, 'read')) throw new ForbiddenError('You may read only some of these rows, so their counts are not shown.', 'FORBIDDEN', { installId, reason: 'row-limit' });
      }

      const rows = await viewDaysRepo(meta).read({ installId, kind, things, from, to, place });
      const settings = settingsRepo(meta);
      const [level, countingSince] = await Promise.all([settings.get('privacy.tracking'), settings.get('privacy.countingSince')]);
      return {
        data: {
          level,
          countingSince,
          things: things.map((thing) => ({ thing, days: rows.filter((row) => row.thing === thing).map((row) => ({ day: row.day, place: row.place, views: row.views })) })),
        },
      };
    });
  };
}
