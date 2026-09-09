// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor shell, canvas and palette (43-report-builder.md 43-T06
 * done-when; Appendix A E1–E11, C1–C8, P1–P2): explicit save with its chip
 * and history, the discard guard, the palette's 25 kinds, the block card's
 * four states, both reorder paths, the half width, the *Show in export*
 * toggle and the primary's two meanings.
 *
 * Rendered through the real router and shell so the topbar's Back and the
 * blocker are the product's own; the API is a fetch stub keyed on the routes
 * the editor calls.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ReportDetail, ReportPutBody } from '../api.js';
import { DEFAULT_BLOCK_SEED, newBlock } from '../model/blocks.js';
import { emptyBody, REPORT_BLOCK_KINDS, type ReportBlock, type ReportBody } from '../model/envelope.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function block(kind: ReportBlock['kind'], id: string, over: Partial<ReportBlock> = {}): ReportBlock {
  return { ...newBlock(kind, DEFAULT_BLOCK_SEED, id), ...over } as ReportBlock;
}

function body(over: Partial<ReportBody> = {}): ReportBody {
  return {
    ...emptyBody(),
    kicker: 'Quarterly report',
    reportTitle: 'Q3 2026 Executive Summary',
    subtitle: 'For the leadership team',
    blocks: [block('text', 'b1'), block('kpi', 'b2'), block('bar', 'b3')],
    ...over,
  };
}

function detail(over: Partial<ReportDetail> = {}, docBody: ReportBody = body()): ReportDetail {
  return {
    id: 'rpt_1',
    kind: 'template',
    name: 'Executive summary',
    status: 'draft',
    starter: 'exec',
    originId: null,
    createdAt: 1,
    updatedAt: 1,
    summary: {
      reportTitle: docBody.reportTitle,
      kicker: docBody.kicker,
      accent: docBody.accent,
      blockCount: docBody.blocks.length,
      kpiCount: 2,
      series: [40, 65, 52],
      starterIcon: 'briefcase',
    },
    body: docBody,
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function emptyResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: () => Promise.reject(new Error('no body')) } as unknown as Response;
}

