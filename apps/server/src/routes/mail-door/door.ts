// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the mail door does, apart from drawing pages and answering HTTP: is
 * the door open, what a link says, who the business is, which language a
 * page is in, and the two unsubscribe actions.
 *
 * ─── The door is open only where the outside can reach it ──────────────────
 * Every request asks first (`reachable`): the very check the send side makes
 * before a marketing mail goes (`email/door-reach.ts`), about this server's
 * public address (`system.publicOrigin`), the address every marketing mail's
 * links are written on. So the door is never shut while mail linking to it
 * can go out. While it fails, nothing a stranger sends is acted on, and the
 * pages say "This page isn't available". It never reads the request: a
 * request through a reverse proxy (forwarding headers, with
 * `ADMINIUM_TRUST_PROXY` off) is served like any other; the signed link is
 * the gate, not the caller's network address.
 *
 * ─── The two buttons ──────────────────────────────────────────────────────
 *  - "Unsubscribe" withdraws the mail's purpose: a "no" row in the consent
 *    log (source `unsubscribe`), with the "Why?" answer in its detail. The
 *    RFC 8058 one-click does the same.
 *  - "Unsubscribe from all … marketing mail" puts the address on the
 *    do-not-email list (reason `link`) and, when the mail had a purpose, also
 *    withdraws it, so the log says why and taking the address off the list
 *    later does not quietly mean "yes" again.
 *  - A mail on the existing-customers basis has no purpose: its one button,
 *    and its one-click, put the address on the list.
 * A withdrawal reaches the person's declared consent column (the CRM's
 * `may_email`) through the column door, as the system (`mirror`).
 * Each says "already" when there is nothing left to do, and writes nothing
 * then. When the link came in a campaign send, that send's row in the send
 * log turns "Unsubscribed".
 */
