// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Both of adminium.dev's lists in one request.
 *
 * A page asks for its own list: the Add-ons page the add-ons, the Apps page
 * the apps. Where both are wanted at once (when the server starts, at the
 * daily refresh, and in Adminium Designer, which reads both) one call to
 * `/api/v1/marketplace` answers `{ format, generatedAt, apps, addOns }` and
 * fills both caches.
 *
 * ONLY WHEN BOTH LISTS ARE ON. A server with one list switched off asks for
 * the other alone, through that list's own client: a list someone switched
 * off is never fetched, and never written from a combined answer. The gate is
 * the two clients' own (`ADMINIUM_NETWORK_FEATURES`, then each switch), asked
 * before any address is built.
 *
 * The answer goes through the same per-item parse each single list does, so
 * an item this server cannot read is left out of its list and the rest is
 * still offered; the same fixed host, no redirect, the same size cap and
 * timeout.
 */
import { MARKETPLACE_FORMAT, addOnItemWireSchema, appItemWireSchema, parseShelf } from '@adminium/manifest';

import {
  AddOnCatalogError,
  MAX_CATALOG_BYTES,
  addOnCatalogFromShelf,
  boundedRequest,
  shelfUrl,
  type Catalog,
  type CatalogClient,
} from '../add-ons/catalog.js';
import { appCatalogFromShelf, type AppCatalog, type AppCatalogClient } from '../apps/catalog.js';

/** The marketplace API's two shelves together. Never serves files. */
export const MARKETPLACE_ENDPOINT = 'https://adminium.dev/api/v1/marketplace';

export interface BothLists {
  addOns: Catalog;
  apps: AppCatalog;
}

export interface BothListsDeps {
  addOns: Pick<CatalogClient, 'isEnabled'>;
  apps: Pick<AppCatalogClient, 'isEnabled'>;
  /** Tests only; production always reads {@link MARKETPLACE_ENDPOINT}. */
  endpoint?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
}

/** Whether both lists are on: the one case the combined request is made in. */
export async function bothListsOn(deps: Pick<BothListsDeps, 'addOns' | 'apps'>): Promise<boolean> {
  return (await deps.addOns.isEnabled()) && (await deps.apps.isEnabled());
}

/** Fetch and validate both lists. Refuses, with no request made, unless both are on. */
export async function fetchBothLists(deps: BothListsDeps, signal?: AbortSignal): Promise<BothLists> {
  if (!(await bothListsOn(deps))) {
    throw new AddOnCatalogError('CATALOG_DISABLED', 'the two lists are asked for together only when both are on');
  }
  const endpoint = deps.endpoint ?? MARKETPLACE_ENDPOINT;
  const { bytes } = await boundedRequest(deps.fetchImpl ?? globalThis.fetch, shelfUrl(endpoint), 'application/json', MAX_CATALOG_BYTES, 'CATALOG_UNREACHABLE', signal);
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (err) {
    throw new AddOnCatalogError('CATALOG_UNREACHABLE', `${endpoint} did not return JSON: ${String(err)}`);
  }
  const doc = body as { format?: unknown; generatedAt?: unknown; apps?: unknown; addOns?: unknown } | null;
  if (doc === null || typeof doc !== 'object' || doc.format !== MARKETPLACE_FORMAT || !Array.isArray(doc.apps) || !Array.isArray(doc.addOns)) {
    throw new AddOnCatalogError('CATALOG_MALFORMED', `${endpoint} did not answer in ${MARKETPLACE_FORMAT}`);
  }
  // Each list as its own shelf, read exactly as its single address is read.
  const shelf = (items: unknown[]) => ({ format: doc.format, generatedAt: doc.generatedAt, items });
  const addOns = parseShelf(addOnItemWireSchema, shelf(doc.addOns));
  const apps = parseShelf(appItemWireSchema, shelf(doc.apps));
  if (addOns === null || apps === null) {
    throw new AddOnCatalogError('CATALOG_MALFORMED', `${endpoint} did not answer in ${MARKETPLACE_FORMAT}`);
  }
  return { addOns: addOnCatalogFromShelf(addOns), apps: appCatalogFromShelf(apps) };
}
