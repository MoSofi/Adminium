// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an erasure does to a phone number: the stop entry kept as a hash alone,
 * the consent log, stored inbound events, delivery records, the conversations
 * with the number and every message in them, and any job error that quotes the
 * number.
 *
 * A number another person's row still holds is a shared or reassigned line
 * (`shared`): only what links to the erased person goes, and the stop entry
 * keeps its hash. Either way, another person's yes on the number stays.
 *
 * `everywhere: false` is an erasure narrowed to some apps. It takes only the
 * log rows on the person's own row: the stop list and the stores matched by
 * the number alone are the whole workspace's.
 *
 * A marketing run's record of the person and a request to confirm their
 * marketing yes go by the number and by their row alike: each names both.
 *
 * The sealed payload of an `sms.send` job goes with its delivery row: it is
 * found by the delivery id beside the envelope, so no other person's envelope
 * is opened, and what is left can never be sent.
 */
import type { AddressHash, ConsentPerson, MetaDb } from '@adminium/meta';

import type { InboundCore } from '../inbound/index.js';
import { parsePhone } from '../phone/index.js';
import { quotesPhone } from './consent/redact.js';
import { textSubject } from './consent/service.js';
import type { TextConsentService } from './consent/types.js';
import type { TextPhoneKeys } from './send/path.js';
import type { TextSendStore } from './send/store.js';
import type { TextThreads } from './threads/service.js';

const E164_SHAPE = /^\+[1-9][0-9]{6,14}$/;
const JOB_BATCH = 500;

export interface TextEraseRequest {
  phone: unknown;
  country: string | null;
  person: ConsentPerson | null;
  at: number;
  everywhere: boolean;
  /**
   * Another person's row still holds this number (a shared or reassigned line). Then only what links to the
   * erased person goes: their consent rows, the person-less ones of the number, and the conversations about
   * these rows of theirs. The number's other conversations, its delivery records and its stored events stay.
   */
  shared?: { theirs: readonly ConsentPerson[] } | undefined;
}

export interface TextErased {
  stopEntry: number;
  consentRows: number;
  inboundEvents: number;
  deliveries: number;
  /** The person's rows of marketing runs, and their requests to confirm a marketing yes. */
  marketing: number;
  /** Conversation messages, and the threads that held them. */
  conversations: number;
}

/** What the erasure asks of the marketing store (`sms/marketing/store.ts`). */
export interface MarketingErasure {
  eraseFor(who: { hashes: readonly AddressHash[]; person?: ConsentPerson | null | undefined }): Promise<number>;
  countFor(who: { hashes: readonly AddressHash[]; person?: ConsentPerson | null | undefined }): Promise<number>;
}

export interface TextErasure {
  /** The country a local number is read in. */
  country(): Promise<string | null>;
  /** The exact number, or null. */
  exact(value: unknown, country: string | null): string | null;
  erase(request: TextEraseRequest): Promise<TextErased>;
  /** What {@link TextErasure.erase} would take. Writes nothing. */
  count(request: Omit<TextEraseRequest, 'at'>): Promise<TextErased>;
  /** Empties every job's last error that quotes one of these numbers. Answers how many. */
  clearQuotedErrors(numbers: readonly string[], country: string | null): Promise<number>;
}

export interface TextErasureDeps {
  meta: MetaDb;
  consent: TextConsentService;
  inbound: Pick<InboundCore, 'erase' | 'countFrom'>;
  deliveries: Pick<TextSendStore, 'eraseFor' | 'countFor'>;
  /** Conversations; none are kept without it. */
  threads?: Pick<TextThreads, 'eraseFor' | 'countFor' | 'eraseForRecords' | 'countForRecords'> | undefined;
  phoneKeys: TextPhoneKeys;
  country: () => Promise<string | null>;
  marketing?: MarketingErasure | undefined;
}

const samePerson = (a: ConsentPerson, b: ConsentPerson): boolean => a.connectionId === b.connectionId && a.table === b.table && a.key === b.key;

function exactNumber(value: unknown, country: string | null): string | null {
  const phone = parsePhone(value, country);
  if (phone.ok) return phone.e164;
  return typeof value === 'string' && E164_SHAPE.test(value) ? value : null;
}

