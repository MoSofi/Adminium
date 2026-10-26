// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MARKETING MAIL ON THE SENDING SIDE — what stops it, what refuses it, and
 * what every copy carries. The app outbox, a rule's e-mail step and a
 * campaign all come through here, so the three can never disagree.
 *
 * ─── Which mail ────────────────────────────────────────────────────────────
 * Only marketing mail (`mailClassOf`, `@adminium/manifest`): an outbox kind or
 * a rule's step an app classes `marketing`, a campaign run marked so. Service
 * mail (a quote, a receipt, a booking) is never stopped and carries none of
 * this; mail to staff (digests, notices, a rule's mail to a person named on
 * the record) has no class at all.
 *
 * ─── Who it skips: {@link MarketingMail.verdict} ───────────────────────────
 * In this order, each a reason the send log and the outbox name:
 *   1. `do-not-email`: the address is on the install's do-not-email list;
 *   2. `replied`: for a sequence step, the person replied after the run
 *      started ("Replied" stops their sequences);
 *   3. the basis: their latest answer in the consent log for the mail's
 *      purpose is yes (`consent`); or else the "existing customers" basis
 *      carries them (the owner switched it on for their table, the row is
 *      marked as shown the opt-out line, and they are a customer) and they
 *      never said no for that purpose (`existing-customers`);
 *   4. otherwise `not-agreed`.
 * One function, the campaign ledger's row check and the outbox both use.
 * The do-not-email list's keys failing to open throws (`AddressKeysLockedError`):
 * a marketing send then fails rather than treat the address as not stopped.
 *
 * ─── When it is refused: {@link MarketingMail.refusal} ─────────────────────
 * The sender checks (`sender/refusals.ts`) with this server's facts: the
 * postal address, the From's DNS (DMARC, Adminium's DKIM key published and
 * aligned), and a public address (`system.publicOrigin`) that the outside can
 * reach, without which the unsubscribe link would not work.
 *
 * ─── What every copy carries: {@link MarketingMail.carry} and `signing` ────
 *   - the unsubscribe link (`unsubscribe-token.ts`) as RFC 8058's
 *     `List-Unsubscribe` (the https link, and a `mailto:` to the reply
 *     address when the mail has one) with `List-Unsubscribe-Post:
 *     List-Unsubscribe=One-Click`;
 *   - the locked footer: the postal address and "Unsubscribe from
 *     <business>'s <purpose>" (or "… marketing mail" for a mail on the
 *     existing-customers basis), in the mail's language;
 *   - at delivery, Adminium's DKIM signature when the From's domain (or a
 *     parent of it) has a key, over a header list that covers both list
 *     headers, and the headers that switch the relay's own tracking off.
 *
 * ─── A permanent refusal at send time: {@link MarketingMail.bounced} ───────
 * A 5xx from a direct relay that says the address takes no mail puts it on
 * the do-not-email list (reason `bounce`), for mail of either class: the
 * list stops marketing mail only, so a receipt still tries next time.
 */
import {
  notificationsRepo,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type ConsentPerson,
  type ConsentPurpose,
  type MetaDb,
} from '@adminium/meta';

import { createConsentService, type ConsentService } from '../consent/index.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { reachability } from '../payments/reachability.js';
import { normalizePublicOrigin } from '../security/public-origin.js';
import { translatorForLocale } from './builtins.js';
import { bareAddress } from './document.js';
import { isDirectRelay, permanentRefusal, type PermanentRefusal } from './refused.js';
import {
  createDkimKeys,
  createTxtLookup,
  domainOfAddress,
  marketingRefusal,
  relayOf,
  senderFacts,
  trackingOffHeaders,
  type MarketingRefusal,
  type TxtLookup,
} from './sender/index.js';
import { businessNameOf, postalAddressOf } from './sender/marketing-settings.js';
import type { MarketingCarry } from './marketing-carry.js';
import type { OutboundDkim } from './types.js';
import { existingCustomersOn as readExistingCustomersOn } from './existing-customers.js';
import { mailLinkKeys } from './link-keys.js';
import { makeUnsubscribeToken, unsubscribeUrl } from './unsubscribe-token.js';

