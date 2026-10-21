// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Staff: the pay address, and a payable's pay link.
 *
 * The pay address is chosen in Studio from this server's public address and
 * its customer domains (one is preferred: the admin host need not face the
 * public). A change of it moves where every link points and where the
 * providers must send webhooks, so it is audited under its own action.
 *
 * A link is made from the record's Payment panel, by someone who may change
 * the record (the same gate as its state actions) and who can see that row
 * under their own row limits. One current link per payable: making one
 * retires the last, and the answer says so. It is made in live mode once live
 * payments are on, and in test mode before that (a test link opens only for
 * someone who may manage payments). No link is made while customers cannot
 * reach the pay address.
 */
import { paymentLinksRepo, paymentSettingsRepo, settingsRepo, PAYABLE_KINDS, type MetaDb, type PayableRef } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { PAY_ADDRESS_DOC, linkSealFromSecret, mintLink, payAddress, payAddressSchema, payReachable, payUrl } from '../../payments/links.js';
import { pkOfRowKey, type PayableSources } from '../../payments/payables.js';
import { createPublicViews } from '../../public-api/runtime.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import { normalizePublicOrigin } from '../../security/public-origin.js';
import type { DomainMapping } from '../../surfaces/settings.js';

export interface PaymentLinksDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  sources: PayableSources;
  secret: string;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** Whether live payments are on for any service (links are then made in live mode). */
  liveOn: () => Promise<boolean>;
}

const payableBody = z.object({
  kind: z.enum(PAYABLE_KINDS),
  connectionId: z.string().min(1).max(64).nullable(),
  tableName: z.string().min(1).max(255).nullable(),
  rowKey: z.string().min(1).max(512),
});
const idParams = z.object({ id: z.string().min(1).max(64) });
const addressBody = z.object({ origin: z.string().min(1).max(255) });

