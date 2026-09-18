// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing what a checked project file says into the meta store, and removing
 * what a deleted file no longer says.
 *
 * A page is found by its database and address first. Failing that, by the id
 * its file implies, which is how a generated page renamed in the folder keeps
 * its row, grants and views. Only then is a new row made.
 */

import {
  newId,
  optionListsRepo,
  overridesRepo,
  pagesRepo,
  permissionsRepo,
  type MetaDb,
  type ProjectOverrideInput,
} from '@adminium/meta';

import type { ListFileDocument } from './list-files.js';
import { newPageIdFor, toLocalPage, type PageFileDocument, type ProjectRefs } from './page-files.js';

export interface AppliedPage {
  pageId: string;
  connectionId: string | null;
  warnings: string[];
}

export async function applyPageFile(
  meta: MetaDb,
  doc: PageFileDocument,
  refs: ProjectRefs,
  at: number,
  /** Whether the folder still has a file for this address. */
  hasFile: (slug: string) => boolean,
): Promise<AppliedPage> {
  const pages = pagesRepo(meta);
  const connectionId = doc.database === null ? null : refs.connectionOf(doc.database);
  if (doc.database !== null && connectionId === null) {
    throw new Error(`database "${doc.database}" has no connection`);
  }
  const existing = await pages.findBySlug(connectionId, doc.slug);
  let id = existing?.id;
  if (existing === null) {
    const implied = newPageIdFor(doc, connectionId, () => newId('page'));
    const holder = await pages.findById(implied);
    // The implied id is taken by a page of this database under an address
    // that no longer has a file: the file was renamed, so that row is this
    // page. Any other holder keeps its id, and this page gets a new one.
    const renamed = holder !== null && holder.connectionId === connectionId && !hasFile(holder.slug);
    id = holder === null || renamed ? implied : newId('page');
  }
  const local = toLocalPage(doc, id as string, refs);
  await pages.putFromProject(
    {
      id: id as string,
      connectionId,
      slug: doc.slug,
      type: local.type,
      title: local.title,
      icon: local.icon,
      navGroup: local.navGroup,
      navOrder: local.navOrder,
      config: local.envelope,
      origin: doc.origin,
      isEnabled: doc.enabled,
    },
    at,
  );
  return { pageId: id as string, connectionId, warnings: local.warnings };
}

/** Remove a page and the grants that name it, as the page routes do. */
export async function deletePage(meta: MetaDb, pageId: string): Promise<void> {
  await permissionsRepo(meta).revokeAllForResource('page', pageId);
  await pagesRepo(meta).delete(pageId);
}

export async function applySchemaFile(
  meta: MetaDb,
  connectionId: string,
  rows: readonly ProjectOverrideInput[],
  at: number,
): Promise<void> {
  await overridesRepo(meta).replaceProjectRows(connectionId, rows, at);
}

/**
 * Write what a `lists/<key>.json` says.
 *
 * The KEY is the identity — it is what the file is called, what a rule names
 * and what travels — so an existing list with that key is updated in place and
 * keeps its id, which is what makes a pull, an edit and a push a round trip
 * rather than a new list each time.
 */
export async function applyListFile(meta: MetaDb, doc: ListFileDocument, at: number): Promise<void> {
  const lists = optionListsRepo(meta);
  const existing = await lists.findByKey(doc.key);
  if (existing === null) {
    await lists.create({ key: doc.key, name: doc.name, items: doc.items, origin: doc.origin }, at);
    return;
  }
  await lists.update(doc.key, { name: doc.name, items: doc.items }, at);
}

/**
 * Remove the list a deleted file named.
 *
 * A rule may still name it. That rule then checks nothing rather than refusing
 * every write (see `tableRulesFor`), and `adminium check` says so by name — the
 * alternative, refusing to apply the deletion, would leave the folder and the
 * database disagreeing with no way to fix it from the folder.
 */
export async function deleteListByKey(meta: MetaDb, key: string): Promise<void> {
  await optionListsRepo(meta).remove(key);
}