export function createTextErasure(deps: TextErasureDeps): TextErasure {
  return {
    country: deps.country,
    exact: exactNumber,

    async erase({ phone, country, person, at, everywhere, shared }) {
      if (!everywhere) {
        if (person === null) return { stopEntry: 0, consentRows: 0, inboundEvents: 0, deliveries: 0, marketing: 0, conversations: 0 };
        const narrowed = await deps.consent.erase({ phone: null, person, at });
        const marketing = (await deps.marketing?.eraseFor({ hashes: [], person })) ?? 0;
        return { stopEntry: 0, consentRows: narrowed.consentRows, inboundEvents: 0, deliveries: 0, marketing, conversations: 0 };
      }
      // The stop entry first: an event erased while still pending is honoured only because of it.
      const result = await deps.consent.erase({ phone, country, person, at });
      const stopEntry = result.stopList === 'erased' || result.stopList === 'added' ? 1 : 0;
      const e164 = exactNumber(phone, country);
      const hashes = e164 === null ? [] : await deps.phoneKeys.all(e164);
      if (e164 !== null && shared !== undefined) {
        // A shared line: the number's own stores are the other person's too.
        const marketing = (await deps.marketing?.eraseFor({ hashes: [], person })) ?? 0;
        const threads = (await deps.threads?.eraseForRecords(e164, shared.theirs)) ?? { threads: 0, messages: 0 };
        return { stopEntry, consentRows: result.consentRows, inboundEvents: 0, deliveries: 0, marketing, conversations: threads.messages + threads.threads };
      }
      const marketing = (await deps.marketing?.eraseFor({ hashes, person })) ?? 0;
      if (e164 === null) return { stopEntry, consentRows: result.consentRows, inboundEvents: 0, deliveries: 0, marketing, conversations: 0 };
      const { events } = await deps.inbound.erase({ subject: textSubject(e164) });
      // The conversations before the deliveries: a thread shows an app's texts by reading them.
      const threads = (await deps.threads?.eraseFor(e164)) ?? { threads: 0, messages: 0 };
      const deliveries = await deps.deliveries.eraseFor(hashes);
      return { stopEntry, consentRows: result.consentRows, inboundEvents: events, deliveries, marketing, conversations: threads.messages + threads.threads };
    },

    async count({ phone, country, person, everywhere, shared }) {
      const e164 = everywhere ? exactNumber(phone, country) : null;
      // What the erasure takes of the log: the rows on their row, and the number's rows that name nobody.
      const history = (await deps.consent.history({ phone: e164, country, person }, { limit: 500 })).filter((event) => event.person === null || (person !== null && samePerson(event.person, person)));
      const hashes = e164 === null ? [] : await deps.phoneKeys.all(e164);
      if (e164 !== null && shared !== undefined) {
        const marketing = (await deps.marketing?.countFor({ hashes: [], person })) ?? 0;
        const threads = (await deps.threads?.countForRecords(e164, shared.theirs)) ?? { threads: 0, messages: 0 };
        return { stopEntry: (await deps.consent.stop.entryFor(e164, country)) === null ? 0 : 1, consentRows: history.length, inboundEvents: 0, deliveries: 0, marketing, conversations: threads.messages + threads.threads };
      }
      const marketing = (await deps.marketing?.countFor({ hashes, person })) ?? 0;
      if (e164 === null) return { stopEntry: 0, consentRows: history.length, inboundEvents: 0, deliveries: 0, marketing, conversations: 0 };
      const threads = (await deps.threads?.countFor(e164)) ?? { threads: 0, messages: 0 };
      return {
        stopEntry: (await deps.consent.stop.entryFor(e164, country)) === null ? 0 : 1,
        consentRows: history.length,
        inboundEvents: await deps.inbound.countFrom(textSubject(e164)),
        deliveries: await deps.deliveries.countFor(hashes),
        marketing,
        conversations: threads.messages + threads.threads,
      };
    },

    async clearQuotedErrors(numbers, country) {
      if (numbers.length === 0) return 0;
      const { db } = deps.meta;
      let changed = 0;
      let after: string | null = null;
      for (;;) {
        let query = db.selectFrom('adminium_jobs').select(['id', 'lastError']).where('lastError', 'is not', null);
        if (after !== null) query = query.where('id', '>', after);
        const rows = await query.orderBy('id', 'asc').limit(JOB_BATCH).execute();
        const hit = rows.filter((row) => typeof row.lastError === 'string' && numbers.some((number) => quotesPhone(row.lastError as string, number, country))).map((row) => row.id);
        if (hit.length > 0) {
          await db.updateTable('adminium_jobs').set({ lastError: null }).where('id', 'in', hit).execute();
          changed += hit.length;
        }
        if (rows.length < JOB_BATCH) return changed;
        after = rows.at(-1)!.id;
      }
    },
  };
}
