// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Library list under workspaces.
 *
 * - **One at a time**: the list is the tab's workspace's. It sends that
 *   workspace as `workspaceId` and shows it as a chip by the title.
 * - **All in one menu**: the list is everyone's, once, with a Workspaces
 *   column of chips and a "Workspace" filter that starts at All workspaces.
 * - **No workspaces** (or one group for this person): the list is the one it
 *   always was. Nothing is sent, and nothing is drawn.
 *
 * `workspaceId` only ever narrows on the server: the list keeps every check
 * it has, cut to that workspace's databases. People, Teams and Roles never
 * filter; Data connections lists every connection and keeps its own filter.
 */
import { useId, useState } from 'react';
import { Select, cn } from '@adminium/ui';

import type { BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useCurrentGroup } from './current.js';
import { groupsHolding, type WorkspaceGroup } from './model.js';
import { WorkspaceChip, groupName } from './WorkspaceTile.js';

/** "All workspaces", as the filter's value. */
export const ALL_GROUPS = '';

export interface ListWorkspace {
  /** Whether the list follows workspaces at all. */
  shown: boolean;
  view: 'one' | 'all';
  groups: WorkspaceGroup[];
  /** The tab's group (One at a time). */
  current: WorkspaceGroup | null;
  /** What to send as the list's `workspaceId`; undefined sends nothing. */
  workspaceId: string | undefined;
  /** All in one menu: the filter's value ({@link ALL_GROUPS} for all). */
  filter: string;
  setFilter: (value: string) => void;
}

export function useListWorkspace(bootstrap: Pick<BootstrapData, 'workspaces' | 'user'>): ListWorkspace {
  const { groups, shown, current, view } = useCurrentGroup(bootstrap);
  const [filter, setFilter] = useState(ALL_GROUPS);
  // A filter naming a group that went is All workspaces again.
  const chosen = groups.some((group) => group.id === filter) ? filter : ALL_GROUPS;
  const workspaceId = !shown ? undefined : view === 'one' ? current?.id : chosen === ALL_GROUPS ? undefined : chosen;
  return { shown, view, groups, current, workspaceId, filter: chosen, setFilter };
}

/** `?workspaceId=` for a list's address, or nothing. */
export function workspaceQuery(list: Pick<ListWorkspace, 'workspaceId'>): string {
  return list.workspaceId === undefined ? '' : `workspaceId=${encodeURIComponent(list.workspaceId)}`;
}

/** One at a time: the tab's workspace, as a chip by the list's title. Nothing otherwise. */
export function CurrentWorkspaceChip({ list }: { list: ListWorkspace }) {
  if (!list.shown || list.view !== 'one' || list.current === null) return null;
  return <WorkspaceChip group={list.current} />;
}

/** All in one menu: the "Workspace" filter. Nothing otherwise. */
export function WorkspaceFilter({ list, className }: { list: ListWorkspace; className?: string }) {
  const id = useId();
  if (!list.shown || list.view !== 'all') return null;
  return (
    <div className={cn('flex items-center gap-2', className)} data-part="workspace-filter">
      <label htmlFor={id} className="text-[12.5px] font-bold leading-[normal] text-fg">
        {t('workspaces.filter.label', 'Workspace')}
      </label>
      <Select id={id} value={list.filter} onChange={(event) => list.setFilter(event.target.value)} wrapperClassName="w-auto" className="h-8 text-[12.5px]">
        <option value={ALL_GROUPS}>{t('workspaces.filter.all', 'All workspaces')}</option>
        {list.groups.map((group) => (
          <option key={group.id} value={group.id}>
            {groupName(group)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Whether a list draws its Workspaces column: All in one menu only. */
export function showsWorkspaceColumn(list: Pick<ListWorkspace, 'shown' | 'view'>): boolean {
  return list.shown && list.view === 'all';
}

/** The Workspaces column's cell: the chips of every group that holds the row's database; nothing for a row of none. */
export function WorkspaceChips({ list, connectionId }: { list: Pick<ListWorkspace, 'groups'>; connectionId: string | null | undefined }) {
  if (typeof connectionId !== 'string') return null;
  const holders = groupsHolding(list.groups, connectionId);
  if (holders.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-part="workspace-chips">
      {holders.map((group) => (
        <WorkspaceChip key={group.id} group={group} />
      ))}
    </div>
  );
}
