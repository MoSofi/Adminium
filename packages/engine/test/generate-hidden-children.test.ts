// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cascade-owned children default OUT of the sidebar (30-record-pages.md
 * follow-up, 2026-08-24): the schema's own composition claim — a declared,
 * NOT-NULL, ON DELETE CASCADE FK to an included parent — is the one signal
 * that a table's home is its parent's record-page tab, so its generated crud
 * page carries `nav.hidden` while KEEPING its group (un-hiding in Studio must
 * restore the right placement).
 *
 * Every refusal clause is asserted too, because each one is a case where
 * hiding would be a lie: an inferred FK is a guess, a nullable FK permits
 * orphans no parent tab can reach, RESTRICT/SET NULL children are
 * associations, and a tree table must not hide itself.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification, generatePages, parseDatabaseModel, type PageEnvelope } from '../src/index.js';

interface FkSpec {
  column: string;
  to: string;
  onDelete: 'cascade' | 'restrict' | 'set-null' | 'no-action';
  nullable?: boolean;
  confidence?: number;
}

function column(name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    ordinal: 0,
    dbType: 'integer',
    logicalType: 'integer',
    nullable: false,
    default: null,
    isPrimaryKey: name === 'id',
    isUnique: name === 'id',
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

function table(name: string, fks: FkSpec[] = []): Record<string, unknown> {
  return {
    schema: 'public',
    name,
    kind: 'table',
    comment: null,
    primaryKey: ['id'],
    uniques: [],
    columns: [
      column('id'),
      column('title', { dbType: 'text', logicalType: 'text', isPrimaryKey: false, isUnique: false }),
      ...fks.map((fk) =>
        column(fk.column, {
          isPrimaryKey: false,
          isUnique: false,
          nullable: fk.nullable ?? false,
          references: { tableId: `public.${fk.to}`, column: 'id' },
        }),
      ),
    ],
  };
}

function relation(fromTable: string, fk: FkSpec): Record<string, unknown> {
  return {
    id: `fk:public.${fromTable}(${fk.column})->public.${fk.to}(id)`,
    kind: fk.confidence !== undefined && fk.confidence < 1 ? 'inferred-name' : 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: `public.${fromTable}`, columns: [fk.column] },
    to: { tableId: `public.${fk.to}`, columns: ['id'] },
    through: null,
    onDelete: fk.onDelete,
    onUpdate: 'no-action',
    selfReferential: fromTable === fk.to,
    confidence: fk.confidence ?? 1,
  };
}

function makeModel(specs: Record<string, FkSpec[]>) {
  return applyClassification(
    parseDatabaseModel(
      JSON.stringify({
        dialect: 'postgres',
        name: 'hidden_children',
        tables: Object.entries(specs).map(([name, fks]) => table(name, fks)),
        relations: Object.entries(specs).flatMap(([name, fks]) =>
          fks.map((fk) => relation(name, fk)),
        ),
      }),
    ),
  );
}

function crudPage(pages: PageEnvelope[], slug: string): PageEnvelope {
  const found = pages.find((p) => p.template === 'page-crud' && p.nav.slug === slug);
  if (found === undefined) throw new Error(`no page-crud with slug ${slug}`);
  return found;
}

describe('cascade-owned children generate hidden from the sidebar', () => {
  const { pages } = generatePages(
    makeModel({
      invoices: [],
      // The canonical case: declared, NOT NULL, ON DELETE CASCADE → hidden.
      invoice_items: [{ column: 'invoice_id', to: 'invoices', onDelete: 'cascade' }],
      // RESTRICT is an association, not a composition → visible.
      receipts: [{ column: 'invoice_id', to: 'invoices', onDelete: 'restrict' }],
      // A NULLABLE cascade FK permits orphans → visible.
      attachments: [
        { column: 'invoice_id', to: 'invoices', onDelete: 'cascade', nullable: true },
      ],
      // An INFERRED relation is a guess; a guess must not remove navigation.
      drafts: [{ column: 'invoice_id', to: 'invoices', onDelete: 'cascade', confidence: 0.8 }],
      // A self-referential cascade tree must not hide itself.
      categories: [
        { column: 'parent_id', to: 'categories', onDelete: 'cascade', nullable: true },
      ],
    }),
  );

  it('hides exactly the cascade-owned child, keeping its group for un-hiding', () => {
    const items = crudPage(pages, 'invoice-items');
    expect(items.nav.hidden).toBe(true);
    // `group` survives beside `hidden` — the document remembers where the page
    // belongs, so Studio's "Show in sidebar" restores the right placement.
    expect(items.nav.group).toBe('library');
  });

  it('refuses every near-miss: restrict, nullable, inferred, self, and the parent itself', () => {
    for (const slug of ['invoices', 'receipts', 'attachments', 'drafts', 'categories']) {
      expect(crudPage(pages, slug).nav.hidden, slug).toBeUndefined();
    }
  });

  it('is regeneration-stable: the same model hides the same set', () => {
    const again = generatePages(
      makeModel({
        invoices: [],
        invoice_items: [{ column: 'invoice_id', to: 'invoices', onDelete: 'cascade' }],
      }),
    );
    expect(crudPage(again.pages, 'invoice-items').nav.hidden).toBe(true);
  });
});
