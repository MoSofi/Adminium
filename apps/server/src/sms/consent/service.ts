// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TEXT CONSENT SERVICE — the only door to the text stop list and log.
 *
 * ─── What a number is ──────────────────────────────────────────────────────
 * One exact E.164 number from `parsePhone`, hashed through the address keys as
 * `tel:<e164>` (the E.164 form brings its own `+`). A phone can never equal an
 * e-mail hash, and no looser match exists here.
 *
 * ─── What a yes covers ─────────────────────────────────────────────────────
 * A yes is for one purpose on one exact number. A row's yes does not follow it
 * to a new number, because numbers get reassigned. A no on the row covers
 * every number the row ever had.
 *
 * ─── STOP and START ────────────────────────────────────────────────────────
 * A STOP puts the number on the list, for every sender, and writes a no for
 * both purposes in one transaction. So when a START later lifts the entry, the
 * earlier yes has been superseded and the business needs a fresh one. A START
 * is never a yes, and a new yes never lifts an entry.
 *
 * A number from a provider is taken on its shape even when the phone library
 * does not know its range yet. A real person's STOP is never dropped because
 * our data is older than their number.
 */
import type { AddressHash, ConsentPerson, MetaDb } from '@adminium/meta';

import { decryptSecret, encryptSecret, SecretFormatError, SecretIntegrityError } from '../../config/secrets.js';
import { AddressKeysLockedError, addressKeyRing, TEXT_STOP_PHONE_PURPOSE } from '../../consent/keys.js';
import { ValidationFailedError } from '../../errors.js';
import { parsePhone } from '../../phone/index.js';
import { maskPhone, redactPhones } from './redact.js';
import { DOUBLE_OPT_IN_COUNTRIES, judgeBeforeLookup, optOutFor } from './rules.js';
import { createTextConsentStore, type TextConsentStore } from './store.js';
import { TEXT_PURPOSES, type TextConsentEvent, type TextConsentInput, type TextConsentScope, type TextConsentService, type TextConsentSource, type TextPurpose, type TextStanding, type TextStopReason, type TextStopRecord, type TextStopView, type TextWho } from './types.js';

