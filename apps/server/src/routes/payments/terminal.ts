// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CARD READERS (E6): the till's charge, and Studio's pairing.
 *
 * The till (a person's own session, never an API key):
 *   POST /payments/terminal/charge            put a record's amount on a reader
 *   GET  /payments/terminal/charges/:id       where the charge stands (the till polls it)
 *   POST /payments/terminal/charges/:id/cancel take the amount off the reader
 *   GET  /payments/terminal/readers           the paired readers, to pick one
 * A charge needs what a payment recorded by hand at the till needs: reading the
 * record, and creating a row in its payments table — so a cashier's app role is
 * enough, and the payments right is not asked.
 *
 * Studio → Payments → Card readers (payments.manage):
 *   GET    /payments/readers                  the paired readers, and the services that offer readers
 *   POST   /payments/readers/pairing          start pairing (the reader shows a code, or the person types one on it)
 *   POST   /payments/readers/pairing/finish   finish: the reader is kept, named
 *   PATCH  /payments/readers/:id              rename
 *   DELETE /payments/readers/:id              unpair at the service, and forget it
 */
import { DEMO_TERMINAL_KEY, isProviderError } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentReadersRepo, type MetaDb, type PaymentReader } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { pkOfRowKey, rowKeyOf, type PayableSources } from '../../payments/payables.js';
import { cancelReaderCharge, chargeView, startReaderCharge, type ReaderChargeDeps } from '../../payments/reader-charges.js';
import type { TerminalLookup } from '../../payments/terminals.js';
import { createPublicViews } from '../../public-api/runtime.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import { tagRoutes } from '../../security/route-audience.js';

export interface TerminalRoutesDeps {
  meta: MetaDb;
  sources: PayableSources;
  terminalFor: (key: string, mode: 'test' | 'live') => Promise<TerminalLookup>;
  enqueue: ReaderChargeDeps['enqueue'];
  /** The card reader services this server offers: the installed add-ons providing the contract, and the demo reader. */
  services: () => Promise<{ key: string; name: string }[]>;
  /** Off: no reader is reached (network features off). */
  networkFeatures: boolean;
}

const chargeBody = z
  .object({
    connectionId: z.string().min(1).max(64),
    table: z.string().min(1).max(255),
    recordId: z.string().min(1).max(512),
    readerId: z.string().min(1).max(64),
    /** Less than what is due, for a part payment; left out, what is due. Never more. */
    amount: z.string().trim().min(1).max(32).nullable().optional(),
    tipping: z.boolean().optional(),
  })
  .strict();
const chargeView_ = z.object({
  attemptId: z.string(),
  state: z.enum(['sending', 'on_reader', 'paid', 'declined', 'cancelled', 'failed']),
  amount: z.string(),
  currency: z.string(),
  tip: z.string().nullable(),
  last4: z.string().nullable(),
  message: z.string().nullable(),
});
const chargeReply = z.object({ data: chargeView_ });
const idParams = z.object({ id: z.string().min(1).max(64) });
const readerView = z.object({
  id: z.string(),
  provider: z.string(),
  mode: z.enum(['test', 'live']),
  label: z.string(),
  locationName: z.string().nullable(),
  model: z.string().nullable(),
  online: z.boolean(),
  lastSeenAt: z.number().nullable(),
});
const readersReply = z.object({ data: z.array(readerView) });
const studioReply = z.object({ data: z.object({ readers: z.array(readerView), services: z.array(z.object({ key: z.string(), name: z.string() })) }) });
const pairStart = z.object({ provider: z.string().min(1).max(80), mode: z.enum(['test', 'live']), label: z.string().trim().min(1).max(120), locationId: z.string().max(255).nullable().optional() }).strict();
const pairStartReply = z.object({ data: z.object({ way: z.enum(['enter', 'show']), code: z.string().nullable(), pairing: z.string(), expiresAt: z.number() }) });
const pairFinish = pairStart.extend({ pairing: z.string().min(1).max(512), code: z.string().trim().max(64).nullable() }).strict();
const pairFinishReply = z.object({ data: z.object({ state: z.enum(['paired', 'waiting']), reader: readerView.nullable() }) });
const renameBody = z.object({ label: z.string().trim().min(1).max(120) }).strict();

function viewOf(reader: PaymentReader): z.infer<typeof readerView> {
  return { id: reader.id, provider: reader.provider, mode: reader.mode, label: reader.label, locationName: reader.locationName, model: reader.model, online: reader.online, lastSeenAt: reader.lastSeenAt };
}

