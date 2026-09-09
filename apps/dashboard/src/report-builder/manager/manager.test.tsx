// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report manager (43-report-builder.md 43-T05 done-when; Appendix A
 * M1–M17), rendered through the real router and shell so the topbar's
 * published actions, the toasts and the navigation are the product's own. The
 * API is a fetch stub keyed on the routes the manager calls; the fixtures are
 * the comp's seed (556-558): four templates and four reports.
 *
 * The assertions that carry the wave: the tab badges NEVER respond to the
 * search box (580); the card's meta line differs by tab while the row's sub
 * does not (585); a rename never changes the card's glyph (43 D14, the comp's
 * `starterIconFor` defect); and the four empty states are the comp's copy.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ReportDetail, ReportDocumentKind, ReportStatus, ReportSummary, ReportSummaryFacts } from '../api.js';
import { emptyBody } from '../model/envelope.js';
import { MANAGER_PREFS_KEY } from './useManagerPrefs.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const DAY = 24 * 3600_000;

function facts(over: Partial<ReportSummaryFacts> = {}): ReportSummaryFacts {
  return {
    reportTitle: 'Q3 2026 Executive Summary',
    kicker: 'Quarterly report',
    accent: '#4f46e5',
    blockCount: 4,
    kpiCount: 3,
    series: [52, 68, 60, 82, 74, 96],
    starterIcon: 'briefcase',
    ...over,
  };
}

function row(kind: ReportDocumentKind, id: string, name: string, status: ReportStatus, summary: Partial<ReportSummaryFacts> = {}, updatedAt = Date.now() - 2 * DAY): ReportSummary {
  return { id, kind, name, status, starter: 'exec', originId: null, createdAt: 1, updatedAt, summary: facts(summary) };
}

/** The comp's `seedData()` (556-558). */
function seedTemplates(): ReportSummary[] {
  return [
    row('template', 'tpl-exec', 'Executive summary', 'live'),
    row('template', 'tpl-weekly', 'Weekly digest', 'live', { reportTitle: 'Week 28 Digest', kicker: 'Weekly update', blockCount: 3, starterIcon: 'calendar-days' }),
    row('template', 'tpl-score', 'KPI scorecard', 'live', { reportTitle: 'Company Scorecard', kicker: 'Scorecard', blockCount: 2, starterIcon: 'gauge' }),
    row('template', 'tpl-sales', 'Sales report', 'draft', { reportTitle: 'Sales Performance', kicker: 'Sales', accent: '#0d9488', blockCount: 3, starterIcon: 'trending-up' }),
  ];
}

function seedReports(): ReportSummary[] {
  return [
    row('report', 'doc-q3', 'Q3 Executive Summary', 'sent'),
    row('report', 'doc-mbr', 'July Business Review', 'draft', { reportTitle: 'July Business Review', kicker: 'Monthly review', blockCount: 5, starterIcon: 'presentation' }),
    row('report', 'doc-inc', 'INC-482 Postmortem', 'live', { reportTitle: 'INC-482 Postmortem', kicker: 'Postmortem', accent: '#e5484d', blockCount: 3, starterIcon: 'shield-alert' }),
    row('report', 'doc-pl', 'July P&L', 'live', { reportTitle: 'P&L Statement', kicker: 'Finance', blockCount: 2, starterIcon: 'landmark' }),
  ];
}

function detail(summary: ReportSummary): ReportDetail {
  return { ...summary, body: emptyBody() };
}

interface Fixture {
  templates?: ReportSummary[];
  reports?: ReportSummary[];
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response;
}

