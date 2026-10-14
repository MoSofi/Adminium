// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data API (subset):
 *
 * - `POST /api/v1/widget-data/query` — one descriptor → one shaped payload;
 * - `POST /api/v1/widget-data/batch` — ≤40 `{ instanceId, descriptor }`
 *   items resolved in parallel with per-item error isolation, so a
 *   dashboard loads in one round trip and one failing widget never takes
 *   the page down (acceptance criterion #6).
 *
 * Pipeline per item: Zod validation (route schema) → snapshot identifier
 * resolution → per-table RBAC read check (403 TABLE_FORBIDDEN + audit on
 * denial) → PII column refusal (403 COLUMN_FORBIDDEN, in the compiler) →
 * dynamic-Kysely execution on the data connection → envelope shaping → 30
 * s in-memory cache keyed on descriptor+params+connection+role scope+the
 * reader's locale.
 */

import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { connectionTenantConfig, overridesRepo, snapshotsRepo, userPrefsRepo, type MetaDb } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';

import { auditExempt } from '../../audit/coverage.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { SnapshotView } from '../../crud/identifiers.js';
import { resolveLookups } from '../../crud/lookups.js';
import { canReadPii, piiCheckFor } from '../../crud/mask.js';
import type { Row } from '../../crud/mask.js';
import { rowTestTables, type RowTest } from '../../crud/row-limit.js';
import { limitProjections, rowLimitContextOf, rowTestOf } from '../../crud/row-limit-context.js';
import { ROW_ACTIONS } from '../../rbac/row-limits.js';
import { WidgetDataCache, cacheKeyOf } from '../../widget-data/cache.js';
import { readViewFor } from '../../crud/read-view.js';
import { venueClock } from '../../crud/venue-time.js';
import { answerCapacityCounts, countsAccessFor, type ShapedCapacity } from '../../widget-data/capacity.js';
import { compileWidgetQuery, resolveSource } from '../../widget-data/compiler.js';
import { countsTablesOf, joinCounts, limitTablesOf } from '../../widget-data/counts-join.js';
import { groupLabelSourceOf, groupLabelsFor } from '../../widget-data/group-labels.js';
import { daysSinceOf, isStaffColumn, peopleColumnsOf, peopleNames, staffGroupLabels, withDaysSince } from '../../widget-data/people-names.js';
import { translatorFor } from '../../i18n/server-i18n.js';
import { answerTeamFigures, type ShapedTeam } from '../../widget-data/team-figures.js';
import { resolveLinkFilters } from '../../widget-data/link-filters.js';
import { resolvePaths } from '../../widget-data/paths.js';
import { shapeRows, toNumber, type ShapedPayload } from '../../widget-data/shapers.js';
import {
  linkFiltersBody,
  linkFiltersReply,
  widgetBatchBody,
  widgetBatchReply,
  widgetQueryBody,
  widgetQueryReply,
} from './schema.js';

export interface WidgetDataRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  /** Injectable for TTL tests; a fresh 30 s cache otherwise. */
  cache?: WidgetDataCache | undefined;
  /** Injectable clock for `window` bounds (tests). */
  now?: (() => Date) | undefined;
}

interface QueryOutcome {
  result: ShapedPayload | ShapedCapacity | ShapedTeam;
  cached: boolean;
}

