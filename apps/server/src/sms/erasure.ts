// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an erasure does to a phone number: the stop entry kept as a hash alone,
 * the consent log, stored inbound events, delivery records, and any job error
 * that quotes the number.
 *
 * `everywhere: false` is an erasure narrowed to some apps. It takes only the
 * log rows on the person's own row: the stop list and the stores matched by
 * the number alone are the whole workspace's.
 *
 * The sealed payload of an `sms.send` job goes with its delivery row: it is
 * found by the delivery id beside the envelope, so no other person's envelope
 * is opened, and what is left can never be sent.
 */
import type { ConsentPerson, MetaDb } from '@adminium/meta';

import type { InboundCore } from '../inbound/index.js';
import { parsePhone } from '../phone/index.js';
import { quotesPhone } from './consent/redact.js';
import { textSubject } from './consent/service.js';
import type { TextConsentService } from './consent/types.js';
import type { TextPhoneKeys } from './send/path.js';
import type { TextSendStore } from './send/store.js';

const E164_SHAPE = /^\+[1-9][0-9]{6,14}$/;
const JOB_BATCH = 500;

export interface TextEraseRequest {
  phone: unknown;
  country: string | null;
  person: ConsentPerson | null;
  at: number;
  everywhere: boolean;
}

export interface TextErased {
  stopEntry: number;
  consentRows: number;
  inboundEvents: number;
  deliveries: number;
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
  phoneKeys: TextPhoneKeys;
  country: () => Promise<string | null>;
}

function exactNumber(value: unknown, country: string | null): string | null {
  const phone = parsePhone(value, country);
  if (phone.ok) return phone.e164;
  return typeof value === 'string' && E164_SHAPE.test(value) ? value : null;
}

export function createTextErasure(deps: TextErasureDeps): TextErasure {
  return {
    country: deps.country,
    exact: exactNumber,

    async erase({ phone, country, person, at, everywhere }) {
      if (!everywhere) {
        if (person === null) return { stopEntry: 0, consentRows: 0, inboundEvents: 0, deliveries: 0 };
        const narrowed = await deps.consent.erase({ phone: null, person, at });
        return { stopEntry: 0, consentRows: narrowed.consentRows, inboundEvents: 0, deliveries: 0 };
      }
      // The stop entry first: an event erased while still pending is honoured only because of it.
      const result = await deps.consent.erase({ phone, country, person, at });
      const stopEntry = result.stopList === 'erased' || result.stopList === 'added' ? 1 : 0;
      const e164 = exactNumber(phone, country);
      if (e164 === null) return { stopEntry, consentRows: result.consentRows, inboundEvents: 0, deliveries: 0 };
      const { events } = await deps.inbound.erase({ subject: textSubject(e164) });
      const deliveries = await deps.deliveries.eraseFor(await deps.phoneKeys.all(e164));
      return { stopEntry, consentRows: result.consentRows, inboundEvents: events, deliveries };
    },

    async count({ phone, country, person, everywhere }) {
      const e164 = everywhere ? exactNumber(phone, country) : null;
      const history = await deps.consent.history({ phone: e164, country, person }, { limit: 500 });
      if (e164 === null) return { stopEntry: 0, consentRows: history.length, inboundEvents: 0, deliveries: 0 };
      return {
        stopEntry: (await deps.consent.stop.entryFor(e164, country)) === null ? 0 : 1,
        consentRows: history.length,
        inboundEvents: await deps.inbound.countFrom(textSubject(e164)),
        deliveries: await deps.deliveries.countFor(await deps.phoneKeys.all(e164)),
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
