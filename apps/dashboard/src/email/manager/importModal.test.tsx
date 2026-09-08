// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Import modal (39-email-templates-and-campaigns.md 39-T10 done-when,
 * D14): a bundle's preview counts the kinds and the (key, locale) pairs that
 * already exist, and Replace posts `mode: 'replace'`.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { EmailDocumentSummary } from '../api.js';
import { ImportModal, parseBundle } from './ImportModal.js';

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
    starter: null,
    brand: null,
    heading: 'Welcome aboard',
    topicLabel: 'Welcome',
    ...over,
  };
}

const BUNDLE = {
  adminium: { kind: 'email-templates', version: 1 },
  documents: [
    { kind: 'template', key: 'welcome', locale: 'en_US', name: 'Welcome' },
    { kind: 'template', key: 'welcome', locale: 'de_DE', name: 'Willkommen' },
    { kind: 'campaign', key: 'digest', locale: 'en_US', name: 'Digest' },
  ],
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(existing: EmailDocumentSummary[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      if (url === '/api/v1/email-templates' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { items: existing, counts: { template: existing.length, campaign: 0, archived: 0 } }));
      }
      if (url === '/api/v1/email-templates/import' && method === 'POST') {
        return Promise.resolve(jsonResponse(200, { created: 1, replaced: 2, skipped: 0, errors: [] }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

function renderModal(existing: EmailDocumentSummary[] = []) {
  const calls = stubFetch(existing);
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ImportModal onClose={onClose} onImported={onImported} />
    </QueryClientProvider>,
  );
  return { calls, onImported, onClose, user: userEvent.setup() };
}

function chooseFile(contents: string, name = 'adminium-email-templates-2026-09-06.json'): void {
  const file = new File([contents], name, { type: 'application/json' });
  fireEvent.change(screen.getByTestId('email-import-file'), { target: { files: [file] } });
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

describe('parseBundle', () => {
  it('accepts a v1 bundle and refuses anything else', () => {
    expect(parseBundle(JSON.stringify(BUNDLE))?.documents).toHaveLength(3);
    expect(parseBundle('{"nope":1}')).toBeNull();
    expect(parseBundle('not json')).toBeNull();
    expect(parseBundle(JSON.stringify({ adminium: { kind: 'email-templates', version: 2 }, documents: [] }))).toBeNull();
    expect(parseBundle(JSON.stringify({ adminium: { kind: 'email-templates', version: 1 }, documents: [{ kind: 'template' }] }))).toBeNull();
  });
});

describe('ImportModal', () => {
  it('previews the bundle — 2 already exist — and Replace posts mode: replace', async () => {
    const { calls, onImported, user } = renderModal([summary(), summary({ id: 'et_2', locale: 'de_DE' })]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);

    chooseFile(JSON.stringify(BUNDLE));
    expect((await within(dialog).findByTestId('email-import-summary')).textContent).toBe('2 templates and 1 campaign · 2 already exist');
    expect(within(dialog).getByRole('radio', { name: 'Skip existing' }).getAttribute('aria-checked')).toBe('true');

    await user.click(within(dialog).getByRole('radio', { name: 'Replace existing' }));
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/v1/email-templates/import', body: { bundle: BUNDLE, mode: 'replace' } },
      ]);
    });
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({ created: 1, replaced: 2, skipped: 0, errors: [] });
    });
  });

  it('refuses a file that is not a bundle', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');
    chooseFile('{"nope":1}', 'notes.json');
    expect(await within(dialog).findByTestId('email-import-invalid')).toBeDefined();
    expect(within(dialog).getByText('That file is not an Adminium email bundle.')).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).queryByTestId('email-import-summary')).toBeNull();
  });
});
