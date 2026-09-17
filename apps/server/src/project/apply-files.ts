// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing what a checked project file says into the meta store, and removing
 * what a deleted file no longer says.
 *
 * A page is found by its database and address first. Failing that, by the id
 * its file implies, which is how a generated page renamed in the folder keeps
 * its row, grants and views. Only then is a new row made.
 */

import { newId, overridesRepo, pagesRepo, permissionsRepo, type MetaDb, type ProjectOverrideInput } from '@adminium/meta';

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
