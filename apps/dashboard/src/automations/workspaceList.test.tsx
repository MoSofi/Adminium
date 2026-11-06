// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules list and the workflow logs under workspaces:
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the list is the tab's workspace's, named by the title;
 *  - All in one menu: everyone's rules with their workspaces, and a filter
 *    that narrows the request.
 * A run carries no database of its own, so the logs narrow but draw no chips.
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
import type { RuleView, RunsPage } from './api.js';
import { AutomationRulesPage } from './AutomationRulesPage.js';
import { WorkflowLogsPage } from './WorkflowLogsPage.js';

function rule(id: string, name: string, connectionId: string): RuleView {
  return {
    id,
    connectionId,
    name,
    description: null,
    enabled: true,
    trigger: { kind: 'record', event: 'updated', connectionId, table: 'public.items', watch: false },
    graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When an item changes' }] },
    timeSavedMinutes: null,
    nextRunAt: null,
    valid: true,
    incompleteNodeId: null,
    stats: { runs30d: 0, successRate30d: null, lastRunAt: null },
    managed: null,
    createdAt: 1,
    updatedAt: 1,
  } as RuleView;
}

const RULES = [rule('r_fern', 'Low stock alert', WS_DB.fernhill), rule('r_sup', 'Chase late orders', WS_DB.suppliers), rule('r_scratch', 'Clear test imports', WS_DB.scratch)];

const RUNS: RunsPage = {
  runs: [{ id: 'run_1', automationId: 'r_fern', ruleName: 'Low stock alert', status: 'succeeded', origin: 'record', trigger: 'items.updated', startedAt: 1, finishedAt: 2, durationMs: 1, wakeAt: null }],
  cursor: { next: null },
  counts: { all: 1, success: 1, failed: 0, running: 0 },
};

const rulesPage = (
  <AppToastProvider>
    <AutomationRulesPage />
  </AppToastProvider>
);

const rulesUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/automations');
const runsUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/automation-runs');

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

describe('the rules list', () => {
  const answers = [['/api/v1/automations', { rules: RULES }]] as const;

  it('on a server with no workspace, asks for every rule and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(rulesPage, workspacesBootstrap(null), answers);
    await screen.findByTestId('rule-card-r_sup');
    expect(rulesUrls(urls)).toEqual(['/api/v1/automations']);
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the title', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(rulesPage, bootstrap, answers);
    await screen.findByTestId('rule-card-r_sup');
    expect(rulesUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
    expect(document.querySelector('[data-part="workspace-chips"]')).toBeNull();
  });

  it('All in one menu: every rule with its workspaces, and the filter narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(rulesPage, workspacesBootstrap('all'), answers);
    const shared = await screen.findByTestId('rule-card-r_sup');
    expect(rulesUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    // A database in two workspaces shows both; one in none says so.
    expect(chipNames(shared)).toEqual(['Fernhill Coffee', 'Kiln Street Pottery']);
    expect(chipNames(screen.getByTestId('rule-card-r_scratch'))).toEqual(['Other databases']);

    const filter = screen.getByLabelText('Workspace');
    expect(within(filter).getAllByRole('option').map((option) => option.textContent)).toEqual(['All workspaces', 'Fernhill Coffee', 'Kiln Street Pottery', 'Other databases']);
    await user.selectOptions(filter, KILN.id);
    await waitFor(() => expect(rulesUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
    await user.selectOptions(filter, 'other');
    await waitFor(() => expect(rulesUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id, 'other']));
  });
});

describe('the workflow logs', () => {
  const answers = [['/api/v1/automation-runs', RUNS]] as const;

  it('on a server with no workspace, asks for every run and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(<WorkflowLogsPage />, workspacesBootstrap(null), answers);
    await screen.findByText('items.updated');
    expect(runsUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: asks for the tab\'s workspace and names it by the title', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(<WorkflowLogsPage />, bootstrap, answers);
    await screen.findByText('items.updated');
    expect(runsUrls(urls).map(workspaceIdOf)).toEqual([KILN.id]);
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
  });

  it('All in one menu: the filter narrows the request; a run has no database, so no chips', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(<WorkflowLogsPage />, workspacesBootstrap('all'), answers);
    await screen.findByText('items.updated');
    expect(runsUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    expect(document.querySelector('[data-part="workspace-chips"]')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Workspace'), KILN.id);
    await waitFor(() => expect(runsUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });
});
