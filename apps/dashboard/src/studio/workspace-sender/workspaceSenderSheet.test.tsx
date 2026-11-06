// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's sender sheet: it opens from the row's button, lists where
 * the server can send from, refuses a From outside them in words before it
 * asks, words the server's own refusal the same way, saves the four fields,
 * and clears the sender back to the server's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { checkDraft, maySendFrom, type SenderWorkspace } from './senderApi.js';
import { WorkspaceSenderSheet } from './WorkspaceSenderSheet.js';

const SENDING = { domains: ['fernhill.example', 'kilnstreet.example'], addresses: ['ana.potter@gmail.com', 'studio@kilnstreet.example'] };
const KILN: SenderWorkspace = { id: 'wsp_kiln', name: 'Kiln Street Pottery', sender: { name: null, from: null, replyTo: null, postal: null } };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { method: init?.method ?? 'GET', url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

function mount(workspace: SenderWorkspace, onSaved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkspaceSenderSheet
        workspace={workspace}
        onSaved={onSaved}
        opener={(open) => (
          <button type="button" onClick={open}>
            Sender
          </button>
        )}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sender rule the form asks before the server', () => {
  it('takes any address at a listed domain, a listed address exactly, and nothing else', () => {
    expect(maySendFrom('orders@fernhill.example', SENDING)).toBe(true);
    expect(maySendFrom('Ana.Potter@gmail.com', SENDING)).toBe(true);
    expect(maySendFrom('other@gmail.com', SENDING)).toBe(false);
    expect(maySendFrom('x@mail.kilnstreet.example', SENDING)).toBe(false);
    expect(checkDraft({ name: '', from: 'hello', replyTo: '', postal: '' }, SENDING)).toEqual({ field: 'from', code: 'not-an-address' });
    expect(checkDraft({ name: '', from: 'a@kilnstreet.example', replyTo: 'Kiln <x@y.example>', postal: '' }, SENDING)).toEqual({ field: 'replyTo', code: 'not-an-address' });
    expect(checkDraft({ name: '', from: 'a@kilnstreet.example', replyTo: '', postal: '' }, { domains: [], addresses: [] })).toEqual({ field: 'from', code: 'no-mail' });
  });
});

describe('the workspace sender sheet', () => {
  it('lists where the server can send from, and refuses a From outside them in words without asking the server', async () => {
    const calls = stubFetch(() => jsonResponse(200, SENDING));
    mount(KILN);
    await userEvent.click(screen.getByRole('button', { name: 'Sender' }));
    expect(await screen.findByRole('dialog', { name: 'Sender for Kiln Street Pottery' })).toBeTruthy();
    const accepted = await screen.findByTestId('workspace-sender-accepted');
    expect(accepted.textContent).toContain('fernhill.example, kilnstreet.example');
    expect(accepted.textContent).toContain('ana.potter@gmail.com');
    expect(accepted.textContent).not.toContain('studio@kilnstreet.example');
    await userEvent.type(screen.getByTestId('workspace-sender-from'), 'hello@kiln-pottery.example');
    await userEvent.click(screen.getByTestId('workspace-sender-save'));
    expect((await screen.findByTestId('workspace-sender-from-error')).textContent).toBe(
      'This server can only send from fernhill.example, kilnstreet.example, or ana.potter@gmail.com. Use an address there.',
    );
    expect(screen.getByTestId('workspace-sender-from').getAttribute('aria-invalid')).toBe('true');
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('saves the four fields, and tells its owner', async () => {
    const saved: SenderWorkspace = { ...KILN, sender: { name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example', replyTo: 'hello@kilnstreet.example', postal: '12 Kiln Street' } };
    const calls = stubFetch((call) => jsonResponse(200, call.method === 'PUT' ? saved : SENDING));
    const onSaved = mount(KILN);
    await userEvent.click(screen.getByRole('button', { name: 'Sender' }));
    await screen.findByTestId('workspace-sender-accepted');
    await userEvent.type(screen.getByTestId('workspace-sender-name'), 'Kiln Street Pottery');
    await userEvent.type(screen.getByTestId('workspace-sender-from'), 'studio@kilnstreet.example');
    await userEvent.type(screen.getByTestId('workspace-sender-reply-to'), 'hello@kilnstreet.example');
    await userEvent.type(screen.getByTestId('workspace-sender-postal'), '12 Kiln Street');
    await userEvent.click(screen.getByTestId('workspace-sender-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(calls.find((call) => call.method === 'PUT')).toEqual({
      method: 'PUT',
      url: '/api/v1/workspaces/wsp_kiln/sender',
      body: { name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example', replyTo: 'hello@kilnstreet.example', postal: '12 Kiln Street' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('words the server’s refusal as its own, and clears a sender back to the server’s', async () => {
    const owned: SenderWorkspace = { ...KILN, sender: { name: 'Kiln', from: 'studio@kilnstreet.example', replyTo: null, postal: null } };
    stubFetch((call) => {
      if (call.method === 'PUT') return jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'x', details: { field: 'from', code: 'not-a-sending-domain', domains: ['fernhill.example'], addresses: [] } } });
      if (call.method === 'DELETE') return jsonResponse(200, KILN);
      return jsonResponse(200, SENDING);
    });
    const onSaved = mount(owned);
    await userEvent.click(screen.getByRole('button', { name: 'Sender' }));
    await screen.findByTestId('workspace-sender-accepted');
    expect(screen.getByTestId('workspace-sender-status').textContent).toBe('Its mail goes from studio@kilnstreet.example.');
    // The server's settings changed since the list was read: its 422 is said in the sheet's own words.
    await userEvent.click(screen.getByTestId('workspace-sender-save'));
    expect((await screen.findByTestId('workspace-sender-from-error')).textContent).toBe('This server can only send from fernhill.example. Use an address there.');
    await userEvent.click(screen.getByTestId('workspace-sender-clear'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(KILN));
  });

  it('says so when the server has no sender at all', async () => {
    stubFetch(() => jsonResponse(200, { domains: [], addresses: [] }));
    mount(KILN);
    await userEvent.click(screen.getByRole('button', { name: 'Sender' }));
    const none = await screen.findByTestId('workspace-sender-no-mail');
    expect(none.textContent).toContain('This server has no sender yet');
    expect(none.querySelector('a')?.getAttribute('href')).toBe('/studio/settings#email');
  });
});
