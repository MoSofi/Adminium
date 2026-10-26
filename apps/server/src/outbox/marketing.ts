// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S MARKETING MAIL, on the outbox's side: whose consent a message is
 * judged by, and whether the "existing customers" basis carries them.
 *
 * A kind the app classes `marketing` (`outbox.classes`) is judged as every
 * marketing mail is (`email/marketing.ts` `verdict`): the do-not-email list,
 * then the consent log's answer for the newsletter, then the existing-
 * customers basis. The person is the outbox's recipient, the row the
 * message's address is theirs on; a message to an address somebody typed
 * (a friend, a supplier) is judged by the address alone.
 *
 * The existing-customers basis carries a person only when all of these hold
 * (plan C7, CR1, Q-D):
 *   - the owner switched it on for their table (`existingCustomersOn`);
 *   - the app declares the table's opt-out mark (`people[].optOutMark`):
 *     its screens show the "you can say no" line where they take an address;
 *   - the person's row carries the mark (a screen showed them the line);
 *   - the app's "who counts as a customer" column (`people[].customer`) says
 *     they are one: yes, or a number above nought.
 */
import type { ConsentPerson, MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { pkLabel } from '../crud/records.js';
import type { MarketingMail } from '../email/marketing.js';
import { declaredPeople, type DeclaredPeopleTable, type PeopleModel } from '../people/declared.js';
import type { LiveOutbox } from './producers.js';
import { rowOf, type Addressed } from './recipient.js';

/** The outbox's recipient, when the message goes to the address their own row keeps. */
export async function recipientPerson(
  ctx: { db: Kysely<SourceDatabase>; view: SnapshotView },
  box: LiveOutbox,
  row: Row,
  to: string,
  addressed: Addressed | null,
): Promise<{ ref: ConsentPerson; record: Row } | null> {
  // An address the producing row holds, or a setting's: nobody's own row.
  if (addressed?.bySetting === true || addressed?.byColumn !== undefined) return null;
  const recipient = box.definition.recipient;
  const record = addressed?.person ?? (await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]));
  if (record === null) return null;
  const stored = record[recipient.email];
  if (typeof stored !== 'string' || stored.trim().toLowerCase() !== to.trim().toLowerCase()) return null;
  const table = ctx.view.table(recipient.table);
  const key = table.primaryKey[0];
  if (key === undefined || record[key] === null || record[key] === undefined) return null;
  return { ref: { connectionId: box.connectionId, table: table.id, key: pkLabel(table, { [key]: record[key] }) }, record };
}

/** Whether a "who counts as a customer" value says yes: true, or a number above nought. */
export function isCustomer(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'bigint') return value > 0n;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === 't') return true;
    const number = Number(text);
    return text !== '' && Number.isFinite(number) && number > 0;
  }
  return false;
}

/** Whether a table offers the basis at all: its app declares the opt-out mark and who counts as a customer. */
export function offersExistingCustomers(declared: Pick<DeclaredPeopleTable, 'optOutMark' | 'customer'>): boolean {
  return declared.optOutMark !== null && declared.customer !== null;
}

/** The row's own half of the basis: whether it carries the mark (a screen showed the person the opt-out line). */
export function markedForOptOut(declared: Pick<DeclaredPeopleTable, 'optOutMark'>, record: Row): boolean {
  if (declared.optOutMark === null) return false;
  const mark = record[declared.optOutMark];
  return mark !== null && mark !== undefined && mark !== '';
}

/** Whether the row's "who counts as a customer" column says they are one. */
export function customerRow(declared: Pick<DeclaredPeopleTable, 'customer'>, record: Row): boolean {
  return declared.customer !== null && isCustomer(record[declared.customer]);
}

/** Whether the existing-customers basis carries this person (see the header). */
export async function existingCustomer(meta: MetaDb, marketing: MarketingMail, view: SnapshotView, person: { ref: ConsentPerson; record: Row }): Promise<boolean> {
  if (!(await marketing.existingCustomersOn(person.ref.connectionId, person.ref.table))) return false;
  const declared = (await declaredPeople(meta, async (connectionId) => (connectionId === person.ref.connectionId ? (view.model as unknown as PeopleModel) : null))).find(
    (entry) => entry.connectionId === person.ref.connectionId && entry.table === person.ref.table,
  );
  return declared !== undefined && offersExistingCustomers(declared) && markedForOptOut(declared, person.record) && customerRow(declared, person.record);
}
