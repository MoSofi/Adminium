// SPDX-License-Identifier: AGPL-3.0-only
/**
 * People who open an app's own screens and never the dashboard — a till's
 * cashier: every role they hold is screens-only.
 *
 * The dashboard answers them with 403 `APP_SCREENS_ONLY` and where their
 * screens are, and every other API call is refused except what those screens
 * need: signing in and out, their own account, the records their roles grant,
 * the live-update stream, the translations, and the schema of their app's own
 * database. Forty-odd routes check only that someone is signed in, so this
 * list — not those routes — is the boundary.
 */
import type { FastifyRequest } from 'fastify';
import type { MetaDb } from '@adminium/meta';

import { ForbiddenError } from '../errors.js';
import { connectionForMount, type SurfaceSettings } from '../surfaces/settings.js';

const API = '/api/v1';

/** Where an app's staff screens open: its mapped staff address, else its own mount. */
export function staffOpenUrl(settings: SurfaceSettings, appKey: string, protocol: string): string {
  const host = Object.entries(settings.domains).find(
    ([, target]) => target.appKey === appKey && target.side === 'staff' && target.instance === undefined,
  )?.[0];
  return host === undefined ? `/apps/${appKey}/staff/` : `${protocol}://${host}/`;
}

/** The databases a screens-only person's apps read: each app's own, or its install's. */
export async function appConnections(meta: MetaDb, settings: SurfaceSettings, appKeys: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (appKeys.length === 0) return out;
  for (const key of appKeys) {
    const own = connectionForMount(settings, key, null);
    if (own !== null) out.add(own);
  }
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select('connectionId')
    .where('kind', '=', 'app')
    .where('manifestKey', 'in', [...appKeys])
    .execute();
  for (const row of rows) if (row.connectionId !== null) out.add(row.connectionId);
  return out;
}

/**
 * Whether a screens-only person may make this API call, judged by the ROUTE
 * it matched (`/api/v1/connections/:id/schema`) and its decoded parameters —
 * never by the request line, which can spell the same route another way
 * (`/%61pi/v1/roles`, or the absolute form `GET http://host/api/v1/roles`)
 * and would then match no pattern here while still reaching the route.
 */
export function allowedForScreensOnly(method: string, route: string, params: unknown, connections: ReadonlySet<string>): boolean {
  if (!route.startsWith(`${API}/`)) return true;
  const rest = route.slice(API.length);
  if (/^\/(auth|data|i18n)(\/|$)/.test(rest)) return true;
  // The public API has its own gate, and a kiosk's staff-bound key rides it.
  if (rest.startsWith('/public/')) return true;
  if (rest === '/me' || rest.startsWith('/me/')) return true;
  if (rest === '/events') return true;
  const id = (params as { id?: unknown } | null)?.id;
  return method === 'GET' && rest === '/connections/:id/schema' && typeof id === 'string' && connections.has(id);
}

/** The refusal, with where their screens are. */
export function screensOnlyError(settings: SurfaceSettings, appKeys: readonly string[], request: FastifyRequest): ForbiddenError {
  const first = appKeys[0];
  return new ForbiddenError('This account opens its app’s own screens, not the dashboard.', 'APP_SCREENS_ONLY', {
    openUrl: first === undefined ? null : staffOpenUrl(settings, first, request.protocol),
  });
}
