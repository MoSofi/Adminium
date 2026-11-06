// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in", as the Workspaces comp draws it (`s8`, `s5-mail`), in the
 * states the product reaches:
 * - the control on an editor, set to all, to some, and to none;
 * - the chips of a list cell, and the list's Workspace filter;
 * - a picked template not listed in the tab's workspace;
 * - what a workspace's delete leaves listed nowhere, for its confirm.
 *
 * The workspaces come from a bootstrap seeded into the query cache, as the
 * product reads them; nothing is asked of a server. Dark and right-to-left
 * come from the Storybook globals and the VRT matrix.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { AppToastProvider } from '../pages/toasts.js';
import type { ShownIn } from './model.js';
import { ShownInScopeProvider } from './scope.js';
import { HiddenHereNote, ShownInChips, ShownInControl, ShownOnlyInList, WorkspaceFilter } from './ShownIn.js';

const WORKSPACES = {
  workspaces: [
    { id: 'wsp_fc', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: ['fernhill', 'fernhill_archive', 'suppliers'] },
    { id: 'wsp_ks', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: ['kiln', 'suppliers'] },
  ],
  otherDatabases: ['scratch'],
  workspaceView: 'all',
  lastWorkspaceId: 'wsp_fc',
  manage: true,
};

const WIDTH = { narrow: 'w-[320px]', dialog: 'w-[410px]', list: 'w-[560px]' } as const;

function Frame({ children, width = 'narrow' }: { children: ReactNode; width?: keyof typeof WIDTH }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['bootstrap'], { workspaces: WORKSPACES });
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <ShownInScopeProvider currentWorkspaceId="wsp_fc" view="all">
          <div className={`bg-surface p-5 leading-[normal] ${WIDTH[width]}`}>
            {children}
          </div>
        </ShownInScopeProvider>
      </AppToastProvider>
    </QueryClientProvider>
  );
}

function Control({ initial }: { initial: ShownIn }): ReactNode {
  const [value, setValue] = useState(initial);
  return <ShownInControl value={value} onChange={setValue} />;
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Workspaces/Shown in' };
export default meta;

export const InAllWorkspaces = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <Control initial={{ mode: 'all', workspaceIds: [] }} />
    </Frame>
  ),
};

export const OnlyTheseWorkspaces = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <Control initial={{ mode: 'chosen', workspaceIds: ['wsp_fc'] }} />
    </Frame>
  ),
};

/** What a workspace's delete leaves: chosen, and none of them. */
export const InNoWorkspace = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <Control initial={{ mode: 'chosen', workspaceIds: [] }} />
    </Frame>
  ),
};

/** A list's "Shown in" cells (comp `s5-mail`), and its Workspace filter. */
export const ListCellsAndFilter = {
  tags: ['vrt'],
  render: () => (
    <Frame width="list">
      <div className="mb-4">
        <WorkspaceFilter value="" onChange={() => undefined} />
      </div>
      <div className="flex flex-col gap-3">
        <ShownInChips shownIn={{ mode: 'all', workspaceIds: [] }} />
        <ShownInChips shownIn={{ mode: 'chosen', workspaceIds: ['wsp_fc'] }} />
        <ShownInChips shownIn={{ mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_ks'] }} />
        <ShownInChips shownIn={{ mode: 'chosen', workspaceIds: [] }} />
      </div>
    </Frame>
  ),
};

/** A rule's email step names a template listed only in Kiln Street Pottery, seen from Fernhill Coffee. */
export const PickedButNotListedHere = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <HiddenHereNote shownIn={{ mode: 'chosen', workspaceIds: ['wsp_ks'] }} />
    </Frame>
  ),
};

/** The delete-workspace confirm's listing. */
export const DeletingAWorkspace = {
  tags: ['vrt'],
  render: () => (
    <Frame width="dialog">
      <ShownOnlyInList
        items={[
          { kind: 'email-template', itemId: 'e1', name: 'Class booked' },
          { kind: 'report', itemId: 'r1', name: 'Firings this month' },
          { kind: 'invoice', itemId: 'i1', name: 'Wholesale' },
        ]}
      />
    </Frame>
  ),
};
