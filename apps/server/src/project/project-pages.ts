// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page rows behind a project's hand-written pages, `pages/<slug>.tsx`
 * (49-developer-projects.md §6.3).
 *
 * A custom page is a page like any other: a row with an address, a sidebar
 * place and view grants, and the template `project-page`. The code is the
 * master copy, so every start (and every rebuild under `adminium dev`) writes
 * the rows from the build, and removes the rows of pages whose file is gone.
 * Studio shows these pages and cannot change them (`routes/pages`), with one
 * exception: a page whose code sets no `nav.order` keeps the place a sidebar
 * reorder gave it.
 *
 * A row is found by its address. A new page gets a fixed id
 * (`projectPageId`), so grants given in Team → Roles survive a restart and a
 * rebuild. A page that replaced its page file (`adminium eject`, 49 §7)
 * keeps the row that file had instead: its id, grants, views, database and
 * data source stay, and regeneration, which only rewrites rows it made,
 * leaves it alone.
 */

import { createHash } from 'node:crypto';

import { pagesRepo, permissionsRepo, projectFilesRepo, type MetaDb, type Page } from '@adminium/meta';

import type { BuiltClientPage } from './client-build.js';
import { FILE_PAGE_ORIGINS } from './page-files.js';
import { pagePath } from './paths.js';

/** The template the dashboard renders these pages with. */
export const PROJECT_PAGE_TEMPLATE = 'project-page';
/** The `origin` of their rows. */
export const PROJECT_PAGE_ORIGIN = 'project';

const ID_PREFIX = 'page_proj_';
/** Page ids are `char(36)`; a page's address is at most 31 characters. */
const ID_SLUG_ROOM = 36 - ID_PREFIX.length;

/**
 * `page_proj_<address>`. An address too long for the id keeps its start and
 * gains a digest of the whole, as generated page ids do, so two long addresses
 * never share an id. Addresses have no `_`, so no generated id looks like one.
 */
export function projectPageId(slug: string): string {
  if (slug.length <= ID_SLUG_ROOM) return `${ID_PREFIX}${slug}`;
  const digest = createHash('sha256').update(slug).digest('hex').slice(0, 8);
  const head = slug.slice(0, ID_SLUG_ROOM - digest.length - 1).replace(/-+$/, '');
  return `${ID_PREFIX}${head}-${digest}`;
}

/** A stored page's data source; none for a page of code that was never a page file. */
export interface PageSource {
  connectionId: string | null;
  table: string | null;
}

const NO_SOURCE: PageSource = { connectionId: null, table: null };

/** The data source a stored page document names, or none. */
export function sourceOfStored(config: unknown): PageSource {
  const source = (config as { source?: unknown } | null)?.source as Partial<PageSource> | null | undefined;
  if (typeof source !== 'object' || source === null) return NO_SOURCE;
  return {
    connectionId: typeof source.connectionId === 'string' ? source.connectionId : null,
    table: typeof source.table === 'string' ? source.table : null,
  };
}

interface EnvelopeParts {
  id: string;
  slug: string;
  title: string;
  icon: string;
  group: string;
  hidden: boolean;
  navOrder: number;
  source: PageSource;
}

function envelopeOf(parts: EnvelopeParts): Record<string, unknown> {
  return {
    v: 1,
    kind: 'page',
    id: parts.id,
    template: PROJECT_PAGE_TEMPLATE,
    title: { key: `project.pages.${parts.slug}`, fallback: parts.title },
    // The server derives the person's write permissions from the source, and
    // record links find the page through it: an ejected page keeps both.
    source: parts.source,
    nav: {
      group: parts.group,
      icon: parts.icon,
      order: parts.navOrder,
      slug: parts.slug,
      ...(parts.hidden ? { hidden: true } : {}),
    },
    access: { minRole: 'viewer', permissions: [] },
    config: { file: parts.slug },
  };
}

/** The page document a project page is stored with. */
export function projectPageEnvelope(
  page: BuiltClientPage,
  navOrder: number,
  id: string = projectPageId(page.name),
  source: PageSource = NO_SOURCE,
): Record<string, unknown> {
  return envelopeOf({
    id,
    slug: page.name,
    title: page.title,
    icon: page.icon,
    group: page.nav.group,
    hidden: page.nav.hidden,
    navOrder,
    source,
  });
}

/** Whether a row came from a page file (`pages/<slug>.json`). */
export function isFilePage(row: Pick<Page, 'origin' | 'manifestId'>): boolean {
  return row.manifestId === null && (FILE_PAGE_ORIGINS as readonly string[]).includes(row.origin);
}

/**
 * Make a page file's row the row of the page of code that replaced it, in
 * place: same id, grants, views, database and data source. Its title and
 * sidebar place stay until the build's page is applied over them.
 */
export async function adoptAsProjectPage(meta: MetaDb, pageId: string, at: number = Date.now()): Promise<Page | null> {
  const pages = pagesRepo(meta);
  const row = await pages.findById(pageId);
  if (row === null) return null;
  return pages.putFromProject(
    {
      id: row.id,
      connectionId: row.connectionId,
      slug: row.slug,
      type: PROJECT_PAGE_TEMPLATE,
      title: row.title,
      icon: row.icon,
      navGroup: row.navGroup,
      navOrder: row.navOrder,
      config: envelopeOf({
        id: row.id,
        slug: row.slug,
        title: row.title,
        icon: row.icon ?? 'file',
        group: row.navGroup ?? 'workspace',
        hidden: row.navGroup === null,
        navOrder: row.navOrder,
        source: sourceOfStored(row.config),
      }),
      origin: PROJECT_PAGE_ORIGIN,
      isEnabled: row.isEnabled,
    },
    at,
  );
}

