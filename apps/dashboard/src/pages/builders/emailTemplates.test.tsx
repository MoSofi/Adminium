/**
 * Email Templates surface tests (M7-T06): the manager lists templates from the
 * EXACT contract paths, the editor loads a detail, and edits autosave through
 * `PUT /api/v1/email-templates/:key/:locale` with the EXACT body shape
 * `{ name, subject, blocks, enabled }`. Fetch mocked like the sibling suites.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { EmailTemplatesPage } from './EmailTemplatesPage.js';

const LIST_ITEM = {
  id: 'emt_1',
  key: 'welcome',
  locale: 'en-US',
  name: 'Welcome email',
  subject: 'Welcome to Adminium 👋',
  enabled: true,
  updatedAt: 1_750_000_000_000,
};

const DETAIL = {
  ...LIST_ITEM,
  blocks: [
    { block: 'block-highlight-box', id: 'hb-1', data: { row: { label: 'Plan', value: 'Team' } } },
    { block: 'block-contact', id: 'c-1' },
  ],
};

interface FetchCall {
  method: string;
  path: string;
  body: unknown;
}

function installFetchMock(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path, body });
      if (method === 'GET' && path === '/api/v1/email-templates') {
        return Promise.resolve(jsonResponse(200, { items: [LIST_ITEM] }));
      }
      if (method === 'GET' && path === '/api/v1/email-templates/welcome/en-US') {
        return Promise.resolve(jsonResponse(200, DETAIL));
      }
      if (method === 'PUT' && path === '/api/v1/email-templates/welcome/en-US') {
        return Promise.resolve(jsonResponse(200, { ...LIST_ITEM, ...(body as object) }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
    }),
  );
  return calls;
}

function renderPage() {
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <EmailTemplatesPage />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('EmailTemplatesPage', () => {
  it('lists templates from GET /api/v1/email-templates', async () => {
    const calls = installFetchMock();
    renderPage();

    expect(await screen.findByTestId('email-template-welcome-en-US')).toBeDefined();
    expect(screen.getByText('Welcome email')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/email-templates' });
  });

  it('opens the editor over the detail blocks and autosaves via the exact PUT contract', async () => {
    const calls = installFetchMock();
    renderPage();

    fireEvent.click(await screen.findByTestId('email-template-welcome-en-US'));

    // Detail fetched from the exact path; canvas renders the mapped doc in the
    // always-light email scope.
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.method === 'GET' && call.path === '/api/v1/email-templates/welcome/en-US',
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      const canvas = document.querySelector('[data-widget="document-canvas"]');
      expect(canvas?.getAttribute('data-doc-type')).toBe('email');
    });
    expect(
      document.querySelector('[data-part="block-instance"][data-block="block-highlight-box"]'),
    ).not.toBeNull();

    // Edit the subject → dirty → (900 ms) → PUT {name, subject, blocks, enabled}.
    fireEvent.change(screen.getByTestId('email-editor-subject'), {
      target: { value: 'Welcome aboard!' },
    });
    await waitFor(
      () => {
        expect(
          calls.some(
            (call) => call.method === 'PUT' && call.path === '/api/v1/email-templates/welcome/en-US',
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const put = calls.find((call) => call.method === 'PUT');
    const body = put?.body as {
      name: string;
      subject: string;
      enabled: boolean;
      blocks: Record<string, unknown>[];
    };
    expect(Object.keys(body).sort()).toEqual(['blocks', 'enabled', 'name', 'subject']);
    expect(body.subject).toBe('Welcome aboard!');
    expect(body.name).toBe('Welcome email');
    expect(body.enabled).toBe(true);
    expect(body.blocks.map((block) => block['block'])).toEqual([
      'block-highlight-box',
      'block-contact',
    ]);
  });

  it('toggling Enabled autosaves the flag through the same PUT', async () => {
    const calls = installFetchMock();
    renderPage();
    fireEvent.click(await screen.findByTestId('email-template-welcome-en-US'));
    await screen.findByTestId('email-editor-enabled');

    fireEvent.click(screen.getByTestId('email-editor-enabled'));
    await waitFor(
      () => {
        expect(calls.some((call) => call.method === 'PUT')).toBe(true);
      },
      { timeout: 4000 },
    );
    expect((calls.find((call) => call.method === 'PUT')?.body as { enabled: boolean }).enabled).toBe(false);
  });
});