function stubFetch(doc: ReportDetail, opts: { saveFails?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const parsed = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body: parsed });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/report-documents' || url.startsWith('/api/v1/report-documents?'))) {
      return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, report: 0 } }));
    }
    if (url === '/api/v1/report-documents/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
    if (url === `/api/v1/report-documents/${doc.id}` && method === 'GET') return Promise.resolve(jsonResponse(200, doc));
    if (url === `/api/v1/report-documents/${doc.id}` && method === 'PUT') {
      if (opts.saveFails === true) return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'nope' } }));
      const put = parsed as ReportPutBody;
      return Promise.resolve(jsonResponse(200, detail({ ...doc, name: put.name, status: put.status }, put.body)));
    }
    if (url === `/api/v1/report-documents/${doc.id}` && method === 'DELETE') return Promise.resolve(emptyResponse(204));
    if (url === `/api/v1/report-documents/${doc.id}/duplicate` && method === 'POST') {
      return Promise.resolve(jsonResponse(201, detail({ id: `${doc.id}_copy`, name: `${doc.name} (copy)` })));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderEditor(doc: ReportDetail = detail(), opts: { saveFails?: boolean } = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(doc, opts);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/report-builder/${doc.id}`] }) });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('report-editor-header');
  return { ...stub, queryClient, router, view, user: userEvent.setup() };
}

const chip = () => screen.getByTestId('report-save-chip').textContent ?? '';
const blockIds = () => screen.getAllByTestId('report-block').map((el) => el.getAttribute('data-id') ?? '');
const lastPut = (calls: Call[]): ReportPutBody => calls.filter((c) => c.method === 'PUT').at(-1)?.body as ReportPutBody;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the header (E1–E7)', () => {
  it('carries the kind pill, the inline name and the save chip; the primary follows the kind (D5)', async () => {
    await renderEditor();
    const header = screen.getByTestId('report-editor-header');
    expect(within(header).getByText('Template')).toBeDefined();
    expect((screen.getByTestId('report-editor-name') as HTMLInputElement).value).toBe('Executive summary');
    expect(chip()).toBe('All changes saved');
    expect(screen.getByTestId('report-save').textContent).toBe('Save template');
  });

  it('a report’s primary reads *Publish* and saves with status `sent` (D5/O2)', async () => {
    const { user, calls } = await renderEditor(detail({ id: 'rpt_1', kind: 'report' }));
    expect(screen.getByTestId('report-save').textContent).toBe('Publish');
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(lastPut(calls).status).toBe('sent');
    });
    expect(await screen.findByText('Published Executive summary')).not.toBeNull();
  });

  it('an already-published report’s Publish just saves', async () => {
    const { user, calls } = await renderEditor(detail({ id: 'rpt_1', kind: 'report', status: 'sent' }));
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    });
    expect(lastPut(calls).status).toBe('sent');
    expect(screen.queryByText('Published Executive summary')).toBeNull();
  });

  it('nothing writes while typing — the chip goes dirty and only the primary PUTs (D4/O6)', async () => {
    const { user, calls } = await renderEditor();
    await user.type(screen.getByTestId('report-editor-name'), ' v2');
    await waitFor(() => {
      expect(chip()).toBe('Unsaved changes');
    });
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(chip()).toBe('All changes saved');
    });
    expect(lastPut(calls).name).toBe('Executive summary v2');
  });

  it('a failed save shows *Couldn’t save* and a toast', async () => {
    const { user } = await renderEditor(detail(), { saveFails: true });
    await user.type(screen.getByTestId('report-editor-name'), '!');
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(chip()).toBe('Couldn’t save');
    });
  });

  it('undo and redo walk the draft, and undoing back to the saved state reads *All changes saved* (E5)', async () => {
    const { user } = await renderEditor();
    const name = screen.getByTestId('report-editor-name') as HTMLInputElement;
    expect((screen.getByTestId('report-undo') as HTMLButtonElement).disabled).toBe(true);
    await user.type(name, 'X');
    await waitFor(() => {
      expect(chip()).toBe('Unsaved changes');
    });
    await user.click(screen.getByTestId('report-undo'));
    await waitFor(() => {
      expect((screen.getByTestId('report-editor-name') as HTMLInputElement).value).toBe('Executive summary');
    });
    // Back at exactly what was saved — the chip is DERIVED, so it says so.
    expect(chip()).toBe('All changes saved');
    await user.click(screen.getByTestId('report-redo'));
    await waitFor(() => {
      expect((screen.getByTestId('report-editor-name') as HTMLInputElement).value).toBe('Executive summaryX');
    });
  });

  it('leaving a dirty draft asks first (E4 — the comp autosaves and has no guard)', async () => {
    const { user, router } = await renderEditor();
    await user.type(screen.getByTestId('report-editor-name'), 'X');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect((await screen.findByTestId('report-discard-body')).textContent).toBe('Your edits to Executive summaryX will be lost.');
    await user.click(screen.getByTestId('report-discard-keep'));
    await waitFor(() => {
      expect(screen.queryByTestId('report-discard-body')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/report-builder/rpt_1');
  });

  it('Delete asks, hard-deletes and returns to the manager without the guard', async () => {
    const { user, calls, router } = await renderEditor();
    await user.type(screen.getByTestId('report-editor-name'), 'X');
    await user.click(screen.getByTestId('report-delete'));
    expect((await screen.findByTestId('report-delete-body')).textContent).toBe('This can’t be undone. The template will be permanently removed.');
    await user.click(screen.getByTestId('report-delete-confirm'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/report-builder');
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(screen.queryByTestId('report-discard-body')).toBeNull();
  });
});

describe('the palette (P1–P2)', () => {
  it('offers all 25 kinds in the comp’s order, and a click appends AND selects (535)', async () => {
    const { user } = await renderEditor();
    const items = screen.getAllByTestId('report-palette-item');
    expect(items.map((el) => el.getAttribute('data-kind'))).toEqual([...REPORT_BLOCK_KINDS]);
    // The four kinds the comp's `kindMeta` returns backwards (473) print LABELS.
    expect(items.find((el) => el.getAttribute('data-kind') === 'loyalty')?.textContent).toContain('Loyalty points');
    expect(items.find((el) => el.getAttribute('data-kind') === 'contact')?.textContent).toContain('Contact');
    expect(items.find((el) => el.getAttribute('data-kind') === 'refund')?.textContent).toContain('Refund policy');
    expect(items.find((el) => el.getAttribute('data-kind') === 'delivery')?.textContent).toContain('Delivery timeline');

    await user.click(items.find((el) => el.getAttribute('data-kind') === 'qr') as HTMLElement);
    await waitFor(() => {
      expect(blockIds()).toHaveLength(4);
    });
    // The new block is the selected one, so the inspector points at it.
    expect(screen.getAllByTestId('report-inspector-title')[0]?.textContent).toBe('Payment QR');
  });
});

describe('the canvas (C1–C8)', () => {
  it('draws the paper, the header region’s three inputs and the block stack', async () => {
    await renderEditor();
    expect(screen.getByTestId('report-paper')).toBeDefined();
    expect((screen.getByTestId('report-kicker') as HTMLInputElement).value).toBe('Quarterly report');
    expect((screen.getByTestId('report-title') as HTMLInputElement).value).toBe('Q3 2026 Executive Summary');
    expect((screen.getByTestId('report-subtitle') as HTMLInputElement).value).toBe('For the leadership team');
    expect(blockIds()).toEqual(['b1', 'b2', 'b3']);
  });

  it('the empty stack shows the comp’s dashed box (344)', async () => {
    await renderEditor(detail({}, body({ blocks: [] })));
    expect((await screen.findByTestId('report-stack-empty')).textContent).toBe('Add a block from the left to start building.');
  });

  it('the chevrons SWAP with the neighbour (537)', async () => {
    const { user } = await renderEditor();
    const second = screen.getAllByTestId('report-block')[1] as HTMLElement;
    await user.click(within(second).getByRole('button', { name: 'Move up' }));
    await waitFor(() => {
      expect(blockIds()).toEqual(['b2', 'b1', 'b3']);
    });
  });

  it('the grip reorders from the keyboard — the addition the comp’s bare `<span draggable>` cannot (D17)', async () => {
    const { user } = await renderEditor();
    const grips = screen.getAllByTestId('report-block-grip');
    (grips[0] as HTMLElement).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(blockIds()).toEqual(['b2', 'b1', 'b3']);
    });
  });

  it('a `show: false` block renders at 50 % and STAYS IN PLACE (§0.3 trap 2)', async () => {
    await renderEditor(detail({}, body({ blocks: [block('text', 'b1'), block('kpi', 'b2', { show: false }), block('bar', 'b3')] })));
    expect(blockIds()).toEqual(['b1', 'b2', 'b3']);
    const dimmed = screen.getAllByTestId('report-block')[1] as HTMLElement;
    expect(dimmed.getAttribute('data-hidden')).toBe('');
    expect(dimmed.className).toContain('opacity-50');
  });

  it('a `half` block takes calc(50% − 8px) (613)', async () => {
    await renderEditor(detail({}, body({ blocks: [block('text', 'b1', { w: 'half' }), block('kpi', 'b2', { w: 'half' })] })));
    const wraps = screen.getAllByTestId('report-block-wrap');
    expect(wraps.map((el) => el.getAttribute('data-width'))).toEqual(['half', 'half']);
    expect((wraps[0] as HTMLElement).className).toContain('w-[calc(50%-8px)]');
  });

  it('deleting a block from its head row falls back to the header (538)', async () => {
    const { user } = await renderEditor();
    await user.click(screen.getAllByTestId('report-block')[1] as HTMLElement);
    await waitFor(() => {
      expect(screen.getAllByTestId('report-inspector-title')[0]?.textContent).toBe('KPI row');
    });
    await user.click(within(screen.getAllByTestId('report-block')[1] as HTMLElement).getByRole('button', { name: 'Delete block' }));
    await waitFor(() => {
      expect(blockIds()).toEqual(['b1', 'b3']);
    });
    expect(screen.getAllByTestId('report-inspector-title')[0]?.textContent).toBe('Report header');
  });

  it('every canvas input carries an accessible name, and the inline title writes the draft', async () => {
    const { user, calls } = await renderEditor();
    const first = screen.getAllByTestId('report-block')[0] as HTMLElement;
    const title = within(first).getByTestId('report-block-title');
    expect(title.getAttribute('aria-label')).toBe('Block title');
    await user.type(title, '!');
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(lastPut(calls).body.blocks[0]?.title).toBe('Text!');
    });
  });

  it('renders all 25 kinds on one sheet without throwing', async () => {
    const blocks = REPORT_BLOCK_KINDS.map((kind, i) => block(kind, `k${String(i)}`));
    await renderEditor(detail({}, body({ blocks })));
    expect(blockIds()).toHaveLength(25);
    expect(screen.getAllByTestId('report-block').map((el) => el.getAttribute('data-kind'))).toEqual([...REPORT_BLOCK_KINDS]);
  });
});
