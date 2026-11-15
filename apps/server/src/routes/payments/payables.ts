// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → What can be paid.
 *
 * Three kinds of payable exist. Two need no setup: a table built on the
 * invoice shape, and an invoice made on the Invoices page. This file is about
 * the third: any other table the admin marks payable with a mapping (which
 * column is the amount, the currency, where payments land, which status
 * Adminium may set, what the pay page may show).
 *
 * Marking a table is checked twice. The mapping against the table
 * (`payable-rules.ts`, every problem beside its field) and the person against
 * the table: `payments.manage`, read and update on it with no row limit, and
 * create on the payments table a mapping writes into. Someone who may read
 * only some rows must never make every row payable.
 *
 * `check` answers both without saving, with a preview of three real rows as
 * the pay page would resolve them, so the wizard shows the effect live.
 */
import { payableMappingSchema, payableProfilesRepo, appTablesRepo, realTableOf, type MetaDb, type ParsedPayableMapping } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { payableIssues, PAYABLE_ISSUES, valuesOf, type PayableIssue } from '../../payments/payable-rules.js';
import { createPayableSources, resolvePayable, rowKeyOf, type PayableSources } from '../../payments/payables.js';
import { createPublicViews } from '../../public-api/runtime.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { readLimitOf } from '../../rbac/read-limits.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import { createLimitOf, updateLimitOf } from '../../rbac/update-limits.js';
import { workspaceIdQuery, workspaceScope } from '../../workspaces/list-filter.js';
import { tagRoutes } from '../../security/route-audience.js';
import { installOnConnection, installsOf } from '../../installs/resolve.js';
import type { CardTesting } from '../../payments/card-testing.js';
import { rehearsalUntil, setRehearsal } from '../../payments/rehearsal.js';

export interface PaymentPayablesDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** The card-testing breakers (`payments/card-testing.ts`): the pause of public starts, read and resumed here. */
  cardTesting?: Pick<CardTesting, 'pausedUntil' | 'resume'>;
}

const tableBody = z.object({
  connectionId: z.string().min(1).max(64),
  /** The table's id as the schema knows it (`public.orders`). */
  tableId: z.string().min(1).max(255),
  mapping: payableMappingSchema,
});
/** The check also names the status column being chosen while its values are not chosen yet, to read them back. */
const checkBody = tableBody.extend({ statusColumn: z.string().min(1).max(255).nullable().optional() });
const idParams = z.object({ id: z.string().min(1).max(64) });
const patchBody = z.object({ mapping: payableMappingSchema.optional(), enabled: z.boolean().optional() });

const issueView = z.object({ code: z.enum(PAYABLE_ISSUES), path: z.string(), column: z.string().nullable() });
const mayMarkView = z.object({
  ok: z.boolean(),
  /** Why not: a missing grant, a row limit, or the payments table's create. */
  reason: z.enum(['read', 'update', 'row-limit', 'column-limit', 'payments-create']).nullable(),
});
const previewRow = z.object({
  rowKey: z.string(),
  label: z.string(),
  currency: z.string(),
  due: z.string(),
  refusal: z.object({ code: z.string(), message: z.string() }).nullable(),
});
const checkReply = z.object({
  data: z.object({
    issues: z.array(issueView),
    mayMark: mayMarkView,
    preview: z.array(previewRow),
    /**
     * The values the status column (the mapping's, else `statusColumn`) may
     * take, by the rule the save checks (`valuesOf`); null when it has no list
     * or none is named.
     */
    statusValues: z.array(z.string()).nullable(),
  }),
});

const profileView = z.object({
  id: z.string(),
  connectionId: z.string(),
  tableName: z.string(),
  enabled: z.boolean(),
  /** False when the stored mapping no longer reads: the table is not payable until it is saved again. */
  valid: z.boolean(),
  payments: z.enum(['kept', 'table']).nullable(),
  /** The app that declared it, switched on and off with that app in the Apps tab; null for one a person made here. */
  ownerApp: z.string().nullable(),
  /** An invoice an app built on the Invoices shape: the shape maps it. */
  shape: z.boolean(),
  updatedAt: z.number(),
});
const listReply = z.object({
  data: z.object({
    profiles: z.array(profileView),
    /** Tables built on the invoice shape: payable with no setup (version 2 online, version 1 by hand only). */
    shapes: z.array(z.object({ connectionId: z.string(), tableName: z.string(), version: z.number() })),
  }),
});
const profileReply = z.object({ data: profileView });
/** Until when card testing paused the payments apps start; null when they are not paused. */
const publicStartsReply = z.object({ data: z.object({ pausedUntil: z.number().nullable() }) });

