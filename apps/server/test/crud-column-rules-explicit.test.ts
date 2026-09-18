// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four column RULES an admin can write (plan 50 phase C), from the override
 * row to the refusal.
 *
 * Phase A built the machinery and left the rules argument empty: fills were
 * only the implicit ones, and `checkRow` judged only what the ENGINE itself
 * enforces. This file is the other half — what happens when somebody actually
 * says "this column starts as the current time", "these are the only answers",
 * "this one must be filled in", "at least eight characters".
 *
 * ─── Why the checks are asserted per ACTION ────────────────────────────────
 *
 * An explicit `required` is the one "required" the server enforces (D26), and
 * an update is not a create: a PATCH that does not mention the column is not
 * leaving it empty, it is not touching it. Getting that backwards would make
 * every partial update of a row with a required column fail.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification, parseDatabaseModel, type Dialect } from '@adminium/engine';
import { builtinOptionValues } from '@adminium/engine/config';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import { checkRow, fillRow, tableRulesFor } from '../src/crud/column-rules.js';
import type { WriteActor } from '../src/crud/write-service.js';

interface ColumnInput {
  name: string;
  logicalType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isGenerated?: boolean;
  default?: { kind: string; text?: string } | null;
  enumRef?: string | null;
}

interface RuleRow {
  op: string;
  column: string;
  value: Record<string, unknown>;
}

const NOW = new Date('2026-09-18T09:00:00.000Z');
const actor: WriteActor = { kind: 'user', id: 'usr_1', label: 'Ada Lovelace' };

function modelOf(dialect: Dialect, columns: ColumnInput[], enums: { id: string; values: string[] }[] = []) {
  return applyClassification(
    parseDatabaseModel({
      dialect,
      name: 'clinic',
      defaultSchema: 'public',
      schemas: ['public'],
      enums: enums.map((e) => ({ id: e.id, name: e.id, values: e.values, source: 'native' })),
      tables: [
        {
          schema: 'public',
          name: 'patients',
          primaryKey: columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name),
          columns,
        },
      ],
      relations: [],
    }),
  );
}

/** A write target carrying the given rule rows, exactly as Studio stores them. */
function target(
  dialect: Dialect,
  columns: ColumnInput[],
  rules: RuleRow[],
  enums?: { id: string; values: string[] }[],
  /** The lists this view was built with, as the data route resolves them. */
  lists?: Record<string, readonly string[]>,
): { view: SnapshotView; table: ResolvedTable } {
  const overrides = rules.map((rule, index) => ({
    id: `ovr_${String(index)}`,
    status: 'active',
    op: rule.op,
    tableName: 'public.patients',
    columnName: rule.column,
    value: rule.value,
  }));
  const view = new SnapshotView(
    'conn_1',
    applyOverrides(modelOf(dialect, columns, enums), overrides as never),
    new Map(Object.entries(lists ?? {})),
  );
  return { view, table: view.table('public.patients') };
}

const TEXT = { name: 'full_name', logicalType: 'varchar', nullable: true };
const KEY = { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true };

// ---------------------------------------------------------------------------
// column.default
// ---------------------------------------------------------------------------

