// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The canvas (39-email-templates-and-campaigns.md 39-T12 done-when): every
 * kind's default data draws its family; *Add* above a block opens the picker
 * with the where-line; the device segment narrows the shell; an `ar_EG`
 * variation is `dir="rtl"` inside an LTR page; an image block with a
 * `fileId` and no preview shows the file chip. Rendered through the real
 * router (the editor owns selection, the picker and the mirror flow).
 *
 * The axe pass the done-when names runs in the e2e file against the built
 * canvas (`apps/e2e/tests/email-templates.spec.ts`): happy-dom cannot host
 * axe-core, and the real stylesheet is what a11y contrast rules need.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { createAppRouter } from '../../../app/router.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import type { EmailBlockRecord, EmailDocumentDetail } from '../../api.js';
import { EMAIL_BLOCK_KINDS, EMAIL_BLOCKS, defaultBlockData } from '../../model/blocks.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const ALL_KINDS: EmailBlockRecord[] = EMAIL_BLOCK_KINDS.map((kind, index) => ({
  id: `b_${String(index)}`,
  block: kind,
  data: defaultBlockData(kind),
  style: {},
}));

function detail(over: Partial<EmailDocumentDetail> = {}, blocks: EmailBlockRecord[] = ALL_KINDS): EmailDocumentDetail {
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
    starter: null,
    brand: null,
    heading: 'Section heading',
    topicLabel: 'Welcome',
    document: { subject: 'Welcome to {{appName}}', preheader: '', blocks, footer: 'Sent by {{appName}}', brand: null, attachments: [] },
    vars: ['appName', 'name'],
    languages: [{ id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false }],
    attachmentsResolved: [],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(doc: EmailDocumentDetail) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
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
      if (url === '/api/v1/branding') {
        return Promise.resolve(jsonResponse(200, { data: { appName: 'Northwind', logoUrl: null, showVersion: true } }));
      }
      if (url === `/api/v1/email-templates/${doc.id}` && method === 'GET') return Promise.resolve(jsonResponse(200, doc));
      if (url === '/api/v1/email-blocks') return Promise.resolve(jsonResponse(200, { blocks: [] }));
      if (url === '/api/v1/files/resolve' && method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              f_pdf: {
                id: 'f_pdf',
                filename: 'brochure.pdf',
                mime: 'application/pdf',
                sizeBytes: 1200,
                sha256: 'x',
                kind: 'document',
                destinationId: null,
                uploadedBy: null,
                createdAt: 1,
                attachedAt: 1,
                deletedAt: null,
                connectionId: null,
                entity: null,
                contentPath: '/api/v1/files/f_pdf/content',
              },
              f_gone: null,
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderCanvas(doc: EmailDocumentDetail = detail()) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch(doc);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/email-templates/${doc.id}`] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-mail-shell');
  return { calls, router, user: userEvent.setup() };
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

describe('EmailCanvas (39-T12)', () => {
  it("renders every kind's default data in its family, the chrome, the footer and the variables", async () => {
    await renderCanvas();
    const blocks = screen.getAllByTestId('email-block');
    expect(blocks).toHaveLength(EMAIL_BLOCK_KINDS.length);
    expect(blocks.map((el) => el.getAttribute('data-kind'))).toEqual([...EMAIL_BLOCK_KINDS]);
    // Each block is a named group the keyboard can pick.
    for (const kind of EMAIL_BLOCK_KINDS) {
      expect(screen.getByRole('group', { name: EMAIL_BLOCKS[kind].label })).toBeDefined();
    }
    // A few family markers.
    expect((screen.getByTestId('email-heading-input') as HTMLTextAreaElement).value).toBe('Section heading');
    expect(screen.getByText('Write your copy here.')).toBeDefined();
    expect(screen.getByText('Call to action')).toBeDefined();
    expect(screen.getByText('Rendered as raw HTML when the email is sent.')).toBeDefined();
    expect(screen.getByText('Recurring — Monthly')).toBeDefined();
    expect(screen.getByText('1,240 pts · Gold')).toBeDefined();
    expect(screen.getByText('€266.80')).toBeDefined(); // 290 × 0.92, the comp's money formatter
    expect(screen.getByText('WELCOME10')).toBeDefined();
    expect(screen.getByText('Delivered')).toBeDefined();
    // The chrome, the banner, the footer and the variables row.
    expect(screen.getAllByText('Northwind').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Default sender')).toBeDefined();
    expect(screen.getByTestId('email-footer-text').textContent).toBe('Sent by {{appName}}');
    expect(within(screen.getByTestId('email-variables')).getByText('{{appName}}')).toBeDefined();
    expect((screen.getByTestId('email-subject-input') as HTMLInputElement).value).toBe('Welcome to {{appName}}');
  });

  it('Add above block i opens the picker reading Inserted above {label}; the end button says Added at the end', async () => {
    const { user } = await renderCanvas(detail({}, ALL_KINDS.slice(0, 3)));
    const second = screen.getAllByTestId('email-insert-above')[1] as HTMLElement;
    expect(second.getAttribute('aria-label')).toBe('Insert a section above Text block');
    await user.click(second);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('email-picker-where').textContent).toBe('Inserted above text block');
    expect(within(dialog).getAllByTestId('email-picker-tile')).toHaveLength(24);
    expect(within(dialog).getByTestId('email-picker-content')).toBeDefined();
    expect(within(dialog).getByTestId('email-picker-commerce')).toBeDefined();
    expect(within(dialog).getByTestId('email-picker-legal')).toBeDefined();

    // Picking inserts at the remembered index and selects the new block.
    await user.click(within(dialog).getByRole('button', { name: /^Quote/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const kinds = screen.getAllByTestId('email-block').map((el) => el.getAttribute('data-kind'));
    expect(kinds).toEqual(['email.heading', 'email.quote', 'email.text', 'email.button']);
    expect(screen.getAllByTestId('email-block')[1]?.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('email-save-chip').textContent).toBe('Unsaved changes');

    await user.click(screen.getByTestId('email-add-section'));
    const end = await screen.findByRole('dialog');
    expect(within(end).getByTestId('email-picker-where').textContent).toBe('Added at the end of the email');
    await user.click(within(end).getByRole('button', { name: /^Bulleted list/ }));
    await waitFor(() => {
      expect(screen.getAllByTestId('email-block').map((el) => el.getAttribute('data-kind'))).toEqual([
        'email.heading',
        'email.quote',
        'email.text',
        'email.button',
        'email.list',
      ]);
    });
  });

  it('a structural edit with live siblings asks about mirroring; Apply to all queues the op for the next PUT', async () => {
    const { user, calls } = await renderCanvas(
      detail(
        {
          languages: [
            { id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false },
            { id: 'et_de', locale: 'de_DE', needsTranslation: false, enabled: true, archived: false },
            { id: 'et_fr', locale: 'fr_FR', needsTranslation: true, enabled: false, archived: false },
            { id: 'et_da', locale: 'da_DK', needsTranslation: false, enabled: true, archived: true },
          ],
        },
        ALL_KINDS.slice(0, 2),
      ),
    );
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(jsonResponse(200, detail())));
    await user.click(screen.getByTestId('email-add-section'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Quote/ }));
    const mirror = await screen.findByRole('dialog');
    expect(within(mirror).getByText('Apply to the other languages?')).toBeDefined();
    expect(within(mirror).getByTestId('email-mirror-body').textContent).toBe(
      'Quote added can be mirrored to the 2 other language variations of Welcome. Copy comes across untranslated, when you save.',
    );
    expect(within(mirror).getByRole('button', { name: 'Only English (US)' })).toBeDefined();
    await user.click(within(mirror).getByRole('button', { name: 'Apply to all 2' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // The op rides the save.
    vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      return Promise.resolve(jsonResponse(200, detail()));
    });
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    });
    const put = calls.find((c) => c.method === 'PUT')?.body as { mirrorOps: unknown[]; document: { blocks: unknown[] } };
    expect(put.document.blocks).toHaveLength(3);
    expect(put.mirrorOps).toHaveLength(1);
    expect((put.mirrorOps[0] as { kind: string; index: number }).kind).toBe('insert');
    expect((put.mirrorOps[0] as { kind: string; index: number }).index).toBe(2);
  });

  it('Only {native} keeps the edit local and queues nothing', async () => {
    const { user, calls } = await renderCanvas(
      detail(
        { languages: [{ id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false }, { id: 'et_de', locale: 'de_DE', needsTranslation: false, enabled: true, archived: false }] },
        ALL_KINDS.slice(0, 2),
      ),
    );
    await user.click(screen.getByTestId('email-add-section'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Quote/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Only English (US)' }));
    vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      return Promise.resolve(jsonResponse(200, detail()));
    });
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    });
    const put = calls.find((c) => c.method === 'PUT')?.body as { mirrorOps?: unknown[] };
    expect(put.mirrorOps).toBeUndefined();
  });

  it('mobile toggles the shell to 380; an ar_EG variation renders dir=rtl inside an LTR page', async () => {
    const { user } = await renderCanvas(detail({ id: 'et_ar', locale: 'ar_EG', languages: [{ id: 'et_ar', locale: 'ar_EG', needsTranslation: false, enabled: true, archived: false }] }, ALL_KINDS.slice(0, 2)));
    const shell = screen.getByTestId('email-mail-shell');
    expect(shell.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).not.toBe('rtl');
    expect(shell.getAttribute('data-device')).toBe('desktop');
    expect(shell.className).toContain('max-w-[600px]');
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(shell.getAttribute('data-device')).toBe('mobile');
    expect(shell.className).toContain('max-w-[380px]');
  });

  it('typing the subject and a heading edits the draft with no request; the chrome and footer sections select', async () => {
    const { user, calls } = await renderCanvas(detail({}, ALL_KINDS.slice(0, 2)));
    const before = calls.length;
    const subject = screen.getByTestId('email-subject-input') as HTMLInputElement;
    await user.click(subject);
    await user.type(subject, '!');
    expect(subject.value).toBe('Welcome to {{appName}}!');
    expect(screen.getByTestId('email-section-subject').hasAttribute('data-selected')).toBe(true);
    const heading = screen.getByTestId('email-heading-input') as HTMLTextAreaElement;
    await user.click(heading);
    await user.type(heading, '?');
    expect(heading.value).toBe('Section heading?');
    expect(screen.getAllByTestId('email-block')[0]?.hasAttribute('data-selected')).toBe(true);
    expect(calls.length).toBe(before);
    expect(screen.getByTestId('email-save-chip').textContent).toBe('Unsaved changes');

    await user.click(screen.getByTestId('email-section-footer'));
    expect(screen.getByTestId('email-section-footer').hasAttribute('data-selected')).toBe(true);
    // Undo walks the two field sessions back.
    await user.click(screen.getByTestId('email-undo'));
    expect(heading.value).toBe('Section heading');
    await user.click(screen.getByTestId('email-undo'));
    expect(subject.value).toBe('Welcome to {{appName}}');
  });

  it('an image block shows the picture for a URL, the file chip for a non-image file, and File missing for a trashed one', async () => {
    await renderCanvas(
      detail({}, [
        { id: 'i_url', block: 'email.image', data: { alt: 'Hero', url: 'https://cdn.example.com/hero.png', height: 160 }, style: {} },
        { id: 'i_pdf', block: 'email.image', data: { alt: 'Brochure', url: '', fileId: 'f_pdf', height: 120 }, style: {} },
        { id: 'i_gone', block: 'email.image', data: { alt: 'Old', url: '', fileId: 'f_gone', height: 120 }, style: {} },
        { id: 'i_none', block: 'email.image', data: { alt: '', url: '', height: 120 }, style: {} },
      ]),
    );
    expect(screen.getByRole('img', { name: 'Hero' }).getAttribute('src')).toBe('https://cdn.example.com/hero.png');
    const chips = await screen.findAllByTestId('email-image-file-chip');
    expect(chips.map((el) => el.textContent)).toEqual(['brochure.pdf', 'File missing']);
    expect(screen.getAllByTestId('email-image-placeholder')).toHaveLength(3);
    expect(within(screen.getByTestId('email-mail-shell')).getByText('Image placeholder')).toBeDefined();
  });
});
