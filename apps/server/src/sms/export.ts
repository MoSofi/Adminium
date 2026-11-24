// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's text records, for "Download everything": what an access request
 * owes them about the texts, found by every number on their rows (and by the
 * number they were asked for by).
 *
 *   texts-consent     each yes and no to texts, with the words they were shown,
 *                     where it came from, and when: theirs, and the number's
 *                     rows that name nobody, never another person's
 *   texts-stop-list   the stop entry of each number, when there is one
 *   texts-messages    their conversations, every message in clear
 *   texts-deliveries  each text sent to the number: when, which app and
 *                     template, and what became of it (its words are never kept)
 *
 * A request narrowed to some apps (an app's role, `privacy/scope.ts`) takes
 * only what those apps hold: the consent rows on the person's own rows, and
 * those apps' conversations and texts. The stop list and the rows matched by
 * the number alone are the whole workspace's, as the erasure treats them.
 */
import type { ConsentPerson, MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { addressKeyRing } from '../consent/keys.js';
import type { AppScope } from '../privacy/scope.js';
import { textSubject } from './consent/service.js';
import type { TextConsentEvent, TextConsentService } from './consent/types.js';
import type { TextThreads } from './threads/service.js';

/** One file of the download: its name without the extension, and its rows. */
export interface TextRecordsFile {
  id: 'texts-consent' | 'texts-stop-list' | 'texts-messages' | 'texts-deliveries';
  rows: Record<string, unknown>[];
}

export interface TextExportTarget {
  phone: unknown;
  /** The row the number is on; null for the number asked for by. */
  person: ConsentPerson | null;
}

export interface TextExport {
  /** The country a local number is read in. */
  country(): Promise<string | null>;
  /** The exact number, or null. */
  exact(value: unknown, country: string | null): string | null;
  recordsFor(input: { targets: readonly TextExportTarget[]; country: string | null; apps: AppScope }): Promise<TextRecordsFile[]>;
}

export interface TextExportDeps {
  meta: MetaDb;
  secret: string;
  consent: Pick<TextConsentService, 'history' | 'stop'>;
  threads: Pick<TextThreads, 'exportFor'>;
  country: () => Promise<string | null>;
  exact: (value: unknown, country: string | null) => string | null;
}

interface DeliveryTable {
  adminium_text_deliveries: { id: string; phoneHash: string | null; keyVersion: number | null; textClass: string; state: string; reason: string | null; aboutApp: string | null; aboutTemplate: string | null; createdAt: number };
}

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

function consentRow(number: string | null, event: TextConsentEvent): Record<string, unknown> {
  return {
    at: iso(event.at),
    number,
    purpose: event.purpose,
    answer: event.state,
    source: event.source,
    detail: event.detail,
    how: event.how,
    note: event.note,
    recordedBy: event.staffLabel,
    wording: event.wording,
    wordingVersion: event.wordingVersion,
    ip: event.ip,
    userAgent: event.userAgent,
    confirmedAt: iso(event.confirmedAt),
  };
}

export function createTextExport(deps: TextExportDeps): TextExport {
  const ring = addressKeyRing(deps.meta, deps.secret);
  const db = deps.meta.db as unknown as Kysely<DeliveryTable>;

  async function deliveriesOf(e164: string, apps: AppScope): Promise<Record<string, unknown>[]> {
    const hashes = await ring.hashesOf(textSubject(e164));
    if (hashes.length === 0) return [];
    const rows = await db
      .selectFrom('adminium_text_deliveries')
      .select(['textClass', 'state', 'reason', 'aboutApp', 'aboutTemplate', 'createdAt'])
      .where((eb) => eb.or(hashes.map((one) => eb.and([eb(sql.ref('phoneHash'), '=', one.hash), eb(sql.ref('keyVersion'), '=', one.version)]))))
      .orderBy('createdAt', 'asc')
      .execute();
    return rows
      .filter((row) => apps === null || (row.aboutApp !== null && apps.has(row.aboutApp)))
      .map((row) => ({ at: iso(Number(row.createdAt)), number: e164, app: row.aboutApp, template: row.aboutTemplate, kind: row.textClass, state: row.state, reason: row.reason }));
  }

  return {
    country: deps.country,
    exact: deps.exact,

    async recordsFor({ targets, country, apps }) {
      const whole = apps === null;
      const numbers = [...new Set(targets.flatMap((one) => {
        const e164 = deps.exact(one.phone, country);
        return e164 === null ? [] : [e164];
      }))].sort();

      const consent: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      // Theirs: the rows on their own rows, and the number's rows that name nobody. Another person's yes on a
      // shared line, with its address and words, is that person's.
      const theirs = new Set(targets.flatMap((one) => (one.person === null ? [] : [JSON.stringify([one.person.connectionId, one.person.table, one.person.key])])));
      const isTheirs = (event: TextConsentEvent): boolean => event.person === null || theirs.has(JSON.stringify([event.person.connectionId, event.person.table, event.person.key]));
      for (const target of targets) {
        const e164 = deps.exact(target.phone, country);
        // Narrowed: only the rows on their own row. Whole: by the number as well.
        if (!whole && target.person === null) continue;
        const events = await deps.consent.history({ phone: whole ? e164 : null, country, person: target.person }, { limit: 500 });
        for (const event of events) {
          if (seen.has(event.id) || !isTheirs(event)) continue;
          seen.add(event.id);
          consent.push(consentRow(e164, event));
        }
      }
      consent.sort((a, b) => String(a['at']).localeCompare(String(b['at'])));

      const stops: Record<string, unknown>[] = [];
      if (whole) {
        for (const e164 of numbers) {
          const entry = await deps.consent.stop.entryFor(e164, null);
          if (entry !== null) stops.push({ number: e164, reason: entry.reason, origin: entry.origin, addedAt: iso(entry.addedAt), addedBy: entry.addedBy?.label ?? null });
        }
      }

      const messages: Record<string, unknown>[] = [];
      const deliveries: Record<string, unknown>[] = [];
      for (const e164 of numbers) {
        for (const message of await deps.threads.exportFor(e164, apps)) messages.push({ number: e164, ...message, at: iso(message.at) });
        deliveries.push(...(await deliveriesOf(e164, apps)));
      }

      const files: TextRecordsFile[] = [
        { id: 'texts-consent', rows: consent },
        { id: 'texts-stop-list', rows: stops },
        { id: 'texts-messages', rows: messages },
        { id: 'texts-deliveries', rows: deliveries },
      ];
      return files.filter((file) => file.rows.length > 0);
    },
  };
}