function stubFetch(fixture: Fixture) {
  const calls: Call[] = [];
  const templates = fixture.templates ?? [];
  const reports = fixture.reports ?? [];
  const all = () => [...templates, ...reports];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
    }
    if (method === 'GET' && (url === '/api/v1/report-documents' || url.startsWith('/api/v1/report-documents?'))) {
      const kind = new URL(url, 'http://test').searchParams.get('kind');
      const items = kind === 'report' ? reports : kind === 'template' ? templates : all();
      return Promise.resolve(jsonResponse(200, { items, counts: { template: templates.length, report: reports.length } }));
    }
    if (url === '/api/v1/report-documents/starters') {
      return Promise.resolve(
        jsonResponse(200, {
          starters: [
            { key: 'exec', name: 'Executive summary', category: 'leadership', icon: 'briefcase', reportTitle: 'Q3 2026 Executive Summary', accent: '#4f46e5', blockCount: 4, series: [52, 68, 60, 82, 74, 96] },
          ],
        }),
      );
    }
    if (url === '/api/v1/report-documents' && method === 'POST') {
      const input = body as { kind: ReportDocumentKind; starter: string | null };
      return Promise.resolve(jsonResponse(201, detail({ ...row(input.kind, 'new_1', 'Executive summary', 'draft'), starter: input.starter })));
    }
    const one = /^\/api\/v1\/report-documents\/([^/?]+)$/.exec(url);
    if (one !== null && method === 'GET') {
      const found = all().find((doc) => doc.id === one[1]) ?? row('template', one[1] ?? '', 'Executive summary', 'draft');
      return Promise.resolve(jsonResponse(200, detail(found)));
    }
    if (one !== null && method === 'PATCH') {
      const list = templates.some((doc) => doc.id === one[1]) ? templates : reports;
      const index = list.findIndex((doc) => doc.id === one[1]);
      const found = list[index] ?? row('template', one[1] ?? '', 'x', 'draft');
      const next = { ...found, ...(body as object) };
      // The stub is the store: the manager re-reads the list after a rename,
      // and a stub that answered the PATCH but kept the old row would make
      // "the name changed on screen" untestable.
      if (index !== -1) list[index] = next;
      return Promise.resolve(jsonResponse(200, next));
    }
    if (one !== null && method === 'DELETE') return Promise.resolve(emptyResponse(204));
    const duplicate = /^\/api\/v1\/report-documents\/([^/?]+)\/duplicate$/.exec(url);
    if (duplicate !== null && method === 'POST') {
      const found = all().find((doc) => doc.id === duplicate[1]) ?? row('template', duplicate[1] ?? '', 'x', 'draft');
      return Promise.resolve(jsonResponse(201, detail({ ...found, id: `${found.id}_copy`, name: `${found.name} (copy)`, status: 'draft' })));
    }
    const fromTemplate = /^\/api\/v1\/report-documents\/([^/?]+)\/from-template$/.exec(url);
    if (fromTemplate !== null && method === 'POST') {
      return Promise.resolve(jsonResponse(201, detail(row('report', 'from_tpl_1', 'Executive summary', 'draft'))));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(fixture: Fixture = {}, path = '/report-builder') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('report-toolbar');
  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });
  return { ...stub, queryClient, router, view, user: userEvent.setup() };
}

function cardNames(): string[] {
  return screen.getAllByTestId('report-card-name').map((el) => el.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the manager’s two trays (M4)', () => {
  it('opens on Templates, counts both kinds, and switches on the tab', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), reports: seedReports() });
    const templatesTab = screen.getByRole('tab', { name: /Templates/ });
    expect(templatesTab.getAttribute('aria-selected')).toBe('true');
    expect(templatesTab.textContent).toContain('4');
    expect(cardNames()).toEqual(['Executive summary', 'Weekly digest', 'KPI scorecard', 'Sales report']);

    await user.click(screen.getByRole('tab', { name: /Reports/ }));
    await waitFor(() => {
      expect(cardNames()).toEqual(['Q3 Executive Summary', 'July Business Review', 'INC-482 Postmortem', 'July P&L']);
    });
    // The primary follows the tab (601).
    expect(screen.getByTestId('report-new').textContent).toBe('New report');
  });

  it('the counts NEVER respond to the search box (580)', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), reports: seedReports() });
    const count = () => screen.getByRole('tab', { name: /Templates/ }).textContent ?? '';
    expect(count()).toContain('4');
    await user.type(screen.getByRole('searchbox'), 'weekly');
    await waitFor(() => {
      expect(cardNames()).toEqual(['Weekly digest']);
    });
    expect(count()).toContain('4');
    expect(screen.getByRole('tab', { name: /Reports/ }).textContent).toContain('4');
  });

  it('searches name, report title and kicker — the comp’s three fields (548)', async () => {
    const { user } = await renderPage({ templates: seedTemplates() });
    const box = screen.getByRole('searchbox');
    // By the document's TITLE, which is not in any name.
    await user.type(box, 'Company Scorecard');
    await waitFor(() => {
      expect(cardNames()).toEqual(['KPI scorecard']);
    });
    await user.clear(box);
    // By the KICKER.
    await user.type(box, 'weekly update');
    await waitFor(() => {
      expect(cardNames()).toEqual(['Weekly digest']);
    });
  });
});