describe('column.default — the fill an admin asked for', () => {
  it('fills a column the database has no opinion about', () => {
    const t = target('postgres', [KEY, { name: 'signed_up', logicalType: 'timestamptz', nullable: true }], [
      { op: 'column.default', column: 'signed_up', value: { kind: 'now' } },
    ]);
    const rules = tableRulesFor(t);
    const row = fillRow(rules, 'create', { id: 1 }, { dialect: 'postgres', now: NOW, actor });
    expect(row['signed_up']).toBe('2026-09-18T09:00:00.000Z');
    // …and not again on an update, because nobody said `onUpdate`.
    expect(fillRow(rules, 'update', {}, { dialect: 'postgres', now: NOW, actor })).toEqual({});
  });

  it('writes the signed-in user when that is what the rule says', () => {
    const t = target('postgres', [KEY, { name: 'owner', logicalType: 'varchar', nullable: true }], [
      { op: 'column.default', column: 'owner', value: { kind: 'current-user', userField: 'name' } },
    ]);
    const row = fillRow(tableRulesFor(t), 'create', {}, { dialect: 'postgres', now: NOW, actor });
    expect(row['owner']).toBe('Ada Lovelace');
  });

  it('`none` switches the implicit fill OFF — which is the only way to say that', () => {
    /*
     * `created_at` is filled by Adminium with no rule at all (D5). An admin who
     * has a trigger doing it needs a way to say so, and the absence of a row
     * cannot mean it: absence is what turns the implicit fill ON.
     */
    const columns = [KEY, { name: 'created_at', logicalType: 'timestamptz', nullable: false }];
    const withImplicit = fillRow(
      tableRulesFor(target('postgres', columns, [])),
      'create',
      {},
      { dialect: 'postgres', now: NOW, actor },
    );
    expect(withImplicit['created_at']).toBe('2026-09-18T09:00:00.000Z');

    const off = fillRow(
      tableRulesFor(
        target('postgres', columns, [
          { op: 'column.default', column: 'created_at', value: { kind: 'none' } },
        ]),
      ),
      'create',
      {},
      { dialect: 'postgres', now: NOW, actor },
    );
    expect(off).toEqual({});
  });

  it('`database` also writes nothing, and says who does', () => {
    const t = target('postgres', [KEY, { name: 'created_at', logicalType: 'timestamptz', nullable: false }], [
      { op: 'column.default', column: 'created_at', value: { kind: 'database' } },
    ]);
    const rules = tableRulesFor(t);
    expect(fillRow(rules, 'create', {}, { dialect: 'postgres', now: NOW, actor })).toEqual({});
    expect(rules?.fills.find((f) => f.column === 'created_at')?.kind).toBe('database');
  });

  it('a supplied value still wins, including an explicit null', () => {
    const t = target('postgres', [KEY, { name: 'signed_up', logicalType: 'timestamptz', nullable: true }], [
      { op: 'column.default', column: 'signed_up', value: { kind: 'now' } },
    ]);
    const row = fillRow(tableRulesFor(t), 'create', { signed_up: null }, { dialect: 'postgres', now: NOW, actor });
    expect(row['signed_up']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// column.options
// ---------------------------------------------------------------------------

describe('column.options — answers the database knows nothing about', () => {
  const OPTIONS = {
    op: 'column.options',
    column: 'stage',
    value: { values: [{ value: 'new' }, { value: 'seen', label: 'Seen' }] },
  };

  it('refuses a value outside the list, on every engine', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const t = target(dialect, [KEY, { name: 'stage', logicalType: 'varchar', nullable: true }], [OPTIONS]);
      const issues = checkRow(tableRulesFor(t), 'create', { stage: 'void' }, { dialect });
      expect(issues, dialect).toEqual({ stage: { code: 'not-allowed' } });
      expect(checkRow(tableRulesFor(t), 'create', { stage: 'seen' }, { dialect }), dialect).toBeNull();
    }
  });

  it('enforces a NAMED list from the values the view was built with', () => {
    /*
     * The rule stores a key, not a copy of the answers. The view resolves the
     * key once, when it is built, and its stamp carries the lists' revision — so
     * an edited list is in force on the next request and no write re-reads the
     * store (§3.9).
     */
    const t = target(
      'postgres',
      [KEY, { name: 'country', logicalType: 'varchar', nullable: true }],
      [{ op: 'column.options', column: 'country', value: { list: 'builtin:countries' } }],
      undefined,
      { 'builtin:countries': builtinOptionValues('builtin:countries') ?? [] },
    );
    const rules = tableRulesFor(t);
    expect(checkRow(rules, 'create', { country: 'DE' }, { dialect: 'postgres' })).toBeNull();
    expect(checkRow(rules, 'create', { country: 'XX' }, { dialect: 'postgres' })).toEqual({
      country: { code: 'not-allowed' },
    });
    // The CODE is what is checked. What a reader's browser calls DE is the
    // reader's business and never travels with the write.
    expect(checkRow(rules, 'create', { country: 'Deutschland' }, { dialect: 'postgres' })).toEqual({
      country: { code: 'not-allowed' },
    });
  });

  it('a custom list is enforced from its own values, and an edit to it takes effect', () => {
    const rule = { op: 'column.options', column: 'stage', value: { list: 'stages' } };
    const column = { name: 'stage', logicalType: 'varchar', nullable: true };
    const before = tableRulesFor(target('postgres', [KEY, column], [rule], undefined, { stages: ['new', 'seen'] }));
    expect(checkRow(before, 'create', { stage: 'won' }, { dialect: 'postgres' })).toEqual({
      stage: { code: 'not-allowed' },
    });
    // The same rule row, a view built after the list gained a value.
    const after = tableRulesFor(
      target('postgres', [KEY, column], [rule], undefined, { stages: ['new', 'seen', 'won'] }),
    );
    expect(checkRow(after, 'create', { stage: 'won' }, { dialect: 'postgres' })).toBeNull();
  });

  it('a list the view does not know refuses nothing, rather than refusing everything', () => {
    /*
     * The list was deleted, or the key never existed. Refusing every write to
     * the column would take a data entry job down over a list somebody tidied
     * up; the column goes back to accepting what the DATABASE accepts, and the
     * rule is visible in Studio for whoever wants to fix it. (A list in USE
     * cannot be deleted — the route answers 409 — so this is the residue of a
     * hand-edited rule, not the normal path.)
     */
    const t = target('postgres', [KEY, { name: 'country', logicalType: 'varchar', nullable: true }], [
      { op: 'column.options', column: 'country', value: { list: 'gone' } },
    ]);
    expect(checkRow(tableRulesFor(t), 'create', { country: 'ZZ' }, { dialect: 'postgres' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// column.required and column.validation
// ---------------------------------------------------------------------------

describe('column.required — the one "required" the server enforces', () => {
  const REQUIRED = { op: 'column.required', column: 'full_name', value: { required: true } };

  it('refuses a create that leaves it out, or blank', () => {
    const t = target('postgres', [KEY, TEXT], [REQUIRED]);
    const rules = tableRulesFor(t);
    expect(checkRow(rules, 'create', {}, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'required' },
    });
    expect(checkRow(rules, 'create', { full_name: '   ' }, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'required' },
    });
    expect(checkRow(rules, 'create', { full_name: 'Ada' }, { dialect: 'postgres' })).toBeNull();
  });

  it('does not refuse an update that simply does not mention it', () => {
    // A PATCH names the columns it changes. Reading an absent key as "emptied"
    // would break every partial update of a row that has a required column.
    const rules = tableRulesFor(target('postgres', [KEY, TEXT], [REQUIRED]));
    expect(checkRow(rules, 'update', { id: 3 }, { dialect: 'postgres' })).toBeNull();
    expect(checkRow(rules, 'update', { full_name: '' }, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'required' },
    });
  });

  it('never asks for a column something fills', () => {
    const t = target(
      'postgres',
      [KEY, { name: 'created_at', logicalType: 'timestamptz', nullable: false }],
      [{ op: 'column.required', column: 'created_at', value: { required: true } }],
    );
    expect(checkRow(tableRulesFor(t), 'create', {}, { dialect: 'postgres' })).toBeNull();
  });
});

describe('column.validation — only what an admin typed', () => {
  const t = (value: Record<string, unknown>, column = TEXT) =>
    tableRulesFor(target('postgres', [KEY, column], [{ op: 'column.validation', column: column.name, value }]));

  it('checks lengths, and names the bound so the message can carry it', () => {
    const rules = t({ minLength: 3, maxLength: 8 });
    expect(checkRow(rules, 'create', { full_name: 'Al' }, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'too-short', n: 3 },
    });
    expect(checkRow(rules, 'create', { full_name: 'Alexandra' }, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'too-long', n: 8 },
    });
    expect(checkRow(rules, 'create', { full_name: 'Ada' }, { dialect: 'postgres' })).toBeNull();
  });

  it('checks a format only where one was asked for', () => {
    const rules = t({ format: 'email' });
    expect(checkRow(rules, 'create', { full_name: 'not-an-email' }, { dialect: 'postgres' })).toEqual({
      full_name: { code: 'format' },
    });
    expect(checkRow(rules, 'create', { full_name: 'ada@example.com' }, { dialect: 'postgres' })).toBeNull();
    // …and a column with NO rule is never format-checked, whatever it is
    // called: enforcing a classifier's guess would fail imports of old data.
    const guessed = tableRulesFor(target('postgres', [KEY, { name: 'email', logicalType: 'varchar' }], []));
    expect(checkRow(guessed, 'create', { email: 'not-an-email' }, { dialect: 'postgres' })).toBeNull();
  });

  it('checks bounds on a number, including one that arrived as a string', () => {
    const rules = t({ min: 0, max: 120 }, { name: 'age', logicalType: 'integer', nullable: true });
    expect(checkRow(rules, 'create', { age: '-1' }, { dialect: 'postgres' })).toEqual({
      age: { code: 'too-small', n: 0 },
    });
    expect(checkRow(rules, 'create', { age: 130 }, { dialect: 'postgres' })).toEqual({
      age: { code: 'too-large', n: 120 },
    });
    expect(checkRow(rules, 'create', { age: '42' }, { dialect: 'postgres' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What the route refuses to STORE (§5)
// ---------------------------------------------------------------------------

describe('a rule the engine could not keep is refused at the door', () => {
  const model = modelOf(
    'postgres',
    [
      KEY,
      TEXT,
      { name: 'age', logicalType: 'integer', nullable: true },
      { name: 'status', logicalType: 'enum', nullable: true, enumRef: 'public.order_status' },
      { name: 'payload', logicalType: 'json', nullable: true },
    ],
    [{ id: 'public.order_status', values: ['new', 'done'] }],
  );
  const column = (name: string) => model.tables[0]!.columns.find((c) => c.name === name)!;

  it('refuses a fill kind the column cannot hold', () => {
    expect(columnRuleIssue('column.default', { kind: 'now' }, column('full_name'), model)).toMatch(
      /date or timestamp column/,
    );
    expect(columnRuleIssue('column.default', { kind: 'uuid' }, column('age'), model)).toMatch(/uuid or text/);
    expect(columnRuleIssue('column.default', { kind: 'literal' }, column('full_name'), model)).toMatch(
      /needs the value itself/,
    );
    expect(
      columnRuleIssue('column.default', { kind: 'literal', text: 'x' }, column('full_name'), model),
    ).toBeNull();
  });

  it('refuses re-filling on every change for a kind that has nothing new to say', () => {
    // A literal re-written on every save is noise; a uuid re-minted on every
    // save changes the row's key (plan 33's lesson).
    expect(
      columnRuleIssue('column.default', { kind: 'literal', text: 'x', onUpdate: true }, column('full_name'), model),
    ).toMatch(/current time and the signed-in user/);
    expect(
      columnRuleIssue('column.default', { kind: 'now', onUpdate: true }, column('age'), model),
    ).toMatch(/date or timestamp/);
  });

  it('refuses a list where the database already fixes the values, and says where to go', () => {
    const issue = columnRuleIssue('column.options', { values: [{ value: 'x' }] }, column('status'), model);
    expect(issue).toMatch(/already fixes/);
    expect(issue).toMatch(/new, done/);
    expect(issue).toMatch(/Design/);
  });

  it('refuses a list on a column whose answers are not a vocabulary', () => {
    expect(columnRuleIssue('column.options', { values: [{ value: 'x' }] }, column('payload'), model)).toMatch(
      /json column cannot have a list/,
    );
  });

  it('refuses a list key nothing defines, and takes one the workspace has', () => {
    expect(columnRuleIssue('column.options', { list: 'made-up' }, column('full_name'), model)).toMatch(
      /no list called/,
    );
    expect(
      columnRuleIssue('column.options', { list: 'builtin:countries' }, column('full_name'), model),
    ).toBeNull();
    /*
     * A custom list is a row in the store, so only a caller holding the store
     * can say whether it exists — the route passes the keys, and a caller with
     * no store (an offline project check) knows only the built-ins.
     */
    expect(
      columnRuleIssue('column.options', { list: 'stages' }, column('full_name'), model, new Set(['stages'])),
    ).toBeNull();
    expect(
      columnRuleIssue('column.options', { list: 'stages' }, column('full_name'), model, new Set()),
    ).toMatch(/no list called/);
  });

  it('refuses a duplicated value', () => {
    expect(
      columnRuleIssue(
        'column.options',
        { values: [{ value: 'a' }, { value: 'a' }] },
        column('full_name'),
        model,
      ),
    ).toMatch(/listed twice/);
  });

  it('refuses a bound that cannot be met and a rule on the wrong type', () => {
    expect(columnRuleIssue('column.validation', { min: 10, max: 1 }, column('age'), model)).toMatch(
      /cannot be larger/,
    );
    expect(columnRuleIssue('column.validation', { maxLength: 10 }, column('age'), model)).toMatch(
      /length rule needs a text column/,
    );
    expect(columnRuleIssue('column.validation', { max: 10 }, column('full_name'), model)).toMatch(
      /needs a number column/,
    );
    expect(columnRuleIssue('column.validation', { format: 'email' }, column('full_name'), model)).toBeNull();
  });
});
