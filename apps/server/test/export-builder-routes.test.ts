// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The export builder's reads (41-export-builder.md §3.5): sources, views and
 * the preview, against the invoices fixture, under three principals — the
 * admin who may do everything, the editor who may read and export invoices
 * but not read invoice_items and holds no PII grant, and the viewer with no
 * export grant at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsRepo, newId, pagesRepo, viewsRepo, type JobsRepo } from '@adminium/meta';

import { type FileStore } from '../src/files/store.js';
import { createTestFileStore } from './helpers/file-store.js';
import { exportsRoutes } from '../src/routes/exports/index.js';
import { MASKED_CELL } from '../src/export/writer.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';

const ITEMS = { table: 'main.invoice_items', fkColumn: 'invoice_id' } as const;

describe('export builder reads', () => {
  let t: DataTestContext;
  let connId: string;
  let dataDir: string;
  let storage: FileStore;
  let invoicesPageId: string;
  let sharedViewId: string;

  /** A real envelope: the template body nested under `config` (41 §0.3). */
  function envelope(table: string, body: Record<string, unknown>, template = 'page-crud') {
    return {
      v: 1,
      kind: 'page',
      id: `page_${newId('page')}`,
      template,
      title: { key: 'pages.x', fallback: 'X' },
      source: { connectionId: connId, table },
      nav: { group: 'workspace', icon: 'file', order: 1, slug: 'x' },
      access: { minRole: 'viewer', permissions: [] },
      config: body,
    };
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-export-builder-'));
    storage = createTestFileStore({ dataDir });
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        const jobs: JobsRepo = jobsRepo(ctx.meta);
        const enqueue = (input: Parameters<JobsRepo['enqueue']>[0]) => jobs.enqueue(input);
        await api.register(exportsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue }));
      },
    });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, export: true });
    await t.grantTable(t.roles.editor, connId, 'main.invoices', { read: true, export: true });

    const pages = pagesRepo(t.meta);
    const invoicesPage = await pages.create({
      id: newId('page'),
      slug: 'invoices',
      title: 'Invoices',
      type: 'page-crud',
      connectionId: connId,
      config: envelope('main.invoices', {
        columns: [
          { name: 'number', label: 'Number' },
          { name: 'items_count', label: 'Items', reverse: { ...ITEMS, agg: 'count' } },
          { name: 'subtotal', label: 'Subtotal', derived: { ref: 'subtotal' } },
        ],
        derived: {
          measures: [{ id: 'subtotal', ...ITEMS, fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['line_total'] }] } }],
          fields: [],
        },
      }),
      origin: 'generated',
    });
    invoicesPageId = invoicesPage.id;
    await pages.create({
      id: newId('page'),
      slug: 'invoice',
      title: 'Invoice',
      type: 'page-record',
      connectionId: connId,
      config: envelope('main.invoices', { blocks: [] }, 'page-record'),
      origin: 'generated',
    });
    await pages.create({
      id: newId('page'),
      slug: 'items',
      title: 'Invoice items',
      type: 'page-crud',
      connectionId: connId,
      config: envelope('main.invoice_items', {
        columns: [
          { name: 'qty', label: 'Qty' },
          { name: 'invoice_number', label: 'Invoice number', lookup: { path: ['invoice_id'], select: 'number' } },
        ],
      }),
      origin: 'generated',
    });

    const views = viewsRepo(t.meta);
    const shared = await views.create({
      pageId: invoicesPageId,
      userId: null,
      kind: 'filters',
      name: 'Taxed at 8',
      config: { filters: [{ column: 'tax_rate', op: 'eq', value: 8 }], sort: null, search: '' },
      isDefault: false,
    });
    sharedViewId = shared.id;
    await views.create({
      pageId: invoicesPageId,
      userId: t.users.editor.id,
      kind: 'filters',
      name: 'Mine with a search',
      config: { filters: [], sort: null, search: 'INV' },
      isDefault: false,
    });
    await views.create({
      pageId: invoicesPageId,
      userId: t.users.admin.id,
      kind: 'filters',
      name: 'Admin only',
      config: { filters: [{ column: 'tax_rate', op: 'eq', value: 0 }], sort: null, search: '' },
      isDefault: false,
    });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function get(user: 'admin' | 'editor' | 'viewer', url: string) {
    const res = await t.app.inject({ method: 'GET', url, headers: asUser(t.users[user]) });
    return { status: res.statusCode, body: res.json() as { data?: unknown; error?: { message?: string } } };
  }

  describe('GET /exports/sources', () => {
    it('lists every table with the caller’s export grant resolved, its counts, and the pages bound to it', async () => {
      const { status, body } = await get('editor', `/api/v1/exports/sources?connectionId=${connId}`);
      expect(status).toBe(200);
      const data = body.data as {
        connection: { id: string; name: string; dialect: string };
        tables: { id: string; canExport: boolean; rowCountEstimate: number | null; columnCount: number; usedBy: number; pages: { title: string; columns: number; linked: number; totals: number }[] }[];
      };
      expect(data.connection.id).toBe(connId);
      expect(data.connection.dialect).toBe('postgres');
      const invoices = data.tables.find((table) => table.id === 'main.invoices');
      const items = data.tables.find((table) => table.id === 'main.invoice_items');
      expect(invoices?.canExport).toBe(true);
      expect(items?.canExport).toBe(false);
      // No estimate in the snapshot → a bounded COUNT for an exportable table.
      expect(invoices?.rowCountEstimate).toBe(3);
      // Secret columns are not selectable, so they are not counted.
      expect(invoices?.columnCount).toBe(4);
      // Two pages are bound to invoices; one of them has a column list.
      expect(invoices?.usedBy).toBe(2);
      expect(invoices?.pages).toEqual([{ id: invoicesPageId, title: 'Invoices', columns: 3, linked: 0, totals: 2 }]);
      expect(items?.pages).toEqual([expect.objectContaining({ title: 'Invoice items', columns: 2, linked: 1, totals: 0 })]);
    });

    it('answers a caller with no export grant with every table locked, not with a 403', async () => {
      const { status, body } = await get('viewer', `/api/v1/exports/sources?connectionId=${connId}`);
      expect(status).toBe(200);
      const tables = (body.data as { tables: { canExport: boolean }[] }).tables;
      expect(tables.length).toBeGreaterThan(0);
      expect(tables.every((table) => !table.canExport)).toBe(true);
    });
  });

  describe('GET /exports/views', () => {
    it('lists the table’s own and shared views with filters, the search flag and an exact count', async () => {
      const { status, body } = await get('editor', `/api/v1/exports/views?connectionId=${connId}&table=main.invoices`);
      expect(status).toBe(200);
      const views = (body.data as { views: { id: string; name: string; filterCount: number; hasSearch: boolean; rowCount: number | null; filters: unknown[]; pageTitle: string }[] }).views;
      expect(views.map((view) => view.name).sort()).toEqual(['Mine with a search', 'Taxed at 8']);
      const shared = views.find((view) => view.id === sharedViewId);
      expect(shared).toMatchObject({ filterCount: 1, hasSearch: false, rowCount: 2, pageTitle: 'Invoices' });
      expect(shared?.filters).toEqual([{ column: 'tax_rate', op: 'eq', value: 8 }]);
      expect(views.find((view) => view.name === 'Mine with a search')).toMatchObject({ filterCount: 0, hasSearch: true, rowCount: 3 });
    });

    it('refuses a table the caller may not export, and names an unknown one', async () => {
      expect((await get('editor', `/api/v1/exports/views?connectionId=${connId}&table=main.invoice_items`)).status).toBe(403);
      expect((await get('admin', `/api/v1/exports/views?connectionId=${connId}&table=main.nope`)).status).toBe(404);
    });
  });

  describe('POST /exports/preview', () => {
    const DEFINITION = {
      kind: 'table',
      table: 'main.invoices',
      columns: [
        { name: 'number', label: 'Invoice number' },
        { name: 'contact_email', label: 'Contact email' },
        { name: 'items_count', label: 'Invoice items count', reverse: { ...ITEMS, agg: 'count' } },
        { name: 'subtotal', label: 'Sum of line total', derived: { ref: 'subtotal' } },
      ],
      derived: {
        measures: [{ id: 'subtotal', ...ITEMS, fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['line_total'] }] } }],
        fields: [],
      },
    };

    async function preview(user: 'admin' | 'editor' | 'viewer', body: Record<string, unknown>) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports/preview',
        headers: asUser(t.users[user]),
        payload: { connectionId: connId, format: 'csv', sampleRows: 20, ...body },
      });
      return { status: res.statusCode, body: res.json() as { data?: Record<string, unknown>; error?: { message?: string } } };
    }

    it('reads the sample through the writer: cells as the file writes them, raw lines as the file’s first lines', async () => {
      const { status, body } = await preview('admin', { source: DEFINITION });
      expect(status).toBe(200);
      const data = body.data as { columns: { header: string; kind: string; masked: boolean; numeric: boolean }[]; rows: string[][]; raw: string[]; rowCount: number; rowCountKind: string; estimatedBytes: number; sampleRows: number };
      expect(data.columns.map((column) => [column.header, column.kind, column.masked])).toEqual([
        ['Invoice number', 'base', false],
        ['Contact email', 'base', false],
        ['Invoice items count', 'count', false],
        ['Sum of line total', 'measure', false],
      ]);
      expect(data.rows).toEqual([
        ['INV-007', 'ada@example.test', '2', '1266'],
        ['INV-008', '', '1', '120'],
        ['INV-009', '', '0', '0'],
      ]);
      expect(data.raw).toEqual([
        'Invoice number,Contact email,Invoice items count,Sum of line total',
        'INV-007,ada@example.test,2,1266',
        'INV-008,,1,120',
        'INV-009,,0,0',
      ]);
      expect(data.sampleRows).toBe(3);
      expect(data.rowCount).toBe(3);
      expect(data.rowCountKind).toBe('exact');
      expect(data.estimatedBytes).toBeGreaterThan(0);
    });

    it('shows a low-privilege caller exactly what their file will hold — bullets, marked masked', async () => {
      const { status, body } = await preview('editor', { source: DEFINITION });
      expect(status).toBe(200);
      const data = body.data as { columns: { header: string; masked: boolean }[]; rows: string[][] };
      expect(data.columns.filter((column) => column.masked).map((column) => column.header)).toEqual([
        'Contact email',
        'Invoice items count',
        'Sum of line total',
      ]);
      expect(data.rows[0]).toEqual(['INV-007', MASKED_CELL, MASKED_CELL, MASKED_CELL]);
    });

    it('previews JSON Lines and a switched-off header row', async () => {
      const jsonl = await preview('admin', { source: DEFINITION, format: 'json' });
      const raw = (jsonl.body.data as { raw: string[] }).raw;
      expect(raw).toHaveLength(3);
      expect(JSON.parse(raw[0] ?? '')).toEqual({
        'Invoice number': 'INV-007',
        'Contact email': 'ada@example.test',
        'Invoice items count': 2,
        'Sum of line total': 1266,
      });
      const bare = await preview('admin', { source: { ...DEFINITION, options: { headerRow: false } } });
      expect((bare.body.data as { raw: string[] }).raw[0]).toBe('INV-007,ada@example.test,2,1266');
    });

    it('counts exactly under a view’s filters, and previews a header-only file for an empty scope', async () => {
      const filtered = await preview('admin', {
        source: { ...DEFINITION, filters: [{ column: 'tax_rate', op: 'eq', value: 8 }] },
      });
      const data = filtered.body.data as { rows: string[][]; rowCount: number; rowCountKind: string };
      expect(data.rows).toHaveLength(2);
      expect(data.rowCount).toBe(2);
      expect(data.rowCountKind).toBe('exact');

      const empty = await preview('admin', {
        source: { ...DEFINITION, filters: [{ column: 'tax_rate', op: 'eq', value: 99 }] },
      });
      const none = empty.body.data as { rows: string[][]; raw: string[]; rowCount: number; estimatedBytes: number };
      expect(none.rows).toEqual([]);
      expect(none.raw).toEqual(['Invoice number,Contact email,Invoice items count,Sum of line total']);
      expect(none.rowCount).toBe(0);
    });

    it('refuses a page-author mistake and a caller without the export grant', async () => {
      const dupes = await preview('admin', {
        source: { kind: 'table', table: 'main.invoices', columns: [{ name: 'number', label: 'A' }, { name: 'tax_rate', label: 'a' }] },
      });
      expect(dupes.status).toBe(422);
      expect((await preview('viewer', { source: DEFINITION })).status).toBe(403);
    });

    it('does not spend the data-io bucket (ten an hour is for files, not samples)', async () => {
      for (let i = 0; i < 12; i += 1) {
        expect((await preview('editor', { source: DEFINITION })).status).toBe(200);
      }
    });
  });
});
