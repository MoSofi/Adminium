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
import { payableMappingSchema, payableProfilesRepo, appTablesRepo, type MetaDb, type ParsedPayableMapping } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { payableIssues, PAYABLE_ISSUES, type PayableIssue } from '../../payments/payable-rules.js';
import { createPayableSources, resolvePayable, rowKeyOf, type PayableSources } from '../../payments/payables.js';
import { createPublicViews } from '../../public-api/runtime.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { readLimitOf } from '../../rbac/read-limits.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import { createLimitOf, updateLimitOf } from '../../rbac/update-limits.js';

export interface PaymentPayablesDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
}

const tableBody = z.object({
  connectionId: z.string().min(1).max(64),
  /** The table's id as the schema knows it (`public.orders`). */
  tableId: z.string().min(1).max(255),
  mapping: payableMappingSchema,
});
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
const checkReply = z.object({ data: z.object({ issues: z.array(issueView), mayMark: mayMarkView, preview: z.array(previewRow) }) });

const profileView = z.object({
  id: z.string(),
  connectionId: z.string(),
  tableName: z.string(),
  enabled: z.boolean(),
  /** False when the stored mapping no longer reads: the table is not payable until it is saved again. */
  valid: z.boolean(),
  payments: z.enum(['kept', 'table']).nullable(),
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

  function viewOf(profile: Awaited<ReturnType<typeof profiles.byId>>) {
    if (profile === null) throw new NotFoundError('No such payable table.');
    return {
      id: profile.id,
      connectionId: profile.connectionId,
      tableName: profile.tableName,
      enabled: profile.enabled,
      valid: profile.mapping !== null,
      payments: profile.mapping === null ? null : profile.mapping.payments.kind,
      updatedAt: profile.updatedAt,
    };
  }

  /** Refuses a mapping that may not be saved, with every reason at once. */
  async function assertMarkable(request: FastifyRequest, connectionId: string, tableId: string, mapping: ParsedPayableMapping): Promise<void> {
    const may = await mayMark(request, connectionId, tableId, mapping);
    if (!may.ok) throw new ForbiddenError('You may not make this table payable.', 'TABLE_FORBIDDEN', { reason: may.reason });
    const issues = await issuesOf(connectionId, tableId, mapping);
    if (issues.length > 0) throw new ValidationFailedError('This table cannot be made payable this way.', { issues });
  }

  return async (app) => {
    app.get('/payments/payables', { schema: { response: { 200: listReply } } }, async (request) => {
      if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) {
        throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      }
      const shapes: { connectionId: string; tableName: string; version: number }[] = [];
      // Ids only, so no connection's DSN is decrypted to list them.
      for (const connection of await meta.db.selectFrom('adminium_connections').select('id').execute()) {
        for (const record of await appTablesRepo(meta).forConnection(connection.id)) {
          const match = /^invoices\/invoice@(\d+)#document$/.exec(record.builtOn ?? '');
          if (match !== null) shapes.push({ connectionId: connection.id, tableName: record.tableName, version: Number(match[1]) });
        }
      }
      return { data: { profiles: (await profiles.list()).map(viewOf), shapes } };
    });

    app.post(
      '/payments/payables/check',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: auditExempt('checking a mapping and previewing three rows saves nothing; marking the table is what is audited') },
        schema: { body: tableBody, response: { 200: checkReply } },
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
        if (request.body.mapping !== undefined) await assertMarkable(request, current.connectionId, current.tableName, request.body.mapping);
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
        await profiles.remove(current.id);
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.payable.stopped',
          changes: { before: { id: current.id, connectionId: current.connectionId, tableId: current.tableName } },
        });
        return reply.status(204).send();
      },
    );
  };
}
