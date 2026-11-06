// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Files list under workspaces:
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the list is the tab's workspace's, named by the title;
 *  - All in one menu: a Workspaces column of chips in the list view, and a
 *    filter that narrows the request;
 *  - a rail entry that names a connection sends that alone: the route refuses
 *    a workspace and a connection together.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { AppToastProvider } from '../pages/toasts.js';
import {
  KILN,
  WS_DB,
  anyWorkspaceUi,
  chipNames,
  chooseTabWorkspace,
  renderListPage,
  resetTabWorkspace,
  titleChipNames,
  workspaceIdOf,
  workspacesBootstrap,
} from '../test/workspaceLists.js';
import type { FileDto } from './api.js';
import { FilesPage } from './FilesPage.js';
import { ALL_FILES_FILTERS, buildFilesPath } from './filesQueries.js';

function file(id: string, filename: string, connectionId: string, onRecord: boolean): FileDto {
  return {
    id,
    filename,
    mime: 'application/pdf',
    sizeBytes: 2_400,
    sha256: 'a'.repeat(64),
    kind: 'upload',
    destinationId: null,
    connectionId,
    uploadedBy: 'usr_test',
    createdAt: 1_700_000_000_000,
    attachedAt: 1_700_000_001_000,
    deletedAt: null,
    entity: onRecord ? { connectionId, table: 'public.invoices', recordId: '42' } : null,
    contentPath: `/api/v1/files/${id}/content`,
  };
}

const FILES = [file('file_1', 'contract.pdf', WS_DB.suppliers, true), file('file_2', 'price-list.pdf', WS_DB.scratch, false)];
const answers = [
  ['/api/v1/files', { data: FILES, nextCursor: null }],
  ['/api/v1/files/usage', { data: [] }],
] as const;
const listUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/files');

function page() {
  return (
    <AppToastProvider>
      <FilesPage />
    </AppToastProvider>
  );
}

async function listView(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByTestId('files-view-list'));
  return screen.findByTestId('files-table');
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

describe('the Files list', () => {
  it('on a server with no workspace, asks for every file and draws nothing of workspaces', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(page(), workspacesBootstrap(null), answers);
    const table = await listView(user);
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(within(table).queryByRole('columnheader', { name: 'Workspaces' })).toBeNull();
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the title, with no column', async () => {
    const user = userEvent.setup();
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(page(), bootstrap, answers);
    const table = await listView(user);
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(within(table).queryByRole('columnheader', { name: 'Workspaces' })).toBeNull();
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
  });

  it('All in one menu: a Workspaces column of chips, and the filter narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(page(), workspacesBootstrap('all'), answers);
    const table = await listView(user);
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    // Beside "On record", which is where the row says its database.
    expect(headers.indexOf('Workspaces')).toBe(headers.indexOf('On record') + 1);
    const [onRecord, loose] = within(table).getAllByTestId('files-row');
    expect(chipNames(onRecord)).toEqual(['Fernhill Coffee', 'Kiln Street Pottery']);
    expect(chipNames(loose)).toEqual(['Other databases']);

    await user.selectOptions(screen.getByLabelText('Workspace'), KILN.id);
    await waitFor(() => expect(listUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });

  it('a rail entry that names a connection sends no workspace', () => {
    expect(buildFilesPath(ALL_FILES_FILTERS, null, KILN.id)).toBe(`/api/v1/files?state=live&limit=50&workspaceId=${KILN.id}`);
    expect(buildFilesPath({ ...ALL_FILES_FILTERS, connectionId: WS_DB.kiln }, null, KILN.id)).toBe(`/api/v1/files?state=live&limit=50&connectionId=${WS_DB.kiln}`);
  });
});
