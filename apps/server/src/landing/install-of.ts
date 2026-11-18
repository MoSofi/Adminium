// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH INSTALL OF A LANDING PAGES ADD-ON A STAFF REQUEST MEANS: the one rule
 * every `/api/v1/landing/:addOn/…` route keeps, the add-on kit's own
 * (`routes/add-ons/kit.ts`, `installs/resolve.ts`).
 *
 *  - the `X-Adminium-Install: <install id>` header, which the add-on's page
 *    client sends on every call;
 *  - else `?connectionId=` (the install on that database);
 *  - else the key's only install. With several and nothing naming one, the
 *    answer is `409 APP_INSTALL_AMBIGUOUS`, listing the installs this person
 *    reaches: never the first one found.
 *
 * Null when the key has no install there (the route answers 404).
 */
import type { InstalledManifest, MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { installReachOf } from '../installs/reach.js';
import { installsOf, resolveInstall, selectorOf } from '../installs/resolve.js';

export async function landingInstallOf(meta: MetaDb, request: FastifyRequest, key: string): Promise<InstalledManifest | null> {
  const connectionNames = async (): Promise<Map<string, string>> => new Map((await meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute()).map((row) => [row.id, row.name]));
  return resolveInstall(installsOf(meta), key, selectorOf(request), { kind: 'add-on', connectionNames, reaches: installReachOf(meta, request) });
}
