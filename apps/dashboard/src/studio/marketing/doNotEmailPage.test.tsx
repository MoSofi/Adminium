// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The do-not-email list (`/email-templates/do-not-email`), router-mounted:
 *
 *  - as the marketer (`settings.manage`): rows with why, when and where from;
 *    an erased person's row has no address; the count; search and the "Why"
 *    filter go to the server; "Add addresses" sends one address per line;
 *    no "Remove" anywhere (taking someone off is the Super Admin's);
 *  - as the Super Admin: "Remove" on rows with an address, never on the
 *    erased one; its confirm names the address, starts on Cancel, and a
 *    confirmed remove deletes the entry;
 *  - the empty list; a role without `settings.manage` is refused.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { StopEntry } from './marketingApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const JUL20 = Date.UTC(2026, 6, 20, 12);

function entry(over: Partial<StopEntry>): StopEntry {
  return { id: 'stp_1', address: 'marta.kovac@cobaltlegal.example', reason: 'link', origin: 'Summer showroom days', addedAt: JUL20, addedBy: null, erasedAt: null, mayRemove: false, ...over };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let entries: StopEntry[];
let superAdmin: boolean;
let systemActions: string[];

function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      const ok = (data: unknown) => Promise.resolve(jsonResponse(200, JSON.parse(JSON.stringify(data)) as unknown));
      if (url.startsWith('/api/v1/bootstrap')) return ok({ data: makeBootstrap({ roles: superAdmin ? ['super-admin'] : ['marketing'], nav: { groups: [] }, systemActions }) });
      if (url.startsWith('/api/v1/consent/stop-list') && method === 'GET') {
        const shown = entries.map((one) => ({ ...one, mayRemove: superAdmin && one.address !== null }));
        return ok({ data: { entries: shown, next: null, total: shown.length } });
      }
      if (url === '/api/v1/consent/stop-list' && method === 'POST') {
        const lines = (body as { addresses: string[] }).addresses;
        return ok({ data: { added: lines.filter((line) => line.includes('@')).length, already: 0, invalid: lines.filter((line) => !line.includes('@')) } });
      }
      if (url.startsWith('/api/v1/consent/stop-list/') && method === 'DELETE') {
        const id = decodeURIComponent(url.split('/').pop()!);
        entries = entries.filter((one) => one.id !== id);
        return ok({ data: { removed: true } });
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderPage() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stub();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/email-templates/do-not-email'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router };
}

const sample = (): StopEntry[] => [
  entry({}),
  entry({ id: 'stp_2', address: 't.reidy@nordwind.example', reason: 'spam', origin: 'June news: the Leeds showroom reopens' }),
  entry({ id: 'stp_3', address: null, reason: 'link', origin: 'May news: storage that folds away', erasedAt: JUL20 }),
  entry({ id: 'stp_4', address: 'callum@harborfinch.example', reason: 'hand', origin: null, addedBy: { id: 'usr_t', label: 'Tessa Marlow' } }),
  entry({ id: 'stp_5', address: 'j.ellis@tandemrobotics.example', reason: 'lead-finder', origin: null }),
];

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the do-not-email list', () => {
  it('shows the marketer every entry, the erased one without an address, and offers no Remove', async () => {
    entries = sample();
    superAdmin = false;
    systemActions = ['settings.manage'];
    await renderPage();
    const rows = await screen.findAllByTestId('dne-row');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText('marta.kovac@cobaltlegal.example')).toBeDefined();
    expect(within(rows[0]!).getByText('Unsubscribed by link')).toBeDefined();
    expect(within(rows[0]!).getByText('Summer showroom days')).toBeDefined();
    expect(within(rows[1]!).getByText('Marked as spam')).toBeDefined();
    expect(within(rows[2]!).getByText('Erased person — kept so they’re never e-mailed again')).toBeDefined();
    expect(within(rows[3]!).getByText('Added by hand')).toBeDefined();
    expect(within(rows[3]!).getByText('Added by Tessa Marlow')).toBeDefined();
    expect(within(rows[4]!).getByText('Objected through Lead finder')).toBeDefined();
    expect(screen.getByTestId('dne-count').textContent).toBe('5 entries');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('searches and filters by why at the server', async () => {
    entries = sample();
    superAdmin = false;
    systemActions = ['settings.manage'];
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findAllByTestId('dne-row');
    await user.type(screen.getByRole('textbox', { name: 'Search addresses' }), 'nordwind');
    await waitFor(() => expect(calls.some((call) => call.url.includes('q=nordwind'))).toBe(true));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Why' }), 'spam');
    await waitFor(() => expect(calls.some((call) => call.url.includes('reason=spam') && call.url.includes('q=nordwind'))).toBe(true));
  });

  it('adds pasted addresses, one per line', async () => {
    entries = sample();
    superAdmin = false;
    systemActions = ['settings.manage'];
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findAllByTestId('dne-row');
    await user.click(screen.getByTestId('dne-add'));
    const dialog = await screen.findByRole('dialog', { name: 'Add addresses' });
    const box = within(dialog).getByRole('textbox', { name: 'Addresses' });
    expect((within(dialog).getByTestId('dne-add-confirm') as HTMLButtonElement).disabled).toBe(true);
    await user.type(box, 'front.desk@harborfinch.example{enter}p.lowe@junoanalytics.example{enter}{enter}nope');
    await user.click(within(dialog).getByTestId('dne-add-confirm'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add addresses' })).toBeNull());
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ addresses: ['front.desk@harborfinch.example', 'p.lowe@junoanalytics.example', 'nope'] });
    expect(await screen.findByText('2 addresses added')).toBeDefined();
    expect(screen.getByText('Not addresses, left out: nope')).toBeDefined();
  });

  it('lets the Super Admin remove an entry with an address, after a confirm that starts on Cancel', async () => {
    entries = sample();
    superAdmin = true;
    systemActions = ['settings.manage', 'users.manage'];
    const user = userEvent.setup();
    const { calls } = await renderPage();
    const rows = await screen.findAllByTestId('dne-row');
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(4);
    expect(within(rows[2]!).queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(within(rows[1]!).getByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove from the list?' });
    expect(within(confirm).getByText('t.reidy@nordwind.example')).toBeDefined();
    expect(within(confirm).getByText('They will get marketing mail again only if they agree again.')).toBeDefined();
    expect(document.activeElement?.textContent).toBe('Cancel');
    await user.click(within(confirm).getByTestId('dne-remove-confirm'));
    await waitFor(() => expect(screen.getAllByTestId('dne-row')).toHaveLength(4));
    expect(calls.find((call) => call.method === 'DELETE')?.url).toBe('/api/v1/consent/stop-list/stp_2');
    expect(await screen.findByText('t.reidy@nordwind.example is off the list.')).toBeDefined();
  });

  it('says nobody is on the list yet, with Add addresses', async () => {
    entries = [];
    superAdmin = false;
    systemActions = ['settings.manage'];
    await renderPage();
    expect(await screen.findByText('Nobody is on the list yet.')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Add addresses' }).length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a role without settings.manage', async () => {
    entries = sample();
    superAdmin = false;
    systemActions = ['users.manage'];
    const { calls } = await renderPage();
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    expect(calls.some((call) => call.url.startsWith('/api/v1/consent/stop-list'))).toBe(false);
  });
});
