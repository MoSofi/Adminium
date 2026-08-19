// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rails schema.rb parser — statements and options the Northwind schema does
 * not use: t.column / t.virtual / t.belongs_to, polymorphic references,
 * arrays, custom primary keys, the top-level add_* statements against missing
 * targets, and the execute/heredoc blocks a real schema.rb carries.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'rails' });
const schema = (...lines: string[]): string =>
  ['ActiveRecord::Schema[7.1].define(version: 2024_06_12_101500) do', ...lines, 'end'].join('\n');

describe('rails — create_table options', () => {
  it('reads comment:, primary_key: and a non-default id type', () => {
    const { model } = parse(
      schema(
        '  create_table "invoices", primary_key: "invoice_no", id: :string, comment: "Issued invoices", force: :cascade do |t|',
        '    t.decimal "total", precision: 12, scale: 2',
        '  end',
      ),
    );
    const invoices = table(model, 'invoices');
    expect(invoices.comment).toBe('Issued invoices');
    expect(invoices.primaryKey).toEqual(['invoice_no']);
    expect(column(model, 'invoices', 'invoice_no').logicalType).toBe('varchar');
    const total = column(model, 'invoices', 'total');
    expect(total.numericPrecision).toBe(12);
    expect(total.numericScale).toBe(2);
  });

  it('falls back to bigint for an id type it does not know', () => {
    const { model } = parse(
      schema('  create_table "t", id: :ulid, force: :cascade do |t|', '    t.string "x"', '  end'),
    );
    expect(column(model, 't', 'id').logicalType).toBe('bigint');
  });

  it('skips a create_table whose name is not a literal', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table table_name, force: :cascade do |t|',
        '    t.string "x"',
        '  end',
        '  create_table "ok", force: :cascade do |t|',
        '    t.string "y"',
        '  end',
      ),
    );
    expect(model.tables.map((t) => t.name)).toEqual(['ok']);
    expect(warnings.some((w) => /create_table with a non-literal name skipped/.test(w))).toBe(true);
  });

  it('throws when the file has no create_table block', () => {
    expect(() => parse(schema('  enable_extension "plpgsql"'))).toThrow(SchemaImportError);
  });
});

describe('rails — column statements', () => {
  it('reads t.column and t.virtual', () => {
    const { model } = parse(
      schema(
        '  create_table "products", force: :cascade do |t|',
        '    t.column "sku", :string, limit: 24, null: false',
        '    t.column "notes", :text, limit: 400',
        '    t.virtual "sku_lower", type: :string, as: "lower(sku)", stored: true',
        '  end',
      ),
    );
    const sku = column(model, 'products', 'sku');
    expect(sku.maxLength).toBe(24);
    expect(sku.nullable).toBe(false);
    expect(column(model, 'products', 'notes').maxLength).toBe(400);
    expect(column(model, 'products', 'sku_lower').isGenerated).toBe(true);
    expect(column(model, 'products', 'sku_lower').logicalType).toBe('varchar');
  });

  it('promotes integer limit: 8 to bigint and reads array:/unique:/index:', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.integer "big_count", limit: 8',
        '    t.integer "small_count", limit: 4',
        '    t.string "tags", array: true, default: []',
        '    t.string "slug", unique: true, index: true',
        '  end',
      ),
    );
    expect(column(model, 'rows', 'big_count').logicalType).toBe('bigint');
    expect(column(model, 'rows', 'small_count').logicalType).toBe('integer');
    expect(column(model, 'rows', 'tags').isArray).toBe(true);
    expect(column(model, 'rows', 'slug').isUnique).toBe(true);
    expect(table(model, 'rows').indexes.map((i) => i.name)).toEqual(['index_rows_on_slug']);
  });

  it('classifies -> { } lambda defaults and nil', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.uuid "token", default: -> { "gen_random_uuid()" }',
        '    t.datetime "seen_at", default: -> { "CURRENT_TIMESTAMP" }',
        '    t.integer "rank", default: -> { "compute_rank()" }',
        '    t.string "note", default: nil',
        '    t.string "code", default: SOME_CONST',
        '  end',
      ),
    );
    expect(column(model, 'rows', 'token').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'rows', 'seen_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'rows', 'rank').default).toEqual({
      kind: 'expression',
      text: 'compute_rank()',
    });
    expect(column(model, 'rows', 'note').default).toBeNull();
    expect(column(model, 'rows', 'code').default).toEqual({
      kind: 'expression',
      text: 'SOME_CONST',
    });
  });

  it('warns once for an unknown t.<type> and once for an unknown t.<method>', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "ok"',
        '    t.column "weird", :ltree',
        '    t.something_else "x"',
        '  end',
      ),
    );
    expect(column(model, 'rows', 'weird').logicalType).toBe('unknown');
    expect(column(model, 'rows', 'weird').dbType).toBe('ltree');
    expect(warnings.some((w) => /unknown rails column type :ltree/.test(w))).toBe(true);
    expect(warnings.some((w) => /skipped unknown schema.rb method t.something_else/.test(w))).toBe(
      true,
    );
  });

  it('declares several columns from one t.<type> statement', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "first_name", "last_name", null: false',
        '  end',
      ),
    );
    expect(table(model, 'rows').columns.map((c) => c.name)).toEqual([
      'id',
      'first_name',
      'last_name',
    ]);
  });
});