/** Why a marketing mail is not sent to one person. */
export const MARKETING_SKIPS = ['do-not-email', 'not-agreed', 'replied'] as const;
export type MarketingSkip = (typeof MARKETING_SKIPS)[number];

/** The ground a marketing mail went out on, or why it did not go. */
export type MarketingVerdict = { send: 'consent' | 'existing-customers' } | { skip: MarketingSkip };

/** The purpose a marketing mail is sent for when nothing says another (surveys arrive with forms). */
export const DEFAULT_MARKETING_PURPOSE: ConsentPurpose = 'newsletter';

export interface MarketingVerdictInput {
  address: string;
  /** The person's row, when the mail is about one. */
  person?: ConsentPerson | null | undefined;
  purpose: ConsentPurpose;
  /** The existing-customers basis carries this person (see the header). */
  existingCustomer?: boolean | undefined;
  /** A sequence step: a reply at or after this moment stops it. */
  repliedSince?: number | null | undefined;
}

export type { MarketingCarry } from './marketing-carry.js';

export interface MarketingCarryInput {
  to: string;
  /** Null for a mail on the existing-customers basis: its page has one button (the do-not-email list). */
  purpose: ConsentPurpose | null;
  /** The mail's language (`en_US`): the footer's words are in it. */
  locale: string;
  /** The business the footer names; the workspace's name when absent. */
  business?: string | undefined;
  /** The mail's reply address: the one-click header also offers `mailto:` it. */
  replyTo?: string | null | undefined;
  /** The campaign send (ledger row) it goes in. */
  send?: string | null | undefined;
}

/** Facts of this server the public-address check reads (`payments/reachability.ts`). */
export interface MarketingReach {
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
}

/** For tests: DNS, the postal address and the existing-customers switch, answered in place of the real ones. */
export interface MarketingSeams {
  lookup?: TxtLookup | undefined;
  postalAddress?: ((meta: MetaDb) => Promise<string | null>) | undefined;
  /** Whether the owner switched "existing customers" on for a people table; read from the owner's switch when absent (`existing-customers.ts`). */
  existingCustomersOn?: ((connectionId: string, table: string) => Promise<boolean>) | undefined;
}

export interface MarketingMailDeps extends MarketingSeams {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  reach?: MarketingReach | undefined;
  hub?: NotificationPublisher | undefined;
  now?: (() => number) | undefined;
}

export interface MarketingMail {
  consent: ConsentService;
  verdict(input: MarketingVerdictInput): Promise<MarketingVerdict>;
  /** The first refusal a marketing send from `from` meets now, or null when it may go. */
  refusal(from: string): Promise<MarketingRefusal | null>;
  carry(input: MarketingCarryInput): Promise<MarketingCarry>;
  /** At delivery: Adminium's DKIM options for the From (when a key exists) and the relay's tracking-off headers. */
  signing(from: string, smtpHost: string): Promise<{ dkim: OutboundDkim | null; headers: Record<string, string> }>;
  /** A refusal at send time: the address goes on the do-not-email list when it says so for good (see the header). */
  bounced(input: { error: unknown; smtpHost: string; address: string; origin?: string | null | undefined }): Promise<PermanentRefusal | null>;
  existingCustomersOn(connectionId: string, table: string): Promise<boolean>;
  /**
   * Tell the people who manage e-mail, once, that something is being
   * skipped because its sender is refused: `about` names it (the app, the
   * kind, the refusal), and a person already told of it is not told again.
   */
  tellRefused(input: { about: string; source: string; refusal: MarketingRefusal }): Promise<number>;
}

/** The kind of the notice a refused marketing send tells the e-mail managers. */
export const MARKETING_REFUSED_NOTICE_KIND = 'email.marketing-refused';

/** The sentence a skip writes where the send records it (the outbox's `error`, a rule's log). */
export function marketingSkipSentence(skip: MarketingSkip): string {
  switch (skip) {
    case 'do-not-email':
      return 'Not sent: on the do-not-email list (marketing mail)';
    case 'not-agreed':
      return 'Not sent: has not agreed to marketing mail';
    case 'replied':
      return 'Not sent: they replied, which stops their e-mail sequences';
  }
}

