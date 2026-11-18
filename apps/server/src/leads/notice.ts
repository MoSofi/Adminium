// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE PRIVACY NOTICE MUST ALSO NAME while an add-on keeps the people
 * its sources find: where a person's details may come from (each source, by
 * name and the hosts it is asked at, or the company's own website), and who
 * receives what is searched (those hosts). The privacy page shows it beside
 * the notice's address, so the owner's notice can say so; the tell mail
 * links to that notice.
 *
 * Listed for an add-on that keeps people now, or still keeps people it
 * found before people were switched off.
 */
import type { MetaDb } from '@adminium/meta';
import { sql } from 'kysely';

import type { ConnectionManager } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { leadsAddOnsOn, readLeadsSettings, storedLeadsAddOns } from './installs.js';
import { sourceName } from './tell-words.js';

export interface PeopleFoundNotice {
  addOn: { key: string; name: string };
  sources: { id: string; name: string; hosts: string[]; website: boolean }[];
  recipients: string[];
}

export async function peopleFoundNotice(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'> }): Promise<PeopleFoundNotice[]> {
  const stored = await storedLeadsAddOns(deps.meta);
  const out: PeopleFoundNotice[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    for (const addOn of await leadsAddOnsOn(deps.meta, connectionId, view, stored)) {
      if (addOn.foundPeople === null) continue;
      try {
        const { db } = await deps.manager.data(connectionId);
        const settings = await readLeadsSettings(db, addOn);
        const any = settings.peopleOn || (await db.selectFrom(addOn.foundPeople.id as never).select(sql<number>`1`.as('one') as never).limit(1).executeTakeFirst()) !== undefined;
        if (!any) continue;
      } catch {
        continue;
      }
      const sources = ((addOn.manifest.addOn as { sources?: { id: string; hosts?: string[]; reads?: string }[] }).sources ?? []).map((source) => ({
        id: source.id,
        name: sourceName(source.id, source.hosts ?? []),
        hosts: [...(source.hosts ?? [])],
        website: source.reads === 'website',
      }));
      if (out.some((one) => one.addOn.key === addOn.key)) continue;
      out.push({ addOn: { key: addOn.key, name: addOn.name }, sources, recipients: [...new Set(sources.flatMap((source) => source.hosts))].sort() });
    }
  }
  return out;
}
