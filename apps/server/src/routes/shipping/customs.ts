// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SENDING A PARCEL ABROAD: the shop's set-up, and an order's customs form.
 *
 *  - `PUT …/shipping/international`    the countries a shop delivers to and its
 *                                      customs defaults, for who manages shipping.
 *  - `GET …/shipping/customs/signers`  who may be named on a declaration: only
 *                                      people holding the customs right.
 *  - `GET …/shipping/customs`          one order's customs form, filled in from
 *                                      the order, for who may send it abroad.
 *
 * Declared values are shown only to someone who may send this parcel abroad.
 * A carrier is never called here.
 */
import type { ShippingOrder } from '@adminium/manifest';
import { shippingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { ForbiddenError } from '../../errors.js';
import { grantKeyOf } from '../../installs/resolve.js';
import type { PayableSources } from '../../payments/payables.js';
import { appShippingPermission, PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { shippingPerson, shippingViewerOf } from '../../shipping/access.js';
import { orderCountry, readShipFrom } from '../../shipping/addresses.js';
import { cleanInternational, customsSigners, deliversTo, draftOf, internationalBody, readGoods, readInternational, signerName, codeListUrlOf } from '../../shipping/customs.js';
import { mayShipAbroad } from '../../shipping/limits.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import type { ReachedOrder } from './bookings.js';
import { customsFormQuery, customsFormReply, customsSignersReply, shippingParams, shippingStatusReply } from './schema.js';

export interface ShippingCustomsRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  sources: PayableSources;
  appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }>;
  reachOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, source: { table: string; id: string }): Promise<ReachedOrder>;
  orderTable(connectionId: string, appKey: string, ref: string): Promise<ResolvedTable>;
  /** The app's `shipping` entries, or none for an app released before real carriers. */
  shippingOrders(install: InstalledManifest): readonly ShippingOrder[] | null;
  statusOf(request: FastifyRequest, install: InstalledManifest, connectionId: string): Promise<z.infer<typeof shippingStatusReply>>;
}

export function shippingCustomsRoutes(deps: ShippingCustomsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;

  return async (app) => {
    tagRoutes(app, 'staff');
    const guard = app.rbac.require(PERMISSIONS.shippingManage);

    app.put(
      '/apps/:key/shipping/international',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: internationalBody, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const repo = shippingRepo(meta);
        const before = readInternational((await repo.settings(install.row.id))?.international ?? null);
        const body = request.body;
        if (body.countries.length > 0 && !(deps.shippingOrders(install) ?? []).some((order) => order.customs !== undefined)) {
          throw new ShippingRefusal('CUSTOMS_NOT_DECLARED', 'This app does not say where an order\'s goods are, so it cannot send parcels abroad yet.');
        }
        const signerId = body.signerId ?? before?.signerId ?? by;
        if ((await signerName(meta, install, signerId)) === null) {
          throw new ShippingRefusal('CUSTOMS_SIGNER', 'The person named on customs declarations must hold the customs right.', { reason: 'not-allowed' });
        }
        const next = cleanInternational(body, signerId, before);
        await repo.setInternational(install.row.id, next, by, app.rbac.now());
        // A rate was priced for the declaration these defaults made.
        await repo.clearQuotes(install.row.id);
        const shown = (one: typeof before) => (one === null ? null : { countries: one.countries, currency: one.currency, originCountry: one.originCountry, signer: one.signerId, products: one.products.length, exporter: { eori: one.exporter?.eori !== undefined, ioss: one.exporter?.ioss !== undefined, taxId: one.exporter?.taxId !== undefined }, filingCode: one.filingCode ?? null });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.international.saved',
          changes: { before: { app: install.row.manifestKey, international: shown(before) }, after: { app: install.row.manifestKey, international: shown(next) } },
        });
        return deps.statusOf(request, install, connectionId);
      },
    );

    app.get(
      '/apps/:key/shipping/customs/signers',
      { preHandler: guard, schema: { params: shippingParams, response: { 200: customsSignersReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install } = await deps.appOf(request, request.params.key);
        return { data: { signers: await customsSigners(meta, install) } };
      },
    );

    app.get(
      '/apps/:key/shipping/customs',
      { config: { audit: auditExempt('reads one order\'s customs form: nothing is declared, bought or changed') }, schema: { params: shippingParams, querystring: customsFormQuery, response: { 200: customsFormReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayCustoms) throw new ForbiddenError('You may not declare customs for this app.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'customs') });
        const repo = shippingRepo(meta);
        if (!mayShipAbroad(viewer, await repo.limits(install.row.id))) throw new ShippingRefusal('OWNER_BOOKS', 'The owner books parcels going abroad.', { reason: 'abroad' });

        const order = await deps.reachOrder(request, install, connectionId, { table: request.query.table, id: request.query.id });
        const mapping = order.mapping as ShippingOrder;
        const settingsRow = await repo.settings(install.row.id);
        const from = readShipFrom(settingsRow?.shipFrom ?? null)?.country ?? null;
        const to = orderCountry(order.row, mapping.address);
        // Not knowing either country is not the same as knowing no form is needed.
        if (from === null) throw new ShippingRefusal('SHIP_FROM_INCOMPLETE', 'The Ship from address is not complete.', { fields: ['country'] });
        if (to === null) throw new ShippingRefusal('COUNTRY_NOT_RECORDED', 'This order has no two-letter country code.', { field: 'country' });
        if (to === from) return { data: { abroad: false as const } };
        const international = readInternational(settingsRow?.international ?? null);
        if (mapping.customs === undefined || international === null || !deliversTo(mapping.customs, international).includes(to)) {
          return { data: { abroad: true as const, offered: false as const, to } };
        }
        const goods = await readGoods({
          sources: deps.sources,
          tableOf: (ref) => deps.orderTable(connectionId, install.row.manifestKey, ref),
          connectionId,
          columns: mapping.customs,
          order: order.row,
          orderTable: order.table as unknown as Pick<ResolvedTable, 'primaryKey'>,
        });
        const draft = draftOf(goods, international, mapping.customs.currency === undefined ? undefined : order.row[mapping.customs.currency], { country: to });
        const signer = await signerName(meta, install, international.signerId);
        return { data: { abroad: true as const, offered: true as const, ownCountry: from, to, codeListUrl: codeListUrlOf(from), signer, ...draft } };
      },
    );
  };
}
