// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CARRIER'S KEY HAS ITS OWN DOOR, and so does what packers may spend.
 *
 * Every route needs `shipping.manage` and a signed-in person. A key is checked
 * with the carrier BEFORE it is saved, so a rejected paste is never stored and
 * the old key stays in force until a new one passes. Whether a key is test or
 * live is the carrier's answer. A key that opens another account asks first,
 * and a key with a booking still unresolved on it cannot change at all: the
 * new account could not say whether the old one was charged.
 *
 * No reply, log line or audit row holds a key. The audit names the fields.
 */
import type { AddOnManifest } from '@adminium/manifest';
import { addOnManifestSchema } from '@adminium/manifest';
import { SERVER_SCOPE, shippingRepo, shippingTrackingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb, type ShippingAccount } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { audited } from '../../audit/coverage.js';
import { venueDayOf } from '../../crud/row-limit-context.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { shippingPerson } from '../../shipping/access.js';
import { readShipFrom } from '../../shipping/addresses.js';
import { shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import { checkCarrierKey, keyFieldsOf, type KeyCheck, type OpenBooking } from '../../shipping/keys.js';
import { carrierLocked } from '../../shipping/locks.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import { attachedCarriers } from '../../shipping/shop.js';
import { carrierKeyBody, carrierParams, keyCheckReply, limitsBody, shippingParams, shippingStatusReply } from './schema.js';

export interface ShippingKeyRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  secret: string;
  networkFeatures: () => boolean;
  carrierDeps(request: FastifyRequest): ShippingCarrierDeps;
  appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }>;
  statusOf(install: InstalledManifest, connectionId: string): Promise<{ data: Record<string, unknown> }>;
  /** The bookings on a carrier install with no final answer yet. */
  openBookings(carrierInstallId: string): Promise<readonly OpenBooking[]>;
}

