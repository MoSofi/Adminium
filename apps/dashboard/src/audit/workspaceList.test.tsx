// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Audit log under workspaces:
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the log is the tab's workspace's, named by the title;
 *  - All in one menu: a Workspaces column of chips, and a filter that
 *    narrows the request.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
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
import type { AuditEntryDto } from './auditApi.js';
import { AuditLogPage } from './AuditLogPage.js';

function entry(id: string, action: string, connectionId: string | null): AuditEntryDto {
  return {
    id,
    createdAt: 1_700_000_000_000,
    actorKind: 'user',
    actorId: 'usr_test',
    actorLabel: 'Ava Reyes',
    category: 'data',
    action,
    connectionId,
    entity: null,
    changes: null,
    ip: null,
    userAgent: null,
    requestId: null,
  };
}

const ENTRIES = [entry('aud_1', 'record.update', WS_DB.suppliers), entry('aud_2', 'user.invite', null)];
const answers = [['/api/v1/audit', { entries: ENTRIES, nextCursor: null }]] as const;
const listUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/audit');

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

describe('the Audit log', () => {
  it('on a server with no workspace, asks for every entry and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(<AuditLogPage />, workspacesBootstrap(null), answers);
    const table = await screen.findByTestId('audit-table');
    expect(listUrls(urls)).toEqual(['/api/v1/audit']);
    expect(within(table).queryByRole('columnheader', { name: 'Workspaces' })).toBeNull();
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the title, with no column', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(<AuditLogPage />, bootstrap, answers);
    const table = await screen.findByTestId('audit-table');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(within(table).queryByRole('columnheader', { name: 'Workspaces' })).toBeNull();
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
  });

  it('All in one menu: a Workspaces column of chips, and the filter narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(<AuditLogPage />, workspacesBootstrap('all'), answers);
    const table = await screen.findByTestId('audit-table');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    expect(within(table).getByRole('columnheader', { name: 'Workspaces' })).toBeTruthy();
    const [onDatabase, serverWide] = within(table).getAllByTestId('audit-row');
    expect(chipNames(onDatabase)).toEqual(['Fernhill Coffee', 'Kiln Street Pottery']);
    // An entry of no database has no workspace to name.
    expect(chipNames(serverWide)).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Workspace'), KILN.id);
    await waitFor(() => expect(listUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });
});