describe('the card and the row (M10, M11)', () => {
  it('the card’s meta is "N blocks" on Templates and "{kicker} · N blocks" on Reports (585)', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), reports: seedReports() });
    expect(screen.getAllByTestId('report-card-meta')[0]?.textContent).toBe('4 blocks');
    await user.click(screen.getByRole('tab', { name: /Reports/ }));
    await waitFor(() => {
      expect(screen.getAllByTestId('report-card-meta')[0]?.textContent).toBe('Quarterly report · 4 blocks');
    });
  });

  it('the row’s sub is "{reportTitle} · N blocks" on BOTH tabs, and the list keeps the comp’s four columns', async () => {
    const { user } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const table = await screen.findByTestId('report-list');
    expect(within(table).getAllByRole('columnheader').map((el) => el.textContent)).toEqual(['Name', 'Status', 'Updated', 'Actions']);
    expect(screen.getAllByTestId('report-row-sub')[0]?.textContent).toBe('Q3 2026 Executive Summary · 4 blocks');
    // The layout is remembered per browser (S4).
    expect(window.localStorage.getItem(MANAGER_PREFS_KEY)).toContain('list');
  });

  it('the thumbnail draws the summary’s KPI boxes and series, never the body (D16)', async () => {
    await renderPage({ templates: seedTemplates() });
    const preview = screen.getAllByTestId('report-mini-preview')[0] as HTMLElement;
    expect(within(preview).getByTestId('report-mini-title').textContent).toBe('Q3 2026 Executive Summary');
    expect(within(preview).getByTestId('report-mini-kpis').children).toHaveLength(3);
    expect(within(preview).getByTestId('report-mini-bars').children).toHaveLength(6);
  });

  it('the status pill reads the comp’s three labels; `sent` is *Published* (D22)', async () => {
    const { user } = await renderPage({ templates: seedTemplates(), reports: seedReports() });
    expect(screen.getAllByTestId('report-status').map((el) => el.textContent)).toEqual(['Live', 'Live', 'Live', 'Draft']);
    await user.click(screen.getByRole('tab', { name: /Reports/ }));
    await waitFor(() => {
      expect(screen.getAllByTestId('report-status').map((el) => el.textContent)).toEqual(['Published', 'Draft', 'Live', 'Live']);
    });
  });
});

