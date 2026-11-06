// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Workspaces card of Data connections and its dialogs, in the states the
 * comp draws and the ones built from notes: the empty card, the card with
 * Other databases, the first workspace's notice, Rename, a delete that lists
 * what it leaves shown nowhere, and a database's workspaces.
 *
 * A row's own buttons too: Save workspace and Sender, which show to someone
 * who may save apps, and each one pressed (the story's `play` presses it, so
 * what opens is the row's own dialog). Nothing asks a server: each state is
 * written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AppToastProvider } from '../../pages/toasts.js';
import { makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import { firstPlanKey } from '../apps/workspaceFiles/SaveWorkspaceDialog.js';
import type { WorkspaceSavePlan } from '../apps/workspaceFiles/workspaceFilesApi.js';
import { SENDING_DOMAINS_KEY } from '../workspace-sender/senderApi.js';
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

/** Someone who may save apps and manage settings: the rows show Save workspace beside Sender. */
function withRowButtons(client: QueryClient): void {
  client.setQueryData(['bootstrap'], makeBootstrap({ systemActions: ['manifests.manage', 'settings.manage', 'connections.manage'] as never }));
  client.setQueryData(['studio', 'connections'], CONNECTIONS);
  client.setQueryData(WORKSPACES_QUERY_KEY, LIST);
  client.setQueryData(SENDING_DOMAINS_KEY, { domains: ['fernhill.example', 'kilnstreet.example'], addresses: [] });
  client.setQueryData(firstPlanKey(COFFEE.id), { plan: COFFEE_PLAN });
}

const appPlan = (key: string, version: string, check: string[]) => ({
  key,
  version,
  lineage: 'kept' as const,
  label: 'Fernhill main',
  minAdminiumVersion: '0.3.49',
  ready: check.length === 0,
  check: check.map((message, n) => ({ group: 'choice' as const, code: 'X', kind: 'table', item: String(n), message })),
  problems: [],
  counts: { tables: 3 },
});
const COFFEE_PLAN: WorkspaceSavePlan = {
  workspaceId: COFFEE.id,
  name: COFFEE.name,
  label: 'Fernhill main',
  filename: 'fernhill-coffee.workspace.tgz',
  minAdminiumVersion: '0.3.49',
  ready: false,
  instanceFrom: null,
  workspaces: [COFFEE.name],
  apps: [
    { connectionId: 'c_fernhill', database: { name: 'fernhill', engine: 'postgres' }, key: 'fernhill-ops', name: 'Fernhill Ops', lastSaved: '1.0.0', plan: appPlan('fernhill-ops', '1.0.1', ['activity_log.ip_address has no matching type']) },
    { connectionId: 'c_archive', database: { name: 'fernhill_archive', engine: 'postgres' }, key: 'fernhill-archive', name: 'Fernhill Archive', lastSaved: null, plan: appPlan('fernhill-archive', '1.0.0', []) },
    { connectionId: 'c_suppliers', database: { name: 'suppliers', engine: 'postgres' }, key: 'suppliers', name: 'Suppliers', lastSaved: null, plan: appPlan('suppliers', '1.0.0', []) },
  ],
};

/** Presses one of the first row's buttons, by its words. */
function press(label: string) {
  return ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const row = canvasElement.querySelector(`[data-testid="workspace-row-${COFFEE.id}"]`);
    const button = [...(row?.querySelectorAll('button') ?? [])].find((one) => one.textContent?.trim() === label);
    button?.click();
  };
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
export const CardWithRowButtons = {
  tags: ['vrt'],
  render: () => (
    <Frame seed={withRowButtons}>
      <WorkspacesCard list={LIST} connections={CONNECTIONS} />
    </Frame>
  ),
};
export const RowSender = {
  tags: ['vrt'],
  render: () => (
    <Frame seed={withRowButtons}>
      <WorkspacesCard list={LIST} connections={CONNECTIONS} />
    </Frame>
  ),
  play: press('Sender'),
};
export const RowSaveWorkspace = {
  tags: ['vrt'],
  render: () => (
    <Frame seed={withRowButtons}>
      <WorkspacesCard list={LIST} connections={CONNECTIONS} />
    </Frame>
  ),
  play: press('Save workspace'),
};
