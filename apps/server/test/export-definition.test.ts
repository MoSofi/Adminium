// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A builder-made export DEFINITION through the real route and the real job
 * (41-export-builder.md §3.3, §3.4, D1, D6, D7, §5).
 *
 * The properties that matter, each pinned below:
 *
 * - the file's header row is the definition's LABELS in the definition's
 *   ORDER, and a linked value, a count, a fold, an arithmetic field and a
 *   text rule all land under theirs;
 * - a caller without the PII grant gets `•••••` for a masked column, and a
 *   caller who may not read the folded table gets `•••••` for the count, the
 *   fold and every field that reads them — never a blank that could pass for
 *   null, and never a failed job (the masked base column rides outside
 *   `select=`, 0.3);
 * - JSON Lines is keyed by header, with numbers spliced unquoted;
 * - the header row can be switched off and the file named;
 * - a page-author mistake is a 422 on the request, not a failed row;
 * - a definition row ignores a `pageId` on the job payload, so a page's
 *   derived block is never computed twice under two alias sets.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportsRepo, jobsRepo, newId, pagesRepo, type Job, type JobsRepo } from '@adminium/meta';

import { parseCsv } from '../src/data-io/csv.js';
import { type FileStore } from '../src/files/store.js';
import { createTestFileStore } from './helpers/file-store.js';
import { registerExportRunHandler } from '../src/jobs/export-run.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
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

/** The invoices definition: a base column of each kind the builder can add. */
const DERIVED = {
  measures: [
    { id: 'subtotal', ...ITEMS, fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['line_total'] }] } },
  ],
  fields: [
    {
      id: 'tax_amount',
      scale: 2,
      expr: {
        op: 'mul',
        args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
      },
    },
    {
      id: 'shipping',
      scale: 0,
      result: 'text',
      expr: {
        cases: [{ when: { left: { measure: 'subtotal' }, cmp: 'gt', right: { lit: '1000' } }, then: { text: 'Waived' } }],
        else: { text: 'Standard' },
      },
    },
  ],
};

const COLUMNS = [
  { name: 'number', label: 'Invoice number' },
  { name: 'tax_rate', label: 'Tax rate' },
  { name: 'contact_email', label: 'Contact email' },
  { name: 'items_count', label: 'Invoice items count', reverse: { ...ITEMS, agg: 'count' as const } },
  { name: 'subtotal', label: 'Sum of line total', derived: { ref: 'subtotal' } },
  { name: 'tax_amount', label: 'Tax amount', derived: { ref: 'tax_amount' } },
  { name: 'shipping', label: 'Shipping', derived: { ref: 'shipping' } },
];