describe('rename, duplicate, delete (M12–M14)', () => {
  it('renames in place — Enter commits, an empty name becomes Untitled (562)', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates() });
    const card = screen.getAllByTestId('report-card')[0] as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Rename' }));
    const input = await screen.findByTestId('report-rename');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && (c.body as { name: string }).name === 'Untitled')).toBe(true);
    });
  });

  it('the card’s glyph rides the ROW, not a title match — the comp’s `starterIconFor` defect (D14)', async () => {
    // Two documents whose report TITLE is identical and whose starter differs.
    // The comp finds a card's icon by matching `reportTitle` against the starter
    // table (697), so it would draw the same glyph for both — and a rename of the
    // title would silently change it. Here the icon is a summary field.
    await renderPage({
      templates: [
        row('template', 'a', 'A', 'draft', { reportTitle: 'Same title', starterIcon: 'briefcase' }),
        row('template', 'b', 'B', 'draft', { reportTitle: 'Same title', starterIcon: 'gauge' }),
      ],
    });
    const cards = screen.getAllByTestId('report-card');
    const glyph = (card: HTMLElement) => card.querySelector('svg')?.outerHTML ?? '';
    expect(glyph(cards[0] as HTMLElement)).not.toBe('');
    expect(glyph(cards[0] as HTMLElement)).not.toBe(glyph(cards[1] as HTMLElement));
  });

  it('Escape cancels the rename without a PATCH', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates() });
    const card = screen.getAllByTestId('report-card')[0] as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Rename' }));
    const input = await screen.findByTestId('report-rename');
    await user.clear(input);
    await user.type(input, 'nope{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('report-rename')).toBeNull();
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('duplicate posts and offers Undo; delete asks first and hard-deletes (D8, D9)', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates() });
    const card = screen.getAllByTestId('report-card')[0] as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/duplicate') && c.method === 'POST')).toBe(true);
    });
    expect(await screen.findByText('Duplicated Executive summary')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();

    await user.click(within(screen.getAllByTestId('report-card')[0] as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect((await screen.findByTestId('report-delete-body')).textContent).toBe('This can’t be undone. The template will be permanently removed.');
    await user.click(screen.getByTestId('report-delete-confirm'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });
});

describe('the empty states (M8) and the New modal (M15)', () => {
  it('carries the comp’s four copies verbatim (600)', async () => {
    const { user } = await renderPage({ templates: [], reports: [] });
    expect((await screen.findByTestId('report-empty')).textContent).toContain('No templates yet');
    expect(screen.getByTestId('report-empty').textContent).toContain('Create a reusable report layout your team can build from.');

    await user.click(screen.getByRole('tab', { name: /Reports/ }));
    await waitFor(() => {
      expect(screen.getByTestId('report-empty').textContent).toContain('No reports yet');
    });
    expect(screen.getByTestId('report-empty').textContent).toContain('Build your first report from a template or a blank canvas.');
  });

  it('the searching variants replace both halves', async () => {
    const { user } = await renderPage({ templates: seedTemplates() });
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    const empty = await screen.findByTestId('report-empty');
    await waitFor(() => {
      expect(empty.textContent).toContain('No templates match');
    });
    expect(empty.textContent).toContain('Try a different search term.');
  });

  it('the New modal offers a blank tile plus the starters, and creates on a pick', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByTestId('report-new'));
    const grid = await screen.findByTestId('report-new-grid');
    const tiles = within(grid).getAllByTestId('report-starter');
    expect(tiles[0]?.textContent).toContain('Blank report');
    expect(tiles[1]?.textContent).toContain('Executive summary');
    expect(tiles[1]?.textContent).toContain('Leadership · 4 blocks');
    await user.click(tiles[1] as HTMLElement);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/report-documents' && (c.body as { starter: string }).starter === 'exec')).toBe(true);
    });
  });

  it('on the Reports tab it adds *Your templates* — the flow the comp promises and never wires (D6/O3)', async () => {
    const { user, calls } = await renderPage({ templates: seedTemplates(), reports: seedReports() }, '/report-builder?kind=report');
    await user.click(screen.getByTestId('report-new'));
    const section = await screen.findByTestId('report-your-templates');
    expect(within(section).getAllByTestId('report-from-template')).toHaveLength(4);
    await user.click(within(section).getAllByTestId('report-from-template')[0] as HTMLElement);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/from-template'))).toBe(true);
    });
  });

  it('the Templates tab has no *Your templates* group', async () => {
    const { user } = await renderPage({ templates: seedTemplates() });
    await user.click(screen.getByTestId('report-new'));
    await screen.findByTestId('report-new-grid');
    expect(screen.queryByTestId('report-your-templates')).toBeNull();
  });
});
