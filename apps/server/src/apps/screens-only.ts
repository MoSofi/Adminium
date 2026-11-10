// SPDX-License-Identifier: AGPL-3.0-only
/**
 * People who open an app's own screens and never the dashboard — a till's
 * cashier: every role they hold is screens-only.
 *
 * The dashboard answers them with 403 `APP_SCREENS_ONLY` and where their
 * screens are, and every other API call is refused except what those screens
 * need: signing in and out, their own account, the records their roles grant,
 * the live-update stream, the translations, the schema of their app's own
 * database, what an add-on their app uses says of the rows a screen shows
 * (its stock words, its record panels and the files a page of it ships), which of their app's own rules are switched on, and
 * bringing a file in to a table their role may import (a "paste a list"
 * screen of their app), and the files a record of theirs keeps (a crew's
 * signature and photos, a copy of one for another record), and a record's e-mail consent (the panel, and recording consent,
 * "Replied" and "They said no" on it), the add-ons connected to their apps, and the server's name and logo to head
 * their screens with, and the code of an add-on of their app that fills a place on those screens. Forty-odd routes check only that someone is signed in, so this
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
export async function appConnections(meta: MetaDb, settings: SurfaceSettings, appKeys: readonly string[], installIds?: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (appKeys.length === 0) return out;
  /*
   * THE INSTALLS THEIR ROLES BELONG TO, when they are known: a Kiln clerk
   * reads Kiln's database, not every database the app is installed on.
   */
  if (installIds !== undefined && installIds.length > 0) {
    const rows = await meta.db.selectFrom('adminium_manifests').select('connectionId').where('kind', '=', 'app').where('id', 'in', [...installIds]).execute();
    for (const row of rows) if (row.connectionId !== null) out.add(row.connectionId);
    return out;
  }
  for (const key of appKeys) {
    const own = connectionForMount(settings, key, null);
    if (own !== null) out.add(own);
  }
  // Roles with no install named (none since installs were per database): the bare install's database.
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select('connectionId')
    .where('kind', '=', 'app')
    .where('manifestKey', 'in', [...appKeys])
    .where('instanceSlug', '=', '')
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
/** The route a screen loads an add-on's record panel through (a design kit's panel on an order line). */
export const ADD_ON_PANEL_BUNDLE_ROUTE = `${API}/add-ons/:key/panels/:id/bundle`;
/** The route a page's own shipped files come through (a design kit's starter fonts, which its record panel draws with too). */
export const ADD_ON_PAGE_FILES_ROUTE = `${API}/add-ons/:key/pages/:ref/files/*`;
/** The route a screen loads an add-on's slot fills through (a carrier's "Book a collection" on the dispatch screen). */
export const ADD_ON_BUNDLE_ROUTE = `${API}/add-ons/:key/bundle/*`;

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

/** The routes of one import, from the upload to the report of what was skipped, and its job's progress. */
const IMPORT_ROUTES: ReadonlySet<string> = new Set([
  'POST /imports/upload',
  'POST /imports',
  'GET /imports/:id',
  'GET /imports/:id/preview',
  'POST /imports/:id/run',
  'GET /imports/:id/error-report',
  'GET /jobs/:id',
]);

/**
 * A file uploaded for a record of a table their role creates or changes (a
 * crew's signature and photos), read back with its record, and thrown away
 * while no record holds it yet — or copied, for such a record, from a file
 * they may read (a photo a past order already has, chosen again). Each route
 * asks the table's own rights and whose the file is (`routes/files`): a copy,
 * the target table's create or update, and the source's read as reading it
 * asks; a file no role of theirs reaches is not there for them. The list of
 * files, their library, renaming and moving them stay the dashboard's.
 */
const FILE_ROUTES: ReadonlySet<string> = new Set(['POST /files', 'GET /files/:id', 'GET /files/:id/content', 'DELETE /files/:id', 'POST /files/:id/copy']);

/**
 * A record's e-mail consent, on a screen of their app (the kit's consent part, an app's own "may be
 * e-mailed" line): the panel, and the three things a person who may change the record records on it.
 * Each route asks the table's read (or update) right and the row inside the person's reach
 * (`routes/consent`), never sends the address back, and is a signed-in person's alone. The
 * install-wide do-not-email list stays the dashboard's.
 */
const CONSENT_ROUTES: ReadonlySet<string> = new Set(['POST /consent/panel', 'POST /consent/record-consent', 'POST /consent/replied', 'POST /consent/said-no']);

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
  // Which of their app's own rules are switched on, for a screen that depends on one. The route asks the app's own staff grant, and says a
  // rule's key, name and switch: nothing of what it does.
  if (method === 'GET' && rest === '/apps/:key/rules' && typeof key === 'string' && appKeys.includes(key)) return true;
  // What an add-on of their app says of the rows their screen shows. The route still asks that they read the table asked about.
  const addOn = (params as { addOn?: unknown } | null)?.addOn;
  if (method === 'GET' && route === STAFF_WORDS_ROUTE && typeof addOn === 'string' && addOns.has(addOn)) return true;
  // A code scanned or typed at their app's desk, looked up in an add-on of their app. The route answers only from columns they read.
  if (method === 'POST' && route === ADD_ON_LOOK_UP_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // A document of an add-on of their app, drawn at its desk (a gift card printed once, as it is sold). The route checks the reads it needs.
  if (method === 'POST' && route === ADD_ON_DOCUMENT_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // A record panel of an add-on of their app, shown on a screen of their app (a design kit's panel on an order line). The
  // route serves its code only for a row they reach, with a grant on the panel's table and the panel's own permission.
  if (method === 'GET' && route === ADD_ON_PANEL_BUNDLE_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // A file shipped beside a page of an add-on of their app (a starter font its panel draws a proof with). The route serves it
  // only to who holds the page's own permission, which their app's role gives where it grants the page.
  if (method === 'GET' && route === ADD_ON_PAGE_FILES_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // The code of an add-on of their app that fills a place on their app's screens (DHL's "Book a collection" on the
  // dispatch screen). The route serves them only a file that fills a slot of the staff screens, the files their list names.
  if (method === 'GET' && route === ADD_ON_BUNDLE_ROUTE && typeof key === 'string' && addOns.has(key)) return true;
  // Which add-ons their apps have (a counter's screen offers "Book a collection" once DHL is there). The route tells a
  // screens-only person of the add-ons connected to their apps alone, never their settings' values or secrets.
  if (method === 'GET' && rest === '/add-ons') return true;
  // …and the page it prints, by the one-time ticket the render answered.
  if (method === 'GET' && rest === '/documents/print-once/:ticket') return true;
  // A file brought in to a table of their app, from a screen of their app (the kit's import part). Each of these
  // routes asks the table's own import right (and its read and update rights where the import matches or changes
  // rows), which a screens-only person holds only where their app's role grants it; an import and its job are
  // shown to whoever made them. The list of imports, and every other route of the jobs, stay the dashboard's.
  if (IMPORT_ROUTES.has(`${method} ${rest}`)) return true;
  if (FILE_ROUTES.has(`${method} ${rest}`)) return true;
  if (CONSENT_ROUTES.has(`${method} ${rest}`)) return true;
  // The public API has its own gate, and a kiosk's staff-bound key rides it.
  if (rest.startsWith('/public/')) return true;
  if (rest === '/me' || rest.startsWith('/me/')) return true;
  // The server's own name and logo, read only: what their screens head with (a packer's sign-out bar). The same two say
  // nothing a sign-in page does not; changing them stays the dashboard's.
  if (method === 'GET' && (rest === '/branding' || rest === '/branding/logo')) return true;
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
