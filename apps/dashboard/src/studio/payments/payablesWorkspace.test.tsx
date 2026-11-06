// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payable tables under workspaces:
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the list is the tab's workspace's, named by the heading;
 *  - All in one menu: a Workspaces column of chips and a filter that narrows
 *    the request.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import {
  KILN,
  WS_DB,
  anyWorkspaceUi,
  chipNames,
  chooseTabWorkspace,
  renderListPage,
  resetTabWorkspace,
  workspaceIdOf,
  workspacesBootstrap,
} from '../../test/workspaceLists.js';
import { PayablesTab } from './PayablesTab.js';
import type { PayablesList } from './paymentsApi.js';

const LIST: PayablesList = {
  profiles: [{ id: 'pay_1', connectionId: WS_DB.kiln, tableName: 'public.firings', enabled: true, valid: true, payments: 'kept', updatedAt: 1 }],
  shapes: [{ connectionId: WS_DB.fernhill, tableName: 'public.invoices', version: 2 }],
};
const answers = [['/api/v1/payments/payables', { data: LIST }]] as const;
const listUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/payments/payables');

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

describe('the payable tables', () => {
  it('on a server with no workspace, asks for every table and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(<PayablesTab canManage />, workspacesBootstrap(null), answers);
    await screen.findByText('firings');
    expect(listUrls(urls)).toEqual(['/api/v1/payments/payables']);
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the heading', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(<PayablesTab canManage />, bootstrap, answers);
    await screen.findByText('firings');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(chipNames(screen.getByRole('heading', { name: /What can be paid/ }))).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Workspaces' })).toBeNull();
  });

  it('All in one menu: a Workspaces column, and a filter that starts at All and narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(<PayablesTab canManage />, workspacesBootstrap('all'), answers);
    await screen.findByText('firings');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(screen.getByRole('columnheader', { name: 'Workspaces' })).toBeTruthy();
    expect(chipNames(screen.getByTestId('payments-payable-pay_1'))).toEqual(['Kiln Street Pottery']);
    expect(chipNames(screen.getByTestId('payments-shape-public.invoices'))).toEqual(['Fernhill Coffee']);
    expect(chipNames(screen.getByRole('heading', { name: /What can be paid/ }))).toEqual([]);
    const filter = screen.getByLabelText('Workspace');
    expect((filter as HTMLSelectElement).value).toBe('');
    await user.selectOptions(filter, KILN.id);
    await waitFor(() => expect(listUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });
});
