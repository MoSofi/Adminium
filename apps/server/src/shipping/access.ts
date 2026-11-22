// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO MAY DO WHAT WITH AN APP INSTALL'S LABELS, asked per person.
 *
 *  - `system:shipping:manage` runs shipping: it books, cancels and declares
 *    customs, sees prices, and is not bound by the packers' limits.
 *  - `shipping:<install>:book`, `:cancel` and `:customs` are an app role's
 *    rights on that one install's labels. API keys hold none of them here.
 *  - Prices are hidden from a person whose read of the order table leaves its
 *    money out. A limited read of a table whose money columns cannot be named
 *    hides them too, so a price is never shown past a limit nobody could judge.
 */
import type { InstalledManifest } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { grantKeyOf } from '../installs/resolve.js';
import { moneyHidden } from '../payments/money-hidden.js';
import type { PayableSources } from '../payments/payables.js';
import { appShippingPermission, PERMISSIONS } from '../rbac/permissions.js';
import { readLimitOf } from '../rbac/read-limits.js';
import type { PermissionSet } from '../rbac/resolver.js';

export interface ShippingViewer {
  person: string;
  manages: boolean;
  mayBook: boolean;
  mayCancel: boolean;
  mayCustoms: boolean;
}

/** A signed-in person's id. A carrier account spends real money, so an API key is refused. */
export function shippingPerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Shipping is used by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export async function shippingViewerOf(request: FastifyRequest, install: InstalledManifest): Promise<ShippingViewer> {
  const person = shippingPerson(request);
  const manages = await request.can(PERMISSIONS.shippingManage);
  if (manages) return { person, manages, mayBook: true, mayCancel: true, mayCustoms: true };
  const grantKey = grantKeyOf(install.row);
  const [mayBook, mayCancel, mayCustoms] = await Promise.all([
    request.can(appShippingPermission(grantKey, 'book')),
    request.can(appShippingPermission(grantKey, 'cancel')),
    request.can(appShippingPermission(grantKey, 'customs')),
  ]);
  return { person, manages, mayBook, mayCancel, mayCustoms };
}

/** Whether this person reads only part of the table: a refusal then names none of its values. */
export function readsPartOf(request: FastifyRequest, connectionId: string, tableId: string): boolean {
  const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
  return set === undefined || readLimitOf(set, connectionId, tableId) !== null;
}

/** Whether this person's read of the order table hides what things cost. */
export async function pricesHiddenFrom(
  request: FastifyRequest,
  viewer: Pick<ShippingViewer, 'manages'>,
  sources: PayableSources,
  connectionId: string,
  table: { id: string; columns: ReadonlyMap<string, unknown> },
): Promise<boolean> {
  if (viewer.manages) return false;
  const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
  if (set === undefined) return true;
  if (readLimitOf(set, connectionId, table.id) === null) return false;
  const named = (await sources.shapeOf(connectionId, table.id)) !== null || (await sources.profile(connectionId, table.id)) !== null;
  return named ? moneyHidden(request, sources, connectionId, table) : true;
}
