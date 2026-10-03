// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start with an app": built now, shown on Home once the sheet it
 * opens. Its states are what the list route answers: loading, the cards,
 * could not be loaded (with "Try again"), and switched off (with neither);
 * and the filter chips, only from nine apps.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { CatalogApp } from '../api.js';
import { FILTERS_FROM, StartWithAnApp } from './StartWithAnApp.js';

function app(n: number, category: string): CatalogApp {
  return { key: `app-${String(n)}`, version: '0.2.0', name: `App ${String(n)}`, tagline: `What app ${String(n)} does.`, category, sides: ['staff', 'customer'], iconTint: null, iconPaths: [], monogram: null };
}

function mount(reply: () => Promise<Response>, onStart = vi.fn()) {
  const fetchMock = vi.fn(reply);
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StartWithAnApp onStart={onStart} />
    </QueryClientProvider>,
  );
  return { fetchMock, onStart };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Start with an app', () => {
  it('shows six skeleton cards while the list loads', () => {
    mount(() => new Promise<Response>(() => undefined));
    const grid = screen.getByLabelText('Loading the app list');
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(grid.children).toHaveLength(6);
  });

  it('draws a card per app, and "Start with this" hands the app over', async () => {
    const { onStart } = mount(() => Promise.resolve(jsonResponse(200, { state: 'ok', apps: [app(1, 'Hotels'), { ...app(2, 'Events'), sides: ['staff'] }] })));
    const card = await screen.findByRole('article', { name: 'App 1' });
    expect(card.textContent).toContain('What app 1 does.');
    expect(card.textContent).toContain('Staff side');
    expect(card.textContent).toContain('Customer side');
    expect(screen.getByRole('article', { name: 'App 2' }).textContent).not.toContain('Customer side');
    await userEvent.click(screen.getByRole('button', { name: 'Start with this: App 1' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ key: 'app-1' }));
    // Six apps: every chip would hold one card, so there are none.
    expect(screen.queryByRole('group', { name: 'Filter apps' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Browse all/ })).toBeNull();
  });

  it('filters by category from nine apps', async () => {
    const apps = Array.from({ length: FILTERS_FROM }, (_v, i) => app(i, i % 3 === 0 ? 'Hotels' : 'Events'));
    mount(() => Promise.resolve(jsonResponse(200, { state: 'ok', apps })));
    await screen.findByRole('group', { name: 'Filter apps' });
    expect(screen.getAllByRole('article')).toHaveLength(FILTERS_FROM);
    await userEvent.click(screen.getByRole('button', { name: 'Hotels' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Hotels' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('article')).toHaveLength(FILTERS_FROM);
  });

  it('says the list could not be loaded, and tries again', async () => {
    let answer: unknown = { state: 'unreachable', apps: [] };
    const { fetchMock } = mount(() => Promise.resolve(jsonResponse(200, answer)));
    await screen.findByText('The app list could not be loaded.');
    expect(screen.getByText('You can still describe an app above.')).toBeTruthy();
    answer = { state: 'ok', apps: [app(1, 'Hotels')] };
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('article', { name: 'App 1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says the list is switched off, with nothing to try', async () => {
    mount(() => Promise.resolve(jsonResponse(200, { state: 'off', apps: [] })));
    await screen.findByText('The online app list is switched off for this install.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(screen.queryByText('You can still describe an app above.')).toBeNull());
  });
});