import { BUILTIN_LOCALE_IDS, localeFromTag, type LocaleId } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import { emailRunsRepo, emailSendsRepo, isHttpsPageUrl, paymentSettingsRepo, settingsRepo, type ConsentEvent, type ConsentPerson, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { ConsentService } from '../../consent/index.js';
import { readClickLinkWith, type ClickClaim } from '../../email/click-link.js';
import { mailDoorReach, storedPublicOrigin } from '../../email/door-reach.js';
import { mailLinkKeys } from '../../email/link-keys.js';
import { readUnsubscribeTokenWith, type UnsubscribeClaim } from '../../email/unsubscribe-token.js';
import { loadOverrideMap, recipientLocale } from '../../i18n/server-i18n.js';
import { bcp47 } from '../../i18n/bcp47.js';
import { negotiateLocale } from '../../plugins/surfaces.js';
import { businessName, privacyNoticeOf } from '../../privacy/business.js';
import { PAY_PAGE_DOC, payPageSchema } from '../payments/ways.js';
import { MAIL_DOOR_LANGUAGES, type MailDoorBusiness, type Translate, type UnsubscribeReason } from './page.js';

export interface MailDoorDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`: what the link keys are kept under. */
  secret: string;
  consent: ConsentService;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: (() => number) | undefined;
  /**
   * A withdrawal mirrored into the declared consent column of the person it
   * names, or of every row holding the address (`people/consent-writes.ts`):
   * the column door writes it, with nobody as "by". Without it, the log alone
   * says it.
   */
  mirror?: ((event: ConsentEvent, address: string) => Promise<unknown>) | undefined;
}

/** Which button, and how it came. */
export type UnsubscribeAction = 'one' | 'all';
export type UnsubscribeVia = 'link' | 'one-click';

/** What an unsubscribe did. */
export type UnsubscribeOutcome = { done: 'newsletter' | 'surveys' | 'all' } | { already: true };

export function createMailDoor(deps: MailDoorDeps) {
  const { meta, consent } = deps;
  const now = deps.now ?? Date.now;
  const settings = settingsRepo(meta);
  const linkKeys = mailLinkKeys(meta, deps.secret);

  const publicOrigin = () => storedPublicOrigin(meta);

  /**
   * Whether the outside can reach this server at its public address (see
   * the header): the very check a marketing send makes before it goes, so
   * the door is open whenever mail linking to it may leave.
   */
  async function reachable(): Promise<boolean> {
    return (await mailDoorReach(meta, deps)).open;
  }

  async function install(): Promise<string> {
    const id = await settings.get('system.instanceId');
    return typeof id === 'string' ? id : '';
  }

  /** What an unsubscribe link says; null for one this install did not make (or that was changed). */
  async function readUnsubscribe(token: string): Promise<UnsubscribeClaim | null> {
    return readUnsubscribeTokenWith(await linkKeys.unsubscribeAll(), await install(), token);
  }

  /** Where a click link leads; null for one this install did not sign. */
  async function readClick(token: string): Promise<ClickClaim | null> {
    return readClickLinkWith(await linkKeys.clickAll(), token);
  }

  /**
   * The business the page speaks for: the one name every page a stranger
   * sees uses (`privacy/business.ts`: the pay page's, the privacy settings'
   * "Business name", the workspace's, then the public address's host). Never
   * the software's own name. The contact address is the pay page's. The
   * privacy notice's address is the privacy settings' (https only: one set
   * some other way that is not https is left off the page).
   */
  async function business(): Promise<MailDoorBusiness> {
    const name = (await businessName(meta, { origin: await publicOrigin() })) || 'localhost';
    const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
    const { noticeUrl } = await privacyNoticeOf(meta);
    return { name, email: page?.contactEmail ?? null, privacyNotice: noticeUrl !== null && isHttpsPageUrl(noticeUrl) ? noticeUrl : null };
  }

  /**
   * The page's language: one picked in its own menu (`?lang=`), else the
   * mail's (the token names it), else the browser's, else the install's.
   */
  async function language(request: FastifyRequest, claim: UnsubscribeClaim | null): Promise<LocaleId> {
    const asked = (request.query as { lang?: unknown } | undefined)?.lang;
    if (typeof asked === 'string' && MAIL_DOOR_LANGUAGES.some((one) => one.tag === asked)) return localeFromTag(asked);
    const mail = claim?.language ?? null;
    if (mail !== null && (BUILTIN_LOCALE_IDS as readonly string[]).includes(mail)) return mail as LocaleId;
    const browser = negotiateLocale(request.headers['accept-language']);
    if (browser !== null) return browser;
    return (await recipientLocale(meta, null)) as LocaleId;
  }

  /** A translator for one page, with the owner's own wording from Translations. */
  async function translator(locale: LocaleId): Promise<{ t: Translate; lang: string }> {
    const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
    return { t: (key, fallback, args) => i18n.t(key, { defaultValue: fallback, ...args }), lang: bcp47(locale) };
  }

  async function accent(): Promise<string> {
    const value = await settings.get('appearance.accent');
    return typeof value === 'string' ? value : 'indigo';
  }

  /** The send's row, when the link came in a campaign send to this very address. */
  async function sendOf(claim: UnsubscribeClaim) {
    if (claim.send === null) return null;
    const row = await emailSendsRepo(meta).findById(claim.send);
    return row !== null && row.address.trim().toLowerCase() === claim.address ? row : null;
  }

  /** Whether there is anything left for a press to do. */
  async function settled(claim: UnsubscribeClaim): Promise<boolean> {
    if (await consent.stop.has(claim.address)) return true;
    return false;
  }

  /** The press itself: see the header. */
  async function unsubscribe(claim: UnsubscribeClaim, action: UnsubscribeAction, via: UnsubscribeVia, why: UnsubscribeReason | null): Promise<UnsubscribeOutcome> {
    const at = now();
    const row = await sendOf(claim);
    const person: ConsentPerson | null =
      row !== null && row.connectionId !== null && row.personTable !== null && row.personKey !== null ? { connectionId: row.connectionId, table: row.personTable, key: row.personKey } : null;
    // A mail with no purpose (the existing-customers basis) has the list as its one button.
    const all = action === 'all' || claim.purpose === null;
    const stopped = await consent.stop.has(claim.address);
    const purposeOpen = claim.purpose !== null && (await consent.stateFor({ address: claim.address, person }, claim.purpose)).state !== 'no';
    if (stopped || (!all && !purposeOpen)) return { already: true };
    const detail = `${via}${all ? '-all' : ''}${why === null ? '' : `:${why}`}`;
    if (all) {
      const origin = row === null ? null : ((await emailRunsRepo(meta).content(row.runId))?.name ?? null);
      await consent.stop.add({ address: claim.address, reason: 'link', origin, at });
    }
    if (claim.purpose !== null && purposeOpen) {
      const withdrawn = await consent.withdraw({ address: claim.address, person, purpose: claim.purpose, source: 'unsubscribe', detail, at });
      await deps.mirror?.(withdrawn, claim.address);
    }
    if (row !== null) await emailSendsRepo(meta).markUnsubscribed(row.id, at);
    return { done: all ? 'all' : claim.purpose! };
  }

  /** A followed click link: its send counts one more click (when the row is there). */
  async function clicked(claim: ClickClaim): Promise<void> {
    await emailSendsRepo(meta).countClick(claim.send, now());
  }

  return { reachable, readUnsubscribe, readClick, business, language, translator, accent, settled, unsubscribe, clicked };
}

export type MailDoor = ReturnType<typeof createMailDoor>;
