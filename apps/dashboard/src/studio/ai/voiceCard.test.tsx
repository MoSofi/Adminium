// SPDX-License-Identifier: AGPL-3.0-only
/** Settings → AI → Voice: two switches and the day's minutes, each saved alone. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { AssistantSettings } from './api.js';
import { VoiceCard } from './VoiceCard.js';

function stub(writtenBy: 'provider' | 'browser' = 'provider') {
  let voice: AssistantSettings['voice'] = { input: false, dailyMinutes: 30, output: true, writtenBy };
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { voice: Partial<AssistantSettings['voice']> };
        puts.push(body);
        voice = { ...voice, ...body.voice };
      }
      return Promise.resolve(jsonResponse(200, { voice }));
    }),
  );
  return puts;
}

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppToastProvider>
        <VoiceCard name="Milo" />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await installTestI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings → AI → Voice', () => {
  it('starts with speaking off and reading aloud on, and says where the voice would go', async () => {
    stub();
    renderCard();
    const speak = await screen.findByRole('switch', { name: 'Speak to Milo' });
    expect(speak.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('What a person says is sent to your AI provider to be written down. Nothing is kept.')).toBeDefined();
    expect(screen.getByRole('switch', { name: 'Milo reads its replies aloud' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Uses the browser’s own voices. Each person switches it on for themselves.')).toBeDefined();
    expect((screen.getByTestId('assistant-voice-minutes') as HTMLInputElement).value).toBe('30');
  });

  it('says the browser writes it down when the workspace\'s provider cannot', async () => {
    stub('browser');
    renderCard();
    expect(await screen.findByText('Your AI provider does not write speech down, so each person’s own browser does, where it can. Nothing is kept.')).toBeDefined();
  });

  it('saves each choice alone: the switch as it is flipped, the minutes with their button', async () => {
    const puts = stub();
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('assistant-voice-input'));
    await waitFor(() => expect(screen.getByTestId('assistant-voice-input').getAttribute('aria-checked')).toBe('true'));
    const minutes = screen.getByTestId('assistant-voice-minutes');
    const saveButton = screen.getByTestId('assistant-voice-minutes-save') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    await user.clear(minutes);
    await user.type(minutes, '2000');
    expect(saveButton.disabled).toBe(true);
    await user.clear(minutes);
    await user.type(minutes, '5');
    await user.click(saveButton);
    await user.click(screen.getByTestId('assistant-voice-output'));
    await waitFor(() => expect(puts).toEqual([{ voice: { input: true } }, { voice: { dailyMinutes: 5 } }, { voice: { output: false } }]));
  });
});
