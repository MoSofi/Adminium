// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Attach menu and the "From Figma…" dialog, on Designer Home through the real `/design` route
 *
 *  1. The clip is a menu named "Attach": files from the computer, with every kind it takes named,
 *     and From Figma…, unavailable with its reason when network features are off.
 *  2. Not connected: the token step; a token Figma refuses is said under the field; one it takes
 *     shows whose it is, and the link step.
 *  3. A link that names no frame is refused in the dialog's words; an import's two files join the
 *     message and go up with it, named by the import; a second import from the kept copy says no read
 *     was used, and adds nothing twice.
 *  4. Change token keeps saying whose token is kept; Disconnect asks first, then says the token was
 *     removed; the project's own token is said, with neither button.
 *  5. A dead token puts the token field back in place; Figma's limit is said with its date and
 *     Import waits; a server with no lasting disk says an import after a deploy reads Figma again.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { DesignerModels, FigmaStatus } from '../api.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const SESSION = { id: 'ds_000000000000000000000001', appKey: 'repair-shop', title: 'Repair shop', target: 'auto', connectionId: 'env:anthropic', model: 'claude-test', createdAt: 1, updatedAt: 1, turns: 1, version: null, createdApp: true, tokens: { in: 0, out: 0 } };
const MODELS: DesignerModels = {
  connections: [{ id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: [{ id: 'claude-test', label: 'Claude Test' }] }],
  selected: { connectionId: 'env:anthropic', model: 'claude-test' },
  verdicts: [],
  canAdd: true,
};
const NONE: FigmaStatus = { connected: false, source: null, handle: null, network: true, lasting: true };
const MINE: FigmaStatus = { connected: true, source: 'mine', handle: 'ava.reyes', network: true, lasting: true };
const DONE = { importId: `imp_${'a'.repeat(24)}`, outlineName: 'Checkout — Figma design.md', pictureName: 'Checkout.png', width: 1440, height: 1024, reads: 2 };

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
let calls: Call[];
let figma: FigmaStatus;
/** What the next import answers: a reply, or an error envelope with its status. */
let importReply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  figma = NONE;
  importReply = { status: 200, body: DONE };
  window.localStorage.clear();
});

const refusal = (status: number, details: unknown, message = 'refused') => ({ status, body: { error: { code: 'VALIDATION_FAILED', message, requestId: 'req_t', details } } });

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }));
      if (url === '/api/v1/system/info') return Promise.resolve(jsonResponse(200, { runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, lanShare: false, desktopDemo: false, designer: { mode: 'local', link: true } }));
      if (url === '/api/v1/designer/live') return Promise.resolve(jsonResponse(200, { on: true }));
      if (url === '/api/v1/designer/models') return Promise.resolve(jsonResponse(200, MODELS));
      if (url === '/api/v1/designer/sessions' && method === 'GET') return Promise.resolve(jsonResponse(200, { apps: [] }));
      if (url === '/api/v1/designer/sessions' && method === 'POST') return Promise.resolve(jsonResponse(201, { session: SESSION, turn: null }));
      if (url.startsWith(`/api/v1/designer/sessions/${SESSION.id}/attachments?`)) {
        const part = new URL(url, 'http://x').searchParams.get('figma_part');
        return Promise.resolve(jsonResponse(201, { attachment: { id: part === 'picture' ? 'att_00000000000000000001' : 'att_00000000000000000002', label: part ?? 'x', kind: part === 'picture' ? 'image' : 'doc', mediaType: 'x', bytes: 1 } }));
      }
      if (url === `/api/v1/designer/sessions/${SESSION.id}/turns`) return Promise.resolve(jsonResponse(200, { turn: 1 }));
      if (url === '/api/v1/designer/figma' && method === 'GET') return Promise.resolve(jsonResponse(200, figma));
      if (url === '/api/v1/designer/figma' && method === 'PUT') {
        const token = (body as { token: string }).token;
        if (token !== 'figd_good_token') return Promise.resolve(jsonResponse(422, refusal(422, { reason: 'FIGMA', figma: { kind: 'token' } }).body));
        figma = MINE;
        return Promise.resolve(jsonResponse(200, figma));
      }
      if (url === '/api/v1/designer/figma' && method === 'DELETE') {
        figma = NONE;
        return Promise.resolve(jsonResponse(200, figma));
      }
      if (url === '/api/v1/designer/figma/import') return Promise.resolve(jsonResponse(importReply.status, importReply.body));
      if (url === '/api/v1/designer/apps') return Promise.resolve(jsonResponse(200, { state: 'ok', apps: [] }));
      if (url === '/api/v1/auth/design-session') return Promise.resolve(jsonResponse(200, { ok: true }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }));
    }),
  );
}

