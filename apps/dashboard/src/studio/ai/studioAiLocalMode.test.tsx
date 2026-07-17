/**
 * Settings → AI under 11-electron.md §8.2's LLM row: "Available, labeled; BYO
 * round-trip is the default and is highlighted first in desktop."
 *
 * Rendered against the REAL page, because the claim being made is about what an
 * admin SEES — the order of two cards and the words on them. `capabilities.test.ts`
 * proves `llmAffordances()` returns the right answers; only this can prove the
 * page asked it and did something with the answer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { StudioAiPage } from './StudioAiPage.js';

interface Options {
  runtime: 'self-host' | 'desktop';
  networkFeaturesAllowed?: boolean;
}

function stubFetch({ runtime, networkFeaturesAllowed = true }: Options) {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/system/info')) {
      return Promise.resolve(
        jsonResponse(200, {
          version: '0.5.0',
          node: 'v22.0.0',
          dialect: 'sqlite',
          runtime,
          smtpConfigured: false,
          networkFeaturesAllowed,
        }),
      );
    }
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/llm/config' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          provider: null,
          model: null,
          baseUrl: null,
          maxOutputTokens: 16000,
          apiKeySet: false,
          apiKeyLast4: null,
        }),
      );
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections: [] }));
    }
    if (url.startsWith('/api/v1/llm/runs')) {
      return Promise.resolve(jsonResponse(200, { runs: [] }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(options: Options) {
  stubFetch(options);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppToastProvider>
        <Suspense fallback={<div>loading</div>}>
          <StudioAiPage onOpenReview={vi.fn()} />
        </Suspense>
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Which of the two panels comes first in the document. Reading order IS the
 * recommendation — the assertion has to be about position, not presence, or it
 * would pass on a page that renders both in the wrong order.
 */
async function panelOrder(): Promise<['byo', 'provider'] | ['provider', 'byo']> {
  const byo = await screen.findByText(/Use your own AI tool|No key\? Use your own AI tool/);
  const provider = screen.getByRole('heading', { name: 'AI provider' });
  return byo.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING
    ? ['byo', 'provider']
    : ['provider', 'byo'];
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

describe('Settings → AI on desktop', () => {
  it('puts the BYO round-trip first and marks it recommended', async () => {
    renderPage({ runtime: 'desktop' });
    expect(await panelOrder()).toEqual(['byo', 'provider']);
    expect(await screen.findByText('Use your own AI tool — no key needed')).toBeDefined();
    expect(screen.getByText('Recommended')).toBeDefined();
  });

  /** "Available, labeled" — desktop-ness alone must not disable the direct path. */
  it('keeps the provider cards available and labeled', async () => {
    renderPage({ runtime: 'desktop' });
    expect(await screen.findByText('Requires internet & an API key')).toBeDefined();
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeDefined();
    expect(screen.queryByText(/Direct AI providers are turned off/)).toBeNull();
  });
});

describe('Settings → AI on a normal self-host', () => {
  it('leads with the provider and leaves BYO as the alternative', async () => {
    renderPage({ runtime: 'self-host' });
    expect(await panelOrder()).toEqual(['provider', 'byo']);
    expect(screen.getByText('No key? Use your own AI tool')).toBeDefined();
    expect(screen.queryByText('Recommended')).toBeNull();
  });

  it('labels the provider path anyway — the direct path needs the internet here too', async () => {
    renderPage({ runtime: 'self-host' });
    expect(await screen.findByText('Requires internet & an API key')).toBeDefined();
  });
});

describe('Settings → AI on an air-gapped install', () => {
  it('explains rather than hides, and leads with the path that works', async () => {
    renderPage({ runtime: 'self-host', networkFeaturesAllowed: false });

    expect(await screen.findByText('Direct AI providers are turned off on this install')).toBeDefined();
    expect(await panelOrder()).toEqual(['byo', 'provider']);
    // Never hide: the provider cards stay on the page, readable.
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeDefined();
  });
});
