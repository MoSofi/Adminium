/**
 * The connect wizard's Enrich step under 11-electron.md §6 step 4 / §8.2's LLM
 * row: on desktop "The LLM-assist step defaults to the BYO copy/paste
 * round-trip"; the API-credential mode stays "available but labeled".
 *
 * In a wizard, FIRST is the default — it is the card the eye lands on and the
 * one a hurried admin picks — so these assert position, not just presence.
 */
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import { defaultEnrichChoices } from '../enrichState.js';
import type { WizardState } from '../wizardState.js';
import { EnrichStep } from './EnrichStep.js';

interface Options {
  runtime: 'self-host' | 'desktop';
  networkFeaturesAllowed?: boolean;
  /** bootstrap `llm.enabled` — is a direct provider configured at all? */
  providerConfigured?: boolean;
}

function stubFetch({ runtime, networkFeaturesAllowed = true, providerConfigured = true }: Options) {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
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
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ llm: { enabled: providerConfigured } }) }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A wizard sitting on a live connection — the only state where Enrich offers anything. */
function makeState(): WizardState {
  return { mode: 'dsn', connectionId: 'conn_1' } as WizardState;
}

function renderStep(options: Options) {
  stubFetch(options);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EnrichStep state={makeState()} onPatch={vi.fn()} onOpenReview={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** The option cards in DOM order — reading order is the recommendation. */
function cardOrder(): string[] {
  return [...document.querySelectorAll('[role="radio"]')]
    .map((node) => node.getAttribute('value'))
    .filter((value): value is string => value !== null);
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

describe('Enrich step on desktop', () => {
  it('leads with the BYO card and labels it recommended', async () => {
    renderStep({ runtime: 'desktop' });
    expect(await screen.findByText('Copy a prompt to my own AI tool — recommended')).toBeDefined();
    expect(cardOrder()).toEqual(['byo', 'provider', 'skip']);
  });

  it('keeps the provider card usable — available, not hidden', async () => {
    renderStep({ runtime: 'desktop' });
    await screen.findByText('Copy a prompt to my own AI tool — recommended');
    expect(screen.getByRole('radio', { name: /Use my AI provider/ }).getAttribute('data-disabled')).toBeNull();
  });
});

describe('Enrich step on a normal self-host', () => {
  it('keeps the provider card first', async () => {
    renderStep({ runtime: 'self-host' });
    await screen.findByText('Use my AI provider');
    expect(cardOrder()).toEqual(['provider', 'byo', 'skip']);
    expect(screen.getByText('Copy a prompt to my own AI tool')).toBeDefined();
  });
});

describe('Enrich step on an air-gapped install', () => {
  it('disables the provider card and says why no key would help', async () => {
    renderStep({ runtime: 'self-host', networkFeaturesAllowed: false });
    expect(await screen.findByText(/no outbound internet access/i)).toBeDefined();
    expect(cardOrder()).toEqual(['byo', 'provider', 'skip']);
  });

  /**
   * "Configure a provider in Settings → AI" is the fix for an UNCONFIGURED
   * provider and a wild goose chase for an air-gapped one. Only offer the fix
   * that fixes it.
   */
  it('does not send the admin to Settings to fix something Settings cannot fix', async () => {
    renderStep({ runtime: 'self-host', networkFeaturesAllowed: false });
    await screen.findByText(/no outbound internet access/i);
    expect(screen.queryByText('Configure a provider in Settings → AI')).toBeNull();
  });

  it('still points an unconfigured-but-online install at Settings', async () => {
    renderStep({ runtime: 'self-host', providerConfigured: false });
    expect(await screen.findByText('Configure a provider in Settings → AI')).toBeDefined();
  });
});

/**
 * REGRESSION — the air-gapped escape hatch.
 *
 * `state.enrichIntent` is persisted wizard state that outlives the card being
 * pickable: a wizard resumed with `enrichIntent: 'provider'`, or a click landed
 * before `/system/info` answered, arrives here with the card greyed and the
 * intent intact. An earlier cut gated only the card, so the provider path still
 * rendered a live "Start enrichment" button underneath it and would POST a
 * provider run from an install that declares it has no outbound network —
 * breaking §7's zero-non-loopback promise through the very gate meant to keep it.
 */
describe('Enrich step — a persisted provider intent cannot outlive its gate', () => {
  /** A wizard reopened on a step where 'provider' was already chosen and saved. */
  function renderResumed(options: Options) {
    stubFetch(options);
    const choices = defaultEnrichChoices();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EnrichStep
          state={
            {
              mode: 'dsn',
              connectionId: 'conn_1',
              enrichIntent: 'provider',
              enrichSections: choices.sections,
              enrichLocales: choices.locales,
              enrichSampling: choices.sampling,
            } as WizardState
          }
          onPatch={vi.fn()}
          onOpenReview={vi.fn()}
        />
      </QueryClientProvider>,
    );
  }

  it('offers no Start button for a provider intent the install cannot honour', async () => {
    renderResumed({ runtime: 'self-host', networkFeaturesAllowed: false });
    await screen.findByText(/no outbound internet access/i);
    expect(screen.queryByRole('button', { name: 'Start enrichment' })).toBeNull();
  });

  it('still honours a provider intent on an install that can reach a provider', async () => {
    renderResumed({ runtime: 'self-host', networkFeaturesAllowed: true });
    expect(await screen.findByRole('button', { name: 'Start enrichment' })).toBeDefined();
  });
});

/**
 * BYO is never gated — it makes zero network calls (§7's LLM row). No runtime,
 * and no flag, may take it away.
 */
describe('Enrich step — the BYO path is always offered', () => {
  it.each([
    ['desktop', true],
    ['desktop', false],
    ['self-host', true],
    ['self-host', false],
  ] as const)('runtime=%s network=%s', async (runtime, networkFeaturesAllowed) => {
    renderStep({ runtime, networkFeaturesAllowed });
    await screen.findByText(/Copy a prompt to my own AI tool/);
    expect(cardOrder()).toContain('byo');
  });
});
