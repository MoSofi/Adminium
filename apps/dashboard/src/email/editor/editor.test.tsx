// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor shell (39-email-templates-and-campaigns.md 39-T11 done-when):
 * explicit save (D1) with its chip and history, the discard guard, and the
 * language menu (D3). Rendered through the real router and shell so the
 * topbar's Back and the blocker are the product's own.
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
import type { EmailDocumentDetail, EmailLanguageView } from '../api.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const LANGUAGES: EmailLanguageView[] = [
  { id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false },
  { id: 'et_de', locale: 'de_DE', needsTranslation: false, enabled: true, archived: false },
  { id: 'et_fr', locale: 'fr_FR', needsTranslation: true, enabled: false, archived: false },
  { id: 'et_da', locale: 'da_DK', needsTranslation: false, enabled: true, archived: true },
];

function detail(over: Partial<EmailDocumentDetail> = {}): EmailDocumentDetail {
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
    updatedAt: 1,
    isBuiltin: false,
    isBuiltinCopy: false,
    starter: 'welcome',
    brand: null,
    heading: 'Welcome aboard',
    topicLabel: 'Welcome',
    document: {
      subject: 'Welcome to {{appName}}',
      preheader: '',
      blocks: [{ id: 'b_1', block: 'email.heading', data: { text: 'Welcome aboard' }, style: {} }],
      footer: '',
      brand: null,
      attachments: [],
    },
    vars: ['appName', 'name'],
    languages: LANGUAGES,
    attachmentsResolved: [],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch() {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url === '/api/v1/settings/email') {
      return Promise.resolve(jsonResponse(200, { data: { configured: false, host: null, port: null, user: null, from: null, secure: null, senders: [], maxAttachmentBytes: 1 } }));
    }
    if (url === '/api/v1/email-blocks' && method === 'GET') return Promise.resolve(jsonResponse(200, { blocks: [] }));
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/email-templates' || url.startsWith('/api/v1/email-templates?'))) {
      return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 3, campaign: 0, archived: 0 } }));
    }
    if (url === '/api/v1/email-templates/et_1' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail()));
    }
    if (url === '/api/v1/email-templates/et_1' && method === 'PUT') {
      const put = body as { name: string; document: { subject: string } };
      return Promise.resolve(jsonResponse(200, detail({ name: put.name, subject: put.document.subject })));
    }
    if (url === '/api/v1/email-templates/et_1/languages' && method === 'POST') {
      const input = body as { locale: string };
      return Promise.resolve(jsonResponse(201, detail({ id: 'et_new', locale: input.locale, name: 'Vítejte', needsTranslation: false })));
    }
    if (url === '/api/v1/email-templates/et_new' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail({ id: 'et_new', locale: 'cs_CZ', name: 'Vítejte' })));
    }
    if (url === '/api/v1/email-templates/et_de' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, detail({ id: 'et_de', locale: 'de_DE', name: 'Willkommen' })));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderEditor(path = '/email-templates/et_1') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-editor-header');
  return { ...stub, queryClient, router, user: userEvent.setup() };
}

const nameInput = () => screen.getByTestId('email-editor-name') as HTMLInputElement;
const chip = () => screen.getByTestId('email-save-chip');
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT');

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
});

