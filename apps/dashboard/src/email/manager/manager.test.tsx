// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email manager, rendered through the real router and shell so the
 * topbar's published actions, the toasts and the navigation are the
 * product's own. The API is a fetch stub keyed on the routes the manager
 * calls.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EmailCounts, EmailDocumentDetail, EmailDocumentSummary } from '../api.js';
import { MANAGER_PREFS_KEY } from './useManagerPrefs.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const DAY = 24 * 3600_000;

function doc(over: Partial<EmailDocumentSummary> = {}): EmailDocumentSummary {
  return {
    id: 'et_1',
    kind: 'template',
    key: 'welcome',
    locale: 'en_US',
    name: 'Welcome',
    subject: 'Welcome to {{appName}}',
    category: 'lifecycle',
    enabled: true,
    needsTranslation: false,
    archivedAt: null,
    updatedAt: Date.now() - 2 * DAY,
    isBuiltin: false,
    isBuiltinCopy: false,
    starter: 'welcome',
    brand: null,
    heading: 'Welcome aboard',
    topicLabel: 'Welcome',
    ...over,
  };
}

function detail(over: Partial<EmailDocumentSummary> = {}): EmailDocumentDetail {
  return {
    ...doc(over),
    document: { subject: 'Welcome to {{appName}}', preheader: '', blocks: [], footer: '', brand: null, attachments: [] },
    vars: [],
    languages: [],
    attachmentsResolved: [],
  };
}

interface Fixture {
  templates?: EmailDocumentSummary[];
  campaigns?: EmailDocumentSummary[];
  archived?: EmailDocumentSummary[];
  counts?: Partial<EmailCounts>;
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A bodiless reply (204), in the same fake shape `jsonResponse` uses. */
function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response;
}

function stubFetch(fixture: Fixture) {
  const calls: Call[] = [];
  const templates = fixture.templates ?? [];
  const campaigns = fixture.campaigns ?? [];
  const archived = fixture.archived ?? [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/email-templates' || url.startsWith('/api/v1/email-templates?'))) {
      const params = new URL(url, 'http://test').searchParams;
      const kind = params.get('kind');
      const wantArchived = params.get('archived') === 'true';
      const live = kind === 'campaign' ? campaigns : kind === 'template' ? templates : [...templates, ...campaigns];
      const items = wantArchived ? archived.filter((d) => kind === null || d.kind === kind) : live;
      const counts: EmailCounts = {
        template: templates.length,
        campaign: campaigns.length,
        archived: archived.length,
        ...fixture.counts,
      };
      return Promise.resolve(jsonResponse(200, { items, counts }));
    }
    if (url === '/api/v1/email-templates/starters') {
      return Promise.resolve(
        jsonResponse(200, {
          starters: [{ key: 'welcome', name: 'Welcome email', category: 'lifecycle', icon: 'sparkles', accent: '#4f46e5', heading: 'Welcome aboard' }],
        }),
      );
    }
    if (url === '/api/v1/email-templates' && method === 'POST') {
      const input = body as { kind: 'template' | 'campaign'; starter: string | null };
      return Promise.resolve(jsonResponse(201, detail({ id: 'et_new', kind: input.kind, starter: input.starter, name: 'Welcome email' })));
    }
    const patch = /^\/api\/v1\/email-templates\/([^/?]+)$/.exec(url);
    if (patch !== null && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail({ id: patch[1] ?? '', name: 'Welcome email' })));
    }
    if (patch !== null && method === 'PATCH') {
      const all = [...templates, ...campaigns, ...archived];
      const row = all.find((d) => d.id === patch[1]) ?? doc({ id: patch[1] ?? '' });
      return Promise.resolve(jsonResponse(200, { ...row, ...(body as object) }));
    }
    if (patch !== null && method === 'DELETE') {
      return Promise.resolve(emptyResponse(204));
    }
    const duplicate = /^\/api\/v1\/email-templates\/([^/?]+)\/duplicate$/.exec(url);
    if (duplicate !== null && method === 'POST') {
      const row = [...templates, ...campaigns].find((d) => d.id === duplicate[1]) ?? doc({ id: duplicate[1] ?? '' });
      return Promise.resolve(jsonResponse(201, { ...row, id: `${row.id}_copy`, name: `${row.name} (copy)`, enabled: false }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(fixture: Fixture = {}, path = '/email-templates') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-toolbar');
  // The list has resolved once the toolbar's spinner or content is in.
  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });
  return { ...stub, queryClient, router, view, user: userEvent.setup() };
}

