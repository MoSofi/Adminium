// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save workspace and installing a workspace file (`Apps Per Database.dc.html`
 * parts 8 and 9): the quick dialog, the saved file, the review with its
 * workspace choice and its apps, Done, and a run that stopped. Nothing asks a
 * server: every answer is written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AppToastProvider } from '../../../pages/toasts.js';
import { makeBootstrap } from '../../../test/fixtures.js';
import type { AppInstallPlan } from '../appsApi.js';
import type { CheckItem } from '../saveAppApi.js';
import { SaveWorkspaceDialog, SavedWorkspaceDialog, firstPlanKey } from './SaveWorkspaceDialog.js';
import { WORKSPACES_FOR_FILE_KEY, WorkspaceFileInstall, planQueryKey, workspaceFileQueryKey } from './WorkspaceFileInstall.js';
import { WorkspaceFilesWaiting, WorkspaceSavesList } from './WorkspaceSavesList.js';
import { APP_SAVES_QUERY_KEY, WORKSPACE_FILES_QUERY_KEY, type WorkspaceFile, type WorkspaceSavePlan } from './workspaceFilesApi.js';

const FP = (seed: string) => `sha512-${seed.repeat(Math.ceil(86 / seed.length)).slice(0, 86)}==`;
const CONNECTIONS = [
  { id: 'c-fernhill', name: 'fernhill', engine: 'postgres', readOnly: false, tableCount: 30 },
  { id: 'c-archive', name: 'fernhill_archive', engine: 'postgres', readOnly: false, tableCount: 2 },
  { id: 'c-suppliers', name: 'suppliers', engine: 'postgres', readOnly: false, tableCount: 3 },
];

function client(options: { managesConnections?: boolean; settings?: boolean; workspaces?: { id: string; name: string; connectionIds: string[] }[] } = {}): QueryClient {
  const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const actions = ['manifests.manage', ...(options.settings === false ? [] : ['settings.manage']), ...(options.managesConnections === false ? [] : ['connections.manage'])];
  c.setQueryData(['bootstrap'], makeBootstrap({ systemActions: actions as never }));
  c.setQueryData(['branding'], { appName: 'Fernhill new', logoUrl: null });
  c.setQueryData(['studio', 'connections'], CONNECTIONS);
  c.setQueryData(WORKSPACES_FOR_FILE_KEY, options.workspaces ?? []);
  return c;
}

function Frame({ children, c = client() }: { children: ReactNode; c?: QueryClient }): ReactNode {
  return (
    <QueryClientProvider client={c}>
      <AppToastProvider>
        <div className="flex max-w-[1080px] flex-col gap-4 p-6 leading-[normal]">{children}</div>
      </AppToastProvider>
    </QueryClientProvider>
  );
}

// ── Part 8: Save workspace ─────────────────────────────────────────────────

const WORKSPACE = { id: 'wsp-fernhill', name: 'Fernhill Coffee', connectionIds: ['c-fernhill', 'c-archive', 'c-suppliers'] };

function savePlan(choices: boolean): WorkspaceSavePlan {
  const plan = (key: string, version: string, check: Pick<CheckItem, 'code' | 'kind' | 'item' | 'field' | 'answer'>[]) => ({
    key,
    version,
    lineage: 'kept' as const,
    label: 'Fernhill main',
    minAdminiumVersion: '0.3.49',
    ready: check.length === 0,
    check: check.map((item) => ({ group: 'choice' as const, message: '', ...item })),
    problems: [],
    counts: { tables: 3 },
  });
  return {
    workspaceId: WORKSPACE.id,
    name: WORKSPACE.name,
    label: 'Fernhill main',
    filename: 'fernhill-coffee.workspace.tgz',
    minAdminiumVersion: '0.3.49',
    ready: !choices,
    instanceFrom: null,
    workspaces: ['Fernhill Coffee'],
    apps: [
      { connectionId: 'c-fernhill', database: { name: 'fernhill', engine: 'postgres' }, key: 'fernhill-ops', name: 'Fernhill Ops', lastSaved: '1.0.0', plan: plan('fernhill-ops', '1.0.1', choices ? [{ code: 'TYPE_NO_FORM', kind: 'column', item: 'activity_log', field: 'ip_address' }, { code: 'PERSONAL_VIEW', kind: 'view', item: 'Needs packing: Today’s roasts' }] : []) },
      { connectionId: 'c-archive', database: { name: 'fernhill_archive', engine: 'postgres' }, key: 'fernhill-archive', name: 'Fernhill Archive', lastSaved: null, plan: plan('fernhill-archive', '1.0.0', []) },
      { connectionId: 'c-suppliers', database: { name: 'suppliers', engine: 'postgres' }, key: 'suppliers', name: 'Suppliers', lastSaved: null, plan: plan('suppliers', '1.0.0', choices ? [{ code: 'ROWS_PERSONAL_REQUIRED', kind: 'column', item: 'supplier_contacts', field: 'phone' }] : []) },
    ],
  };
}