describe('Editor shell (39-T11)', () => {
  it('typing never issues a request; the chip reads Unsaved changes', async () => {
    const { user, calls } = await renderEditor();
    expect(chip().textContent).toBe('All changes saved');
    const before = calls.length;
    await user.click(nameInput());
    await user.type(nameInput(), ' letter');
    expect(nameInput().value).toBe('Welcome letter');
    expect(chip().textContent).toBe('Unsaved changes');
    // The topbar follows the draft.
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome letter' })).toBeDefined();
    expect(calls.length).toBe(before);
  });

  it('Save → Saving… → All changes saved with one PUT; Ctrl+S saves too', async () => {
    const { user, calls } = await renderEditor();
    await user.click(nameInput());
    await user.type(nameInput(), ' letter');
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    expect(puts(calls)).toHaveLength(1);
    expect(puts(calls)[0]?.url).toBe('/api/v1/email-templates/et_1');
    const body = puts(calls)[0]?.body as { name: string; category: string; enabled: boolean; document: { subject: string; blocks: unknown[] } };
    expect(body.name).toBe('Welcome letter');
    expect(body.category).toBe('lifecycle');
    expect(body.enabled).toBe(true);
    expect(body.document.subject).toBe('Welcome to {{appName}}');
    expect(body.document.blocks).toHaveLength(1);

    await user.type(nameInput(), '!');
    expect(chip().textContent).toBe('Unsaved changes');
    fireEvent.keyDown(nameInput(), { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect(puts(calls)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
  });

  it('Undo restores the previous draft and re-dirties; Redo returns', async () => {
    const { user, calls } = await renderEditor();
    expect(screen.getByTestId('email-undo').hasAttribute('disabled')).toBe(true);
    await user.click(nameInput());
    await user.type(nameInput(), ' letter');
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    await user.click(screen.getByTestId('email-undo'));
    expect(nameInput().value).toBe('Welcome');
    expect(chip().textContent).toBe('Unsaved changes');
    expect(puts(calls)).toHaveLength(1);
    await user.click(screen.getByTestId('email-redo'));
    expect(nameInput().value).toBe('Welcome letter');
    expect(chip().textContent).toBe('All changes saved');
  });

  it('Back with a dirty draft opens the modal; Discard leaves without a request, Keep editing stays', async () => {
    const { user, calls, router } = await renderEditor();
    await user.click(nameInput());
    await user.type(nameInput(), ' letter');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeDefined();
    expect(within(dialog).getByTestId('email-discard-body').textContent).toBe('Your edits to Welcome letter will be lost.');
    await user.click(within(dialog).getByTestId('email-discard-keep'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/email-templates/et_1');
    expect(nameInput().value).toBe('Welcome letter');

    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('email-discard-confirm'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/email-templates');
    });
    expect(puts(calls)).toHaveLength(0);
  });

  it('Back with a clean draft leaves at once', async () => {
    const { user, router } = await renderEditor();
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/email-templates');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the language menu lists every available locale with its status; Add POSTs /languages and opens the reply', async () => {
    const { user, calls, router } = await renderEditor();
    await user.click(screen.getByTestId('email-language-button'));
    const menu = await screen.findByTestId('email-language-menu');
    const rows = within(menu).getAllByTestId('email-language-row');
    expect(rows).toHaveLength(8);
    const byLocale = Object.fromEntries(rows.map((row) => [row.getAttribute('data-locale'), row.getAttribute('data-status')]));
    expect(byLocale['en_US']).toBe('current');
    expect(byLocale['de_DE']).toBe('translated');
    expect(byLocale['fr_FR']).toBe('needsTranslation');
    expect(byLocale['cs_CZ']).toBe('missing');
    // An archived sibling reads as not created (D3).
    expect(byLocale['da_DK']).toBe('missing');
    expect(rows[0]?.getAttribute('data-locale')).toBe('en_US');
    expect(within(rows[0] as HTMLElement).getByText('Editing now')).toBeDefined();
    expect(within(menu).getByText('Translated')).toBeDefined();
    expect(within(menu).getByText('Needs translation')).toBeDefined();
    expect(within(menu).getAllByText('Not created yet').length).toBeGreaterThan(0);

    await user.click(within(menu).getByText('Čeština').closest('button') as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/v1/email-templates/et_1/languages', body: { locale: 'cs_CZ' } },
      ]);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/email-templates/et_new');
    });
    expect(await screen.findByDisplayValue('Vítejte')).toBeDefined();
  });

  it('opening an existing variation navigates to it', async () => {
    const { user, router } = await renderEditor();
    await user.click(screen.getByTestId('email-language-button'));
    const menu = await screen.findByTestId('email-language-menu');
    await user.click(within(menu).getByText('Deutsch').closest('button') as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/email-templates/et_de');
    });
    expect(await screen.findByDisplayValue('Willkommen')).toBeDefined();
  });
});