export function shippingKeyRoutes(deps: ShippingKeyRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests, secret } = deps;

  /** This database's own install of a carrier attached to the app. A carrier kept once per server takes no key. */
  async function carrierHere(install: InstalledManifest, connectionId: string, carrier: string): Promise<{ row: InstalledManifest; manifest: AddOnManifest }> {
    if (!(await attachedCarriers(manifests, install, connectionId)).some((one) => one.key === carrier)) {
      throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not attached to this app.`, { carrier });
    }
    const row = await manifests.findInScope(carrier, connectionId);
    if (row === null) {
      if ((await manifests.findInScope(carrier, SERVER_SCOPE)) !== null) throw new ShippingRefusal('CARRIER_SERVER_WIDE', `The carrier "${carrier}" is kept for the whole server, so it takes no key for one shop.`, { carrier });
      throw new ShippingRefusal('CARRIER_NOT_INSTALLED', `The carrier "${carrier}" is not installed on this database.`, { carrier });
    }
    const manifest = addOnManifestSchema.safeParse(row.document);
    if (!manifest.success) throw new ShippingRefusal('CARRIER_NOT_LOADED', `The carrier "${carrier}" has a manifest this build cannot read.`, { carrier });
    return { row, manifest: manifest.data };
  }

  async function refuseWhileOpen(carrierInstallId: string, carrier: string): Promise<void> {
    const open = await deps.openBookings(carrierInstallId);
    if (open.length === 0) return;
    throw new ShippingRefusal('KEY_IN_USE', 'A booking on this key has no final answer yet, so the key cannot change.', {
      carrier,
      count: open.length,
      orders: open.slice(0, 20).map((booking) => booking.reference),
    });
  }

  const shopCountry = async (install: InstalledManifest) => readShipFrom((await shippingRepo(meta).settings(install.row.id))?.shipFrom ?? null)?.country ?? null;

  function requireNetwork(carrier: string): void {
    if (!deps.networkFeatures()) throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'Network features are off on this server, so no carrier can be asked.', { carrier, reason: 'network-off' });
  }

  return async (app) => {
    tagRoutes(app, 'staff');
    const guard = app.rbac.require(PERMISSIONS.shippingManage);

    app.put(
      '/apps/:key/shipping/carriers/:carrier/key',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: carrierParams, body: carrierKeyBody, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        // Before anything is read: a locked carrier never takes a key.
        if (carrierLocked(carrier)) throw new ShippingRefusal('CARRIER_LOCKED', `"${carrier}" runs as a demo for now, so it takes no key.`, { carrier });
        const { row, manifest } = await carrierHere(install, connectionId, carrier);

        const expected = keyFieldsOf(manifest);
        const supplied = Object.keys(request.body.fields);
        // Field names only: the values are the key.
        if (expected.length === 0 || supplied.length !== expected.length || supplied.some((name) => !expected.includes(name))) {
          throw new ShippingRefusal('KEY_FIELDS', `The key for "${carrier}" is made of other fields.`, { carrier, expected });
        }
        await refuseWhileOpen(row.row.id, carrier);
        requireNetwork(carrier);

        const fields = request.body.fields;
        const seam = deps.carrierDeps(request);
        const resolved = await shippingCarrierFor(seam, carrier, connectionId, await venueDayOf(meta, connectionId), fields);
        const country = await shopCountry(install);
        const check = await checkCarrierKey(resolved, country === null ? {} : { country }, seam.log);
        if (check.outcome === 'refused') {
          throw new ShippingRefusal('KEY_REFUSED', 'The carrier did not accept this key. Nothing was saved.', { carrier, ...(check.carrierMessage === undefined ? {} : { carrierMessage: check.carrierMessage }) });
        }
        if (check.outcome === 'unreachable') throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'The carrier did not answer. Nothing was saved.', { carrier });

        const repo = shippingRepo(meta);
        const before = await repo.account(row.row.id);
        const fingerprint = resolved.accountFingerprint(secret, check.mode, check.accountId);
        const otherAccount = before !== null && before.fingerprint !== fingerprint;
        if (otherAccount && request.body.confirmAccountChange !== true) {
          throw new ShippingRefusal('KEY_OTHER_ACCOUNT', 'This key opens a different account. Nothing was saved.', { carrier, from: { mode: before.mode, keyHint: before.keyHint }, to: { mode: check.mode } });
        }
        // The carrier took seconds to answer: a booking may have started on the old key meanwhile.
        await refuseWhileOpen(row.row.id, carrier);

        const keyHash = resolved.keyHash(secret);
        const account: ShippingAccount = {
          carrierInstallId: row.row.id,
          mode: check.mode,
          fingerprint,
          keyHash,
          keyHint: resolved.keyHint,
          state: 'ok',
          carriers: check.carriers,
          checkedBy: by,
          checkedAt: app.rbac.now(),
        };
        // The record goes first: stopped part way, the new key reads as unchecked, never as the old key's mode.
        await repo.forgetAccount(row.row.id);
        await manifests.setCredential(row.row.id, { kind: 'api-key', secret: fields });
        await repo.saveAccount(account);
        // A rate was priced under the old account, and a purchase would be made on the new one.
        if (before?.keyHash !== keyHash) await repo.clearCarrierQuotes(connectionId, carrier);
        // A new key means a new webhook address: the old one stops working, and the screen makes the next.
        if (before !== null && before.keyHash !== keyHash) await shippingTrackingRepo(meta).clearToken(row.row.id, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.key.saved',
          changes: { after: { app: install.row.manifestKey, carrier, fields: expected, mode: check.mode, accountChanged: otherAccount } },
        });
        return (await deps.statusOf(install, connectionId)) as never;
      },
    );

    app.post(
      '/apps/:key/shipping/carriers/:carrier/check',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: carrierParams, response: { 200: keyCheckReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        if (carrierLocked(carrier)) throw new ShippingRefusal('CARRIER_LOCKED', `"${carrier}" runs as a demo for now, so it has no key to check.`, { carrier });
        const { row } = await carrierHere(install, connectionId, carrier);
        requireNetwork(carrier);

        const seam = deps.carrierDeps(request);
        const resolved = await shippingCarrierFor(seam, carrier, connectionId, await venueDayOf(meta, connectionId));
        const country = await shopCountry(install);
        const check: KeyCheck = await checkCarrierKey(resolved, country === null ? {} : { country }, seam.log);
        const repo = shippingRepo(meta);
        const before = await repo.account(row.row.id);
        if (check.outcome === 'ok') {
          await repo.saveAccount({
            carrierInstallId: row.row.id,
            mode: check.mode,
            fingerprint: resolved.accountFingerprint(secret, check.mode, check.accountId),
            keyHash: resolved.keyHash(secret),
            keyHint: resolved.keyHint,
            state: 'ok',
            carriers: check.carriers,
            checkedBy: by,
            checkedAt: app.rbac.now(),
          });
        } else if (check.outcome === 'refused' && before !== null) {
          await repo.saveAccount({ ...before, state: 'refused', checkedBy: by, checkedAt: app.rbac.now() });
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.key.checked',
          changes: { after: { app: install.row.manifestKey, carrier, outcome: check.outcome, ...(check.outcome === 'ok' ? { mode: check.mode } : {}) } },
        });
        if (check.outcome === 'ok') return { data: { outcome: 'ok' as const, mode: check.mode, carriers: check.carriers, country } };
        if (check.outcome === 'refused') return { data: { outcome: 'refused' as const, ...(check.carrierMessage === undefined ? {} : { carrierMessage: check.carrierMessage }) } };
        return { data: { outcome: 'unreachable' as const } };
      },
    );

    app.delete(
      '/apps/:key/shipping/carriers/:carrier/key',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: carrierParams, response: { 200: shippingStatusReply } } },
      async (request) => {
        shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const { carrier } = request.params;
        // A locked carrier may still hold a key from before the lock, and its owner may always remove it.
        const { row } = await carrierHere(install, connectionId, carrier);
        await refuseWhileOpen(row.row.id, carrier);
        const repo = shippingRepo(meta);
        await repo.forgetAccount(row.row.id);
        const credentialsDeleted = await manifests.deleteCredential(row.row.id);
        await shippingTrackingRepo(meta).clearToken(row.row.id, app.rbac.now());
        await repo.clearCarrierQuotes(connectionId, carrier);
        await app.rbac.audit(request, { category: 'settings', action: 'shipping.key.removed', changes: { after: { app: install.row.manifestKey, carrier, credentialsDeleted } } });
        return (await deps.statusOf(install, connectionId)) as never;
      },
    );

    app.put(
      '/apps/:key/shipping/limits',
      { preHandler: guard, config: { audit: audited('rbac') }, schema: { params: shippingParams, body: limitsBody, response: { 200: shippingStatusReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install, connectionId } = await deps.appOf(request, request.params.key);
        const repo = shippingRepo(meta);
        const before = await repo.limits(install.row.id);
        const { perLabel, dailyLabels, packersAbroad } = request.body;
        const next = {
          installId: install.row.id,
          labelLimit: perLabel?.amount ?? null,
          labelCurrency: perLabel?.currency ?? null,
          dailyLabels,
          packersAbroad: packersAbroad ?? before?.packersAbroad ?? false,
          updatedBy: by,
          updatedAt: app.rbac.now(),
        };
        await repo.setLimits(next);
        const shown = (one: typeof before) => (one === null ? null : { labelLimit: one.labelLimit, labelCurrency: one.labelCurrency, dailyLabels: one.dailyLabels, packersAbroad: one.packersAbroad });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.limits.saved',
          changes: { before: { app: install.row.manifestKey, limits: shown(before) }, after: { app: install.row.manifestKey, limits: shown(next) } },
        });
        return (await deps.statusOf(install, connectionId)) as never;
      },
    );
  };
}
