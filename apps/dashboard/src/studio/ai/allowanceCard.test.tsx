// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: the assistant's daily allowance.
 *
 * The card reads and writes its own route (the settings permission, not the
 * model's), shows who used how much today, and says when the day starts
 * again in the reader's own time.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import { AllowanceCard } from './AllowanceCard.js';
import type { AssistantSettings } from './api.js';

const RESETS_AT = Date.UTC(2026, 9, 10);

function settings(overrides: Partial<AssistantSettings> = {}): AssistantSettings {
  return {
    dailyTokens: 500_000,
    today: {
      day: '2026-10-09',
      resetsAt: RESETS_AT,
      people: [
        { userId: 'usr_2', name: 'Dana Whitfield', tokens: 500_000, turns: 31 },
        { userId: 'usr_1', name: 'Ada Obi', tokens: 12_400, turns: 3 },
      ],
    },
    roles: [{ id: 'rol_1', name: 'Admin' }],
    ...overrides,
  };
}

function stub(initial: AssistantSettings) {
  let stored = initial;
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { dailyTokens: number }) : null;
      calls.push({ method, url, body });
      if (url === '/api/v1/assistant/settings' && method === 'PUT' && body !== null) stored = { ...stored, dailyTokens: body.dailyTokens };
      if (url === '/api/v1/assistant/settings') return Promise.resolve(jsonResponse(200, stored));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  return calls;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <AllowanceCard name="Milo" />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await installTestI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the daily allowance card', () => {
  it('shows the number, who used how much today with the one at the limit marked, and which roles may', async () => {
    stub(settings());
    renderCard();
    const field = (await screen.findByTestId('assistant-daily-tokens')) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('500000'));

    const rows = within(screen.getByTestId('assistant-allowance-today')).getAllByRole('row');
    // A heading row, then most first.
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain('Dana Whitfield');
    expect(rows[1]!.textContent).toContain('At the limit');
    expect(rows[1]!.textContent).toContain('500,000');
    expect(rows[2]!.textContent).toContain('Ada Obi');
    expect(rows[2]!.textContent).not.toContain('At the limit');
    expect(within(screen.getByTestId('assistant-allowance-roles')).getByText('Admin')).toBeTruthy();
    // When the day starts again, in the reader's own time: a time, not a date in UTC.
    expect(screen.getByText(/starts again for everyone at the same moment: .*\d{1,2}[:.]\d{2}/)).toBeTruthy();
  });

  it('saves a new number through its own route and nothing else', async () => {
    const calls = stub(settings());
    renderCard();
    const user = userEvent.setup();
    const field = (await screen.findByTestId('assistant-daily-tokens')) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('500000'));
    const save = screen.getByTestId('assistant-allowance-save');
    // Nothing to save yet.
    expect(save.hasAttribute('disabled')).toBe(true);

    await user.clear(field);
    await user.type(field, '250000');
    await user.click(save);
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([{ method: 'PUT', url: '/api/v1/assistant/settings', body: { dailyTokens: 250_000 } }]);
    expect(await screen.findByText('Allowance saved')).toBeTruthy();
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(true));
  });

  it('holds the save on a number nobody could mean, and takes 0 as no limit', async () => {
    stub(settings());
    renderCard();
    const user = userEvent.setup();
    const field = (await screen.findByTestId('assistant-daily-tokens')) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('500000'));
    const save = screen.getByTestId('assistant-allowance-save');
    for (const bad of ['', '-5', '1.5', 'many', '99999999999']) {
      await user.clear(field);
      if (bad !== '') await user.type(field, bad);
      expect(save.hasAttribute('disabled'), `"${bad}"`).toBe(true);
    }
    await user.clear(field);
    await user.type(field, '0');
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('says so when nobody has asked anything today, and when only the owner may', async () => {
    stub(settings({ today: { day: '2026-10-09', resetsAt: RESETS_AT, people: [] }, roles: [] }));
    renderCard();
    expect(await screen.findByText('Nobody has used Milo today.')).toBeTruthy();
    expect(screen.getByText('Only Super Admin may use Milo.')).toBeTruthy();
  });
});
