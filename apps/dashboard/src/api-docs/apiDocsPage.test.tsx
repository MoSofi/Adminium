// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api-docs`, router-mounted with NO session.
 *
 * Pinned:
 *  - the page renders for a signed-out visitor, and a 404 from the catalogue
 *    is the ordinary not-found screen;
 *  - the rail, the cards, the heading chip and the meta line come from the
 *    catalogue, and a card is addressed by `?resource=&endpoint=`;
 *  - no request is made before a key is pasted; the key is sent in
 *    `Authorization`, with `credentials: 'omit'`, and is in no URL, no
 *    storage and no code sample;
 *  - a refusal renders the server's own `{error:{code}}` and status.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import type { ApiDocs } from './apiDocsApi.js';
import { makeDocs } from './fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const KEY = `adm_pub_${'k'.repeat(32)}`;

function stubFetch(docs: ApiDocs | null, record: { status: number; body: unknown } = { status: 200, body: { data: [] } }) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no session' } }));
    }
    if (url === '/api/v1/branding') {
      return Promise.resolve(jsonResponse(200, { data: { appName: 'Northwind Admin', logoUrl: null, showVersion: false } }));
    }
    if (url === '/api/v1/api-docs') {
      return Promise.resolve(
        docs === null ? jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Route GET:/api/v1/api-docs not found.' } }) : jsonResponse(200, docs),
      );
    }
    if (url.includes('/api/v1/public/records/')) {
      // The page reads the raw text, so the body stays visible when it is not JSON.
      return Promise.resolve({ ...jsonResponse(record.status, record.body), text: async () => JSON.stringify(record.body) });
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function renderAt(path: string, docs: ApiDocs | null, record?: { status: number; body: unknown }) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch(docs, record);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router, queryClient };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('/api-docs', () => {
  it('renders the not-found screen when the catalogue answers 404', async () => {
    await renderAt('/api-docs', null);
    expect(await screen.findByRole('heading', { name: 'This page went missing' })).toBeTruthy();
  });

  it('renders for a signed-out visitor: rail, heading, chip, meta and one open card', async () => {
    const { calls } = await renderAt('/api-docs', makeDocs());
    expect(await screen.findByRole('heading', { level: 1, name: 'customers' })).toBeTruthy();
    const rail = screen.getByRole('navigation', { name: 'Resources' });
    expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual(['customers', 'orders']);
    expect(within(rail).getByRole('button', { name: 'customers' }).getAttribute('aria-current')).toBe('true');
    // GET only on an anon endpoint → "Public read".
    expect(screen.getByText('Public read')).toBeTruthy();
    // GET is two cards, and the meta line counts cards, not endpoints.
    expect(screen.getByText('2 endpoints · limit 20, order customer_id.desc')).toBeTruthy();
    const open = screen.getByRole('button', { expanded: true });
    expect(open.textContent).toContain('List customers');
    expect(screen.getByText('Response columns')).toBeTruthy();
    expect(screen.getByText('UNIQUE')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('API live');
    // The page never asked who is signed in.
    expect(calls.some((c) => c.url.startsWith('/api/v1/bootstrap'))).toBe(false);
  });

  it('addresses a card through the URL and moves it there on a click', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt('/api-docs?resource=orders&endpoint=update', makeDocs());
    expect(await screen.findByRole('heading', { level: 1, name: 'orders' })).toBeTruthy();
    expect(screen.getByRole('button', { expanded: true }).textContent).toContain('Update an order');
    // Any write on an anon endpoint → "Public".
    expect(screen.getByText('Public')).toBeTruthy();
    expect(screen.getByText('Body schema')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Delete an order/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ resource: 'orders', endpoint: 'delete' }));
    // A delete lists no body schema.
    expect(screen.queryByText('Body schema')).toBeNull();
  });

  it('filters the rail', async () => {
    const user = userEvent.setup();
    await renderAt('/api-docs', makeDocs());
    await user.type(await screen.findByRole('textbox', { name: 'Filter tables…' }), 'ord');
    const rail = screen.getByRole('navigation', { name: 'Resources' });
    expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual(['orders']);
    await user.type(screen.getByRole('textbox', { name: 'Filter tables…' }), 'zzz');
    expect(screen.getByText('Nothing matches that filter.')).toBeTruthy();
  });

  it('sends nothing before a key; then a real request with the key only in Authorization', async () => {
    const user = userEvent.setup();
    const { calls } = await renderAt('/api-docs?resource=orders&endpoint=list', makeDocs(), {
      status: 200,
      body: { data: [{ order_id: 10248, ship_name: 'Vins et alcools Chevalier' }], page: null },
    });
    const sendButton = await screen.findByRole('button', { name: /Send request/ });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    expect(sendButton.getAttribute('title')).toBe('Paste a key first');
    expect(screen.getByText('Send a request to see the response.')).toBeTruthy();

    await user.type(screen.getByLabelText('Authorization'), KEY);
    await user.click(screen.getByRole('button', { name: /Send request/ }));

    expect(await screen.findByText('200 OK')).toBeTruthy();
    const sent = calls.filter((c) => c.url.includes('/api/v1/public/records/'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://admin.northwind.test/api/v1/public/records/orders?limit=20');
    expect(sent[0]?.init?.credentials).toBe('omit');
    expect((sent[0]?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(screen.getByText(/"Vins et alcools Chevalier"/)).toBeTruthy();
    expect(screen.getByText(/\d+ ms/)).toBeTruthy();

    // The key is nowhere but the one request.
    expect(window.location.href).not.toContain(KEY);
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(KEY);
    expect(screen.getByRole('tabpanel').textContent).not.toContain(KEY);
    expect(calls.filter((c) => c.url.includes(KEY))).toEqual([]);
  });

  it("renders a refusal as the server's own status and code", async () => {
    const user = userEvent.setup();
    await renderAt('/api-docs?resource=orders&endpoint=create', makeDocs(), {
      status: 403,
      body: { error: { code: 'PUBLIC_ORIGIN_REFUSED', message: 'A server key cannot be used from a browser.' } },
    });
    // The body is prefilled from the writable columns, with nothing invented.
    const body = (await screen.findByLabelText('Request body')) as HTMLTextAreaElement;
    expect(JSON.parse(body.value)).toEqual({
      values: { customer_id: '', ship_name: '', freight: 0, shipped: false, order_date: null },
    });
    await user.type(screen.getByLabelText('Authorization'), KEY);
    await user.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText('403 Forbidden')).toBeTruthy();
    expect(screen.getByText(/"PUBLIC_ORIGIN_REFUSED"/)).toBeTruthy();
  });

  it('switches the code sample language, and says Disabled when the API is off', async () => {
    const user = userEvent.setup();
    await renderAt('/api-docs', makeDocs({ apiEnabled: false }));
    expect((await screen.findByRole('status')).textContent).toBe('Disabled');
    expect(screen.getByRole('tabpanel').textContent).toContain('curl');
    await user.click(screen.getByRole('tab', { name: 'Python' }));
    expect(screen.getByRole('tab', { name: 'Python' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toContain('import requests');
  });

  it('shows the empty state when nothing is published', async () => {
    await renderAt('/api-docs', makeDocs({ connections: [] }));
    expect(await screen.findByText('No endpoints yet')).toBeTruthy();
  });
});
