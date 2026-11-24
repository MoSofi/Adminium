// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DOUBLE OPT-IN FOR MARKETING TEXTS: a marketing yes, in a country that
 * expects it confirmed (Germany to start, `DOUBLE_OPT_IN_COUNTRIES`), counts
 * only once it is confirmed. Until then the consent service refuses every
 * marketing text to that number (`unconfirmed-consent`).
 *
 * ─── How it is confirmed, and why by e-mail ───────────────────────────────
 * A text cannot carry the question. A provider reads YES (and START) as an
 * opt-in, so no text may ask anyone to "Reply YES"; a text never carries a
 * sign-in link or a code; and the German
 * regulators rate an SMS code as weak evidence of consent
 * (their 2022 guidance on advertising). So:
 *
 *  - BY E-MAIL. The person's row holds an e-mail address: they get one mail
 *    (`text-marketing-confirm`) with one button to a page of the mail door
 *    (`/m/t/<token>`). A GET shows the masked number and the button and
 *    changes nothing (link scanners open every link); the button's POST
 *    confirms. The link works for 30 days, names only the request, and
 *    confirms only while the person's row still holds the number the yes was
 *    given for and that yes still stands (no later no, no STOP).
 *  - IN PERSON. A person with no e-mail cannot be asked by mail. A named
 *    staff member who asked them in person (or holds their signed paper)
 *    records that, and the log keeps who and how.
 *
 * Either way the log gets a copy of the yes with `confirmed_at`: the words
 * they agreed to, and the yes itself, stay beside it.
 *
 * ─── When the mail goes ───────────────────────────────────────────────────
 * After a public form records a marketing yes (`people/consent-writes.ts`,
 * through a short job so the row it wrote is there to read), and when staff
 * ask for it again. At most one a day per number. A mail needs this server's
 * public address and a mail server, as every mail a stranger causes does
 * (`forms/mail.ts`); without them nothing is queued, and the console says so.
 */
import { settingsRepo, type ConsentHow, type ConsentPerson, type MetaDb } from '@adminium/meta';

import { looksLikeAddress } from '../../consent/index.js';
import type { StaffMember } from '../../consent/types.js';
import type { ConnectionManager } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk } from '../../crud/records.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { localeOfLanguage } from '../../email/audience-table.js';
import { translatorForLocale } from '../../email/builtins.js';
import { storedPublicOrigin } from '../../email/door-reach.js';
import { postalAddressOf } from '../../email/sender/marketing-settings.js';
import { enqueueEmail, TEXT_MARKETING_CONFIRM_TEMPLATE_KEY, type EmailLogger } from '../../email/send.js';
import { resolveMailSender } from '../../email/workspace-sender.js';
import { firstNameOf, formsMailBlocked } from '../../forms/mail.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { pkOfRowKey } from '../../payments/payables.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import { parsePhone } from '../../phone/index.js';
import { businessName } from '../../privacy/business.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { maskPhone } from '../consent/redact.js';
import { DOUBLE_OPT_IN_COUNTRIES } from '../consent/rules.js';
import type { TextConsentService } from '../consent/types.js';
import type { TextPhoneKeys } from '../send/path.js';
import { makeTextConfirmToken, readTextConfirmToken, textConfirmKey, textConfirmLive, textConfirmUrl, TEXT_CONFIRM_DAYS } from './confirm-token.js';
import type { TextMarketingStore } from './store.js';

const DAY_MS = 24 * 60 * 60_000;

export interface TextConfirmDeps {
  meta: MetaDb;
  secret: string;
  consent: TextConsentService;
  store: TextMarketingStore;
  /** The stop list's keyed hash of a number. */
  phoneKeys: TextPhoneKeys;
  manager: Pick<ConnectionManager, 'data'>;
  /** The business's country, to read a local number in. */
  country: () => Promise<string | null>;
  /** A database's current schema; the snapshot when absent. */
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  logger?: EmailLogger | undefined;
  now?: (() => number) | undefined;
}

/** What one person's row says, read as the system. */
export interface PersonFacts {
  phone: unknown;
  /** Their address as kept (trimmed, lower case); null when the row holds none. */
  email: string | null;
  /** Their own language as one of the eight (`de_DE`); null when the row names none. */
  locale: string | null;
  name: string | null;
}

