// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE KEEPING SWEEP FOR FOUND PEOPLE — once a day, the engine erases:
 *
 *  - a found person who was not told by their "tell by" day (their mail
 *    failed, or never went): the law gives a month at most, and someone who
 *    could not be told may not be kept;
 *  - a found person kept longer than the add-on's keeping time
 *    (`keep_years`), counted from the day they were found or, when later,
 *    the last time they wrote to the business (a "Replied" in the consent
 *    log). Finding them again never renews it: they are "already here" and
 *    nothing is stored again.
 *
 * Each goes through the one erasure of a person's data (`privacy/erase.ts`,
 * by their address): their rows are emptied in place, their found person's
 * rows, tell mails and fields' sources deleted, their address kept on the
 * do-not-email list as a code. Each erasure writes its own audit entry (the
 * counts, the keyed hash, the day they were told on, and why), and the sweep
 * logs what it did. A person whose row holds no address any longer loses
 * their found person's rows alone.
 */
import { auditRepo, type MetaDb } from '@adminium/meta';

import { resolveTableRef, tableRefIndex } from '../apps/table-ref.js';
import type { ConsentService } from '../consent/index.js';
import { looksLikeAddress } from '../consent/index.js';
import type { ConnectionManager } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { pkOfRowKey } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import type { EraseResult } from '../privacy/erase.js';
import { eraseFoundPeopleRows, findFoundPeopleRows } from '../privacy/found-people.js';
import { normaliseAddress } from '../public-api/claim-code.js';
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
  consent: Pick<ConsentService, 'lastReplied'>;
  /** The one erasure of a person's data, by address (`privacy/erase.ts`). */
  erase: (address: string) => Promise<EraseResult>;
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
        // Who they are now: their row, and the address it holds.
        const tableId = resolveTableRef(index, found.personTable)?.tableId ?? null;
        const entry = tableId === null ? undefined : declared.find((one) => one.table === tableId);
        let address: string | null = null;
        let personRow: Row | undefined;
        if (tableId !== null) {
          const personTable = view.table(tableId);
          const pk = pkOfRowKey(personTable, found.personKey);
          personRow = pk === null ? undefined : ((await fetchByPk(db, personTable, pk)) as Row | undefined);
          const value = personRow === undefined || entry?.email == null ? null : personRow[entry.email];
          address = typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null;
        }
        let reason: SweepReason | null = null;
        if (found.toldAt === null && found.tellBy < today) reason = 'tell-by';
        else {
          const person = tableId === null ? null : { connectionId, table: tableId, key: found.personKey };
          const replied = await deps.consent.lastReplied({ person, address }).catch(() => null);
          const from = Math.max(found.foundAt, typeof replied === 'number' ? replied : 0);
          if (now >= yearsAfter(from, settings.keepYears)) reason = 'kept-for';
        }
        if (reason === null) continue;
        try {
          if (address !== null) {
            const result = await deps.erase(address);
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
            // No address left to erase by: their found person's rows go, with their mails and fields' sources.
            const theirs = tableId === null ? [] : [{ connectionId, table: tableId, key: found.personKey }];
            const left = (await findFoundPeopleRows(deps, '', theirs)).filter((one) => one.addOn.key === addOn.key);
            const gone = await eraseFoundPeopleRows(left);
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
