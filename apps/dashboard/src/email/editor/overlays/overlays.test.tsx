// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The overlays: the image picker's Upload POSTs `/files` with the connection and
 * writes the `fileId` to the block; a test send with two addresses POSTs `{ to,
 * document }` and reports *Test sent!* naming the count; a workspace document
 * becomes a fixed attachment. The picker-insert and mirror flows are covered by
 * `canvas.test.tsx`. `XMLHttpRequest` is stubbed because `uploadFile` streams
 * through it (the same seam `files/uploadFilesDialog.test.tsx` uses).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { createAppRouter } from '../../../app/router.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../../test/fixtures.js';
import type { EmailBlockRecord, EmailDocumentDetail } from '../../api.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

class UploadStub extends EventTarget {}

let requests: XhrStub[] = [];

class XhrStub extends EventTarget {
  readonly upload = new UploadStub();
  readonly headers = new Map<string, string>();
  method = '';
  url = '';
  withCredentials = false;
  body: unknown = null;
  status = 0;
  responseText = '';

  constructor() {
    super();
    requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.dispatchEvent(new Event('abort'));
  }

  succeed(): void {
    this.status = 201;
    this.responseText = JSON.stringify({
      data: {
        id: 'file_new',
        filename: 'hero.png',
        mime: 'image/png',
        sizeBytes: 3,
        sha256: 'x',
        kind: 'image',
        destinationId: null,
        uploadedBy: null,
        createdAt: 1,
        attachedAt: 1,
        deletedAt: null,
        connectionId: 'conn_1',
        entity: null,
        contentPath: '/api/v1/files/file_new/content',
      },
    });
    this.dispatchEvent(new Event('load'));
  }
}

const IMAGE: EmailBlockRecord = { id: 'b_img', block: 'email.image', data: { alt: 'Hero', url: '', height: 160 }, style: {} };
const HEADING: EmailBlockRecord = { id: 'b_h', block: 'email.heading', data: { text: 'Hello {{name}}' }, style: {} };

function detail(): EmailDocumentDetail {
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
    heading: 'Hello',
    topicLabel: 'Welcome',
    document: { subject: 'Welcome to {{appName}}', preheader: '', blocks: [HEADING, IMAGE], footer: '', brand: null, attachments: [] },
    vars: ['appName', 'name'],
    languages: [{ id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false }],
    attachmentsResolved: [],
  };
}