export function widgetDataRoutes(deps: WidgetDataRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const cache = deps.cache ?? new WidgetDataCache();
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const viewCache = new Map<string, { stamp: string; view: SnapshotView }>();
  /*
   * The reader's language, looked up once per request however many cards a
   * batch carries. A card's column names and a choice column's value labels
   * an app ships in several languages are read in it, as a page's are.
   */
  const readerLocales = new WeakMap<FastifyRequest, Promise<string | undefined>>();
  function readerLocale(request: FastifyRequest): Promise<string | undefined> {
    let locale = readerLocales.get(request);
    if (locale === undefined) {
      const userId = request.user?.id;
      locale = userId === undefined ? Promise.resolve(undefined) : userPrefsRepo(meta).resolve(userId).then((prefs) => prefs.locale);
      readerLocales.set(request, locale);
    }
    return locale;
  }

  // Same snapshot-view resolution as routes/data — stamped on snapshot id +
  // active-override set so remaps/masks invalidate immediately. One view per
  // locale: the labels in it are resolved for that reader.
  async function viewFor(connectionId: string, locale: string | undefined): Promise<SnapshotView> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) {
      throw new NotFoundError('No schema snapshot — introspect the connection first.', {
        connectionId,
      });
    }
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const last = active.at(-1);
    const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
    const cacheKey = `${connectionId}\u0000${locale ?? ''}`;
    const cached = viewCache.get(cacheKey);
    if (cached !== undefined && cached.stamp === stamp) return cached.view;
    const view = new SnapshotView(
      connectionId,
      applyOverrides(snapshot.schema as DatabaseModel, active, locale === undefined ? {} : { defaultLocale: locale }),
    );
    viewCache.set(cacheKey, { stamp, view });
    return view;
  }

  /** What a group is called when its person is not named, in the reader's language; asked once a request. */
  const unnamedWords = new WeakMap<FastifyRequest, Promise<string>>();
  function unnamedWord(request: FastifyRequest): Promise<string> {
    let word = unnamedWords.get(request);
    if (word === undefined) {
      word = translatorFor(meta, request.user?.id ?? null).then(({ t }) => t('roles:people.unnamed', { defaultValue: 'Unnamed person' }));
      unnamedWords.set(request, word);
    }
    return word;
  }
  /** A person signed in, who the people list answers; an API key is nobody and is told no name. */
  const namesPeople = (request: FastifyRequest): boolean => request.user?.id !== undefined && (request.apiKeyPrincipal === null || request.apiKeyPrincipal === undefined);

  return async (app) => {
    async function runDescriptor(
      request: FastifyRequest,
      descriptor: QueryDescriptor,
      params: Record<string, unknown> | undefined,
    ): Promise<QueryOutcome> {
      const connectionId = descriptor.connectionId;
      await manager.mustFind(connectionId);
      const locale = await readerLocale(request);
      // As this person reads it: a column their role does not show is refused by name, and never a card's.
      const view = await readViewFor(request, await viewFor(connectionId, locale));

      // Identifier resolution FIRST, then RBAC on the resolved name.
      const table = resolveSource(view, descriptor);
      const permission = `table:${connectionId}:${table.id}:read`;
      if (!(await request.can(permission))) {
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'permission.denied',
          connectionId,
          changes: { after: { permission, method: request.method, url: request.url } },
        });
        throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', {
          permission,
        });
      }

      // This table's personal columns; lookups and group labels ask of their own.
      const unmasked = await canReadPii(request, connectionId, table.id);
      const piiOf = piiCheckFor(request, connectionId);
      const resolution = await app.rbac.resolve(request);
      // …and by what the roles read of the tables: a limit tightened on the same role is a new answer at once, never the cached one.
      const reads = resolution.readLimits === undefined ? '' : `:${JSON.stringify(resolution.readLimits.limited.map((entry) => [entry.grant, [...entry.limit.readable].sort()]))}`;
      /*
       * …and by WHOSE rows they are. A person a role holds to some rows reads
       * figures over the rows they reach: the answer is theirs alone, so it is
       * kept under who they are, whom they lead (a change of team is a new
       * answer at the next request) and what each role of theirs reaches.
       * Nobody else's key changes: for them there is nothing to add.
       */
      const rowsCtx = await rowLimitContextOf(deps.meta, resolution, connectionId, view.model);
      const rowScope =
        rowsCtx === null
          ? ''
          : `:rows:${createHash('sha256')
              .update(
                JSON.stringify([
                  resolution.reach?.userId ?? null,
                  resolution.reach?.ledIds ?? [],
                  // Each role's limits, and the plain grants beside them: one taken away lifts nothing any more.
                  ROW_ACTIONS.map((action) => (resolution.rowLimits?.[action] ?? []).map((role) => [role.limited.map((entry) => [entry.grant, entry.reach]), [...role.unlimited].sort()])),
                  // What each table says of its rows: a table made private, or ways changed, is a new answer.
                  view.model.tables.filter((one) => one.belongs !== undefined || one.private === true).map((one) => [one.id, one.belongs ?? null, one.private ?? false]),
                  rowsCtx.today,
                ]),
              )
              .digest('hex')}`;
      const rowTestFor = (tableId: string): RowTest | null => rowTestOf(rowsCtx, tableId, 'read');
      // …and by whether the reader is told people's names at all (a person is, an API key is not).
      const roleScope = `${[...resolution.roleIds].sort().join(',')}${resolution.superAdmin ? '+sa' : ''}:${unmasked ? 'pii' : 'masked'}${namesPeople(request) ? '' : ':unnamed'}${reads}${rowScope}`;
      // The answer carries labels in the reader's language, so it is kept per language too.
      // And per venue day: "today" (a day filter, a calendar window, a limit's counts) moves at the venue's midnight.
      const venueDay = venueClock(deps.now?.() ?? new Date(), (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC').day;
      const key = cacheKeyOf({ descriptor, params: params ?? null, connectionId, roleScope, locale: locale ?? null, day: venueDay });
      const hit = cache.get(key);
      if (hit !== undefined) return { result: hit as ShapedPayload, cached: true };

      /*
       * A limit's counts: the desk's counts route answered for a card, on that
       * route's rules — the pools' tables and a column asked under are
       * checked by the counts themselves, through this reader's access.
       */
      if (descriptor.kind === 'capacity-counts') {
        const { db, dialect } = await manager.data(connectionId);
        const tenant = await connectionTenantConfig(deps.meta, connectionId);
        const result = await answerCapacityCounts({
          descriptor,
          params: params ?? {},
          connectionId,
          view,
          table,
          db,
          dialect,
          timezone: tenant?.timezone ?? undefined,
          currency: tenant?.currency ?? null,
          now: deps.now?.() ?? new Date(),
          access: countsAccessFor(request, connectionId, view, rowsCtx),
          canReadPii: piiOf,
        });
        cache.set(key, result, connectionId, table.id, limitTablesOf(view, table));
        return { result, cached: false };
      }

      /*
       * A whole team's figures: answered whole to a person no row limit
       * holds on the tables they are worked out from, and refused to anybody
       * else (`widget-data/team-figures.ts`).
       */
      if (descriptor.kind === 'team-figures') {
        const { db, dialect } = await manager.data(connectionId);
        const tenant = await connectionTenantConfig(deps.meta, connectionId);
        const result = await answerTeamFigures({
          descriptor,
          connectionId,
          view,
          table,
          db,
          dialect,
          meta,
          timezone: tenant?.timezone ?? undefined,
          now: deps.now?.() ?? new Date(),
          reach: rowsCtx,
          canReadTable: (tableId) => request.can(`table:${connectionId}:${tableId}:read`),
          named: namesPeople(request),
          unnamed: await unnamedWord(request),
        });
        // Kept until either table is written to: a target changed is a new cover.
        cache.set(key, result.shaped, connectionId, table.id, result.targetTable === null ? [] : [result.targetTable]);
        return { result: result.shaped, cached: false };
      }

      // Resolved here rather than in the compiler: whether each reached table
      // may be read is a question about THIS caller. A refused lookup degrades
      // to null + `_masked` rather than failing the widget (the CRUD rule).
      const lookups =
        (descriptor.lookups?.length ?? 0) === 0
          ? []
          : await resolveLookups({
              view,
              table,
              raw: descriptor.lookups ?? [],
              canReadPii: piiOf,
              canReadTable: (tableId) => request.can(`table:${connectionId}:${tableId}:read`),
            });
      // A value looked up from another table: from a row of it this reader reaches.
      limitProjections(rowsCtx, lookups, []);

      // Staff columns read as names, and days counted from a date: each a column this reader is shown, and one the rows carry.
      const peopleColumns = peopleColumnsOf(descriptor, table);
      const days = daysSinceOf(descriptor, table);
      for (const name of [...peopleColumns, ...days.map((one) => one.column)]) {
        if (descriptor.select !== undefined && !descriptor.select.includes(name)) throw new ValidationFailedError(`"${name}" is read off the rows listed, so \`select\` names it too.`, { select: descriptor.select });
      }

      const canReadTable = (tableId: string) => request.can(`table:${connectionId}:${tableId}:read`);
      // Filter and window columns one link away: this reader's read of that table and column, or a refusal.
      const paths = await resolvePaths({ view, table, descriptor, connectionId, canReadPii: piiOf, canReadTable });
      // Where a group's label is read, when this reader may: a ranking's ties fall to it.
      const groupLabel = await groupLabelSourceOf({ path: descriptor.groupLabel, groupColumn: descriptor.groupBy?.[0], table, view, canReadPii: piiOf, canReadTable });

      const { db, dialect } = await manager.data(connectionId);
      // The venue's clock: where "today" starts, and whose hours a chart shows.
      const timezone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? undefined;
      const compiled = compileWidgetQuery({
        db,
        view,
        descriptor,
        params,
        canReadPii: unmasked,
        dialect,
        now: deps.now,
        lookups,
        timezone,
        paths,
        groupLabel,
        ...(rowsCtx === null ? {} : { rowTestFor }),
      });

      const startedAt = Date.now();
      const rows = (await compiled.query.execute()) as Row[];
      const priorRows =
        compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Row[]);
      let total: number | undefined;
      if (compiled.count !== null) {
        const countRow = (await compiled.count.executeTakeFirst()) as { total?: unknown } | undefined;
        total = toNumber(countRow?.total);
      }
      // What each foreign-key group is called, read like a lookup: this caller's read, this caller's mask.
      const groupLabels = await groupLabelsFor({
        path: descriptor.groupLabel,
        compiled,
        rows,
        view,
        db,
        canReadPii: piiOf,
        canReadTable: (tableId) => request.can(`table:${connectionId}:${tableId}:read`),
        ...(rowsCtx === null ? {} : { rowTestFor }),
      });
      // A group keyed by a staff column is called by the person's name, by the people list's own rule; nobody by an id.
      const staffLabels = async (index: 0 | 1, alias: string | null): Promise<Map<string, string> | undefined> =>
        alias === null || !isStaffColumn(compiled.table, compiled.groupColumns[index])
          ? undefined
          : staffGroupLabels({ meta, keys: [...rows, ...(priorRows ?? [])].map((row) => row[alias]), named: namesPeople(request), unnamed: await unnamedWord(request) });
      const groupNames = descriptor.groupLabel === undefined ? await staffLabels(0, compiled.groupAlias) : undefined;
      const colLabels = await staffLabels(1, compiled.colAlias);
      const listed = shapeRows({ compiled, rows, priorRows, total, canReadPii: unmasked, connectionId, groupLabels: groupLabels ?? groupNames, colLabels });
      const shaped =
        listed.shape !== 'record-list' || (peopleColumns.length === 0 && days.length === 0)
          ? listed
          : {
              ...listed,
              rows: withDaysSince(listed.rows, days, { table: compiled.table, dialect, timezone: timezone ?? 'UTC', now: deps.now?.() ?? new Date() }),
              // Only the ids these rows hold, and only to a person: the names of the people this reader was already shown the rows of.
              ...(peopleColumns.length === 0
                ? {}
                : { people: Object.fromEntries(namesPeople(request) ? await peopleNames(meta, listed.rows.flatMap((row) => peopleColumns.map((name) => row[name]))) : []) }),
            };
      // What a limit has taken from each row listed (`counts`), on the counts route's read rules.
      const result =
        descriptor.counts === undefined || shaped.shape !== 'record-list'
          ? shaped
          : {
              ...shaped,
              ...(await joinCounts({
                descriptor,
                params: params ?? {},
                connectionId,
                view,
                source: compiled.table,
                rows: shaped.rows,
                columns: shaped.columns,
                db,
                dialect,
                timezone,
                now: deps.now?.() ?? new Date(),
                access: countsAccessFor(request, connectionId, view, rowsCtx),
              })),
            };

      // Execution metrics for the Studio slow-query panel — the
      // structured log line is the v1 sink.
      request.log.info(
        {
          widgetData: {
            connectionId,
            table: compiled.table.id,
            shape: compiled.shape,
            ms: Date.now() - startedAt,
            rows: rows.length,
          },
        },
        'widget-data query',
      );

      // …and, for a reader held to some rows, until a table that says whose a row is changes: a listing ended is no longer counted.
      cache.set(key, result, connectionId, compiled.table.id, [...countsTablesOf(view, descriptor), ...(rowsCtx === null ? [] : rowTestTables(view.model, compiled.table.id))]);
      return { result, cached: false };
    }

    app.post(
      '/widget-data/query',
      { schema: { body: widgetQueryBody, response: { 200: widgetQueryReply } } },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        return runDescriptor(request, request.body.descriptor, request.body.params);
      },
    );

    /*
     * A link that opens a records page filtered. Worked out here rather than in
     * the browser because "today" is the venue's and the column types are the
     * snapshot's; the page then ANDs the returned tree into every read of its
     * list (and its exports), where each value binds like any other filter.
     * The same table read check as a widget, so a link cannot probe a table
     * its reader may not open.
     */
    app.post(
      '/widget-data/link-filters',
      {
        schema: { body: linkFiltersBody, response: { 200: linkFiltersReply } },
        // The denied branch audits (rbac permission.denied), as a widget read does.
        config: {
          audit: auditExempt('Works out a list filter from a link and reads no rows; a POST only because the pieces ride in a body.'),
        },
      },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        const { connectionId, filters } = request.body;
        await manager.mustFind(connectionId);
        const view = await readViewFor(request, await viewFor(connectionId, await readerLocale(request)));
        const table = view.table(request.body.table);
        const permission = `table:${connectionId}:${table.id}:read`;
        if (!(await request.can(permission))) {
          await app.rbac.audit(request, {
            category: 'rbac',
            action: 'permission.denied',
            connectionId,
            changes: { after: { permission, method: request.method, url: request.url } },
          });
          throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
        }
        const { dialect } = await manager.data(connectionId);
        const timezone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';
        return resolveLinkFilters({
          pieces: filters,
          table,
          canReadPii: await canReadPii(request, connectionId, table.id),
          dialect,
          timezone,
          now: deps.now?.() ?? new Date(),
        });
      },
    );

    app.post(
      '/widget-data/batch',
      { schema: { body: widgetBatchBody, response: { 200: widgetBatchReply } } },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        const { requests, params } = request.body;
        const settled = await Promise.all(
          requests.map(async (item) => {
            try {
              const outcome = await runDescriptor(request, item.descriptor, params);
              return {
                instanceId: item.instanceId,
                value: { ok: true as const, result: outcome.result, cached: outcome.cached },
              };
            } catch (error) {
              if (error instanceof AppError) {
                return {
                  instanceId: item.instanceId,
                  value: {
                    ok: false as const,
                    error: { code: error.code, message: error.message, statusCode: error.statusCode },
                  },
                };
              }
              // Never leak raw driver/SQL text to widgets (error state).
              request.log.error({ err: error }, 'widget-data batch item failed');
              return {
                instanceId: item.instanceId,
                value: {
                  ok: false as const,
                  error: { code: 'INTERNAL', message: 'The widget query failed.', statusCode: 500 },
                },
              };
            }
          }),
        );
        const results: Record<string, (typeof settled)[number]['value']> = {};
        for (const item of settled) results[item.instanceId] = item.value;
        return { results };
      },
    );
  };
}