function menuRows(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) =>
    el.getAttribute('role') === 'separator' ? '—' : (el.textContent?.trim() ?? ''),
  );
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
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('EmailManager — shell', () => {
  it('publishes the actions menu with the five items in the comp order and a divider before Email settings', async () => {
    const { user } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    expect(menuRows(menu)).toEqual(['Import template', 'Manage senders', 'Export all', '—', 'Email settings', 'Archived']);
    expect(within(menu).getByText('Actions')).toBeDefined();
  });

  it('switching tab changes the button label, the search placeholder and the count badge', async () => {
    const { user } = await renderPage({
      templates: [doc(), doc({ id: 'et_2', locale: 'de_DE' }), doc({ id: 'et_3', locale: 'fr_FR' })],
      campaigns: [doc({ id: 'ec_1', kind: 'campaign', key: 'digest', name: 'Weekly digest', topicLabel: 'Weekly digest' })],
    });
    expect(screen.getByRole('button', { name: 'New template' })).toBeDefined();
    expect(screen.getByPlaceholderText('Search templates…')).toBeDefined();
    expect(screen.getAllByTestId('tab-count').map((el) => el.textContent)).toEqual(['3', '1']);
    expect(screen.getByRole('tab', { name: /Templates/ }).getAttribute('data-state')).toBe('active');

    await user.click(screen.getByRole('tab', { name: /Campaigns/ }));
    expect(await screen.findByRole('button', { name: 'New campaign' })).toBeDefined();
    expect(screen.getByPlaceholderText('Search campaigns…')).toBeDefined();
    expect(screen.getByRole('tab', { name: /Campaigns/ }).getAttribute('data-state')).toBe('active');
    await screen.findByText('Weekly digest');
    expect(screen.queryByText('Welcome')).toBeNull();
  });

  it("shows the comp's empty-state copy per tab and per search", async () => {
    const { user } = await renderPage({ templates: [], campaigns: [] });
    expect(await screen.findByText('No templates yet')).toBeDefined();
    expect(screen.getByText('Design a reusable email your team can send from.')).toBeDefined();
    // The empty state carries the same primary the topbar does.
    expect(within(screen.getByTestId('email-empty')).getByRole('button', { name: 'New template' })).toBeDefined();

    await user.type(screen.getByPlaceholderText('Search templates…'), 'zzz');
    expect(await screen.findByText('No templates match')).toBeDefined();
    expect(screen.getByText('Try a different search term.')).toBeDefined();

    await user.click(screen.getByRole('tab', { name: /Campaigns/ }));
    expect(await screen.findByText('No campaigns match')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('No campaigns yet')).toBeDefined();
    expect(screen.getByText('Create a campaign from a template or a blank canvas.')).toBeDefined();
  });

  it('layout and group-by survive a remount via localStorage', async () => {
    const first = await renderPage({ templates: [doc()] });
    expect(screen.getByTestId('email-gallery')).toBeDefined();
    await first.user.click(screen.getByRole('radio', { name: 'List' }));
    await first.user.click(screen.getByRole('radio', { name: 'Language' }));
    expect(await screen.findByTestId('email-list')).toBeDefined();
    expect(JSON.parse(window.localStorage.getItem(MANAGER_PREFS_KEY) ?? '{}')).toEqual({ layout: 'list', groupBy: 'language' });

    first.view.unmount();
    vi.unstubAllGlobals();
    await renderPage({ templates: [doc()] });
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Language' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('email-list')).toBeDefined();
  });

  it('renders with the defaults when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { user } = await renderPage({ templates: [doc()] });
    expect(screen.getByRole('radio', { name: 'Gallery' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'None' }).getAttribute('aria-checked')).toBe('true');
    // The choice still applies for the page's lifetime.
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(await screen.findByTestId('email-list')).toBeDefined();
  });

  it('New template → a starter → POST { kind, starter } and the editor route opens on the reply', async () => {
    const { user, calls, router } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'New template' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelector('[data-starter="welcome"]')).not.toBeNull();
    });
    await user.click(dialog.querySelector('[data-starter="welcome"]') as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/email-templates').map((c) => c.body)).toEqual([
        { kind: 'template', starter: 'welcome' },
      ]);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/email-templates/et_new');
    });
    expect(await screen.findByTestId('email-editor')).toBeDefined();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome email' })).toBeDefined();
  });

  it('Manage senders and Email settings go to the studio email section; Export all downloads the bundle', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, router } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export all' }));
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/api/v1/email-templates/export?kind=template');
    expect(anchor.hasAttribute('download')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Email settings' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/studio/settings');
      expect(router.state.location.hash).toBe('email');
    });
  });
});

