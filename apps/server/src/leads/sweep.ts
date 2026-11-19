// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE KEEPING SWEEP FOR FOUND PEOPLE — once a day, the engine erases:
 *
 *  - a found person who was not told by their "tell by" day (their mail
 *    failed, or never went): the law gives a month at most, and someone who
 *    could not be told may not be kept;
 *  - a found person kept longer than the add-on's keeping time
 *    (`keep_years`), counted from the day they were found or, when later,
 *    the last time they were in touch themselves (a "Replied" in the consent
 *    log, or an answer they gave through a form or a door of their own).
 *    Finding them again never renews it: they are "already here" and nothing
 *    is stored again.
 *
 * Never erased, whatever the day: a found person who has agreed to be
 * written to (a "yes" in the consent log, for any purpose), or whose row
 * says they are a customer (the people table's declared customer column).
 * They are an ordinary contact from then on: what the business keeps of them
 * is kept for that, not for having been found.
 *
 * What goes is only what the finding stored (`privacy/erase.ts`, narrowed to
 * them): their found person's row with its tell mails and fields' sources,
 * a sole trader's company row, and their contact row emptied in place, but
 * only while that row still holds the address they were found with (a row
 * given to someone else since keeps that person). The address they were
 * found with goes on the do-not-email list as a code. Nothing else kept at
 * that address is touched: it is not the finding's. Each erasure writes its
 * own audit entry (the counts, the keyed hash, the day they were told on,
 * and why), and the sweep logs what it did. A found person's row with no
 * address loses its own rows alone.
 */
import { auditRepo, type MetaDb } from '@adminium/meta';

import { resolveTableRef, tableRefIndex } from '../apps/table-ref.js';
import type { ConsentService } from '../consent/index.js';
import type { ConnectionManager } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { customerRow } from '../outbox/marketing.js';
import { pkOfRowKey } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import type { EraseResult, EraseScope } from '../privacy/erase.js';
import { eraseFoundPeopleRows, findFoundPersonRows } from '../privacy/found-people.js';
import { dayIn, foundRowOf, zoneOf, type FoundRow } from './found-store.js';
import { leadsAddOnsOn, readLeadsSettings, storedLeadsAddOns } from './installs.js';

/** The schedule's name, and when it runs (every night). */
export const FOUND_PEOPLE_SWEEP_NAME = 'found-people-keeping';
export const FOUND_PEOPLE_SWEEP_CRON = '23 3 * * *';

/** Why the sweep erased someone. */
export type SweepReason = 'tell-by' | 'kept-for';

export interface FoundPeopleSweepDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: Pick<ConsentService, 'history'>;
  /** The one erasure of a person's data, by address (`privacy/erase.ts`), here always narrowed to one found person. */
  erase: (address: string, scope: EraseScope) => Promise<EraseResult>;
  log?: { info(fields: object, message: string): void; warn(fields: object, message: string): void } | undefined;
  now?: (() => number) | undefined;
}

/** The instant so many calendar years after `at` (29 February becomes 28 February in a year without one). */
export function yearsAfter(at: number, years: number): number {
  const date = new Date(at);
  const target = new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target.getTime();
}

/** What a sweep did: how many it erased for each reason. */
export type SweepDone = Record<SweepReason, number>;

/** The consent log's events that are the person's own doing: a reply, a form's or a door's answer. */
const OWN_SOURCES: ReadonlySet<string> = new Set(['form', 'person']);

