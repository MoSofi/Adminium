// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What happens to the report editor when the assistant puts a body on it.
 *
 * THE MODAL IS NOT IN THIS TEST. The button is replaced by a probe that
 * calls the host's `applyDraft` directly: the claim being made is the
 * EDITOR's, that a body arriving from outside behaves like any other
 * structural edit and that one undo takes all of it back.
 *
 * NOTHING HERE PUBLISHES. This editor's primary sets `status: 'sent'`, and
 * that is a person's act. An applied draft carries the BODY alone, so the
 * status cannot move — and the save that would carry it is still the
 * person's own button.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import type { AssistantHostContext } from '../../assistant/hostContext.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ReportDetail, ReportPutBody } from '../api.js';
import { DEFAULT_BLOCK_SEED, newBlock } from '../model/blocks.js';
import { emptyBody, type ReportBody } from '../model/envelope.js';

/**
 * A body with a block the open document does not have — the landing place —
 * and a `status` it has no business carrying. The server refuses that field
 * on a save; this file proves the ON-SCREEN path ignores it too.
 */
const ARTEFACT: Record<string, unknown> = {
  name: 'Support load by customer',
  status: 'sent',
  body: {
    kicker: 'Quarterly',
    reportTitle: 'Support load by customer',
    subtitle: 'Where the hours went',
    blocks: [
      { id: 'b1', kind: 'text', title: 'Summary', w: 'full', show: true, body: 'Hours rose.' },
      { id: 'fresh', kind: 'kpi', title: 'Tickets', w: 'half', show: true, kpis: [{ label: 'Total', value: '412' }] },
    ],
  },
  sources: [],
};

let host: AssistantHostContext | null = null;

vi.mock('../../assistant/AskAssistant.js', () => ({
  AskAssistant: (props: { host: AssistantHostContext }) => {
    host = props.host;
    return (
      <button type="button" data-testid="apply-probe" onClick={() => props.host.applyDraft?.(ARTEFACT)}>
        apply
      </button>
    );
  },
}));

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function body(): ReportBody {
  return {
    ...emptyBody(),
    kicker: 'Quarterly report',
    reportTitle: 'Q3 2026 Executive Summary',
    blocks: [newBlock('text', DEFAULT_BLOCK_SEED, 'b1')],
  };
}

function detail(): ReportDetail {
  const docBody = body();
  return {
    id: 'rpt_1',
    // A TEMPLATE, whose primary is *Save template*. A report's primary is
    // *Publish* and sets `sent` by design — using one here would prove
    // nothing about what the assistant did.
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
      kpiCount: 0,
      series: [],
      starterIcon: 'briefcase',
    },
    body: docBody,
  };
}

async function renderEditor() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const parsed = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body: parsed });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, assistant: { allowed: true, name: 'Milo' } }) }),
        );
      }
      if (url === '/api/v1/report-documents/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
      if (method === 'GET' && (url === '/api/v1/report-documents' || url.startsWith('/api/v1/report-documents?'))) {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, report: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/report-documents/rpt_1') return Promise.resolve(jsonResponse(200, detail()));
      if (method === 'PUT' && url === '/api/v1/report-documents/rpt_1') {
        const put = parsed as ReportPutBody;
        return Promise.resolve(jsonResponse(200, { ...detail(), name: put.name, status: put.status, body: put.body }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/report-builder/rpt_1'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('report-editor-header');
  return { calls, user: userEvent.setup() };
}

const chip = () => screen.getByTestId('report-save-chip').textContent ?? '';

afterEach(() => {
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a body the assistant proposed', () => {
  it('reaches the editor as the report host, carrying what is on screen', async () => {
    await renderEditor();
    // Both report routes are the same context: a report is a report whether
    // it is a layout or a run of one.
    expect(host?.context).toBe('report');
    expect(host?.host.documentId).toBe('rpt_1');
    expect((host?.draft as ReportBody | undefined)?.reportTitle).toBe('Q3 2026 Executive Summary');
    expect(typeof host?.applyDraft).toBe('function');
  });

  it('replaces the body, marks it unsaved, writes nothing, and lands on the new block', async () => {
    const { calls, user } = await renderEditor();
    expect(chip()).toBe('All changes saved');
    const before = calls.length;

    await user.click(screen.getByTestId('apply-probe'));

    expect(chip()).toBe('Unsaved changes');
    expect(screen.getByDisplayValue('Support load by customer')).toBeTruthy();
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    expect(calls.length).toBe(before);

    const selected = screen.getAllByTestId('report-block').filter((node) => node.hasAttribute('data-selected'));
    expect(selected.map((node) => node.getAttribute('data-id'))).toEqual(['fresh']);
  });

  it('cannot move the status, whatever the artefact claims', async () => {
    const { calls, user } = await renderEditor();
    await user.click(screen.getByTestId('apply-probe'));
    await user.click(screen.getByTestId('report-save'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    });
    const put = calls.filter((call) => call.method === 'PUT').at(-1)?.body as ReportPutBody;
    // The body came across; the `status: 'sent'` riding beside it did not.
    // Publishing is a person pressing *Publish* on a report, and nothing the
    // assistant hands over is that.
    expect(put.body.reportTitle).toBe('Support load by customer');
    expect(put.status).toBe('draft');
  });

  it('is taken back by ONE undo', async () => {
    const { user } = await renderEditor();
    await user.click(screen.getByTestId('apply-probe'));
    expect(chip()).toBe('Unsaved changes');

    await user.click(screen.getByTestId('report-undo'));

    await waitFor(() => {
      expect(chip()).toBe('All changes saved');
    });
    expect(screen.getByDisplayValue('Q3 2026 Executive Summary')).toBeTruthy();
    expect(screen.getByTestId('report-undo').hasAttribute('disabled')).toBe(true);
  });
});
