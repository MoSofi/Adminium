// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API keys and endpoints under workspaces. Keys and endpoints are one
 * database's, picked by the page's database select; the workspace says which
 * databases it offers:
 *  - a server with none offers every database and draws nothing of workspaces;
 *  - One at a time: the tab's workspace's databases, the first of them read,
 *    and the workspace named by the title;
 *  - All in one menu: a filter that starts at All and narrows the select.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import {
  KILN,
  WS_DB,
  anyWorkspaceUi,
  chooseTabWorkspace,
  renderListPage,
  resetTabWorkspace,
  titleChipNames,
  workspacesBootstrap,
} from '../../test/workspaceLists.js';
import { ApiKeysPage } from './ApiKeysPage.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const CONNECTIONS = [
  { id: WS_DB.fernhill, name: 'Fernhill', engine: 'postgres', status: 'ok' },
  { id: WS_DB.kiln, name: 'Kiln', engine: 'postgres', status: 'ok' },
  { id: WS_DB.suppliers, name: 'Suppliers', engine: 'postgres', status: 'ok' },
  { id: WS_DB.scratch, name: 'Scratch', engine: 'postgres', status: 'ok' },
];
const answers = [
  ['/api/v1/public-api', { enabled: true, registered: true, origins: [], docsEnabled: true }],
  ['/api/v1/public-keys', { keys: [] }],
  ['/api/v1/connections', { connections: CONNECTIONS }],
  ['/api/v1/public-endpoints', { snapshot: true, endpoints: [], methods: ['GET'], sources: [], unaddressable: [] }],
  ['/api/v1/public-api/stats', { requests24h: 0, errors24h: 0 }],
] as const;

const endpointDatabases = (urls: string[]) =>
  urls.filter((url) => url.split('?')[0] === '/api/v1/public-endpoints').map((url) => new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('connectionId'));
const offered = () => [...(screen.getByLabelText('Connection') as HTMLSelectElement).options].map((option) => option.text);

function renderPage(bootstrap: ReturnType<typeof workspacesBootstrap>) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return renderListPage(
    <AppToastProvider>
      <Suspense fallback={null}>
        <ApiKeysPage />
      </Suspense>
    </AppToastProvider>,
    bootstrap,
    answers,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  resetTabWorkspace();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the API keys page under workspaces', () => {
  it('on a server with no workspace, offers every database and draws nothing of workspaces', async () => {
    const { urls } = renderPage(workspacesBootstrap(null));
    await screen.findByRole('heading', { name: 'Active keys' });
    expect(offered()).toEqual(['Fernhill', 'Kiln', 'Suppliers', 'Scratch']);
    await waitFor(() => expect(endpointDatabases(urls)).toEqual([WS_DB.fernhill]));
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: offers the tab\'s workspace\'s databases, reads the first, and names the workspace', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderPage(bootstrap);
    await screen.findByRole('heading', { name: 'Active keys' });
    expect(offered()).toEqual(['Kiln', 'Suppliers']);
    await waitFor(() => expect(endpointDatabases(urls)).toEqual([WS_DB.kiln]));
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
  });

  it('All in one menu: the filter starts at All and narrows what the select offers', async () => {
    const user = userEvent.setup();
    renderPage(workspacesBootstrap('all'));
    await screen.findByRole('heading', { name: 'Active keys' });
    expect(offered()).toEqual(['Fernhill', 'Kiln', 'Suppliers', 'Scratch']);
    expect(titleChipNames()).toEqual([]);
    const filter = screen.getByLabelText('Workspace');
    expect((filter as HTMLSelectElement).value).toBe('');
    await user.selectOptions(filter, KILN.id);
    await waitFor(() => expect(offered()).toEqual(['Kiln', 'Suppliers']));
  });
});
