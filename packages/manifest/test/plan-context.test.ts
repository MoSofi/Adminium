// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `planInstall` with a context: prefixes, the table record, other apps, and
 * the operator's answers for taken names.
 */
import { describe, expect, it } from 'vitest';

import { planInstall, type Manifest, type PlanContext, type SchemaModelView } from '../src/index.js';

const POS = {
  kind: 'app',
  key: 'pos',
  version: '0.2.0',
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'menu_items',
        shape: 'menu@1',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'price', type: 'money' },
        ],
      },
      {
        ref: 'payments',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'amount', type: 'money' },
          { ref: 'tip', type: 'money', nullable: true },
          { ref: 'status', type: 'enum', enum: ['paid', 'refunded'] },
        ],
      },
      {
        ref: 'lines',
        columns: [
          { ref: 'id', type: 'bigint', role: 'pk' },
          { ref: 'item_id', type: 'fk', references: 'menu_items' },
        ],
      },
    ],
  },
  roles: [{ key: 'cashier', name: 'POS cashier' }],
} as unknown as Manifest;

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  prefix: 'pos_',
  records: {},
  others: [],
  dialect: 'postgres',
  ...over,
});

const col = (ref: string, over: Record<string, unknown> = {}) => ({ ref, nullable: true, ...over });
const view = (tables: SchemaModelView['tables']): SchemaModelView => ({ tables });

const PAYMENTS_FULL = [
  col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true, nullable: false }),
  col('amount', { logicalType: 'decimal' }),
  col('tip', { logicalType: 'decimal' }),
  col('status', { logicalType: 'varchar', maxLength: 32, enumValues: ['paid', 'refunded'] }),
];

describe('a fresh database', () => {
  it('prefixes every table, points foreign keys at the prefixed names, and needs no answer', () => {
    const plan = planInstall(POS, view([]), ctx());
    expect(plan.installable).toBe(true);
    expect(plan.names).toEqual({ menu_items: 'pos_menu_items', payments: 'pos_payments', lines: 'pos_lines' });
    expect(plan.tables?.map((t) => [t.table, t.class, t.action])).toEqual([
      ['pos_menu_items', 'new', 'create'],
      ['pos_payments', 'new', 'create'],
      ['pos_lines', 'new', 'create'],
    ]);
    expect(plan.create.map((t) => t.table)).toEqual(['pos_menu_items', 'pos_payments', 'pos_lines']);
    expect(plan.references).toEqual([
      { fromTable: 'lines', fromColumn: 'item_id', to: 'menu_items', resolution: 'internal' },
    ]);
  });

  it('other apps\' plain-named tables cause no question', () => {
    const plan = planInstall(POS, view([{ ref: 'payments', columns: [col('invoice_id', { nullable: false })] }]), ctx());
    expect(plan.installable).toBe(true);
  });

  it('uses a different prefix for every table at once', () => {
    const plan = planInstall(POS, view([]), ctx({ altPrefix: 'pos2_' }));
    expect(Object.values(plan.names ?? {})).toEqual(['pos2_menu_items', 'pos2_payments', 'pos2_lines']);
  });
});