/** Where a person's marketing yes to texts stands, for the console. */
export interface MarketingStanding {
  /** `no-phone`: the row holds no number that reads. */
  state: 'yes' | 'no' | 'not-asked' | 'stopped' | 'no-phone' | 'no-row';
  /** The yes was confirmed, or needs no confirming. */
  confirmed: boolean;
  /** The number's country expects the yes confirmed. */
  needsConfirm: boolean;
  /** The yes's words and how it was given; null without a yes. */
  yes: { at: number; source: string; wording: string | null; wordingVersion: string | null; confirmedAt: number | null } | null;
  /** The last request for a confirmation, if one was sent. */
  asked: { at: number; state: string } | null;
  /** The row holds an e-mail address a confirmation can go to. */
  canEmail: boolean;
  phone: string | null;
  country: string | null;
}

export type ConfirmRequestOutcome =
  | 'sent'
  /** One went to this number in the last day. */
  | 'held'
  /** The number's country does not expect it. */
  | 'not-needed'
  | 'already-confirmed'
  /** No marketing yes stands for this number. */
  | 'no-consent'
  | 'stopped'
  | 'no-phone'
  | 'no-row'
  /** Their row holds no e-mail address: ask them in person. */
  | 'no-email'
  | 'no-public-origin'
  | 'no-mail-server';

export type ConfirmOutcome = 'confirmed' | 'already' | 'not-needed' | 'no-consent' | 'stopped' | 'no-phone' | 'no-row' | 'superseded';

/** What a confirm link stands for now. */
export type ConfirmPageState =
  | { state: 'dead' }
  | { state: 'too-old' }
  | { state: 'already' }
  /** The yes it confirms no longer stands (a no, a STOP, a new number). */
  | { state: 'withdrawn' }
  | { state: 'waiting'; phone: string | null; language: string | null; connectionId: string | null };

export function needsConfirm(country: string | null): boolean {
  return country !== null && DOUBLE_OPT_IN_COUNTRIES.has(country);
}

