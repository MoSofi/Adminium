// SPDX-License-Identifier: AGPL-3.0-only
/**
 * People who open an app's own screens and never the dashboard — a till's
 * cashier: every role they hold is screens-only.
 *
 * The dashboard answers them with 403 `APP_SCREENS_ONLY` and where their
 * screens are, and every other API call is refused except what those screens
 * need: signing in and out, their own account, the records their roles grant,
 * the live-update stream, the translations, the schema of their app's own
 * database, and what an add-on their app uses says of the rows a screen shows
 * (its stock words). Forty-odd routes check only that someone is signed in, so this
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

/** The route a screen asks an add-on's stock words through. */
export const STAFF_WORDS_ROUTE = `${API}/words/:addOn/:wordsId`;
/** The route a screen looks a scanned or typed code up through. */
export const ADD_ON_LOOK_UP_ROUTE = `${API}/add-ons/:key/look-up`;
/** The route a screen draws an add-on's own document through. */
export const ADD_ON_DOCUMENT_ROUTE = `${API}/add-ons/:key/documents/render`;

/**
 * The add-ons a screens-only person's apps use: connected to one of their
 * apps, and keeping its tables in one of their apps' databases. Switched off
 * for the app or not, the route says what it can of it; an add-on of nobody
 * of theirs is not theirs to ask.
 */
export async function appAddOns(meta: MetaDb, appKeys: readonly string[], connections: ReadonlySet<string>): Promise<Set<string>> {
  const out = new Set<string>();
  if (appKeys.length === 0 || connections.size === 0) return out;
  const rows = await meta.db
    .selectFrom('adminium_manifest_attachments as attachment')
    .innerJoin('adminium_manifests as addOn', 'addOn.id', 'attachment.manifestId')
    .select(['addOn.manifestKey as key', 'addOn.connectionId as connectionId'])
    .where('addOn.kind', '=', 'add-on')
    .where('attachment.attachedTo', 'in', [...appKeys])
    .execute();
  for (const row of rows) if (row.connectionId !== null && connections.has(row.connectionId)) out.add(row.key);
  return out;
}

/**
 * Whether a screens-only person may make this API call, judged by the ROUTE
 * it matched (`/api/v1/connections/:id/schema`) and its decoded parameters —
 * never by the request line, which can spell the same route another way
 * (`/%61pi/v1/roles`, or the absolute form `GET http://host/api/v1/roles`)
 * and would then match no pattern here while still reaching the route.
 */
export function allowedForScreensOnly(
  method: string,
  route: string,
  params: unknown,
  connections: ReadonlySet<string>,
  appKeys: readonly string[] = [],
  addOns: ReadonlySet<string> = new Set(),
  /** Their role holds the assistant's own permission (the caller asks; this stays a pure function). */
  assistant = false,
): boolean {
  if (!route.startsWith(`${API}/`)) return true;
  const rest = route.slice(API.length);
  // The assistant, for a person whose role was given it: asked from their app's own staff address. Its
  // settings stay an administrator's; what it may read is still what this person's role reads, and its
  // own routes keep it to the two kinds of conversation that are theirs (`routes/assistant`).
  if (assistant && rest.startsWith('/assistant/') && rest !== '/assistant/settings') return true;
  if (/^\/(auth|data|i18n)(\/|$)/.test(rest)) return true;
  // Their app's own documents (a folio printed at the desk): drawn, then read and printed. Each route
  // checks the reads a document needs, and a screens-only person holds only their app's grants.
  const key = (params as { key?: unknown } | null)?.key;
  if (method === 'POST' && rest === '/apps/:key/documents/render' && typeof key === 'string' && appKeys.includes(key)) return true;
  if (method === 'GET' && (rest === '/documents/:id/content' || rest === '/documents/:id/print')) return true;
  // What an add-on of their app says of the rows their screen shows. The route still asks that they read the table asked about.
  const addOn = (params as { addOn?: unknown } | null)?.addOn;
  if (method === 'GET' && route === STAFF_WORDS_ROUTE && typeof addOn === 'string' && addOns.has(addOn)) return true;
  // A code scanned or typed at their app's desk, looked up in an add-on of their app. The route answers only from columns they read.
  if (method === 'POST' && route === ADD_ON_LOOK_UP_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // A document of an add-on of their app, drawn at its desk (a gift card printed once, as it is sold). The route checks the reads it needs.
  if (method === 'POST' && route === ADD_ON_DOCUMENT_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // …and the page it prints, by the one-time ticket the render answered.
  if (method === 'GET' && rest === '/documents/print-once/:ticket') return true;
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
