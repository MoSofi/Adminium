// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which install a request, a job or a row means.
 *
 * The same app or add-on may be installed once per database. An install is
 * one `adminium_manifests` row; its id is the install id. A key alone no
 * longer names one install, so nothing finds "the install" by key: it picks
 * the install FIRST, from a selector, and only then checks that install's
 * grant. There is no fallback from a selector to another install.
 *
 * Selectors, one per request:
 *  - the `X-Adminium-Install: <install id>` header (the dashboard's app
 *    frame and add-on page client, and a side's runtime from its
 *    `surface-config.json`). A side sends its own install's id on every
 *    call, add-on routes included: a header naming an install of another
 *    key means this key's install on that install's database (or the
 *    server-wide one). The caller's grants are then asked of that install;
 *    the header opens nothing by itself;
 *  - an address `<key>~<slug>` in the path (a later install's), where the
 *    bare `<key>` is the install that owns the bare addresses;
 *  - `?connectionId=` (the dashboard, for a database's own install);
 *  - on `/public/*`, the presented key's scope connection (a public route
 *    never answers 409).
 * Never the Referer.
 *
 * With several installs and no selector, a key-only route answers
 * `409 APP_INSTALL_AMBIGUOUS` listing them. A caller with no request (the
 * outbox, documents, jobs) carries the install id on its rows and payloads
 * and fails loudly when it is missing.
 */
import { createHash } from 'node:crypto';

import { BARE_SLUG, SERVER_SCOPE, manifestsRepo, type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';

import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';

export const INSTALL_HEADER = 'x-adminium-install';

/** `<key>~<slug>`: the separator of a later install's address. */
export const INSTALL_SLUG_SEPARATOR = '~';

/** At most this many installs of one key (one per database). */
export const MAX_INSTALLS_PER_KEY = 32;

/** The manifests repo for reading installs: it never touches a credential, so it is given no key. */
export function installsOf(meta: MetaDb): ManifestsRepo {
  const refuse = (): never => {
    throw new Error('reading installs never needs a credential');
  };
  return manifestsRepo(meta, { encrypt: refuse, decrypt: refuse });
}

/** One install, as the things it owns are named by: its id, key and address slug. */
export interface InstallAddress {
  id: string;
  key: string;
  /** `''` = the bare addresses. */
  slug: string;
}

export function addressOf(install: InstalledManifest | InstalledManifest['row']): InstallAddress {
  const row = 'row' in install ? install.row : install;
  return { id: row.id, key: row.manifestKey, slug: row.instanceSlug };
}

/** The bare install's address, for a key installed once (a project app, a test). */
export function bareAddress(id: string, key: string): InstallAddress {
  return { id, key, slug: BARE_SLUG };
}

/** `adminium_roles.slug` is `str(40)`. */
const ROLE_SLUG_LIMIT = 40;

/**
 * The slug of an app role for one install: `<key>-<role>` for the bare
 * install, `<key>-<slug>-<role>` for a later one, cut and ended with a
 * 6-character hash of all three when that is over 40 — so two installs never
 * share a role, and the slug still fits its column.
 */
export function installRoleSlug(key: string, roleKey: string, slug: string): string {
  const whole = slug === BARE_SLUG ? `${key}-${roleKey}` : `${key}-${slug}-${roleKey}`;
  if (slug === BARE_SLUG || whole.length <= ROLE_SLUG_LIMIT) return whole;
  const hash = createHash('sha256').update(`${key}~${slug}:${roleKey}`).digest('hex').slice(0, 6);
  return `${whole.slice(0, ROLE_SLUG_LIMIT - 7).replace(/-+$/g, '')}-${hash}`;
}

/**
 * The key a managed email template is stored under for one install. Keys stay
 * unique by (key, locale), so a later install's are its own: the slug goes
 * after the app key (`invoices-reminder` → `invoices-kiln-reminder`), cut to
 * the column's 80. The bare install keeps the key the manifest wrote.
 */
export function installTemplateKey(templateKey: string, install: Pick<InstallAddress, 'key' | 'slug'>): string {
  if (install.slug === BARE_SLUG) return templateKey;
  const head = `${install.key}-`;
  const rest = templateKey.startsWith(head) ? templateKey.slice(head.length) : templateKey;
  return `${head}${install.slug}-${rest}`.slice(0, 80);
}

/**
 * An add-on kept once per server: one that says so (`addOn.scope: "server"`),
 * or a payment provider (two businesses share one provider account) until its
 * manifest says so itself. Every other add-on installs per database.
 */
export function addOnIsServerWide(manifest: unknown): boolean {
  const addOn = (manifest as { addOn?: { scope?: unknown; provides?: unknown } } | null)?.addOn;
  if (addOn === undefined || addOn === null || typeof addOn !== 'object') return false;
  if (addOn.scope === 'server') return true;
  return Array.isArray(addOn.provides) && addOn.provides.some((entry) => (entry as { contract?: unknown } | null)?.contract === 'payment-provider');
}

/**
 * The install a request was resolved to, kept for its handler: a guard
 * resolves it before it checks the grant, and the handler acts on that same
 * install rather than resolving again.
 */
const resolved = new WeakMap<object, InstalledManifest>();
export function rememberInstall(request: object, install: InstalledManifest): void {
  resolved.set(request, install);
}
export function rememberedInstall(request: object): InstalledManifest | undefined {
  return resolved.get(request);
}

/** What a request (or a caller) says about which install it means. */
export interface InstallSelector {
  /** An install id, from the header or a row. */
  installId?: string | undefined;
  /**
   * The install id came from the `X-Adminium-Install` header. A side sends
   * its own install's id on every call, so a header naming an install of
   * another key names that install's database: the key's install there (or
   * its server-wide one). An id from a row or a body stays exact.
   */
  fromHeader?: boolean | undefined;
  /** The address slug: `''` = the bare install. */
  slug?: string | undefined;
  /** A database: its install of the key, or a server-wide one. */
  connectionId?: string | undefined;
}

/** A key as an address names it: `invoices` or `invoices~kiln`. */
export function splitInstallKey(param: string): { key: string; slug: string | undefined } {
  const at = param.indexOf(INSTALL_SLUG_SEPARATOR);
  if (at < 0) return { key: param, slug: undefined };
  return { key: param.slice(0, at), slug: param.slice(at + 1) };
}

/**
 * The key a grant names for an install: the bare key for the install that
 * owns the bare addresses, `<key>~<slug>` for a later one
 * (`app:invoices~kiln:staff`, `addOn:invoices~kiln:settings`).
 */
export function grantKeyOf(install: Pick<InstalledManifest['row'], 'manifestKey' | 'instanceSlug'>): string {
  return install.instanceSlug === BARE_SLUG ? install.manifestKey : `${install.manifestKey}${INSTALL_SLUG_SEPARATOR}${install.instanceSlug}`;
}

/** The selector a request carries: the header, a `~slug` in the key param, and `?connectionId=`. */
export function selectorOf(request: { headers: Record<string, unknown>; query?: unknown }, keyParam?: string): InstallSelector {
  const header = request.headers[INSTALL_HEADER];
  const installId = typeof header === 'string' && header.length > 0 ? header : undefined;
  const query = (request.query ?? {}) as Record<string, unknown>;
  const connectionId = typeof query['connectionId'] === 'string' && query['connectionId'].length > 0 ? query['connectionId'] : undefined;
  const slug = keyParam === undefined ? undefined : splitInstallKey(keyParam).slug;
  return { installId, ...(installId === undefined ? {} : { fromHeader: true }), slug, connectionId };
}

export interface AmbiguousInstall {
  installId: string;
  connectionId: string | null;
  connectionName: string | null;
  slug: string;
}

/**
 * `409 APP_INSTALL_AMBIGUOUS`: several installs, nothing naming which.
 *
 * `installs` are the ones the caller may be told of (each is listed, by its
 * database); `total` is how many there are in all, which the sentence counts
 * truthfully without naming the others. Absent, they are the same.
 */
export function ambiguousInstall(key: string, installs: readonly InstalledManifest[], names: ReadonlyMap<string, string> = new Map(), total: number = installs.length): ConflictError {
  const list: AmbiguousInstall[] = installs.map((install) => ({
    installId: install.row.id,
    connectionId: install.row.scopeKey === SERVER_SCOPE ? null : install.row.scopeKey,
    connectionName: install.row.scopeKey === SERVER_SCOPE ? null : (names.get(install.row.scopeKey) ?? null),
    slug: install.row.instanceSlug,
  }));
  const yours = installs.length === total ? '' : ` (${installs.length} of them ${installs.length === 1 ? 'is' : 'are'} yours to open)`;
  return new ConflictError(`${key} is installed on ${total} databases${yours}. Say which one: send X-Adminium-Install or ?connectionId=.`, 'APP_INSTALL_AMBIGUOUS', {
    key,
    installedOn: total,
    installs: list,
  });
}

export interface ResolveOptions {
  /** `app` or `add-on`: an install of the other kind is not this one. */
  kind?: 'app' | 'add-on';
  /** Connection names for the ambiguity's details. Read only after `reaches` has cut the list. */
  connectionNames?: () => Promise<ReadonlyMap<string, string>>;
  /**
   * Which of several installs the caller may reach (`installs/reach.ts`).
   * Asked only when there are several and nothing names which, and before
   * anything is named: the 409 lists only these. A request-facing route
   * passes it; a caller with no person behind it does not.
   */
  reaches?: (install: InstalledManifest) => boolean | Promise<boolean>;
  /**
   * What a caller who reaches none of the installs is told: the route's own
   * refusal. Absent, the key reads as not installed where it asked (null, or
   * the 404 of `requireInstall`).
   */
  unreached?: () => Error;
}

/**
 * The installs of `key` a selector names, without deciding between several:
 * one install for a precise selector; every install when there is none.
 */
async function candidates(manifests: ManifestsRepo, key: string, selector: InstallSelector): Promise<InstalledManifest[]> {
  const given = [selector.installId, selector.slug, selector.connectionId].filter((one) => one !== undefined);
  const picks: (InstalledManifest | null)[] = [];
  if (selector.installId !== undefined) {
    const byId = await manifests.findById(selector.installId);
    if (byId === null) picks.push(null);
    else if (byId.row.manifestKey === key) picks.push(byId);
    // A side's own install (an app's, sent on every call): this key's install on that database, or its server-wide one.
    // Only the header is read so; who may act on the install found is still asked of that install.
    else picks.push(selector.fromHeader === true ? await installOnConnection(manifests, key, byId.row.scopeKey) : null);
  }
  if (selector.slug !== undefined) picks.push(await manifests.findBySlug(key, selector.slug));
  if (selector.connectionId !== undefined) {
    picks.push((await manifests.findInScope(key, selector.connectionId)) ?? (await manifests.findInScope(key, SERVER_SCOPE)));
  }
  if (given.length === 0) return manifests.listByKey(key);
  const ids = new Set(picks.map((pick) => pick?.row.id ?? null));
  // Two selectors naming two installs is a client mistake, never a pick.
  if (ids.size > 1) throw new ValidationFailedError('The request names more than one install. Send one of X-Adminium-Install, an address or ?connectionId=.', { key });
  const one = picks[0] ?? null;
  return one === null ? [] : [one];
}

/**
 * The one install a request means, or `null` when the key is not installed
 * where it asked. Several installs and no selector: `APP_INSTALL_AMBIGUOUS`.
 */
export async function resolveInstall(manifests: ManifestsRepo, key: string, selector: InstallSelector, options: ResolveOptions = {}): Promise<InstalledManifest | null> {
  const found = (await candidates(manifests, key, selector)).filter((install) => options.kind === undefined || install.row.kind === options.kind);
  if (found.length <= 1) return found[0] ?? null;
  // Authorised before anything is named: only the installs this caller reaches are listed.
  const reached: InstalledManifest[] = [];
  for (const install of found) if (options.reaches === undefined || (await options.reaches(install))) reached.push(install);
  if (reached.length === 0) {
    if (options.unreached !== undefined) throw options.unreached();
    return null;
  }
  throw ambiguousInstall(key, reached, (await options.connectionNames?.()) ?? new Map(), found.length);
}

/** `resolveInstall`, with a 404 for none. */
export async function requireInstall(manifests: ManifestsRepo, key: string, selector: InstallSelector, options: ResolveOptions = {}): Promise<InstalledManifest> {
  const found = await resolveInstall(manifests, key, selector, options);
  if (found === null) throw new NotFoundError(`${key} is not installed${selector.connectionId === undefined ? '' : ' on that database'}.`);
  return found;
}

/**
 * The install a database uses for a key: its own, else a server-wide one.
 * For a public request (the key's scope connection) and for anything that
 * already knows its database. Never ambiguous: one per scope.
 */
export async function installOnConnection(manifests: ManifestsRepo, key: string, connectionId: string): Promise<InstalledManifest | null> {
  return (await manifests.findInScope(key, connectionId)) ?? (await manifests.findInScope(key, SERVER_SCOPE));
}

/**
 * The version and status of the add-on install a database uses: its own, else
 * the one kept once per server. Each copy's status is its own: another copy
 * updating, stopped or switched off says nothing of this one.
 */
export async function addOnStateOn(meta: MetaDb, key: string, connectionId: string): Promise<{ version: string; status: string } | null> {
  const on = (scopeKey: string) =>
    meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).where('kind', '=', 'add-on').where('scopeKey', '=', scopeKey).executeTakeFirst();
  const row = (await on(connectionId)) ?? (await on(SERVER_SCOPE));
  return row === undefined ? null : { version: row.version, status: row.status };
}

/**
 * The install a caller with no database means: the one kept once per server,
 * else the key's only install. With several and none server-wide there is no
 * answer, and null says so: never the first of them.
 */
export async function serverWideOrOnly(manifests: Pick<ManifestsRepo, 'findInScope' | 'listByKey'>, key: string): Promise<InstalledManifest | null> {
  const server = await manifests.findInScope(key, SERVER_SCOPE);
  if (server !== null) return server;
  const all = await manifests.listByKey(key);
  return all.length === 1 ? all[0]! : null;
}

/**
 * The install a row or a job payload names. A payload written before installs
 * were per database carries none: it means the key's only install, and with
 * several there is no answer — it fails loudly instead of picking one.
 */
export async function installOfRecord(manifests: ManifestsRepo, key: string, installId: string | null | undefined): Promise<InstalledManifest | null> {
  if (installId !== undefined && installId !== null) {
    const found = await manifests.findById(installId);
    return found !== null && found.row.manifestKey === key ? found : null;
  }
  const all = await manifests.listByKey(key);
  if (all.length > 1) throw ambiguousInstall(key, all);
  return all[0] ?? null;
}

/**
 * The slug a later install of `key` gets: the connection's name, lower-cased,
 * ASCII-folded, `_` → `-`, cut to 32; `-2`, `-3`… on a clash; never a side's
 * name (`staff`, `customer`); `db-<n>` when nothing of the name is left.
 * Made once at install and never changed.
 */
export function slugForInstall(connectionName: string, taken: ReadonlySet<string>): string {
  const folded = connectionName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  const reserved = new Set(['staff', 'customer']);
  const free = (slug: string) => slug.length > 0 && !reserved.has(slug) && !taken.has(slug);
  const base = folded.length === 0 || reserved.has(folded) ? '' : folded;
  if (base !== '' && free(base)) return base;
  for (let n = 2; n <= MAX_INSTALLS_PER_KEY + 1; n += 1) {
    const stem = base === '' ? `db-${n - 1}` : `${base.slice(0, 32 - String(n).length - 1).replace(/-+$/g, '')}-${n}`;
    if (free(stem)) return stem;
  }
  throw new ValidationFailedError(`No address is left for another install of this app (at most ${MAX_INSTALLS_PER_KEY}).`);
}
