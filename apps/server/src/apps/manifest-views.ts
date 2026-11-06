// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SELF-MADE APP'S SHARED VIEWS OF A PAGE.
 *
 * A page saved from a dashboard carries the views everybody there shared
 * (`page.views`): a list's saved filters, a dashboard's arrangement. The
 * install writes each as a shared view of the installed page (`userId` null),
 * its tables turned into the target's by the same walk a page's envelope takes
 * (`envelope-refs.ts`), and with one default of each kind at most.
 *
 * An update writes them again by name: a shared view of that name and kind is
 * replaced, a new one added. A person's own views are never touched, nor a
 * shared view the version does not name.
 */
import { pageLayoutSchema, runConfigMigrations } from '@adminium/engine/config';
import type { PageView } from '@adminium/manifest';
import { viewsRepo, writeBool, type MetaDb } from '@adminium/meta';

import { resolveTableRefs, type RefTarget } from './envelope-refs.js';
import { findInstanceIds } from '../project/instance-ids.js';
import { viewConfigSchema } from '../routes/views/schema.js';

type Doc = Record<string, unknown>;

/** A view's stored config on the target, or why it cannot be one. */
export function viewConfigFor(view: PageView, target: RefTarget): { config: Doc } | { problem: string } {
  let document: Doc;
  try {
    document = runConfigMigrations({ ...view.config, v: view.v }) as Doc;
  } catch (error) {
    return { problem: `the view "${view.name}" cannot be read by this Adminium: ${error instanceof Error ? error.message : String(error)}` };
  }
  const ids = findInstanceIds(view.config);
  if (ids.length > 0) return { problem: `the view "${view.name}", ${ids[0]!.path}: ${ids[0]!.message}` };
  if (view.kind === 'filters') {
    const parsed = viewConfigSchema.safeParse(document);
    return parsed.success ? { config: document } : { problem: `the view "${view.name}" is not a list's saved view` };
  }
  // A dashboard's arrangement: its cards' queries name tables, as the page's own layout does.
  const { v: _version, ...layout } = document;
  const resolved = resolveTableRefs({ config: { layout } }, target);
  if (resolved.problems.length > 0) return { problem: `the view "${view.name}", ${resolved.problems[0]!}` };
  const bound = (resolved.document as { config: { layout: Doc } }).config.layout;
  return pageLayoutSchema.safeParse(bound).success ? { config: bound } : { problem: `the view "${view.name}" is not a dashboard layout` };
}

/** Write a page's shared views; answers why not, before any is written. */
export async function writePageViews(meta: MetaDb, pageId: string, views: readonly PageView[], target: RefTarget): Promise<{ written: number } | { problem: string }> {
  const made: { view: PageView; config: Doc }[] = [];
  for (const view of views) {
    const config = viewConfigFor(view, target);
    if ('problem' in config) return config;
    made.push({ view, config: config.config });
  }
  const repo = viewsRepo(meta);
  const shared = await meta.db.selectFrom('adminium_views').select(['id', 'kind', 'name']).where('pageId', '=', pageId).where('userId', 'is', null).execute();
  for (const { view, config } of made) {
    const held = shared.find((row) => row.kind === view.kind && row.name === view.name);
    if (held === undefined) await repo.create({ pageId, userId: null, kind: view.kind, name: view.name, config });
    else await repo.update(held.id, { config });
  }
  // One default of each kind: the one the app names, else none of the app's. The repo's own default clears every kind at once.
  for (const kind of ['filters', 'layout'] as const) {
    const named = made.find(({ view }) => view.kind === kind && view.isDefault === true)?.view.name;
    const ours = made.filter(({ view }) => view.kind === kind).map(({ view }) => view.name);
    if (ours.length === 0) continue;
    await meta.db
      .updateTable('adminium_views')
      .set({ isDefault: writeBool(meta, false) } as never)
      .where('pageId', '=', pageId)
      .where('userId', 'is', null)
      .where('kind', '=', kind)
      .execute();
    if (named !== undefined) {
      await meta.db
        .updateTable('adminium_views')
        .set({ isDefault: writeBool(meta, true) } as never)
        .where('pageId', '=', pageId)
        .where('userId', 'is', null)
        .where('kind', '=', kind)
        .where('name', '=', named)
        .execute();
    }
  }
  return { written: made.length };
}
