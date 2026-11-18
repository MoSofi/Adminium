// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "PER VISITOR": the visitor's cookie, its keyed hash, the banner's words and
 * what a stranger's page is told about it.
 *
 * Only on Adminium's own pages (a form's own page, a landing page) on the
 * install's address or a mapped pages host: never in a frame on another
 * website, never at "Counts only" or Off, never before "yes".
 *
 * ─── THE COOKIE ────────────────────────────────────────────────────────────
 * `__Secure-adm_v`: host-only (no Domain, so never a sibling tenant's or the
 * dashboard host's), `Path=/x/` (never sent to the dashboard's own routes),
 * HttpOnly (no script reads it), Secure, `SameSite=Lax` (never sent from a
 * frame on another site), at most {@link VISITOR_COOKIE_MAX_AGE_S} (about six
 * months: then the banner asks again). It holds a random 128-bit value, and
 * only a keyed hash of that value is stored ({@link visitorIdOf}): the
 * cookie alone names nobody, the table alone opens no browser.
 *
 * A plain-http address (a developer's own machine) cannot set a `__Secure-`
 * cookie: there it is `adm_v`, without Secure, everything else the same.
 * The door is closed to strangers on such an address anyway (it needs a
 * public https address), so only a developer's test ever sees it.
 *
 * "No" is kept in the visitor's browser alone (`adm.x.choice`), never here.
 *
 * ─── THE BANNER'S WORDS ────────────────────────────────────────────────────
 * The engine's default in eight languages (`x:banner.*`), or the owner's
 * version per language (`privacy.banner`; a field left empty keeps the
 * default). The words shown carry a version, a hash of them, which the
 * visitor's row keeps with the "yes": the proof of what they agreed to.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

import { localeFromTag } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import { BANNER_LOCALES, settingsRepo, visitorsRepo, type BannerLocale, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { deriveKey } from '../config/secrets.js';
import { storedPublicOrigin } from '../email/door-reach.js';
import { loadOverrideMap } from '../i18n/server-i18n.js';
import { normalizeHost } from '../security/csrf.js';
import type { TrackingLevel } from './counter.js';

/** The cookie's name on an https address, and on a plain-http one. */
export const VISITOR_COOKIE = '__Secure-adm_v';
export const VISITOR_COOKIE_PLAIN = 'adm_v';
/** How long the cookie lives: 180 days, under six months. */
export const VISITOR_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;
/** Where the cookie is sent: the stranger's pages only. */
export const VISITOR_COOKIE_PATH = '/x/';

/** The banner's words in one language, and their version. */
export interface BannerShown {
  /** The language they are in (one of the eight). */
  language: BannerLocale;
  title: string;
  text: string;
  yes: string;
  no: string;
  /** A hash of the words: what a "yes" is kept with. */
  version: string;
}

/** What a stranger's own page is told about "Per visitor" (absent: say nothing, show nothing). */
export interface VisitorBlock {
  banner: BannerShown;
  /** `yes` when the cookie names a visitor still kept; null when no choice is kept here. */
  said: 'yes' | null;
}

/** The key the cookie's value is hashed under: its own, from the server's secret. */
export function visitorKey(secret: string): Buffer {
  return deriveKey(secret, 'adminium-visitor-v1', 'adminium:visitor');
}

/** Whether the request came over https (as this server sees it, behind a trusted proxy too). */
function secureOf(request: Pick<FastifyRequest, 'protocol'>): boolean {
  return request.protocol === 'https';
}

/** The cookie's name for this request's address. */
export function visitorCookieName(request: Pick<FastifyRequest, 'protocol'>): string {
  return secureOf(request) ? VISITOR_COOKIE : VISITOR_COOKIE_PLAIN;
}

/** One cookie's value from the request's `Cookie` header, or null. */
function cookieValue(header: string | string[] | undefined, name: string): string | null {
  const text = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      return /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : null;
    }
  }
  return null;
}

/** The visitor the request's cookie names (a keyed hash of its value), or null when it carries none. */
export function visitorIdOf(key: Buffer, request: Pick<FastifyRequest, 'headers' | 'protocol'>): string | null {
  const value = cookieValue(request.headers.cookie, visitorCookieName(request));
  return value === null ? null : createHmac('sha256', key).update(value).digest('hex');
}

/** A new visitor: the cookie's random value and the id kept for it. */
export function newVisitor(key: Buffer): { value: string; id: string } {
  const value = randomBytes(16).toString('base64url');
  return { value, id: createHmac('sha256', key).update(value).digest('hex') };
}

/** Sets the visitor's cookie on a reply. */
export function setVisitorCookie(request: Pick<FastifyRequest, 'protocol'>, reply: FastifyReply, value: string): void {
  const secure = secureOf(request) ? '; Secure' : '';
  void reply.header('set-cookie', `${visitorCookieName(request)}=${value}; Path=${VISITOR_COOKIE_PATH}; Max-Age=${String(VISITOR_COOKIE_MAX_AGE_S)}; HttpOnly; SameSite=Lax${secure}`);
}

