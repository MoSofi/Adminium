// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in" on the dashboard: the cut a list or a picker makes, the control
 * on an editor, the chips, the Workspace filter, a picker's hidden item and
 * the delete-workspace listing. Nothing is drawn on a server with no
 * workspaces.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AppToastProvider } from '../pages/toasts.js';
import { makeBootstrap } from '../test/fixtures.js';
import { listCut, nextShownIn, pickerWhere, shownWhere, SHOWN_IN_ALL, type ShownIn } from './model.js';
import { OTHER_DATABASES, ShownInScopeProvider, type ShownInScope } from './scope.js';
import { CurrentWorkspaceChip, HiddenHereNote, ShownInChips, ShownInControl, ShownOnlyInList, WorkspaceFilter } from './ShownIn.js';
import { ShownInField } from './ShownInField.js';

const FC = { id: 'wsp_fc', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: ['c1'] };
const KS = { id: 'wsp_ks', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: ['c2'] };

function scope(over: Partial<ShownInScope> = {}): ShownInScope {
  return { workspaces: [FC, KS], active: true, otherDatabases: true, view: 'all', currentWorkspaceId: null, ...over };
}

function client(workspaces: boolean, other = true): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  queryClient.setQueryData(
    ['bootstrap'],
    makeBootstrap(
      (workspaces
        ? { workspaces: { workspaces: [KS, FC], otherDatabases: other ? ['c3'] : null, workspaceView: 'all', lastWorkspaceId: null, manage: true } }
        : {}) as never,
    ),
  );
  return queryClient;
}

function Wrap({ children, workspaces = true, current = null, view = 'one', provided = true }: { children: ReactNode; workspaces?: boolean; current?: string | null; view?: 'one' | 'all'; provided?: boolean }) {
  return (
    <QueryClientProvider client={client(workspaces)}>
      <AppToastProvider>{provided ? <ShownInScopeProvider currentWorkspaceId={current} view={view}>{children}</ShownInScopeProvider> : children}</AppToastProvider>
    </QueryClientProvider>
  );
}