describe('rails — references and constraints', () => {
  it('creates two columns and no FK for a polymorphic reference', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table "comments", force: :cascade do |t|',
        '    t.references "commentable", polymorphic: true, null: false',
        '  end',
      ),
    );
    expect(table(model, 'comments').columns.map((c) => c.name)).toEqual([
      'id',
      'commentable_type',
      'commentable_id',
    ]);
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /polymorphic reference "commentable"/.test(w))).toBe(true);
  });

  it('uses t.belongs_to with type: and the pluralization convention', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table "customers", id: :uuid, force: :cascade do |t|',
        '    t.string "email"',
        '  end',
        '  create_table "orders", force: :cascade do |t|',
        '    t.belongs_to "customer", type: :uuid, foreign_key: true, index: false',
        '  end',
      ),
    );
    expect(column(model, 'orders', 'customer_id').logicalType).toBe('uuid');
    expect(relationBetween(model, 'orders', 'customers')?.from.columns).toEqual(['customer_id']);
    expect(table(model, 'orders').indexes).toHaveLength(0);
    expect(warnings.some((w) => /by pluralization convention/.test(w))).toBe(true);
  });

  it('reads t.index with an explicit name and unique flag', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "a"',
        '    t.string "b"',
        '    t.index ["a", "b"], name: "idx_rows_ab", unique: true',
        '    t.index "a"',
        '  end',
      ),
    );
    const rows = table(model, 'rows');
    expect(rows.indexes.find((i) => i.name === 'idx_rows_ab')?.unique).toBe(true);
    expect(rows.uniques).toEqual([{ name: 'idx_rows_ab', columns: ['a', 'b'] }]);
    expect(rows.indexes.some((i) => i.name === 'index_rows_on_a')).toBe(true);
  });

  it('synthesizes an enum from add_check_constraint and t.check_constraint', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "state", null: false',
        '  end',
        '  add_check_constraint "rows", "state IN (\'new\', \'done\')", name: "rows_state_check"',
      ),
    );
    const state = column(model, 'rows', 'state');
    expect(state.logicalType).toBe('enum');
    expect(model.enums.find((e) => e.id === state.enumRef)?.values).toEqual(['new', 'done']);
    expect(table(model, 'rows').checks).toEqual([
      { name: 'rows_state_check', expression: "state IN ('new', 'done')" },
    ]);
  });

  it('warns when add_index or add_foreign_key names something not in the file', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "a"',
        '  end',
        '  add_index "ghosts", ["a"]',
        '  add_foreign_key "ghosts", "rows"',
        '  add_foreign_key "rows", "ghosts"',
      ),
    );
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /add_index on unknown table "ghosts"/.test(w))).toBe(true);
    expect(warnings.some((w) => /add_foreign_key on unknown table "ghosts"/.test(w))).toBe(true);
    expect(warnings.some((w) => /column "ghost_id" not found/.test(w))).toBe(true);
  });

  it('reads add_foreign_key column:/primary_key:/on_update: and the nullify action', () => {
    const { model } = parse(
      schema(
        '  create_table "authors", force: :cascade do |t|',
        '    t.string "slug", null: false',
        '  end',
        '  create_table "books", force: :cascade do |t|',
        '    t.string "writer_slug"',
        '  end',
        '  add_foreign_key "books", "authors", column: "writer_slug", primary_key: "slug", on_delete: :nullify, on_update: :cascade',
      ),
    );
    const rel = relationBetween(model, 'books', 'authors');
    expect(rel?.onDelete).toBe('set-null');
    expect(rel?.onUpdate).toBe('cascade');
    expect(column(model, 'books', 'writer_slug').references).toEqual({
      tableId: 'public.authors',
      column: 'slug',
    });
  });

  it('adds a unique index from add_index and ignores an empty column list', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "a"',
        '  end',
        '  add_index "rows", ["a"], unique: true',
        '  add_index "rows"',
      ),
    );
    expect(table(model, 'rows').uniques).toEqual([
      { name: 'index_rows_on_a', columns: ['a'] },
    ]);
    expect(table(model, 'rows').indexes).toHaveLength(1);
  });

  it('records a CHECK that is not an enumeration without synthesizing one', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.integer "quantity", null: false',
        '  end',
        '  add_check_constraint "rows", "quantity > 0"',
        '  add_check_constraint "ghosts", "quantity > 0"',
      ),
    );
    expect(model.enums).toHaveLength(0);
    expect(table(model, 'rows').checks).toEqual([{ name: null, expression: 'quantity > 0' }]);
  });

  it('accepts the symbol form of add_index and t.check_constraint without a name', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "state"',
        '    t.check_constraint "state IN (\'new\')"',
        '  end',
        '  add_index "rows", :state',
      ),
    );
    expect(table(model, 'rows').checks[0]?.name).toBeNull();
    expect(table(model, 'rows').indexes.map((i) => i.name)).toEqual(['index_rows_on_state']);
  });

  it('defaults t.virtual to string and t.references to bigint for unknown types', () => {
    const { model } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.virtual "shout", as: "upper(name)"',
        '    t.references "owner", type: :ltree, foreign_key: { on_delete: :cascade }',
        '    t.references "auditor", polymorphic: true',
        '    t.decimal "ratio", precision: 6',
        '    t.string "name", precision: 6',
        '  end',
      ),
    );
    expect(column(model, 'rows', 'shout').logicalType).toBe('varchar');
    // An unknown reference type still gets the bigint FK column shape.
    expect(column(model, 'rows', 'owner_id').logicalType).toBe('bigint');
    expect(column(model, 'rows', 'auditor_id').nullable).toBe(true);
    expect(column(model, 'rows', 'ratio').numericPrecision).toBe(6);
    expect(column(model, 'rows', 'ratio').numericScale).toBeNull();
    // precision is meaningless on a string column and must not be recorded.
    expect(column(model, 'rows', 'name').numericPrecision).toBeNull();
  });

  it('skips an execute heredoc without reading its SQL as schema', () => {
    const { model, warnings } = parse(
      schema(
        '  create_table "rows", force: :cascade do |t|',
        '    t.string "a"',
        '  end',
        '  execute <<~SQL',
        '    create_table "not_a_real_table" do |t|',
        '    end',
        '  SQL',
      ),
    );
    expect(model.tables.map((t) => t.name)).toEqual(['rows']);
    expect(warnings.some((w) => /skipped execute block in schema.rb/.test(w))).toBe(true);
  });
});
