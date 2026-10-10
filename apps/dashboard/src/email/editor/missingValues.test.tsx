// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A value that is missing, in the editor (comp `Milo Automations`, 7a and 7b):
 * a placeholder is a chip that asks what to write when its value is missing;
 * a block can be tied to a value, with other words in its place; the preview
 * can be looked at as a reader with no values is sent it; and Save sends all
 * of it. Rendered through the real router, as the editor's other tests are.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EmailBlockRecord, EmailDocumentDetail, EmailSavedBlock } from '../api.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const BLOCKS: EmailBlockRecord[] = [
  { id: 'greet', block: 'email.text', data: { paras: ['Thanks, {{first_name}}!', 'See you in {{city|your town}}.'] }, style: {} },
  { id: 'track', block: 'email.button', data: { label: 'Track your order', url: '{{track_url}}' }, style: {} },
  { id: 'plain', block: 'email.text', data: { paras: ['Your order arrived.'] }, style: {} },
];

function detail(over: Partial<EmailDocumentDetail> = {}, blocks: EmailBlockRecord[] = BLOCKS): EmailDocumentDetail {
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
    vars: ['appName', 'first_name'],
    languages: [
      { id: 'et_1', locale: 'en_US', needsTranslation: false, enabled: true, archived: false },
      { id: 'et_de', locale: 'de_DE', needsTranslation: false, enabled: true, archived: false },
    ],
    attachmentsResolved: [],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(doc: EmailDocumentDetail, senders: { name: string; address: string }[] = []) {
  const calls: Call[] = [];
  const saved: EmailSavedBlock[] = [];
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
        return Promise.resolve(jsonResponse(200, { data: { configured: true, host: 'smtp', port: 587, user: 'u', from: 'no-reply@x.io', secure: true, senders, maxAttachmentBytes: 1 } }));
      }
      if (url === `/api/v1/email-templates/${doc.id}` && method === 'GET') return Promise.resolve(jsonResponse(200, doc));
      if (url === `/api/v1/email-templates/${doc.id}` && method === 'PUT') return Promise.resolve(jsonResponse(200, doc));
      if (url === '/api/v1/email-blocks' && method === 'GET') return Promise.resolve(jsonResponse(200, { blocks: [...saved] }));
      if (url === '/api/v1/email-blocks' && method === 'POST') {
        const input = body as { name: string; block: Record<string, unknown> };
        const entry: EmailSavedBlock = { id: `ebk_${String(saved.length + 1)}`, name: input.name, block: input.block, createdAt: 1 };
        saved.push(entry);
        return Promise.resolve(jsonResponse(201, { block: entry }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderEditor(doc: EmailDocumentDetail = detail(), senders: { name: string; address: string }[] = []) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch(doc, senders);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/email-templates/${doc.id}`] }) });
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
afterEach(() => {
  vi.unstubAllGlobals();
});

const block = (id: string) => screen.getByTestId('email-canvas').querySelector(`[data-block-id="${id}"]`) as HTMLElement;
const put = (calls: Call[]) => calls.filter((call) => call.method === 'PUT').at(-1)?.body as { document: { blocks: EmailBlockRecord[] } } | undefined;

describe('a value that is missing, in the editor', () => {
  it('a placeholder is a chip; its dialog asks for the backup, shows the sentence with it, and Escape gives the focus back', async () => {
    const { user } = await renderEditor();
    const chips = within(block('greet')).getAllByTestId('email-placeholder-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['{{first_name}}', '{{city}}']);
    await user.click(chips[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Backup text for first_name' });
    expect(within(dialog).getByLabelText('If there is no first name, write:')).toBeDefined();
    await user.type(within(dialog).getByTestId('email-backup-input'), 'there');
    expect(within(dialog).getByTestId('email-backup-preview').textContent).toBe('Thanks, there!');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backup text for first_name' })).toBeNull());
    const chip = within(block('greet')).getAllByTestId('email-placeholder-chip')[0] as HTMLElement;
    expect(document.activeElement).toBe(chip);
    expect(chip.getAttribute('aria-label')).toBe('first_name: when it is missing, “there” is written');
    // The chip selected its block, and the inspector says the same under the text.
    expect(within(screen.getByTestId('email-block-panel')).getByTestId('email-backup-lines').textContent).toContain('there');
    expect(within(screen.getByTestId('email-block-panel')).getByTestId('email-backup-lines').textContent).toContain('your town');
  });

  it('a block is tied to a value, a text with other words in its place; a button is only left out; untying takes the words with it', async () => {
    const { user, calls } = await renderEditor();
    await user.click(block('greet'));
    const panel = () => screen.getByTestId('email-block-panel');
    expect(within(panel()).queryByTestId('email-otherwise')).toBeNull();
    // What it can be tied to: the document's variables and what the block itself reads.
    expect([...(within(panel()).getByTestId('email-show-when') as HTMLSelectElement).options].map((option) => option.value)).toEqual(['', 'appName', 'first_name', 'city']);
    await user.selectOptions(within(panel()).getByTestId('email-show-when'), 'first_name');
    await user.type(within(panel()).getByTestId('email-otherwise'), 'Thanks for ordering!');
    await user.click(screen.getByTestId('email-design-back'));
    await user.click(block('track'));
    await user.selectOptions(within(panel()).getByTestId('email-show-when'), 'track_url');
    expect(within(panel()).queryByTestId('email-otherwise')).toBeNull();
    expect(panel().textContent).toContain('When it has none, this block is left out of the email.');
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => expect(put(calls)).toBeDefined());
    const sent = Object.fromEntries(put(calls)!.document.blocks.map((one) => [one.id, one]));
    expect(sent['greet']).toMatchObject({ showWhen: { var: 'first_name' }, otherwise: 'Thanks for ordering!' });
    expect(sent['track']).toMatchObject({ showWhen: { var: 'track_url' } });
    expect(sent['track']!.otherwise).toBeUndefined();
    expect(sent['plain']!.showWhen).toBeUndefined();
    // Shown always again: the tie and its words are gone.
    await user.click(screen.getByTestId('email-design-back'));
    await user.click(block('greet'));
    await user.selectOptions(within(panel()).getByTestId('email-show-when'), '');
    await user.click(screen.getByTestId('email-save'));
    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2));
    const again = put(calls)!.document.blocks.find((one) => one.id === 'greet')!;
    expect(again.showWhen).toBeUndefined();
    expect(again.otherwise).toBeUndefined();
  });

  it('the preview with missing values draws what a reader with no values is sent, and says whose email it is', async () => {
    const tied: EmailBlockRecord[] = [
      { ...(BLOCKS[0] as EmailBlockRecord), showWhen: { var: 'first_name' }, otherwise: 'Thanks for ordering from our kitchen!' },
      { ...(BLOCKS[1] as EmailBlockRecord), showWhen: { var: 'track_url' } },
      { id: 'city', block: 'email.text', data: { paras: ['See you in {{city|your town}}, {{unknown}}.'] }, style: {} },
    ];
    const { user } = await renderEditor(detail({ subject: 'For {{first_name|you}}', document: { subject: 'For {{first_name|you}}', preheader: '', blocks: tied, footer: 'Sent by {{appName}}', brand: null, attachments: [] } }, tied));
    expect(screen.queryByTestId('email-missing-status')).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Preview with missing values' }));
    expect(screen.getByTestId('email-missing-status').textContent).toBe('Showing what a reader is sent when these have no value: first name, city, track url.');
    expect(screen.getByTestId('email-subject-text').textContent).toBe('For you');
    // The text tied to a first name says its other words, and is marked as that; the button is gone.
    expect(block('greet').textContent).toContain('Thanks for ordering from our kitchen!');
    expect(block('greet').textContent).toContain('Otherwise text');
    expect(block('greet').hasAttribute('data-otherwise')).toBe(true);
    expect(block('track')).toBeNull();
    // A backup is written in its sentence; a name with none is left as written. Nothing here is operated.
    expect(block('city').textContent).toBe('See you in your town, {{unknown}}.');
    expect(screen.queryByTestId('email-placeholder-chip')).toBeNull();
    expect(screen.queryByTestId('email-add-section')).toBeNull();
    // Off again: the document as it is written.
    await user.click(screen.getByRole('switch', { name: 'Preview with missing values' }));
    expect(screen.queryByTestId('email-missing-status')).toBeNull();
    expect(block('track')).not.toBeNull();
    expect(within(block('greet')).getAllByTestId('email-placeholder-chip')).toHaveLength(2);
  });

  it('with one name answered the line names it; with none it says so', async () => {
    const one: EmailBlockRecord[] = [{ id: 'a', block: 'email.text', data: { paras: ['Hi {{first_name|there}}'] }, style: {} }];
    const first = await renderEditor(detail({}, one));
    await first.user.click(screen.getByRole('switch', { name: 'Preview with missing values' }));
    expect(screen.getByTestId('email-missing-status').textContent).toBe('Showing what a reader with no first name is sent.');
  });
});
