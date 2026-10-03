// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: the live Designer's switch.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { DesignerLiveCard, type DesignerLive } from './DesignerLiveCard.js';

let state: DesignerLive | number;
let puts: unknown[];
let refuse: { status: number; message: string } | null;

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DesignerLiveCard />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  puts = [];
  refuse = null;
  state = { mode: 'live', allowed: true, on: false, project: true, reason: null };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/designer/live') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { on: boolean };
        puts.push(body);
        if (refuse !== null) return Promise.resolve(jsonResponse(refuse.status, { error: { code: 'FORBIDDEN', message: refuse.message, requestId: 'r' } }));
        state = { ...(state as DesignerLive), on: body.on };
        return Promise.resolve(jsonResponse(200, state));
      }
      if (url.endsWith('/designer/live')) return Promise.resolve(typeof state === 'number' ? jsonResponse(state, { error: { code: 'X', message: 'no', requestId: 'r' } }) : jsonResponse(200, state));
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the live Designer’s switch', () => {
  it('is not drawn for someone who may not use the Designer', async () => {
    state = 403;
    mount();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByTestId('designer-live-card')).toBeNull();
  });

  it('is off and disabled until the operator allowed it, and says so', async () => {
    state = { mode: 'live', allowed: false, on: false, project: true, reason: 'not-allowed' };
    mount();
    const toggle = (await screen.findByRole('switch', { name: 'Adminium Designer on this server' })) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/ADMINIUM_DESIGNER=live/)).toBeTruthy();
  });

  it('asks for the password before it is switched on, says a wrong one, and opens the Designer once on', async () => {
    mount();
    await userEvent.click(await screen.findByRole('switch', { name: 'Adminium Designer on this server' }));
    // Nothing is sent by the switch alone.
    expect(puts).toEqual([]);
    const field = screen.getByLabelText('Your password, to switch it on');
    expect((screen.getByRole('button', { name: 'Switch it on' }) as HTMLButtonElement).disabled).toBe(true);
    refuse = { status: 403, message: 'That is not your password.' };
    await userEvent.type(field, 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Switch it on' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That is not your password.');

    refuse = null;
    await userEvent.clear(field);
    await userEvent.type(field, 'the-real-password');
    await userEvent.click(screen.getByRole('button', { name: 'Switch it on' }));
    expect(puts.at(-1)).toEqual({ on: true, password: 'the-real-password' });
    expect((await screen.findByRole('link', { name: 'Open the Designer' })).getAttribute('href')).toBe('/design');
    expect(screen.queryByLabelText('Your password, to switch it on')).toBeNull();

    // Off, with no password.
    await userEvent.click(screen.getByRole('switch', { name: 'Adminium Designer on this server' }));
    expect(puts.at(-1)).toEqual({ on: false });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Open the Designer' })).toBeNull());
  });

  it('says why it went off when the folder was not kept, and is one line on a design server', async () => {
    state = { mode: 'live', allowed: true, on: false, project: true, reason: 'disk-not-kept' };
    mount();
    expect(await screen.findByText(/did not come back after a restart/)).toBeTruthy();
  });

  it('has no switch on a design server', async () => {
    state = { mode: 'local', allowed: true, on: true, project: true, reason: null };
    mount();
    expect(await screen.findByText('Adminium Designer is running on this machine (adminium design).')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
