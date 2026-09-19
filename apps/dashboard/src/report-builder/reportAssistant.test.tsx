// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the report pages hand the assistant.
 *
 * THE SHEET IS THE CLAIM. The preview inside the modal must be this page's
 * own canvas with nothing on it to operate — that is what makes "one report
 * renderer" true rather than aspirational, and what keeps a person from
 * editing a document that does not exist yet.
 *
 * THE ECHO after *Run full preview* is the other half. The server answers
 * with COUNTS — how many figures moved, how many sources refused — and this
 * page turns them into a sentence, because a sentence composed on the server
 * is English on the wire. A refusal is said out loud: a stale figure sitting
 * beside fresh ones with nobody told is the failure that wording exists to
 * prevent.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import type { BootstrapData } from '../app/bootstrap.js';
import { echoText } from '../assistant/contexts.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { ReportDetail } from './api.js';
import { bodyOf } from './assistant.js';
import { ReportCanvas } from './editor/canvas/ReportCanvas.js';
import { DEFAULT_BLOCK_SEED, newBlock } from './model/blocks.js';
import { emptyBody, type ReportBody } from './model/envelope.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/** A report artefact as the turn produces it: the envelope's shape, plus its sources. */
const ARTEFACT: Record<string, unknown> = {
  name: 'Support load by customer',
  body: {
    kicker: 'Quarterly',
    reportTitle: 'Support load by customer',
    subtitle: 'Where the hours went',
    blocks: [
      { id: 'b1', kind: 'kpi', title: 'Tickets', w: 'half', show: true, kpis: [{ label: 'Total', value: '412', delta: '+8.0%' }] },
      { id: 'b2', kind: 'bar', title: 'By customer', w: 'full', show: true, series: [{ label: 'Globex', value: '120' }] },
    ],
  },
  sources: [{ blockId: 'b1', descriptor: { connectionId: 'conn_1' }, reason: 'the ticket count' }],
};

function detail(): ReportDetail {
  const docBody: ReportBody = { ...emptyBody(), reportTitle: 'Executive summary', blocks: [newBlock('text', DEFAULT_BLOCK_SEED, 'b1')] };
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
      kpiCount: 0,
      series: [],
      starterIcon: 'briefcase',
    },
    body: docBody,
  };
}

function stubFetch(bootstrap: BootstrapData) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: bootstrap }));
      if (url === '/api/v1/report-documents/starters') return Promise.resolve(jsonResponse(200, { starters: [] }));
      if (method === 'GET' && (url === '/api/v1/report-documents' || url.startsWith('/api/v1/report-documents?'))) {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, report: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/report-documents/rpt_1') return Promise.resolve(jsonResponse(200, detail()));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
}

async function renderAt(path: string, assistant: BootstrapData['assistant']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch(makeBootstrap({ nav: { groups: [] }, ...(assistant === undefined ? {} : { assistant }) }));
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId(path === '/report-builder' ? 'report-toolbar' : 'report-editor-header');
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the artefact as a document', () => {
  it('fills the envelope from whatever the turn produced', () => {
    const body = bodyOf(ARTEFACT);
    expect(body.reportTitle).toBe('Support load by customer');
    expect(body.blocks.map((block) => block.id)).toEqual(['b1', 'b2']);
    // Absent in the artefact; the envelope's own default, not a blank.
    expect(body.accent).toBe(emptyBody().accent);
  });
});

describe('the read-only paper', () => {
  function renderSheet(readOnly: boolean) {
    const body = bodyOf(ARTEFACT);
    const { container } = render(
      <ReportCanvas
        body={body}
        locale="en-US"
        {...(readOnly ? { readOnly: true } : { selection: 'header' as const })}
      />,
    );
    return container;
  }

  it('is the page’s own sheet with nothing on it to operate', () => {
    const container = renderSheet(true);
    expect(screen.getByTestId('report-paper')).toBeTruthy();
    expect(screen.getByText('Support load by customer')).toBeTruthy();
    expect(screen.getAllByTestId('report-block')).toHaveLength(2);
    // No inline fields, no outlines, no grips, no head-row actions.
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0);
    expect(screen.queryByTestId('report-block-grip')).toBeNull();
    expect(screen.queryByTestId('report-block-actions')).toBeNull();
    expect([...container.querySelectorAll('button')].filter((node) => !node.hasAttribute('disabled'))).toHaveLength(0);
  });

  it('still edits when it is not read-only', () => {
    const container = renderSheet(false);
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('report-block-grip').length).toBe(2);
  });
});

describe('the re-run echo', () => {
  it('says how many figures moved', () => {
    expect(echoText('report', { kind: 'resampled', refreshed: 3, refused: 0 }, 'Report')).toBe(
      'Re-ran the sources — 3 figures updated.',
    );
    expect(echoText('report', { kind: 'resampled', refreshed: 1, refused: 0 }, 'Report')).toBe(
      'Re-ran the sources — 1 figure updated.',
    );
  });

  it('says out loud when a source refused, rather than leaving a stale figure unmentioned', () => {
    expect(echoText('report', { kind: 'resampled', refreshed: 2, refused: 1 }, 'Report')).toBe(
      'Re-ran the sources — 2 figures updated; 1 source could not be read.',
    );
  });

  it('counts figures only here — the other pages have nothing to count', () => {
    // The email page and a drafted invoice have no preview that can change
    // under them; the invoice BUILDER redraws over another record, so a
    // `resampled` echo there means the redraw found nothing to draw over.
    for (const context of ['email', 'invoices'] as const) {
      expect(echoText(context, { kind: 'resampled', refreshed: 3, refused: 0 }, 'Report'), context).toBeNull();
    }
    expect(echoText('invoice-template', { kind: 'resampled', refreshed: 0, refused: 0 }, 'Template')).toBe(
      'There is no invoice here to draw a sample from.',
    );
  });
});

describe('the Ask button', () => {
  it('renders in the manager and the editor when the grant is there', async () => {
    await renderAt('/report-builder', { allowed: true, name: 'Ada' });
    expect(screen.getByTestId('ask-assistant').textContent).toContain('Ask Ada');
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/report-builder/rpt_1', { allowed: true, name: 'Ada' });
    expect(screen.getByTestId('ask-assistant')).toBeTruthy();
  });

  it('renders in neither without the grant', async () => {
    await renderAt('/report-builder', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/report-builder/rpt_1', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
  });
});
