// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on may work with another when it is there: it suggests it, never
 * needs it. A document the other draws is made when that add-on arrives, an
 * email that carries one must be able to go without it, and a list may read
 * an add-on's rows by the table-and-row pair that add-on keeps.
 */
import { describe, expect, it } from 'vitest';

import { emailRowsDataSchema, installFloorWords, pairSourceSchema, slotMappingSchema, validateManifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const NEED = { key: 'invoices', range: '>=1.0.8', reason: { 'en-US': 'Prints purchase orders.' } };
const DOCUMENT = { kind: 'purchase-order', addOn: 'invoices', table: 'items', name: 'Purchase order', mapping: { title: { column: 'name' } } };
const TEMPLATE = (attach: Doc) => ({ key: 'kit-order', name: 'Order', attach, locales: { 'en-US': { subject: 'Your order', blocks: [{ block: 'email.text', data: { text: 'Attached.' } }] } } });

const kit = (over: Doc = {}): Doc => ({ ...structuredClone(KIT), ...over });

describe('an add-on and another add-on', () => {
  it('an add-on may suggest, never require', () => {
    expect(issuesOf(kit({ addOns: { suggests: [NEED] } }))).toBe('');
    expect(issuesOf(kit({ addOns: { requires: [NEED] } }))).toContain('Unrecognized key');
    expect(issuesOf(kit({ addOns: { suggests: [{ ...NEED, key: 'kit' }] } }))).toContain('does not need itself');
  });

  it('a document of another add-on must be suggested; its own it draws itself', () => {
    expect(issuesOf(kit({ documents: [DOCUMENT] }))).toContain('documents.0.addOn: "invoices" is neither required nor suggested');
    expect(issuesOf(kit({ documents: [DOCUMENT], addOns: { suggests: [NEED] } }))).toBe('');
    expect(issuesOf(kit({ documents: [{ ...DOCUMENT, addOn: 'kit' }] }))).toBe('');
  });

  it('its attachment must be optional: the email goes without the document while the other add-on is away', () => {
    const with_ = (attach: Doc) => issuesOf(kit({ documents: [DOCUMENT], addOns: { suggests: [NEED] }, emailTemplates: [TEMPLATE(attach)] }));
    expect(with_({ kind: 'purchase-order', link: 'order' })).toContain(
      'emailTemplates.0.attach.optional: "purchase-order" is drawn by "invoices", which this add-on only suggests: write "optional": true, or the email could never be sent without it',
    );
    expect(with_({ kind: 'purchase-order', link: 'order', optional: true })).not.toContain('only suggests');
  });
});

describe('rows of an add-on\'s table, found by a table and a row', () => {
  const PAIR = { addOn: 'offers', table: 'applied', match: { table: 'source_table', row: 'source_row' }, columns: { name: 'name', amount: 'amount' }, orderBy: 'id' };

  it('are a source a document\'s list may read, beside a child table and a stay\'s nights', () => {
    expect(pairSourceSchema.safeParse(PAIR).success).toBe(true);
    expect(slotMappingSchema.safeParse({ collection: PAIR }).success).toBe(true);
    expect(slotMappingSchema.safeParse({ collections: [PAIR, { table: 'lines', via: 'order_id', columns: { name: 'name' } }] }).success).toBe(true);
    expect(pairSourceSchema.safeParse({ ...PAIR, via: 'order_id' }).success).toBe(false);
    expect(pairSourceSchema.safeParse({ ...PAIR, match: { table: 'source_table' } }).success).toBe(false);
  });

  it('name an add-on the manifest names', () => {
    const document = { kind: 'receipt', addOn: 'kit', table: 'items', name: 'Receipt', mapping: { lines: { collection: PAIR } } };
    expect(issuesOf(kit({ documents: [document] }))).toContain('documents.0.mapping.lines.collection.addOn: "offers" is not an add-on this manifest names');
    expect(issuesOf(kit({ documents: [document], addOns: { suggests: [{ ...NEED, key: 'offers' }] } }))).toBe('');
    // Its own rows by its own pair need no naming.
    expect(issuesOf(kit({ documents: [{ ...document, mapping: { lines: { collection: { ...PAIR, addOn: 'kit' } } } }] }))).toBe('');
  });

  it('are a source an email\'s list may read', () => {
    const from = { link: 'order', addOn: 'offers', table: 'applied', match: { table: 'source_table', row: 'source_row' }, limit: 20 };
    expect(emailRowsDataSchema.safeParse({ from, row: { title: '{{row.name}}' } }).success).toBe(true);
    expect(emailRowsDataSchema.safeParse({ from: { ...from, via: 'order_id' }, row: { title: '{{row.name}}' } }).success).toBe(false);
  });

  it('are words that need the install floor', () => {
    const document = { kind: 'receipt', addOn: 'kit', table: 'items', name: 'Receipt', mapping: { lines: { collection: PAIR } } };
    expect(installFloorWords(kit({ documents: [document] })).map((found) => found.word)).toContain('rows.pair');
    const template = { key: 'kit-x', name: 'X', locales: { 'en-US': { subject: 's', blocks: [{ block: 'email.text', data: { text: 't', onlyWith: 'name' } }] } } };
    expect(installFloorWords({ kind: 'app', emailTemplates: [template], outbox: { pages: { app: { balance: 'giftCard' } } } }).map((found) => found.word)).toEqual(['outbox.pages.app', 'email.onlyWith']);
  });
});
