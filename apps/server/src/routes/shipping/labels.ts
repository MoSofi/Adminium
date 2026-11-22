// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BOUGHT LABEL'S FILE, for the people who may see the address on it.
 *
 *  - `GET  …/bookings/:id/documents/:kind` hands over the stored file.
 *  - `POST …/bookings/:id/documents/:kind` fetches it from the carrier: the
 *    retry for a label that is owed.
 *  - `PUT  …/shipping/label-size` is the size this shop asks for.
 *
 * Each document route asks for the right to book on this install, the order
 * row as this person reaches it, and `read_pii` on the order's table: a label
 * shows a name, an address and perhaps a phone, which that person's read of
 * the order may mask. A booking they cannot reach is one that is not there.
 *
 * The file goes out as an attachment with `nosniff` and is never cached. No
 * reply, log line or audit row holds a carrier's key or an address for a file.
 */
import { LABEL_SIZES, SHIPMENT_DOCUMENT_KINDS, type ShipmentDocumentKind } from '@adminium/add-on-contracts';
import { shippingBookingsRepo, shippingRepo, type InstalledManifest, type MetaDb, type ShippingBooking } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { venueDayOf } from '../../crud/row-limit-context.js';
import { canReadPii } from '../../crud/mask.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import type { FileStore } from '../../files/store.js';
import { grantKeyOf } from '../../installs/resolve.js';
import { pkOfRowKey } from '../../payments/payables.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { appShippingPermission, PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import { pricesHiddenFrom, shippingPerson, shippingViewerOf } from '../../shipping/access.js';
import { bookingView } from '../../shipping/bookings.js';
import { shippingCarrierFor, type ShippingCarrierDeps } from '../../shipping/carriers.js';
import { checkedAccount } from '../../shipping/keys.js';
import { fetchDocument, labelSizeOf, storedDocument, type LabelDeps } from '../../shipping/labels.js';
import { ShippingRefusal } from '../../shipping/refusals.js';
import type { PayableSources } from '../../payments/payables.js';
import type { ReachedOrder } from './bookings.js';
import { bookingReply, shippingParams } from './schema.js';

const documentParams = z.object({
  key: z.string().min(1).max(120),
  id: z.string().min(1).max(64),
  kind: z.enum(SHIPMENT_DOCUMENT_KINDS),
});

export const labelSizeBody = z.object({ size: z.enum(LABEL_SIZES) }).strict();
export const labelSizeReply = z.object({ data: z.object({ labelSize: z.enum(LABEL_SIZES) }).strict() });

export interface ShippingLabelRoutesDeps {
  meta: MetaDb;
  secret: string;
  storage: FileStore;
  sources: PayableSources;
  carrierDeps(request: FastifyRequest): ShippingCarrierDeps;
  appOf(request: FastifyRequest, param: string): Promise<{ app: InstalledManifest; connectionId: string }>;
  reachOrder(request: FastifyRequest, install: InstalledManifest, connectionId: string, source: { table: string; id: string }): Promise<ReachedOrder>;
}

