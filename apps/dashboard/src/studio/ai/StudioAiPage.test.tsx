/**
 * Settings → AI (06-T12) component + RBAC tests — happy-dom, fetch mocked like
 * the sibling studio suites (no msw). Covers: the provider option-card grid and
 * its expanded config, the WRITE-ONLY key round-trip (save sends the key; the
 * reply + UI only ever show `sk-…last4`, never the raw key), the test-connection
 * latency result, the run-history row → review navigation, and the StudioGuard
 * gate that keeps Editors/Viewers off the surface entirely (acceptance #13).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '../../app/router.js';
import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import { StudioAiPage } from './StudioAiPage.js';
import type { LlmConfig, LlmRunDto } from './api.js';
import { ShellHarness } from '../../test/shellHarness.js';

// ── fixtures ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: null,
    model: null,
    baseUrl: null,
    maxOutputTokens: 16000,
    apiKeySet: false,
    apiKeyLast4: null,
    ...overrides,
  };
}

function makeConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn_1',
    name: 'Production Postgres',
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: 'postgres://ava@db:5432/prod',
    readOnly: true,
    status: 'connected',
    lastTestedAt: null,
    lastLatencyMs: 42,
    lastError: null,
    lastErrorHint: null,
    snapshot: { id: 'snap_1', createdAt: 1, checksum: 'abc' },
    tableCount: 14,
    pageCount: 9,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeRun(overrides: Partial<LlmRunDto> = {}): LlmRunDto {
  return {
    id: 'run_1',
    connectionId: 'conn_1',
    snapshotId: 'snap_1',
    mode: 'provider',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    promptVersion: 'adminium.prompt/v1',
    status: 'applied',
    validationStatus: 'valid',
    sections: null,
    locales: ['en_US'],
    sampling: null,
    chunksTotal: 1,
    chunksReceived: 1,
    tokensIn: 1200,
    tokensOut: 800,
    durationMs: 4200,
    appliedBy: 'usr_1',
    appliedAt: 2,
    createdBy: 'usr_1',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

interface StubOptions {
  config?: LlmConfig;
  connections?: ConnectionDto[];
  runs?: LlmRunDto[];
  /** Overrides the config returned by PUT (else echoes the sent body + last4). */
  putResult?: (body: { provider: string | null; model?: string | null; baseUrl?: string | null; apiKey?: string }) => LlmConfig;
}

