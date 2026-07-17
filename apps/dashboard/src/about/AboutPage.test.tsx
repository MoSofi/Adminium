/**
 * `/about` (M10-T04): version + AGPL licence + source offer + meta engine, and
 * the update notice's gating on the `updates.checkEnabled` preference —
 * including the property that an opted-out instance issues NO update request at
 * all from this screen.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { AboutData, UpdateCheck } from './aboutApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeAbout(overrides: Partial<AboutData> = {}): AboutData {
  return {
    version: '0.5.0',
    license: 'AGPL-3.0-only',
    sourceUrl: 'https://github.com/adminium/adminium',
    licenseUrl: 'https://github.com/adminium/adminium/blob/main/LICENSE',
    metaEngine: 'postgres',
    metaMigrationVersion: '0042_add_widgets',
    node: 'v22.14.0',
    telemetry: { enabled: false },
    updates: { checkEnabled: false },
    ...overrides,
  };
}

function stubFetch(about: AboutData, update: UpdateCheck) {
  const updateCalls: string[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/about') {
      return Promise.resolve(jsonResponse(200, { data: about }));
    }
    if (url === '/api/v1/about/update-check') {
      updateCalls.push(url);
      return Promise.resolve(jsonResponse(200, { data: update }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, updateCalls };
}

async function renderAbout(about: AboutData, update: UpdateCheck = { status: 'disabled' }) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(about, update);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/about'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return stub;
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

describe('AboutPage', () => {
  it('shows the version, the AGPL licence, and the meta-store engine', async () => {
    await renderAbout(makeAbout());
    expect(await screen.findByRole('heading', { name: 'About Adminium' })).toBeDefined();

    expect(screen.getByText('0.5.0')).toBeDefined();
    expect(screen.getByText('AGPL-3.0-only')).toBeDefined();
    expect(screen.getByText('PostgreSQL')).toBeDefined();
    expect(screen.getByText('v22.14.0')).toBeDefined();
  });

  it('names the meta engine for each of the three v1 engines', async () => {
    await renderAbout(makeAbout({ metaEngine: 'sqlite' }));
    expect(await screen.findByText('SQLite')).toBeDefined();
  });

  it('links the LICENCE and — the AGPL §13 source offer — the source code', async () => {
    await renderAbout(makeAbout());
    await screen.findByRole('heading', { name: 'About Adminium' });

    const licence = screen.getByRole('link', { name: /Read the licence/ });
    expect(licence.getAttribute('href')).toBe('https://github.com/adminium/adminium/blob/main/LICENSE');

    // This link is the compliance artifact, not decoration.
    const source = screen.getByRole('link', { name: /Get the source code/ });
    expect(source.getAttribute('href')).toBe('https://github.com/adminium/adminium');
    expect(source.getAttribute('rel')).toContain('noopener');
  });
});

describe('AboutPage — update notice gating', () => {
  it('makes NO update request when the check is opted out, and says so', async () => {
    const { updateCalls } = await renderAbout(
      makeAbout({ updates: { checkEnabled: false } }),
      { status: 'update-available', current: '0.5.0', latest: '9.9.9', url: 'https://x.test' },
    );
    await screen.findByRole('heading', { name: 'About Adminium' });

    expect(screen.getByTestId('about-update-optout')).toBeDefined();
    expect(screen.getByText(/never contacts GitHub/)).toBeDefined();

    // The decisive assertion: opted out ⇒ the request is not even issued, so
    // the stubbed "9.9.9 available" answer above can never be reached.
    expect(updateCalls).toEqual([]);
    expect(screen.queryByTestId('about-update-available')).toBeNull();
  });

  it('shows the update-available notice with a release link once opted in', async () => {
    const { updateCalls } = await renderAbout(makeAbout({ updates: { checkEnabled: true } }), {
      status: 'update-available',
      current: '0.5.0',
      latest: '0.6.0',
      url: 'https://github.com/adminium/adminium/releases',
    });

    expect(await screen.findByTestId('about-update-available')).toBeDefined();
    expect(screen.getByText('Adminium 0.6.0 is available')).toBeDefined();
    expect(screen.getByText('You are running 0.5.0.')).toBeDefined();
    expect(screen.getByRole('link', { name: /View release notes/ }).getAttribute('href')).toBe(
      'https://github.com/adminium/adminium/releases',
    );
    expect(updateCalls).toHaveLength(1);
  });

  it('confirms an up-to-date instance without alarm', async () => {
    await renderAbout(makeAbout({ updates: { checkEnabled: true } }), {
      status: 'current',
      current: '0.5.0',
    });
    expect(await screen.findByTestId('about-update-current')).toBeDefined();
    expect(screen.queryByTestId('about-update-available')).toBeNull();
  });

  it('stays silent when the release feed is unreachable — a network blip is not news', async () => {
    await renderAbout(makeAbout({ updates: { checkEnabled: true } }), {
      status: 'unknown',
      current: '0.5.0',
    });
    await screen.findByRole('heading', { name: 'About Adminium' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Updates' })).toBeDefined();
    });
    expect(screen.queryByTestId('about-update-available')).toBeNull();
    expect(screen.queryByTestId('about-update-current')).toBeNull();
    expect(screen.queryByTestId('about-update-optout')).toBeNull();
  });
});