function SaveDialog({ choices }: { choices: boolean }) {
  const c = client();
  c.setQueryData(firstPlanKey(WORKSPACE.id), { plan: savePlan(choices) });
  return (
    <Frame c={c}>
      <SaveWorkspaceDialog workspace={WORKSPACE} onClose={() => {}} onMoreChoices={() => {}} />
    </Frame>
  );
}

const SAVED = {
  id: 'wss-1',
  name: 'Fernhill Coffee',
  filename: 'fernhill-coffee.workspace.tgz',
  integrity: FP('3c9e1a7f0d52b8e46a1f9c3d27b05e8a'),
  bytes: 421_888,
  savedAt: Date.parse('2026-11-04T10:00:00.000Z'),
  apps: [
    { key: 'fernhill-ops', version: '1.0.1', integrity: FP('8a2f6c0e4b91'), bytes: 200_000 },
    { key: 'fernhill-archive', version: '1.0.0', integrity: FP('c47e1b9d0a3f'), bytes: 100_000 },
    { key: 'suppliers', version: '1.0.0', integrity: FP('5e0b3d8a1c6f'), bytes: 100_000 },
  ],
};

// ── Part 9: installing a workspace file ────────────────────────────────────

function file(overrides: Partial<WorkspaceFile> = {}, apps?: WorkspaceFile['apps']): WorkspaceFile {
  return {
    id: 'wsi-1',
    name: 'Fernhill Coffee',
    label: 'Fernhill main',
    savedAt: '2026-11-04T10:00:00.000Z',
    adminiumVersion: '0.3.49',
    minAdminiumVersion: '0.3.49',
    integrity: SAVED.integrity,
    state: 'staged',
    workspace: null,
    createdAt: 0,
    updatedAt: 0,
    apps: apps ?? [
      { key: 'fernhill-ops', name: 'Fernhill Ops', version: '1.1.0', integrity: FP('8a2f'), database: { name: 'fernhill', engine: 'postgres' }, suggested: 'c-fernhill', sides: [], target: null, state: 'pending', refusal: null, route: 'update', installs: [{ installId: 'm1', connectionId: 'c-fernhill', connectionName: 'fernhill', version: '1.0.0' }] },
      { key: 'fernhill-archive', name: 'Fernhill Archive', version: '1.0.0', integrity: FP('c47e'), database: { name: 'fernhill_archive', engine: 'postgres' }, suggested: 'c-archive', sides: [], target: null, state: 'pending', refusal: null, route: 'install', installs: [] },
      { key: 'suppliers', name: 'Suppliers', version: '1.0.0', integrity: FP('5e0b'), database: { name: 'suppliers', engine: 'postgres' }, suggested: null, sides: ['staff'], target: null, state: 'pending', refusal: null, route: 'install', installs: [] },
    ],
    ...overrides,
  };
}

function plan(key: string, version: string, overrides: Partial<AppInstallPlan> = {}): AppInstallPlan {
  return {
    key,
    version,
    installable: true,
    touchesData: true,
    create: [],
    reuse: [],
    references: [],
    problems: [],
    requiresSchemaChange: false,
    checksum: 'c'.repeat(64),
    tables: [
      { ref: 'old_orders', table: 'old_orders', class: 'new', action: 'create', offers: [], edits: [], blocked: [], columns: [{ ref: 'id', type: 'int' }] },
      { ref: 'old_invoices', table: 'old_invoices', class: 'new', action: 'create', offers: [], edits: [], blocked: [], columns: [{ ref: 'id', type: 'int' }] },
    ] as NonNullable<AppInstallPlan['tables']>,
    madeAt: { label: 'Fernhill main', savedAt: '2026-11-04T10:00:00.000Z', adminiumVersion: '0.3.49' },
    afterInstall: [{ kind: 'address', item: 'chase-late-purchase-orders', field: 'to.addresses' }],
    ...overrides,
  };
}

