// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: what the assistant may do beyond reading.
 *
 * Four switches, each saved as it is flipped and none moving another; one
 * sentence that says the whole state; and the most rows one confirmation may
 * write, held to what has been measured.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import { AbilitiesCard, abilitiesLine } from './AbilitiesCard.js';
import type { AssistantAbilities, AssistantSettings } from './api.js';

const OFF: AssistantAbilities = { create: false, change: false, send: false, delete: false };

function settings(overrides: Partial<AssistantSettings> = {}): AssistantSettings {
  return {
    dailyTokens: 500_000,
    abilities: OFF,
    maxRows: 50,
    maxRowsCeiling: 50,
    today: { day: '2026-10-09', resetsAt: Date.now() + 3_600_000, people: [] },
    roles: [],
    ...overrides,
  };
}

function stub(initial: AssistantSettings, fail = false) {
  let stored = initial;
  const puts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url !== '/api/v1/assistant/settings') return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { abilities?: Partial<AssistantAbilities>; maxRows?: number };
        puts.push(body);
        if (fail) return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'no' } }));
        stored = { ...stored, abilities: { ...stored.abilities, ...body.abilities }, ...(body.maxRows === undefined ? {} : { maxRows: body.maxRows }) };
      }
      return Promise.resolve(jsonResponse(200, stored));
    }),
  );
  return puts;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <AbilitiesCard name="Milo" />
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

describe('the state line', () => {
  it('says the whole state in a sentence, as the three cases of the design do', () => {
    expect(abilitiesLine(OFF, 'Milo')).toBe('Milo can only read.');
    expect(abilitiesLine({ ...OFF, create: true, change: true }, 'Milo')).toBe('Milo can read, create and change. It cannot send or delete.');
    expect(abilitiesLine({ create: true, change: true, send: true, delete: true }, 'Ada')).toBe('Ada can read, create, change, send and delete.');
    expect(abilitiesLine({ ...OFF, delete: true }, 'Milo')).toBe('Milo can read and delete. It cannot create, change or send.');
  });
});

describe('the card', () => {
  it('starts with the assistant only reading, each switch named and explained', async () => {
    stub(settings());
    renderCard();
    expect((await screen.findByTestId('assistant-abilities-line')).textContent).toBe('Milo can only read.');
    for (const name of ['Create', 'Change', 'Send', 'Delete']) {
      const toggle = screen.getByRole('switch', { name });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      // Each says what it allows, and that the person still confirms.
      expect(toggle.getAttribute('aria-describedby')).not.toBeNull();
    }
    expect(screen.getAllByText(/You confirm each one\./)).toHaveLength(4);
    expect(screen.getByText(/Milo never changes permissions, people, connections/)).toBeTruthy();
  });

  it('saves one switch as it is flipped, names only that one, and the sentence follows', async () => {
    const puts = stub(settings({ abilities: { ...OFF, create: true } }));
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Change' }));
    await waitFor(() => expect(puts).toEqual([{ abilities: { change: true } }]));
    await waitFor(() =>
      expect(screen.getByTestId('assistant-abilities-line').textContent).toBe('Milo can read, create and change. It cannot send or delete.'),
    );
    expect(screen.getByRole('switch', { name: 'Create' }).getAttribute('aria-checked')).toBe('true');
    // And off again.
    await user.click(screen.getByRole('switch', { name: 'Create' }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ abilities: { create: false } }));
  });

  it('holds the rows of one confirmation to what has been measured', async () => {
    const puts = stub(settings());
    renderCard();
    const user = userEvent.setup();
    const field = await screen.findByTestId('assistant-max-rows');
    expect(screen.getByText('1 to 50')).toBeTruthy();
    const save = screen.getByTestId('assistant-max-rows-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    for (const bad of ['0', '51', '200', 'ten', '']) {
      await user.clear(field);
      if (bad !== '') await user.type(field, bad);
      expect(save.disabled, bad).toBe(true);
    }
    await user.clear(field);
    await user.type(field, '20');
    await user.click(save);
    await waitFor(() => expect(puts).toEqual([{ maxRows: 20 }]));
  });

  it('says so when a switch could not be saved, and shows it as it still is', async () => {
    stub(settings(), true);
    renderCard();
    await userEvent.setup().click(await screen.findByRole('switch', { name: 'Delete' }));
    expect(await screen.findByText('Could not save that. Try again.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Delete' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('assistant-abilities-line').textContent).toBe('Milo can only read.');
  });
});
