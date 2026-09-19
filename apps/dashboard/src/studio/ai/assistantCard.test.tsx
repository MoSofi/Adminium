// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: the assistant card.
 *
 * TWO CLAIMS, AND THEY PULL AGAINST EACH OTHER. This card writes the same
 * config row the provider form writes, and the provider form is ALSO the
 * connect wizard's inline panel. So the card must send the two assistant
 * fields and nothing else, and the form must send neither — otherwise saving
 * a model in the middle of first-run setup quietly renames the assistant or
 * switches its row-data policy back. The server keeps what a PUT omits
 * (`assistant-routes.test.ts`); these cases are the other half of that
 * bargain, on the wire from this side.
 *
 * The stub therefore models keep-if-omitted rather than echoing a body back,
 * because a stub that reset the fields would let a regression pass.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { ShellHarness } from '../../test/shellHarness.js';
import { StudioAiPage } from './StudioAiPage.js';
import type { LlmConfig } from './api.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function makeConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    baseUrl: null,
    maxOutputTokens: 16000,
    apiKeySet: true,
    apiKeyLast4: 'wxyz',
    assistantName: 'Milo',
    assistantRowData: false,
    ...overrides,
  };
}

function stubFetch(initial: LlmConfig) {
  const calls: Call[] = [];
  // The stored row, as the server holds it between requests.
  let stored = initial;
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, url, body });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
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
    if (url === '/api/v1/llm/config' && method === 'GET') return Promise.resolve(jsonResponse(200, stored));
    if (url === '/api/v1/llm/config' && method === 'PUT') {
      // OMITTED MEANS KEEP — the server's rule, modelled here so a body that
      // stopped sending a field cannot look like a body that reset it.
      const put = body ?? {};
      stored = {
        ...stored,
        provider: (put.provider as LlmConfig['provider']) ?? null,
        ...(put.model === undefined ? {} : { model: put.model as string | null }),
        ...(put.assistantName === undefined ? {} : { assistantName: put.assistantName as string }),
        ...(put.assistantRowData === undefined ? {} : { assistantRowData: put.assistantRowData as boolean }),
      };
      return Promise.resolve(jsonResponse(200, stored));
    }
    if (url === '/api/v1/llm/models' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }], source: 'live' }));
    }
    if (url.startsWith('/api/v1/llm/runs') && method === 'GET') return Promise.resolve(jsonResponse(200, { runs: [] }));
    if (url === '/api/v1/connections' && method === 'GET') return Promise.resolve(jsonResponse(200, { connections: [] }));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, stored: () => stored };
}

async function renderPage(initial: LlmConfig = makeConfig()) {
  const stub = stubFetch(initial);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ShellHarness>
          <Suspense fallback={<div>loading</div>}>
            <StudioAiPage onOpenReview={vi.fn()} />
          </Suspense>
        </ShellHarness>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('assistant-card');
  return { ...stub, queryClient, user: userEvent.setup() };
}

const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT' && call.url === '/api/v1/llm/config');
const nameField = () => screen.getByTestId('assistant-name') as HTMLInputElement;

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the assistant card', () => {
  it('is its own card, after the provider and BYO pair', async () => {
    await renderPage();
    const card = screen.getByTestId('assistant-card');
    expect(card.contains(screen.getByTestId('assistant-name'))).toBe(true);
    // Not INSIDE the provider form — that form is also the connect wizard's
    // inline panel, and `EnrichStep.test.tsx` holds the other half of this:
    // the wizard shows none of these controls.
    const providerSave = screen.getByRole('button', { name: 'Save provider' });
    expect(providerSave.closest('[data-testid="assistant-card"]')).toBeNull();
    // Order is the page's argument: the assistant comes after the two ways of
    // reaching a model, because it is no use before one is configured.
    expect(providerSave.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows what is stored, and says the switch in the name being typed', async () => {
    const { user } = await renderPage();
    expect(nameField().value).toBe('Milo');
    expect(screen.getByText('Let Milo read table rows')).toBeTruthy();

    await user.clear(nameField());
    await user.type(nameField(), 'Ada');
    // The sentence is about the name ON SCREEN, not the one last saved.
    expect(screen.getByText('Let Ada read table rows')).toBeTruthy();
  });

  it('will not save nothing, or an empty name', async () => {
    const { user } = await renderPage();
    expect(screen.getByTestId('assistant-save').hasAttribute('disabled')).toBe(true);

    await user.clear(nameField());
    // A blank name would leave every button reading *Ask* with nothing after it.
    expect(screen.getByTestId('assistant-save').hasAttribute('disabled')).toBe(true);
  });

  it('sends the two fields and the stored provider, and nothing else', async () => {
    const { calls, user, queryClient } = await renderPage();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.clear(nameField());
    await user.type(nameField(), 'Ada');
    await user.click(screen.getByTestId('assistant-row-data'));
    await user.click(screen.getByTestId('assistant-save'));

    await waitFor(() => {
      expect(puts(calls)).toHaveLength(1);
    });
    const body = puts(calls)[0]?.body as Record<string, unknown>;
    expect(body).toEqual({ provider: 'anthropic', assistantName: 'Ada', assistantRowData: true });
    // Not `model`, not `baseUrl`, not `apiKey`: this card owns two settings
    // and echoes the provider only because a null would clear it.
    expect(Object.keys(body)).toHaveLength(3);

    // The *Ask …* button's LABEL comes from bootstrap, so a rename that did
    // not invalidate it would show the old name until a reload.
    const wanted = JSON.stringify(bootstrapQuery().queryKey);
    await waitFor(() => {
      expect(invalidate.mock.calls.some(([arg]) => JSON.stringify(arg?.queryKey) === wanted)).toBe(true);
    });
  });

  it('keeps its fields when the provider form saves — that form sends neither', async () => {
    const { calls, user, stored } = await renderPage(
      makeConfig({ assistantName: 'Ada', assistantRowData: true, model: null }),
    );
    expect(nameField().value).toBe('Ada');

    // Pick a model, then save the PROVIDER form — the same body the connect
    // wizard's inline panel sends.
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Model' }), 'claude-opus-4-8');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => {
      expect(puts(calls)).toHaveLength(1);
    });
    const body = puts(calls)[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('assistantName');
    expect(body).not.toHaveProperty('assistantRowData');
    // And the stored row still says what the admin set here.
    expect(stored().assistantName).toBe('Ada');
    expect(stored().assistantRowData).toBe(true);
    expect(nameField().value).toBe('Ada');
  });
});