const DOCUMENT = {
  id: 'f_doc',
  filename: 'terms.pdf',
  mime: 'application/pdf',
  sizeBytes: 96_000,
  sha256: 'y',
  kind: 'document',
  destinationId: null,
  uploadedBy: null,
  createdAt: 1,
  attachedAt: 1,
  deletedAt: null,
  connectionId: 'conn_1',
  entity: null,
  contentPath: '/api/v1/files/f_doc/content',
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
      }
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: { appName: 'Northwind', logoUrl: null, showVersion: true } }));
      if (url === '/api/v1/settings/email') {
        return Promise.resolve(jsonResponse(200, { data: { configured: true, host: 'smtp', port: 587, user: 'u', from: 'no-reply@x.io', secure: true, senders: [], maxAttachmentBytes: 1 } }));
      }
      if (url === '/api/v1/email-templates/et_1' && method === 'GET') return Promise.resolve(jsonResponse(200, detail()));
      if (url === '/api/v1/email-templates/et_1' && method === 'PUT') return Promise.resolve(jsonResponse(200, detail()));
      if (url === '/api/v1/email-blocks' && method === 'GET') return Promise.resolve(jsonResponse(200, { blocks: [] }));
      if (url === '/api/v1/email-templates/et_1/test-send' && method === 'POST') {
        const input = body as { to: string[] };
        return Promise.resolve(jsonResponse(202, { queued: input.to.length, locale: 'en_US' }));
      }
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve(
          jsonResponse(200, {
            users: [
              { id: 'usr_test', email: 'ava@adminium.io', name: 'Ava Reyes', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 1, updatedAt: 1 },
              { id: 'usr_2', email: 'kim@northwind.io', name: 'Kim Park', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 1, updatedAt: 1 },
              { id: 'usr_3', email: 'lee@northwind.io', name: 'Lee Chen', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 1, updatedAt: 1 },
            ],
            nextCursor: null,
            counts: { active: 3, invited: 0, suspended: 0 },
          }),
        );
      }
      if (url === '/api/v1/connections') return Promise.resolve(jsonResponse(200, { connections: [{ id: 'conn_1', name: 'Production' }] }));
      if (url.startsWith('/api/v1/files?')) return Promise.resolve(jsonResponse(200, { data: [DOCUMENT], nextCursor: null }));
      if (url === '/api/v1/files/resolve' && method === 'POST') {
        const input = body as { refs: string[] };
        const data: Record<string, unknown> = {};
        for (const ref of input.refs) data[ref] = ref === 'file_new' ? { ...DOCUMENT, id: 'file_new', filename: 'hero.png', mime: 'image/png', contentPath: '/api/v1/files/file_new/content' } : null;
        return Promise.resolve(jsonResponse(200, { data }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderEditor() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/email-templates/et_1'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-inspector');
  return { calls, user: userEvent.setup() };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  requests = [];
  vi.stubGlobal('XMLHttpRequest', XhrStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Overlays', () => {
  it('image Upload issues POST /files with the connection and writes fileId to the block', async () => {
    const { user, calls } = await renderEditor();
    await user.click(screen.getAllByTestId('email-block')[1] as HTMLElement);
    await user.click(await screen.findByTestId('email-choose-image'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Choose an image')).toBeDefined();
    await user.click(within(dialog).getByRole('tab', { name: /Upload/ }));
    const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
    fireEvent.change(await within(dialog).findByTestId('email-image-upload'), { target: { files: [file] } });
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const xhr = requests[0] as XhrStub;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/v1/files?');
    expect(xhr.url).toContain('connectionId=conn_1');
    xhr.succeed();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // The block now references the library file; the canvas resolves it and shows the picture.
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/files/resolve' && (c.body as { refs: string[] }).refs.includes('file_new'))).toBe(true);
    });
    expect((await screen.findByRole('img', { name: 'hero' })).getAttribute('src')).toBe('/api/v1/files/file_new/content');
    expect(screen.getByTestId('email-save-chip').textContent).toBe('Unsaved changes');
    // The URL row is https-only.
    await user.click(screen.getByTestId('email-choose-image'));
    const again = await screen.findByRole('dialog');
    await user.type(within(again).getByTestId('email-image-url'), 'http://cdn.example.com/a.png');
    expect(within(again).getByTestId('email-image-use-url').hasAttribute('disabled')).toBe(true);
    await user.clear(within(again).getByTestId('email-image-url'));
    await user.type(within(again).getByTestId('email-image-url'), 'https://cdn.example.com/a.png');
    await user.click(within(again).getByTestId('email-image-use-url'));
    // A URL pick keeps the alt the upload set ("hero", from the filename).
    expect((await screen.findByRole('img', { name: 'hero' })).getAttribute('src')).toBe('https://cdn.example.com/a.png');
  });

  it('a test send with two addresses POSTs { to: [2], document } and shows Test sent! naming 2 recipients', async () => {
    const { user, calls } = await renderEditor();
    // The on-screen document travels: edit the heading first, never save.
    const heading = screen.getByTestId('email-heading-input');
    await user.click(heading);
    await user.type(heading, '!');
    await user.click(screen.getByTestId('email-test'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Send test email')).toBeDefined();
    expect(within(dialog).getByText('Variables like {{appName}} are filled with sample data in test sends.')).toBeDefined();
    // Teammates: the two other active users (never the caller).
    const teammates = within(dialog).getAllByTestId('email-test-teammate');
    // Each chip is an avatar (initials) plus the name.
    expect(teammates.map((el) => el.textContent?.replace(/^[A-Z]{1,2}/, ''))).toEqual(['Kim Park', 'Lee Chen']);
    expect(within(dialog).getByTestId('email-test-send').hasAttribute('disabled')).toBe(true);

    const input = within(dialog).getByPlaceholderText('name@company.com, …');
    await user.type(input, 'a@example.com,');
    await user.click(teammates[0] as HTMLElement);
    expect(within(dialog).getByTestId('email-test-count').textContent).toBe('2 recipients');
    await user.click(within(dialog).getByTestId('email-test-send'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/email-templates/et_1/test-send')).toHaveLength(1);
    });
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/test-send'))?.body as { to: string[]; document: { blocks: { data: { text?: string } }[] } };
    expect(post.to).toEqual(['a@example.com', 'kim@northwind.io']);
    expect(post.document.blocks[0]?.data.text).toBe('Hello {{name}}!');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(await screen.findByText('Test sent!')).toBeDefined();
    expect(screen.getByText('Your test of Welcome is on its way to 2 recipients.')).toBeDefined();
    await user.click(screen.getByTestId('email-test-again'));
    expect(await within(await screen.findByRole('dialog')).findByTestId('email-test-count')).toHaveProperty('textContent', '0 recipients');
  });

  it('a workspace document becomes a fixed attachment and the canvas shows the card', async () => {
    const { user, calls } = await renderEditor();
    await user.click(screen.getAllByTestId('email-pinned-row')[2] as HTMLElement);
    await screen.findByTestId('email-attachments-panel');
    await user.click(await screen.findByTestId('email-workspace-document'));
    expect(await screen.findByText('terms.pdf attached')).toBeDefined();
    expect(screen.getAllByTestId('email-attachment-row')).toHaveLength(1);
    expect(screen.getByTestId('email-section-attachments')).toBeDefined();
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    });
    const put = calls.find((c) => c.method === 'PUT')?.body as { document: { attachments: { kind: string; fileId?: string }[] } };
    expect(put.document.attachments).toEqual([{ id: expect.any(String), kind: 'file', fileId: 'f_doc' }]);
  });
});
