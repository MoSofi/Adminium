// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Derived columns in EXPORTS and scheduled reports
 * (36-derived-columns.md 36-T20 / D28).
 *
 * The owner ruled that a computed number ships in an export rather than
 * silently vanishing from it — which makes the export path a place where a
 * permission decision has to be made without a request to make it against. So
 * two properties, and the second is the one that matters:
 *
 * - an export of a page carrying `config.derived` writes the derived values,
 *   under the REQUESTING USER's grants;
 * - a job carrying no `userId` refuses every measure and writes blanks. There
 *   is nobody to check against, and a downloaded file is not a place to
 *   discover that.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportsRepo, newId, pagesRepo } from '@adminium/meta';

import { parseCsv } from '../src/data-io/csv.js';
import { type FileStore } from '../src/files/store.js';
import { createTestFileStore } from './helpers/file-store.js';
import { registerExportRunHandler } from '../src/jobs/export-run.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
import {
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';

const ITEMS = { table: 'main.invoice_items', fkColumn: 'invoice_id' } as const;

/** The page the owner actually asked about, in stored form. */
const DERIVED = {
  measures: [
    {
      id: 'subtotal',
      ...ITEMS,
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
    },
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
  ],
};

describe('exports compute a page’s derived columns', () => {
  let t: DataTestContext;
  let connId: string;
  let dataDir: string;
  let storage: FileStore;
  let registry: JobRegistry;
  let pageId: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-export-derived-'));
    storage = createTestFileStore({ dataDir });
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
    registry = createJobRegistry();
    registerExportRunHandler(registry, { meta: t.meta, manager: t.manager, storage });

    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, export: true });
    // The editor may read invoices but NOT invoice_items — the degrade case,
    // in a file rather than on a screen.
    await t.grantTable(t.roles.editor, connId, 'main.invoices', { read: true, export: true });

    const page = await pagesRepo(t.meta).create({
      id: newId('page'),
      slug: 'invoices',
      title: 'Invoices',
      type: 'page-crud',
      connectionId: connId,
      config: {
        v: 1,
        kind: 'page',
        id: 'page_invoices',
        template: 'page-crud',
        title: { key: 'pages.invoices', fallback: 'Invoices' },
        source: { connectionId: connId, table: 'main.invoices' },
        nav: { group: 'workspace', icon: 'file', order: 1, slug: 'invoices' },
        access: { minRole: 'viewer', permissions: [] },
        // The REAL envelope shape: the template body is nested under `config`
        // (41-export-builder.md §0.3). Seeding `derived` at the top level is
        // how this suite stayed green while the job read a level too high.
        config: { columns: [], derived: DERIVED },
      },
      origin: 'generated',
    });
    pageId = page.id;
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** Run one export end to end and return its parsed CSV. */
  async function exportRows(payload: Record<string, unknown>): Promise<string[][]> {
    const row = await exportsRepo(t.meta).create({
      connectionId: connId,
      requestedBy: t.users.admin.id,
      source: { kind: 'table', table: 'main.invoices' },
      format: 'csv',
    });
    const entry = registry.get('export-run');
    if (entry === undefined) throw new Error('export-run handler not registered');
    await entry.run(entry.schema.parse({ exportId: row.id, ...payload }), {
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
    const text = await readFile(storage, finished?.fileId ?? '');
    return parseCsv(text.replace(/^﻿/, ''));
  }

  it('writes the derived values into the file, under the requester’s grants', async () => {
    const rows = await exportRows({ userId: t.users.admin.id, unmasked: true, pageId });
    const header = rows[0] ?? [];
    expect(header).toContain('subtotal');
    expect(header).toContain('tax_amount');
    const invoice7 = rows.find((row) => row[0] === '7');
    expect(invoice7?.[header.indexOf('subtotal')]).toBe('1266');
    expect(invoice7?.[header.indexOf('tax_amount')]).toBe('101.28');
  });

  it('degrades for a requester who cannot read the folded table', async () => {
    const rows = await exportRows({ userId: t.users.editor.id, unmasked: false, pageId });
    const header = rows[0] ?? [];
    const invoice7 = rows.find((row) => row[0] === '7');
    // The columns are still there — the file's shape does not depend on who
    // asked — and the values are blank rather than computed.
    expect(header).toContain('subtotal');
    expect(invoice7?.[header.indexOf('subtotal')]).toBe('');
    expect(invoice7?.[header.indexOf('tax_amount')]).toBe('');
  });

  it('refuses every measure when the job carries no principal', async () => {
    const rows = await exportRows({ unmasked: true, pageId });
    const header = rows[0] ?? [];
    const invoice7 = rows.find((row) => row[0] === '7');
    expect(invoice7?.[header.indexOf('subtotal')]).toBe('');
    expect(invoice7?.[header.indexOf('tax_amount')]).toBe('');
  });

  it('is unchanged for an export that names no page', async () => {
    const rows = await exportRows({ userId: t.users.admin.id, unmasked: true });
    expect(rows[0]).not.toContain('subtotal');
    expect(rows[0]).not.toContain('tax_amount');
  });
});

async function readFile(storage: FileStore, fileId: string): Promise<string> {
  if (fileId === '') throw new Error('export produced no file');
  const chunks: Buffer[] = [];
  // The implicit destination: `destinationId: null` IS this server's disk, and
  // on it the storage key is the row id (37 D3, D19).
  for await (const chunk of await storage.read({ destinationId: null, storageKey: fileId })) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