/** Runs the sweep once (see the header). */
export async function sweepFoundPeople(deps: FoundPeopleSweepDeps): Promise<SweepDone> {
  const now = (deps.now ?? Date.now)();
  const done: SweepDone = { 'tell-by': 0, 'kept-for': 0 };
  const stored = await storedLeadsAddOns(deps.meta);
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const { db } = await deps.manager.data(connectionId);
    const zone = await zoneOf(deps.meta, connectionId);
    const today = dayIn(now, zone);
    const index = await tableRefIndex(deps.meta, connectionId, view.model);
    const declared = await peopleTablesOf(deps.meta).all(connectionId, view.model);
    for (const addOn of await leadsAddOnsOn(deps.meta, connectionId, view, stored)) {
      const table = addOn.foundPeople;
      if (table === null) continue;
      const settings = await readLeadsSettings(db, addOn);
      const rows = ((await db.selectFrom(table.id as never).selectAll().execute()) as Row[]).map((row) => foundRowOf(table, row)).filter((row): row is FoundRow => row !== null);
      for (const found of rows) {
        // Their row, as it stands: a customer's is kept for that.
        const tableId = resolveTableRef(index, found.personTable)?.tableId ?? null;
        const entry = tableId === null ? undefined : declared.find((one) => one.table === tableId);
        let personRow: Row | undefined;
        if (tableId !== null) {
          const personTable = view.table(tableId);
          const pk = pkOfRowKey(personTable, found.personKey);
          personRow = pk === null ? undefined : ((await fetchByPk(db, personTable, pk)) as Row | undefined);
        }
        // Still theirs while it holds the address they were found with: a row given to someone else says nothing of them.
        const held = personRow === undefined || entry?.email == null ? null : personRow[entry.email];
        const theirRow = typeof held === 'string' && found.email !== null && held.trim().toLowerCase() === found.email;
        if (theirRow && entry !== undefined && customerRow(entry, personRow!)) continue;
        // What they said themselves: a yes keeps them; their own word later restarts the clock.
        const person = tableId === null || !theirRow ? null : { connectionId, table: tableId, key: found.personKey };
        const events = await deps.consent.history({ person, address: found.email }, { limit: 500 }).catch(() => null);
        if (events === null || events.some((event) => event.state === 'yes')) continue;
        const own = events.filter((event) => event.state === 'replied' || OWN_SOURCES.has(event.source)).map((event) => event.at);
        let reason: SweepReason | null = null;
        if (found.toldAt === null && found.tellBy < today) reason = 'tell-by';
        else if (now >= yearsAfter(Math.max(found.foundAt, ...own), settings.keepYears)) reason = 'kept-for';
        if (reason === null) continue;
        try {
          const theirs = await findFoundPersonRows(deps, { connectionId, addOnKey: addOn.key, found: found.id });
          if (theirs === null) continue;
          if (found.email !== null) {
            // By the address they were found with, and only what the finding stored: their contact row (while it
            // still holds that address), their found person's rows, a sole trader's company row.
            const result = await deps.erase(found.email, { apps: null, by: '', only: { rows: tableId === null ? [] : [{ connectionId, table: tableId, key: found.personKey }], found: [theirs] } });
            await auditRepo(deps.meta).append(
              {
                actorKind: 'system',
                actorId: null,
                actorLabel: 'Adminium',
                category: 'data',
                action: 'privacy.erase',
                connectionId,
                changes: { after: { address: result.address, counts: result.counts, left: result.left.length, filesFailed: result.filesFailed, why: reason, ...(result.told.length === 0 ? {} : { told: result.told }) } },
              },
              now,
            );
          } else {
            // No address to erase by: their found person's own rows go, with their mails and fields' sources.
            const gone = await eraseFoundPeopleRows([theirs]);
            await auditRepo(deps.meta).append({ actorKind: 'system', actorId: null, actorLabel: 'Adminium', category: 'leads', action: 'leads.people.erased', connectionId, changes: { after: { counts: gone.counts, why: reason, ...(gone.told.length === 0 ? {} : { told: gone.told }) } } }, now);
          }
          done[reason] += 1;
        } catch (error) {
          deps.log?.warn({ err: error, addOn: addOn.key, why: reason }, 'a found person could not be erased; the next sweep tries again');
        }
      }
    }
  }
  if (done['tell-by'] + done['kept-for'] > 0) deps.log?.info({ erased: done }, 'found people keeping sweep');
  return done;
}