function stubFetch(options: StubOptions = {}) {
  const config = options.config ?? makeConfig();
  const connections = options.connections ?? [makeConnection()];
  const runs = options.runs ?? [];
  const calls: Call[] = [];

  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    // The page suspends on this now: 11-electron.md §8.2's LLM row decides
    // whether the BYO panel or the provider form leads, and that is the order of
    // the page, so it may not be decided after first paint (see
    // `studioAiLocalMode.test.tsx` for the ordering itself). Self-host + network
    // allowed is this suite's world — the pre-§8.2 behaviour, unchanged.
    if (url.startsWith('/api/v1/system/info')) {
      return Promise.resolve(
        jsonResponse(200, {
          version: '0.5.0',
          node: 'v22.0.0',
          dialect: 'sqlite',
          runtime: 'self-host',
          smtpConfigured: false,
          networkFeaturesAllowed: true,
        }),
      );
    }
    if (url === '/api/v1/llm/config' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, config));
    }
    if (url === '/api/v1/llm/config' && method === 'PUT') {
      const put = body as { provider: string | null; model?: string | null; baseUrl?: string | null; apiKey?: string };
      const result =
        options.putResult?.(put) ??
        makeConfig({
          provider: (put.provider as LlmConfig['provider']) ?? null,
          model: put.model ?? null,
          baseUrl: put.baseUrl ?? null,
          apiKeySet: put.apiKey !== undefined ? true : config.apiKeySet,
          apiKeyLast4: put.apiKey !== undefined ? put.apiKey.slice(-4) : config.apiKeyLast4,
        });
      return Promise.resolve(jsonResponse(200, result));
    }
    if (url === '/api/v1/llm/config/test' && method === 'POST') {
      return Promise.resolve(
        jsonResponse(200, { ok: true, model: 'claude-opus-4-8', latencyMs: 87, error: null }),
      );
    }
    if (url === '/api/v1/llm/models' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, { models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }], source: 'live' }),
      );
    }
    if (url.startsWith('/api/v1/llm/runs') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { runs }));
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function renderPage(options: StubOptions & { onOpenReview?: (runId: string) => void } = {}) {
  const stub = stubFetch(options);
  const onOpenReview = options.onOpenReview ?? vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ShellHarness>
          <Suspense fallback={<div>loading</div>}>
            <StudioAiPage onOpenReview={onOpenReview} />
          </Suspense>
        </ShellHarness>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { ...stub, onOpenReview, queryClient };
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

// ── tests ───────────────────────────────────────────────────────────────────

describe('StudioAiPage', () => {
  it('renders the provider grid, BYO panel with contract versions, and run history', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'AI enrichment' })).toBeDefined();
    // Four configurable provider cards (adminium-managed excluded on self-host).
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeDefined();
    expect(screen.getByRole('radio', { name: /OpenAI-compatible/ })).toBeDefined();
    expect(screen.getByRole('radio', { name: /Ollama/ })).toBeDefined();
    // BYO panel surfaces the contract versions (§4.3).
    expect(screen.getByText('Prompt adminium.prompt/v1.2')).toBeDefined();
    expect(screen.getByText('Schema adminium.llm/v1')).toBeDefined();
    // Run history section present.
    expect(screen.getByRole('heading', { name: 'Run history' })).toBeDefined();
  });

  it('expands the selected provider card into its config form', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'AI enrichment' });

    expect(screen.queryByRole('heading', { name: 'Configure OpenAI' })).toBeNull();
    // Match the plain OpenAI card by its description so it never collides with
    // the "OpenAI-compatible" card.
    await user.click(screen.getByRole('radio', { name: /GPT models via the OpenAI API/ }));

    expect(await screen.findByRole('heading', { name: 'Configure OpenAI' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDefined();
    // Required fields append a decorative asterisk to the label, so match loosely.
    expect(screen.getByLabelText('API key', { exact: false })).toBeDefined();
  });

  it('saving a key sends it once, then shows only sk-…last4 — never the raw key', async () => {
    const user = userEvent.setup();
    const { calls } = renderPage();
    await screen.findByRole('heading', { name: 'AI enrichment' });

    await user.click(screen.getByRole('radio', { name: /Claude models via the Anthropic API/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'claude-opus-4-8');

    const RAW_KEY = 'sk-ant-abcd1234';
    await user.type(screen.getByLabelText('API key', { exact: false }), RAW_KEY);
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    // The write path carries the key exactly once.
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/v1/llm/config');
      expect((put?.body as { apiKey?: string } | undefined)?.apiKey).toBe(RAW_KEY);
    });

    // After the save the masked tail is shown and the raw key is gone from the DOM.
    expect(await screen.findByText('sk-…1234')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeDefined();
    expect(screen.queryByDisplayValue(RAW_KEY)).toBeNull();
    expect(screen.queryByText(RAW_KEY)).toBeNull();
  });

  it('test connection reports the provider latency', async () => {
    const user = userEvent.setup();
    renderPage({
      config: makeConfig({
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        apiKeySet: true,
        apiKeyLast4: '1234',
      }),
    });
    await screen.findByRole('heading', { name: 'Configure Anthropic' });

    const testButton = screen.getByRole('button', { name: 'Test connection' });
    await waitFor(() => expect(testButton.hasAttribute('disabled')).toBe(false));
    await user.click(testButton);

    expect(await screen.findByText(/Connected to claude-opus-4-8 in 87 ms/)).toBeDefined();
  });

  it('a run-history row opens the review screen for that run', async () => {
    const user = userEvent.setup();
    const { onOpenReview } = renderPage({ runs: [makeRun({ id: 'run_42' })] });
    await screen.findByRole('heading', { name: 'Run history' });

    const row = await screen.findByRole('button', { name: /Open review for the run/ });
    await user.click(row);
    expect(onOpenReview).toHaveBeenCalledWith('run_42');
  });

  it('shows an empty-history hint when a connection has no runs', async () => {
    renderPage({ runs: [] });
    expect(
      await screen.findByText(/No enrichment runs yet/),
    ).toBeDefined();
  });
});

// ── RBAC: the surface is Admin+ only (acceptance #13) ─────────────────────────

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

describe('StudioAiPage RBAC', () => {
  function stubRoutedFetch(roles: string[]) {
    const calls: Call[] = [];
    const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: null });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
      }
      // The page suspends on this (see the sibling stub above) — and so does
      // the topbar's runtime chip, which this route renders too.
      if (url.startsWith('/api/v1/system/info')) {
        return Promise.resolve(
          jsonResponse(200, {
            version: '0.5.0',
            node: 'v22.0.0',
            dialect: 'sqlite',
            runtime: 'self-host',
            smtpConfigured: false,
            networkFeaturesAllowed: true,
          }),
        );
      }
      if (url === '/api/v1/connections' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { connections: [] }));
      }
      if (url === '/api/v1/llm/config' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, makeConfig()));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
  }

  async function renderRoute(roles: string[]) {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const stub = stubRoutedFetch(roles);
    const queryClient = createQueryClient();
    const router = createAppRouter(queryClient, {
      history: createMemoryHistory({ initialEntries: ['/studio/settings/ai'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return stub;
  }

  it('an Editor is gated by StudioGuard and never sees the AI surface or fetches config', async () => {
    const { calls } = await renderRoute(['editor']);
    expect(await screen.findByText(/have access/)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'AI provider' })).toBeNull();
    // The guard short-circuits before the page queries run.
    expect(calls.some((c) => c.url === '/api/v1/llm/config')).toBe(false);
  });

  it('an Admin reaches the AI surface', async () => {
    await renderRoute(['admin']);
    expect(await screen.findByRole('heading', { name: 'AI enrichment' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'AI provider' })).toBeDefined();
  });
});
