// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `where_is`: the places of this workspace that THIS person can open.
 *
 * Two lists. The workspace's own pages (one per table, dashboards, boards),
 * filtered by the same `page:<id>:view` grant the sidebar is filtered by; and
 * the dashboard's own screens (`../places.ts`), filtered by the guard each
 * one's route is wrapped in. Nothing is listed that would open as "forbidden".
 *
 * It reads no row of anybody's data, so it is offered whether or not row
 * reading is switched on. Someone whose every role is for one app's screens
 * has no dashboard: they are told of no dashboard place.
 */
import { pagesOfPartsOff } from '../../rbac/app-parts.js';
import { pagesRepo, readBool, rolesRepo } from '@adminium/meta';

import { ASSISTANT_PLACES, STUDIO_ROLE_SLUGS, type AssistantPlace } from '../places.js';
import { screensOnlyApps } from '../../rbac/resolver.js';
import { navTitleOf } from '../../routes/bootstrap/handlers.js';
import type { AssistantTool, AssistantToolDeps } from '../types.js';

/** Pages one answer carries. A workspace with more is told so, and to ask with words. */
export const WHERE_PAGES_MAX = 80;

/** The words of a question that can pick a place: lower case, three letters or more. */
function wordsOf(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

function matches(words: readonly string[], ...texts: readonly (string | null)[]): boolean {
  if (words.length === 0) return true;
  const hay = texts.filter((text): text is string => text !== null).join(' ').toLowerCase();
  return words.some((word) => hay.includes(word));
}

/** Whether this person passes a dashboard screen's guard. */
async function passes(place: AssistantPlace, deps: AssistantToolDeps, studio: boolean): Promise<boolean> {
  if (place.guard === 'none') return true;
  if (place.guard === 'studio') return studio;
  // `a|b`: any one of the keys opens the screen; `studio` among them is the Studio roles.
  for (const key of place.guard.split('|')) {
    if (key === 'studio') {
      if (studio) return true;
      continue;
    }
    const [resource, action] = key.split('.') as [string, string];
    if (await deps.can(`system:${resource}:${action}`)) return true;
  }
  return false;
}

export interface WhereIsAnswer {
  pages: { title: string; kind: string | null; table: string | null; path: string }[];
  places: { name: string; path: string; what: string }[];
  morePages: number;
  note: string;
}

/** The answer, apart from the tool so a test can ask as each person. */
export async function whereIs(deps: AssistantToolDeps, q: string): Promise<WhereIsAnswer> {
  const words = wordsOf(q);
  const roles = deps.userId === null ? [] : await rolesRepo(deps.meta).rolesForUser(deps.userId);
  // An API key, and a person with no role at all, is shown nothing.
  const nobody = roles.length === 0;
  const screensOnly = screensOnlyApps(roles) !== null;
  const studio = roles.some((role) => STUDIO_ROLE_SLUGS.includes(role.slug));

  const pages: WhereIsAnswer['pages'] = [];
  let morePages = 0;
  if (!nobody) {
    const repo = pagesRepo(deps.meta);
    const kinds = new Map((await repo.listAll()).map((page) => [page.id, page.type]));
    const navRows = await repo.navRows();
    // A page of a part of its app that is switched off is not somewhere to send anybody.
    const partOff = await pagesOfPartsOff(deps.meta, navRows);
    for (const row of navRows) {
      if (!readBool(row.isEnabled) || partOff.has(row.id)) continue;
      const title = navTitleOf(row, deps.locale);
      if (!matches(words, title, row.sourceTable, row.slug)) continue;
      if (!(await deps.can(`page:${row.id}:view`))) continue;
      if (pages.length >= WHERE_PAGES_MAX) {
        morePages += 1;
        continue;
      }
      pages.push({ title, kind: kinds.get(row.id) ?? null, table: row.sourceTable, path: `/p/${encodeURIComponent(row.slug)}` });
    }
  }

  const places: WhereIsAnswer['places'] = [];
  if (!nobody && !screensOnly) {
    for (const place of ASSISTANT_PLACES) {
      if (!matches(words, place.name, place.what)) continue;
      if (await passes(place, deps, studio)) places.push({ name: place.name, path: place.path, what: place.what });
    }
  }

  const empty = pages.length === 0 && places.length === 0;
  return {
    pages,
    places,
    morePages,
    note: empty
      ? words.length > 0
        ? 'Nothing this person can open matches those words. Call again with no "q" to see everything they can open before saying a place does not exist.'
        : 'This person can open no page and no settings screen here.'
      : 'These are the ONLY places this person can open. Name a place by its name and give its path as a link, e.g. [Roles](/settings/roles). Never invent a path. If what they ask for is not here, say they do not have access to it or that it does not exist, and that an administrator can tell which.',
  };
}

export const whereIsTool: AssistantTool = {
  name: 'where_is',
  description:
    'The places of this workspace the person can open: its pages (title, kind, table, path) and the settings and Studio screens their permissions open (name, path, what is done there). Call it for any "where do I…", "how do I get to…", "which page shows…" question, and before you name any page or screen. Optional "q": a few words to narrow a long list.',
  args: {
    type: 'object',
    properties: { q: { type: 'string', description: 'Words to narrow the list by, e.g. "invoice numbering". Leave out to list everything.' } },
    additionalProperties: false,
  },
  async run(args, deps) {
    const q = typeof (args as { q?: unknown }).q === 'string' ? ((args as { q: string }).q).slice(0, 200) : '';
    return { result: await whereIs(deps, q) };
  },
};
