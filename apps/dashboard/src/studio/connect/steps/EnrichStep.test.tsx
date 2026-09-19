// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enrich-with-AI step tests — happy-dom, fetch mocked like the sibling wizard
 * tests: the three-intent state machine (provider / BYO / skip), the
 * direct-vs-BYO branch, the BYO paste → validate → error-render → merge
 * round-trip, the sampling toggle revealing the leaves-this-machine preview, and
 * the inline provider setup: an unconfigured step configures a provider without
 * leaving the wizard, and the card it enables costs the operator none of the
 * choices they already made.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppToastProvider } from '../../../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import type { LlmConfig } from '../../ai/api.js';
import { INITIAL_WIZARD_STATE, type WizardState } from '../wizardState.js';
import { EnrichStep } from './EnrichStep.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BYO_PROMPT = '=== SYSTEM ===\nYou are a senior data architect.\n\n=== USER ===\n{ "schema": true }';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const EMPTY_CONFIG: LlmConfig = {
  provider: null,
  model: null,
  baseUrl: null,
  maxOutputTokens: 16000,
  apiKeySet: false,
  apiKeyLast4: null,
  assistantName: 'Milo',
  assistantRowData: false,
};

/** Script the `/api/v1/llm/*` routes the step touches. */
function scriptFetch(overrides: Partial<Record<string, (call: Call) => Response>> = {}) {
  const calls: Call[] = [];
  /**
   * The provider config this scripted server holds. `PUT /llm/config` replaces
   * it and `GET /bootstrap` derives `llm.enabled` from it — which is what the
   * real server does too (its bootstrap handler reads the same `llm.provider`
   * settings row the PUT writes). Modelling that link is the whole point: the
   * wizard's provider card watches `llm.enabled`, not the config.
   */
  let stored: LlmConfig = EMPTY_CONFIG;
  const respond = (call: Call): Response => {
    const key = `${call.method} ${call.url.split('?')[0] ?? ''}`;
    const override = overrides[key];
    if (override !== undefined) return override(call);
    switch (key) {
      case 'GET /api/v1/bootstrap':
        return jsonResponse(200, {
          data: makeBootstrap({ llm: { enabled: stored.provider !== null } }),
        });
      case 'GET /api/v1/llm/config':
        return jsonResponse(200, stored);
      case 'PUT /api/v1/llm/config': {
        const body = call.body as { provider: string | null; model?: string | null; apiKey?: string };
        stored = {
          ...stored,
          provider: (body.provider as LlmConfig['provider']) ?? null,
          model: body.model ?? null,
          // Write-only: the reply carries the tail, never the key.
          apiKeySet: body.apiKey !== undefined ? true : stored.apiKeySet,
          apiKeyLast4: body.apiKey !== undefined ? body.apiKey.slice(-4) : stored.apiKeyLast4,
        };
        return jsonResponse(200, stored);
      }
      case 'GET /api/v1/llm/models':
        return jsonResponse(200, { models: [], source: 'static' });
      case 'POST /api/v1/llm/runs':
        return jsonResponse(201, {
          run: {
            id: 'run_1',
            connectionId: 'conn_1',
            snapshotId: 'snap_1',
            mode: 'byo',
            provider: null,
            model: null,
            promptVersion: 'adminium.prompt/v1',
            status: 'awaiting_response',
            validationStatus: 'pending',
            sections: null,
            locales: null,
            sampling: null,
            chunksTotal: 1,
            chunksReceived: 0,
            tokensIn: null,
            tokensOut: null,
            durationMs: null,
            appliedBy: null,
            appliedAt: null,
            createdBy: 'u1',
            createdAt: 1,
          },
          prompt: {
            promptVersion: 'adminium.prompt/v1',
            tokenEstimate: 12400,
            chunks: [{ index: 1, total: 1, byo: BYO_PROMPT }],
          },
        });
      default:
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no mock for ${key}`, requestId: 'r' } });
    }
  };
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

/** State-owning harness so `onPatch` actually re-renders the step. */
function Harness({
  initial,
  onOpenReview = () => undefined,
}: {
  initial?: Partial<WizardState> | undefined;
  onOpenReview?: ((runId: string) => void) | undefined;
}) {
  const [state, setState] = useState<WizardState>({
    ...INITIAL_WIZARD_STATE,
    connectionId: 'conn_1',
    mode: 'dsn',
    ...initial,
  });
  return (
    <EnrichStep
      state={state}
      onPatch={(patch) => setState((current) => ({ ...current, ...patch }))}
      onOpenReview={onOpenReview}
      pollIntervalMs={1}
    />
  );
}

function renderStep(options: {
  providerConfigured?: boolean;
  /** `/system/info`, seeded rather than fetched — air-gapped installs hide the direct path. */
  networkFeaturesAllowed?: boolean;
  initial?: Partial<WizardState>;
  onOpenReview?: (runId: string) => void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], { llm: { enabled: options.providerConfigured ?? false } });
  if (options.networkFeaturesAllowed !== undefined) {
    queryClient.setQueryData(['system', 'info'], {
      version: '0.5.0',
      node: 'v22.0.0',
      dialect: 'sqlite',
      runtime: 'self-host',
      smtpConfigured: false,
      networkFeaturesAllowed: options.networkFeaturesAllowed,
    });
  }
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {/* The inline provider form toasts on save, and `useAppToasts` throws
            without a provider — the shell mounts one around the real wizard. */}
        <AppToastProvider>
          <Harness initial={options.initial} onOpenReview={options.onOpenReview} />
        </AppToastProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('intent cards', () => {
  it('shows three option cards; provider is disabled with a Settings link when unconfigured', () => {
    scriptFetch();
    renderStep({ providerConfigured: false });

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('radio', { name: /Skip — use heuristics only/ })).toHaveProperty('disabled', false);
    // The link points at Settings → AI (T12).
    expect(screen.getByRole('link', { name: /Configure a provider in Settings/ })).toHaveProperty(
      'href',
      expect.stringContaining('/studio/settings/ai'),
    );
  });

  it('enables the provider card when a provider is configured', () => {
    scriptFetch();
    renderStep({ providerConfigured: true });
    expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', false);
  });

  it('picking Skip reveals the heuristics-only confirmation (no run created)', async () => {
    const { calls } = scriptFetch();
    renderStep({ providerConfigured: true });

    await userEvent.click(screen.getByRole('radio', { name: /Skip — use heuristics only/ }));
    expect(await screen.findByText(/Continuing with heuristics/)).toBeDefined();
    // Skipping never creates a run.
    expect(calls.some((call) => call.url.endsWith('/api/v1/llm/runs'))).toBe(false);
  });

  it('branches on intent: provider ⇒ Start enrichment, BYO ⇒ Generate prompt', async () => {
    scriptFetch();
    renderStep({ providerConfigured: true });

    await userEvent.click(screen.getByRole('radio', { name: /Use my AI provider/ }));
    expect(screen.getByRole('button', { name: 'Start enrichment' })).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }));
    expect(screen.getByRole('button', { name: 'Generate prompt' })).toBeDefined();
  });
});

describe('inline provider setup', () => {
  /** Open the disclosure under the (disabled) provider card. */
  async function openSetup() {
    await userEvent.click(screen.getByRole('button', { name: 'Set up a provider here' }));
    // The form is the one Settings renders — its own heading, one level down.
    return screen.findByRole('heading', { name: 'AI provider', level: 3 });
  }

  /** Fill Anthropic + model + key and save. */
  async function saveAnthropic() {
    await userEvent.click(screen.getByRole('radio', { name: /Claude models via the Anthropic API/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'claude-opus-4-8');
    await userEvent.type(screen.getByLabelText('API key', { exact: false }), 'sk-ant-abcd1234');
    await userEvent.click(screen.getByRole('button', { name: 'Save provider' }));
  }

  it('offers setup on the step, and only reveals the form when asked', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false });

    const toggle = screen.getByRole('button', { name: 'Set up a provider here' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Closed: no form, and no reference to a panel that is not on the page.
    expect(screen.queryByRole('heading', { name: 'AI provider' })).toBeNull();
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    await openSetup();
    expect(screen.getByRole('button', { name: 'Hide provider setup' }).getAttribute('aria-controls')).toBe(
      'enrich-provider-config',
    );
    // Settings → AI remains one click away — the same form, plus run history.
    expect(screen.getByRole('link', { name: /Configure a provider in Settings/ })).toBeDefined();
  });

  it('carries no assistant settings — this is first-run setup, not Settings → AI', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false });
    await openSetup();

    // The assistant card is mounted by `StudioAiPage`, NOT by the form this
    // panel shares with it. A field added to the form would appear here,
    // asking somebody to name an assistant they have not met yet.
    expect(screen.queryByTestId('assistant-card')).toBeNull();
    expect(screen.queryByTestId('assistant-name')).toBeNull();
    expect(screen.queryByTestId('assistant-row-data')).toBeNull();
  });

  it('saving a provider enables the card without touching what the operator chose', async () => {
    const { calls } = scriptFetch();
    renderStep({ providerConfigured: false });

    // The operator picks BYO and turns on sampling BEFORE deciding to configure
    // a provider — the choices a wizard remount would silently throw away.
    await userEvent.click(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Include sample values/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Enum semantics/ }));
    expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', true);

    await openSetup();
    await saveAnthropic();

    // The card the step could not offer a minute ago is now pickable, because
    // the save invalidated `bootstrap` and the refetch reported llm.enabled.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', false),
    );
    expect(await screen.findByText(/AI provider configured/)).toBeDefined();

    // …and nothing the operator had already set was lost.
    expect(screen.getByRole('switch', { name: /Include sample values/ }).getAttribute('data-state')).toBe(
      'checked',
    );
    expect(screen.getByRole('checkbox', { name: /Enum semantics/ }).getAttribute('data-state')).toBe(
      'unchecked',
    );
    expect(
      screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }).getAttribute('aria-checked'),
    ).toBe('true');

    // The key rode exactly one request, and the masked tail is all that comes back.
    const put = calls.filter((call) => call.method === 'PUT' && call.url === '/api/v1/llm/config');
    expect(put).toHaveLength(1);
    expect((put[0]?.body as { apiKey?: string }).apiKey).toBe('sk-ant-abcd1234');
    expect(await screen.findByText('sk-…1234')).toBeDefined();
    expect(screen.queryByDisplayValue('sk-ant-abcd1234')).toBeNull();
  });

  it('runs the provider path straight after configuring it', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false });

    await openSetup();
    await saveAnthropic();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', false),
    );

    await userEvent.click(screen.getByRole('radio', { name: /Use my AI provider/ }));
    expect(screen.getByRole('button', { name: 'Start enrichment' })).toBeDefined();
  });

  it('closing the panel puts it away again', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false });
    await openSetup();

    await userEvent.click(screen.getByRole('button', { name: 'Hide provider setup' }));
    expect(screen.queryByRole('heading', { name: 'AI provider' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Set up a provider here' })).toBeDefined();
  });

  it('offers nothing to set up on an air-gapped install — no key would help', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false, networkFeaturesAllowed: false });

    expect(screen.getByRole('radio', { name: /Use my AI provider/ })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Set up a provider here' })).toBeNull();
    // …and the card says why, rather than sending anyone to Settings.
    expect(screen.getByText(/no outbound internet access/)).toBeDefined();
    expect(screen.queryByRole('link', { name: /Configure a provider in Settings/ })).toBeNull();
  });

  it('says so when the provider settings cannot be loaded', async () => {
    scriptFetch({
      'GET /api/v1/llm/config': () =>
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'nope', requestId: 'r' } }),
    });
    renderStep({ providerConfigured: false });

    await userEvent.click(screen.getByRole('button', { name: 'Set up a provider here' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Could not load the provider settings'),
    );
  });
});

describe('shared options', () => {
  it('sampling toggle reveals the leaves-this-machine preview', async () => {
    scriptFetch();
    renderStep({ providerConfigured: true });
    await userEvent.click(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }));

    expect(screen.queryByText(/What leaves this machine/)).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: /Include sample values/ }));
    expect(await screen.findByText(/What leaves this machine/)).toBeDefined();
    expect(screen.getByText(/PII-flagged columns are never sampled/)).toBeDefined();
  });

  it('en_US is locked on and cannot be deselected', async () => {
    scriptFetch();
    renderStep({ providerConfigured: true });
    await userEvent.click(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }));

    const enUs = screen.getByRole('checkbox', { name: /English \(US\)/ });
    expect(enUs).toHaveProperty('disabled', true);
    expect(enUs.getAttribute('data-state')).toBe('checked');
  });
});

describe('BYO round-trip', () => {
  async function generatePrompt() {
    await userEvent.click(screen.getByRole('radio', { name: /Copy a prompt to my own AI tool/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate prompt' }));
  }

  it('generates the prompt with a token chip, copy + download, and the viewer', async () => {
    scriptFetch();
    renderStep({ providerConfigured: false });
    await generatePrompt();

    expect(await screen.findByText(/12,400 tokens/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Copy prompt/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Download \.md/ })).toBeDefined();
    // The virtualized viewer shows the flattened prompt (SYSTEM/USER markers).
    const viewer = screen.getByRole('region', { name: /Enrichment prompt/ });
    expect(viewer.textContent).toContain('=== SYSTEM ===');
    expect(viewer.textContent).toContain('=== USER ===');
  });

  it('paste → validate → error list → fix → merge → continue to review', async () => {
    let responseCalls = 0;
    scriptFetch({
      'POST /api/v1/llm/runs/run_1/response': () => {
        responseCalls += 1;
        if (responseCalls === 1) {
          return jsonResponse(200, {
            run: { id: 'run_1', status: 'awaiting_response', validationStatus: 'invalid' },
            validation: {
              ok: false,
              errors: [
                { code: 'LLM_JSON_PARSE', severity: 'fatal', path: '', message: 'Unexpected token at position 1.' },
              ],
              warnings: [],
            },
          });
        }
        return jsonResponse(200, {
          run: { id: 'run_1', status: 'validated', validationStatus: 'valid' },
          validation: { ok: true, errors: [], warnings: [] },
        });
      },
    });
    const onOpenReview = vi.fn();
    renderStep({ providerConfigured: false, onOpenReview });
    await generatePrompt();

    const paste = await screen.findByLabelText('Paste the JSON response');
    // Content is irrelevant — the scripted server returns invalid then valid.
    await userEvent.type(paste, 'broken response');
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

    // Precise per-path error list + repair copy affordance.
    expect(await screen.findByText('LLM_JSON_PARSE')).toBeDefined();
    expect(screen.getByText('Unexpected token at position 1.')).toBeDefined();
    expect(screen.getByRole('button', { name: /Copy errors for your AI tool/ })).toBeDefined();

    // Fix and re-validate → merge unlocks → continue to review.
    await userEvent.clear(paste);
    await userEvent.type(paste, 'corrected response');
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));

    const continueButton = await screen.findByRole('button', { name: 'Continue to review' });
    await userEvent.click(continueButton);
    expect(onOpenReview).toHaveBeenCalledWith('run_1');
  });
});

describe('direct path', () => {
  it('runs the provider job, narrates progress, and continues to review', async () => {
    scriptFetch({
      'POST /api/v1/llm/runs': () =>
        jsonResponse(201, {
          run: {
            id: 'run_1',
            connectionId: 'conn_1',
            snapshotId: 'snap_1',
            mode: 'provider',
            provider: 'anthropic',
            model: 'claude-demo',
            promptVersion: 'adminium.prompt/v1',
            status: 'draft',
            validationStatus: 'pending',
            sections: null,
            locales: null,
            sampling: null,
            chunksTotal: 1,
            chunksReceived: 0,
            tokensIn: null,
            tokensOut: null,
            durationMs: null,
            appliedBy: null,
            appliedAt: null,
            createdBy: 'u1',
            createdAt: 1,
          },
          prompt: { promptVersion: 'adminium.prompt/v1', tokenEstimate: 9000, chunks: [{ index: 1, total: 1, byo: BYO_PROMPT }] },
        }),
      'POST /api/v1/llm/runs/run_1/execute': () => jsonResponse(202, { jobId: 'job_1' }),
      'GET /api/v1/jobs/job_1': () =>
        jsonResponse(200, {
          data: {
            id: 'job_1',
            kind: 'llm-run',
            status: 'succeeded',
            progress: { pct: 100, step: 'done', message: 'Done: 12 suggestions' },
            lastError: null,
          },
        }),
      'GET /api/v1/llm/runs/run_1': () =>
        jsonResponse(200, {
          id: 'run_1',
          connectionId: 'conn_1',
          snapshotId: 'snap_1',
          mode: 'provider',
          provider: 'anthropic',
          model: 'claude-demo',
          promptVersion: 'adminium.prompt/v1',
          status: 'validated',
          validationStatus: 'valid',
          sections: null,
          locales: null,
          sampling: null,
          chunksTotal: 1,
          chunksReceived: 1,
          tokensIn: 1000,
          tokensOut: 2000,
          durationMs: 500,
          appliedBy: null,
          appliedAt: null,
          createdBy: 'u1',
          createdAt: 1,
          validationErrors: null,
          review: null,
        }),
    });
    const onOpenReview = vi.fn();
    renderStep({ providerConfigured: true, onOpenReview });

    await userEvent.click(screen.getByRole('radio', { name: /Use my AI provider/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start enrichment' }));

    // Progress rides the job channel; the LogConsole shows the terminal line.
    expect(await screen.findByText('Done: 12 suggestions')).toBeDefined();
    const continueButton = await screen.findByRole('button', { name: 'Continue to review' });
    await userEvent.click(continueButton);
    expect(onOpenReview).toHaveBeenCalledWith('run_1');
  });
});