/** Until when the person's rehearsal is on; null when it is off. */
const rehearsalReply = z.object({ data: z.object({ until: z.number().nullable() }) });
const appsReply = z.object({
  data: z.object({
    apps: z.array(
      z.object({
        connectionId: z.string(),
        appKey: z.string(),
        name: z.string(),
        /** On when every payable table of the app is: one switch per app. */
        enabled: z.boolean(),
        tables: z.array(z.object({ tableName: z.string(), shape: z.boolean(), valid: z.boolean() })),
      }),
    ),
  }),
});

type MayMark = z.infer<typeof mayMarkView>;

function requirePerson(request: FastifyRequest): void {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Payments are set up by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  if ((request as unknown as { user?: { id?: string } }).user?.id === undefined) throw new UnauthorizedError();
}

export function paymentPayablesRoutes(deps: PaymentPayablesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const views = createPublicViews(meta);
  const sources = createPayableSources({ meta, manager: deps.manager, viewFor: views.viewFor });
  const profiles = payableProfilesRepo(meta);

  async function modelOf(connectionId: string) {
    const view = await views.viewFor(connectionId);
    if (view === null) throw new NotFoundError('That connection has no schema yet.');
    return view.model;
  }

  async function mayMark(request: FastifyRequest, connectionId: string, tableId: string, mapping: ParsedPayableMapping): Promise<MayMark> {
    if (!(await request.can(`table:${connectionId}:${tableId}:read`))) return { ok: false, reason: 'read' };
    if (!(await request.can(`table:${connectionId}:${tableId}:update`))) return { ok: false, reason: 'update' };
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    if (set !== undefined && set.superAdmin !== true) {
      const context = await rowLimitContextOf(meta, set, connectionId, await modelOf(connectionId));
      if (context !== null && (isRowLimited(context, tableId, 'read') || isRowLimited(context, tableId, 'update'))) return { ok: false, reason: 'row-limit' };
      // Someone who may read or change only some columns must not make Adminium read and write the others.
      if (readLimitOf(set, connectionId, tableId) !== null || updateLimitOf(set, connectionId, tableId) !== null) return { ok: false, reason: 'column-limit' };
      if (mapping.payments.kind === 'table' && createLimitOf(set, connectionId, mapping.payments.table) !== null) return { ok: false, reason: 'column-limit' };
    }
    if (mapping.payments.kind === 'table' && !(await request.can(`table:${connectionId}:${mapping.payments.table}:create`))) {
      return { ok: false, reason: 'payments-create' };
    }
    return { ok: true, reason: null };
  }

  async function issuesOf(connectionId: string, tableId: string, mapping: ParsedPayableMapping): Promise<PayableIssue[]> {
    return payableIssues({ model: await modelOf(connectionId), tableId, mapping, connectionCurrency: await sources.connectionCurrency(connectionId) });
  }

  /** Three real rows, resolved with the mapping as if it were saved. */
  async function preview(connectionId: string, tableId: string, mapping: ParsedPayableMapping) {
    const found = await sources.table(connectionId, tableId);
    if (found === null) return [];
    const rows = (await found.target.db.selectFrom(found.table.id).selectAll().limit(3).execute()) as Record<string, unknown>[];
    const unsaved: PayableSources = { ...sources, profile: async () => ({ id: 'preview', enabled: true, mapping }) };
    const out = [];
    for (const row of rows) {
      const rowKey = rowKeyOf(found.table, row);
      const resolved = await resolvePayable(unsaved, { kind: 'profile', connectionId, tableName: tableId, rowKey });
      if (resolved === null) continue;
      out.push({ rowKey, label: resolved.label, currency: resolved.currency, due: resolved.due, refusal: resolved.refusal });
    }
    return out;
  }

  /** The values a status column may take (the save's own rule), or null. */
  async function statusValuesOf(connectionId: string, tableId: string, column: string | null): Promise<string[] | null> {
    if (column === null) return null;
    const model = await modelOf(connectionId);
    const found = model.tables.find((one) => one.id === tableId)?.columns.find((one) => one.name === column);
    if (found === undefined) return null;
    const values = valuesOf(model, found);
    return values === null ? null : [...values];
  }

  function viewOf(profile: Awaited<ReturnType<typeof profiles.byId>>) {
    if (profile === null) throw new NotFoundError('No such payable table.');
    return {
      id: profile.id,
      connectionId: profile.connectionId,
      tableName: profile.tableName,
      enabled: profile.enabled,
      valid: profile.mapping !== null || profile.shape !== null,
      payments: profile.mapping === null ? null : profile.mapping.payments.kind,
      ownerApp: profile.ownerApp,
      shape: profile.shape !== null,
      updatedAt: profile.updatedAt,
    };
  }

  /** An app's payable is the app's: changed by its update, removed by its uninstall, never by hand here. */
  function refuseAppPayable(profile: { ownerApp: string | null }, what: string): void {
    if (profile.ownerApp !== null) {
      throw new ForbiddenError(`This table is payable because the app "${profile.ownerApp}" says so: ${what} it by updating or removing the app. Switch the app on or off in the Apps tab.`, 'FORBIDDEN', {
        reason: 'app-payable',
        app: profile.ownerApp,
      });
    }
  }

  /** Refuses a mapping that may not be saved, with every reason at once. */
  async function assertMarkable(request: FastifyRequest, connectionId: string, tableId: string, mapping: ParsedPayableMapping): Promise<void> {
    const may = await mayMark(request, connectionId, tableId, mapping);
    if (!may.ok) throw new ForbiddenError('You may not make this table payable.', 'TABLE_FORBIDDEN', { reason: may.reason });
    const issues = await issuesOf(connectionId, tableId, mapping);
    if (issues.length > 0) throw new ValidationFailedError('This table cannot be made payable this way.', { issues });
  }

  return async (app) => {
    // For the instance's own people, not the public: kept while the public pages are hidden (`security/route-audience.ts`).
    tagRoutes(app, 'staff');
    app.get('/payments/payables', { schema: { querystring: z.object({ workspaceId: workspaceIdQuery }), response: { 200: listReply } } }, async (request) => {
      if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) {
        throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      }
      // A workspace's databases, narrowed in the query: its payable tables and the invoice tables that may become one.
      const scope = await workspaceScope(meta, request);
      if (scope !== undefined && scope.size === 0) return { data: { profiles: [], shapes: [] } };
      const shapes: { connectionId: string; tableName: string; version: number }[] = [];
      // Ids only, so no connection's DSN is decrypted to list them.
      let connections = meta.db.selectFrom('adminium_connections').select('id');
      if (scope !== undefined) connections = connections.where('id', 'in', [...scope]);
      for (const connection of await connections.execute()) {
        for (const record of await appTablesRepo(meta).forConnection(connection.id)) {
          const match = /^invoices\/invoice@(\d+)#document$/.exec(record.builtOn ?? '');
          if (match !== null) shapes.push({ connectionId: connection.id, tableName: realTableOf(record), version: Number(match[1]) });
        }
      }
      return { data: { profiles: (await profiles.list(scope === undefined ? undefined : [...scope])).map(viewOf), shapes } };
    });

    app.post(
      '/payments/payables/check',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: auditExempt('checking a mapping and previewing three rows saves nothing; marking the table is what is audited') },
        schema: { body: checkBody, response: { 200: checkReply } },
      },
      async (request) => {
        requirePerson(request);
        const { connectionId, tableId, mapping } = request.body;
        const issues = await issuesOf(connectionId, tableId, mapping);
        const may = await mayMark(request, connectionId, tableId, mapping);
        return {
          data: {
            issues,
            mayMark: may,
            // Real rows only for someone who may read every row and column of the table.
            preview: issues.length === 0 && may.ok ? await preview(connectionId, tableId, mapping) : [],
            statusValues: await statusValuesOf(connectionId, tableId, mapping.status?.column ?? request.body.statusColumn ?? null),
          },
        };
      },
    );

    app.post(
      '/payments/payables',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { body: tableBody, response: { 201: profileReply } },
      },
      async (request, reply) => {
        requirePerson(request);
        const { connectionId, tableId, mapping } = request.body;
        await assertMarkable(request, connectionId, tableId, mapping);
        const created = await profiles.create(
          { connectionId, tableName: tableId, mapping, ownerApp: null, createdBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null },
          app.rbac.now(),
        );
        if (created === null) throw new ConflictError('This table is already payable. Change its mapping instead.');
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.payable.marked',
          changes: { after: { connectionId, tableId, payments: mapping.payments.kind, status: mapping.status?.column ?? null } },
        });
        return reply.status(201).send({ data: viewOf(created) });
      },
    );

    app.patch(
      '/payments/payables/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: idParams, body: patchBody, response: { 200: profileReply } },
      },
      async (request) => {
        requirePerson(request);
        const current = await profiles.byId(request.params.id);
        if (current === null) throw new NotFoundError('No such payable table.');
        if (request.body.mapping !== undefined) refuseAppPayable(current, 'change');
        if (request.body.mapping !== undefined) await assertMarkable(request, current.connectionId, current.tableName, request.body.mapping);
        // An app's payable is switched on by someone who manages payments: the install already checked the app's mapping.
        else if (request.body.enabled === true && current.ownerApp !== null) {
          if (current.mapping === null && current.shape === null) throw new ValidationFailedError('This table\'s mapping no longer reads. Update the app to make it payable.');
        }
        // Switching a table back on is marking it payable again: the person and the stored mapping are checked again.
        else if (request.body.enabled === true) {
          if (current.mapping === null) throw new ValidationFailedError('This table\'s mapping no longer reads. Save it again to make it payable.');
          await assertMarkable(request, current.connectionId, current.tableName, current.mapping);
        }
        await profiles.update(
          current.id,
          {
            ...(request.body.mapping === undefined ? {} : { mapping: request.body.mapping }),
            ...(request.body.enabled === undefined ? {} : { enabled: request.body.enabled }),
          },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'payments',
          action: request.body.mapping === undefined ? (request.body.enabled === false ? 'payments.payable.paused' : 'payments.payable.resumed') : 'payments.payable.changed',
          changes: { after: { id: current.id, connectionId: current.connectionId, tableId: current.tableName, enabled: request.body.enabled ?? current.enabled } },
        });
        return { data: viewOf(await profiles.byId(current.id)) };
      },
    );

    app.delete(
      '/payments/payables/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: idParams },
      },
      async (request, reply) => {
        requirePerson(request);
        const current = await profiles.byId(request.params.id);
        if (current === null) throw new NotFoundError('No such payable table.');
        refuseAppPayable(current, 'remove');
        await profiles.remove(current.id);
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.payable.stopped',
          changes: { before: { id: current.id, connectionId: current.connectionId, tableId: current.tableName } },
        });
        return reply.status(204).send();
      },
    );

    /**
     * THE APPS TAB: each installed app that says which of its tables a
     * customer pays, one switch per app on each database. Off as it arrives
     * (an install never switches payments on); someone who manages payments
     * switches it on, whatever rights they hold on the app's own tables (the
     * install already checked the app's mapping).
     */
    app.get('/payments/apps', { schema: { querystring: z.object({ workspaceId: workspaceIdQuery }), response: { 200: appsReply } } }, async (request) => {
      if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) {
        throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      }
      const scope = await workspaceScope(meta, request);
      if (scope !== undefined && scope.size === 0) return { data: { apps: [] } };
      const byApp = new Map<string, { connectionId: string; appKey: string; profiles: Awaited<ReturnType<typeof profiles.list>> }>();
      for (const profile of await profiles.list(scope === undefined ? undefined : [...scope])) {
        if (profile.ownerApp === null) continue;
        const key = `${profile.connectionId}|${profile.ownerApp}`;
        const found = byApp.get(key) ?? { connectionId: profile.connectionId, appKey: profile.ownerApp, profiles: [] };
        found.profiles.push(profile);
        byApp.set(key, found);
      }
      const installs = installsOf(meta);
      const apps = [];
      for (const one of byApp.values()) {
        const install = await installOnConnection(installs, one.appKey, one.connectionId).catch(() => null);
        const document = (install?.document ?? null) as { name?: unknown; icon?: unknown } | null;
        apps.push({
          connectionId: one.connectionId,
          appKey: one.appKey,
          name: typeof document?.name === 'string' ? document.name : one.appKey,
          enabled: one.profiles.every((profile) => profile.enabled),
          tables: one.profiles.map((profile) => ({ tableName: profile.tableName, shape: profile.shape !== null, valid: profile.mapping !== null || profile.shape !== null })),
        });
      }
      apps.sort((a, b) => a.name.localeCompare(b.name) || a.connectionId.localeCompare(b.connectionId));
      return { data: { apps } };
    });

    app.post(
      '/payments/apps/switch',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { body: z.object({ connectionId: z.string().min(1).max(64), appKey: z.string().min(1).max(80), enabled: z.boolean() }).strict(), response: { 200: z.object({ data: z.object({ changed: z.number() }) }) } },
      },
      async (request) => {
        requirePerson(request);
        const { connectionId, appKey, enabled } = request.body;
        const owned = (await profiles.list(connectionId)).filter((profile) => profile.ownerApp === appKey);
        if (owned.length === 0) throw new NotFoundError('That app takes no payments on that database.');
        if (enabled && owned.some((profile) => profile.mapping === null && profile.shape === null)) {
          throw new ValidationFailedError("One of this app's payable tables no longer reads. Update the app to make it payable.");
        }
        let changed = 0;
        for (const profile of owned) {
          if (profile.enabled === enabled) continue;
          await profiles.update(profile.id, { enabled }, app.rbac.now());
          changed += 1;
        }
        await app.rbac.audit(request, {
          category: 'payments',
          action: enabled ? 'payments.app.on' : 'payments.app.off',
          changes: { after: { connectionId, app: appKey, enabled, tables: owned.map((profile) => profile.tableName) } },
        });
        return { data: { changed } };
      },
    );

    /*
     * REHEARSAL (`payments/rehearsal.ts`): the signed-in person's own switch.
     * While on (a few hours), the apps' checkouts they open on the staff
     * address take test payments, and the rows they make are sample rows.
     */
    app.get(
      '/payments/rehearsal',
      { schema: { response: { 200: rehearsalReply } } },
      async (request) => {
        requirePerson(request);
        if (!(await request.can(PERMISSIONS.paymentsManage))) throw new ForbiddenError('Rehearsing a checkout needs payments.manage.');
        const userId = (request as unknown as { user: { id: string } }).user.id;
        return { data: { until: await rehearsalUntil(meta, userId, app.rbac.now()) } };
      },
    );

    app.put(
      '/payments/rehearsal',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { body: z.object({ on: z.boolean() }).strict(), response: { 200: rehearsalReply } },
      },
      async (request) => {
        requirePerson(request);
        const userId = (request as unknown as { user: { id: string } }).user.id;
        const until = await setRehearsal(meta, userId, request.body.on, app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: request.body.on ? 'payments.rehearsal.on' : 'payments.rehearsal.off', changes: { after: { until } } });
        return { data: { until } };
      },
    );

    /*
     * THE PAUSE OF PUBLIC STARTS (`payments/card-testing.ts`): declines from
     * many addresses paused the payments apps start for an hour. Read by
     * anyone who may see payments; resumed sooner by someone who manages them.
     */
    app.get(
      '/payments/public-starts',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsView), schema: { response: { 200: publicStartsReply } } },
      async () => ({ data: { pausedUntil: deps.cardTesting === undefined ? null : await deps.cardTesting.pausedUntil() } }),
    );

    app.post(
      '/payments/public-starts/resume',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { response: { 200: publicStartsReply } },
      },
      async (request) => {
        requirePerson(request);
        const resumed = deps.cardTesting === undefined ? false : await deps.cardTesting.resume();
        if (resumed) await app.rbac.audit(request, { category: 'payments', action: 'payments.public-starts.resume', changes: { after: { pausedUntil: null } } });
        return { data: { pausedUntil: deps.cardTesting === undefined ? null : await deps.cardTesting.pausedUntil() } };
      },
    );
  };
}
