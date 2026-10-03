// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Designer Home, mounted through the real `/design` route.
 *
 *  1. With no model the box is off and says how to add one; sending is off.
 *  2. A model that cannot build: the line under the box is an alert, and
 *     sending stays off.
 *  3. Enter sends, Shift+Enter makes a line; what is sent names the app from
 *     the request and carries the target and the model; the page then moves
 *     to the session.
 *  4. An example fills the box; the refresh button shows the next four.
 *  5. "Your apps" lists the folder's apps; Continue opens the newest session,
 *     and an app no session built gets one, with no first message.
 *  6. "Start with an app" is not on the page yet.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { DesignerModels, YourApp } from '../api.js';
import { EXAMPLES, type Example } from './examples.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

const SESSION = {
  id: 'ds_000000000000000000000001',
  appKey: 'repair-shop',
  title: 'Repair shop',
  target: 'auto',
  connectionId: 'env:anthropic',
  model: 'claude-test',
  createdAt: 1,
  updatedAt: 1,
  turns: 1,
  version: null,
  createdApp: true,
  tokens: { in: 0, out: 0 },
};

const WITH_MODEL: DesignerModels = {
  connections: [{ id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: [{ id: 'claude-test', label: 'Claude Test' }] }],
  selected: { connectionId: 'env:anthropic', model: 'claude-test' },
  verdicts: [],
  canAdd: true,
};

let calls: Call[];
let models: DesignerModels;
let apps: YourApp[];

beforeEach(() => {
  calls = [];
  models = WITH_MODEL;
  apps = [];
  window.localStorage.clear();
});

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }));
      if (url === '/api/v1/system/info') {
        return Promise.resolve(jsonResponse(200, { runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, lanShare: false, desktopDemo: false, designer: { mode: 'local', link: true } }));
      }
      if (url === '/api/v1/designer/models') return Promise.resolve(jsonResponse(200, models));
      if (url === '/api/v1/designer/sessions' && method === 'GET') return Promise.resolve(jsonResponse(200, { apps }));
      if (url === '/api/v1/designer/sessions' && method === 'POST') {
        const sent = body as { appKey?: string; text?: string };
        return Promise.resolve(jsonResponse(201, { session: { ...SESSION, appKey: sent.appKey ?? SESSION.appKey }, turn: sent.text === undefined ? null : 1 }));
      }
      if (url === '/api/v1/designer/apps') return Promise.resolve(jsonResponse(200, { state: 'ok', apps: [] }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }));
    }),
  );
}

async function renderHome() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/design'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'What do you want to build?' });
  return router;
}

const box = () => screen.getByRole('textbox', { name: 'Describe your app' }) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const created = () => calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/designer/sessions');

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

describe('Designer Home with no model', () => {
  it('turns the box off and says how to add one', async () => {
    models = { connections: [], selected: null, verdicts: [], canAdd: true };
    await renderHome();
    await waitFor(() => expect(box().disabled).toBe(true));
    expect(screen.getByText('Adminium Designer uses your own AI model. Add one to begin.')).toBeTruthy();
    expect(box().getAttribute('aria-describedby')).toBe('designer-home-note');
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add a model' })).toBeTruthy();
  });
});

describe('Designer Home with a model that cannot build', () => {
  it('says so in an alert and keeps sending off', async () => {
    models = { ...WITH_MODEL, verdicts: [{ connectionId: 'env:anthropic', model: 'claude-test', canBuild: false, message: 'no tool call' }] };
    await renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This model cannot build apps');
    await userEvent.type(box(), 'A shop');
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Model: Claude Test. It cannot build apps.' })).toBeTruthy();
  });
});

describe('sending from Designer Home', () => {
  it('makes a line on Shift+Enter and sends on Enter, then opens the session', async () => {
    const router = await renderHome();
    await waitFor(() => expect(box().disabled).toBe(false));
    await userEvent.type(box(), 'A repair shop: jobs and parts{Shift>}{Enter}{/Shift}with a message');
    expect(box().value).toBe('A repair shop: jobs and parts\nwith a message');
    expect(created()).toHaveLength(0);

    await userEvent.type(box(), '{Enter}');
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]?.body).toEqual({
      name: 'Repair shop',
      target: 'auto',
      connectionId: 'env:anthropic',
      model: 'claude-test',
      text: 'A repair shop: jobs and parts\nwith a message',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/design/${SESSION.id}`));
  });

  it('sends what to build for, as picked in the menu', async () => {
    await renderHome();
    await waitFor(() => expect(box().disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'What to build: Auto' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Dashboard only/ }));
    expect(screen.getByRole('button', { name: 'What to build: Dashboard only' })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /Mobile/ })).toBeNull();
    await userEvent.type(box(), 'Stock for a nursery');
    await userEvent.click(sendButton());
    await waitFor(() => expect(created()).toHaveLength(1));
    expect((created()[0]?.body as { target: string }).target).toBe('dashboard');
  });
});

describe('the examples', () => {
  it('fill the box, and the refresh button shows the next four', async () => {
    await renderHome();
    await waitFor(() => expect(box().disabled).toBe(false));
    const first = EXAMPLES[0] as Example;
    const fifth = EXAMPLES[4] as Example;
    await userEvent.click(screen.getByRole('button', { name: first.label() }));
    expect(box().value).toBe(first.text());
    expect(document.activeElement).toBe(box());

    expect(screen.queryByRole('button', { name: fifth.label() })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show other examples' }));
    expect(screen.getByRole('button', { name: fifth.label() })).toBeTruthy();
    expect(screen.queryByRole('button', { name: first.label() })).toBeNull();
  });
});

describe('Your apps', () => {
  it('is absent with no apps, and "Start with an app" is not shown yet', async () => {
    await renderHome();
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(screen.queryByRole('heading', { name: 'Your apps' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Start with an app' })).toBeNull();
  });

  it('opens the newest session, and gives an app no session built a new one with no message', async () => {
    apps = [
      { key: 'repairs', name: 'Repair Desk', version: 4, editedAt: Date.now() - 3 * 60_000, sessionId: SESSION.id },
      { key: 'classes', name: 'Class Sign-ups', version: null, editedAt: null, sessionId: null },
    ];
    const router = await renderHome();
    await screen.findByRole('heading', { name: 'Your apps' });
    expect(screen.getByText('4 versions')).toBeTruthy();
    expect(screen.getByText('Edited 3 minutes ago')).toBeTruthy();
    expect(screen.getByText('No versions yet')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Continue Repair Desk' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/design/${SESSION.id}`));
    expect(created()).toHaveLength(0);
  });

  it('starts a session on an app no session built', async () => {
    apps = [{ key: 'classes', name: 'Class Sign-ups', version: null, editedAt: null, sessionId: null }];
    await renderHome();
    await waitFor(() => expect(box().disabled).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue Class Sign-ups' }));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]?.body).toEqual({ appKey: 'classes', target: 'auto', connectionId: 'env:anthropic', model: 'claude-test' });
  });
});
