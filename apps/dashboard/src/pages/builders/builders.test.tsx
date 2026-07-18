/**
 * page-builder binding tests (M7-T06, 09 §7.11): envelope → PageBuilder
 * projection, the doc-in-layout persistence path (shared vs personal routed on
 * `canEditLayout`, autosave choreography), save-as-version through the
 * saved-views API, draft-mutation filtering, and the docState/emailDoc pure
 * algebra. Persistence hooks are mocked like DashboardBuilder.test.tsx; the
 * views API rides a fetch mock like the sibling suites (no msw).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import type { DocRecord } from '@adminium/widgets';
import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { PageTemplateAdapters } from '../template-types.js';
import { PageBuilderBinding } from './PageBuilderBinding.js';
import {
  builderPageStateOf,
  builderVersionConfigOf,
  builderVersionsOf,
  layoutWithDoc,
} from './docState.js';
import { docToEmailBlocks, emailBlocksToDoc } from './emailDoc.js';

const persist = vi.hoisted(() => ({
  sharedSave: vi.fn(),
  sharedFlush: vi.fn().mockResolvedValue(undefined),
  personalSave: vi.fn(),
  personalFlush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../layout/useLayoutPersistence.js', () => ({
  useSaveSharedLayout: () => ({
    save: persist.sharedSave,
    flush: persist.sharedFlush,
    cancel: vi.fn(),
    isSaving: false,
  }),
  useSavePersonalLayout: () => ({
    save: persist.personalSave,
    flush: persist.personalFlush,
    cancel: vi.fn(),
    isSaving: false,
  }),
  useResetLayout: () => ({ reset: vi.fn(), isResetting: false }),
}));

const DOC: DocRecord = {
  docType: 'invoice',
  title: 'Invoice',
  number: 'INV-2601',
  currency: 'USD',
  items: [{ id: 'li-1', desc: 'Design system audit', qty: 2, rate: 100 }],
  rates: { taxRate: 0.2, currency: 'USD' },
  blockOrder: [
    { id: 'b1', block: 'block-line-items' },
    { id: 'b2', block: 'block-totals-summary' },
  ],
};

function builderEnvelope(overrides: Partial<PageEnvelope> = {}): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_invoice_builder',
    template: 'page-builder',
    title: { key: 'pages.invoiceBuilder', fallback: 'Invoice builder' },
    source: { connectionId: 'conn_1', table: null },
    nav: { group: 'library', icon: 'file-text', order: 4, slug: 'invoice-builder' },
    access: { minRole: 'editor', permissions: [] },
    config: {
      docType: 'invoice',
      toolbar: ['autosave-indicator'],
      overlays: ['starter-template-picker', 'toast-stack'],
      layout: {
        version: 1,
        items: [
          {
            i: 'slot-canvas',
            widget: 'document-canvas',
            x: 3,
            y: 0,
            w: 6,
            h: 24,
            config: { docType: 'invoice', doc: DOC },
          },
        ],
      },
    },
    ...overrides,
  } as PageEnvelope;
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

interface FetchCall {
  method: string;
  path: string;
  body: unknown;
}

function installFetchMock(views: unknown[] = []): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path, body });
      if (path.includes('/views') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { data: { views } }));
      }
      if (path.includes('/views') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              id: 'view_1',
              pageId: 'page_invoice_builder',
              userId: 'user_1',
              name: (body as { name: string }).name,
              config: (body as { config: unknown }).config,
              isDefault: false,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { data: {} }));
    }),
  );
  return calls;
}

function renderBinding(options: { canEditLayout?: boolean; adapters?: PageTemplateAdapters } = {}) {
  const client = createQueryClient();
  const adapters = options.adapters ?? makeAdapters();
  render(
    <QueryClientProvider client={client}>
      <PageBuilderBinding
        page={builderEnvelope()}
        adapters={adapters}
        canEditLayout={options.canEditLayout ?? true}
      />
    </QueryClientProvider>,
  );
  return { adapters };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

// ── pure algebra ─────────────────────────────────────────────────────────────

describe('docState', () => {
  it('projects the envelope onto docType + doc + layout, and layoutWithDoc swaps the doc in place', () => {
    const state = builderPageStateOf(builderEnvelope());
    expect(state.docType).toBe('invoice');
    expect(state.canvasItemId).toBe('slot-canvas');
    expect(state.doc?.number).toBe('INV-2601');

    const next = layoutWithDoc(state, { ...DOC, number: 'INV-9999' });
    const item = next.items.find((entry) => entry.i === 'slot-canvas');
    expect((item?.config['doc'] as DocRecord).number).toBe('INV-9999');
    // The rest of the item's stored config is untouched.
    expect(item?.config['docType']).toBe('invoice');
  });

  it('synthesizes a canvas layout for a builder page stored without one', () => {
    const bare = builderEnvelope({ config: { docType: 'survey' } } as Partial<PageEnvelope>);
    const state = builderPageStateOf(bare);
    expect(state.doc).toBeNull();
    expect(state.layout.items).toHaveLength(1);
    expect(state.layout.items[0]?.widget).toBe('question-builder');
  });

  it('round-trips versions through the saved-views config marker and filters grid views out', () => {
    const config = builderVersionConfigOf('invoice', DOC, 123);
    const versions = builderVersionsOf([
      {
        id: 'view_a',
        pageId: 'p',
        userId: 'u',
        name: 'Before rates change',
        config: config as never,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'view_b',
        pageId: 'p',
        userId: 'u',
        name: 'A grid view',
        config: { v: 1, search: 'acme' } as never,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ viewId: 'view_a', name: 'Before rates change', savedAt: 123 });
    expect(versions[0]?.doc.number).toBe('INV-2601');
  });
});

describe('emailDoc', () => {
  it('maps stored blocks onto a canvas doc and back, preserving unknown entries in place', () => {
    const blocks = [
      { block: 'block-highlight-box', id: 'hb-1', data: { row: { label: 'Amount', value: '$290.00' } } },
      { kind: 'x-vendor-hero', src: 'cid:hero' }, // unknown → preserved
      { block: 'block-contact', id: 'c-1' },
    ];
    const state = emailBlocksToDoc(blocks, { name: 'Receipt', subject: 'Your receipt' });
    expect(state.doc.docType).toBe('email');
    expect(state.doc.title).toBe('Your receipt');
    expect(state.doc.blockOrder?.map((instance) => instance.block)).toEqual([
      'block-highlight-box',
      'block-contact',
    ]);
    expect(state.unknown).toHaveLength(1);

    const out = docToEmailBlocks(state.doc, state.unknown);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ kind: 'x-vendor-hero', src: 'cid:hero' });
    expect(out[0]).toMatchObject({ block: 'block-highlight-box', id: 'hb-1' });
  });

  it('drops hidden blocks on serialize (flags[block] === false)', () => {
    const state = emailBlocksToDoc(
      [{ block: 'block-contact', id: 'c-1' }, { block: 'block-highlight-box', id: 'h-1' }],
      { name: 'n', subject: 's' },
    );
    const hidden = { ...state.doc, flags: { 'block-contact': false } };
    expect(docToEmailBlocks(hidden).map((entry) => entry['block'])).toEqual(['block-highlight-box']);
  });
});

// ── rendered binding ─────────────────────────────────────────────────────────

describe('PageBuilderBinding', () => {
  it('renders the invoice canvas from the stored doc and autosaves edits to the SHARED layout for page editors', async () => {
    installFetchMock();
    renderBinding({ canEditLayout: true });

    await waitFor(() => {
      expect(document.querySelector('[data-widget="document-canvas"]')).not.toBeNull();
    });
    expect(screen.getByTestId('page-builder-binding')).toBeDefined();

    // Palette add → dirty → (debounce) → the shared layout PATCH path.
    fireEvent.click(
      document.querySelector('[data-part="builder-add-block"][data-block="block-signature"]') as Element,
    );
    await waitFor(
      () => {
        expect(persist.sharedSave).toHaveBeenCalledTimes(1);
      },
      { timeout: 4000 },
    );
    expect(persist.personalSave).not.toHaveBeenCalled();

    const layout = persist.sharedSave.mock.calls[0]?.[0] as {
      items: { i: string; config: Record<string, unknown> }[];
    };
    const savedDoc = layout.items.find((item) => item.i === 'slot-canvas')?.config['doc'] as DocRecord;
    expect(savedDoc.blockOrder?.some((instance) => instance.block === 'block-signature')).toBe(true);
  });

  it('routes autosave to the PERSONAL override without the page-edit grant', async () => {
    installFetchMock();
    renderBinding({ canEditLayout: false });
    await waitFor(() => {
      expect(document.querySelector('[data-widget="document-canvas"]')).not.toBeNull();
    });
    fireEvent.click(
      document.querySelector('[data-part="builder-add-block"][data-block="block-approval"]') as Element,
    );
    await waitFor(
      () => {
        expect(persist.personalSave).toHaveBeenCalledTimes(1);
      },
      { timeout: 4000 },
    );
    expect(persist.sharedSave).not.toHaveBeenCalled();
  });

  it('keeps draft mutations out of the CRUD adapter', async () => {
    installFetchMock();
    const { adapters } = renderBinding({ canEditLayout: true });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-part="block-instance"]').length).toBe(2);
    });
    // A canvas reorder emits a mutate intent addressed to the draft document.
    fireEvent.click(document.querySelector('[data-part="block-move-down"]') as Element);
    expect(adapters.onEvent).not.toHaveBeenCalled();
  });

  it('saves a named version through POST /pages/:id/views with the builderDoc marker', async () => {
    const calls = installFetchMock();
    renderBinding({ canEditLayout: true });
    await waitFor(() => {
      expect(document.querySelector('[data-widget="document-canvas"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId('builder-save-as-version'));
    fireEvent.change(screen.getByTestId('builder-version-name'), {
      target: { value: 'Before Q3 rates change' },
    });
    fireEvent.click(screen.getByTestId('builder-version-save'));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' && call.path === '/api/v1/pages/page_invoice_builder/views',
        ),
      ).toBe(true);
    });
    const post = calls.find((call) => call.method === 'POST');
    const body = post?.body as { name: string; config: { v: number; builderDoc: { docType: string } } };
    expect(body.name).toBe('Before Q3 rates change');
    expect(body.config.v).toBe(1);
    expect(body.config.builderDoc.docType).toBe('invoice');
  });
});