/** Why a marketing send is refused, in a sentence (the outbox's `error`, a rule's log). */
export function marketingRefusalSentence(refusal: MarketingRefusal): string {
  switch (refusal) {
    case 'no-postal-address':
      return 'Marketing mail refused: add your postal address to the sender first';
    case 'free-mail-from':
      return 'Marketing mail refused: it would go from a free mailbox address; use an address at your own domain';
    case 'dns-unchecked':
      return 'Marketing mail refused: the sender’s DNS could not be checked';
    case 'no-dmarc':
      return 'Marketing mail refused: the sender’s domain has no DMARC record';
    case 'not-aligned':
      return 'Marketing mail refused: the sender’s domain has no published Adminium signing key (DKIM)';
    case 'no-public-address':
      return 'Marketing mail refused: this server has no public address, so unsubscribe links would not work';
  }
}

/** The domain and its parents of two labels or more: a key for any of them can sign mail from it (relaxed alignment). */
function domainsUp(domain: string): string[] {
  const labels = domain.split('.').filter((label) => label !== '');
  const out: string[] = [];
  for (let i = 0; i + 2 <= labels.length; i += 1) out.push(labels.slice(i).join('.'));
  return out;
}

export function createMarketingMail(deps: MarketingMailDeps): MarketingMail {
  const { meta, secret } = deps;
  const consent = createConsentService({ meta, secret, ...(deps.now === undefined ? {} : { now: deps.now }) });
  const lookup = deps.lookup ?? createTxtLookup();
  const keys = createDkimKeys({ meta, secret });
  const linkKeys = mailLinkKeys(meta, secret);
  const reach = deps.reach ?? { networkFeatures: true, desktop: false, trustProxy: true };
  const settings = settingsRepo(meta);
  /** What was told already in this process: not asked of the notifications again. */
  const told = new Set<string>();

  async function publicOrigin(): Promise<string | null> {
    const stored = await settings.get('system.publicOrigin');
    return typeof stored === 'string' ? normalizePublicOrigin(stored) : null;
  }

  /** Adminium's key for mail from `domain`: the domain's own, else the nearest parent's. */
  async function keyFor(domain: string) {
    for (const candidate of domainsUp(domain)) {
      const key = await keys.forDomain(candidate);
      if (key !== null) return key;
    }
    return null;
  }

  async function managers(): Promise<string[]> {
    const roles = rolesRepo(meta);
    const roleIds = new Set<string>();
    const superAdmin = await roles.findBySlug('super-admin');
    if (superAdmin !== null) roleIds.add(superAdmin.id);
    for (const grant of await permissionsRepo(meta).listForResource('system', 'settings.manage')) {
      if ((grant.actions as { allowed?: boolean }).allowed === true) roleIds.add(grant.roleId);
    }
    const people = new Set<string>();
    for (const roleId of roleIds) for (const userId of await roles.usersInRole(roleId)) people.add(userId);
    const active: string[] = [];
    for (const userId of people) {
      const user = await usersRepo(meta).findById(userId);
      if (user !== null && user.status === 'active') active.push(userId);
    }
    return active.sort();
  }

  return {
    consent,

    async verdict(input) {
      if (await consent.stop.has(input.address)) return { skip: 'do-not-email' };
      const who = { person: input.person ?? null, address: input.address };
      if (input.repliedSince !== null && input.repliedSince !== undefined) {
        const replied = await consent.lastReplied(who);
        if (replied !== null && replied >= input.repliedSince) return { skip: 'replied' };
      }
      const standing = await consent.stateFor(who, input.purpose);
      if (standing.state === 'yes') return { send: 'consent' };
      if (input.existingCustomer === true && standing.state !== 'no') return { send: 'existing-customers' };
      return { skip: 'not-agreed' };
    },

    async refusal(from) {
      const address = bareAddress(from);
      const origin = await publicOrigin();
      const postal = await (deps.postalAddress ?? postalAddressOf)(meta);
      const reached = reachability({ ...reach, publicOrigin: origin, forwarded: false });
      const domain = domainOfAddress(address);
      const key = domain === null ? null : await keyFor(domain);
      const facts = await senderFacts(lookup, address, key === null ? null : { domain: key.domain, selector: key.selector, publicKey: key.publicKey });
      return marketingRefusal(address, { postalAddress: postal, publicOrigin: origin, reachable: reached.state === 'reachable' }, facts);
    },

    async carry(input) {
      const origin = await publicOrigin();
      // The refusal comes first on every path; a carry without a public address is a caller's mistake.
      if (origin === null) throw new Error('a marketing mail needs this server’s public address for its unsubscribe link');
      const install = (await settings.get('system.instanceId')) ?? '';
      // Signed with the link key, which outlives a change of the server's secret, and naming the mail's language for the page.
      const key = await linkKeys.unsubscribe();
      const token = makeUnsubscribeToken(key, install, { address: input.to, purpose: input.purpose, send: input.send ?? null, language: input.locale });
      const url = unsubscribeUrl(origin, token);
      const replyTo = input.replyTo?.trim() ?? '';
      const headers: Record<string, string> = {
        'List-Unsubscribe': replyTo === '' ? `<${url}>` : `<${url}>, <mailto:${replyTo}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
      const business = input.business ?? (await businessNameOf(meta));
      const { t } = await translatorForLocale(meta, input.locale);
      const text =
        input.purpose === null
          ? t('email:marketingFooter.all', { business, defaultValue: 'Unsubscribe from {business}’s marketing mail' })
          : input.purpose === 'surveys'
            ? t('email:marketingFooter.surveys', { business, defaultValue: 'Unsubscribe from {business}’s surveys' })
            : t('email:marketingFooter.newsletter', { business, defaultValue: 'Unsubscribe from {business}’s newsletter' });
      const postal = await (deps.postalAddress ?? postalAddressOf)(meta);
      return { headers, locked: { lines: postal === null ? [] : [postal], link: { text, href: url } } };
    },

    async signing(from, smtpHost) {
      const domain = domainOfAddress(bareAddress(from));
      const key = domain === null ? null : await keyFor(domain);
      const dkim = key === null ? null : await keys.signingOptionsFor(key.domain);
      let headers: Record<string, string> = {};
      try {
        headers = trackingOffHeaders(relayOf(smtpHost));
      } catch {
        // A configuration set that is not one sends no header (the sender guide says how to name one).
      }
      return { dkim, headers };
    },

    async bounced(input) {
      if (!isDirectRelay(input.smtpHost)) return null;
      const refused = permanentRefusal(input.error);
      if (refused === null) return null;
      await consent.stop.add({ address: input.address, reason: 'bounce', origin: input.origin ?? null });
      return refused;
    },

    async existingCustomersOn(connectionId, table) {
      // The owner's switch, whichever path asks (the outbox, a rule's e-mail step, a campaign).
      return deps.existingCustomersOn === undefined ? await readExistingCustomersOn(meta, connectionId, table) : await deps.existingCustomersOn(connectionId, table);
    },

    async tellRefused(input) {
      const about = `${input.about}:${input.refusal}`;
      if (told.has(about)) return 0;
      let people: string[];
      try {
        people = await managers();
      } catch {
        return 0;
      }
      let count = 0;
      for (const userId of people) {
        try {
          // Told before (by this process or another): their notices still hold it.
          const recent = await notificationsRepo(meta).listForUser(userId, { limit: 200 });
          if (recent.some((one) => one.kind === MARKETING_REFUSED_NOTICE_KIND && one.entity?.['about'] === about)) continue;
          const { t } = await translatorFor(meta, userId);
          await notify(
            meta,
            {
              userId,
              kind: MARKETING_REFUSED_NOTICE_KIND,
              title: t('email:marketingRefused.title', { defaultValue: 'Marketing mail is being skipped' }),
              // i18n-dynamic-key: one body per refusal code, each with its English beside it in the locale files.
              body: t(`email:marketingRefused.body.${input.refusal}`, { source: input.source, defaultValue: `${input.source}: ${marketingRefusalSentence(input.refusal)}` }),
              entity: { kind: 'marketing-refused', about },
              actionUrl: '/studio/settings',
            },
            { ...(deps.hub === undefined ? {} : { hub: deps.hub }), ...(deps.now === undefined ? {} : { at: deps.now() }), email: false },
          );
          count += 1;
        } catch {
          // One person's notice failing never stops the others'.
        }
      }
      told.add(about);
      return count;
    },
  };
}