function personOf(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A card reader is used by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const user = (request as unknown as { user?: { id?: string } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return user.id;
}

export function paymentTerminalRoutes(deps: TerminalRoutesDeps): FastifyPluginAsyncZod {
  const { meta, sources } = deps;
  const views = createPublicViews(meta);
  const chargeDeps: ReaderChargeDeps = { meta, sources, terminalFor: deps.terminalFor, enqueue: deps.enqueue };

  /** The record as this person reaches it, and the payments table they must be able to add a payment to. */
  async function reach(request: FastifyRequest, input: z.infer<typeof chargeBody>): Promise<{ tableId: string; rowKey: string }> {
    const found = await sources.table(input.connectionId, input.table);
    if (found === null) throw new NotFoundError('No such table.');
    const table = found.table;
    if (!(await request.can(`table:${input.connectionId}:${table.id}:read`))) throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    const profile = await sources.profile(input.connectionId, table.id);
    const payments = profile?.mapping?.payments;
    if (payments?.kind !== 'table') throw new NotFoundError('This record takes no card payments at the counter.');
    if (!(await request.can(`table:${input.connectionId}:${payments.table}:create`))) throw new ForbiddenError('You may not take a payment on this record.', 'TABLE_FORBIDDEN');
    const pk = table.primaryKey.length === 1 ? pkOfRowKey(table, input.recordId) : null;
    if (pk === null) throw new NotFoundError('No such record.');
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    const view = await views.viewFor(input.connectionId);
    if (set === undefined || view === null || !view.model.tables.some((one) => one.id === table.id)) throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    const context = await rowLimitContextOf(meta, set, input.connectionId, view.model);
    const row =
      context === null
        ? await found.target.db.selectFrom(table.id).selectAll().where((eb) => eb.and(Object.entries(pk).map(([column, value]) => eb(found.target.db.dynamic.ref(column), '=', value)))).executeTakeFirst()
        : await fetchVisible(context, found.target.db, table, pk, 'read');
    if (row === undefined) throw new NotFoundError('No such record.');
    return { tableId: table.id, rowKey: rowKeyOf(table, row as Record<string, unknown>) };
  }

  /** A charge the person may follow: theirs, or one on a record they may read. */
  async function chargeFor(request: FastifyRequest, id: string) {
    const attempt = await paymentAttemptsRepo(meta).byId(id);
    if (attempt === null || attempt.reader === null) throw new NotFoundError('No such charge.');
    const { connectionId, tableName } = attempt.payable;
    const mine = attempt.createdBy === (request as unknown as { user?: { id?: string } }).user?.id;
    if (!mine && (connectionId === null || tableName === null || !(await request.can(`table:${connectionId}:${tableName}:read`)))) throw new NotFoundError('No such charge.');
    return attempt;
  }

  return async (app) => {
    tagRoutes(app, 'staff');

    app.post(
      '/payments/terminal/charge',
      { config: { audit: audited('rbac') }, schema: { body: chargeBody, response: { 200: chargeReply } } },
      async (request) => {
        const by = personOf(request);
        if (!deps.networkFeatures) throw new ConflictError('This server works without the internet, so it cannot reach a card reader.', 'CONFLICT', { reason: 'network-off' });
        const body = request.body;
        const { tableId, rowKey } = await reach(request, body);
        const kind = (await sources.shapeOf(body.connectionId, tableId)) !== null ? 'shape' : 'profile';
        const started = await startReaderCharge(chargeDeps, { ref: { kind, connectionId: body.connectionId, tableName: tableId, rowKey }, readerId: body.readerId, amount: body.amount ?? null, tipping: body.tipping === true, by });
        if (!started.ok) {
          if (started.reason === 'reader-busy') throw new ConflictError(started.message, 'CONFLICT', { reason: started.reason });
          throw new ValidationFailedError(started.message, { reason: started.reason });
        }
        await app.rbac.audit(request, { category: 'payments', action: 'payments.terminal.charge', changes: { after: { attemptId: started.attempt.id, readerId: body.readerId, amount: started.attempt.amount, currency: started.attempt.currency } } });
        return { data: chargeView(started.attempt) };
      },
    );

    app.get(
      '/payments/terminal/charges/:id',
      { config: { audit: auditExempt('reading where a charge stands changes nothing') }, schema: { params: idParams, response: { 200: chargeReply } } },
      async (request) => {
        personOf(request);
        return { data: chargeView(await chargeFor(request, request.params.id)) };
      },
    );

    app.post(
      '/payments/terminal/charges/:id/cancel',
      { config: { audit: audited('rbac') }, schema: { params: idParams, response: { 200: chargeReply } } },
      async (request) => {
        personOf(request);
        await chargeFor(request, request.params.id);
        const after = await cancelReaderCharge(chargeDeps, request.params.id);
        if (after === null) throw new NotFoundError('No such charge.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.terminal.cancel', changes: { after: { attemptId: after.id, state: after.state } } });
        return { data: chargeView(after) };
      },
    );

    app.get(
      '/payments/terminal/readers',
      { config: { audit: auditExempt('reading the paired readers changes nothing') }, schema: { response: { 200: readersReply } } },
      async (request) => {
        personOf(request);
        return { data: (await paymentReadersRepo(meta).list()).map(viewOf) };
      },
    );

    // ── Studio ──────────────────────────────────────────────────────────────

    app.get(
      '/payments/readers',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: auditExempt('reading the paired readers changes nothing') }, schema: { response: { 200: studioReply } } },
      async () => ({ data: { readers: (await paymentReadersRepo(meta).list()).map(viewOf), services: await deps.services() } }),
    );

    app.post(
      '/payments/readers/pairing',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { body: pairStart, response: { 200: pairStartReply } } },
      async (request) => {
        personOf(request);
        const lookup = await deps.terminalFor(request.body.provider, request.body.mode);
        if (!lookup.ok) throw new ValidationFailedError(lookup.message, { reason: lookup.code });
        const started = await lookup.terminal.startPairing({ label: request.body.label, locationId: request.body.locationId ?? null });
        if (isProviderError(started)) throw new ValidationFailedError(started.providerMessage, { reason: started.code });
        return { data: { way: started.way, code: started.code, pairing: started.pairing, expiresAt: started.expiresAt } };
      },
    );

    app.post(
      '/payments/readers/pairing/finish',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { body: pairFinish, response: { 200: pairFinishReply } } },
      async (request) => {
        const by = personOf(request);
        const body = request.body;
        const lookup = await deps.terminalFor(body.provider, body.mode);
        if (!lookup.ok) throw new ValidationFailedError(lookup.message, { reason: lookup.code });
        const finished = await lookup.terminal.finishPairing({ pairing: body.pairing, code: body.code });
        if (isProviderError(finished)) throw new ValidationFailedError(finished.providerMessage, { reason: finished.code });
        if (finished.state === 'waiting') return { data: { state: 'waiting' as const, reader: null } };
        const locations = await lookup.terminal.listLocations();
        const locationName = isProviderError(locations) ? null : (locations.locations.find((one) => one.id === finished.reader.locationId)?.name ?? null);
        const kept = await paymentReadersRepo(meta).pair({
          provider: body.provider,
          mode: body.mode,
          readerRef: finished.reader.id,
          label: body.label,
          locationId: finished.reader.locationId,
          locationName,
          model: finished.reader.model,
          online: finished.reader.online,
          lastSeenAt: finished.reader.lastSeenAt,
          createdBy: by,
        });
        await app.rbac.audit(request, { category: 'payments', action: 'payments.reader.paired', changes: { after: { readerId: kept.id, provider: kept.provider, mode: kept.mode, label: kept.label } } });
        return { data: { state: 'paired' as const, reader: viewOf(kept) } };
      },
    );

    app.patch(
      '/payments/readers/:id',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { params: idParams, body: renameBody, response: { 200: z.object({ data: readerView }) } } },
      async (request) => {
        personOf(request);
        if (!(await paymentReadersRepo(meta).rename(request.params.id, request.body.label))) throw new NotFoundError('No such reader.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.reader.renamed', changes: { after: { readerId: request.params.id, label: request.body.label } } });
        return { data: viewOf((await paymentReadersRepo(meta).byId(request.params.id))!) };
      },
    );

    app.delete(
      '/payments/readers/:id',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { params: idParams } },
      async (request, reply) => {
        personOf(request);
        const reader = await paymentReadersRepo(meta).byId(request.params.id);
        if (reader === null) throw new NotFoundError('No such reader.');
        // Unpaired at its service too, when it can be told; forgotten here either way.
        const lookup = await deps.terminalFor(reader.provider, reader.mode);
        if (lookup.ok) await lookup.terminal.unpairReader(reader.readerRef);
        await paymentReadersRepo(meta).remove(reader.id);
        await app.rbac.audit(request, { category: 'payments', action: 'payments.reader.unpaired', changes: { before: { readerId: reader.id, label: reader.label } } });
        return reply.status(204).send();
      },
    );
  };
}

/** The demo reader is offered where the demo payment service is. */
export const DEMO_READER_SERVICE = { key: DEMO_TERMINAL_KEY, name: 'Demo card reader' } as const;
