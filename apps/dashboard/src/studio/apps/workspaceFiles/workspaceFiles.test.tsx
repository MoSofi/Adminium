// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save workspace and workspace files, through their screens against a stubbed
 * server: what is shown is what the server said, and what is sent is what the
 * person chose.
 *
 *  - Save workspace: the merged Check holds Save; a database left out is not
 *    sent; the server settings come from one database; the 128 MB refusal
 *    replaces the Check line; the saved file shows its fingerprints and
 *    downloads from "Download again".
 *  - The app upload hands a workspace file to its own screen.
 *  - The review: the workspace choice for connection managers only, the first
 *    workspace's notice, one row per app with its status, a fingerprint that
 *    holds Install, and what is sent; Done; a stopped run's Install the rest.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import { InstallAppWizard } from '../InstallAppWizard.js';
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog.js';
import { WorkspaceFileInstall } from './WorkspaceFileInstall.js';
import { WorkspaceFilesWaiting, WorkspaceSavesList } from './WorkspaceSavesList.js';
import { installLabel, summaryOf } from './WorkspaceFileInstall.js';
import { statusOf } from './workspaceFileStatus.js';
import type { WorkspaceFile, WorkspaceFileApp } from './workspaceFilesApi.js';

const FP = (seed: string) => `sha512-${seed.repeat(90).slice(0, 86)}==`;
const CONNECTIONS = [
  { id: 'c-fernhill', name: 'fernhill', engine: 'postgres', readOnly: false, tableCount: 30 },
  { id: 'c-archive', name: 'fernhill_archive', engine: 'postgres', readOnly: false, tableCount: 2 },
  { id: 'c-suppliers', name: 'suppliers', engine: 'postgres', readOnly: false, tableCount: 3 },
];

