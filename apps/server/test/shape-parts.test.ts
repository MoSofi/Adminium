// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The part files of an app built on an add-on's shape.
 *
 * The proof is the check itself: the files written from the released
 * Invoices manifest, put in a new app beside a clients table, pass
 * `adminium app check`, and the app's tables conform to the add-on's shapes
 * exactly as an install compares them.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shapeConformanceIssues } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shapesOfDocument } from '../src/apps/app-shapes.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { shapeParts } from '../src/project/apps/shape-parts.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';

const INVOICES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'manifest', 'test', 'fixtures', 'released', 'invoices-1.0.6.manifest.json'), 'utf8'),
) as Record<string, unknown>;

let root: string;
beforeEach(() => {
  root = tempProject('adminium-shape-parts-');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (file: string, value: unknown): void => {
  const path = join(root, 'apps/studio/manifest', file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

describe('the parts of an app built on a shape', () => {
  it('pass the check, conform to the add-on, and send what the shape sends', () => {
    scaffoldApp({ root, key: 'studio', name: 'Studio', sides: [], version: APP_VERSION, bare: true });
    write('tables/clients.json', {
      ref: 'clients',
      label: { 'en-US': 'Client' },
      labelPlural: { 'en-US': 'Clients' },
      keyField: 'name',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 120, default: '' },
        { ref: 'email', type: 'text', maxLength: 320, nullable: true },
      ],
    });
    write('pages/studio-clients.json', { ref: 'studio-clients', template: 'page-crud', title: { key: 'studio.clients', fallback: 'Clients' }, nav: { group: 'main', icon: 'users', order: 1 }, bindings: { rows: 'clients' } });

    const made = shapeParts({ appKey: 'studio', addOn: 'invoices', document: INVOICES, shape: 'invoice@1', recipient: { table: 'clients', email: 'email', name: 'name' } });
    if (!made.ok) throw new Error(made.problem);
    // The invoice's three parts, and the quote's two, which an invoice and its lines point at.
    expect(made.tables.map((table) => `${table.ref} ← ${table.builtOn} ${table.part}`)).toEqual([
      'invoices ← invoices/invoice@1 document',
      'invoice_lines ← invoices/invoice@1 lines',
      'invoice_payments ← invoices/invoice@1 payments',
      'quotes ← invoices/quote@1 document',
      'quote_lines ← invoices/quote@1 lines',
    ]);
    expect(made.outbox).toEqual({ table: 'messages', kinds: ['invoice-sent', 'invoice-rung-1', 'invoice-rung-2', 'invoice-rung-3', 'payment-receipt'] });
    expect(made.addOn).toEqual({ key: 'invoices', range: '>=1.0.6' });
    for (const [file, value] of Object.entries(made.files)) write(file, value);

    const check = checkApp(root, 'studio', { version: APP_VERSION });
    expect(check.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    const manifest = check.manifest as never as { requiredSchema: { tables: { ref: string; columns: { ref: string; references?: string; rules?: { rollup?: { from: string } } }[]; states?: { children?: object } }[] } };

    // Part names became the app's tables, wherever a part names one.
    const table = (ref: string) => manifest.requiredSchema.tables.find((candidate) => candidate.ref === ref)!;
    const column = (ref: string, name: string) => table(ref).columns.find((candidate) => candidate.ref === name)!;
    expect(column('invoice_lines', 'document_id').references).toBe('invoices');
    expect(column('invoices', 'from_quote_id').references).toBe('quotes');
    expect(column('invoices', 'subtotal').rules?.rollup?.from).toBe('invoice_lines');
    expect(Object.keys(table('invoices').states?.children ?? {})).toEqual(['invoice_lines', 'invoice_payments']);
    // The tables a message is made from carry the link to the person it goes to.
    expect(column('invoices', 'client_id')).toMatchObject({ type: 'fk', references: 'clients', nullable: true });
    expect(column('invoice_payments', 'client_id')).toMatchObject({ references: 'clients' });

    // The same comparison an install makes against the add-on it runs on.
    expect(shapeConformanceIssues(manifest as never, shapesOfDocument('invoices', INVOICES))).toEqual([]);
  });

  it('takes other table names, and refuses what it cannot build', () => {
    const named = shapeParts({
      appKey: 'studio',
      addOn: 'invoices',
      document: INVOICES,
      shape: 'quote@1',
      tables: { 'quote@1/document': 'offers', 'quote@1/lines': 'offer_lines' },
    });
    if (!named.ok) throw new Error(named.problem);
    // A quote sends no email: no outbox, and no recipient asked for.
    expect(named.outbox).toBeNull();
    expect(Object.keys(named.files).sort()).toEqual(['add-ons.json', 'tables/offer_lines.json', 'tables/offers.json']);

    expect(shapeParts({ appKey: 'studio', addOn: 'invoices', document: INVOICES, shape: 'invoice@1' })).toMatchObject({ ok: false, problem: expect.stringContaining('who it writes to') });
    expect(shapeParts({ appKey: 'studio', addOn: 'invoices', document: INVOICES, shape: 'receipt@9' })).toMatchObject({ ok: false, problem: expect.stringContaining('invoice@1, quote@1') });
    expect(shapeParts({ appKey: 'studio', addOn: 'x', document: { addOn: {} }, shape: 'a@1' })).toMatchObject({ ok: false, problem: expect.stringContaining('defines no shape') });
    expect(
      shapeParts({ appKey: 'studio', addOn: 'invoices', document: INVOICES, shape: 'quote@1', tables: { 'quote@1/document': 'same', 'quote@1/lines': 'same' } }),
    ).toMatchObject({ ok: false, problem: expect.stringContaining('both be the table') });
  });
});
