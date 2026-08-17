// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Table-label channel through generation (06-llm-assist.md §8.3 provenance
 * user > llm > heuristic): a `TableModel.label` overlaid by the server
 * (apps/server generate/run.ts — user `table.label` / accepted `llm.label`
 * override rows) must reach the generated page titles, because
 * `adminium_pages.title` is what the bootstrap nav serves. Before M11 the
 * fallbacks hardcoded `humanize(table.name)` and renames never surfaced.
 *
 * The no-label side of every assertion doubles as the byte-identity guard's
 * sibling: absent `label`, titles are exactly the humanized heuristic
 * (test/generate-baseline.test.ts pins the full envelope bytes).
 */
import { describe, expect, it } from 'vitest';

import { detectDomains, generatePages, parseDatabaseModel, type PageEnvelope } from '../src/index.js';

const CONN = 'conn_01HZX0000000000000000000';

function model(withLabel: boolean) {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    source: { kind: 'live', connectionId: CONN },
    tables: [
      {
        name: 'orders',
        columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
        primaryKey: ['id'],
      },
      {
        name: 'order_details',
        ...(withLabel ? { label: 'Order lines' } : {}),
        columns: [
          { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          {
            name: 'order_id',
            logicalType: 'integer',
            nullable: false,
            references: { tableId: 'public.orders', column: 'id' },
          },
        ],
        primaryKey: ['id'],
      },
    ],
    relations: [
      {
        id: 'rel_details_orders',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'public.order_details', columns: ['order_id'] },
        to: { tableId: 'public.orders', columns: ['id'] },
      },
    ],
  });
}

function crudPage(pages: PageEnvelope[], slug: string): PageEnvelope {
  const found = pages.find((p) => p.template === 'page-crud' && p.nav.slug === slug);
  if (found === undefined) throw new Error(`no page-crud with slug ${slug}`);
  return found;
}

describe('generatePages title fallbacks honor TableModel.label', () => {
  it('a labeled table titles its page-crud with the label, verbatim', () => {
    const { pages } = generatePages(model(true), { connectionId: CONN });
    expect(crudPage(pages, 'order-details').title.fallback).toBe('Order lines');
    // The i18n key is untouched — the label rides the fallback only.
    expect(crudPage(pages, 'order-details').title.key).toBe('nav.order-details');
  });

  it('an unlabeled table keeps the humanized heuristic', () => {
    const { pages } = generatePages(model(false), { connectionId: CONN });
    expect(crudPage(pages, 'order-details').title.fallback).toBe('Order Details');
    expect(crudPage(pages, 'orders').title.fallback).toBe('Orders');
  });

  it('slugs, ids and nav placement never move with a label', () => {
    const labeled = generatePages(model(true), { connectionId: CONN });
    const plain = generatePages(model(false), { connectionId: CONN });
    expect(labeled.pages.map((p) => [p.id, p.nav.slug, p.nav.group, p.nav.order])).toEqual(
      plain.pages.map((p) => [p.id, p.nav.slug, p.nav.group, p.nav.order]),
    );
  });
});

describe('detectDomains hub labels', () => {
  it('a labeled hub names the domain verbatim (never pluralized); the key stays heuristic', () => {
    const labeled = model(true);
    // Degree ties at 1↔1; the name tiebreak makes order_details the hub.
    const [domain] = detectDomains(labeled, labeled.tables);
    expect(domain?.hubTableId).toBe('public.order_details');
    expect(domain?.label).toBe('Order lines');
    expect(domain?.key).toBe('order-details');
  });

  it('an unlabeled hub keeps the pluralized heuristic label and the same key', () => {
    const plain = model(false);
    const [domain] = detectDomains(plain, plain.tables);
    expect(domain?.label).toBe('Order Details');
    expect(domain?.key).toBe('order-details');
  });
});
