// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New modal (39-email-templates-and-campaigns.md 39-T10 done-when): the
 * grid is Blank + the twelve starters, plus *Your templates* in the campaign
 * tray (D21); a pick creates through the API and hands the reply up.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { EmailDocumentDetail, EmailDocumentKind, EmailDocumentSummary, EmailStarterCard } from '../api.js';
import { NewDocumentModal } from './NewDocumentModal.js';

const STARTER_KEYS = [
  'welcome',
  'shipped',
  'receipt',
  'digest',
  'reminder',
  'feature',
  'feedback',
  'paused',
  'monthly',
  'verify',
  'failed',
  'reengage',
];

function starter(key: string): EmailStarterCard {
  return { key, name: `Starter ${key}`, category: 'lifecycle', icon: 'mail', accent: '#4f46e5', heading: `Heading ${key}` };
}

function summary(over: Partial<EmailDocumentSummary> = {}): EmailDocumentSummary {
  return {
    id: 'et_1',
    kind: 'template',
    key: 'welcome',
    locale: 'en_US',
    name: 'Welcome',
    subject: 'Welcome aboard',
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
    ...over,
  };
}

function detail(over: Partial<EmailDocumentSummary> = {}): EmailDocumentDetail {
  return {
    ...summary(over),
    document: { subject: 'Welcome aboard', preheader: '', blocks: [], footer: '', brand: null, attachments: [] },
    vars: [],
    languages: [],
    attachmentsResolved: [],
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(templates: EmailDocumentSummary[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      if (url === '/api/v1/email-templates/starters') {
        return Promise.resolve(jsonResponse(200, { starters: STARTER_KEYS.map(starter) }));
      }
      if (url.startsWith('/api/v1/email-templates?kind=template') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { items: templates, counts: { template: templates.length, campaign: 0, archived: 0 } }));
      }
      if (url === '/api/v1/email-templates' && method === 'POST') {
        const input = body as { kind: EmailDocumentKind; starter: string | null };
        return Promise.resolve(jsonResponse(201, detail({ id: 'et_new', kind: input.kind, starter: input.starter })));
      }
      const from = /^\/api\/v1\/email-templates\/([^/]+)\/from-template$/.exec(url);
      if (from !== null && method === 'POST') {
        return Promise.resolve(jsonResponse(201, detail({ id: 'ec_new', kind: 'campaign', key: 'welcome-2' })));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

function renderModal(kind: EmailDocumentKind, templates: EmailDocumentSummary[] = []) {
  const calls = stubFetch(templates);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <NewDocumentModal kind={kind} onClose={onClose} onCreated={onCreated} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { calls, onCreated, onClose, user: userEvent.setup() };
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

describe('NewDocumentModal', () => {
  it('renders Blank + the twelve starters for a template', async () => {
    renderModal('template');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New template')).toBeDefined();
    expect(within(dialog).getByText('Start blank or from a ready-made email design.')).toBeDefined();
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('email-starter')).toHaveLength(13);
    });
    expect(within(dialog).getByText('Blank email')).toBeDefined();
    expect(within(dialog).queryByText('Your templates')).toBeNull();
  });

  it('adds Your templates — the live ones — for a campaign', async () => {
    renderModal('campaign', [summary(), summary({ id: 'et_2', key: 'receipt', name: 'Receipt' }), summary({ id: 'et_3', archivedAt: 5, name: 'Old' })]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New campaign')).toBeDefined();
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('email-starter')).toHaveLength(13);
    });
    expect(await within(dialog).findByText('Your templates')).toBeDefined();
    expect(within(dialog).getAllByTestId('email-from-template')).toHaveLength(2);
    expect(within(dialog).queryByText('Old')).toBeNull();
  });

  it('picking a starter POSTs { kind, starter } and hands the reply up', async () => {
    const { calls, onCreated, user } = renderModal('template');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getAllByTestId('email-starter')).toHaveLength(13);
    });
    await user.click(dialog.querySelector('[data-starter="welcome"]') as HTMLElement);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ kind: 'template', starter: 'welcome' }]);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect((onCreated.mock.calls[0]?.[0] as EmailDocumentDetail).id).toBe('et_new');
  });

  it('Blank posts a null starter; a template tile starts a campaign from it', async () => {
    const { calls, onCreated, user } = renderModal('campaign', [summary()]);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByText('Blank email'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ kind: 'campaign', starter: null }]);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    await user.click(await within(dialog).findByTestId('email-from-template'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/email-templates/et_1/from-template')).toBe(true);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(2);
    });
    expect((onCreated.mock.calls[1]?.[0] as EmailDocumentDetail).kind).toBe('campaign');
  });
});