export interface AppliedProjectPages {
  /** Addresses written. */
  applied: string[];
  /** Addresses whose page file row became their page of code's row. */
  adopted: string[];
  /** Addresses whose row was removed because their file is gone. */
  removed: string[];
  /** A page that could not be written, and why. */
  problems: { source: string; message: string }[];
}

export interface ApplyProjectPagesOptions {
  at?: number;
  /**
   * Whether the folder still has the page's code. A row whose page the build
   * does not have is kept while its file exists: the build is behind the
   * folder, as it is for a moment after `adminium eject`.
   */
  hasCodePage?: (slug: string) => boolean;
  /**
   * Whether the folder has a page file at this address. The row of a page
   * file the sync applied, at a built page's address, whose file is now gone,
   * is that page's row: the page was ejected, and the sync has not caught up.
   * The other way round, an ejected page whose file is back is left to the
   * sync, which gives the row back to the file.
   */
  hasPageFile?: (slug: string) => boolean;
}

/**
 * Write the rows for the built pages, and remove the rows of pages the build
 * no longer has. Never touches a page of any other origin, except to adopt
 * the row of a page file the page replaced.
 */
export async function applyProjectPages(
  meta: MetaDb,
  built: readonly BuiltClientPage[],
  opts: ApplyProjectPagesOptions = {},
): Promise<AppliedProjectPages> {
  const at = opts.at ?? Date.now();
  const pages = pagesRepo(meta);
  const permissions = permissionsRepo(meta);
  const result: AppliedProjectPages = { applied: [], adopted: [], removed: [], problems: [] };
  const all = await pages.listAll();
  const ours = all.filter((row) => row.origin === PROJECT_PAGE_ORIGIN);
  const wanted = new Set(built.map((page) => page.name));

  for (const row of ours) {
    if (wanted.has(row.slug) || opts.hasCodePage?.(row.slug) === true) continue;
    // Its page file is back (an eject undone): the file sync takes the row back.
    if (row.connectionId !== null && opts.hasPageFile?.(row.slug) === true) continue;
    await permissions.revokeAllForResource('page', row.id);
    await pages.delete(row.id);
    result.removed.push(row.slug);
  }

  // A new project page gets the audience the other project pages have, the
  // way `routes/pages` seeds a new page from its siblings.
  const audience = new Set<string>();
  for (const row of ours) {
    if (!wanted.has(row.slug)) continue;
    for (const grant of await permissions.listForResource('page', row.id)) {
      if ((grant.actions as { view?: boolean }).view === true) audience.add(grant.roleId);
    }
  }

  let tracked: Set<string> | null = null;
  const ejected = async (row: (typeof all)[number]): Promise<boolean> => {
    if (!isFilePage(row) || opts.hasPageFile === undefined || opts.hasPageFile(row.slug)) return false;
    tracked ??= new Set((await projectFilesRepo(meta).list()).map((record) => record.path));
    return tracked.has(pagePath(row.slug));
  };

  for (const page of built) {
    const ownRow = ours.find((row) => row.slug === page.name);
    let existing: Page | null = ownRow === undefined ? null : await pages.findById(ownRow.id);
    const clash = all.find((row) => row.slug === page.name && row.origin !== PROJECT_PAGE_ORIGIN);
    if (existing === null && clash !== undefined && (await ejected(clash))) {
      existing = await adoptAsProjectPage(meta, clash.id, at);
      result.adopted.push(page.name);
    } else if (clash !== undefined) {
      result.problems.push({
        source: page.source,
        message: `the address /p/${page.name} is already used by the page "${clash.title}", so this page was not added. Rename one of them.`,
      });
      continue;
    }
    const id = existing?.id ?? projectPageId(page.name);
    const group = page.nav.hidden ? null : page.nav.group;
    const navOrder =
      page.nav.order ??
      (existing !== null && existing.navGroup === group
        ? existing.navOrder
        : Math.max(-1, ...all.filter((row) => row.navGroup === page.nav.group).map((row) => row.navOrder)) + 1);
    const envelope = projectPageEnvelope(
      page,
      navOrder,
      id,
      existing === null ? NO_SOURCE : sourceOfStored(existing.config),
    );
    const unchanged =
      existing !== null &&
      existing.title === page.title &&
      existing.icon === page.icon &&
      existing.navGroup === group &&
      existing.navOrder === navOrder &&
      existing.isEnabled &&
      JSON.stringify(existing.config) === JSON.stringify(envelope);
    if (!unchanged) {
      await pages.putFromProject(
        {
          id,
          connectionId: existing?.connectionId ?? null,
          slug: page.name,
          type: PROJECT_PAGE_TEMPLATE,
          title: page.title,
          icon: page.icon,
          navGroup: group,
          navOrder,
          config: envelope,
          origin: PROJECT_PAGE_ORIGIN,
          isEnabled: true,
        },
        at,
      );
    }
    if (existing === null) {
      for (const roleId of audience) {
        await permissions.grant(roleId, 'page', id, { view: true, edit: false });
      }
    }
    result.applied.push(page.name);
  }
  return result;
}