interface Call {
  url: string;
  query: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let routes: Record<string, (call: Call) => { status: number; body: unknown }>;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const raw = String(input);
      const [url = raw, query = ''] = raw.split('?');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const call = { url, query, method, body };
      calls.push(call);
      const handler = routes[`${method} ${url}`];
      if (handler !== undefined) {
        const reply = handler(call);
        return Promise.resolve(jsonResponse(reply.status, reply.body));
      }
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: CONNECTIONS }));
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: { appName: 'Fernhill new', logoUrl: null } }));
      if (url === '/api/v1/workspaces') return Promise.resolve(jsonResponse(200, { workspaces: [], otherDatabases: null, view: 'all' }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no ${method} ${url}`, requestId: 'r' } }));
    }),
  );
}

function withClient(node: React.ReactNode, actions: string[] = ['manifests.manage', 'settings.manage', 'connections.manage']): { client: QueryClient } {
  const client = createQueryClient();
  client.setQueryData(['bootstrap'], makeBootstrap({ systemActions: actions as never }));
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { client };
}

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  routes = {};
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Save workspace ─────────────────────────────────────────────────────────

const WORKSPACE = { id: 'wsp-1', name: 'Fernhill Coffee', connectionIds: ['c-fernhill', 'c-archive'] };

function savePlan(opts: { choices?: boolean; apps?: string[] | undefined } = {}) {
  const all = [
    { connectionId: 'c-fernhill', database: { name: 'fernhill', engine: 'postgres' }, key: 'fernhill-ops', name: 'Fernhill Ops', lastSaved: '1.0.0', version: '1.0.1', check: opts.choices === true ? [{ group: 'choice', code: 'X', kind: 'k', item: 'i', message: '10 saved views belong to people' }] : [] },
    { connectionId: 'c-archive', database: { name: 'fernhill_archive', engine: 'postgres' }, key: 'fernhill-archive', name: 'Fernhill Archive', lastSaved: null, version: '1.0.0', check: [] },
  ].filter((app) => opts.apps === undefined || opts.apps.includes(app.connectionId));
  return {
    plan: {
      workspaceId: WORKSPACE.id,
      name: WORKSPACE.name,
      label: 'Fernhill main',
      filename: 'fernhill-coffee.workspace.tgz',
      minAdminiumVersion: '0.3.49',
      ready: all.every((app) => app.check.length === 0),
      instanceFrom: null,
      workspaces: ['Fernhill Coffee'],
      apps: all.map(({ version, check, ...app }) => ({ ...app, plan: { key: app.key, version, lineage: 'kept', label: 'Fernhill main', minAdminiumVersion: '0.3.49', ready: check.length === 0, check, problems: [], counts: {} } })),
    },
  };
}

const SAVED = {
  id: 'wss-1',
  name: 'Fernhill Coffee',
  filename: 'fernhill-coffee.workspace.tgz',
  integrity: FP('Ab3'),
  bytes: 421_888,
  savedAt: 0,
  apps: [
    { key: 'fernhill-ops', version: '1.0.1', integrity: FP('Op5'), bytes: 1 },
    { key: 'fernhill-archive', version: '1.0.0', integrity: FP('Ar7'), bytes: 1 },
  ],
};

describe('Save workspace', () => {
  it('lists each database with its app, merges the Check per app, and holds Save while a choice is open', async () => {
    routes['POST /api/v1/workspaces/wsp-1/save/plan'] = () => ({ status: 200, body: savePlan({ choices: true }) });
    withClient(<SaveWorkspaceDialog workspace={WORKSPACE} onClose={() => {}} onMoreChoices={() => {}} />);
    expect(await screen.findByText('Save Fernhill Coffee as one file')).toBeTruthy();
    expect(((await screen.findAllByLabelText('Name'))[0] as HTMLInputElement).value).toBe('Fernhill Ops');
    expect((screen.getAllByLabelText('Version')[0] as HTMLInputElement).value).toBe('1.0.1');
    expect(screen.getByText(/Last saved/)).toBeTruthy();
    expect(screen.getByText('1 thing needs a choice')).toBeTruthy();
    expect(screen.getByText('Fernhill Ops').closest('li')?.textContent).toContain('10 saved views belong to people');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Use More choices on an app to make its choices.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /More choices/ })).toHaveLength(2);
  });

  it('plans again without a database left out, takes the server settings from one, saves and shows the file', async () => {
    const user = userEvent.setup();
    routes['POST /api/v1/workspaces/wsp-1/save/plan'] = (call) => {
      const body = call.body as { apps?: { connectionId: string }[] };
      return { status: 200, body: savePlan({ apps: body.apps?.map((app) => app.connectionId) }) };
    };
    routes['POST /api/v1/workspaces/wsp-1/save'] = () => ({ status: 200, body: { save: SAVED } });
    withClient(<SaveWorkspaceDialog workspace={WORKSPACE} onClose={() => {}} />);
    await screen.findByText('Save Fernhill Coffee as one file');
    await user.click(await screen.findByRole('checkbox', { name: 'Include fernhill_archive' }));
    await user.selectOptions(screen.getByLabelText('Server settings'), 'c-fernhill');
    await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/save/plan'))).toHaveLength(2), { timeout: 2000 });
    const sent = calls.filter((call) => call.url.endsWith('/save/plan')).at(-1)!.body as { apps: { connectionId: string }[]; instanceFrom: string | null };
    expect(sent.apps.map((app) => app.connectionId)).toEqual(['c-fernhill']);
    expect(sent.instanceFrom).toBe('c-fernhill');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Fernhill Coffee is saved as one file')).toBeTruthy();
    expect(screen.getByText('fernhill-coffee.workspace.tgz')).toBeTruthy();
    expect(screen.getByText('fernhill-ops-1.0.1.tgz')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/api/v1/workspaces/save/wss-1/file');
    // A fingerprint is shortened on screen; Copy gives the whole.
    expect(screen.queryByText(SAVED.integrity)).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy the file’s fingerprint' })).toBeTruthy();
  });

  it('says the file would be larger than 128 MB, and keeps Save', async () => {
    const user = userEvent.setup();
    routes['POST /api/v1/workspaces/wsp-1/save/plan'] = () => ({ status: 200, body: savePlan() });
    routes['POST /api/v1/workspaces/wsp-1/save'] = () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'too big', requestId: 'r', details: { reason: 'WORKSPACE_FILE_TOO_LARGE' } } } });
    withClient(<SaveWorkspaceDialog workspace={WORKSPACE} onClose={() => {}} />);
    await screen.findByText('Save Fernhill Coffee as one file');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This workspace file would be larger than 128 MB');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for the server settings only of someone who manages settings', async () => {
    routes['POST /api/v1/workspaces/wsp-1/save/plan'] = () => ({ status: 200, body: savePlan() });
    withClient(<SaveWorkspaceDialog workspace={WORKSPACE} onClose={() => {}} />, ['manifests.manage']);
    await screen.findByText('Save Fernhill Coffee as one file');
    expect(screen.queryByLabelText('Server settings')).toBeNull();
  });
});

describe('the saves list and the files waiting', () => {
  it('lists a workspace file saved here with Download again', async () => {
    routes['GET /api/v1/apps/saves'] = () => ({ status: 200, body: { saves: [], workspaces: [{ id: 'wss-1', workspaceId: 'wsp-1', name: 'Fernhill Coffee', label: 'Fernhill main', savedBy: null, savedAt: 0, integrity: SAVED.integrity, bytes: 421_888, appSaveIds: ['a', 'b'], filename: 'fernhill-coffee.workspace.tgz' }] } });
    const again = vi.fn();
    withClient(<WorkspaceSavesList onSaveAgain={again} />);
    expect(await screen.findByText('Fernhill Coffee')).toBeTruthy();
    expect(screen.getByText('2 apps')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download again' }).getAttribute('href')).toBe('/api/v1/workspaces/save/wss-1/file');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save a newer version' }));
    expect(again).toHaveBeenCalledWith('wsp-1');
  });

  it('offers a stopped file again after a reload, and discards one', async () => {
    const stopped = stagedFile({ state: 'stopped' });
    routes['GET /api/v1/apps/workspace-files'] = () => ({ status: 200, body: { workspaceFiles: [stopped] } });
    routes['DELETE /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: { ...stopped, state: 'discarded' } } });
    const open = vi.fn();
    withClient(<WorkspaceFilesWaiting onOpen={open} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Install the rest' }));
    expect(open).toHaveBeenCalledWith('wsi-1');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });
});

// ── Installing a workspace file ────────────────────────────────────────────

function app(over: Partial<WorkspaceFileApp>): WorkspaceFileApp {
  return { key: 'x', name: 'X', version: '1.0.0', integrity: FP('x'), database: null, suggested: null, sides: [], target: null, state: 'pending', refusal: null, route: 'install', installs: [], ...over };
}

function stagedFile(over: Partial<WorkspaceFile> = {}): WorkspaceFile {
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
    apps: [
      app({ key: 'fernhill-ops', name: 'Fernhill Ops', version: '1.1.0', suggested: 'c-fernhill', route: 'update', installs: [{ installId: 'm1', connectionId: 'c-fernhill', connectionName: 'fernhill', version: '1.0.0' }] }),
      app({ key: 'fernhill-archive', name: 'Fernhill Archive', suggested: 'c-archive' }),
      app({ key: 'suppliers', name: 'Suppliers' }),
    ],
    ...over,
  };
}

function appPlan(key: string, version: string) {
  return { plan: { key, version, installable: true, touchesData: true, create: [], reuse: [], references: [], problems: [], requiresSchemaChange: false, checksum: `sum-${key}`, tables: [], afterInstall: [] } };
}

function planRoutes() {
  routes['POST /api/v1/apps/plan'] = (call) => {
    const body = call.body as { key: string; version: string };
    return { status: 200, body: appPlan(body.key, body.version) };
  };
}

describe('installing a workspace file', () => {
  it('is handed over by the app upload when the server says it is one', async () => {
    const user = userEvent.setup();
    routes['POST /api/v1/apps/upload'] = () => ({ status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'a workspace file', requestId: 'r', details: { reason: 'IS_WORKSPACE_FILE' } } } });
    const handed = vi.fn();
    withClient(<InstallAppWizard onClose={() => {}} onWorkspaceFile={handed} />);
    await user.upload(await screen.findByLabelText(/Bundle file/i), new File(['x'], 'shop.tgz', { type: 'application/gzip' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(handed).toHaveBeenCalled());
    expect((handed.mock.calls[0]![0] as File).name).toBe('shop.tgz');
  });

  it('sends the file to its own upload, reviews each app, and installs into a new workspace', async () => {
    const user = userEvent.setup();
    planRoutes();
    routes['POST /api/v1/apps/upload-workspace'] = () => ({ status: 200, body: { workspaceFile: stagedFile() } });
    routes['POST /api/v1/apps/workspace/wsi-1/install'] = () => ({
      status: 200,
      body: {
        workspaceFile: stagedFile({
          state: 'staged',
          workspace: { mode: 'create', workspaceId: 'wsp-new', name: 'Fernhill Coffee' },
          apps: [
            app({ key: 'fernhill-ops', name: 'Fernhill Ops', version: '1.1.0', target: 'c-fernhill', state: 'updated' }),
            app({ key: 'fernhill-archive', name: 'Fernhill Archive', target: 'c-archive', state: 'installed' }),
            app({ key: 'suppliers', name: 'Suppliers' }),
          ],
        }),
      },
    });
    withClient(<WorkspaceFileInstall file={new File(['x'], 'fernhill-coffee.workspace.tgz')} onClose={() => {}} />);
    expect(await screen.findByText('Check before you install')).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/v1/apps/upload-workspace' && call.query.startsWith('expectedSha512=sha512-'))).toBe(true);
    // The file's card: a workspace file of three apps, made elsewhere.
    expect(screen.getByText('Workspace file')).toBeTruthy();
    expect(screen.getByText('3 apps')).toBeTruthy();
    // The choice: create one named after the file, the first workspace's notice, existing ones disabled with none here.
    expect((screen.getByRole('radio', { name: /Create workspace Fernhill Coffee/ }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Everyone’s menu groups by workspace from now on/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Add to an existing workspace/ }) as HTMLButtonElement).disabled).toBe(true);
    // Each app's row: an update, a ready install, and one that needs a database.
    const ops = await screen.findByTestId('ws-app-fernhill-ops');
    await waitFor(() => expect(within(ops).getByText(/Update ·/)).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTestId('ws-app-fernhill-archive')).getByText('Ready')).toBeTruthy());
    expect(within(screen.getByTestId('ws-app-suppliers')).getByText('Needs a choice')).toBeTruthy();
    expect(screen.getByText('Choose where Suppliers goes.')).toBeTruthy();
    // New database is no option: existing databases only.
    expect(within(screen.getByTestId('ws-app-suppliers')).queryByText(/new database/i)).toBeNull();
    const button = screen.getByRole('button', { name: 'Install 1 app, update 1' });
    await user.click(button);
    await screen.findByText('2 of 3 apps are installed');
    const sent = calls.find((call) => call.url === '/api/v1/apps/workspace/wsi-1/install')!.body as { workspace: unknown; apps: { key: string; connectionId: string | null; install?: { planChecksum?: string } }[] };
    expect(sent.workspace).toEqual({ mode: 'create', name: 'Fernhill Coffee' });
    expect(sent.apps.map((one) => [one.key, one.connectionId])).toEqual([
      ['fernhill-ops', 'c-fernhill'],
      ['fernhill-archive', 'c-archive'],
      ['suppliers', null],
    ]);
    expect(sent.apps[1]!.install?.planChecksum).toBe('sum-fernhill-archive');
    expect(screen.getByText('They are on Fernhill new, in the new workspace Fernhill Coffee.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a database for the rest' })).toBeTruthy();
  });

  it('holds Install while the pasted fingerprint is not the file’s', async () => {
    const user = userEvent.setup();
    planRoutes();
    routes['GET /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: stagedFile() } });
    withClient(<WorkspaceFileInstall resumeId="wsi-1" onClose={() => {}} />);
    await screen.findByText('Check before you install');
    await waitFor(() => expect(within(screen.getByTestId('ws-app-fernhill-archive')).getByText('Ready')).toBeTruthy());
    await user.type(screen.getByLabelText(/Check against the fingerprint/), 'sha512-wrong');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Does not match. This is not the file that was saved.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Install 1 app/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows no workspace choice to someone who does not manage connections, and sends none', async () => {
    const user = userEvent.setup();
    planRoutes();
    routes['GET /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: stagedFile() } });
    routes['POST /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: stagedFile({ state: 'done' }) } });
    withClient(<WorkspaceFileInstall resumeId="wsi-1" onClose={() => {}} />, ['manifests.manage']);
    await screen.findByText('Check before you install');
    expect(screen.queryByText('Create workspace Fernhill Coffee')).toBeNull();
    await waitFor(() => expect(within(screen.getByTestId('ws-app-fernhill-archive')).getByText('Ready')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Install 1 app/ }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/install'))).toBe(true));
    const sent = calls.find((call) => call.method === 'POST' && call.url.endsWith('/install'))!.body as Record<string, unknown>;
    expect(sent).not.toHaveProperty('workspace');
  });

  it('comes back stopped after a reload, and installs the rest', async () => {
    const user = userEvent.setup();
    planRoutes();
    const stopped = stagedFile({
      state: 'stopped',
      workspace: { mode: 'create', workspaceId: 'wsp-new', name: 'Fernhill Coffee' },
      apps: [
        app({ key: 'fernhill-ops', name: 'Fernhill Ops', version: '1.1.0', target: 'c-fernhill', state: 'updated' }),
        app({ key: 'fernhill-archive', name: 'Fernhill Archive', target: 'c-archive', state: 'installed' }),
        app({ key: 'suppliers', name: 'Suppliers', target: 'c-suppliers', state: 'stopped', refusal: { reason: 'STOPPED', message: 'the database went away' } }),
      ],
    });
    routes['GET /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: stopped } });
    routes['POST /api/v1/apps/workspace/wsi-1/install'] = () => ({ status: 200, body: { workspaceFile: { ...stopped, state: 'done', apps: stopped.apps.map((one) => (one.key === 'suppliers' ? { ...one, state: 'installed', refusal: null } : one)) } } });
    withClient(<WorkspaceFileInstall resumeId="wsi-1" onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('2 of 3 installed. Suppliers stopped.');
    const rest = within(alert).getByRole('button', { name: 'Install the rest' });
    await waitFor(() => expect((rest as HTMLButtonElement).disabled).toBe(false));
    await user.click(rest);
    await screen.findByText('3 of 3 apps are installed');
    const sent = calls.find((call) => call.method === 'POST' && call.url.endsWith('/install'))!.body as { apps: { key: string; connectionId: string | null }[] };
    expect(sent.apps).toEqual([expect.objectContaining({ key: 'suppliers', connectionId: 'c-suppliers' })]);
  });

  it('says why a whole file is refused', async () => {
    routes['POST /api/v1/apps/upload-workspace'] = () => ({ status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'x', requestId: 'r', details: { reason: 'WORKSPACE_FILE_INTEGRITY' } } } });
    withClient(<WorkspaceFileInstall file={new File(['x'], 'f.workspace.tgz')} onClose={() => {}} />);
    expect(await screen.findByText('This workspace file can’t be installed')).toBeTruthy();
    expect(screen.getByText('An app inside is not the file that was saved: its fingerprint does not match.')).toBeTruthy();
  });
});

describe('the review’s words', () => {
  it('counts installs and updates on the button', () => {
    expect(installLabel(2, 0)).toBe('Install 2 apps');
    expect(installLabel(0, 1)).toBe('Update 1 app');
    expect(installLabel(2, 1)).toBe('Install 2 apps, update 1');
  });

  it('says what is refused and what waits', () => {
    const apps = [app({ key: 'a', name: 'Fernhill Ops' }), app({ key: 'b', name: 'Fernhill Archive' }), app({ key: 'c', name: 'Suppliers' })];
    expect(summaryOf(apps, { a: 'refused', b: 'ready', c: 'ready' })).toBe('Fernhill Ops is refused. The others install.');
    expect(summaryOf(apps, { a: 'ready', b: 'ready', c: 'database' })).toBe('Fernhill Ops and Fernhill Archive install now. Make the choices for Suppliers to add it.');
  });

  it('reads an app already at its version on its database as installed', () => {
    const there = app({ installs: [{ installId: 'i', connectionId: 'c1', connectionName: 'db', version: '1.0.0' }] });
    expect(statusOf(there, 'c1', undefined)).toBe('installed');
    expect(statusOf(there, null, undefined)).toBe('database');
  });
});