describe('the cut', () => {
  it('keeps what is shown in all everywhere, and a chosen item only where it was chosen', () => {
    const chosen: ShownIn = { mode: 'chosen', workspaceIds: ['wsp_fc'] };
    expect(shownWhere(undefined, 'wsp_ks')).toBe(true);
    expect(shownWhere(SHOWN_IN_ALL, OTHER_DATABASES)).toBe(true);
    expect(shownWhere(chosen, 'wsp_fc')).toBe(true);
    expect(shownWhere(chosen, 'wsp_ks')).toBe(false);
    // "Other databases" lists only what is shown in all workspaces.
    expect(shownWhere(chosen, OTHER_DATABASES)).toBe(false);
    expect(shownWhere({ mode: 'chosen', workspaceIds: [] }, null)).toBe(true);
  });

  it('follows the tab in One at a time, the filter in All in one menu, and never asks the server about Other databases', () => {
    expect(listCut(scope({ view: 'one', currentWorkspaceId: 'wsp_ks' }), 'wsp_fc')).toEqual({ where: 'wsp_ks', workspaceId: 'wsp_ks' });
    expect(listCut(scope({ view: 'all', currentWorkspaceId: 'wsp_ks' }), '')).toEqual({ where: null, workspaceId: undefined });
    expect(listCut(scope({ view: 'all' }), 'wsp_fc')).toEqual({ where: 'wsp_fc', workspaceId: 'wsp_fc' });
    expect(listCut(scope({ view: 'all' }), OTHER_DATABASES)).toEqual({ where: OTHER_DATABASES, workspaceId: undefined });
    // No workspaces: no cut at all.
    expect(listCut(scope({ active: false, workspaces: [], view: 'one', currentWorkspaceId: 'wsp_fc' }), 'wsp_fc')).toEqual({ where: null, workspaceId: undefined });
    // A picker narrows to the tab's workspace in either view.
    expect(pickerWhere(scope({ view: 'all', currentWorkspaceId: 'wsp_fc' }))).toBe('wsp_fc');
    expect(pickerWhere(scope({ active: false, currentWorkspaceId: 'wsp_fc' }))).toBeNull();
  });

  it('starts "Only these" from the tab’s workspace and toggles one at a time', () => {
    expect(nextShownIn(SHOWN_IN_ALL, { mode: 'chosen' }, 'wsp_fc')).toEqual({ mode: 'chosen', workspaceIds: ['wsp_fc'] });
    expect(nextShownIn(SHOWN_IN_ALL, { mode: 'chosen' }, OTHER_DATABASES)).toEqual({ mode: 'chosen', workspaceIds: [] });
    const one: ShownIn = { mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_unseen'] };
    expect(nextShownIn(one, { toggle: 'wsp_ks', on: true }, null)).toEqual({ mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_ks', 'wsp_unseen'] });
    // A workspace this person cannot see is kept through their edit.
    expect(nextShownIn(one, { toggle: 'wsp_fc', on: false }, null)).toEqual({ mode: 'chosen', workspaceIds: ['wsp_unseen'] });
    expect(nextShownIn(one, { mode: 'all' }, null)).toEqual(SHOWN_IN_ALL);
  });
});

describe('the control', () => {
  it('offers both choices and, under "Only these", every workspace by position', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Wrap current="wsp_ks">
        <ShownInControl value={SHOWN_IN_ALL} onChange={onChange} />
      </Wrap>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Shown in' });
    expect(within(group).getByRole('radio', { name: 'All workspaces' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryAllByTestId('shown-in-workspace')).toHaveLength(0);
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Only these workspaces' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'chosen', workspaceIds: ['wsp_ks'] });

    rerender(
      <Wrap current="wsp_ks">
        <ShownInControl value={{ mode: 'chosen', workspaceIds: ['wsp_ks'] }} onChange={onChange} />
      </Wrap>,
    );
    const boxes = screen.getAllByTestId('shown-in-workspace');
    expect(boxes.map((box) => box.getAttribute('data-workspace-id'))).toEqual(['wsp_fc', 'wsp_ks']);
    expect(screen.getByRole('checkbox', { name: 'Kiln Street Pottery' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Fernhill Coffee' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_ks'] });
    expect(screen.queryByTestId('shown-in-none-hint')).toBeNull();
  });

  it('says what "chosen, none" means, and counts the workspaces this person cannot see', () => {
    const { rerender } = render(
      <Wrap>
        <ShownInControl value={{ mode: 'chosen', workspaceIds: [] }} onChange={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByTestId('shown-in-none-hint').textContent).toContain('still sends it');
    rerender(
      <Wrap>
        <ShownInControl value={{ mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_gone'] }} onChange={vi.fn()} />
      </Wrap>,
    );
    expect(screen.queryByTestId('shown-in-none-hint')).toBeNull();
    expect(screen.getByText(/workspace you can’t see/)).toBeTruthy();
  });

  it('saves each change in order, and puts the control back when a save fails', async () => {
    let fail = false;
    const saved: ShownIn[] = [];
    const save = vi.fn(async (next: ShownIn) => {
      saved.push(next);
      if (fail) throw new Error('nope');
    });
    render(
      <Wrap current="wsp_fc">
        <ShownInField value={SHOWN_IN_ALL} save={save} />
      </Wrap>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Only these workspaces' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kiln Street Pottery' }));
    await waitFor(() => expect(saved).toEqual([{ mode: 'chosen', workspaceIds: ['wsp_fc'] }, { mode: 'chosen', workspaceIds: ['wsp_fc', 'wsp_ks'] }]));

    fail = true;
    await user.click(screen.getByRole('checkbox', { name: 'Fernhill Coffee' }));
    await waitFor(() => expect(screen.getByText('Couldn’t change where it is listed')).toBeTruthy());
    expect(screen.getByRole('checkbox', { name: 'Fernhill Coffee' }).getAttribute('aria-checked')).toBe('true');
  });

  it('is not there on a server with no workspaces', () => {
    render(
      <Wrap workspaces={false}>
        <ShownInField value={SHOWN_IN_ALL} save={vi.fn()} />
        <CurrentWorkspaceChip />
      </Wrap>,
    );
    expect(screen.queryByTestId('shown-in-control')).toBeNull();
    expect(screen.queryByTestId('current-workspace-chip')).toBeNull();
  });
});

describe('the chips, the filter and the notes', () => {
  it('draws all, the chosen workspaces, none, and the ones this person cannot see', () => {
    render(
      <Wrap>
        <div data-testid="a">
          <ShownInChips shownIn={undefined} />
        </div>
        <div data-testid="b">
          <ShownInChips shownIn={{ mode: 'chosen', workspaceIds: ['wsp_ks', 'wsp_fc', 'wsp_gone'] }} />
        </div>
        <div data-testid="c">
          <ShownInChips shownIn={{ mode: 'chosen', workspaceIds: [] }} />
        </div>
      </Wrap>,
    );
    expect(within(screen.getByTestId('a')).getByTestId('shown-in-all').textContent).toBe('All workspaces');
    expect(within(screen.getByTestId('b')).getAllByTestId('workspace-chip').map((chip) => chip.textContent)).toEqual(['FCFernhill Coffee', 'KSKiln Street Pottery']);
    expect(within(screen.getByTestId('b')).getByText('1 other workspace')).toBeTruthy();
    expect(within(screen.getByTestId('c')).getByTestId('shown-in-none').textContent).toBe('No workspace');
  });

  it('filters by every workspace, and by Other databases when that group is there', () => {
    const onChange = vi.fn();
    render(
      <Wrap>
        <WorkspaceFilter value="" onChange={onChange} />
      </Wrap>,
    );
    const select = screen.getByLabelText('Workspace') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['All workspaces', 'Fernhill Coffee', 'Kiln Street Pottery', 'Other databases']);
    act(() => {
      select.value = 'wsp_ks';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('wsp_ks');
  });

  it('shows the tab’s workspace under a narrowed list in One at a time only', () => {
    const { unmount } = render(
      <Wrap current="wsp_fc" view="one">
        <CurrentWorkspaceChip />
      </Wrap>,
    );
    expect(screen.getByTestId('current-workspace-chip').textContent).toBe('FCFernhill Coffee');
    unmount();
    render(
      <Wrap current="wsp_fc" view="all">
        <CurrentWorkspaceChip />
      </Wrap>,
    );
    expect(screen.queryByTestId('current-workspace-chip')).toBeNull();
  });

  it('says a picked template is not listed here, still sends, and where it is listed', () => {
    render(
      <Wrap current="wsp_fc">
        <HiddenHereNote shownIn={{ mode: 'chosen', workspaceIds: ['wsp_ks'] }} />
      </Wrap>,
    );
    const note = screen.getByTestId('shown-in-hidden-note');
    expect(note.textContent).toContain('Not listed in Fernhill Coffee. Anything that uses it still sends it.');
    expect(within(note).getByTestId('workspace-chip').textContent).toBe('KSKiln Street Pottery');
  });

  it('lists, for a workspace’s delete, what it alone shows, and nothing when there is none', () => {
    const { rerender } = render(
      <Wrap>
        <ShownOnlyInList
          items={[
            { kind: 'email-template', itemId: 'e1', name: 'Firing done' },
            { kind: 'report', itemId: 'r1', name: 'Kiln weekly' },
            { kind: 'invoice', itemId: 'i1', name: 'Kiln invoice' },
          ]}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('shown-only-in').textContent).toContain('3 items are listed only here.');
    expect(screen.getAllByTestId('shown-only-in-item').map((item) => item.textContent)).toEqual(['Firing doneEmail template', 'Kiln weeklyReport layout', 'Kiln invoiceInvoice layout']);
    rerender(
      <Wrap>
        <ShownOnlyInList items={[]} />
      </Wrap>,
    );
    expect(screen.queryByTestId('shown-only-in')).toBeNull();
  });
});

describe('the stories', () => {
  it('each renders', async () => {
    const stories = await import('./shownIn.stories.js');
    for (const [name, story] of Object.entries(stories)) {
      if (name === 'default') continue;
      const { unmount } = render(<>{(story as { render: () => ReactNode }).render()}</>);
      expect(document.body.textContent, name).not.toBe('');
      unmount();
    }
  });
});
