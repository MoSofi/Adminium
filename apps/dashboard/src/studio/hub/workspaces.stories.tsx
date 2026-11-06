// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Workspaces card of Data connections and its dialogs, in the states the
 * comp draws and the ones built from notes: the empty card, the card with
 * Other databases, the first workspace's notice, Rename, a delete that lists
 * what it leaves shown nowhere, and a database's workspaces. Nothing asks a
 * server: each state is written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AppToastProvider } from '../../pages/toasts.js';
import type { ConnectionDto } from '../api.js';
import { ConnectionWorkspacesModal, DeleteWorkspaceModal, NewWorkspaceModal, RenameWorkspaceModal } from './WorkspaceDialogs.js';
import { WorkspacesCard } from './WorkspacesCard.js';
import { WORKSPACES_QUERY_KEY, type WorkspaceDto, type WorkspaceList } from './workspacesApi.js';

const connection = (id: string, name: string, engine: string, tableCount: number) => ({ id, name, engine, tableCount }) as unknown as ConnectionDto;
const CONNECTIONS = [
  connection('c_fernhill', 'fernhill', 'postgres', 30),
  connection('c_archive', 'fernhill_archive', 'postgres', 12),
  connection('c_kiln', 'kiln', 'mysql', 18),
  connection('c_suppliers', 'suppliers', 'postgres', 6),
  connection('c_scratch', 'scratch', 'sqlite', 3),
];
const sender = { name: null, from: null, replyTo: null, postal: null };
const COFFEE: WorkspaceDto = { id: 'wsp_coffee', name: 'Fernhill Coffee', position: 0, connectionIds: ['c_fernhill', 'c_archive', 'c_suppliers'], sender, createdAt: 1, updatedAt: 1 };
const KILN: WorkspaceDto = { id: 'wsp_kiln', name: 'Kiln Street Pottery', position: 1, connectionIds: ['c_kiln', 'c_suppliers'], sender, createdAt: 1, updatedAt: 1 };
const LIST: WorkspaceList = { workspaces: [COFFEE, KILN], otherDatabases: ['c_scratch'], view: 'all' };

function Frame({ children, seed }: { children: ReactNode; seed?: (client: QueryClient) => void }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  seed?.(client);
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <div className="max-w-[1080px] p-6 leading-[normal]">{children}</div>
      </AppToastProvider>
    </QueryClientProvider>
  );
}

const meta = { title: 'Studio/Data connections/Workspaces' };
export default meta;

export const Card = { tags: ['vrt'], render: () => <Frame><WorkspacesCard list={LIST} connections={CONNECTIONS} /></Frame> };
export const EmptyCard = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <WorkspacesCard list={{ workspaces: [], otherDatabases: null, view: 'all' }} connections={CONNECTIONS} />
    </Frame>
  ),
};
export const FirstWorkspace = { tags: ['vrt'], render: () => <Frame><NewWorkspaceModal workspaces={[]} connections={CONNECTIONS} onClose={() => undefined} /></Frame> };
export const NewWorkspace = { tags: ['vrt'], render: () => <Frame><NewWorkspaceModal workspaces={[COFFEE]} connections={CONNECTIONS} preset={['c_kiln']} onClose={() => undefined} /></Frame> };
export const Rename = { tags: ['vrt'], render: () => <Frame><RenameWorkspaceModal workspace={KILN} workspaces={[COFFEE, KILN]} onClose={() => undefined} /></Frame> };
export const DeleteWithShownIn = {
  tags: ['vrt'],
  render: () => (
    <Frame
      seed={(client) => {
        client.setQueryData(WORKSPACES_QUERY_KEY, LIST);
        client.setQueryData([...WORKSPACES_QUERY_KEY, KILN.id, 'delete-plan'], {
          workspace: KILN,
          connectionIds: KILN.connectionIds,
          shownOnlyIn: [{ kind: 'email-template', itemId: 'tpl_1', name: 'Firing done' }, { kind: 'invoice', itemId: 'inv_1', name: 'Wholesale' }],
          last: false,
        });
      }}
    >
      <DeleteWorkspaceModal workspace={KILN} onClose={() => undefined} />
    </Frame>
  ),
};
export const DatabaseWorkspaces = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <ConnectionWorkspacesModal connection={CONNECTIONS[3]!} workspaces={[COFFEE, KILN]} connections={CONNECTIONS} onClose={() => undefined} />
    </Frame>
  ),
};
