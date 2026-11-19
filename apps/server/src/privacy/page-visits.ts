// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "PAGES THEY SAW": the part of a person's data visitor counting keeps
 * (`sources.ts` finds, `export.ts` downloads, `erase.ts` erases).
 *
 * At "Per visitor", a visitor who said yes and then sent a form has that
 * answer's address joined onto them, as the address keys hash it
 * (`views/visitor.ts`). They are found by the address under every key
 * version there is, with every page and form they were counted on: the
 * download lists each one's kind, key and day; an erasure deletes the
 * visits, then the visitors. A visitor who never sent a form has no address,
 * and is found by nobody (their visits go with their months, or when they
 * withdraw).
 */
import { visitorsRepo, type MetaDb, type Visit, type Visitor } from '@adminium/meta';

import { addressKeyRing } from '../consent/keys.js';
import type { FoundSource } from './types.js';

/** One person's visitors and their visits (at most `limit` of them read, all counted). */
export interface PageVisitsFound {
  visitors: Visitor[];
  count: number;
  visits: Visit[];
}

/** Their visitors and visits, by the address under every key version. */
export async function findPageVisits(meta: MetaDb, secret: string, address: string, limit: number): Promise<PageVisitsFound> {
  const repo = visitorsRepo(meta);
  const visitors = await repo.byAddress(await addressKeyRing(meta, secret).hashesOf(address));
  if (visitors.length === 0) return { visitors, count: 0, visits: [] };
  const { count, visits } = await repo.visitsOf(visitors.map((one) => one.id), limit);
  return { visitors, count, visits };
}

/** "Pages they saw", as one source: each visit's kind, the counted thing's key, its install, its day and moment. */
export function pageVisitSources(found: PageVisitsFound): FoundSource[] {
  if (found.count === 0) return [];
  return [
    {
      id: 'page-visits',
      kind: 'page-visits',
      group: 'held',
      connectionId: null,
      table: null,
      app: null,
      ref: null,
      label: null,
      keptByLaw: null,
      count: found.count,
      keys: found.visits.map((visit) => visit.id),
      rows: found.visits.map((visit) => ({ kind: visit.kind, page: visit.thing, install: visit.installId, day: new Date(visit.at).toISOString().slice(0, 10), at: new Date(visit.at).toISOString() })),
    },
  ];
}

/** Erases their visitors and visits. Answers how many of each went. */
export async function erasePageVisits(meta: MetaDb, secret: string, address: string): Promise<{ visitors: number; visits: number }> {
  return visitorsRepo(meta).eraseByAddress(await addressKeyRing(meta, secret).hashesOf(address));
}