export interface TextConsentDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`, which opens the address keys. */
  secret: string;
  /** Where it is kept; the real tables when left out. */
  store?: TextConsentStore | undefined;
  /**
   * The app whose table a row is in, or null for none. Asked only for a scoped
   * question (`TextConsentScope`); without it, a yes given on a row counts for
   * that row alone.
   */
  appOf?: ((person: ConsentPerson) => Promise<string | null>) | undefined;
  now?: () => number;
}

/** How far back a scoped question looks for its own yes behind another app's. */
const SCOPED_LOOKBACK = 200;

const samePerson = (a: ConsentPerson, b: ConsentPerson): boolean => a.connectionId === b.connectionId && a.table === b.table && a.key === b.key;

/** E.164's own shape: what a provider hands over. */
const E164_SHAPE = /^\+[1-9][0-9]{6,14}$/;

/** What a number is hashed as. */
export function textSubject(e164: string): string {
  if (!E164_SHAPE.test(e164)) throw new ValidationFailedError('That is not an exact phone number.', { field: 'phone' });
  return `tel:${e164}`;
}

/** The purpose the sealed display copy's key is taken for: it lives on the address key, so a changed secret keeps it readable. */
const SEAL_PURPOSE = TEXT_STOP_PHONE_PURPOSE;

const SOURCE_OF: Readonly<Record<Exclude<TextStopReason, 'erased'>, TextConsentSource>> = { 'text-stop': 'reply', 'provider-opt-out': 'provider', staff: 'staff' };

/** Only a person's own STOP, as a reply or a provider's record of one, can be lifted by their START. */
const LIFTED_BY_START: ReadonlySet<TextStopReason> = new Set(['text-stop', 'provider-opt-out']);

const notAPhone = (): ValidationFailedError => new ValidationFailedError('That is not a phone number a text can reach.', { field: 'phone' });

/** The exact number, or null. A reply or a provider event may hold a real number in a range our data does not know. */
function exactNumber(value: unknown, country: string | null | undefined): string | null {
  const phone = parsePhone(value, country ?? null);
  if (phone.ok) return phone.e164;
  return typeof value === 'string' && E164_SHAPE.test(value) ? value : null;
}

const keepClean = (text: string | null | undefined): string | null => (text === null || text === undefined ? null : redactPhones(text));

function cursorOf(entry: { addedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([entry.addedAt, entry.id])).toString('base64url');
}

function readCursor(cursor: string | null | undefined): { addedAt: number; id: string } | undefined {
  if (cursor === null || cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string') return { addedAt: parsed[0], id: parsed[1] };
  } catch {
    // Not one of ours: refused below.
  }
  throw new ValidationFailedError('That page cursor is not one this list gave.', { field: 'cursor' });
}

export function createTextConsentService(deps: TextConsentDeps): TextConsentService {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createTextConsentStore(deps.meta);
  const ring = addressKeyRing(deps.meta, deps.secret);

  async function seal(e164: string): Promise<string> {
    return encryptSecret(e164, Buffer.from(await ring.derivedForWrite(SEAL_PURPOSE), 'hex'));
  }

  async function open(token: string): Promise<string> {
    for (const key of await ring.derivedAll(SEAL_PURPOSE)) {
      try {
        return decryptSecret(token, Buffer.from(key, 'hex'));
      } catch (error) {
        if (!(error instanceof SecretIntegrityError || error instanceof SecretFormatError)) throw error;
      }
    }
    throw new AddressKeysLockedError();
  }

  async function viewOf(entry: TextStopRecord): Promise<TextStopView> {
    const phone = entry.phoneEncrypted === null ? null : await open(entry.phoneEncrypted);
    return {
      id: entry.id,
      phone,
      masked: phone === null ? null : maskPhone(phone),
      reason: entry.reason,
      origin: entry.origin,
      addedAt: entry.addedAt,
      addedBy: entry.addedById === null ? null : { id: entry.addedById, label: entry.addedByLabel ?? '' },
      erasedAt: entry.erasedAt,
    };
  }

  async function hashesOf(phone: unknown, country: string | null | undefined): Promise<AddressHash[]> {
    const e164 = exactNumber(phone, country);
    return e164 === null ? [] : ring.hashesOf(textSubject(e164));
  }

  /** The number's own latest answer, unless a later no on the row overrules it. At the same moment, the no wins. */
  async function standingOn(hashes: readonly AddressHash[], person: TextWho['person'], purpose: TextPurpose): Promise<TextStanding> {
    const own = await store.log.latestForPhone(hashes, purpose);
    const rowNo = person == null ? null : await store.log.latestNoForPerson(person, purpose);
    if (rowNo !== null && (own === null || rowNo.at >= own.at)) return { purpose, state: 'no', event: rowNo };
    if (own === null) return { purpose, state: 'not-asked', event: null };
    return { purpose, state: own.state === 'yes' ? 'yes' : 'no', event: own };
  }

  /** Whether a yes is one this scope counts: no row, the record itself, or a row of the scope's app. */
  async function counts(event: TextConsentEvent, scope: TextConsentScope, app: () => Promise<string | null>): Promise<boolean> {
    if (event.person === null) return true;
    if (scope.record != null && samePerson(event.person, scope.record)) return true;
    const own = await app();
    if (own === null || deps.appOf === undefined) return false;
    return (await deps.appOf(event.person)) === own;
  }

  /**
   * The standing, counting only a yes the scope counts. Behind another app's
   * newer yes, an older one of its own still stands while no no came after it.
   */
  async function standingIn(hashes: readonly AddressHash[], person: TextWho['person'], purpose: TextPurpose, scope: TextConsentScope | undefined): Promise<TextStanding> {
    const standing = await standingOn(hashes, person, purpose);
    if (scope === undefined || standing.state !== 'yes' || standing.event === null) return standing;
    let resolved: Promise<string | null> | undefined;
    const app = (): Promise<string | null> => {
      resolved ??= scope.app !== undefined ? Promise.resolve(scope.app === '' ? null : scope.app) : scope.record != null && deps.appOf !== undefined ? deps.appOf(scope.record) : Promise.resolve(null);
      return resolved;
    };
    if (await counts(standing.event, scope, app)) return standing;
    const rowNo = person == null ? null : await store.log.latestNoForPerson(person, purpose);
    const events = (await store.log.history({ hashes }, SCOPED_LOOKBACK))
      .filter((event) => event.purpose === purpose && (event.state === 'yes' || event.state === 'no'))
      // At the same moment, the no first.
      .sort((a, b) => b.at - a.at || Number(a.state === 'yes') - Number(b.state === 'yes'));
    for (const event of events) {
      if (event.state === 'no' || (rowNo !== null && rowNo.at >= event.at)) break;
      if (await counts(event, scope, app)) return { purpose, state: 'yes', event };
    }
    return { purpose, state: 'not-asked', event: null };
  }

  function checkAnswer(input: TextConsentInput & { state: 'yes' | 'no' }): void {
    if (!TEXT_PURPOSES.includes(input.purpose)) throw new ValidationFailedError('That is not a text consent purpose.', { field: 'purpose' });
    if (input.source !== 'form' && input.source !== 'staff' && input.source !== 'person') throw new ValidationFailedError('That source cannot record a text answer.', { field: 'source' });
    if (input.source === 'staff' && input.staff == null) throw new ValidationFailedError('A staff record names the staff member.', { field: 'staff' });
    if (input.state !== 'yes') return;
    if (input.source === 'person') throw new ValidationFailedError('A yes to texts comes from a form or a staff record.', { field: 'source' });
    if (input.wording == null || input.wording.text.trim() === '' || input.wording.version.trim() === '') {
      throw new ValidationFailedError('A yes to texts keeps the words the person was shown, and their version.', { field: 'wording' });
    }
  }

  return {
    async decide(request) {
      const judged = judgeBeforeLookup(parsePhone(request.phone, request.country), request);
      if (!judged.pass) return judged.refusal;
      const { phone, purpose } = judged;

      const hashes = await ring.hashesOf(textSubject(phone.e164));
      if ((await store.stop.findAny(hashes)).length > 0) return { send: false, reason: 'stopped' };
      // They wrote first, and this answers them: what they asked for needs no yes of its own. A later no still wins.
      if (request.answering === true && request.class === 'service' && (await standingOn(hashes, request.person, purpose)).state !== 'no') {
        return { send: true, e164: phone.e164, country: phone.country, optOut: optOutFor(phone, request) };
      }

      const standing = await standingIn(hashes, request.person, purpose, request.scope);
      if (standing.state !== 'yes') return { send: false, reason: 'no-consent' };
      if (request.class === 'marketing' && DOUBLE_OPT_IN_COUNTRIES.has(phone.country) && standing.event?.confirmedAt == null) {
        return { send: false, reason: 'unconfirmed-consent' };
      }
      return { send: true, e164: phone.e164, country: phone.country, optOut: optOutFor(phone, request) };
    },

    async record(input) {
      checkAnswer(input);
      const given = input.phone !== null && input.phone !== undefined;
      let e164: string | null = null;
      if (given && input.state === 'yes') {
        // A yes is about one number we can read. A no is kept for anything shaped like one.
        const phone = parsePhone(input.phone, input.country ?? null);
        e164 = phone.ok ? phone.e164 : null;
      } else if (given) {
        e164 = exactNumber(input.phone, input.country);
      }
      if (e164 === null && (input.state === 'yes' || input.person == null)) throw notAPhone();
      const staffed = input.source === 'staff';
      return store.log.append({
        person: input.person ?? null,
        phone: e164 === null ? null : await ring.hashForWrite(textSubject(e164)),
        purpose: input.purpose,
        state: input.state,
        source: input.source,
        detail: keepClean(input.detail),
        how: staffed ? (input.how ?? null) : null,
        note: staffed ? keepClean(input.note) : null,
        staffId: staffed ? input.staff!.id : null,
        staffLabel: staffed ? input.staff!.label : null,
        wording: input.wording?.text ?? null,
        wordingVersion: input.wording?.version ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        at: input.at ?? now(),
        confirmedAt: input.confirmedAt ?? null,
      });
    },

    async confirm(input) {
      const e164 = exactNumber(input.phone, input.country);
      if (e164 === null) return { outcome: 'missing' };
      if (input.source === 'staff' && input.staff == null) throw new ValidationFailedError('A staff record names the staff member.', { field: 'staff' });
      const subject = textSubject(e164);
      const hashes = await ring.hashesOf(subject);
      const event = await store.log.byId(input.eventId);
      const sameNumber = event?.phone != null && hashes.some((one) => one.hash === event.phone!.hash && one.version === event.phone!.version);
      if (event === null || !sameNumber || event.purpose !== 'text-marketing' || event.state !== 'yes') return { outcome: 'missing' };
      if ((await store.stop.findAny(hashes)).length > 0) return { outcome: 'stopped' };
      const standing = await standingOn(hashes, event.person, 'text-marketing');
      if (standing.event?.id !== event.id) {
        // Its own confirmation stands: pressed twice, or confirmed by staff meanwhile.
        const own = standing.state === 'yes' && standing.event?.confirmedAt != null && standing.event.wording === event.wording && standing.event.wordingVersion === event.wordingVersion;
        return { outcome: own ? 'already' : 'superseded' };
      }
      if (event.confirmedAt !== null) return { outcome: 'already' };
      const at = input.at ?? now();
      const staffed = input.source === 'staff';
      const confirmed = await store.log.append({
        person: event.person,
        phone: await ring.hashForWrite(subject),
        purpose: 'text-marketing',
        state: 'yes',
        source: input.source,
        detail: keepClean(input.detail),
        how: staffed ? (input.how ?? null) : null,
        note: null,
        staffId: staffed ? input.staff!.id : null,
        staffLabel: staffed ? input.staff!.label : null,
        // The words the person agreed to: the yes being confirmed is about them, and nothing else.
        wording: event.wording,
        wordingVersion: event.wordingVersion,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        at: Math.max(at, event.at),
        confirmedAt: at,
      });
      return { outcome: 'confirmed', event: confirmed };
    },

    async standing(who, purpose, scope) {
      return standingIn(await hashesOf(who.phone, who.country), who.person, purpose, scope);
    },

    async history(who, opts = {}) {
      return store.log.history({ person: who.person, hashes: await hashesOf(who.phone, who.country) }, Math.min(Math.max(opts.limit ?? 100, 1), 500));
    },

    async erase(input) {
      const at = input.at ?? now();
      const given = input.phone !== null && input.phone !== undefined && input.phone !== '';
      const e164 = given ? exactNumber(input.phone, input.country) : null;
      const hashes = e164 === null ? [] : await ring.hashesOf(textSubject(e164));
      const fresh = e164 === null ? null : await ring.hashForWrite(textSubject(e164));
      // Read before the transaction: on MySQL a read inside it would fix the snapshot the write's own read needs.
      const entries = await store.stop.findAny(hashes);
      return store.transaction(async (tx) => {
        let stopList: 'erased' | 'added' | 'none' | 'unreadable' = given ? 'unreadable' : 'none';
        if (fresh !== null) {
          for (const entry of entries) await tx.stop.eraseDisplay(entry.id, at);
          stopList = 'erased';
          if (entries.length === 0) {
            const { entry, added } = await tx.stop.add({ phone: fresh, phoneEncrypted: null, reason: 'erased', origin: null, addedAt: at, addedById: null, addedByLabel: null, erasedAt: at });
            // Written by another door in the same instant: it keeps the hash alone too.
            if (entry.phoneEncrypted !== null) await tx.stop.eraseDisplay(entry.id, at);
            stopList = added ? 'added' : 'erased';
          }
        }
        return { stopList, consentRows: await tx.log.deleteFor({ person: input.person, hashes }) };
      });
    },

    stop: {
      async add(input) {
        if (input.reason !== 'text-stop' && input.reason !== 'provider-opt-out' && input.reason !== 'staff') {
          throw new ValidationFailedError('An erased person is put on the list by the erasure.', { field: 'reason' });
        }
        if (input.reason === 'staff' && input.staff == null) throw new ValidationFailedError('A staff record names the staff member.', { field: 'staff' });
        const e164 = exactNumber(input.phone, input.country);
        if (e164 === null) throw notAPhone();
        const subject = textSubject(e164);
        // Read before the transaction: on MySQL a read inside it would fix the snapshot the write's own read needs.
        const existing = (await store.stop.findAny(await ring.hashesOf(subject)))[0];
        const hash = await ring.hashForWrite(subject);
        const sealed = await seal(e164);
        const at = input.at ?? now();
        const origin = keepClean(input.origin);
        const source = SOURCE_OF[input.reason];
        const staff = input.reason === 'staff' ? input.staff! : null;
        const { entry, added } = await store.transaction(async (tx) => {
          for (const purpose of TEXT_PURPOSES) {
            await tx.log.append({
              person: input.person ?? null,
              phone: hash,
              purpose,
              state: 'no',
              source,
              detail: origin,
              how: null,
              note: null,
              staffId: staff?.id ?? null,
              staffLabel: staff?.label ?? null,
              wording: null,
              wordingVersion: null,
              ip: null,
              userAgent: null,
              at,
              confirmedAt: null,
            });
          }
          // Under the entry's own hash when there is one, so a START that lifted it a moment ago cannot lose this STOP.
          return tx.stop.add({ phone: existing?.phone ?? hash, phoneEncrypted: sealed, reason: input.reason, origin, addedAt: at, addedById: staff?.id ?? null, addedByLabel: staff?.label ?? null, erasedAt: null });
        });
        return { entry: await viewOf(entry), added };
      },

      async start(input) {
        const e164 = exactNumber(input.phone, null);
        if (e164 === null) return 'unreadable';
        const subject = textSubject(e164);
        const entries = await store.stop.findAny(await ring.hashesOf(subject));
        if (entries.length === 0) return 'not-on-list';
        if (entries.some((entry) => entry.phoneEncrypted === null || !LIFTED_BY_START.has(entry.reason))) return 'kept';
        const hash = await ring.hashForWrite(subject);
        const at = input.at ?? now();
        await store.transaction(async (tx) => {
          for (const entry of entries) await tx.stop.remove(entry.id);
          await tx.log.append({ person: null, phone: hash, purpose: null, state: 'start', source: 'reply', detail: null, how: null, note: null, staffId: null, staffLabel: null, wording: null, wordingVersion: null, ip: null, userAgent: null, at, confirmedAt: null });
        });
        return 'lifted';
      },

      async remove(id) {
        const entry = await store.stop.byId(id);
        if (entry === null) return 'missing';
        // An erased person's objection outlives them: nobody takes it off.
        if (entry.phoneEncrypted === null) return 'erased';
        return (await store.stop.remove(id)) ? 'removed' : 'missing';
      },

      async has(phone, country) {
        const e164 = exactNumber(phone, country);
        // A value that names no exact number is not known to be free.
        if (e164 === null) return true;
        return (await store.stop.findAny(await ring.hashesOf(textSubject(e164)))).length > 0;
      },

      async entryFor(phone, country) {
        const hashes = await hashesOf(phone, country);
        const entries = await store.stop.findAny(hashes);
        // Under two versions at once: the one still holding its number first.
        const entry = entries.sort((a, b) => Number(a.phoneEncrypted === null) - Number(b.phoneEncrypted === null))[0];
        return entry === undefined ? null : viewOf(entry);
      },

      async list(opts) {
        const limit = Math.min(Math.max(opts.limit, 1), 200);
        const rows = await store.stop.page({ limit: limit + 1, after: readCursor(opts.cursor), reason: opts.reason });
        const shown = rows.slice(0, limit);
        return { entries: await Promise.all(shown.map(viewOf)), next: rows.length > limit ? cursorOf(shown.at(-1)!) : null };
      },
    },
  };
}
