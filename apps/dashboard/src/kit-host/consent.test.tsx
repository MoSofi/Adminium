// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The e-mail consent panel, as an app's own screen mounts it (a CRM's contact
 * page): plain props in, a handle out.
 *
 * Worth proving: the part reads the panel through the server's door with the
 * person's session and the app's token, and draws the dashboard's panel under
 * the kit's wrapper; "Replied" asks inside the panel (no layer over the page),
 * writes once with the token, reads the panel again and tells the app; a read
 * the server refuses is said with "Try again"; a table no app declares as
 * people draws nothing; another record in `update` is read again; it speaks
 * the person's language; and it asks for no word outside its set.
 *
 * The server here is a function handed over as the part's `fetch`.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsentPanelView } from '../consent/consentTypes.js';
import type { ConsentProps, KitMounted } from './contract.js';
import { mount } from './index.js';
import { clearOutsideWords, outsideWords } from './words.js';

interface Call {
  path: string;
  csrf: string | null;
  body: Record<string, unknown>;
}

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function viewOf(patch: Partial<ConsentPanelView> = {}): ConsentPanelView {
  return {
    declared: true,
    erased: false,
    columns: { address: 'email', name: 'name' },
    addressKnown: true,
    purposes: [
      { purpose: 'newsletter', state: 'not-asked', event: null },
      { purpose: 'surveys', state: 'not-asked', event: null },
    ],
    stopped: null,
    lastReplied: null,
    history: [],
    mayChange: true,
    ...patch,
  };
}

function server() {
  const state = {
    calls: [] as Call[],
    view: viewOf(),
    refuse: null as { status: number; body: unknown } | null,
    fetch: (async (input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      state.calls.push({ path: input, csrf: new Headers(init?.headers).get('x-adminium-csrf'), body });
      if (state.refuse !== null) return reply(state.refuse.status, state.refuse.body);
      if (input === '/api/v1/consent/panel') return reply(200, { data: state.view });
      if (input === '/api/v1/consent/replied') {
        const event = { id: 'ev_r', purpose: null, state: 'replied', source: 'staff', detail: null, how: null, note: null, staff: { id: 'usr_rep', label: 'Ray Rep' }, wordingVersion: null, ip: null, at: Date.UTC(2026, 9, 27, 9, 0), confirmedAt: null };
        state.view = { ...state.view, lastReplied: event.at, history: [event as ConsentPanelView['history'][number], ...state.view.history] };
        return reply(200, { data: { event } });
      }
      return reply(404, { error: { code: 'NOT_FOUND', message: 'No such door.' } });
    }) as NonNullable<ConsentProps['fetch']>,
  };
  return state;
}

let host: HTMLElement;
let mounted: KitMounted<ConsentProps> | null = null;
let api: ReturnType<typeof server>;
let browserFetch: { mock: { calls: unknown[][] }; mockRestore(): void };

beforeEach(() => {
  clearOutsideWords();
  api = server();
  browserFetch = vi.spyOn(globalThis, 'fetch');
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  expect(browserFetch.mock.calls).toEqual([]);
  browserFetch.mockRestore();
  expect(outsideWords()).toEqual([]);
});

async function panel(props: Partial<ConsentProps> = {}): Promise<void> {
  await act(async () => {
    mounted = await mount('consent', host, { connectionId: 'conn_1', table: 'crm_contacts', recordId: '7', name: 'Marta Kovac', csrfToken: 'tok_1', fetch: api.fetch, locale: 'en-US', dir: 'ltr', ...props });
  });
}

describe('the e-mail consent panel, mounted', () => {
  it('reads the record\'s consent with the app\'s token and draws the panel under the kit\'s wrapper', async () => {
    await panel();
    await waitFor(() => expect(host.querySelector('[data-testid="consent-panel"]')).not.toBeNull());
    expect(host.querySelector('.adm-kit')?.getAttribute('data-kit-part')).toBe('consent');
    expect(api.calls).toEqual([{ path: '/api/v1/consent/panel', csrf: 'tok_1', body: { connectionId: 'conn_1', table: 'crm_contacts', recordId: '7' } }]);
    expect(screen.getByRole('heading', { name: 'E-mail consent' })).toBeTruthy();
  });

  it('asks before "Replied" inside the panel, writes once, reads again and tells the app', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    await panel({ onChange });
    await user.click(await screen.findByTestId('consent-replied'));
    const step = await screen.findByTestId('consent-replied-confirm');
    // Inside the panel, not a layer over the app's page.
    expect(host.contains(step)).toBe(true);
    expect(within(step).getByRole('heading', { name: 'Mark as replied?' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cancel'));
    await user.click(within(step).getByTestId('consent-replied-confirm-yes'));
    await waitFor(() => expect(screen.getByTestId('consent-history').textContent).toContain('Replied — e-mail sequences stopped'));
    expect(api.calls.map((call) => [call.path, call.csrf])).toEqual([
      ['/api/v1/consent/panel', 'tok_1'],
      ['/api/v1/consent/replied', 'tok_1'],
      ['/api/v1/consent/panel', 'tok_1'],
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Marked as replied. Their e-mail sequences stop.');
  });

  it('closes its own step with Escape, and writes nothing', async () => {
    const user = userEvent.setup();
    await panel();
    await user.click(await screen.findByTestId('consent-record'));
    expect(await screen.findByTestId('consent-dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('consent-dialog')).toBeNull());
    expect(api.calls.map((call) => call.path)).toEqual(['/api/v1/consent/panel']);
  });

  it('says a refused read with "Try again", and draws nothing for a table no app declares as people', async () => {
    api.refuse = { status: 403, body: { error: { code: 'TABLE_FORBIDDEN', message: 'You may not read this record.' } } };
    await panel();
    expect((await screen.findByTestId('kit-consent-failed')).textContent).toContain('Their e-mail consent could not be loaded.');
    api.refuse = null;
    api.view = viewOf({ declared: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('kit-consent-failed')).toBeNull());
    expect(screen.queryByTestId('consent-panel')).toBeNull();
  });

  it('reads another record when the app moves to it', async () => {
    await panel();
    await screen.findByTestId('consent-panel');
    await act(async () => {
      mounted!.update({ recordId: '8' });
    });
    await waitFor(() => expect(api.calls.at(-1)?.body).toEqual({ connectionId: 'conn_1', table: 'crm_contacts', recordId: '8' }));
  });

  it('speaks the person\'s language', async () => {
    await panel({ locale: 'ar-EG', dir: 'rtl' });
    expect(await screen.findByRole('heading', { name: 'موافقة البريد الإلكتروني' })).toBeTruthy();
    expect(screen.getByTestId('consent-replied').textContent).toBe('تمّ الردّ');
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('rtl');
  });
});
