// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Connections: "Allow databases on this server", in the
 * three states the comp draws (view 7: off, on, set by the operator), and the
 * password it asks for before it is switched on.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { LocalDatabasesCard, type LocalDatabases } from './LocalDatabasesCard.js';

const NAME = 'Allow databases on this server';
const TEN_NOV = Date.UTC(2026, 10, 10, 12);

let state: LocalDatabases | number;
let puts: unknown[];
let refuse: { status: number; reason: string } | null;

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocalDatabasesCard />
    </QueryClientProvider>,
  );
}

const off = (): LocalDatabases => ({ allowed: true, on: false, reason: null, hosts: [], turnedOn: null, loopbackAllowed: false });

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
  state = off();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/settings/local-databases') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { on: boolean };
        puts.push(body);
        if (refuse !== null) {
          return Promise.resolve(jsonResponse(refuse.status, { error: { code: 'FORBIDDEN', message: 'refused', requestId: 'r', details: { reason: refuse.reason } } }));
        }
        state = { ...(state as LocalDatabases), on: body.on, turnedOn: body.on ? { by: 'Dana Price', at: TEN_NOV } : null };
        return Promise.resolve(jsonResponse(200, state));
      }
      if (url.endsWith('/settings/local-databases')) {
        return Promise.resolve(typeof state === 'number' ? jsonResponse(state, { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } }) : jsonResponse(200, state));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Allow databases on this server', () => {
  it('is not drawn for someone who is not a Super Admin', async () => {
    state = 403;
    mount();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByTestId('local-databases-card')).toBeNull();
  });

  it('off: the switch, its help, and nothing else', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: NAME });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-disabled')).toBeNull();
    const help = document.getElementById(toggle.getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toBe('Lets connections reach databases running on this same server, like localhost:5432. Only for databases you set up here.');
    expect(screen.getByText('localhost:5432').tagName).toBe('CODE');
    expect(screen.queryByText('Set by the operator')).toBeNull();
    expect(screen.queryByTestId('local-databases-audit')).toBeNull();
  });

  it('on: the switch on, and who turned it on and when', async () => {
    state = { ...off(), on: true, turnedOn: { by: 'Dana Price', at: TEN_NOV } };
    mount();
    const toggle = await screen.findByRole('switch', { name: NAME });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('local-databases-audit').textContent).toBe('Turned on by Dana Price, Nov 10');
  });

  it('locked by the operator: off and disabled with aria-disabled, the chip, and the hosts as its reason', async () => {
    state = { allowed: false, on: false, reason: 'not-allowed', hosts: ['pg-trials:5432', 'localhost:5432'], turnedOn: null, loopbackAllowed: false };
    mount();
    const toggle = await screen.findByRole('switch', { name: NAME });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    // Still reachable by keyboard, so the reason can be read.
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('local-databases-locked').textContent).toBe('Set by the operator');
    const described = (toggle.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described[1]).toBe('The operator allows only these hosts: pg-trials:5432 localhost:5432');
    expect(screen.getByText('pg-trials:5432').tagName).toBe('CODE');

    // A click does nothing: no password asked, nothing sent.
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Your password, to switch it on')).toBeNull();
    expect(puts).toEqual([]);
  });

  it('locked with no hosts says so', async () => {
    state = { allowed: false, on: true, reason: 'not-allowed', hosts: [], turnedOn: null, loopbackAllowed: false };
    mount();
    const toggle = await screen.findByRole('switch', { name: NAME });
    // A stored `on` is never drawn on while the operator has it locked.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('The operator allows no databases on this server.')).toBeTruthy();
  });

  it('asks for the password before it is switched on, says a wrong one, and switches off without one', async () => {
    mount();
    await userEvent.click(await screen.findByRole('switch', { name: NAME }));
    expect(puts).toEqual([]);
    const field = screen.getByLabelText('Your password, to switch it on');
    const submit = screen.getByRole('button', { name: 'Switch it on' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    refuse = { status: 403, reason: 'PASSWORD' };
    await userEvent.type(field, 'wrong');
    await userEvent.click(submit);
    expect((await screen.findByRole('alert')).textContent).toBe('That is not your password.');

    refuse = null;
    await userEvent.clear(field);
    await userEvent.type(field, 'the-right-one');
    await userEvent.click(screen.getByRole('button', { name: 'Switch it on' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: NAME }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByLabelText('Your password, to switch it on')).toBeNull();
    expect(screen.getByTestId('local-databases-audit').textContent).toBe('Turned on by Dana Price, Nov 10');

    await userEvent.click(screen.getByRole('switch', { name: NAME }));
    await waitFor(() => expect(screen.getByRole('switch', { name: NAME }).getAttribute('aria-checked')).toBe('false'));
    expect(puts).toEqual([
      { on: true, password: 'wrong' },
      { on: true, password: 'the-right-one' },
      { on: false },
    ]);
  });

  it('says the operator locked it when the server refuses it so', async () => {
    mount();
    await userEvent.click(await screen.findByRole('switch', { name: NAME }));
    refuse = { status: 409, reason: 'not-allowed' };
    await userEvent.type(screen.getByLabelText('Your password, to switch it on'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Switch it on' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The server’s operator has locked this off.');
  });

  it('on a server that never refuses this machine, says the switch changes nothing', async () => {
    state = { ...off(), loopbackAllowed: true };
    mount();
    expect(await screen.findByText('This server already reaches databases on this machine, so this switch changes nothing here.')).toBeTruthy();
  });
});
