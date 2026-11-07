// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "SHOWN IN" AS AN ADD-ON'S PAGE GETS IT, through the host's `app` namespace.
 *
 * A page of an add-on (the invoices' list and editor) stores where each of
 * its items is listed and lets the host draw it: the chips on a row, the
 * Workspace filter in All in one menu, the tab's workspace chip in One at a
 * time, the editor's control that saves each change through the add-on's own
 * PATCH, and the note on a chosen item that is not listed here. The
 * workspaces are the session's (bootstrap): nothing asks the workspace
 * routes, which need a permission most readers do not hold.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AddOnAppNamespace, AddOnShownIn } from '@adminium/add-on-contracts/runtime';
import { clearAddOnRuntime, requireAddOnHost } from '@adminium/add-on-contracts/runtime';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppToastProvider } from '../pages/toasts.js';
import { ShownInScopeProvider } from '../shown-in/scope.js';
import { makeBootstrap } from '../test/fixtures.js';
import { ensureAddOnRuntime, resetAddOnRuntime } from './runtime.js';

const FC = { id: 'wsp_fc', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: ['c1'] };
const KS = { id: 'wsp_ks', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: ['c2'] };

let app: AddOnAppNamespace;
beforeAll(async () => {
  clearAddOnRuntime();
  resetAddOnRuntime();
  await ensureAddOnRuntime();
  app = requireAddOnHost().app as unknown as AddOnAppNamespace;
});
afterAll(() => {
  clearAddOnRuntime();
  resetAddOnRuntime();
});

function Wrap({ children, view, current = null }: { children: ReactNode; view: 'one' | 'all'; current?: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['bootstrap'], makeBootstrap({ workspaces: { workspaces: [KS, FC], otherDatabases: null, workspaceView: view, lastWorkspaceId: null, manage: false } } as never));
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <ShownInScopeProvider currentWorkspaceId={current} view={view}>
          {children}
        </ShownInScopeProvider>
      </AppToastProvider>
    </QueryClientProvider>
  );
}

/** An add-on's list, as the invoices' manager would write it. */
function Manager({ rows }: { rows: { id: string; name: string; shownIn: AddOnShownIn }[] }) {
  const { CurrentWorkspaceChip, ShownInChips, WorkspaceFilter, useShownInList } = app;
  const list = useShownInList();
  return (
    <div>
      <CurrentWorkspaceChip />
      {list.filter === null ? null : <WorkspaceFilter value={list.filter.value} onChange={list.filter.onChange} />}
      <p data-testid="asks">{list.workspaceId ?? 'every'}</p>
      <ul>
        {rows.filter((row) => list.keeps(row.shownIn)).map((row) => (
          <li key={row.id} data-testid="row">
            {row.name}
            {list.showColumn ? <ShownInChips shownIn={row.shownIn} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROWS = [
  { id: 'inv_1', name: 'Café layout', shownIn: { mode: 'chosen' as const, workspaceIds: ['wsp_fc'] } },
  { id: 'inv_2', name: 'Studio layout', shownIn: { mode: 'chosen' as const, workspaceIds: ['wsp_ks'] } },
  { id: 'inv_3', name: 'Plain layout', shownIn: { mode: 'all' as const, workspaceIds: [] } },
];

describe('"Shown in" on an add-on\'s page', () => {
  it('in All in one menu: chips on every row, and the Workspace filter narrows the list and the request', async () => {
    const user = userEvent.setup();
    render(
      <Wrap view="all">
        <Manager rows={ROWS} />
      </Wrap>,
    );
    expect(await screen.findAllByTestId('workspace-chip')).toHaveLength(2);
    expect(await screen.findByTestId('shown-in-all')).toBeTruthy();
    expect(screen.getByTestId('asks').textContent).toBe('every');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Workspace' }), 'wsp_ks');
    expect(screen.getByTestId('asks').textContent).toBe('wsp_ks');
    expect(screen.getAllByTestId('row').map((row) => row.firstChild?.textContent)).toEqual(['Studio layout', 'Plain layout']);
  });

  it('in One at a time: the tab\'s workspace, with no filter, and the request names it', async () => {
    render(
      <Wrap view="one" current="wsp_fc">
        <Manager rows={ROWS} />
      </Wrap>,
    );
    expect((await screen.findByTestId('current-workspace-chip')).textContent).toContain('Fernhill Coffee');
    expect(screen.queryByTestId('workspace-filter')).toBeNull();
    expect(screen.getByTestId('asks').textContent).toBe('wsp_fc');
    expect(screen.getAllByTestId('row').map((row) => row.firstChild?.textContent)).toEqual(['Café layout', 'Plain layout']);
  });

  it('the editor\'s control saves each change through the add-on\'s own write, and a hidden item says where it is listed', async () => {
    const user = userEvent.setup();
    const save = vi.fn<(next: AddOnShownIn) => Promise<void>>(() => Promise.resolve());
    const { ShownInField, HiddenHereNote, useShownInPicker } = app;
    function Editor() {
      const picker = useShownInPicker();
      const shownIn: AddOnShownIn = { mode: 'chosen', workspaceIds: ['wsp_ks'] };
      return (
        <>
          <ShownInField value={{ mode: 'all', workspaceIds: [] }} save={save} />
          {picker.keeps(shownIn) ? null : <HiddenHereNote shownIn={shownIn} />}
        </>
      );
    }
    render(
      <Wrap view="one" current="wsp_fc">
        <Editor />
      </Wrap>,
    );
    await user.click(await screen.findByRole('radio', { name: 'Only these workspaces' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ mode: 'chosen', workspaceIds: ['wsp_fc'] }));
    expect((await screen.findByTestId('shown-in-hidden-note')).textContent).toContain('Not listed in Fernhill Coffee');
  });

  it('says there is nothing to choose on a server with no workspaces', () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(['bootstrap'], makeBootstrap({} as never));
    const { useShownInList, useShownInScope } = app;
    function Page() {
      const scope = useShownInScope();
      const list = useShownInList();
      return <p data-testid="active">{`${String(scope.active)} ${String(list.showColumn)} ${String(list.filter)} ${list.workspaceId ?? 'every'}`}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('active').textContent).toBe('false false null every');
  });
});
