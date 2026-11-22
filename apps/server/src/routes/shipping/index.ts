// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's shipping: its carrier, its Ship from address and asking for rates.
 *
 * ─── WHO MAY CALL ──────────────────────────────────────────────────────────
 *
 * Setting shipping up needs `shipping.manage` and a signed-in person. Getting
 * rates needs that, or the app install's own `shipping:<install>:book`. An API
 * key is refused everywhere: a carrier account spends real money.
 *
 * ─── WHO SEES WHAT ─────────────────────────────────────────────────────────
 *
 * Someone who cannot see the order's money gets services with no price, no
 * currency, no price order and none of the carrier's own words. Someone who
 * does not manage shipping books inside the owner's limits, and with no limit
 * set is told the owner books, before a carrier is asked (a quote can cost).
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
import { venueDayOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { installReachOf } from '../../installs/reach.js';
import { grantKeyOf, installOnConnection, requireInstall, selectorOf, splitInstallKey } from '../../installs/resolve.js';
import { rowKeyOf, type PayableSources } from '../../payments/payables.js';
import { appShippingPermission, PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { pricesHiddenFrom, readsPartOf, shippingPerson, shippingViewerOf, type ShippingViewer } from '../../shipping/access.js';
import { cleanShipFrom, orderAddress, readShipFrom, recipientForRates, shipFromAddress, shipFromChanges } from '../../shipping/addresses.js';
import { askForRates, carrierHttpFor, shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import type { BookingFaults } from '../../shipping/bookings.js';
import { checkedAccount, type OpenBooking } from '../../shipping/keys.js';
import { bookingState, createQuoteGate, mayShipAbroad, rateWithinLimit } from '../../shipping/limits.js';
import { carrierLocked } from '../../shipping/locks.js';
import { storeQuote } from '../../shipping/quotes.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import { attachedCarriers, carrierAccounts, shopShipping } from '../../shipping/shop.js';
import { ORDINARY_POLICY, type TrialPolicy } from '../../trial/policy.js';
import { factsViewFor } from '../pages/column-facts.js';
import { shippingBookingRoutes, type ReachedOrder, type ShippableOrder } from './bookings.js';
import { shippingKeyRoutes } from './keys.js';
import { activeCarrierBody, quoteBody, quoteReply, shipFromBodySchema, shippingAccessReply, shippingParams, shippingStatusReply } from './schema.js';

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
  /** Where a table's money columns are named, to judge who may see a price. */
  sources: PayableSources;
  /** The bookings on a carrier install with no final answer yet. Required, so no caller can leave the check out. */
  openBookings: (carrierInstallId: string) => Promise<readonly OpenBooking[]>;
  /** How many quotes one person may ask for in a minute. */
  quotesPerMinute?: number;
  /** Queues the repeatable steps after a bought label. */
  enqueueApply: (bookingId: string) => Promise<unknown>;
  /** Test seams: a crash at a named step, and a shorter wait for a carrier's answer. */
  bookingFaults?: BookingFaults;
  bookAnswerMs?: number;
}

/** The record states in which an app still holds a table. */
const HELD = new Set(['created', 'adopted', 'shared']);

/** The app's `shipping` entries, or none: a released app has no block, and its manifest is read as it was stored. */
function shippingOrders(install: InstalledManifest): readonly ShippingOrder[] | null {
  const read = validateManifest(install.document);
  if (!read.ok || read.manifest.kind !== 'app') return null;
  return read.manifest.shipping?.orders ?? null;
}

export function shippingRoutes(deps: ShippingRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests, secret } = deps;
  const policy = deps.policy ?? ORDINARY_POLICY;
  const quoteGate = createQuoteGate(deps.quotesPerMinute);

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

  async function view(install: InstalledManifest, connectionId: string) {
    const shop = await shopShipping(meta, manifests, install, connectionId);
    const accounts = await carrierAccounts(meta, manifests, shop.carriers, connectionId);
    const repo = shippingRepo(meta);
    const limits = await repo.limits(install.row.id);
    const usedToday = await repo.dayLabels(install.row.id, await venueDayOf(meta, connectionId));
    return {
      data: {
        appUpdated: shippingOrders(install) !== null,
        ...shop,
        carriers: shop.carriers.map((carrier) => ({ ...carrier, account: accounts[carrier.key] ?? null })),
        international: false as const,
        limits: {
          perLabel: limits?.labelLimit != null && limits.labelCurrency !== null ? { amount: limits.labelLimit, currency: limits.labelCurrency } : null,
          dailyLabels: limits?.dailyLabels ?? null,
          packersAbroad: limits?.packersAbroad ?? false,
          usedToday,
        },
      },
    };
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

  /** Whether any of the app's order tables hides its money from this person. With none to judge by, it does. */
  async function hiddenOnAnyOrderTable(request: FastifyRequest, viewer: ShippingViewer, install: InstalledManifest, connectionId: string): Promise<boolean> {
    if (viewer.manages) return false;
    const orders = shippingOrders(install);
    if (orders === null || orders.length === 0) return true;
    for (const order of orders) {
      try {
        const table = await orderTable(connectionId, install.row.manifestKey, order.table);
        if (await pricesHiddenFrom(request, viewer, deps.sources, connectionId, table)) return true;
      } catch (error) {
        if (error instanceof ShippingRefusal) return true;
        throw error;
      }
    }
    return false;
  }

  /** An order's refusal as someone with a limited read is told it: what is wrong, and nothing from a column they may not read. */
  function withoutOrderValues(error: unknown): unknown {
    if (!(error instanceof ShippingRefusal)) return error;
    if (error.code === 'OUTSIDE_OWN_COUNTRY') return new ShippingRefusal('OUTSIDE_OWN_COUNTRY', 'This order is going to another country, and shipping abroad is not available yet.');
    if (error.code === 'ADDRESS_INCOMPLETE') return new ShippingRefusal('ADDRESS_INCOMPLETE', "This order's delivery address is not complete.");
    return error;
  }

  /** The order, as this person reaches it. Everything here is asked before anything else is read of it. */
  async function reachOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, source: { table: string; id: string }): Promise<ReachedOrder> {
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
    const reference = row[mapping.reference];
    // The key as the row holds it, never as the client spelled it: `ABC` and `abc` can be one row, and must be one place.
    return { mapping, table, row, rowKey: rowKeyOf(table, row), reference: reference === null || reference === undefined ? source.id : String(reference) };
  }

  /** The order, with everything a quote or a purchase refuses on already asked, and no carrier called or key read. */
  async function shippableOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, viewer: ShippingViewer, source: { table: string; id: string }): Promise<ShippableOrder> {
    const reached = await reachOrder(request, install, connectionId, source);
    const { table, row } = reached;
    const mapping = reached.mapping as ShippingOrder;

    // Refused before a carrier is asked or a key read: a quote can cost the shop money.
    const repo = shippingRepo(meta);
    const limits = await repo.limits(install.row.id);
    const venueDay = await venueDayOf(meta, connectionId);
    const booking = bookingState(viewer.manages, limits, viewer.manages ? 0 : await repo.dayLabels(install.row.id, venueDay));
    if (booking !== 'open') throw new ShippingRefusal('OWNER_BOOKS', 'The owner books this one.', { reason: booking });
    const pricesHidden = await pricesHiddenFrom(request, viewer, deps.sources, connectionId, table);

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
    let to: ReturnType<typeof orderAddress>;
    try {
      to = orderAddress(row, mapping.address, from);
    } catch (error) {
      throw !viewer.manages && readsPartOf(request, connectionId, table.id) ? withoutOrderValues(error) : error;
    }
    // Holds while parcels abroad are locked off, and is what stands once they are not.
    if (to.country !== from.country && !mayShipAbroad(viewer, limits)) throw new ShippingRefusal('OWNER_BOOKS', 'The owner books parcels going abroad.', { reason: 'abroad' });

    if (!deps.networkFeatures()) throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'Network features are off on this server, so no carrier can be asked.', { carrier: carrierKey, reason: 'network-off' });
    return { ...reached, carrierKey, from, to, limits, venueDay, pricesHidden };
  }

  /** A refusal as someone who cannot see money is told it: what it was about, and none of the carrier's own words. */
  function withoutCarrierWords(error: unknown): unknown {
    if (!(error instanceof ShippingRefusal) || error.code !== 'CARRIER_REFUSED') return error;
    const { carrierMessage: _message, carrierCode: _code, ...kept } = (error.details ?? {}) as Record<string, unknown>;
    return new ShippingRefusal('CARRIER_REFUSED', 'The carrier refused this request.', kept);
  }

  return async (app) => {
    // For the instance's own people, not the public (`security/route-audience.ts`).
    tagRoutes(app, 'staff');
    const guard = app.rbac.require(PERMISSIONS.shippingManage);

    await app.register(
      shippingKeyRoutes({
        meta,
        manifests,
        secret,
        networkFeatures: deps.networkFeatures,
        carrierDeps,
        appOf,
        statusOf: view,
        openBookings: deps.openBookings,
      }),
    );

    await app.register(
      shippingBookingRoutes({
        meta,
        manifests,
        secret,
        sources: deps.sources,
        carrierDeps,
        appOf,
        reachOrder,
        shippableOrder,
        withoutCarrierWords,
        bookingDeps: (request) => ({
          meta,
          secret,
          now: () => app.rbac.now(),
          enqueueApply: deps.enqueueApply,
          log: (message, fields) => request.log.warn(fields, message),
          ...(deps.bookingFaults === undefined ? {} : { faults: deps.bookingFaults }),
          ...(deps.bookAnswerMs === undefined ? {} : { answerMs: deps.bookAnswerMs }),
        }),
      }),
    );

    app.get(
      '/apps/:key/shipping/access',
      { config: { audit: auditExempt('says what this person may do with the app\'s labels: nothing is bought or changed') }, schema: { params: shippingParams, response: { 200: shippingAccessReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayBook && !viewer.mayCancel && !viewer.mayCustoms) throw new ForbiddenError('You have no right on this app\'s labels.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'book') });
        const shop = await shopShipping(meta, manifests, install, connectionId);
        const accounts = await carrierAccounts(meta, manifests, shop.carriers, connectionId);
        const repo = shippingRepo(meta);
        const limits = await repo.limits(install.row.id);
        const usedToday = await repo.dayLabels(install.row.id, await venueDayOf(meta, connectionId));
        const dailyLabels = limits?.dailyLabels ?? null;
        return {
          data: {
            appUpdated: shippingOrders(install) !== null,
            carrier: shop.activeCarrier,
            mode: shop.activeCarrier === null ? null : (accounts[shop.activeCarrier]?.mode ?? null),
            manages: viewer.manages,
            mayBook: viewer.mayBook,
            mayCancel: viewer.mayCancel,
            mayCustoms: viewer.mayCustoms,
            pricesHidden: await hiddenOnAnyOrderTable(request, viewer, install, connectionId),
            booking: viewer.mayBook ? bookingState(viewer.manages, limits, usedToday) : ('no-right' as const),
            ...(viewer.mayBook && !viewer.manages && dailyLabels !== null ? { usedToday, dailyLabels } : {}),
          },
        };
      },
    );

    app.get('/apps/:key/shipping', { preHandler: guard, schema: { params: shippingParams, response: { 200: shippingStatusReply } } }, async (request) => {
      shippingPerson(request);
      const { app: install, connectionId } = await appOf(request, request.params.key);
      return view(install, connectionId);
    });

    app.put(
      '/apps/:key/shipping/active-carrier',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: activeCarrierBody, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const { carrier } = request.body;
        const attached = (await attachedCarriers(manifests, install, connectionId)).find((one) => one.key === carrier);
        if (attached === undefined) throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not attached to this app.`, { carrier });
        if (!attached.on) throw new ShippingRefusal('CARRIER_SWITCHED_OFF', `The carrier "${carrier}" is switched off.`, { carrier });
        // A locked carrier runs its demo in the browser, which takes no key.
        if (!carrierLocked(carrier)) {
          if (!attached.connected) throw new ShippingRefusal('CARRIER_NO_CREDENTIAL', `The carrier "${carrier}" has no key saved.`, { carrier });
          // A shop picks a carrier only once a check of its key has passed.
          const account = (await carrierAccounts(meta, manifests, [attached], connectionId))[carrier] ?? null;
          if (account?.state !== 'ok') throw new ShippingRefusal('CARRIER_NOT_CHECKED', `The key saved for "${carrier}" has not passed a check.`, { carrier, reason: account === null ? 'unchecked' : 'refused' });
        }

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
        return view(install, connectionId);
      },
    );

    app.put(
      '/apps/:key/shipping/ship-from',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: shipFromBodySchema, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = shippingPerson(request);
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
        return view(install, connectionId);
      },
    );

    app.post(
      '/apps/:key/shipping/quotes',
      {
        config: { audit: auditExempt('asks a carrier for prices: nothing is bought or changed, and the stored quote holds no personal data') },
        schema: { params: shippingParams, body: quoteBody, response: { 200: quoteReply } },
      },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!viewer.mayBook) throw new ForbiddenError('You may not book labels for this app.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'book') });
        const { source, parcelNumber: number } = request.body;
        const parcel = request.body.parcel as Parcel;
        const purpose: ShipmentPurpose = request.body.purpose ?? 'outbound';
        const parcelNumber = number ?? 1;

        const order = await shippableOrder(request, install, connectionId, viewer, source);
        const { rowKey, limits, pricesHidden, from, to, carrierKey, venueDay } = order;
        const mapping = order.mapping;

        const room = quoteGate.take(by, app.rbac.now());
        if (!room.ok) throw new ShippingRefusal('QUOTES_TOO_FAST', 'Too many quotes in a minute. Try again shortly.', { retryAfterSeconds: room.retryAfterSeconds });
        const carrierSeam = carrierDeps(request);
        const resolved = await shippingCarrierFor(carrierSeam, carrierKey, connectionId, venueDay);
        // Which account this would spend on, and whether it is a test one, is known before the carrier is asked.
        const account = await checkedAccount(meta, secret, resolved);
        const rates = await askForRates(resolved, parcel, from, recipientForRates(to), { purpose }, carrierSeam.log).catch((error: unknown) => {
          throw pricesHidden ? withoutCarrierWords(error) : error;
        });

        const slot: ShippingSlot = { installId: install.row.id, connectionId, tableRef: mapping.table, rowKey, purpose, parcelNumber };
        const stored = await storeQuote(meta, secret, { slot, carrierKey, accountFingerprint: account.fingerprint, details: { parcel, from, to, purpose, parcelNumber }, rates, createdBy: by, now: app.rbac.now() });
        const within = (rate: { amountDecimal: string; currency: string }) => rateWithinLimit(viewer.manages, limits, rate);
        if (pricesHidden) {
          const priceless = stored.rates
            .map(({ amountDecimal, currency, ...rate }) => ({ ...rate, withinLimit: within({ amountDecimal, currency }) }))
            // A carrier lists its rates cheapest first, so its order alone would tell the price rank.
            .sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : a.rateId < b.rateId ? -1 : 1));
          return { data: { ...stored, mode: account.mode, pricesHidden: true as const, rates: priceless } };
        }
        return { data: { ...stored, mode: account.mode, pricesHidden: false as const, rates: stored.rates.map((rate) => ({ ...rate, withinLimit: within(rate) })) } };
      },
    );
  };
}
