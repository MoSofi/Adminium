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
 * `__Host-adm_v`: host-only and `Path=/` (the prefix forbids a `Domain`, so a
 * sibling host under the same name can never plant one), HttpOnly (no script
 * reads it), Secure, `SameSite=Lax` (never sent from a frame on another
 * site), at most {@link VISITOR_COOKIE_MAX_AGE_S} (about six months: then the
 * banner asks again). Every staff route ignores it. Its value is a random
 * 128-bit part, the moment of the "yes" and the banner's wording version,
 * signed under the visitor key ({@link readVisitorValue}): a value this
 * server did not make names nobody. Only a keyed hash of the value is
 * stored: the cookie alone names nobody, the table alone opens no browser.
 *
 * A "yes" stores nothing but the cookie. The visitor's row (the proof of the
 * yes) is written with their first counted view of the install's own page,
 * within {@link VISITOR_PENDING_MS} of the yes, at most
 * {@link NEW_VISITORS_PER_ADDRESS_DAY} new ones per network address a day
 * ({@link createVisitorDoor}'s `admit`): a script that says yes and reads
 * nothing leaves nothing behind.
 *
 * A plain-http address (a developer's own machine) cannot set a `__Host-`
 * cookie: there it is `adm_v`, without Secure, on `Path=/x/`. The door is
 * closed to strangers on such an address anyway (it needs a public https
 * address), so only a developer's test ever sees it.
 *
 * "No" is kept in the visitor's browser alone (`adm.x.choice`), never here.
 *
 * ─── THE BANNER'S WORDS ────────────────────────────────────────────────────
 * The engine's default in eight languages (`x:banner.*`), or the owner's
 * version per language (`privacy.banner`; a field left empty keeps the
 * default). The words shown carry a version, a hash of them, which the
 * visitor's row keeps with the "yes": the proof of what they agreed to.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { localeFromTag } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import { BANNER_LOCALES, settingsRepo, visitorsRepo, type BannerLocale, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { deriveKey } from '../config/secrets.js';
import { storedPublicOrigin } from '../email/door-reach.js';
import { loadOverrideMap } from '../i18n/server-i18n.js';
import { normalizeHost } from '../security/csrf.js';
import type { TrackingLevel } from './level.js';

/** The cookie's name on an https address, and on a plain-http one. */
export const VISITOR_COOKIE = '__Host-adm_v';
export const VISITOR_COOKIE_PLAIN = 'adm_v';
/** How long the cookie lives: 180 days, under six months. */
export const VISITOR_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;
/** Where the cookie is sent: the whole host, as a `__Host-` cookie must say (every staff route ignores it). */
export const VISITOR_COOKIE_PATH = '/';
/** On a plain-http address (a developer's own machine): the stranger's pages only. */
export const VISITOR_COOKIE_PATH_PLAIN = '/x/';
/**
 * How long a "yes" waits for its first counted view: until then nothing of it
 * is stored but the cookie. A cookie older than this whose visitor is not
 * kept (never seen, withdrawn, erased, deleted going down) names nobody.
 */
export const VISITOR_PENDING_MS = 60 * 60_000;
/** The most new visitors one network address (an IPv4 address, an IPv6 /64) brings in a day. */
export const NEW_VISITORS_PER_ADDRESS_DAY = 20;
/** The most new visitors one IPv6 /48 brings in a day: ten times an address's. */
export const NEW_VISITORS_PER_48_DAY = 10 * NEW_VISITORS_PER_ADDRESS_DAY;

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
  /** `yes` when the cookie names a visitor still kept (or a "yes" still waiting for its first view); null when no choice is kept here. */
  said: 'yes' | null;
}

/** The key the cookie's value is hashed and signed under: its own, from the server's secret. */
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

/**
 * A visitor as their cookie proves them: the id kept for them, and the "yes"
 * the cookie carries (when, to which words). Only a value this server made
 * proves anything ({@link readVisitorValue}).
 */
export interface VisitorProof {
  /** The keyed hash of the cookie's value: the visitor row's id. */
  id: string;
  saidYesAt: number;
  wordingVersion: string;
}

/*
 * The cookie's value: 16 random bytes, the moment of the "yes" (6 bytes, ms),
 * the banner's wording version (its 12 bytes), then a MAC of those under the
 * visitor key (16 bytes), as base64url: 67 characters. A value planted from
 * a sibling host, made up, or changed by a byte fails the MAC and names
 * nobody; a value is never stored, only its keyed hash.
 */
const RANDOM_BYTES = 16;
const AT_BYTES = 6;
const WORDING_BYTES = 12;
const MAC_BYTES = 16;
const BODY_BYTES = RANDOM_BYTES + AT_BYTES + WORDING_BYTES;
const VALUE_BYTES = BODY_BYTES + MAC_BYTES;
/** The cookie's value as text: exactly what {@link VALUE_BYTES} make in base64url. */
const VALUE_TEXT = /^[A-Za-z0-9_-]{67}$/;
/** A wording version as `bannerWords` makes it. */
const WORDING = /^w-([0-9a-f]{24})$/;

function macOf(key: Buffer, body: Buffer): Buffer {
  return createHmac('sha256', key).update('adm_v1').update(body).digest().subarray(0, MAC_BYTES);
}

/** The id kept for a cookie's value: its keyed hash. */
function idOfValue(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** What a cookie's value proves, or null for a value this server did not make. */
export function readVisitorValue(key: Buffer, value: string): VisitorProof | null {
  if (!VALUE_TEXT.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  // Only the one spelling of the bytes: another (its last character's spare bits set) would be another id for the same "yes".
  if (bytes.length !== VALUE_BYTES || bytes.toString('base64url') !== value) return null;
  const body = bytes.subarray(0, BODY_BYTES);
  if (!timingSafeEqual(macOf(key, body), bytes.subarray(BODY_BYTES))) return null;
  const saidYesAt = body.readUIntBE(RANDOM_BYTES, AT_BYTES);
  const wordingVersion = `w-${body.subarray(RANDOM_BYTES + AT_BYTES).toString('hex')}`;
  return { id: idOfValue(key, value), saidYesAt, wordingVersion };
}

/** One cookie's value from the request's `Cookie` header, or null. */
function cookieValue(header: string | string[] | undefined, name: string): string | null {
  const text = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** What the request's cookie proves (see {@link readVisitorValue}), or null when it carries none this server made. */
export function visitorProofOf(key: Buffer, request: Pick<FastifyRequest, 'headers' | 'protocol'>): VisitorProof | null {
  const value = cookieValue(request.headers.cookie, visitorCookieName(request));
  return value === null ? null : readVisitorValue(key, value);
}

/** The visitor the request's cookie names (a keyed hash of its value), or null when it carries none this server made. */
export function visitorIdOf(key: Buffer, request: Pick<FastifyRequest, 'headers' | 'protocol'>): string | null {
  return visitorProofOf(key, request)?.id ?? null;
}

/** A new visitor's cookie: its value, and what it proves. */
export function newVisitor(key: Buffer, said: { at: number; wordingVersion: string }): { value: string; proof: VisitorProof } {
  const wording = WORDING.exec(said.wordingVersion);
  if (wording === null) throw new Error('A wording version is not one the banner makes.');
  const body = Buffer.alloc(BODY_BYTES);
  randomBytes(RANDOM_BYTES).copy(body, 0);
  body.writeUIntBE(Math.max(0, Math.floor(said.at)), RANDOM_BYTES, AT_BYTES);
  Buffer.from(wording[1]!, 'hex').copy(body, RANDOM_BYTES + AT_BYTES);
  const value = Buffer.concat([body, macOf(key, body)]).toString('base64url');
  return { value, proof: { id: idOfValue(key, value), saidYesAt: Math.max(0, Math.floor(said.at)), wordingVersion: said.wordingVersion } };
}

/** Whether a "yes" no visitor row holds yet still counts: made within {@link VISITOR_PENDING_MS}, never ahead of the clock. */
export function pendingYes(proof: Pick<VisitorProof, 'saidYesAt'>, at: number): boolean {
  return proof.saidYesAt <= at + 60_000 && at - proof.saidYesAt < VISITOR_PENDING_MS;
}

/** The cookie's attributes on this request's address. */
function cookieAttributes(request: Pick<FastifyRequest, 'protocol'>, maxAge: number): string {
  return secureOf(request)
    ? `Path=${VISITOR_COOKIE_PATH}; Max-Age=${String(maxAge)}; HttpOnly; SameSite=Lax; Secure`
    : `Path=${VISITOR_COOKIE_PATH_PLAIN}; Max-Age=${String(maxAge)}; HttpOnly; SameSite=Lax`;
}

/** Sets the visitor's cookie on a reply. */
export function setVisitorCookie(request: Pick<FastifyRequest, 'protocol'>, reply: FastifyReply, value: string): void {
  void reply.header('set-cookie', `${visitorCookieName(request)}=${value}; ${cookieAttributes(request, VISITOR_COOKIE_MAX_AGE_S)}`);
}

/** Clears the visitor's cookie. */
export function clearVisitorCookie(request: Pick<FastifyRequest, 'protocol'>, reply: FastifyReply): void {
  void reply.header('set-cookie', `${visitorCookieName(request)}=; ${cookieAttributes(request, 0)}`);
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

/** Each banner word's key in the `x` namespace. */
const BANNER_KEYS: Readonly<Record<keyof typeof BANNER_DEFAULT, string>> = {
  title: 'x:banner.title',
  text: 'x:banner.text',
  yes: 'x:banner.yes',
  no: 'x:banner.no',
};

/** The engine's default banner words in a language (the install's own translations of them included). */
export async function defaultBannerWords(meta: MetaDb, language: BannerLocale): Promise<{ title: string; text: string; yes: string; no: string }> {
  const locale = localeFromTag(language);
  const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
  const t = (key: keyof typeof BANNER_DEFAULT): string => i18n.t(BANNER_KEYS[key], { defaultValue: BANNER_DEFAULT[key] });
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

/**
 * The moment "Per visitor" was last switched on (the level's own setting row),
 * or null when it is not on: a "yes" from before it was given to a purpose
 * that ended (going down deleted every visitor) and names nobody.
 */
export async function visitorSince(meta: MetaDb): Promise<number | null> {
  const row = await meta.db.selectFrom('adminium_settings').select('updatedAt').where('key', '=', 'privacy.tracking').executeTakeFirst();
  if ((await settingsRepo(meta).get('privacy.tracking')) !== 'visitor') return null;
  return row === undefined ? 0 : Number(row.updatedAt);
}

export interface VisitorBlockDeps {
  meta: MetaDb;
  /** The level, read again at most a few seconds ago (`ViewCounter.levelNow`). */
  levelNow: () => Promise<TrackingLevel>;
  /** The visitor key ({@link visitorKey}). */
  key: Buffer;
  /** Whether a cookie's proof names a visitor now: one kept, or a "yes" still waiting for its first view. */
  names: (proof: VisitorProof) => Promise<boolean>;
}

/**
 * What a stranger's own page is told about "Per visitor", for the reply of
 * its data read: nothing at all below "Per visitor", in a frame, or off the
 * install's own addresses; else the banner's words in the page's language,
 * and whether this browser's cookie names a visitor (kept, or a "yes" still
 * waiting for its first counted view). A door spreads it into its reply as
 * `visitor`.
 */
export async function visitorBlockFor(deps: VisitorBlockDeps, request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>, opts: { language: string | null; framed: boolean }): Promise<{ visitor?: VisitorBlock }> {
  if (opts.framed) return {};
  try {
    if ((await deps.levelNow()) !== 'visitor') return {};
    if (!(await ownPagesHost(deps.meta, request))) return {};
    const proof = visitorProofOf(deps.key, request);
    const said = proof !== null && (await deps.names(proof)) ? ('yes' as const) : null;
    return { visitor: { banner: await bannerWords(deps.meta, bannerLocaleOf(opts.language)), said } };
  } catch {
    // Nothing about a visitor is worth a page that does not draw.
    return {};
  }
}

/**
 * A "yes" whose first counted view arrived: what its visitor row is made
 * from, at the counter's flush. The network labels are keyed hashes the
 * counter made (an IPv4 address or IPv6 /64, and the IPv6 /48), never an
 * address.
 */
export interface Newcomer {
  proof: VisitorProof;
  /** The host the view came on (the cookie is host-only: the host the "yes" was given on). */
  host: string;
  /** When the view was counted. */
  at: number;
  networks: { address: string; wide: string | null };
}

/** "Per visitor" as a door uses it. */
export interface VisitorDoor {
  /** The key the cookie's value is hashed and signed under. */
  key: Buffer;
  /** What a stranger's own page is told ({@link visitorBlockFor}). */
  block(request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>, opts: { language: string | null; framed: boolean }): Promise<{ visitor?: VisitorBlock }>;
  /** What the request's cookie proves, read only at "Per visitor" (as the counter holds the level): null otherwise. */
  proofOf(request: Pick<FastifyRequest, 'headers' | 'protocol'>): VisitorProof | null;
  /**
   * The visitor rows of the "yes"es whose first counted view this is (the
   * counter's flush, before the visits): only a "yes" still waiting
   * ({@link pendingYes}) given since "Per visitor" was switched on, at most
   * {@link NEW_VISITORS_PER_ADDRESS_DAY} a day from one network address and
   * {@link NEW_VISITORS_PER_48_DAY} from one IPv6 /48. A visitor already
   * kept is left as it is. Answers the ids that are kept after it.
   */
  admit(newcomers: readonly Newcomer[]): Promise<Set<string>>;
  /**
   * A form sent with the visitor's cookie, on the install's own page: the
   * answer's address, as the address keys hash it, joined onto the visitor.
   * A visitor already joined to another address keeps it: this browser
   * becomes a new visitor (a new cookie on `reply`), so each address holds
   * only the visits made under it. Never throws: a join that fails leaves
   * the answer as it is.
   */
  join(request: Pick<FastifyRequest, 'headers' | 'protocol' | 'host'>, reply: FastifyReply, email: string): Promise<void>;
}

export interface VisitorDoorDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`: the visitor key's source, and the address keys'. */
  secret: string;
  /** The level as the counter holds it (cheap, every request). */
  level: () => TrackingLevel;
  /** The level, read again at most a few seconds ago. */
  levelNow: () => Promise<TrackingLevel>;
  /** The address under the newest key version (`consent/keys.ts` `addressKeyRing(...).hashForWrite`). */
  hashForWrite: (address: string) => Promise<{ hash: string; version: number }>;
  /** The address under every key version (`hashesOf`). */
  hashesOf: (address: string) => Promise<readonly { hash: string; version: number }[]>;
  now?: () => number;
}

/** The day a moment falls on, in UTC: what the daily caps count by. */
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** Whether a row insert failed only because the row is there already (another process made it a moment ago). */
function duplicate(error: unknown): boolean {
  return /unique|duplicate|primary key|constraint/i.test(error instanceof Error ? error.message : String(error));
}

export function createVisitorDoor(deps: VisitorDoorDeps): VisitorDoor {
  const key = visitorKey(deps.secret);
  const now = deps.now ?? Date.now;
  const visitors = visitorsRepo(deps.meta);
  const proofOf = (request: Pick<FastifyRequest, 'headers' | 'protocol'>): VisitorProof | null => (deps.level() === 'visitor' ? visitorProofOf(key, request) : null);
  /** New visitors per network label today (held in memory, per process; cleared each day). */
  let capDay = '';
  const taken = new Map<string, number>();

  /** Whether one more new visitor may come from these networks today; counts it when so. */
  function underCap(networks: Newcomer['networks'], at: number): boolean {
    const day = utcDay(at);
    if (day !== capDay || taken.size > 200_000) {
      capDay = day;
      taken.clear();
    }
    const labels: [string, number][] = [[`a:${networks.address}`, NEW_VISITORS_PER_ADDRESS_DAY]];
    if (networks.wide !== null) labels.push([`w:${networks.wide}`, NEW_VISITORS_PER_48_DAY]);
    if (labels.some(([label, max]) => (taken.get(label) ?? 0) >= max)) return false;
    for (const [label] of labels) taken.set(label, (taken.get(label) ?? 0) + 1);
    return true;
  }

  /** Whether a proof's "yes" may still become a visitor: waiting, and given since "Per visitor" was switched on. */
  function mayBecome(proof: VisitorProof, at: number, since: number | null): boolean {
    return since !== null && proof.saidYesAt >= since && pendingYes(proof, at);
  }

  /** Makes a visitor row; a row another process made a moment ago counts as made. */
  async function make(proof: VisitorProof, host: string): Promise<boolean> {
    try {
      await visitors.create({ id: proof.id, host: host.toLowerCase().slice(0, 253) || 'unknown', saidYesAt: proof.saidYesAt, wordingVersion: proof.wordingVersion });
      return true;
    } catch (error) {
      if (duplicate(error)) return (await visitors.find(proof.id)) !== null;
      throw error;
    }
  }

  return {
    key,
    block: (request, opts) =>
      visitorBlockFor(
        {
          meta: deps.meta,
          levelNow: deps.levelNow,
          key,
          names: async (proof) => (await visitors.find(proof.id)) !== null || mayBecome(proof, now(), await visitorSince(deps.meta)),
        },
        request,
        opts,
      ),
    proofOf,
    async admit(newcomers) {
      const kept = new Set<string>();
      if (newcomers.length === 0) return kept;
      for (const id of await visitors.existing(newcomers.map((one) => one.proof.id))) kept.add(id);
      const since = await visitorSince(deps.meta);
      for (const one of newcomers) {
        if (kept.has(one.proof.id) || !mayBecome(one.proof, one.at, since) || !underCap(one.networks, one.at)) continue;
        if (await make(one.proof, one.host)) kept.add(one.proof.id);
      }
      return kept;
    },
    async join(request, reply, email) {
      try {
        const proof = proofOf(request);
        if (proof === null) return;
        const row = await visitors.find(proof.id);
        if (row === null) {
          // A "yes" still waiting for its first view: its row is made now, with the address.
          if (!mayBecome(proof, now(), await visitorSince(deps.meta)) || !(await make(proof, request.host))) return;
          await visitors.join(proof.id, await deps.hashForWrite(email));
          return;
        }
        if (row.address !== null) {
          const same = (await deps.hashesOf(email)).some((one) => one.hash === row.address!.hash && one.version === row.address!.version);
          if (same) return;
          // Another address sent from this browser: a new visitor, so neither address holds the other's visits.
          const fresh = newVisitor(key, { at: row.saidYesAt, wordingVersion: row.wordingVersion });
          await visitors.create({ id: fresh.proof.id, host: row.host, saidYesAt: row.saidYesAt, wordingVersion: row.wordingVersion });
          await visitors.join(fresh.proof.id, await deps.hashForWrite(email));
          setVisitorCookie(request, reply, fresh.value);
          return;
        }
        await visitors.join(proof.id, await deps.hashForWrite(email));
      } catch {
        // The answer stands whatever happens to the join.
      }
    },
  };
}
