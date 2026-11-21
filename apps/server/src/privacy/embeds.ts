// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE SNIPPET MAKER MAY OFFER: each installed app whose customer side
 * declares screens for a website (`frontends[].embed`), each screen's words,
 * and, for a screen that names a table to choose from, that table's values.
 *
 * A choice is read for its two declared columns and nothing else, at most
 * {@link CHOICES_MAX} rows. A value that could not stand in a snippet's query
 * is left out, and a table that cannot be read leaves the screen with no
 * choice: the maker still makes a snippet for it.
 */
import { embedOfDocument, type EmbedMode, type EmbedScreen } from '@adminium/manifest';
import { appTablesRepo, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';

import type { ConnectionManager } from '../connections/manager.js';

export const CHOICES_MAX = 200;

/** What the loader's path grammar takes as a query value. */
const QUERY_VALUE = /^[\w.~-]{1,64}$/;
/** What the loader takes as an app's name or a copy's. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

type Words = string | Record<string, string>;

export interface EmbedAppScreen {
  path: string;
  label: Words | null;
  choose: { query: string; title: Words | null; any: Words | null; values: { value: string; label: string }[] } | null;
}

export interface EmbedApp {
  /** What `data-adminium-app` says: the key, or `<key>~<copy>`. */
  app: string;
  name: Words;
  /** The side's own address on this server. */
  mount: string;
  screens: EmbedAppScreen[];
  modes: EmbedMode[];
}

interface EmbedsDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
}

async function valuesOf(deps: EmbedsDeps, connectionId: string, appKey: string, choose: NonNullable<EmbedScreen['choose']>): Promise<{ value: string; label: string }[] | null> {
  try {
    const table = (await appTablesRepo(deps.meta).realNames(connectionId, appKey))[choose.table];
    if (table === undefined) return null;
    const { db } = await deps.manager.data(connectionId);
    const rows = (await db
      .selectFrom(table as never)
      .select([sql.ref(choose.value).as('choicevalue'), sql.ref(choose.label).as('choicelabel')] as never)
      .orderBy(sql.ref(choose.value) as never)
      .limit(CHOICES_MAX)
      .execute()) as { choicevalue: unknown; choicelabel: unknown }[];
    const shown = (cell: unknown): string | null => (typeof cell === 'string' ? cell : typeof cell === 'number' || typeof cell === 'bigint' ? String(cell) : null);
    return rows
      .flatMap((row) => {
        const value = shown(row.choicevalue);
        const label = shown(row.choicelabel);
        return value === null || label === null || !QUERY_VALUE.test(value) ? [] : [{ value, label }];
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return null;
  }
}

/** The installed apps a website may show, by key and copy. */
export async function embeddableApps(deps: EmbedsDeps): Promise<EmbedApp[]> {
  const rows = await deps.meta.db
    .selectFrom('adminium_manifests')
    .select(['manifestKey', 'instanceSlug', 'connectionId', 'manifest'])
    .where('kind', '=', 'app')
    .where('status', '=', 'installed')
    .orderBy('manifestKey', 'asc')
    .orderBy('instanceSlug', 'asc')
    .execute();
  const out: EmbedApp[] = [];
  for (const row of rows) {
    let document: unknown;
    try {
      document = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
    } catch {
      continue;
    }
    const embed = embedOfDocument(document);
    const slug = row.instanceSlug;
    if (embed === null || !NAME.test(row.manifestKey) || (slug !== '' && !NAME.test(slug))) continue;
    const screens: EmbedAppScreen[] = [];
    for (const screen of embed.screens) {
      const values = screen.choose === undefined || row.connectionId === null ? null : await valuesOf(deps, row.connectionId, row.manifestKey, screen.choose);
      screens.push({
        path: screen.path,
        label: screen.label ?? null,
        choose: screen.choose === undefined || values === null ? null : { query: screen.choose.query, title: screen.choose.title ?? null, any: screen.choose.any ?? null, values },
      });
    }
    const name = (document as { name?: unknown }).name;
    out.push({
      app: slug === '' ? row.manifestKey : `${row.manifestKey}~${slug}`,
      name: typeof name === 'string' || (typeof name === 'object' && name !== null) ? (name as Words) : row.manifestKey,
      mount: slug === '' ? `/apps/${row.manifestKey}/customer` : `/apps/${row.manifestKey}/${slug}/customer`,
      screens,
      modes: embed.modes,
    });
  }
  return out;
}