export function createTextConfirm(deps: TextConfirmDeps) {
  const { meta, store, consent } = deps;
  const now = deps.now ?? Date.now;
  const key = textConfirmKey(deps.secret);

  async function install(): Promise<string> {
    const id = await settingsRepo(meta).get('system.instanceId');
    return typeof id === 'string' ? id : '';
  }

  async function viewOf(connectionId: string): Promise<SnapshotView | null> {
    if (deps.viewFor !== undefined) return deps.viewFor(connectionId);
    try {
      return await loadSnapshotView(meta, connectionId);
    } catch {
      return null;
    }
  }

  /** The person's row as it stands, read as the system; null when it is gone or its table is not people with a mobile. */
  async function factsOf(person: ConsentPerson): Promise<PersonFacts | null> {
    const view = await viewOf(person.connectionId);
    if (view === null) return null;
    let table: ResolvedTable;
    try {
      table = view.table(person.table);
    } catch {
      return null;
    }
    const declared = await peopleTablesOf(meta).of(person.connectionId, view.model, table.id);
    if (declared === null || declared.phone === undefined) return null;
    const pk = pkOfRowKey(table, person.key);
    if (pk === null) return null;
    const { db } = await deps.manager.data(person.connectionId);
    const row = (await fetchByPk(db, table, pk)) as Row | undefined;
    if (row === undefined) return null;
    const mail = declared.email === null ? null : row[declared.email];
    const name = declared.name === null ? null : row[declared.name];
    return {
      phone: row[declared.phone],
      email: typeof mail === 'string' && looksLikeAddress(mail) ? normaliseAddress(mail) : null,
      locale: declared.language === null ? null : localeOfLanguage(row[declared.language]),
      name: typeof name === 'string' ? name : null,
    };
  }

  /** The number on the row, read: null when it does not. */
  async function numberOf(facts: PersonFacts): Promise<{ e164: string; country: string } | null> {
    const parsed = parsePhone(facts.phone, await deps.country());
    return parsed.ok ? { e164: parsed.e164, country: parsed.country } : null;
  }

  async function standing(person: ConsentPerson): Promise<MarketingStanding> {
    const none = { confirmed: false, needsConfirm: false, yes: null, asked: null, canEmail: false, phone: null, country: null };
    const facts = await factsOf(person);
    if (facts === null) return { state: 'no-row', ...none };
    const number = await numberOf(facts);
    if (number === null) return { ...none, state: 'no-phone', canEmail: facts.email !== null };
    const hashes = await deps.phoneKeys.all(number.e164);
    const stopped = await consent.stop.has(number.e164, null);
    const held = await consent.standing({ phone: number.e164, person }, 'text-marketing');
    const doi = needsConfirm(number.country);
    const yes = held.state === 'yes' && held.event !== null ? held.event : null;
    const asked = await store.confirmations.latestFor(hashes, 0);
    return {
      state: stopped ? 'stopped' : held.state,
      confirmed: yes !== null && (!doi || yes.confirmedAt !== null),
      needsConfirm: doi,
      yes: yes === null ? null : { at: yes.at, source: yes.source, wording: yes.wording, wordingVersion: yes.wordingVersion, confirmedAt: yes.confirmedAt },
      asked: asked === null ? null : { at: asked.requestedAt, state: asked.state },
      canEmail: facts.email !== null,
      phone: maskPhone(number.e164),
      country: number.country,
    };
  }

  /** The mail itself (see the header). Answers whether it was queued. */
  async function mail(input: { to: string; locale: string; name: string | null; masked: string; token: string; connectionId: string }): Promise<'sent' | 'no-public-origin' | 'no-mail-server'> {
    const blocked = await formsMailBlocked(meta, deps.secret);
    if (blocked !== null) return blocked;
    const origin = await storedPublicOrigin(meta);
    if (origin === null) return 'no-public-origin';
    const { t } = await translatorForLocale(meta, input.locale);
    const sender = await resolveMailSender(meta, { connectionId: input.connectionId, templateKey: TEXT_MARKETING_CONFIRM_TEMPLATE_KEY });
    const business = sender.name ?? (await businessName(meta, { origin }));
    const first = firstNameOf(input.name);
    const greeting = first === null ? t('email:signUpConfirm.greetingPlain', { defaultValue: 'Hello,' }) : t('email:signUpConfirm.greeting', { name: first, defaultValue: 'Hello {name},' });
    const queued = await enqueueEmail(
      { meta, secret: deps.secret, ...(deps.logger === undefined ? {} : { logger: deps.logger }) },
      {
        to: input.to,
        templateKey: TEXT_MARKETING_CONFIRM_TEMPLATE_KEY,
        locale: input.locale,
        mailClass: 'service',
        sender,
        vars: { business, greeting, phone: input.masked, link: textConfirmUrl(origin, input.token), postal: sender.postal ?? (await postalAddressOf(meta)) ?? business },
        counts: { days: TEXT_CONFIRM_DAYS },
      },
    );
    return queued === null ? 'no-mail-server' : 'sent';
  }

  /** Asks a person to confirm their marketing yes by e-mail (see the header). */
  async function request(input: { person: ConsentPerson; staff?: StaffMember | null | undefined }): Promise<ConfirmRequestOutcome> {
    const facts = await factsOf(input.person);
    if (facts === null) return 'no-row';
    const number = await numberOf(facts);
    if (number === null) return 'no-phone';
    if (!needsConfirm(number.country)) return 'not-needed';
    if (await consent.stop.has(number.e164, null)) return 'stopped';
    const held = await consent.standing({ phone: number.e164, person: input.person }, 'text-marketing');
    if (held.state !== 'yes' || held.event === null) return 'no-consent';
    if (held.event.confirmedAt !== null) return 'already-confirmed';
    if (facts.email === null) return 'no-email';
    const at = now();
    const hashes = await deps.phoneKeys.all(number.e164);
    if ((await store.confirmations.latestFor(hashes, at - DAY_MS)) !== null) return 'held';
    const locale = facts.locale ?? (await recipientLocale(meta, null));
    const masked = maskPhone(number.e164);
    const row = await store.confirmations.create(
      { consentEventId: held.event.id, phone: await deps.phoneKeys.forWrite(number.e164), phoneMasked: masked, person: input.person, language: locale, requestedBy: input.staff?.id ?? null },
      at,
    );
    const token = makeTextConfirmToken(key, await install(), { confirmation: row.id, issuedAt: at });
    const sent = await mail({ to: facts.email, locale, name: facts.name, masked, token, connectionId: input.person.connectionId });
    // A request whose mail could not go is no request: it would hold the next one for a day.
    if (sent !== 'sent') await store.confirmations.markVoid(row.id);
    return sent;
  }

  /** A named staff member records that the person confirmed in person, or on paper they signed. */
  async function confirmInPerson(input: { person: ConsentPerson; staff: StaffMember; how: Extract<ConsentHow, 'in-person' | 'paper'> }): Promise<ConfirmOutcome> {
    const facts = await factsOf(input.person);
    if (facts === null) return 'no-row';
    const number = await numberOf(facts);
    if (number === null) return 'no-phone';
    if (!needsConfirm(number.country)) return 'not-needed';
    const held = await consent.standing({ phone: number.e164, person: input.person }, 'text-marketing');
    if (await consent.stop.has(number.e164, null)) return 'stopped';
    if (held.state !== 'yes' || held.event === null) return 'no-consent';
    if (held.event.confirmedAt !== null) return 'already';
    const done = await consent.confirm({ eventId: held.event.id, phone: number.e164, source: 'staff', detail: 'confirmed-in-person', how: input.how, staff: input.staff, at: now() });
    return done.outcome === 'confirmed' ? 'confirmed' : done.outcome === 'missing' ? 'superseded' : done.outcome;
  }

  /** What a link stands for now, and the request and number it is about (the page's GET: nothing changes). */
  async function read(token: string): Promise<{ state: ConfirmPageState; found: { id: string; eventId: string; person: ConsentPerson; e164: string } | null }> {
    const claim = readTextConfirmToken(key, await install(), token);
    if (claim === null) return { state: { state: 'dead' }, found: null };
    if (!textConfirmLive(claim.issuedAt, now())) return { state: { state: 'too-old' }, found: null };
    const row = await store.confirmations.byId(claim.confirmation);
    // Erased, or a request whose mail never went.
    if (row === null || row.person === null || row.state === 'void') return { state: { state: 'too-old' }, found: null };
    if (row.state === 'confirmed') return { state: { state: 'already' }, found: null };
    const facts = await factsOf(row.person);
    const number = facts === null ? null : await numberOf(facts);
    // The row must still hold the number the yes was given for: a number changed since confirms nobody.
    const hashes = number === null ? [] : await deps.phoneKeys.all(number.e164);
    if (number === null || !hashes.some((one) => one.hash === row.phone.hash && one.version === row.phone.version)) return { state: { state: 'withdrawn' }, found: null };
    const held = await consent.standing({ phone: number.e164, person: row.person }, 'text-marketing');
    if ((await consent.stop.has(number.e164, null)) || held.event?.id !== row.consentEventId) {
      return { state: held.state === 'yes' && held.event?.confirmedAt != null ? { state: 'already' } : { state: 'withdrawn' }, found: null };
    }
    return {
      state: { state: 'waiting', phone: row.phoneMasked, language: row.language, connectionId: row.person.connectionId },
      found: { id: row.id, eventId: row.consentEventId, person: row.person, e164: number.e164 },
    };
  }

  /** The button's POST: confirms once. Two presses at the same moment confirm once. */
  async function confirmByLink(token: string, from: { ip: string | null; userAgent: string | null }): Promise<ConfirmPageState | { state: 'done'; language: string | null }> {
    const { state, found } = await read(token);
    if (state.state !== 'waiting' || found === null) return state;
    const at = now();
    if (!(await store.confirmations.markConfirmed(found.id, from, at))) return { state: 'already' };
    const done = await consent.confirm({ eventId: found.eventId, phone: found.e164, source: 'form', detail: 'confirmed-by-email', ip: from.ip, userAgent: from.userAgent, at });
    if (done.outcome === 'confirmed' || done.outcome === 'already') return { state: 'done', language: state.language };
    // Withdrawn in the moment between the read and the write: the request says so, and nothing counts as a yes.
    await store.confirmations.markVoid(found.id);
    return { state: 'withdrawn' };
  }

  return { factsOf, standing, request, confirmInPerson, read, confirmByLink };
}

export type TextConfirm = ReturnType<typeof createTextConfirm>;
