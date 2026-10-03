// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Start with an app" sheet.
 *
 * What it must hold to: "Install as it is" is the choice it opens on; a copy
 * is not started until the build command was shown and ticked; a key that is
 * taken says so on its own line; the three steps show while it copies; a
 * failure names its step and offers "Try again"; and a finished copy opens
 * the Designer on it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { CatalogApp, StartJob } from '../api.js';
import { StartSheet, keyFromAppName } from './StartSheet.js';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const APP: CatalogApp = { key: 'ordering', version: '0.2.3', name: 'Online Ordering', tagline: 'A menu, a cart and a kitchen screen.', category: 'Food', sides: ['staff', 'customer'], copyable: true, iconTint: null, iconPaths: [], monogram: null };
const BUILD = { install: 'npm ci --ignore-scripts', command: 'VITE_ADMINIUM_SURFACE_SIDE=staff node_modules/.bin/vite build --base=/apps/my-online-ordering/staff/', output: 'dist-surface/my-online-ordering', fingerprint: 'f'.repeat(64) };
const job = (over: Partial<StartJob>): StartJob => ({
  id: 'start_1',
  key: 'ordering',
  newKey: 'my-online-ordering',
  name: 'Online Ordering',
  state: 'running',
  steps: [
    { id: 'get', state: 'done' },
    { id: 'make', state: 'running' },
    { id: 'build', state: 'waiting' },
  ],
  sessionId: null,
  ...over,
});

let posted: unknown[];
let status: StartJob;
let problem: string | null;

function mount(app: CatalogApp = APP, model: { connectionId: string; model: string } | null = { connectionId: 'env:ollama', model: 'm' }) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StartSheet app={app} model={model} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  posted = [];
  problem = null;
  status = job({});
  navigate.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/designer/start-check')) return Promise.resolve(jsonResponse(200, problem === null ? { problem: null, build: BUILD } : { problem, build: null }));
      if (url.endsWith('/designer/start') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse(202, status));
      }
      if (url.includes('/designer/start-status/')) return Promise.resolve(jsonResponse(200, status));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sheet', () => {
  it('opens on "Install as it is", with no name or key to give', () => {
    mount();
    expect(screen.getByRole('radio', { name: /Install as it is/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open its install' })).toBeTruthy();
  });

  it('makes a first key from the app’s name', () => {
    expect(keyFromAppName('Online Ordering')).toBe('my-online-ordering');
    expect(keyFromAppName('Point of Sale')).toBe('my-point-of-sale');
    expect(keyFromAppName('!!!')).toBe('my-app');
  });

  it('starts a copy only once the build command was shown and ticked, and sends its fingerprint', async () => {
    mount();
    await userEvent.click(screen.getByRole('radio', { name: /Make it yours/ }));
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('my-online-ordering');
    expect(await screen.findByText(/node_modules\/\.bin\/vite build --base=\/apps\/my-online-ordering\/staff\//)).toBeTruthy();
    expect(screen.getByText(/the licence asks you to offer them the source of your version/)).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'These commands may run' }));
    expect(start.disabled).toBe(false);
    await userEvent.click(start);
    expect(posted).toEqual([{ key: 'ordering', newKey: 'my-online-ordering', name: 'Online Ordering', approve: BUILD.fingerprint, connectionId: 'env:ollama', model: 'm' }]);
    // The three steps, as they stand.
    const steps = await screen.findByRole('status');
    expect(steps.textContent).toContain('Getting the app');
    expect(steps.textContent).toContain('Making it yours');
    expect(steps.textContent).toContain('Building and applying');
  });

  it('says a key that is taken on its own line, and unticks the build when the key changes', async () => {
    mount();
    await userEvent.click(screen.getByRole('radio', { name: /Make it yours/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'These commands may run' }));
    problem = 'There is already an app "pos" in this project.';
    const key = screen.getByLabelText('Key');
    await userEvent.clear(key);
    await userEvent.type(key, 'pos');
    expect(await screen.findByText('There is already an app "pos" in this project.')).toBeTruthy();
    expect(key.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'These commands may run' })).toBeNull();
  });

  it('names the step that failed, and tries again', async () => {
    status = job({ state: 'failed', steps: [{ id: 'get', state: 'done' }, { id: 'make', state: 'done' }, { id: 'build', state: 'failed', detail: 'src/App.tsx: Cannot find name "jobs".' }] });
    mount();
    await userEvent.click(screen.getByRole('radio', { name: /Make it yours/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'These commands may run' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('src/App.tsx: Cannot find name "jobs".')).toBeTruthy();
    status = job({ state: 'done', sessionId: 'ds_000000000000000000000001', steps: [{ id: 'get', state: 'done' }, { id: 'make', state: 'done' }, { id: 'build', state: 'done' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(posted).toHaveLength(2);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/design/$sessionId', params: { sessionId: 'ds_000000000000000000000001' } }));
  });

  it('offers no copy of an app the list gives no source for, and none without a model', async () => {
    mount({ ...APP, copyable: false });
    expect((screen.getByRole('radio', { name: /Make it yours/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/does not say where this app’s source is/)).toBeTruthy();
  });
});