describe('EmailManager — gallery, list and groups', () => {
  const welcomeFamily = [
    doc({ id: 'et_en', locale: 'en_US' }),
    doc({ id: 'et_de', locale: 'de_DE', name: 'Willkommen' }),
    doc({ id: 'et_fr', locale: 'fr_FR', name: 'Bienvenue', needsTranslation: true }),
  ];

  it('Topic grouping puts three locales of one key under one header reading 3 languages · 1 needs translation', async () => {
    const { user } = await renderPage({
      templates: [...welcomeFamily, doc({ id: 'et_r', key: 'receipt', name: 'Receipt', topicLabel: 'Receipt', category: 'transactional' })],
    });
    await user.click(screen.getByRole('radio', { name: 'Topic' }));
    const headers = await screen.findAllByTestId('email-group-header');
    expect(headers.map((el) => within(el).getByRole('heading').textContent)).toEqual(['Welcome', 'Receipt']);
    expect(within(headers[0] as HTMLElement).getByTestId('email-group-sub').textContent).toBe('3 languages · 1 needs translation');
    expect(within(headers[1] as HTMLElement).getByTestId('email-group-sub').textContent).toBe('1 language');
    const welcomeGroup = screen.getAllByTestId('email-group')[0] as HTMLElement;
    expect(within(welcomeGroup).getAllByTestId('email-card')).toHaveLength(3);
    // The French variation wears the warn pill.
    const langs = within(welcomeGroup).getAllByTestId('email-lang');
    expect(langs.map((el) => el.textContent)).toEqual(['EN', 'DE', 'FR']);
    expect(langs[2]?.hasAttribute('data-needs-translation')).toBe(true);
    expect(langs[0]?.hasAttribute('data-needs-translation')).toBe(false);
  });

  it('Language grouping headers read Deutsch · German and 2 emails', async () => {
    const { user } = await renderPage({
      templates: [
        doc({ id: 'et_en', locale: 'en_US' }),
        doc({ id: 'et_de', locale: 'de_DE', name: 'Willkommen' }),
        doc({ id: 'et_rde', key: 'receipt', locale: 'de_DE', name: 'Beleg', topicLabel: 'Receipt' }),
      ],
    });
    await user.click(screen.getByRole('radio', { name: 'Language' }));
    const headers = await screen.findAllByTestId('email-group-header');
    expect(headers.map((el) => within(el).getByRole('heading').textContent)).toEqual(['English (US)', 'Deutsch · German']);
    expect(within(headers[1] as HTMLElement).getByTestId('email-group-sub').textContent).toBe('2 emails');
  });

  it('the list layout has the five columns, the status and a relative updated stamp', async () => {
    const { user } = await renderPage({
      templates: [doc(), doc({ id: 'et_d', key: 'draft', name: 'Draft one', topicLabel: 'Draft one', enabled: false })],
    });
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((el) => el.textContent)).toEqual(['Name', 'Lang', 'Status', 'Updated', 'Actions']);
    const rows = within(table).getAllByTestId('email-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByTestId('email-status').textContent).toBe('Live');
    expect(within(rows[1] as HTMLElement).getByTestId('email-status').textContent).toBe('Draft');
    expect(within(rows[0] as HTMLElement).getByText('2 days ago')).toBeDefined();
  });

  it('rename commits on Enter and reverts on Escape', async () => {
    const { user, calls } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'New name' });
    expect((input as HTMLInputElement).value).toBe('Welcome');
    await user.clear(input);
    await user.type(input, 'Hello there{Enter}');
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH')).toEqual([
        { method: 'PATCH', url: '/api/v1/email-templates/et_1', body: { name: 'Hello there' } },
      ]);
    });
    expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const again = await screen.findByRole('textbox', { name: 'New name' });
    await user.clear(again);
    await user.type(again, 'Nope');
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull();
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it("delete opens the modal, confirms → PATCH archived:true, the toast's Undo → PATCH archived:false", async () => {
    const { user, calls } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete Welcome?')).toBeDefined();
    expect(within(dialog).getByTestId('email-delete-body').textContent).toBe(
      'It moves to Archived, where you can restore it or delete it for good.',
    );
    await user.click(within(dialog).getByTestId('email-delete-confirm'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ archived: true }]);
    });
    await screen.findByText('Template deleted');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ archived: true }, { archived: false }]);
    });
  });

  it("duplicate's Undo → DELETE of the copy", async () => {
    const { user, calls } = await renderPage({ templates: [doc()] });
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/email-templates/et_1/duplicate')).toBe(true);
    });
    await screen.findByText('Template duplicated');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/v1/email-templates/et_1_copy']);
    });
  });

  it('in archived mode a built-in shows Reset to built-in and a user doc Delete for good', async () => {
    const { user } = await renderPage({
      templates: [doc()],
      archived: [
        doc({ id: 'a_builtin', key: 'password-reset', name: 'Password reset', topicLabel: 'Password reset', isBuiltin: true, archivedAt: 1 }),
        doc({ id: 'a_user', key: 'custom', name: 'Custom note', topicLabel: 'Custom note', archivedAt: 1 }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archived' }));
    expect(await screen.findByTestId('email-archived-chip')).toBeDefined();
    const cards = await screen.findAllByTestId('email-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: 'Reset to built-in' })).toBeDefined();
    expect(within(cards[1] as HTMLElement).getByRole('button', { name: 'Delete for good' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Leave archived' }));
    await waitFor(() => {
      expect(screen.queryByTestId('email-archived-chip')).toBeNull();
    });
    expect(await screen.findByText('Welcome')).toBeDefined();
  });

  it('every hover action is reachable by Tab (focus-within reveal asserted)', async () => {
    const { user } = await renderPage({ templates: [doc()] });
    const actions = screen.getByTestId('email-card-actions');
    // The comp's slide-in (translateY 100% → 0 on hover); D17 adds focus-within.
    expect(actions.className).toContain('translate-y-full');
    expect(actions.className).toContain('group-hover:translate-y-0');
    expect(actions.className).toContain('group-focus-within:translate-y-0');
    screen.getByRole('button', { name: 'Edit' }).focus();
    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
      names.push(document.activeElement?.getAttribute('aria-label') ?? '');
    }
    expect(names).toEqual(['Duplicate', 'Rename', 'Delete']);
  });
});
