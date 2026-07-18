/**
 * LOGS/MEDIA/CHAT binding tests (09-generated-app.md §4.1, §7.8/§7.9):
 * `usePageWidgetStates` batches `kind: 'page'` layouts under the shared
 * widget-data key; the log binding derives the live-tail channel from the log
 * slot's stored descriptor; the chat binding re-queries the messages child
 * scoped to the selected conversation (thread select → messages query) and
 * runs sends through the CRUD API against the MESSAGES table with the undo
 * toast; the files binding routes the preview through the record child route.
 *
 * The three template components ship in `packages/widgets/src/templates/*`
 * (fully tested there) but are not in the checked-out dist until assembly
 * rebuilds it, so they are stub-mocked here — these tests pin the BINDINGS'
 * data plumbing, not the templates' rendering.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';
import type { ReactNode } from 'react';

import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { PageChatBinding } from '../PageChatBinding.js';
import { PageFilesBinding } from '../PageFilesBinding.js';
import { PageLogViewerBinding } from '../PageLogViewerBinding.js';
import { AppToastProvider } from '../toasts.js';
import { extractPageBindings, findItemDescriptor, usePageWidgetStates } from './widgetStates.js';
import type { PageTemplateAdapters } from '../template-types.js';

vi.mock('@adminium/widgets', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createElement: h } = await import('react');
  type AnyProps = Record<string, never> & {
    liveChannel?: string;
    previewNodeId?: string | null;
    onPreviewNodeChange?: (id: string | null) => void;
    selectedConversationId?: string | number | null;
    onSelectConversation?: (id: string | number) => void;
    onSendMessage?: (body: string, id: string | number | null) => unknown;
    messagesState?: { status: string };
    labels?: Record<string, string>;
  };
  return {
    ...actual,
    PageLogViewer: (props: AnyProps) =>
      h('div', { 'data-testid': 'tpl-log', 'data-live': props.liveChannel ?? '' }),
    PageFiles: (props: AnyProps) =>
      h(
        'div',
        { 'data-testid': 'tpl-files', 'data-preview': String(props.previewNodeId), 'data-hint': props.labels?.['uploadsUnavailable'] ?? '' },
        h('button', { type: 'button', onClick: () => props.onPreviewNodeChange?.('f-9') }, 'open-preview'),
      ),
    PageChat: (props: AnyProps) =>
      h(
        'div',
        {
          'data-testid': 'tpl-chat',
          'data-selected': String(props.selectedConversationId),
          'data-msg-status': props.messagesState?.status ?? 'none',
        },
        h('button', { type: 'button', onClick: () => props.onSelectConversation?.('c2') }, 'select-c2'),
        h('button', { type: 'button', onClick: () => void props.onSendMessage?.('Hi there', props.selectedConversationId ?? null) }, 'send'),
      ),
    detectMessageFields: (rows: readonly Record<string, unknown>[]) => ({
      body: rows.some((row) => 'body' in row) ? 'body' : undefined,
      sentAt: 'created_at',
      author: 'sender_email',
    }),
    detectConversationFk: (rows: readonly Record<string, unknown>[]) =>
      rows.some((row) => 'conversation_id' in row) ? 'conversation_id' : undefined,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── fixtures ─────────────────────────────────────────────────────────────────

function pageEnvelope(template: string, items: Record<string, unknown>[], table: string): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: `page_${template}`,
    template,
    title: { key: `pages.${template}`, fallback: template },
    source: { connectionId: 'conn_1', table },
    nav: { group: 'library', icon: 'folder', order: 1, slug: template },
    access: { minRole: 'viewer', permissions: [] },
    config: { layout: { version: 1, items } },
  } as PageEnvelope;
}

function binding(name: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { schema: 'public', name, type: 'table' },
    shape: 'record-list',
    limit: 100,
    ...extra,
  };
}

const logPage = pageEnvelope(
  'page-log-viewer',
  [
    { i: 'log', widget: 'log-table', x: 0, y: 3, w: 12, h: 14, config: { title: 'Audit', binding: binding('order_audit', { orderBy: [{ column: 'created_at', dir: 'desc' }] }) } },
    { i: 'kpi-row-1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: 'Events' } }, // unbound → demo
  ],
  'public.order_audit',
);

const filesPage = pageEnvelope(
  'page-files',
  [{ i: 'browser', widget: 'file-browser', x: 3, y: 0, w: 9, h: 12, config: { title: 'Files', binding: binding('attachments') } }],
  'public.attachments',
);

const chatPage = pageEnvelope(
  'page-chat',
  [
    { i: 'inbox', widget: 'conversation-inbox', x: 0, y: 0, w: 3, h: 16, config: { title: 'Conversations', binding: binding('conversations') } },
    { i: 'thread', widget: 'chat-thread', x: 3, y: 0, w: 6, h: 16, config: { title: 'Thread', binding: binding('conv_messages', { orderBy: [{ column: 'created_at', dir: 'asc' }], limit: 200 }) } },
  ],
  'public.conversations',
);

const INBOX_ROWS = [
  { id: 'c1', subject: 'Timeline', updated_at: '2026-07-14T10:00:00.000Z' },
  { id: 'c2', subject: 'Invoice', updated_at: '2026-07-14T09:00:00.000Z' },
];
const THREAD_ROWS = [
  { id: 'm1', conversation_id: 'c1', sender_email: 'a@x.io', body: 'Hello', created_at: '2026-07-14T08:00:00.000Z' },
  { id: 'm2', conversation_id: 'c2', sender_email: 'b@x.io', body: 'Paid', created_at: '2026-07-14T09:00:00.000Z' },
];

interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
}

/** Routes widget-data batches + CRUD creates; records every call. */
function stubFetch(): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>);
      calls.push({ url, body });
      if (url === '/api/v1/widget-data/batch') {
        const requests = (body?.['requests'] ?? []) as { instanceId: string; descriptor: { source: { name: string }; filters?: { value: unknown }[] } }[];
        const results: Record<string, unknown> = {};
        for (const request of requests) {
          const table = request.descriptor.source.name;
          const filter = request.descriptor.filters?.[0];
          const rows =
            table === 'conversations'
              ? INBOX_ROWS
              : table === 'conv_messages'
                ? THREAD_ROWS.filter((row) => (filter === undefined ? true : row.conversation_id === filter.value))
                : table === 'order_audit'
                  ? [{ id: 'evt-1', created_at: '2026-07-14T11:00:00.000Z', action: 'updated' }]
                  : [];
          results[request.instanceId] = { ok: true, result: { rows, total: rows.length }, cached: false };
        }
        return jsonResponse(200, { results });
      }
      if (url.startsWith('/api/v1/data/')) {
        return jsonResponse(200, { data: { id: 'm99' }, undoToken: 'undo_msg' });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } });
    }),
  );
  return { calls };
}