describe('a table this app made on an earlier install', () => {
  const records = { payments: { table: 'pos_payments', owned: true, state: 'released' } };

  it('is reused by default, with only safe edits', () => {
    const plan = planInstall(
      POS,
      view([
        {
          ref: 'pos_payments',
          columns: [
            col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: false, nullable: false }),
            col('amount', { logicalType: 'decimal' }),
            col('status', { logicalType: 'varchar', maxLength: 32, enumValues: ['paid'] }),
          ],
        },
      ]),
      ctx({ records }),
    );
    const payments = plan.tables?.find((t) => t.ref === 'payments');
    expect(payments).toMatchObject({ class: 'own-leftover', action: 'reuse', offers: ['reuse', 'rename-existing', 'alt-prefix'] });
    expect(payments?.edits).toEqual([
      { kind: 'set-identity', column: 'id' },
      { kind: 'add-column', column: 'tip' },
      { kind: 'enum-values', column: 'status', values: ['refunded'] },
    ]);
    expect(plan.installable).toBe(true);
    // Made by the earlier install, so not marked as one it found there.
    expect(payments?.adopted).toBeUndefined();
  });

  it('gives a column the unique rule it is declared with where the table says it lacks it, and only there', () => {
    const coded = {
      ...POS,
      requiredSchema: {
        ...POS.requiredSchema,
        tables: [
          {
            ref: 'payments',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'ref_no', type: 'text', maxLength: 20, nullable: true, unique: true },
              { ref: 'receipt', type: 'text', nullable: true, rules: { code: { length: 8 } } },
              { ref: 'till', type: 'int', nullable: true },
              { ref: 'n', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'till' } } },
              { ref: 'note', type: 'text', maxLength: 20, nullable: true, unique: true },
            ],
          },
        ],
      },
    } as unknown as Manifest;
    const columns = [
      col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true, isUnique: false, nullable: false }),
      col('ref_no', { logicalType: 'varchar', maxLength: 20, isUnique: false }),
      col('receipt', { logicalType: 'varchar', maxLength: 8, isUnique: true }),
      col('till', { logicalType: 'integer', isUnique: false }),
      col('n', { logicalType: 'integer', isUnique: false }),
      // Not said of the column itself: the table's list of unique rules decides, and without one nothing is offered.
      col('note', { logicalType: 'varchar', maxLength: 20 }),
    ];
    const edits = (uniques?: string[][]) =>
      planInstall(coded, view([{ ref: 'pos_payments', columns, ...(uniques === undefined ? {} : { uniques }) }]), ctx({ records })).tables?.[0]?.edits;
    expect(edits([['receipt']])).toEqual([
      { kind: 'add-unique', column: 'ref_no' },
      { kind: 'add-unique', column: 'n', with: ['till'] },
      { kind: 'add-unique', column: 'note' },
    ]);
    // The number is kept unique with its till already, in either order; the note alone.
    expect(edits([['receipt'], ['n', 'till'], ['note']])).toEqual([{ kind: 'add-unique', column: 'ref_no' }]);
    // A table whose unique rules are not known is offered only what its columns say.
    expect(edits()).toEqual([{ kind: 'add-unique', column: 'ref_no' }]);
  });

  it('refuses on MySQL a unique text column wider than MySQL can index, whether the table is made or reused', () => {
    const wide = {
      ...POS,
      requiredSchema: {
        ...POS.requiredSchema,
        tables: [
          {
            ref: 'payments',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'long_ref', type: 'text', maxLength: 1000, nullable: true, unique: true },
              { ref: 'short_ref', type: 'text', maxLength: 768, nullable: true, unique: true },
              { ref: 'code', type: 'text', nullable: true, rules: { code: { prefix: 'R-', length: 900 } } },
            ],
          },
        ],
      },
    } as unknown as Manifest;
    const problems = (dialect: PlanContext['dialect'], tables: SchemaModelView['tables']) =>
      planInstall(wide, view(tables), ctx({ dialect, records: tables.length === 0 ? {} : records })).problems.filter((p) => p.code === 'UNIQUE_KEY_TOO_LONG');
    const made = problems('mysql', []);
    expect(made.map((p) => p.column)).toEqual(['long_ref', 'code']);
    expect(made[0]?.message).toContain('at most 768 characters: this app allows 1000');
    expect(problems('mysql', [{ ref: 'pos_payments', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true })] }]).map((p) => p.column)).toEqual(['long_ref', 'code']);
    expect(problems('postgres', [])).toEqual([]);
    expect(problems('sqlite', [])).toEqual([]);
  });

  it('says when the earlier install used a table it found rather than made', () => {
    const plan = planInstall(
      POS,
      view([{ ref: 'pos_payments', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true })] }]),
      ctx({ records: { payments: { table: 'pos_payments', owned: false, state: 'adopted' } } }),
    );
    expect(plan.tables?.find((t) => t.ref === 'payments')).toMatchObject({ class: 'own-leftover', adopted: true });
  });

  it('widens a short varchar, and refuses a type that cannot be widened', () => {
    const plan = planInstall(
      POS,
      view([
        { ref: 'pos_menu_items', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer' }), col('name', { logicalType: 'varchar', maxLength: 20 }), col('price', { logicalType: 'text' })] },
      ]),
      ctx({ records: { menu_items: { table: 'pos_menu_items', owned: true, state: 'created' } } }),
    );
    const menu = plan.tables?.find((t) => t.ref === 'menu_items');
    expect(menu?.edits).toContainEqual({ kind: 'widen', column: 'name', from: 'varchar(20)', to: 'varchar(80)' });
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'COLUMN_TYPE_CONFLICT', column: 'price' })]);
  });

  it('refuses int → bigint on a MySQL key another table points at', () => {
    const records2 = { lines: { table: 'pos_lines', owned: true, state: 'created' } };
    const live = view([{ ref: 'pos_lines', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer' }), col('item_id', { logicalType: 'integer' })] }]);
    expect(planInstall(POS, live, ctx({ records: records2 })).tables?.find((t) => t.ref === 'lines')?.edits).toContainEqual({
      kind: 'widen', column: 'id', from: 'integer', to: 'bigint',
    });
    expect(planInstall(POS, live, ctx({ records: records2, dialect: 'mysql' })).problems.map((p) => p.code)).toContain('COLUMN_TYPE_CONFLICT');
  });
});

describe('a name somebody else holds', () => {
  const handMade = view([{ ref: 'pos_payments', columns: PAYMENTS_FULL }]);

  it('waits for an answer, and says which table', () => {
    const plan = planInstall(POS, handMade, ctx());
    const payments = plan.tables?.find((t) => t.ref === 'payments');
    expect(payments).toMatchObject({ class: 'taken', action: 'undecided', offers: ['reuse', 'rename-existing', 'alt-prefix'] });
    expect(plan.installable).toBe(false);
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'TABLE_TAKEN', table: 'payments' })]);
  });

  it('reuses it when told to', () => {
    const plan = planInstall(POS, handMade, ctx({ choices: { payments: { action: 'reuse' } } }));
    expect(plan.installable).toBe(true);
    expect(plan.reuse.map((t) => t.table)).toEqual(['pos_payments']);
  });

  it('never offers reuse of a table requiring a column the app never fills', () => {
    const foreign = view([{ ref: 'pos_payments', columns: [...PAYMENTS_FULL, col('location_id', { nullable: false })] }]);
    const plan = planInstall(POS, foreign, ctx({ choices: { payments: { action: 'reuse' } } }));
    const payments = plan.tables?.find((t) => t.ref === 'payments');
    expect(payments?.offers).toEqual(['rename-existing', 'alt-prefix']);
    expect(payments?.reuseRefusal).toContain('"location_id"');
    expect(plan.installable).toBe(false);
  });

  it('renames the existing table out of the way, to a free name', () => {
    const plan = planInstall(POS, handMade, ctx({ choices: { payments: { action: 'rename-existing', to: 'payments_2019' } } }));
    expect(plan.tables?.find((t) => t.ref === 'payments')).toMatchObject({ action: 'rename-existing', renameExistingTo: 'payments_2019' });
    expect(plan.create.map((t) => t.table)).toContain('pos_payments');
    expect(plan.installable).toBe(true);
    const clash = planInstall(POS, view([...handMade.tables, { ref: 'taken_name', columns: [] }]), ctx({ choices: { payments: { action: 'rename-existing', to: 'taken_name' } } }));
    expect(clash.problems.map((p) => p.code)).toEqual(['TABLE_TAKEN']);
  });

  it("is another app's: a collision, and never renamed from under it", () => {
    const plan = planInstall(POS, handMade, ctx({ others: [{ appKey: 'pos-extra', table: 'pos_payments', shape: null, state: 'created' }] }));
    const payments = plan.tables?.find((t) => t.ref === 'payments');
    expect(payments?.offers).not.toContain('rename-existing');
    expect(plan.problems.map((p) => p.code)).toContain('PREFIX_COLLISION');
  });

  it('is shared when both apps declare the same shape', () => {
    const plan = planInstall(
      POS,
      view([{ ref: 'pos_menu_items', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer' }), col('name', { logicalType: 'varchar', maxLength: 80 }), col('price', { logicalType: 'decimal' })] }]),
      ctx({ others: [{ appKey: 'ordering', table: 'pos_menu_items', shape: 'menu@1', state: 'created' }] }),
    );
    expect(plan.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ class: 'shared', action: 'share', sharedWith: 'ordering' });
    expect(plan.installable).toBe(true);
  });

  it('offers a nullable link as an edit — the schema editor adds its foreign key — and still blocks a required one', () => {
    const linked = {
      ...POS,
      requiredSchema: {
        ...POS.requiredSchema,
        tables: POS.requiredSchema!.tables.map((t) =>
          t.ref === 'lines' ? { ...t, columns: [...t.columns, { ref: 'combo_id', type: 'fk', references: 'menu_items', nullable: true }] } : t,
        ),
      },
    } as unknown as Manifest;
    const noLinks = view([{ ref: 'pos_lines', columns: [col('id', { isPrimaryKey: true, logicalType: 'bigint' })] }]);
    const lines = planInstall(linked, noLinks, ctx({ choices: { lines: { action: 'reuse' } } })).tables?.find((t) => t.ref === 'lines');
    expect(lines?.edits).toEqual([{ kind: 'add-column', column: 'combo_id' }]);
    expect(lines?.blocked).toEqual([{ column: 'item_id', reason: 'foreign-key' }]);
  });

  it('lists the columns that cannot be added to a reused table', () => {
    const noFk = view([{ ref: 'pos_lines', columns: [col('id', { isPrimaryKey: true, logicalType: 'bigint' })] }]);
    const plan = planInstall(POS, noFk, ctx({ choices: { lines: { action: 'reuse' } } }));
    expect(plan.tables?.find((t) => t.ref === 'lines')?.blocked).toEqual([{ column: 'item_id', reason: 'foreign-key' }]);
    expect(plan.problems.map((p) => p.code)).toContain('COLUMNS_REQUIRED');
  });
});