function Review({ managesConnections = true, workspaces = [] as { id: string; name: string; connectionIds: string[] }[], noDatabaseForSuppliers = true }) {
  const c = client({ managesConnections, workspaces });
  const base = file();
  const staged = noDatabaseForSuppliers ? base : file({}, base.apps.map((app) => (app.key === 'suppliers' ? { ...app, suggested: 'c-suppliers' } : app)));
  c.setQueryData(workspaceFileQueryKey(staged.id), staged);
  c.setQueryData(planQueryKey(staged.id, staged.apps[0]!, 'c-fernhill', {}), { plan: plan('fernhill-ops', '1.1.0') });
  c.setQueryData(planQueryKey(staged.id, staged.apps[1]!, 'c-archive', {}), { plan: plan('fernhill-archive', '1.0.0') });
  if (!noDatabaseForSuppliers) c.setQueryData(planQueryKey(staged.id, staged.apps[2]!, 'c-suppliers', {}), { plan: plan('suppliers', '1.0.0') });
  return (
    <Frame c={c}>
      <WorkspaceFileInstall resumeId={staged.id} onClose={() => {}} />
    </Frame>
  );
}

function Done({ stopped }: { stopped: boolean }) {
  const c = client();
  const base = file().apps;
  const staged = file(
    { state: stopped ? 'stopped' : 'done', workspace: { mode: 'create', workspaceId: 'wsp-new', name: 'Fernhill Coffee' } },
    stopped
      ? [
          { ...base[0]!, target: 'c-fernhill', state: 'updated' },
          { ...base[1]!, target: 'c-archive', state: 'installed' },
          { ...base[2]!, target: 'c-suppliers', state: 'stopped', refusal: { reason: 'STOPPED', message: 'the database went away' } },
        ]
      : [
          { ...base[0]!, target: 'c-fernhill', state: 'refused', refusal: { reason: 'VERSION_OLDER', message: 'fernhill already has Fernhill Ops 1.2.0.' } },
          { ...base[1]!, target: 'c-archive', state: 'installed' },
          { ...base[2]!, target: 'c-suppliers', state: 'installed' },
        ],
  );
  c.setQueryData(workspaceFileQueryKey(staged.id), staged);
  c.setQueryData(WORKSPACES_FOR_FILE_KEY, [{ id: 'wsp-new', name: 'Fernhill Coffee', connectionIds: ['c-fernhill', 'c-archive', 'c-suppliers'] }]);
  if (stopped) c.setQueryData(planQueryKey(staged.id, staged.apps[2]!, 'c-suppliers', {}), { plan: plan('suppliers', '1.0.0') });
  return (
    <Frame c={c}>
      <WorkspaceFileInstall resumeId={staged.id} onClose={() => {}} />
    </Frame>
  );
}

function Lists() {
  const c = client();
  c.setQueryData(APP_SAVES_QUERY_KEY, { saves: [], workspaces: [{ id: 'wss-1', workspaceId: WORKSPACE.id, name: 'Fernhill Coffee', label: 'Fernhill main', savedBy: null, savedAt: SAVED.savedAt, integrity: SAVED.integrity, bytes: SAVED.bytes, appSaveIds: ['a', 'b', 'c'], filename: SAVED.filename, downloadable: true }] });
  c.setQueryData(WORKSPACE_FILES_QUERY_KEY, [file({ state: 'stopped' })]);
  return (
    <Frame c={c}>
      <WorkspaceFilesWaiting onOpen={() => {}} />
      <section className="rounded-[14px] border border-border bg-surface">
        <h2 className="px-5 py-4 text-sm font-bold">Saved from here</h2>
        <WorkspaceSavesList onSaveAgain={() => {}} />
      </section>
    </Frame>
  );
}

const meta = { title: 'Studio/Apps/Workspace files' };
export default meta;

export const SaveWorkspaceNeedsChoices = { tags: ['vrt'], render: () => <SaveDialog choices /> };
export const SaveWorkspaceReady = { tags: ['vrt'], render: () => <SaveDialog choices={false} /> };
export const SavedAsOneFile = { tags: ['vrt'], render: () => <Frame><SavedWorkspaceDialog file={SAVED} onClose={() => {}} /></Frame> };
export const ReviewFirstWorkspace = { tags: ['vrt'], render: () => <Review /> };
export const ReviewAddToExisting = { tags: ['vrt'], render: () => <Review workspaces={[{ id: 'wsp-fc', name: 'Fernhill Coffee', connectionIds: [] }]} /> };
export const ReviewWithoutConnectionRights = { tags: ['vrt'], render: () => <Review managesConnections={false} /> };
export const ReviewEveryAppReady = { tags: ['vrt'], render: () => <Review noDatabaseForSuppliers={false} /> };
export const DoneInNewWorkspace = { tags: ['vrt'], render: () => <Done stopped={false} /> };
export const StoppedInstallTheRest = { tags: ['vrt'], render: () => <Done stopped /> };
export const SavedAndWaiting = { tags: ['vrt'], render: () => <Lists /> };
