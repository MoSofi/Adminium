// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's shipping: its carrier, its Ship from address and asking for rates.
 *
 * ─── WHO MAY CALL ──────────────────────────────────────────────────────────
 *
 * Every route needs `shipping.manage` and a signed-in person. An API key is
 * refused: a carrier account spends real money.
 *
 * ─── WHAT A QUOTE TRUSTS ───────────────────────────────────────────────────
 *
 * Nothing the client says about where a parcel goes. It names an order; the
 * server checks the app declared that table, that the person may read it and
 * reaches that row, and reads the address from the declared columns. An app
 * released before real carriers declares none, so it cannot reach one.
 *
 * Every refusal that needs no carrier is made before a carrier is built, so a
 * parcel abroad, an incomplete address or a locked carrier never reads a key.
 */
import type { Parcel, ShipmentPurpose } from '@adminium/add-on-contracts';
import { validateManifest, type ShippingOrder } from '@adminium/manifest';
import { appTablesRepo, realTableOf, shippingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb, type ShippingSlot } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { auditExempt, audited } from '../../audit/coverage.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { parseRecordId, pkLabel } from '../../crud/records.js';
import { venueDayOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { installReachOf } from '../../installs/reach.js';
import { installOnConnection, requireInstall, selectorOf, splitInstallKey } from '../../installs/resolve.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { cleanShipFrom, orderAddress, readShipFrom, recipientForRates, shipFromAddress, shipFromChanges } from '../../shipping/addresses.js';
import { askForRates, carrierHttpFor, shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import { carrierLocked } from '../../shipping/locks.js';
import { storeQuote } from '../../shipping/quotes.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import { attachedCarriers, shopShipping, type ShopShipping } from '../../shipping/shop.js';
import { ORDINARY_POLICY, type TrialPolicy } from '../../trial/policy.js';
import { factsViewFor } from '../pages/column-facts.js';
import { activeCarrierBody, quoteBody, quoteReply, shipFromBodySchema, shippingParams, shippingStatusReply } from './schema.js';

export interface ShippingRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  /** `ADMINIUM_SECRET`: the key of a quote's hash and of its sealed carrier handles. */
  secret: string;
  runtime: () => AddOnRuntimeState | null;
  /** `ADMINIUM_NETWORK_FEATURES`, asked per call. */
  networkFeatures: () => boolean;
  policy?: Pick<TrialPolicy, 'allows'> & Partial<Pick<TrialPolicy, 'strictNetwork'>>;
  /** The row, as this person reaches it (`crud/row-reached.ts`). */
  readRow(request: FastifyRequest, connectionId: string, tableId: string, row: string): Promise<Row | undefined>;
}

/** The record states in which an app still holds a table. */
const HELD = new Set(['created', 'adopted', 'shared']);

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Shipping is set up by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

/** The app's `shipping` entries, or none: a released app has no block, and its manifest is read as it was stored. */
function shippingOrders(install: InstalledManifest): readonly ShippingOrder[] | null {
  const read = validateManifest(install.document);
  if (!read.ok || read.manifest.kind !== 'app') return null;
  return read.manifest.shipping?.orders ?? null;
}

export function shippingRoutes(deps: ShippingRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests, secret } = deps;
  const policy = deps.policy ?? ORDINARY_POLICY;

  const connectionNames = async () => new Map((await meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute()).map((row) => [row.id, row.name]));

  /** The install a `/apps/:key/…` address means, and its database. */
  async function appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }> {
    const { key } = splitInstallKey(param);
    const app = await requireInstall(manifests, key, selectorOf(request, param), { kind: 'app', connectionNames, reaches: installReachOf(meta, request) });
    if (app.row.connectionId === null) throw new NotFoundError(`${key} is not installed on a database.`);
    return { app, connectionId: app.row.connectionId };
  }

  const carrierDeps = (request: FastifyRequest): ShippingCarrierDeps => ({
    runtime: deps.runtime,
    manifests,
    httpFor: (manifest) => carrierHttpFor(meta, manifest, policy),
    // Names and codes only: never a key, an address or anything a carrier sent.
    log: (message, fields) => request.log.warn(fields, message),
  });

  function view(install: InstalledManifest, shop: ShopShipping) {
    return { data: { appUpdated: shippingOrders(install) !== null, ...shop, international: false as const } };
  }

  /** The order's table, as this database has it, or a refusal when the app does not declare it. */
  async function orderTable(connectionId: string, appKey: string, ref: string): Promise<ResolvedTable> {
    const record = await appTablesRepo(meta).find(connectionId, appKey, ref);
    const facts = await factsViewFor(meta, connectionId);
    if (record === null || facts === null || !HELD.has(record.state)) throw new ShippingRefusal('NOT_A_SHIPPING_TABLE', 'This app keeps no orders in that table.', { table: ref });
    try {
      return facts.table(realTableOf(record));
    } catch {
      throw new ShippingRefusal('NOT_A_SHIPPING_TABLE', 'This app keeps no orders in that table.', { table: ref });
    }
  }

  return async (app) => {
    // For the instance's own people, not the public (`security/route-audience.ts`).
    tagRoutes(app, 'staff');
    const guard = app.rbac.require(PERMISSIONS.shippingManage);

    app.get('/apps/:key/shipping', { preHandler: guard, schema: { params: shippingParams, response: { 200: shippingStatusReply } } }, async (request) => {
      requirePerson(request);
      const { app: install, connectionId } = await appOf(request, request.params.key);
      return view(install, await shopShipping(meta, manifests, install, connectionId));
    });

    app.put(
      '/apps/:key/shipping/active-carrier',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: activeCarrierBody, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = requirePerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const { carrier } = request.body;
        const attached = (await attachedCarriers(manifests, install, connectionId)).find((one) => one.key === carrier);
        if (attached === undefined) throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not attached to this app.`, { carrier });
        if (!attached.on) throw new ShippingRefusal('CARRIER_SWITCHED_OFF', `The carrier "${carrier}" is switched off.`, { carrier });
        // A locked carrier runs its demo in the browser, which takes no key.
        if (!carrierLocked(carrier) && !attached.connected) throw new ShippingRefusal('CARRIER_NO_CREDENTIAL', `The carrier "${carrier}" has no key saved.`, { carrier });

        const repo = shippingRepo(meta);
        const before = (await repo.settings(install.row.id))?.activeCarrier ?? null;
        await repo.setActiveCarrier(install.row.id, carrier, by, app.rbac.now());
        // A rate from the carrier the shop just left is not one it still means to buy.
        if (before !== carrier) await repo.clearQuotes(install.row.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.active-carrier.set',
          changes: { before: { app: install.row.manifestKey, carrier: before }, after: { app: install.row.manifestKey, carrier } },
        });
        return view(install, await shopShipping(meta, manifests, install, connectionId));
      },
    );

    app.put(
      '/apps/:key/shipping/ship-from',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: shipFromBodySchema, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = requirePerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const repo = shippingRepo(meta);
        const before = readShipFrom((await repo.settings(install.row.id))?.shipFrom ?? null);
        const next = cleanShipFrom(request.body);
        const fields = shipFromChanges(before, next);
        await repo.setShipFrom(install.row.id, next, by, app.rbac.now());
        // A rate was priced from the old address.
        if (fields.length > 0) await repo.clearQuotes(install.row.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.ship-from.saved',
          // The fields' names, never their values: this is a business's address and phone.
          changes: { after: { app: install.row.manifestKey, fields } },
        });
        return view(install, await shopShipping(meta, manifests, install, connectionId));
      },
    );

    app.post(
      '/apps/:key/shipping/quotes',
      {
        preHandler: guard,
        config: { audit: auditExempt('asks a carrier for prices: nothing is bought or changed, and the stored quote holds no personal data') },
        schema: { params: shippingParams, body: quoteBody, response: { 200: quoteReply } },
      },
      async (request) => {
        const by = requirePerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const { source, parcelNumber: number } = request.body;
        const parcel = request.body.parcel as Parcel;
        const purpose: ShipmentPurpose = request.body.purpose ?? 'outbound';
        const parcelNumber = number ?? 1;

        // An app released before real carriers sends a sample address, so it cannot reach one, whatever the client sends.
        const orders = shippingOrders(install);
        if (orders === null) throw new ShippingRefusal('APP_NOT_UPDATED', 'This app has not been updated for real carriers yet.', { app: install.row.manifestKey });
        const mapping = orders.find((order) => order.table === source.table);
        if (mapping === undefined) throw new ShippingRefusal('NOT_A_SHIPPING_TABLE', 'This app keeps no orders in that table.', { table: source.table });
        const table = await orderTable(connectionId, install.row.manifestKey, mapping.table);

        if (!(await request.can(`table:${connectionId}:${table.id}:read`))) throw new ForbiddenError('You may not read this table.', 'TABLE_FORBIDDEN', { table: source.table });
        // A row they do not reach is a row that is not there.
        const row = await deps.readRow(request, connectionId, table.id, source.id);
        if (row === undefined) throw new NotFoundError('That order was not found.');
        const rowKey = pkLabel(table, parseRecordId(table, source.id));

        const shop = await shopShipping(meta, manifests, install, connectionId);
        const carrierKey = shop.activeCarrier;
        if (carrierKey === null) throw new ShippingRefusal('NO_ACTIVE_CARRIER', 'Choose which carrier this shop uses.', { carriers: shop.carriers.map((one) => one.key) });
        // Said before the address, which a demo carrier would never use anyway.
        if (carrierLocked(carrierKey)) throw new ShippingRefusal('CARRIER_LOCKED', `"${carrierKey}" runs as a demo for now, so no real carrier is called.`, { carrier: carrierKey });
        // Off for this app, though the add-on itself may be on: the resolver below only knows the second. A carrier not on this database is its refusal to make.
        const chosen = shop.carriers.find((one) => one.key === carrierKey);
        if (chosen?.on === false && (await installOnConnection(manifests, carrierKey, connectionId)) !== null) {
          throw new ShippingRefusal('CARRIER_SWITCHED_OFF', `The carrier "${carrierKey}" is switched off.`, { carrier: carrierKey });
        }

        const from = shipFromAddress(shop.shipFrom);
        const to = orderAddress(row, mapping.address, from);

        if (!deps.networkFeatures()) throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'Network features are off on this server, so no carrier can be asked.', { carrier: carrierKey, reason: 'network-off' });
        const carrierSeam = carrierDeps(request);
        const resolved = await shippingCarrierFor(carrierSeam, carrierKey, connectionId, await venueDayOf(meta, connectionId));
        const rates = await askForRates(resolved, parcel, from, recipientForRates(to), { purpose }, carrierSeam.log);

        const slot: ShippingSlot = { installId: install.row.id, connectionId, tableRef: mapping.table, rowKey, purpose, parcelNumber };
        const stored = await storeQuote(meta, secret, { slot, carrierKey, details: { parcel, from, to, purpose, parcelNumber }, rates, createdBy: by, now: app.rbac.now() });
        return { data: stored };
      },
    );
  };
}