async function renderHome() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/design'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'What do you want to build?' });
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Describe your app' }) as HTMLTextAreaElement).disabled).toBe(false));
}

const attach = () => screen.getByRole('button', { name: 'Attach' });
async function openFigma(): Promise<HTMLElement> {
  await userEvent.click(attach());
  await userEvent.click(await screen.findByRole('menuitem', { name: /From Figma…/ }));
  return screen.findByRole('dialog', { name: 'From Figma' });
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
});

describe('the Attach menu', () => {
  it('opens a menu of the ways in, naming every kind the chooser takes', async () => {
    await renderHome();
    expect(attach().getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(attach());
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Files from your computer…A picture, a CSV, font or Markdown file, an HTML or CSS file, or a site template (.zip)', 'A folder…A site template, as a folder', 'From Figma…']);
    expect(items[2]?.hasAttribute('data-disabled')).toBe(false);
  });

  it('keeps From Figma… in the menu, unavailable with its reason, where network features are off', async () => {
    figma = { ...NONE, network: false };
    await renderHome();
    await userEvent.click(attach());
    const item = await screen.findByRole('menuitem', { name: /From Figma…/ });
    await waitFor(() => expect(item.getAttribute('aria-disabled')).toBe('true'));
    expect(item.textContent).toContain('Figma is off on this server: network features are turned off.');
  });
});

describe('the From Figma dialog', () => {
  it('asks for a token, says when Figma refuses it, and takes a link once it is kept', async () => {
    await renderHome();
    const dialog = await openFigma();
    expect(within(dialog).getByText('Not connected to Figma.')).toBeTruthy();
    expect(within(dialog).getByText(/In Figma, open Settings, then Security, then Personal access tokens\./)).toBeTruthy();
    expect(within(dialog).getByText('Kept encrypted on this server for you only. Only your own imports use it.')).toBeTruthy();
    const field = within(dialog).getByLabelText('Figma token') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect((within(dialog).getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show the token' }));
    expect(field.type).toBe('text');

    await userEvent.type(field, 'figd_wrong{Enter}');
    expect(await within(dialog).findByText('Figma did not accept this token. Check it and paste it again.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');

    await userEvent.clear(field);
    await userEvent.type(field, 'figd_good_token');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(await within(dialog).findByText(/Connected to Figma as/)).toBeTruthy();
    expect(within(dialog).getByText('ava.reyes')).toBeTruthy();
    expect(within(dialog).getByLabelText('Link to a Figma frame')).toBeTruthy();
    expect(within(dialog).getByText('Each import reads Figma twice. On a View or Collab seat Figma allows 20 reads a month, so about ten imports. Importing a frame again is free until the file changes.')).toBeTruthy();
    expect(within(dialog).queryByText(/forgets saved copies/)).toBeNull();
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([{ token: 'figd_wrong' }, { token: 'figd_good_token' }]);
  });

  it('refuses a link that names no frame, and puts an import’s two files with the message', async () => {
    figma = MINE;
    await renderHome();
    let dialog = await openFigma();
    importReply = refusal(422, { reason: 'FIGMA_LINK', link: 'figjam' });
    const link = within(dialog).getByLabelText('Link to a Figma frame');
    await userEvent.type(link, 'https://www.figma.com/board/AbCdEf0123456789/Plan?node-id=1-2{Enter}');
    expect(await within(dialog).findByText('That is a FigJam board. Paste a link to a design frame.')).toBeTruthy();
    // Typing clears it.
    await userEvent.type(link, 'x');
    expect(within(dialog).queryByText('That is a FigJam board. Paste a link to a design frame.')).toBeNull();

    importReply = { status: 200, body: DONE };
    await userEvent.clear(link);
    await userEvent.type(link, 'https://www.figma.com/design/AbCdEf0123456789/Shop?node-id=1-2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'From Figma' })).toBeNull());
    const tray = screen.getByRole('list', { name: 'Attached files' });
    expect(within(tray).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Checkout.png', 'Checkout — Figma design.md']);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Describe your app' }));

    // The same frame again, from the kept copy: said, and not added twice.
    importReply = { status: 200, body: { ...DONE, importId: `imp_${'b'.repeat(24)}`, reads: 0 } };
    dialog = await openFigma();
    await userEvent.type(within(dialog).getByLabelText('Link to a Figma frame'), 'https://www.figma.com/design/AbCdEf0123456789/Shop?node-id=1-2{Enter}');
    expect(await screen.findByText('Already imported this version of the frame. No Figma read was used.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem')).toHaveLength(2);

    // Sent: each file goes up named by the import, with no body of its own.
    await userEvent.type(screen.getByRole('textbox', { name: 'Describe your app' }), 'Build this page{Enter}');
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/turns'))).toBe(true));
    const uploads = calls.filter((call) => call.url.includes('/attachments?'));
    expect(uploads.map((call) => new URL(call.url, 'http://x').searchParams.get('figma'))).toEqual([`imp_${'b'.repeat(24)}`, `imp_${'b'.repeat(24)}`]);
    expect(uploads.map((call) => new URL(call.url, 'http://x').searchParams.get('figma_part'))).toEqual(['picture', 'outline']);
    expect(calls.find((call) => call.url.endsWith('/turns'))?.body).toMatchObject({ attachments: ['att_00000000000000000001', 'att_00000000000000000002'] });
  });

  it('keeps saying whose token is kept while a new one is pasted, and asks before it disconnects', async () => {
    figma = MINE;
    await renderHome();
    const dialog = await openFigma();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change token' }));
    expect(within(dialog).getByLabelText('Figma token')).toBeTruthy();
    // The old token is still kept: the header does not say otherwise.
    expect(within(dialog).getByText(/Connected to Figma as/)).toBeTruthy();
    expect(within(dialog).queryByText('Not connected to Figma.')).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Disconnect Figma?' });
    expect(within(ask).getByText('Your imports already in the Designer stay.')).toBeTruthy();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Disconnect Figma?' })).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Disconnected from Figma. The token was removed from this server.')).toBeTruthy();
    expect(await within(dialog).findByText('Not connected to Figma.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/designer/figma']);
  });

  it('says when the project’s own token is in use, and offers neither Change token nor Disconnect', async () => {
    figma = { connected: true, source: 'environment', handle: null, network: true, lasting: true };
    await renderHome();
    const dialog = await openFigma();
    expect(within(dialog).getByText("Using the Figma token set in this project's environment.")).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Change token' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(within(dialog).getByLabelText('Link to a Figma frame')).toBeTruthy();
  });

  it('puts the token field back when the token died, and says Figma’s limit with its date', async () => {
    figma = { ...MINE, lasting: false };
    await renderHome();
    const dialog = await openFigma();
    expect(within(dialog).getByText('This server forgets saved copies when it is deployed again, so an import after a deploy reads Figma again.')).toBeTruthy();
    importReply = refusal(422, { reason: 'FIGMA', figma: { kind: 'limit', type: 'low', retryAfterSeconds: 5 * 86400 } });
    const link = within(dialog).getByLabelText('Link to a Figma frame');
    await userEvent.type(link, 'https://www.figma.com/design/AbCdEf0123456789/Shop?node-id=1-2{Enter}');
    expect(await within(dialog).findByText(/^Figma's limit for your seat is used up for now\. You can read again on .+\.$/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);

    importReply = refusal(422, { reason: 'FIGMA', figma: { kind: 'token' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const again = await openFigma();
    await userEvent.type(within(again).getByLabelText('Link to a Figma frame'), 'https://www.figma.com/design/AbCdEf0123456789/Shop?node-id=1-2{Enter}');
    expect(await within(again).findByText('Your Figma token no longer works. Paste a new one.')).toBeTruthy();
    expect(within(again).getByLabelText('Figma token')).toBeTruthy();
    // The box says why the field is there: the "Not connected" line is not drawn beside it.
    expect(within(again).queryByText('Not connected to Figma.')).toBeNull();
  });
});
