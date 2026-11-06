// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The menu's groups of databases, worked out from the bootstrap. Pure: the
 * rail, the switcher, the lists and the link rule all read these.
 *
 * A GROUP is a workspace this person sees, or "Other databases": the
 * databases in no workspace, which is no workspace (it cannot be renamed or
 * deleted) but is shown and chosen like one, always last. Its id is
 * {@link OTHER_GROUP}, the same word a list's `workspaceId` takes for it.
 *
 * The menu changes only when this person sees two groups or more. With one,
 * or none (a server with no workspace), the rail is the one it always was.
 */
import type { AppSection, BootstrapData, NavItem, NavTree } from '../../app/bootstrap.js';
import type { WorkspaceGroup } from './groups.js';

export { OTHER_GROUP, resolveGroup, workspaceGroups, type WorkspaceGroup } from './groups.js';
export { workspacesShown } from './shown.js';

/** The groups that hold a database, in menu order. */
export function groupsHolding(groups: readonly WorkspaceGroup[], connectionId: string): WorkspaceGroup[] {
  return groups.filter((group) => group.connectionIds.includes(connectionId));
}

/**
 * The link rule: a page of a database keeps the tab's group when that group
 * holds the database; otherwise the first group by position that does.
 * Null when nothing moves (the group holds it, or no group does: a
 * server-wide page never switches).
 */
export function groupForDatabase(groups: readonly WorkspaceGroup[], current: WorkspaceGroup | null, connectionId: string | null | undefined): WorkspaceGroup | null {
  if (connectionId === null || connectionId === undefined) return null;
  if (current !== null && current.connectionIds.includes(connectionId)) return null;
  return groupsHolding(groups, connectionId)[0] ?? null;
}

/** One built-in nav group's items inside a block (or the Shared group), as the rail draws them. */
export interface BlockGroup {
  key: NavTree['groups'][number]['key'];
  items: NavItem[];
}

/** What one block of the menu holds: its databases' pages under today's groups, then their apps' sections. */
export interface BlockContent {
  groups: BlockGroup[];
  sections: AppSection[];
}

function itemsOn(nav: NavTree, keep: (connectionId: string | null) => boolean): BlockGroup[] {
  return nav.groups
    .map((group) => ({ key: group.key, items: group.items.filter((item) => keep(item.connectionId ?? null)) }))
    .filter((group) => group.items.length > 0);
}

/** A group's block: every page of its databases, from every nav group, and the sections of the installs on them. */
export function blockContent(nav: NavTree, sections: readonly AppSection[], group: WorkspaceGroup): BlockContent {
  const held = new Set(group.connectionIds);
  return {
    groups: itemsOn(nav, (connectionId) => connectionId !== null && held.has(connectionId)),
    sections: sections.filter((section) => typeof section.connectionId === 'string' && held.has(section.connectionId)),
  };
}

/**
 * What appears once after the blocks: pages of no database, the sections of
 * installs kept once per server, and anything of a database in no group this
 * person sees (never dropped: a page they may open always has a row).
 */
export function sharedContent(nav: NavTree, sections: readonly AppSection[], groups: readonly WorkspaceGroup[]): BlockContent {
  const grouped = new Set(groups.flatMap((group) => group.connectionIds));
  const shared = (connectionId: string | null | undefined): boolean => typeof connectionId !== 'string' || !grouped.has(connectionId);
  return {
    groups: itemsOn(nav, shared),
    sections: sections.filter((section) => shared(section.connectionId)),
  };
}

/** The distinct databases a block's pages and sections are on, in first-seen order. */
export function databasesOf(content: BlockContent): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (typeof id === 'string' && !out.includes(id)) out.push(id);
  };
  for (const group of content.groups) for (const item of group.items) add(item.connectionId);
  for (const section of content.sections) add(section.connectionId);
  return out;
}

/**
 * The engines of a group's databases, in a stable order, for "3 databases ·
 * Postgres". Unknown engines (an older server) are left out.
 */
export function enginesOf(bootstrap: Pick<BootstrapData, 'workspaces'>, group: WorkspaceGroup): string[] {
  const engines = bootstrap.workspaces?.engines ?? {};
  const out = new Set<string>();
  for (const id of group.connectionIds) {
    const engine = engines[id];
    if (engine !== undefined) out.add(engine);
  }
  return [...out].sort();
}

/** A workspace tile's letters, as the server makes them: the first of its first two words, else its first two. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  const first = [...(words[0] ?? '')];
  const letters = words.length >= 2 ? `${first[0] ?? ''}${[...words[1]!][0] ?? ''}` : first.slice(0, 2).join('');
  return letters.toLocaleUpperCase();
}