export function shippingLabelRoutes(deps: ShippingLabelRoutesDeps): FastifyPluginAsyncZod {
  const { meta, secret, storage } = deps;

  /** The booking and its order, for someone who may see the address on its label. */
  async function reached(request: FastifyRequest, key: string, id: string): Promise<{ install: InstalledManifest; connectionId: string; booking: ShippingBooking; order: ReachedOrder; by: string; hidden: boolean }> {
    const by = shippingPerson(request);
    const { app: install, connectionId } = await deps.appOf(request, key);
    const viewer = await shippingViewerOf(request, install);
    if (!viewer.mayBook) throw new ForbiddenError('You may not use labels for this app.', 'FORBIDDEN', { permission: appShippingPermission(grantKeyOf(install.row), 'book') });
    const missing = () => new NotFoundError('That booking was not found.');
    const booking = await shippingBookingsRepo(meta).byId(id);
    if (booking === null || booking.connectionId !== connectionId) throw missing();
    let order: ReachedOrder;
    try {
      order = await deps.reachOrder(request, install, connectionId, { table: booking.tableRef, id: booking.rowKey });
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof ShippingRefusal || error instanceof NotFoundError) throw missing();
      throw error;
    }
    if (order.table.id !== booking.tableName || order.rowKey !== booking.rowKey) throw missing();
    if (!(await canReadPii(request, connectionId, order.table.id))) {
      throw new ForbiddenError('A label shows a customer\'s address, which you may not see on this table.', 'FORBIDDEN', { permission: `table:${connectionId}:${order.table.id}:read_pii` });
    }
    const hidden = await pricesHiddenFrom(request, viewer, deps.sources, connectionId, order.table);
    return { install, connectionId, booking, order, by, hidden };
  }

  return async (app) => {
    tagRoutes(app, 'staff');
    const labelDeps = (request: FastifyRequest): LabelDeps => ({ meta, storage, now: () => app.rbac.now(), log: (message, fields) => request.log.warn(fields, message) });

    app.get(
      '/apps/:key/shipping/bookings/:id/documents/:kind',
      { config: { audit: audited('rbac') }, schema: { params: documentParams } },
      async (request, reply) => {
        const { booking, install } = await reached(request, request.params.key, request.params.id);
        const kind: ShipmentDocumentKind = request.params.kind;
        const { file, opened } = await storedDocument(labelDeps(request), booking, kind);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'shipping.label.downloaded',
          changes: { after: { app: install.row.manifestKey, booking: booking.id, kind, mode: booking.mode } },
        });
        return reply
          .header('content-type', file.mime)
          .header('content-length', String(opened.sizeBytes))
          .header('content-disposition', `attachment; filename="${file.filename}"`)
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, no-store')
          .send(opened.stream);
      },
    );

    app.post(
      '/apps/:key/shipping/bookings/:id/documents/:kind',
      { config: { audit: audited('rbac') }, schema: { params: documentParams, response: { 200: bookingReply } } },
      async (request) => {
        const { booking, connectionId, install, order, by, hidden } = await reached(request, request.params.key, request.params.id);
        const seam = deps.carrierDeps(request);
        const resolved = await shippingCarrierFor(seam, booking.carrierKey, connectionId, await venueDayOf(meta, connectionId));
        // The key must still open the account that bought it, or the carrier would be asked for another shop's label.
        const account = await checkedAccount(meta, secret, resolved);
        if (account.fingerprint !== booking.accountFingerprint) {
          throw new ShippingRefusal('LABEL_OTHER_ACCOUNT', 'This label was bought on another carrier account, so it cannot be fetched with the key saved now.', { booking: booking.id });
        }
        const pk = pkOfRowKey(order.table as unknown as Pick<ResolvedTable, 'primaryKey' | 'columns'>, booking.rowKey) ?? {};
        const after = await fetchDocument(labelDeps(request), booking, resolved, { pk }, request.params.kind, by);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.label.fetched',
          changes: { after: { app: install.row.manifestKey, booking: booking.id, kind: request.params.kind, state: after.labelRef === null ? 'owed' : 'ready' } },
        });
        return { data: bookingView(after, app.rbac.now(), hidden) };
      },
    );

    app.put(
      '/apps/:key/shipping/label-size',
      { preHandler: app.rbac.require(PERMISSIONS.shippingManage), config: { audit: audited('rbac') }, schema: { params: shippingParams, body: labelSizeBody, response: { 200: labelSizeReply } } },
      async (request) => {
        const by = shippingPerson(request);
        const { app: install } = await deps.appOf(request, request.params.key);
        const before = await labelSizeOf(meta, install.row.id);
        await shippingRepo(meta).setLabelSize(install.row.id, request.body.size, by, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'shipping.label-size.update',
          changes: { before: { labelSize: before }, after: { app: install.row.manifestKey, labelSize: request.body.size } },
        });
        return { data: { labelSize: request.body.size } };
      },
    );
  };
}
