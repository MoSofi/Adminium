// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A PARCEL IS, for staff.
 *
 *  - `POST …/bookings/:id/refresh`        one person asks about one parcel.
 *  - `POST …/tracking/refresh`            "Refresh open parcels", on a budget.
 *  - `GET  …/carriers/:carrier/tracking`  the webhook's health and the parcels' age.
 *  - `POST …/carriers/:carrier/webhook`   makes the address, shown this once.
 *  - `PUT  …/carriers/:carrier/polling`   refused while the code lock is off.
 *
 * Every route is for a signed-in person: that is what makes a carrier call one
 * the carrier's terms allow. No reply, log or audit row holds the token.
 */
import { addOnManifestSchema } from '@adminium/manifest';
import { SHIPPING_TRACK_FINAL_RANK, settingsRepo, shippingBookingsRepo, shippingTrackingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb, type ShippingBooking } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import { venueDayOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { grantKeyOf } from '../../installs/resolve.js';
import { appShippingPermission, PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { shippingPerson, shippingViewerOf, type ShippingViewer } from '../../shipping/access.js';
import { shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import { checkedAccount } from '../../shipping/keys.js';
import { mayPoll } from '../../shipping/locks.js';
import { refreshOpenParcels, refreshParcel, REFRESH_OPEN_WINDOW_MS, type RefreshDeps } from '../../shipping/refresh.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import { attachedCarriers, shopShipping } from '../../shipping/shop.js';
import { maskedWebhookAddress, newWebhookToken, trackViewOf, webhookAddress } from '../../shipping/tracking.js';
import { trackingReaderFor } from '../../shipping/tracking-readers.js';
import type { ReachedOrder } from './bookings.js';
import { bookingIdParams, carrierParams, shippingParams, trackView } from './schema.js';

/** After this long with no change, an open parcel is listed as quiet. */
export const QUIET_PARCEL_MS = 7 * 24 * 60 * 60_000;
const SUMMARY_SCAN = 500;

export interface ShippingTrackingRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  secret: string;
  networkFeatures: () => boolean;
  carrierDeps(request: FastifyRequest): ShippingCarrierDeps;
  appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }>;
  reachOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, source: { table: string; id: string }): Promise<ReachedOrder>;
}

const refreshReply = z.object({
  data: z.object({ outcome: z.enum(['updated', 'unchanged', 'no-events', 'recent', 'test', 'not-open', 'other-account', 'no-answer', 'rate-limited']), track: trackView.nullable() }).strict(),
});

const refreshOpenReply = z.object({
  data: z
    .object({
      outcome: z.enum(['done', 'recent', 'rate-limited']),
      checked: z.number(),
      updated: z.number(),
      failed: z.number(),
      remaining: z.number(),
      more: z.boolean(),
      oldestCheckedAt: z.number().nullable(),
      neverChecked: z.number(),
      retryAt: z.number().nullable(),
    })
    .strict(),
});

const trackingReply = z.object({
  data: z
    .object({
      carrier: z.string(),
      webhook: z
        .object({
          supported: z.boolean(),
          /** The address with its token masked. The full one is shown once, when made. */
          address: z.string().nullable(),
          made: z.boolean(),
          madeAt: z.number().nullable(),
          firstAt: z.number().nullable(),
          /** The last webhook accepted. A person's Refresh never sets this. */
          lastAt: z.number().nullable(),
          lastBadAt: z.number().nullable(),
        })
        .strict(),
      parcels: z.object({ open: z.number(), neverChecked: z.number(), oldestCheckedAt: z.number().nullable(), quiet: z.number() }).strict(),
      polling: z.object({ allowed: z.boolean(), on: z.boolean() }).strict(),
    })
    .strict(),
});

const webhookReply = z.object({ data: z.object({ address: z.string(), madeAt: z.number() }).strict() });
const pollingBody = z.object({ on: z.boolean() }).strict();
const pollingReply = z.object({ data: z.object({ on: z.boolean() }).strict() });