function makeAdapters(): PageTemplateAdapters {
  return {
    crud: null,
    dashboard: null,
    onEvent: vi.fn(),
    openRecord: vi.fn(),
    notifyUndoable: vi.fn(),
  };
}

function renderWithProviders(ui: ReactNode, seedBootstrap = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedBootstrap) client.setQueryData(['bootstrap'], makeBootstrap());
  return render(
    <QueryClientProvider client={client}>
      <AppToastProvider>{ui}</AppToastProvider>
    </QueryClientProvider>,
  );
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('extractPageBindings / findItemDescriptor', () => {
  it('extracts descriptors from kind:page layouts (no dashboard gate)', () => {
    const { requests, invalid } = extractPageBindings(chatPage);
    expect(requests.map((request) => request.instanceId)).toEqual(['inbox', 'thread']);
    expect(invalid.size).toBe(0);
  });

  it('finds an item descriptor by widget id with instance-id fallback', () => {
    expect(findItemDescriptor(chatPage, ['chat-thread'])?.descriptor.source.name).toBe('conv_messages');
    expect(findItemDescriptor(chatPage, ['nope'], 'inbox')?.instanceId).toBe('inbox');
    expect(findItemDescriptor(chatPage, ['nope'])).toBeNull();
  });
});

describe('PageLogViewerBinding', () => {
  it('feeds batch states and derives the live-tail channel from the log binding', async () => {
    const { calls } = stubFetch();
    renderWithProviders(<PageLogViewerBinding page={logPage} adapters={makeAdapters()} />);

    const template = await screen.findByTestId('tpl-log');
    expect(template.getAttribute('data-live')).toBe('widget-data:conn_1:public.order_audit');
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/widget-data/batch')).toHaveLength(1);
    });
  });
});

