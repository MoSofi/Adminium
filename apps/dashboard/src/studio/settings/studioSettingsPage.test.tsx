/**
 * /studio/settings integration (M5-T05): workspace identity for super admins
 * with the review-then-confirm save modal (changed fields listed, branding
 * PUT), the admin fallback (no settings fetch, danger zone still present),
 * and the danger-zone type-to-confirm connection delete. Router-mounted like
 * the GlobalDefaultsPage suite.
 *
 * The `auth.*` security controls are not surfaced (no auth flow enforces them
 * yet), so there is no security section or /settings/security PUT to assert.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import type { WorkspaceBranding, WorkspaceSettingsData } from './workspaceApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeWorkspace(overrides: Partial<WorkspaceSettingsData> = {}): WorkspaceSettingsData {
  return {
    branding: { appName: 'Adminium', logoUrl: null, showVersion: true },
    ...overrides,
  };
}

function makeConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn_1',
    name: 'Production Postgres',
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
    readOnly: true,
    status: 'connected',
    lastTestedAt: null,
    lastLatencyMs: 42,
    lastError: null,
    lastErrorHint: null,
    snapshot: null,
    tableCount: 14,
    pageCount: 9,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(
  roles: string[],
  connections: ConnectionDto[] = [makeConnection()],
  branding: WorkspaceBranding = makeWorkspace().branding,
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/settings/workspace' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: { branding } }));
    }
    if (url === '/api/v1/settings/branding' && method === 'PUT') {
      const put = body as { appName: string; showVersion: boolean };
      return Promise.resolve(
        jsonResponse(200, {
          data: makeWorkspace({ branding: { ...put, logoUrl: null } }),
        }),
      );
    }
    if (url === '/api/v1/branding' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: branding }));
    }
    if (url.startsWith('/api/v1/branding/logo')) {
      return Promise.resolve(
        jsonResponse(method === 'POST' ? 201 : 200, {
          data: {
            ...branding,
            logoUrl: method === 'DELETE' ? null : '/api/v1/branding/logo?v=file_new',
          },
        }),
      );
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections }));
    }
    if (method === 'DELETE' && url.startsWith('/api/v1/connections/')) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(
  roles: string[] = ['super-admin'],
  connections?: ConnectionDto[],
  branding?: WorkspaceBranding,
) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(roles, connections, branding);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/settings'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient, router };
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

describe('StudioSettingsPage', () => {
  it('renders workspace identity from the workspace payload for a super admin', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Workspace settings' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Workspace identity' })).toBeDefined();
    expect((screen.getByLabelText('Application name') as HTMLInputElement).value).toBe('Adminium');
    // No inert security controls are surfaced.
    expect(screen.queryByRole('switch', { name: 'Require two-factor auth' })).toBeNull();
    expect(screen.queryByLabelText('Session lifetime (hours)')).toBeNull();
    // Pristine form — nothing to save yet.
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
  });

  it('review-then-confirm: lists exactly the changed field, then PUTs branding', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace settings' });

    const nameInput = screen.getByLabelText('Application name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Ops');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Review your changes before saving.')).toBeDefined();
    // Only the dirty field appears in the review list.
    expect(within(dialog).getByText('Adminium → Acme Ops')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');

    const brandingPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'));
    expect(brandingPut?.body).toEqual({ appName: 'Acme Ops', showVersion: true });
    // No security surface is ever hit.
    expect(calls.some((c) => c.url.endsWith('/settings/security'))).toBe(false);
  });

  it('admins get the super-admin notice, no settings fetch, but keep the danger zone', async () => {
    const { fetchMock } = await renderPage(['admin']);
    expect(
      await screen.findByText('Only a super admin can change workspace identity and security settings.'),
    ).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Danger zone' })).toBeDefined();
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/settings/workspace'),
    ).toHaveLength(0);
  });

  it('review-then-confirm covers the version chip too', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace settings' });

    await user.click(screen.getByRole('switch', { name: 'Version in the sidebar' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Shown → Hidden')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'));
    expect(put?.body).toEqual({ appName: 'Adminium', showVersion: false });
  });

  it('stages a picked logo and uploads it only on save', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace identity' });

    const input = document.querySelector('[data-testid="branding-logo-input"]');
    await user.upload(
      input as HTMLInputElement,
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'mark.png', { type: 'image/png' }),
    );

    // Nothing has left the browser yet: a half-finished edit must not already
    // be live on every screen of the app.
    const posted = () => calls.some((c) => c.url.startsWith('/api/v1/branding/logo'));
    expect(posted()).toBe(false);
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    // Bytes have no before → after, so the file's own name is the review row.
    expect(within(dialog).getByText('mark.png')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/api/v1/branding/logo'));
    expect(post?.url).toContain('filename=mark.png');
  });

  it('accepts a dropped image anywhere in the logo row', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Workspace identity' });

    const zone = document.querySelector('[data-part="branding-logo-dropzone"]') as HTMLElement;
    // The whole row is the target, not just the preview square — a drop that
    // lands beside a 44px tile navigates the browser to the image instead.
    expect(zone.contains(screen.getByRole('button', { name: 'Upload logo' }))).toBe(true);
    const file = new File([new Uint8Array([0x89, 0x50])], 'dropped.svg', { type: 'image/svg+xml' });
    // jsdom has no drag session and user-event has no drag API, so the drop is
    // fired with the one thing the handler reads off it.
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(within(await screen.findByRole('dialog')).getByText('dropped.svg')).toBeDefined();
  });

  it('offers Remove only once a logo exists, and DELETEs it on save', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage(['super-admin'], undefined, {
      appName: 'Adminium',
      logoUrl: '/api/v1/branding/logo?v=file_1',
      showVersion: true,
    });
    await screen.findByRole('heading', { name: 'Workspace identity' });
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    // A staged logo cannot be typed back, so there is one explicit way out.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/v1/branding/logo')).toBe(true);
  });

  it('Undo puts a staged logo back and leaves nothing to save', async () => {
    const user = userEvent.setup();
    await renderPage(['super-admin'], undefined, {
      appName: 'Adminium',
      logoUrl: '/api/v1/branding/logo?v=file_1',
      showVersion: true,
    });
    await screen.findByRole('heading', { name: 'Workspace identity' });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
  });

  it('names itself in the topbar, not in the page body', async () => {
    await renderPage();
    const heading = await screen.findByRole('heading', { name: 'Workspace settings' });
    expect(heading.closest('[data-part="topbar"]')).not.toBeNull();
    // The shell falls back to "Home" for any page that publishes no title, so
    // this is what stops the header contradicting the page under it.
    expect(document.querySelector('main')?.querySelectorAll('h1')).toHaveLength(0);
  });

  it('gathers the cross-links into one card with no trailing divider', async () => {
    await renderPage();
    const card = (await screen.findByRole('button', { name: 'Manage pages' })).closest('.divide-y');
    expect(card).not.toBeNull();
    // Every cross-link is a row of that one card…
    for (const cta of ['Open AI settings', 'Open global defaults', 'Open translations']) {
      expect(screen.getByRole('button', { name: cta }).closest('.divide-y')).toBe(card);
    }
    // …and `divide-y` draws its hairlines as top borders on every row but the
    // first, so the last row can never carry one below it — whichever rows the
    // super-admin gate leaves out.
    expect(card?.className).toContain('divide-y');
  });

  it('routes a plain admin to the page manager', async () => {
    // `/studio/pages` is not in the avatar menu, so this card is its only
    // discoverable entry point — if it stops navigating, the whole surface
    // becomes URL-only. Admin, not super-admin: page management is an Admin+
    // capability and the card must not be hidden behind the super-admin gate
    // the identity form sits behind.
    const user = userEvent.setup();
    const { router } = await renderPage(['admin']);
    await user.click(await screen.findByRole('button', { name: 'Manage pages' }));
    expect(router.state.location.pathname).toBe('/studio/pages');
  });

  it('danger zone: type-to-confirm gating before the DELETE fires', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Danger zone' });

    await user.click(screen.getByRole('button', { name: 'Delete connection' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete connection' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.type(within(dialog).getByRole('textbox'), 'Production Postgres');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);

    await screen.findByText('Connection “Production Postgres” deleted');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/v1/connections/conn_1');
    expect(del?.body).toEqual({ confirmName: 'Production Postgres' });
  });

  it('shows the empty danger zone note without connections', async () => {
    await renderPage(['super-admin'], []);
    expect(await screen.findByText('Nothing to delete — no connections yet.')).toBeDefined();
  });
});