export function shippingTrackingRoutes(deps: ShippingTrackingRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests, secret } = deps;

  const refuseNoRight = (install: InstalledManifest) => new ForbiddenError('You may not see this app\'s parcels.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'book') });
  const mayTrack = (viewer: ShippingViewer) => viewer.mayBook || viewer.mayCancel || viewer.mayCustoms;

  function requireNetwork(carrier: string): void {
    if (!deps.networkFeatures()) throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'Network features are off on this server, so no carrier can be asked.', { carrier, reason: 'network-off' });
  }

  /** Whether this person reaches the order a booking is on. A row they cannot see is one they cannot refresh. */
  async function reaches(request: FastifyRequest, install: InstalledManifest, connectionId: string, booking: ShippingBooking): Promise<boolean> {
    if (booking.connectionId !== connectionId || booking.installId !== install.row.id) return false;
    try {
      const order = await deps.reachOrder(request, install, connectionId, { table: booking.tableRef, id: booking.rowKey });
      return order.table.id === booking.tableName;
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof ShippingRefusal || error instanceof NotFoundError) return false;
      throw error;
    }
  }

  /** This database's own install of a carrier attached to the app. */
  async function carrierHere(install: InstalledManifest, connectionId: string, carrier: string): Promise<InstalledManifest> {
    if (!(await attachedCarriers(manifests, install, connectionId)).some((one) => one.key === carrier)) {
      throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not attached to this app.`, { carrier });
    }
    const row = await manifests.findInScope(carrier, connectionId);
    if (row === null || !addOnManifestSchema.safeParse(row.document).success) throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not installed on this database.`, { carrier });
    return row;
  }

  const refreshDeps = (request: FastifyRequest, now: () => number): RefreshDeps => ({ meta, now, log: (message, fields) => request.log.warn(fields, message) });

  return async (app) => {
    tagRoutes(app, 'staff');
    const guard = app.rbac.require(PERMISSIONS.shippingManage);

    app.post(
      '/apps/:key/shipping/bookings/:id/refresh',
      { config: { audit: audited('rbac') }, schema: { params: bookingIdParams, response: { 200: refreshReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!mayTrack(viewer)) throw refuseNoRight(install);
        const booking = await shippingBookingsRepo(meta).byId(request.params.id);
        if (booking === null || !(await reaches(request, install, connectionId, booking))) throw new NotFoundError('That booking was not found.');
        const repo = shippingTrackingRepo(meta);
        const now = () => app.rbac.now();
        // A test booking is answered before any key is read: it is never asked about.
        if (booking.mode === 'test') return { data: { outcome: 'test' as const, track: trackViewOf(await repo.parcel(booking.id)) } };
        requireNetwork(booking.carrierKey);
        const resolved = await shippingCarrierFor(deps.carrierDeps(request), booking.carrierKey, connectionId, await venueDayOf(meta, connectionId));
        const account = await checkedAccount(meta, secret, resolved);
        const outcome = await refreshParcel(refreshDeps(request, now), booking, resolved, account.fingerprint);
        await app.rbac.audit(request, { category: 'settings', action: 'shipping.tracking.refreshed', changes: { after: { app: install.row.manifestKey, booking: booking.id, outcome } } });
        return { data: { outcome, track: trackViewOf(await repo.parcel(booking.id)) } };
      },
    );

    app.post(
      '/apps/:key/shipping/tracking/refresh',
      { config: { audit: audited('rbac') }, schema: { params: shippingParams, response: { 200: refreshOpenReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const viewer = await shippingViewerOf(request, install);
        if (!mayTrack(viewer)) throw refuseNoRight(install);
        const carrierKey = (await shopShipping(meta, manifests, install, connectionId)).activeCarrier;
        if (carrierKey === null) throw new ShippingRefusal('NO_ACTIVE_CARRIER', 'This app has no carrier chosen yet.');
        requireNetwork(carrierKey);
        const resolved = await shippingCarrierFor(deps.carrierDeps(request), carrierKey, connectionId, await venueDayOf(meta, connectionId));
        const account = await checkedAccount(meta, secret, resolved);
        const result = await refreshOpenParcels(refreshDeps(request, () => app.rbac.now()), {
          carrierInstallId: resolved.install.row.id,
          installId: install.row.id,
          connectionId,
          resolved,
          accountFingerprint: account.fingerprint,
          reaches: (booking) => reaches(request, install, connectionId, booking),
        });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.tracking.refreshed-open',
          changes: { after: { app: install.row.manifestKey, carrier: carrierKey, outcome: result.outcome, checked: result.checked, updated: result.updated, failed: result.failed } },
        });
        return { data: result };
      },
    );

    app.get(
      '/apps/:key/shipping/carriers/:carrier/tracking',
      { preHandler: guard, config: { audit: auditExempt('says how a carrier\'s webhook and parcels stand: nothing is called or changed') }, schema: { params: carrierParams, response: { 200: trackingReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        const row = await carrierHere(install, connectionId, carrier);
        const repo = shippingTrackingRepo(meta);
        const state = await repo.install(row.row.id);
        const now = app.rbac.now();
        const open = await repo.openParcels({ carrierInstallId: row.row.id, connectionId, installId: install.row.id }, now - REFRESH_OPEN_WINDOW_MS, SUMMARY_SCAN);
        const checked = open.flatMap((one) => (one.checkedAt === null ? [] : [one.checkedAt]));
        const publicOrigin = await settingsRepo(meta).get('system.publicOrigin');
        const made = state?.tokenHash != null && state.tokenHint !== null;
        return {
          data: {
            carrier,
            webhook: {
              supported: trackingReaderFor(carrier) !== null,
              address: made ? maskedWebhookAddress(publicOrigin, row.row.id, state.tokenHint!) : null,
              made,
              madeAt: state?.tokenMadeAt ?? null,
              firstAt: state?.firstAt ?? null,
              lastAt: state?.lastAt ?? null,
              lastBadAt: state?.lastBadAt ?? null,
            },
            parcels: {
              open: open.length,
              neverChecked: open.length - checked.length,
              oldestCheckedAt: checked.length === 0 ? null : Math.min(...checked),
              quiet: open.filter((one) => one.rank < SHIPPING_TRACK_FINAL_RANK && now - (one.statusAt ?? one.createdAt) >= QUIET_PARCEL_MS).length,
            },
            polling: { allowed: mayPoll(carrier), on: mayPoll(carrier) && state?.pollOnAt != null },
          },
        };
      },
    );

    app.post(
      '/apps/:key/shipping/carriers/:carrier/webhook',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: carrierParams, response: { 200: webhookReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        const row = await carrierHere(install, connectionId, carrier);
        if (trackingReaderFor(carrier) === null) throw new ShippingRefusal('TRACKING_NO_WEBHOOK', `The carrier "${carrier}" has no webhook.`, { carrier });
        const made = newWebhookToken(secret, row.row.id);
        const address = webhookAddress(await settingsRepo(meta).get('system.publicOrigin'), row.row.id, made.token);
        // Checked before the old token goes: a server with no usable address keeps the one it has.
        if (address === null) throw new ShippingRefusal('NO_PUBLIC_ADDRESS', 'This server needs a public https address before a carrier can call it.', { carrier });
        const at = app.rbac.now();
        await shippingTrackingRepo(meta).setToken(row.row.id, made.hash, made.hint, at);
        await app.rbac.audit(request, { category: 'settings', action: 'shipping.webhook.made', changes: { after: { app: install.row.manifestKey, carrier } } });
        return { data: { address, madeAt: at } };
      },
    );

    app.put(
      '/apps/:key/shipping/carriers/:carrier/polling',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: carrierParams, body: pollingBody, response: { 200: pollingReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        const row = await carrierHere(install, connectionId, carrier);
        // Before anything is written: while the lock is off, a stored switch must not even exist to be found later.
        if (!mayPoll(carrier)) throw new ShippingRefusal('POLLING_LOCKED', 'Background tracking is not available yet. Use Refresh.', { carrier });
        await shippingTrackingRepo(meta).setPolling(row.row.id, request.body.on, app.rbac.now());
        await app.rbac.audit(request, { category: 'settings', action: 'shipping.polling.saved', changes: { after: { app: install.row.manifestKey, carrier, on: request.body.on } } });
        return { data: { on: request.body.on } };
      },
    );
  };
}