describe('export definitions (route + job)', () => {
  let t: DataTestContext;
  let connId: string;
  let dataDir: string;
  let storage: FileStore;
  let registry: JobRegistry;
  let jobs: JobsRepo;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-export-definition-'));
    storage = createTestFileStore({ dataDir });
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        jobs = jobsRepo(ctx.meta);
        const enqueue = (input: Parameters<JobsRepo['enqueue']>[0]) => jobs.enqueue(input);
        await api.register(exportsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue }));
      },
    });
    registry = createJobRegistry();
    registerExportRunHandler(registry, { meta: t.meta, manager: t.manager, storage });

    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, export: true });
    // The editor may read and export invoices, but may NOT read invoice_items
    // and holds no PII grant — the degrade case, in a file.
    await t.grantTable(t.roles.editor, connId, 'main.invoices', { read: true, export: true });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function runNextJob(): Promise<Job> {
    const claimed = await jobs.claim('test-worker');
    if (claimed === null) throw new Error('no claimable job');
    const entry = registry.get(claimed.kind);
    if (entry === undefined) throw new Error(`no handler for ${claimed.kind}`);
    await entry.run(entry.schema.parse(claimed.payload), {
      jobId: claimed.id,
      kind: claimed.kind,
      attempt: claimed.attempts,
      maxAttempts: claimed.maxAttempts,
      signal: new AbortController().signal,
      progress: () => undefined,
      log: () => undefined,
    });
    await jobs.complete(claimed.id);
    const after = await jobs.findById(claimed.id);
    if (after === null) throw new Error('job vanished');
    return after;
  }

  async function readFile(fileId: string): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.read({ destinationId: null, storageKey: fileId })) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** POST the definition as `user`, run the job, and return the file's text. */
  async function exportFile(
    user: 'admin' | 'editor',
    body: Record<string, unknown>,
  ): Promise<{ text: string; filename: string | null }> {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: asUser(t.users[user]),
      payload: { connectionId: connId, format: 'csv', ...body },
    });
    expect(res.statusCode, res.body).toBe(202);
    const created = res.json().data as { id: string };
    await runNextJob();
    const finished = await exportsRepo(t.meta).findById(created.id);
    expect(finished?.status, finished?.error ?? '').toBe('ready');
    const view = (
      await t.app.inject({ method: 'GET', url: `/api/v1/exports/${created.id}`, headers: asUser(t.users[user]) })
    ).json().data as { filename: string | null };
    return { text: await readFile(finished?.fileId ?? ''), filename: view.filename };
  }

  const csvRows = (text: string): string[][] => parseCsv(text.replace(/^\uFEFF/, ''));

  it('writes labels as the header, in order, with every kind of column under its own', async () => {
    const { text, filename } = await exportFile('admin', {
      source: { kind: 'table', table: 'main.invoices', columns: COLUMNS, derived: DERIVED, options: { fileName: 'Invoices Q3.csv' } },
    });
    expect(filename).toBe('Invoices Q3.csv');
    const rows = csvRows(text);
    expect(rows[0]).toEqual([
      'Invoice number',
      'Tax rate',
      'Contact email',
      'Invoice items count',
      'Sum of line total',
      'Tax amount',
      'Shipping',
    ]);
    const byNumber = new Map(rows.slice(1).map((row) => [row[0], row]));
    expect(byNumber.get('INV-007')).toEqual(['INV-007', '8', 'ada@example.test', '2', '1266', '101.28', 'Waived']);
    expect(byNumber.get('INV-008')).toEqual(['INV-008', '8', '', '1', '120', '9.60', 'Standard']);
    // No line items: the count is 0, the sum is zero (D18), the rule reads it.
    expect(byNumber.get('INV-009')).toEqual(['INV-009', '0', '', '0', '0', '0.00', 'Standard']);
  });

  it('writes bullets for what the caller may not read, and never fails the job', async () => {
    const { text } = await exportFile('editor', {
      source: { kind: 'table', table: 'main.invoices', columns: COLUMNS, derived: DERIVED },
    });
    const rows = csvRows(text);
    const invoice7 = rows.find((row) => row[0] === 'INV-007');
    // The masked column, the refused count, the refused fold and both fields
    // that read it: every one is `•••••`, none is an empty string.
    expect(invoice7).toEqual(['INV-007', '8', MASKED_CELL, MASKED_CELL, MASKED_CELL, MASKED_CELL, MASKED_CELL]);
  });

  it('writes JSON Lines keyed by header with numbers unquoted', async () => {
    const { text, filename } = await exportFile('admin', {
      format: 'json',
      source: { kind: 'table', table: 'main.invoices', columns: COLUMNS, derived: DERIVED, options: { fileName: 'invoices' } },
    });
    expect(filename).toBe('invoices.jsonl');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    const first = lines.find((line) => line.includes('INV-007')) ?? '';
    expect(first).toContain('"Sum of line total":1266');
    expect(first).toContain('"Tax amount":101.28');
    expect(first).toContain('"Tax rate":8');
    expect(JSON.parse(first)).toEqual({
      'Invoice number': 'INV-007',
      'Tax rate': 8,
      'Contact email': 'ada@example.test',
      'Invoice items count': 2,
      'Sum of line total': 1266,
      'Tax amount': 101.28,
      Shipping: 'Waived',
    });
    const ninth = lines.find((line) => line.includes('INV-009')) ?? '';
    expect(JSON.parse(ninth)['Contact email']).toBeNull();
  });

  it('honours a switched-off header row', async () => {
    const { text } = await exportFile('admin', {
      source: {
        kind: 'table',
        table: 'main.invoices',
        columns: [{ name: 'number', label: 'Invoice number' }],
        options: { headerRow: false },
      },
    });
    const rows = csvRows(text);
    expect(rows[0]).toEqual(['INV-007']);
    expect(rows).toHaveLength(3);
  });

  it('follows a link outward and writes the reached value under its label', async () => {
    const { text } = await exportFile('admin', {
      source: {
        kind: 'table',
        table: 'main.invoice_items',
        columns: [
          { name: 'qty', label: 'Qty' },
          { name: 'invoice_number', label: 'Invoice number', lookup: { path: ['invoice_id'], select: 'number' } },
        ],
      },
    });
    const rows = csvRows(text);
    expect(rows[0]).toEqual(['Qty', 'Invoice number']);
    expect(rows.slice(1)).toEqual([
      ['2', 'INV-007'],
      ['1', 'INV-007'],
      ['3', 'INV-008'],
    ]);
  });

  describe('a page-author mistake is a 422 on the request', () => {
    // As the EDITOR: every refusal below is decided before the folded table's
    // grant matters, and the `data-io` bucket is 10 requests an hour per
    // principal (plugins/core.ts) — the admin's are spent on the files above.
    async function post(source: Record<string, unknown>): Promise<{ status: number; message: string }> {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.editor),
        payload: { connectionId: connId, format: 'csv', source: { kind: 'table', table: 'main.invoices', ...source } },
      });
      const body = res.json() as { error?: { message?: string } };
      return { status: res.statusCode, message: body.error?.message ?? '' };
    }

    it('a header used twice', async () => {
      const out = await post({ columns: [{ name: 'number', label: 'Ref' }, { name: 'tax_rate', label: ' ref ' }] });
      expect(out.status).toBe(422);
      expect(out.message).toContain('used twice');
    });

    it('an empty column list', async () => {
      expect((await post({ columns: [] })).status).toBe(422);
    });

    it('an unknown column and a secret column', async () => {
      expect((await post({ columns: [{ name: 'nope', label: 'Nope' }] })).status).toBe(422);
      expect((await post({ columns: [{ name: 'api_secret', label: 'Secret' }] })).status).toBe(422);
    });

    it('a reference to a measure the export does not define', async () => {
      const out = await post({ columns: [{ name: 'x', label: 'X', derived: { ref: 'ghost' } }] });
      expect(out.status).toBe(422);
      expect(out.message).toContain('ghost');
    });

    it('a file name with nothing usable in it', async () => {
      expect((await post({ columns: [{ name: 'number', label: 'N' }], options: { fileName: '...' } })).status).toBe(422);
    });

    it('a derived block the page parser refuses', async () => {
      const out = await post({
        columns: [{ name: 'number', label: 'N' }],
        derived: { measures: [], fields: [{ id: 'bad', scale: 2, expr: { op: 'div', args: [{ col: 'tax_rate' }, { col: 'tax_rate' }] } }] },
      });
      expect(out.status).toBe(422);
    });

    it('never leaves a row behind', async () => {
      const before = (await exportsRepo(t.meta).list({ requestedBy: t.users.editor.id, limit: 200 })).length;
      await post({ columns: [] });
      const after = (await exportsRepo(t.meta).list({ requestedBy: t.users.editor.id, limit: 200 })).length;
      expect(after).toBe(before);
    });
  });

  it('a definition row ignores a page id on the job payload', async () => {
    // A page whose derived block defines the SAME `subtotal` id: threading it
    // as well would claim the alias twice and 422 the read (41 §0.3).
    const page = await pagesRepo(t.meta).create({
      id: newId('page'),
      slug: `invoices-${newId('page')}`,
      title: 'Invoices',
      type: 'page-crud',
      connectionId: connId,
      config: {
        v: 1,
        kind: 'page',
        id: 'page_invoices_dup',
        template: 'page-crud',
        title: { key: 'pages.invoices', fallback: 'Invoices' },
        source: { connectionId: connId, table: 'main.invoices' },
        nav: { group: 'workspace', icon: 'file', order: 1, slug: 'invoices' },
        access: { minRole: 'viewer', permissions: [] },
        derived: DERIVED,
        columns: [],
      },
      origin: 'generated',
    });
    const row = await exportsRepo(t.meta).create({
      connectionId: connId,
      requestedBy: t.users.admin.id,
      source: { kind: 'table', table: 'main.invoices', columns: COLUMNS, derived: DERIVED },
      format: 'csv',
    });
    const entry = registry.get('export-run');
    if (entry === undefined) throw new Error('export-run handler not registered');
    await entry.run(entry.schema.parse({ exportId: row.id, userId: t.users.admin.id, unmasked: true, pageId: page.id }), {
      jobId: 'job_test',
      kind: 'export-run',
      attempt: 1,
      maxAttempts: 1,
      signal: new AbortController().signal,
      progress: () => undefined,
      log: () => undefined,
    });
    const finished = await exportsRepo(t.meta).findById(row.id);
    expect(finished?.status, finished?.error ?? '').toBe('ready');
    const rows = csvRows(await readFile(finished?.fileId ?? ''));
    expect(rows[0]?.filter((header) => header === 'Sum of line total')).toHaveLength(1);
  });
});
