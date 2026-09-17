// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector: selecting a block opens Design on it; every kind's schema
 * renders its fields and row cells; a cycle cell steps; Save as reusable
 * POSTs and the Sections tab lists it; every style button writes its axis;
 * the Branding panel's From email is a configured sender or a refusal with
 * the hint. Rendered through the real router (the editor owns the state).
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
import type { EmailBlockRecord, EmailDocumentDetail, EmailSavedBlock } from '../../api.js';
import { EMAIL_BLOCK_KINDS, EMAIL_BLOCKS, defaultBlockData } from '../../model/blocks.js';
import { cellPlaceholder, fieldLabel, rowsLabel } from './fieldText.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const ALL_KINDS: EmailBlockRecord[] = EMAIL_BLOCK_KINDS.map((kind, index) => ({ id: `b_${String(index)}`, block: kind, data: defaultBlockData(kind), style: {} }));

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

const inspector = () => screen.getByTestId('email-inspector');

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

describe('Inspector', () => {
  it("selecting a block switches to Design with the block's icon, label and hint", async () => {
    const { user } = await renderEditor();
    expect(screen.getByTestId('email-sections-tab')).toBeDefined();
    expect(within(inspector()).getAllByTestId('email-outline-row')).toHaveLength(EMAIL_BLOCK_KINDS.length);
    await user.click(screen.getAllByTestId('email-block')[2] as HTMLElement); // email.button
    const header = await screen.findByTestId('email-design-header');
    expect(header.getAttribute('data-icon')).toBe('mouse-pointer-click');
    expect(within(header).getByText('Button')).toBeDefined();
    expect(within(header).getByText('Primary call-to-action')).toBeDefined();
    expect(screen.getByTestId('email-block-panel').getAttribute('data-kind')).toBe('email.button');
    // Back returns to Sections with the selection kept.
    await user.click(screen.getByTestId('email-design-back'));
    expect(screen.getByTestId('email-sections-tab')).toBeDefined();
    expect(within(inspector()).getAllByTestId('email-outline-select')[2]?.getAttribute('aria-pressed')).toBe('true');
  });

  it("every kind's schema renders the comp's fields and row cells", async () => {
    const { user } = await renderEditor();
    for (const kind of EMAIL_BLOCK_KINDS) {
      const def = EMAIL_BLOCKS[kind];
      await user.click(screen.getByTestId('email-sections-tab').querySelector(`[data-block-id="b_${String(EMAIL_BLOCK_KINDS.indexOf(kind))}"] [data-testid="email-outline-select"]`) as HTMLElement);
      const panel = await screen.findByTestId('email-block-panel');
      expect(panel.getAttribute('data-kind')).toBe(kind);
      for (const field of def.fields) {
        // The label text and the control it names (a style swatch may share a word like "Body").
        expect(within(panel).getAllByText(fieldLabel(field.label)).length, `${kind} label ${field.label}`).toBeGreaterThan(0);
        const control = within(panel).getAllByTestId('email-field').find((el) => el.getAttribute('data-field') === field.key);
        expect(control, `${kind} field ${field.key}`).toBeDefined();
        expect(control?.tagName).toBe(field.kind === 'area' ? 'TEXTAREA' : 'INPUT');
      }
      if (def.rows !== undefined) {
        const editor = within(panel).getByTestId('email-rows-editor');
        expect(within(editor).getByText(rowsLabel(def.rows.label))).toBeDefined();
        const rows = within(editor).getAllByTestId('email-row-entry');
        expect(rows.length).toBeGreaterThan(0);
        for (const cell of def.rows.cells) {
          if (cell.kind === 'cycle') expect(within(rows[0] as HTMLElement).getByTestId('email-cycle-cell')).toBeDefined();
          else if (cell.kind !== 'area') expect(within(rows[0] as HTMLElement).getByPlaceholderText(cellPlaceholder(cell.placeholder)), `${kind} cell ${cell.key}`).toBeDefined();
        }
      } else {
        expect(within(panel).queryByTestId('email-rows-editor')).toBeNull();
      }
      if (def.sized) expect(within(panel).getAllByTestId('email-style-size')).toHaveLength(3);
      else expect(within(panel).queryAllByTestId('email-style-size')).toHaveLength(0);
      if (def.vars) expect(within(panel).getByTestId('email-variables-box')).toBeDefined();
      await user.click(screen.getByTestId('email-design-back'));
    }
  });

  it('a cycle cell steps todo → current → done → todo and the canvas follows', async () => {
    const delivery = ALL_KINDS.find((b) => b.block === 'email.delivery') as EmailBlockRecord;
    const { user } = await renderEditor(detail({}, [delivery]));
    await user.click(screen.getByTestId('email-block'));
    const cells = await screen.findAllByTestId('email-cycle-cell');
    const last = cells[3] as HTMLElement; // Delivered: todo
    expect(last.getAttribute('data-value')).toBe('todo');
    await user.click(last);
    expect(last.getAttribute('data-value')).toBe('current');
    expect(screen.getByTestId('email-save-chip').textContent).toBe('Unsaved changes');
    await user.click(last);
    expect(last.getAttribute('data-value')).toBe('done');
    await user.click(last);
    expect(last.getAttribute('data-value')).toBe('todo');
    // Back to exactly what was saved: dirty is derived (departure 16).
    expect(screen.getByTestId('email-save-chip').textContent).toBe('All changes saved');
    expect(within(screen.getByTestId('email-block')).getByText('Delivered')).toBeDefined();
  });

  it('Save as reusable POSTs /email-blocks and the Sections tab lists it', async () => {
    const quote = ALL_KINDS.find((b) => b.block === 'email.quote') as EmailBlockRecord;
    const { user, calls } = await renderEditor(detail({}, [quote]));
    await user.click(screen.getByTestId('email-block'));
    await user.click(await screen.findByTestId('email-save-block'));
    const name = screen.getByTestId('email-save-block-name') as HTMLInputElement;
    expect(name.value).toBe('Quote');
    await user.clear(name);
    await user.type(name, 'Customer quote');
    await user.click(screen.getByTestId('email-save-block-confirm'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/email-blocks')).toHaveLength(1);
    });
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/email-blocks')?.body as { name: string; block: { block: string } };
    expect(post.name).toBe('Customer quote');
    expect(post.block.block).toBe('email.quote');
    await screen.findByText('Saved to your blocks');
    await user.click(screen.getByTestId('email-design-back'));
    expect(await within(inspector()).findByText('Customer quote')).toBeDefined();
    // The picker lists it first, and picking it inserts a clone.
    await user.click(screen.getByTestId('email-sections-add'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('email-picker-saved')).toBeDefined();
    await user.click(within(dialog).getByTestId('email-picker-saved-tile'));
    await waitFor(() => {
      expect(screen.getAllByTestId('email-block')).toHaveLength(2);
    });
  });

  it('every style button writes its axis to block.style, and the canvas wrapper reads it back', async () => {
    const text = ALL_KINDS.find((b) => b.block === 'email.text') as EmailBlockRecord;
    const { user } = await renderEditor(detail({}, [text]));
    await user.click(screen.getByTestId('email-block'));
    await screen.findByTestId('email-style-options');
    const wrapper = () => screen.getByTestId('email-block').lastElementChild as HTMLElement;
    const pick = async (testId: string, value: string) => {
      const button = screen.getAllByTestId(testId).find((el) => el.getAttribute('data-value') === value) as HTMLElement;
      await user.click(button);
      expect(button.getAttribute('aria-pressed')).toBe('true');
    };
    await pick('email-style-align', 'center');
    expect(wrapper().className).toContain('text-center');
    await pick('email-style-bg', 'dark');
    expect(wrapper().className).toContain('bg-[#17171c]');
    await pick('email-style-fg', 'white');
    expect(wrapper().className).toContain('text-white');
    await pick('email-style-pad', 'l');
    expect(wrapper().className).toContain('px-[26px]');
    await pick('email-style-size', 'l');
    expect(wrapper().className).toContain('text-[15.5px]');
    await pick('email-style-border', 'dashed');
    expect(wrapper().className).toContain('border-dashed');
    await pick('email-style-radius', 'lg');
    expect(wrapper().className).toContain('rounded-2xl');
    await user.click(screen.getByTestId('email-style-full'));
    expect(wrapper().className).toContain('-mx-7');
    // Each choice was one undo step.
    for (let i = 0; i < 8; i += 1) await user.click(screen.getByTestId('email-undo'));
    expect(wrapper().className).toContain('text-start');
    expect(wrapper().className).not.toContain('-mx-7');
  });

  it("the Branding panel's From email accepts a configured sender and refuses another with the hint", async () => {
    const { user } = await renderEditor(
      detail({ document: { ...detail().document, brand: { name: 'Northwind', mark: 'gem', accent: '#0d9488', fromName: 'Northwind team', fromEmail: 'old@northwind.io' } } }, ALL_KINDS.slice(0, 1)),
      [{ name: 'Ada', address: 'ada@northwind.io' }],
    );
    await user.click(screen.getAllByTestId('email-pinned-row')[0] as HTMLElement);
    const panel = await screen.findByTestId('email-branding-panel');
    expect(within(panel).getByTestId('email-from-email-hint').textContent).toContain('Not a configured sender.');
    expect(within(panel).getAllByTestId('email-brand-mark').find((el) => el.getAttribute('data-mark') === 'gem')?.getAttribute('aria-pressed')).toBe('true');

    const combobox = within(panel).getByRole('combobox');
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /ada@northwind.io/ }));
    await waitFor(() => {
      expect(within(panel).queryByTestId('email-from-email-hint')).toBeNull();
    });
    expect(within(screen.getByTestId('email-section-chrome')).getByText('ada@northwind.io')).toBeDefined();

    // Status pills toggle `enabled` for a template; a swatch writes the accent.
    await user.click(within(panel).getAllByTestId('email-status-pill').find((el) => el.getAttribute('data-status') === 'draft') as HTMLElement);
    expect(within(panel).getAllByTestId('email-status-pill').find((el) => el.getAttribute('data-status') === 'draft')?.getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel).getAllByTestId('email-brand-swatch').find((el) => el.getAttribute('data-value') === '#e5484d') as HTMLElement);
    expect(screen.getByTestId('email-mail-shell').getAttribute('style')).toContain('#e5484d');
  });
});