const linkView = z.object({ id: z.string(), url: z.string(), mode: z.enum(['test', 'live']), expiresAt: z.number(), createdAt: z.number() });
const mintReply = z.object({ data: z.object({ link: linkView, replaced: z.boolean() }) });
const currentReply = z.object({ data: linkView.nullable() });
const addressReply = z.object({ data: z.object({ origin: z.string().nullable(), choices: z.array(z.string()) }) });

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Pay links are made by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function paymentLinksRoutes(deps: PaymentLinksDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const seal = linkSealFromSecret(deps.secret);
  const views = createPublicViews(meta);
  const links = paymentLinksRepo(meta);

  async function choices(): Promise<string[]> {
    const out: string[] = [];
    const publicOrigin = await settingsRepo(meta).get('system.publicOrigin');
    if (typeof publicOrigin === 'string' && normalizePublicOrigin(publicOrigin) !== null) out.push(normalizePublicOrigin(publicOrigin)!);
    const domains = ((await settingsRepo(meta).get('surfaces.domains')) ?? {}) as Record<string, DomainMapping>;
    for (const [host, mapping] of Object.entries(domains)) {
      if (mapping.side !== 'customer') continue;
      const origin = normalizePublicOrigin(`https://${host}`);
      if (origin !== null && !out.includes(origin)) out.push(origin);
    }
    return out;
  }

  /** The row a payable names, as this person may change and see it; refuses otherwise. */
  async function assertMayLink(request: FastifyRequest, payable: PayableRef): Promise<void> {
    if (payable.kind === 'document') {
      // An invoice made on the Invoices page: whoever may change the workspace's documents.
      if (!(await request.can(PERMISSIONS.settingsManage))) throw new ForbiddenError('You may not make a pay link for this invoice.');
      return;
    }
    const { connectionId, tableName } = payable;
    if (connectionId === null || tableName === null) throw new ValidationFailedError('A table payable names its connection and table.');
    if (!(await request.can(`table:${connectionId}:${tableName}:update`))) throw new ForbiddenError('You may not make a pay link for this record.', 'TABLE_FORBIDDEN');
    const found = await deps.sources.table(connectionId, tableName);
    if (found === null) throw new NotFoundError('That table is not there any more.');
    const pk = pkOfRowKey(found.table, payable.rowKey);
    if (pk === null) throw new NotFoundError('No such record.');
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    const view = await views.viewFor(connectionId);
    const context = set === undefined || view === null ? null : await rowLimitContextOf(meta, set, connectionId, view.model);
    const row = context === null
      ? await found.target.db.selectFrom(found.table.id).selectAll().where((eb) => eb.and(Object.entries(pk).map(([column, value]) => eb(found.target.db.dynamic.ref(column), '=', value)))).executeTakeFirst()
      : await fetchVisible(context, found.target.db, found.table, pk, 'read');
    // A row this person cannot see answers as one that is not there.
    if (row === undefined) throw new NotFoundError('No such record.');
  }

  function viewOf(link: { id: string; tokenSealed: string; mode: 'test' | 'live'; expiresAt: number; createdAt: number }, address: string) {
    return { id: link.id, url: payUrl(address, seal.unseal(link.tokenSealed)), mode: link.mode, expiresAt: link.expiresAt, createdAt: link.createdAt };
  }

  async function reachableAddress(): Promise<string> {
    const answer = await payReachable(meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: false });
    const address = await payAddress(meta);
    if (answer.state !== 'reachable' || address === null) {
      throw new ValidationFailedError('Customers cannot reach the pay address, so no pay link can be made.', { reason: answer.state });
    }
    return address;
  }

  return async (app) => {
    app.get('/payments/pay-address', { schema: { response: { 200: addressReply } } }, async (request) => {
      if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      return { data: { origin: await payAddress(meta), choices: await choices() } };
    });

    app.put(
      '/payments/pay-address',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { body: addressBody, response: { 200: addressReply } } },
      async (request) => {
        requirePerson(request);
        const origin = normalizePublicOrigin(request.body.origin);
        const allowed = await choices();
        if (origin === null || !allowed.includes(origin)) {
          throw new ValidationFailedError("The pay address is this server's public address or one of its customer domains.", { choices: allowed });
        }
        const before = await payAddress(meta);
        await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin }, app.rbac.now());
        // Where every link points, and where the providers must now send webhooks.
        await app.rbac.audit(request, { category: 'payments', action: 'payments.pay-address.changed', changes: { before: { origin: before }, after: { origin } } });
        return { data: { origin, choices: allowed } };
      },
    );

    app.post(
      '/payments/links',
      { config: { audit: audited('rbac') }, schema: { body: payableBody, response: { 200: mintReply } } },
      async (request) => {
        const userId = requirePerson(request);
        const payable = request.body;
        await assertMayLink(request, payable);
        const address = await reachableAddress();
        const minted = await mintLink(meta, seal, { payable, mode: (await deps.liveOn()) ? 'live' : 'test', createdBy: userId }, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.link.minted',
          changes: { after: { linkId: minted.link.id, kind: payable.kind, connectionId: payable.connectionId, tableName: payable.tableName, rowKey: payable.rowKey, mode: minted.link.mode, replaced: minted.replaced } },
        });
        return { data: { link: viewOf(minted.link, address), replaced: minted.replaced } };
      },
    );

    app.post(
      '/payments/links/current',
      { config: { audit: auditExempt('reading the current link of a record changes nothing') }, schema: { body: payableBody, response: { 200: currentReply } } },
      async (request) => {
        requirePerson(request);
        await assertMayLink(request, request.body);
        const link = await links.currentFor(request.body);
        const address = await payAddress(meta);
        if (link === null || address === null || link.revokedAt !== null || link.expiresAt <= app.rbac.now()) return { data: null };
        return { data: viewOf(link, address) };
      },
    );

    app.post(
      '/payments/links/:id/revoke',
      { config: { audit: audited('rbac') }, schema: { params: idParams } },
      async (request, reply) => {
        requirePerson(request);
        const link = await links.byId(request.params.id);
        if (link === null) throw new NotFoundError('No such pay link.');
        await assertMayLink(request, link.payable);
        await links.revoke(link.id, app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: 'payments.link.revoked', changes: { before: { linkId: link.id, rowKey: link.payable.rowKey } } });
        return reply.status(204).send();
      },
    );
  };
}
