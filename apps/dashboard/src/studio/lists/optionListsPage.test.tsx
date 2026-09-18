// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/lists` and the editor over it (plan 50 T37).
 *
 * The transport is stubbed at `fetch` rather than at the API module, because
 * the claims worth making here are about BYTES: what a copy of a built-in
 * sends, and what "store the label instead" sends differently. A mock of
 * `createOptionList` would prove the page called a function, which is not the
 * claim.
 *
 * What is proved:
 *
 *  1. the built-ins are listed and cannot be edited or deleted from the page;
 *  2. copying a built-in POSTs the CODES under a free key, and "store the
 *     label instead" POSTs the LABELS as the values — the one difference
 *     between the two, and the thing that decides what lands in every row from
 *     then on;
 *  3. a 409 delete names the columns that use the list, rather than reporting a
 *     failure the operator cannot act on.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { PageActionsProvider, PageActionsSlot } from '../../shell/PageActionsProvider.js';
import { jsonResponse } from '../../test/fixtures.js';

import { OptionListsPage } from './OptionListsPage.js';
import { copyOfList, freeKey, draftIssue, type OptionListView } from './optionListsApi.js';

const COUNTRIES: OptionListView = {
  key: 'builtin:countries',
  name: 'Countries',
  items: [
    { value: 'DE', label: 'Germany' },
    { value: 'FR', label: 'France' },
  ],
  origin: 'builtin',
  editable: false,
};

const STAGES: OptionListView = {
  key: 'stages',
  name: 'Stages',
  items: [{ value: 'new', label: 'New' }],
  origin: 'custom',
  editable: true,
};

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

function renderPage(options: { lists?: OptionListView[]; usedBy?: string[] } = {}) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
      calls.push({ method, url, body });
      if (method === 'GET') {
        return Promise.resolve(jsonResponse(200, { lists: options.lists ?? [COUNTRIES, STAGES] }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(
          options.usedBy === undefined
            ? jsonResponse(200, { deleted: true })
            : jsonResponse(409, {
                error: { code: 'CONFLICT', message: 'in use', details: { usedBy: options.usedBy } },
              }),
        );
      }
      return Promise.resolve(jsonResponse(201, { ...STAGES }));
    }),
  );
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PageActionsProvider>
        <PageActionsSlot />
        <OptionListsPage />
      </PageActionsProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

const lastBody = (calls: RecordedCall[], method: string): unknown =>
  calls.filter((call) => call.method === method).at(-1)?.body;

describe('copies of a list', () => {
  it('keeps the codes, and takes a key that is free', () => {
    const copy = copyOfList(COUNTRIES, { taken: ['countries'] });
    expect(copy.key).toBe('countries-2');
    expect(copy.origin).toBe('copy:builtin:countries');
    expect(copy.items).toEqual([
      { value: 'DE', label: 'Germany' },
      { value: 'FR', label: 'France' },
    ]);
  });

  it('"store the label" makes the label the value, and drops the label', () => {
    const copy = copyOfList(COUNTRIES, { storeLabels: true });
    expect(copy.key).toBe('countries-labels');
    // A label equal to its value is one thing said twice, and it would travel
    // into the project file that way.
    expect(copy.items).toEqual([{ value: 'Germany' }, { value: 'France' }]);
  });

  it('falls back to the value where a list has no labels', () => {
    const noLabels: OptionListView = { ...COUNTRIES, items: [{ value: 'DE' }] };
    expect(copyOfList(noLabels, { storeLabels: true }).items).toEqual([{ value: 'DE' }]);
  });

  it('numbers a key only when it has to', () => {
    expect(freeKey('stages', [])).toBe('stages');
    expect(freeKey('stages', ['stages', 'stages-2'])).toBe('stages-3');
  });

  it('says what is wrong with a draft, in order', () => {
    expect(draftIssue({ name: ' ', items: [{ value: 'a' }] })).toMatch(/name/i);
    expect(draftIssue({ name: 'S', items: [] })).toMatch(/at least one/i);
    expect(draftIssue({ name: 'S', items: [{ value: 'a' }, { value: '' }] })).toMatch(/empty/i);
    expect(draftIssue({ name: 'S', items: [{ value: 'a' }, { value: 'a' }] })).toMatch(/twice/i);
    expect(draftIssue({ name: 'S', items: [{ value: 'a' }] })).toBeNull();
  });
});

describe('the lists page', () => {
  beforeAll(async () => {
    await installTestI18n();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the built-ins without a delete, beside the workspace’s own', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('studio-lists-row')).toHaveLength(2));
    expect(screen.getByText('Countries')).toBeTruthy();
    expect(screen.getByText('Built in')).toBeTruthy();
    // One Delete on the page: the custom list's. A built-in has none, because
    // there is nothing to delete — it is code.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('copies a built-in with its codes, and with its labels when asked', async () => {
    const { user, calls } = renderPage();
    await waitFor(() => expect(screen.getAllByTestId('studio-lists-row')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByTestId('option-list-copy'));
    await user.click(await screen.findByTestId('option-list-save'));
    await waitFor(() => expect(lastBody(calls, 'POST')).toBeDefined());
    expect(lastBody(calls, 'POST')).toMatchObject({
      key: 'countries',
      origin: 'copy:builtin:countries',
      items: [
        { value: 'DE', label: 'Germany' },
        { value: 'FR', label: 'France' },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByTestId('option-list-copy-labels'));
    await user.click(await screen.findByTestId('option-list-save'));
    await waitFor(() =>
      expect(lastBody(calls, 'POST')).toMatchObject({ key: 'countries-labels' }),
    );
    expect(lastBody(calls, 'POST')).toMatchObject({
      items: [{ value: 'Germany' }, { value: 'France' }],
    });
  });

  it('opens a blank draft for a NEW list, key field and all', async () => {
    /*
     * "New list" has no row behind it, and a draft seeded from one would have
     * an empty key it could never change — the field that asks for the key
     * only appears for a list that does not exist yet.
     */
    const { user, calls } = renderPage();
    await waitFor(() => expect(screen.getAllByTestId('studio-lists-row')).toHaveLength(2));
    await user.click(screen.getByTestId('studio-lists-new'));
    await user.type(await screen.findByTestId('option-list-name'), 'Stages');
    await user.type(screen.getByTestId('option-list-key'), 'stages');
    await user.type(screen.getByLabelText('Value 1'), 'new');
    await user.click(screen.getByTestId('option-list-save'));
    await waitFor(() => expect(lastBody(calls, 'POST')).toBeDefined());
    expect(lastBody(calls, 'POST')).toEqual({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] });
  });

  it('names the columns when a delete is refused', async () => {
    const { user } = renderPage({ usedBy: ['public.deals.stage'] });
    await waitFor(() => expect(screen.getAllByTestId('studio-lists-row')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByTestId('studio-lists-delete-confirm'));
    // "Remove it from those columns first" is only actionable if it says which.
    expect(await screen.findByText(/public\.deals\.stage/)).toBeTruthy();
  });
});
