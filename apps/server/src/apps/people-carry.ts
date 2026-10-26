// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP UPDATE CARRIES OVER ONCE, from what the app kept before the
 * consent log and the do-not-email list (`people[].carry`).
 *
 *  - `stopList`: every row of the people table whose column holds a value
 *    (the CRM's old `unsubscribed_at`) puts the row's address on the
 *    do-not-email list, reason `old-mark`, dated when the column says.
 *  - `consent`: each person's newest answer on a linked table (an order's
 *    "news from the venue" tick, newest by `latest`; an answer with no
 *    `latest`, an order never confirmed, is none) becomes their declared
 *    consent column's value, as a yes with no record: no log row is
 *    written, so the first send's review asks about it. A person the log
 *    already holds an answer from keeps the log's answer; a person with no
 *    address is left alone (one who deleted their details has none: "delete
 *    my details" empties it).
 *
 * Run by an update (and a project folder's apply) next to the derived fill
 * (`derived-fill.ts`), before the new version is recorded. A carry runs on
 * the update that brings it: one the version before already declared is not
 * run again. Running one twice (an update finished again after a failure)
 * adds nothing: the list keeps one entry per address, and the column is set
 * to the same answer. The columns it reads are declared in the manifest it
 * comes with (an app keeps a carried column one more release).
 *
 * The column is written directly, in one transaction of the app's database,
 * never through a save: a save would stamp the update's runner as the one
 * who ticked it, and tell the log a change nobody made.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import { peopleSchema, type Manifest, type PeopleCarry, type PeopleEntry } from '@adminium/manifest';

import { looksLikeAddress, type ConsentService } from '../consent/index.js';
import type { SourceDatabase } from '../connections/manager.js';
import { slotInstant } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { booleanOf } from '../crud/write-values.js';
import { rowKeyOf } from '../payments/payables.js';
import { canonicalJson } from './sample-data.js';

type Db = Kysely<SourceDatabase>;

/** How many rows one read takes. */
const CHUNK = 500;

const NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float', 'smallint']);

/** One carry of one people table. */
export interface PeopleCarryStep {
  entry: PeopleEntry;
  carry: PeopleCarry;
}

export interface PeopleCarryResult {
  /** Addresses put on the do-not-email list (not those already there). */
  stopListed: number;
  /** People whose consent column took their newest answer. */
  consented: number;
  /** What was left alone, and why. */
  skipped: { table: string; reason: string }[];
}

/** An app's people, read from a manifest document; none when it does not read. */
function peopleOf(document: unknown): PeopleEntry[] {
  const parsed = peopleSchema.safeParse((document as { people?: unknown } | null)?.people);
  return parsed.success ? parsed.data : [];
}

/** The carries this version declares that the version before did not. */
export function addedCarries(previous: unknown, manifest: Manifest): PeopleCarryStep[] {
  const before = new Set(peopleOf(previous).flatMap((entry) => (entry.carry ?? []).map((carry) => canonicalJson({ table: entry.table, carry }))));
  return peopleOf(manifest).flatMap((entry) => (entry.carry ?? []).filter((carry) => !before.has(canonicalJson({ table: entry.table, carry }))).map((carry) => ({ entry, carry })));
}

const filled = (value: unknown) => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

/** Every row of a table, a chunk at a time, in key order. */
async function* rowsOf(db: Db, table: ResolvedTable, columns: readonly string[]): AsyncGenerator<Row[]> {
  const select = [...new Set([...table.primaryKey, ...columns])];
  for (let offset = 0; ; offset += CHUNK) {
    let query = db.selectFrom(table.id).select(select as never);
    for (const column of table.primaryKey) query = query.orderBy(column as never);
    const rows = (await query.limit(CHUNK).offset(offset).execute()) as Row[];
    if (rows.length > 0) yield rows;
    if (rows.length < CHUNK) return;
  }
}

/** Which of two answers is newer, by their `latest` (a moment, a date, a number). */
function newer(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  const [x, y] = [slotInstant(a), slotInstant(b)];
  if (x !== null && y !== null) return x.getTime() > y.getTime();
  const [m, n] = [Number(a), Number(b)];
  if (Number.isFinite(m) && Number.isFinite(n)) return m > n;
  return String(a) > String(b);
}

export async function carryPeople(input: {
  consent: ConsentService;
  manifest: Manifest;
  steps: readonly PeopleCarryStep[];
  connectionId: string;
  view: SnapshotView;
  db: Db;
  dialect: Dialect;
  /** The app's short table names, mapped to the real ones. */
  names: Readonly<Record<string, string>>;
}): Promise<PeopleCarryResult> {
  const out: PeopleCarryResult = { stopListed: 0, consented: 0, skipped: [] };
  const tableOf = (short: string): ResolvedTable | null => {
    try {
      return input.view.table(input.names[short] ?? short);
    } catch {
      return null;
    }
  };
  for (const { entry, carry } of input.steps) {
    const table = tableOf(entry.table);
    const email = entry.email;
    if (table === null || email === undefined || !table.columns.has(email)) {
      out.skipped.push({ table: entry.table, reason: 'the table or its address is not there' });
      continue;
    }
    if ('stopList' in carry) {
      const column = carry.stopList.column;
      if (!table.columns.has(column)) {
        out.skipped.push({ table: entry.table, reason: `"${column}" is not there` });
        continue;
      }
      for await (const rows of rowsOf(input.db, table, [column, email])) {
        for (const row of rows) {
          const address = row[email];
          if (!filled(row[column]) || typeof address !== 'string' || !looksLikeAddress(address)) continue;
          const at = slotInstant(row[column])?.getTime();
          const { added } = await input.consent.stop.add({ address, reason: 'old-mark', origin: input.manifest.name, ...(at === undefined || !Number.isFinite(at) ? {} : { at }) });
          if (added) out.stopListed += 1;
        }
      }
      continue;
    }

    const from = carry.consent;
    const consentColumn = entry.consent?.column;
    const purpose = entry.consent?.purpose;
    const linked = tableOf(from.from);
    if (consentColumn === undefined || purpose === undefined || linked === null || !table.columns.has(consentColumn) || ![from.via, from.column, from.latest].every((column) => linked.columns.has(column))) {
      out.skipped.push({ table: entry.table, reason: 'the consent column or the linked answers are not there' });
      continue;
    }
    // Each person's newest answer, by `latest`; an answer with no `latest` (an order never confirmed) is none.
    const newest = new Map<string, { latest: unknown; yes: boolean }>();
    for await (const rows of rowsOf(input.db, linked, [from.via, from.column, from.latest])) {
      for (const row of rows) {
        const person = row[from.via];
        const answer = booleanOf(row[from.column]);
        if (!filled(person) || !filled(row[from.latest]) || answer === null) continue;
        const key = String(person);
        const held = newest.get(key);
        if (held === undefined || newer(row[from.latest], held.latest)) newest.set(key, { latest: row[from.latest], yes: answer });
      }
    }
    if (newest.size === 0) continue;
    const numeric = NUMBER_TYPES.has(table.columns.get(consentColumn)!.logicalType);
    const changes: { pk: Row; yes: boolean }[] = [];
    for await (const rows of rowsOf(input.db, table, [consentColumn, email])) {
      const keys = rows.map((row) => rowKeyOf(table, row));
      // A person the log already holds an answer from keeps it.
      const asked = await input.consent.askedAmong(input.connectionId, table.id, keys, purpose);
      for (const row of rows) {
        const key = rowKeyOf(table, row);
        const answer = newest.get(key);
        const address = row[email];
        if (answer === undefined || asked.has(key) || typeof address !== 'string' || !looksLikeAddress(address)) continue;
        if (booleanOf(row[consentColumn]) === answer.yes) continue;
        changes.push({ pk: Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])), yes: answer.yes });
      }
    }
    if (changes.length === 0) continue;
    await input.db.transaction().execute(async (trx) => {
      for (const change of changes) {
        // As the column keeps a yes: a boolean on Postgres, 1 or 0 in a number column and on the two engines without one.
        const stored = !numeric && input.dialect === 'postgres' ? change.yes : change.yes ? 1 : 0;
        let update = trx.updateTable(table.id).set({ [consentColumn]: stored } as never);
        for (const [column, value] of Object.entries(change.pk)) update = update.where(trx.dynamic.ref(column), '=', value as never);
        await update.execute();
      }
    });
    out.consented += changes.length;
  }
  return out;
}