describe('PageFilesBinding', () => {
  it('routes the preview drawer through the record child route', async () => {
    stubFetch();
    const adapters = makeAdapters();
    renderWithProviders(<PageFilesBinding page={filesPage} adapters={adapters} recordId="f-2" />);

    const template = await screen.findByTestId('tpl-files');
    expect(template.getAttribute('data-preview')).toBe('f-2');
    expect(template.getAttribute('data-hint')).toBe('Uploads are not available on this page yet.');

    await userEvent.setup().click(screen.getByRole('button', { name: 'open-preview' }));
    expect(adapters.openRecord).toHaveBeenCalledWith('f-9');
  });
});

describe('PageChatBinding', () => {
  it('thread select → scoped messages query on the detected conversation FK', async () => {
    const { calls } = stubFetch();
    renderWithProviders(<PageChatBinding page={chatPage} adapters={makeAdapters()} />, true);

    // Auto-selection mirrors the template: first conversation from the inbox.
    const template = await screen.findByTestId('tpl-chat');
    await waitFor(() => {
      expect(template.getAttribute('data-selected')).toBe('c1');
    });

    // The scoped re-query carries the FK filter for the selection.
    await waitFor(() => {
      const scoped = calls.filter(
        (call) =>
          call.url === '/api/v1/widget-data/batch' &&
          JSON.stringify(call.body).includes('"filters"'),
      );
      expect(scoped.length).toBeGreaterThan(0);
      expect(JSON.stringify(scoped.at(-1)?.body)).toContain('"value":"c1"');
    });
    await waitFor(() => {
      expect(screen.getByTestId('tpl-chat').getAttribute('data-msg-status')).toBe('success');
    });

    // Selecting another conversation re-queries with its id.
    await userEvent.setup().click(screen.getByRole('button', { name: 'select-c2' }));
    await waitFor(() => {
      const scoped = calls.filter(
        (call) =>
          call.url === '/api/v1/widget-data/batch' &&
          JSON.stringify(call.body).includes('"conversation_id"'),
      );
      expect(JSON.stringify(scoped.at(-1)?.body)).toContain('"value":"c2"');
    });
  });

  it('send runs a CRUD insert on the MESSAGES table with body + FK, then the undo toast', async () => {
    const { calls } = stubFetch();
    const adapters = makeAdapters();
    renderWithProviders(<PageChatBinding page={chatPage} adapters={adapters} />, true);
    await screen.findByTestId('tpl-chat');
    await waitFor(() => {
      expect(screen.getByTestId('tpl-chat').getAttribute('data-selected')).toBe('c1');
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => {
      const create = calls.find((call) => call.url.startsWith('/api/v1/data/conn_1/'));
      expect(create).toBeDefined();
      expect(create?.url).toBe('/api/v1/data/conn_1/public.conv_messages');
      expect(create?.body).toEqual({ values: { body: 'Hi there', conversation_id: 'c1' } });
    });
    await waitFor(() => {
      expect(adapters.notifyUndoable).toHaveBeenCalledWith(
        expect.objectContaining({ undoToken: 'undo_msg' }),
      );
    });
  });
});

describe('usePageWidgetStates', () => {
  it('materializes success/loading states under the shared widget-data key', async () => {
    stubFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const latest: { current: ReturnType<typeof usePageWidgetStates> | null } = { current: null };
    function Probe() {
      latest.current = usePageWidgetStates(logPage);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(latest.current?.states['log']?.status).toBe('loading');
    await waitFor(() => {
      expect(latest.current?.states['log']?.status).toBe('success');
    });
    // Unbound instances are absent — the template's demo path (04 §5.3).
    expect(latest.current?.states['kpi-row-1']).toBeUndefined();
    // The batch landed in the shared cache root so realtime invalidation hits it.
    expect(client.getQueryCache().find({ queryKey: ['widget-data', logPage.id, {}] })).toBeDefined();
  });
});
