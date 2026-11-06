// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Data exports list under workspaces:
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the list is the tab's workspace's, named by the title;
 *  - All in one menu: a filter that narrows the request. The rows draw
 *    through the shared jobs list, which has no column to carry chips.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import {
  KILN,
  WS_DB,
  anyWorkspaceUi,
  chooseTabWorkspace,
  renderListPage,
  resetTabWorkspace,
  titleChipNames,
  workspaceIdOf,
  workspacesBootstrap,
} from '../test/workspaceLists.js';
import type { ExportDto } from './api.js';
import { DataExportsPage } from './DataExportsPage.js';

function exported(id: string, connectionId: string, table: string): ExportDto {
  return {
    id,
    connectionId,
    requestedBy: 'usr_test',
    source: { kind: 'table', table },
    format: 'csv',
    status: 'ready',
    fileId: `file_${id}`,
    filename: `${table}-${id}.csv`,
    sizeBytes: 120,
    rowCount: 4,
    error: null,
    jobId: null,
    createdAt: 1,
    completedAt: 2,
    expiresAt: null,
  };
}

const EXPORTS = [exported('exp_1', WS_DB.fernhill, 'public.orders'), exported('exp_2', WS_DB.kiln, 'public.firings')];
const answers = [['/api/v1/exports', { data: EXPORTS }]] as const;
const listUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/exports');

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

describe('the Data exports list', () => {
  it('on a server with no workspace, asks for every export and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(<DataExportsPage />, workspacesBootstrap(null), answers);
    await screen.findByText('public.orders-exp_1.csv');
    expect(listUrls(urls)).toEqual(['/api/v1/exports']);
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the title', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(<DataExportsPage />, bootstrap, answers);
    await screen.findByText('public.orders-exp_1.csv');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
  });

  it('All in one menu: the filter starts at All and narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(<DataExportsPage />, workspacesBootstrap('all'), answers);
    await screen.findByText('public.orders-exp_1.csv');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    const filter = screen.getByLabelText('Workspace');
    expect((filter as HTMLSelectElement).value).toBe('');
    await user.selectOptions(filter, KILN.id);
    await waitFor(() => expect(listUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });
});
