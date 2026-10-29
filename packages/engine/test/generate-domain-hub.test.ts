// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A domain's hub is never its line items (yt-03, V23).
 *
 * Lovable's Crumb & Co. schema: `order_items` links to both `orders` (ON
 * DELETE CASCADE) and `cakes`, so by link count alone it won the hub, and the
 * dashboard followed it: "Order Items Dashboard", the SUM of a unit price,
 * "New Cakes (30d)", and cake prices charted per month. A line-items table
 * belongs to its parent, the table it cascades from, so the parent is the hub.
 */
import { describe, expect, it } from 'vitest';

import {
  applyClassification,
  detectDomains,
  generatePages,
  parseDatabaseModel,
  type PageEnvelope,
} from '../src/index.js';

function column(name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    ordinal: 0,
    dbType: 'integer',
    logicalType: 'integer',
    nullable: false,
    default: null,
    isPrimaryKey: false,
    isUnique: false,
    isGenerated: false,
    enumRef: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    isArray: false,
    comment: null,
    references: null,
    semantics: null,
    ...over,
  };
}

const id = column('id', { isPrimaryKey: true, isUnique: true });
const text = (name: string) => column(name, { dbType: 'text', logicalType: 'text' });
const money = (name: string) => column(name, { dbType: 'numeric', logicalType: 'decimal' });
const createdAt = column('created_at', { dbType: 'timestamptz', logicalType: 'timestamptz', default: { kind: 'now' } });
const ref = (name: string, to: string) => column(name, { references: { tableId: `public.${to}`, column: 'id' } });

function table(name: string, columns: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: 'public',
    name,
    kind: 'table',
    comment: null,
    primaryKey: ['id'],
    uniques: [],
    columns: columns.map((c, i) => ({ ...c, ordinal: i + 1 })),
  };
}

function relation(from: string, col: string, to: string, onDelete: 'cascade' | 'no-action'): Record<string, unknown> {
  return {
    id: `fk:public.${from}(${col})->public.${to}(id)`,
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: `public.${from}`, columns: [col] },
    to: { tableId: `public.${to}`, columns: ['id'] },
    through: null,
    onDelete,
    onUpdate: 'no-action',
    selfReferential: false,
    confidence: 1,
  };
}

/** No row estimates, as on a fresh Supabase project nobody has analysed. */
const model = applyClassification(
  parseDatabaseModel(
    JSON.stringify({
      dialect: 'postgres',
      name: 'crumb',
      tables: [
        table('cakes', [id, text('name'), money('price'), createdAt]),
        table('orders', [id, text('customer_name'), money('total'), createdAt]),
        table('order_items', [id, ref('order_id', 'orders'), ref('cake_id', 'cakes'), column('quantity'), money('unit_price')]),
      ],
      relations: [
        relation('order_items', 'order_id', 'orders', 'cascade'),
        relation('order_items', 'cake_id', 'cakes', 'no-action'),
      ],
    }),
  ),
);

function dashboard(pages: PageEnvelope[]): PageEnvelope {
  const found = pages.find((p) => p.template === 'page-dashboard');
  if (found === undefined) throw new Error('no dashboard');
  return found;
}

function titles(page: PageEnvelope): string[] {
  const layout = page.config['layout'] as { items: { config?: { title?: string } }[] };
  return layout.items.map((item) => item.config?.title ?? '');
}

describe('a domain hub is never a line-items table', () => {
  it('classifies order_items as line items (the premise)', () => {
    expect(model.tables.find((t) => t.id === 'public.order_items')?.semantics?.role).toBe('line-items');
  });

  it('elects the table the line items cascade from', () => {
    const [domain] = detectDomains(model, model.tables);
    expect(domain?.hubTableId).toBe('public.orders');
    expect(domain?.label).toBe('Orders');
  });

  it('builds the dashboard around orders, not unit prices or cakes', () => {
    const page = dashboard(generatePages(model, { connectionId: 'conn_01HZX0000000000000000000', intent: 'full-admin' }).pages);
    expect((page.config['domain'] as { key: string }).key).toBe('orders');
    expect(titles(page)).toEqual(expect.arrayContaining(['Total Orders', 'Total Value', 'New Orders (30d)', 'Value per Month']));
    expect(titles(page).join(' | ')).not.toMatch(/Unit Price|Total Total|Cakes \(30d\)|Price per Month/);
  });
});
