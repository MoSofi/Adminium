// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Figma card on a person's Security page: it says whose token is kept, changes it in a field of
 * its own, disconnects after asking, says
 * when the project's own token is in use, and is not drawn for a person with no Figma connection to
 * see.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import type { FigmaStatus } from '../designer/api.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import { FigmaCard } from './FigmaCard.js';

let figma: FigmaStatus | null;
let calls: { method: string; body?: unknown }[];
beforeEach(() => {
  calls = [];
  figma = { connected: true, source: 'mine', handle: 'ava.reyes', network: true, lasting: true };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      if (String(input) !== '/api/v1/designer/figma') return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
      calls.push({ method, ...(body === undefined ? {} : { body }) });
      if (figma === null) return Promise.resolve(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } }));
      if (method === 'PUT') {
        if ((body as { token: string }).token === 'figd_while_off') return Promise.resolve(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Adminium Designer is switched off on this server.', requestId: 'r', details: { reason: 'DESIGNER_OFF' } } }));
        if ((body as { token: string }).token !== 'figd_new_token') return Promise.resolve(jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'x', requestId: 'r', details: { reason: 'FIGMA', figma: { kind: 'token' } } } }));
        figma = { ...figma, handle: 'ava.new' };
      }
      if (method === 'DELETE') figma = { ...figma, connected: false, source: null, handle: null };
      return Promise.resolve(jsonResponse(200, figma));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

function mount(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FigmaCard />
    </QueryClientProvider>,
  );
}

describe('the Figma card', () => {
  it('says whose token is kept, and changes it in a field of its own', async () => {
    mount();
    const card = await screen.findByTestId('security-figma');
    expect(within(card).getByRole('heading', { name: 'Figma' })).toBeTruthy();
    expect(card.textContent).toContain('Connected to Figma as ava.reyes');
    expect(within(card).getByText('Kept encrypted on this server for you only. Only your own imports use it.')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Change token' }));
    const field = within(card).getByLabelText('New token') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, 'figd_wrong{Enter}');
    expect(await within(card).findByText('Figma did not accept this token. Check it and paste it again.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, 'figd_new_token');
    await userEvent.click(within(card).getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(card.textContent).toContain('Connected to Figma as ava.new'));
    expect(within(card).queryByLabelText('New token')).toBeNull();
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([{ token: 'figd_wrong' }, { token: 'figd_new_token' }]);
  });

  it('says the server’s own reason when the server, not Figma, refused the token', async () => {
    mount();
    const card = await screen.findByTestId('security-figma');
    await userEvent.click(within(card).getByRole('button', { name: 'Change token' }));
    await userEvent.type(within(card).getByLabelText('New token'), 'figd_while_off{Enter}');
    expect(await within(card).findByText('Adminium Designer is switched off on this server.')).toBeTruthy();
    expect(within(card).queryByText('Figma did not accept this token. Check it and paste it again.')).toBeNull();
  });

  it('asks before it disconnects, then says the Designer is where Figma is connected', async () => {
    mount();
    const card = await screen.findByTestId('security-figma');
    await userEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Disconnect Figma?' });
    expect(within(ask).getByText('Your imports already in the Designer stay.')).toBeTruthy();
    await userEvent.click(within(ask).getByRole('button', { name: 'Disconnect' }));
    expect(await within(card).findByText("Not connected. Connect Figma from the Designer's Attach menu, From Figma…")).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Change token' })).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('says when the project’s own token is in use, with no buttons', async () => {
    figma = { connected: true, source: 'environment', handle: null, network: true, lasting: true };
    mount();
    const card = await screen.findByTestId('security-figma');
    expect(within(card).getByText("Using the Figma token set in this project's environment.")).toBeTruthy();
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('is not drawn for a person who has no Figma connection to see', async () => {
    figma = null;
    mount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('security-figma')).toBeNull();
  });
});