/** Clears the visitor's cookie. */
export function clearVisitorCookie(request: Pick<FastifyRequest, 'protocol'>, reply: FastifyReply): void {
  const secure = secureOf(request) ? '; Secure' : '';
  void reply.header('set-cookie', `${visitorCookieName(request)}=; Path=${VISITOR_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

/**
 * Whether the request is on one of the install's own addresses: the public
 * address's host, or a host mapped to the add-on pages. Anything else (a
 * host an app's side is mapped to, a name the server merely answers on) is
 * no page of Adminium's own, and asks nothing.
 */
export async function ownPagesHost(meta: MetaDb, request: Pick<FastifyRequest, 'host'>): Promise<boolean> {
  const host = normalizeHost(request.host);
  const origin = await storedPublicOrigin(meta);
  if (origin !== null && normalizeHost(new URL(origin).host) === host) return true;
  const pageHosts = await settingsRepo(meta).get('surfaces.pageHosts');
  return Object.keys(pageHosts).some((mapped) => normalizeHost(mapped) === host);
}

/** The banner's language for a page's language tag: that one of the eight, else English. */
export function bannerLocaleOf(tag: string | null | undefined): BannerLocale {
  const wanted = (tag ?? '').toLowerCase();
  return BANNER_LOCALES.find((one) => one.toLowerCase() === wanted) ?? BANNER_LOCALES.find((one) => one.slice(0, 2).toLowerCase() === wanted.slice(0, 2)) ?? 'en-US';
}

/** The engine's default banner words, in English (each language has its own under `x:banner.*`). */
export const BANNER_DEFAULT = {
  title: 'Can we remember your visit?',
  text: 'If you say yes, we remember which of our pages you look at, and if you then send us a form, we keep that with your message so we can answer you better. Nothing about your visit is remembered if you say no.',
  yes: 'Yes',
  no: 'No',
} as const;

/** The engine's default banner words in a language (the install's own translations of them included). */
export async function defaultBannerWords(meta: MetaDb, language: BannerLocale): Promise<{ title: string; text: string; yes: string; no: string }> {
  const locale = localeFromTag(language);
  const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
  const t = (key: keyof typeof BANNER_DEFAULT): string => i18n.t(`x:banner.${key}`, { defaultValue: BANNER_DEFAULT[key] });
  return { title: t('title'), text: t('text'), yes: t('yes'), no: t('no') };
}

/** The banner's words in a language as shown now: the owner's, field by field, over the engine's default. */
export async function bannerWords(meta: MetaDb, language: BannerLocale): Promise<BannerShown> {
  const base = await defaultBannerWords(meta, language);
  const own = (await settingsRepo(meta).get('privacy.banner'))?.[language] ?? {};
  const words = { title: own.title ?? base.title, text: own.text ?? base.text, yes: own.yes ?? base.yes, no: own.no ?? base.no };
  const version = `w-${createHash('sha256').update(JSON.stringify([language, words.title, words.text, words.yes, words.no])).digest('hex').slice(0, 24)}`;
  return { language, ...words, version };
}

export interface VisitorBlockDeps {
  meta: MetaDb;
  /** The level as the counter holds it. */
  level: () => TrackingLevel;
  /** The visitor key ({@link visitorKey}). */
  key: Buffer;
  /** Whether a visitor is still kept (`visitorsRepo.find`). */
  kept: (id: string) => Promise<boolean>;
}

/**
 * What a stranger's own page is told about "Per visitor", for the reply of
 * its data read: nothing at all below "Per visitor", in a frame, or off the
 * install's own addresses; else the banner's words in the page's language,
 * and whether this browser's cookie names a visitor still kept. A door
 * spreads it into its reply as `visitor`.
 */
export async function visitorBlockFor(deps: VisitorBlockDeps, request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>, opts: { language: string | null; framed: boolean }): Promise<{ visitor?: VisitorBlock }> {
  if (deps.level() !== 'visitor' || opts.framed) return {};
  try {
    if (!(await ownPagesHost(deps.meta, request))) return {};
    const id = visitorIdOf(deps.key, request);
    const said = id !== null && (await deps.kept(id)) ? ('yes' as const) : null;
    return { visitor: { banner: await bannerWords(deps.meta, bannerLocaleOf(opts.language)), said } };
  } catch {
    // Nothing about a visitor is worth a page that does not draw.
    return {};
  }
}

/** "Per visitor" as a door uses it. */
export interface VisitorDoor {
  /** The key the cookie's value is hashed under. */
  key: Buffer;
  /** What a stranger's own page is told ({@link visitorBlockFor}). */
  block(request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>, opts: { language: string | null; framed: boolean }): Promise<{ visitor?: VisitorBlock }>;
  /** The visitor the request's cookie names, read only at "Per visitor": null otherwise. */
  idOf(request: Pick<FastifyRequest, 'headers' | 'protocol'>): string | null;
  /**
   * A form sent with the visitor's cookie, on the install's own page: the
   * answer's address, as the address keys hash it, joined onto the visitor.
   * Never throws: a join that fails leaves the answer as it is.
   */
  join(request: Pick<FastifyRequest, 'headers' | 'protocol'>, email: string): Promise<void>;
}

export interface VisitorDoorDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`: the visitor key's source, and the address keys'. */
  secret: string;
  /** The level as the counter holds it. */
  level: () => TrackingLevel;
  /** The address under the newest key version (`consent/keys.ts` `addressKeyRing(...).hashForWrite`). */
  hashForWrite: (address: string) => Promise<{ hash: string; version: number }>;
}

export function createVisitorDoor(deps: VisitorDoorDeps): VisitorDoor {
  const key = visitorKey(deps.secret);
  const visitors = visitorsRepo(deps.meta);
  const idOf = (request: Pick<FastifyRequest, 'headers' | 'protocol'>): string | null => (deps.level() === 'visitor' ? visitorIdOf(key, request) : null);
  return {
    key,
    block: (request, opts) => visitorBlockFor({ meta: deps.meta, level: deps.level, key, kept: async (id) => (await visitors.find(id)) !== null }, request, opts),
    idOf,
    async join(request, email) {
      try {
        const id = idOf(request);
        if (id === null || (await visitors.find(id)) === null) return;
        await visitors.join(id, await deps.hashForWrite(email));
      } catch {
        // The answer stands whatever happens to the join.
      }
    },
  };
}
