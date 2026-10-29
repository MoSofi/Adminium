// SPDX-License-Identifier: AGPL-3.0-only
/** Settings → AI → Pictures made with AI: three counts, 0 turning each off, saved together with one button. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { AssistantSettings } from './api.js';
import { PicturesCard } from './PicturesCard.js';

function stub() {
  let pictures: AssistantSettings['pictures'] = { perDay: 20, perDayAll: 100, perTurn: 8 };
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { pictures: Partial<AssistantSettings['pictures']> };
        puts.push(body);
        pictures = { ...pictures, ...body.pictures };
      }
      if (String(_input).endsWith('/designer/live')) return Promise.resolve(jsonResponse(200, { mode: 'local', allowed: true, on: false, project: true, reason: null }));
      return Promise.resolve(jsonResponse(200, { pictures }));
    }),
  );
  return puts;
}

beforeAll(async () => {
  await installTestI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings → AI → Pictures made with AI', () => {
  it('shows the three counts, says 0 turns making off, and saves only what changed', async () => {
    const puts = stub();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppToastProvider>
          <PicturesCard />
        </AppToastProvider>
      </QueryClientProvider>,
    );
    const perDay = (await screen.findByTestId('assistant-pictures-perDay')) as HTMLInputElement;
    expect(perDay.value).toBe('20');
    expect((screen.getByTestId('assistant-pictures-perDayAll') as HTMLInputElement).value).toBe('100');
    expect(screen.getAllByText('0 turns making pictures off')).toHaveLength(3);
    const save = screen.getByTestId('assistant-pictures-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const user = userEvent.setup();
    await user.clear(screen.getByTestId('assistant-pictures-perTurn'));
    await user.type(screen.getByTestId('assistant-pictures-perTurn'), '99');
    // Over what a turn may make: not saved.
    expect(save.disabled).toBe(true);
    await user.clear(screen.getByTestId('assistant-pictures-perTurn'));
    await user.type(screen.getByTestId('assistant-pictures-perTurn'), '0');
    await user.click(save);
    await waitFor(() => expect(puts).toEqual([{ pictures: { perTurn: 0 } }]));
  });
});