describe('names too long for the engine', () => {
  it('refuses a prefixed name, a foreign key name and a role slug that do not fit', () => {
    const long = { ...POS, key: 'a-very-long-application-key-for-testing' } as Manifest;
    const plan = planInstall(long, view([]), ctx({ prefix: `${'x'.repeat(56)}_` }));
    const codes = plan.problems.map((p) => p.code);
    expect(codes.filter((c) => c === 'IDENTIFIER_TOO_LONG').length).toBeGreaterThanOrEqual(3);
    expect(plan.problems.some((p) => p.message.includes('The role'))).toBe(true);
  });

  it('refuses a malformed alternative prefix', () => {
    expect(planInstall(POS, view([]), ctx({ altPrefix: 'Bad Prefix' })).installable).toBe(false);
  });
});

describe('without a context', () => {
  it('plans exactly as before', () => {
    const plan = planInstall(POS, view([]));
    expect(plan.tables).toBeUndefined();
    expect(plan.create.map((t) => t.ref)).toEqual(['menu_items', 'payments', 'lines']);
  });
});

describe('the remaining refusals', () => {
  it('widens an enum column too narrow for its longest value', () => {
    const wide = { ...POS, requiredSchema: { prefixed: true, tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'stage', type: 'enum', enum: ['x'.repeat(40)] }] }] } } as unknown as Manifest;
    const plan = planInstall(
      wide,
      view([{ ref: 'pos_orders', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer' }), col('stage', { logicalType: 'varchar', maxLength: 16 })] }]),
      ctx({ records: { orders: { table: 'pos_orders', owned: true, state: 'created' } } }),
    );
    expect(plan.tables?.[0]?.edits).toContainEqual({ kind: 'widen', column: 'stage', from: 'varchar(16)', to: 'varchar(64)' });
  });

  it("names a foreign key's missing target, and Adminium's own namespace", () => {
    const dangling = { ...POS, requiredSchema: { tables: [{ ref: 'adminium_x', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'guest_id', type: 'fk', references: 'guests' }] }] } } as unknown as Manifest;
    const plan = planInstall(dangling, view([]), ctx({ prefix: null }));
    expect(plan.problems.map((p) => p.code).sort()).toEqual(['RESERVED_TABLE', 'UNRESOLVED_REFERENCE']);
  });
});
