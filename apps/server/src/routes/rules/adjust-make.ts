// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ADMINIUM ADDS FOR AN OWNER'S PRICE RULE — pure.
 *
 * An owner's own tables seldom have a column for a reduction, or a table for
 * the codes typed on an order. Rather than send them to the schema editor
 * first, the rule's own sheet says "make them for me". From the rule as it is
 * to be stored and what was asked for, this works out the one schema edit to
 * run — columns added, a table made — and the rules those columns need: a
 * line's amount worked out from its price and quantity, the order's total of
 * its lines, what is left after the reduction, and the links a typed code
 * fills into the add-on's own tables.
 *
 * A column that is already there with a type that will do is used as it is; a
 * column that something else already writes, or of another kind, is a
 * refusal — said by name, before anything is made. Nothing is read or
 * written here.
 *
 * The names are fixed where the rule does not say one: a line's `amount`, the
 * order's `subtotal` and `net`, and its total under the name the rule checks
 * prices against (`expect`), else `total`. Tax is not made: what a tax is
 * taken on is the owner's to say.
 */
import type { EffectiveModel, EffectiveTable, TableAdjust } from '../../connections/effective-schema.js';
import type { EditBody } from '../../schema-ddl/programmatic.js';

/** Which of the columns the rule names, and the table of typed codes, Adminium is to add. */
export interface MakeAsked {
  lineAmount?: true | undefined;
  subtotal?: true | undefined;
  discount?: true | undefined;
  total?: true | undefined;
  codes?: { table: string } | undefined;
}

export interface Made {
  /** Every column the rule's sheet asked about: made now, or already there and used. */
  columns: { table: string; column: string; type: string; made: boolean }[];
  /** The tables made. */
  tables: string[];
  /** The rules written for them. */
  rules: { table: string; column?: string; op: string }[];
}

/** A rule to store for a made column, in real names. `table` is a table's id, or the bare name of one this edit makes. */
export interface MadeRule {
  table: string;
  column: string;
  op: string;
  value: Record<string, unknown>;
}

export interface MakePlan {
  edit: EditBody;
  made: Made;
  rules: MadeRule[];
  /** Why this cannot be made, each said of a column or a table by name. */
  refusals: { table: string; column?: string; reason: string }[];
}

/** What a reduction, an amount or a total is kept in. */
export const NUMBERS: ReadonlySet<string> = new Set(['decimal', 'numeric', 'money', 'float', 'double', 'real']);
/** The rules of a column that fill it: a column one of them writes is not also a price rule's to write. */
export const FILLS = ['formula', 'rollup', 'copy', 'sequence', 'code', 'stamp', 'perNight', 'customerKey', 'codeLast4', 'format', 'fill', 'tableRef', 'retryKey'] as const;
const MONEY = { logicalType: 'decimal', numericPrecision: 14, numericScale: 2 } as const;

/**
 * The edit, the rules and the account of them for one rule. `adjuster`: the
 * add-on's own names for its tables of codes and vouchers, for the links a
 * typed code fills.
 */
export function planMake(input: { model: Pick<EffectiveModel, 'tables'>; table: EffectiveTable; adjust: TableAdjust; make: MakeAsked; adjuster: { addOn: string; codes: string; vouchers: string } | null }): MakePlan {
  const { model, table: order, adjust, make } = input;
  const addColumns: NonNullable<EditBody['addColumns']> = [];
  const upsertTables: NonNullable<EditBody['upsertTables']> = [];
  const made: Made = { columns: [], tables: [], rules: [] };
  const rules: MadeRule[] = [];
  const refusals: MakePlan['refusals'] = [];
  const nameOf = (id: string): string => model.tables.find((table) => table.id === id)?.name ?? id;
  /** Every column this plan gives a meaning, by table: one column is asked for one thing only. */
  const planned = new Set<string>();

  /** A number column of a table: added, or found there and used. `fills`: the rule it is to carry, when Adminium works it out. */
  const number = (table: EffectiveTable, column: string, opts: { worked: boolean; rule?: { op: string; value: Record<string, unknown> } }): void => {
    if (planned.has(`${table.id}\u0000${column}`)) {
      refusals.push({ table: table.name, column, reason: `${column} is asked for twice: a reduction, an amount and a total are each a column of their own.` });
      return;
    }
    planned.add(`${table.id}\u0000${column}`);
    const found = table.columns.find((candidate) => candidate.name === column);
    if (found === undefined) {
      addColumns.push({ table: table.id, column: { name: column, ...MONEY, nullable: opts.worked, default: opts.worked ? null : { kind: 'literal', text: '0' } } as never });
      made.columns.push({ table: table.name, column, type: 'decimal', made: true });
    } else {
      if (!NUMBERS.has(String(found.logicalType))) {
        refusals.push({ table: table.name, column, reason: `${column} is there already and is ${String(found.logicalType)}, not a decimal.` });
        return;
      }
      const other = FILLS.find((fill) => (found as unknown as Record<string, unknown>)[fill] !== undefined);
      const same = opts.rule !== undefined && other !== undefined && `column.${other}` === opts.rule.op;
      if (other !== undefined && !same) {
        refusals.push({ table: table.name, column, reason: `${column} is there already and is written by another rule (${other}).` });
        return;
      }
      made.columns.push({ table: table.name, column, type: String(found.logicalType), made: false });
      // The rule it needs is there already: nothing more to write.
      if (same) return;
    }
    if (opts.rule !== undefined) {
      rules.push({ table: table.id, column, ...opts.rule }, { table: table.id, column, op: 'column.scale', value: { scale: 2 } });
      made.rules.push({ table: table.name, column, op: opts.rule.op });
    }
  };

  const parts = adjust.lines.filter((part): part is Extract<TableAdjust['lines'][number], { table: string }> => !('self' in part && part.self === true));
  const first = parts[0];
  const lines = first === undefined ? undefined : model.tables.find((candidate) => candidate.id === first.table);
  const needsLines = make.lineAmount === true || make.subtotal === true;
  if (needsLines && (first === undefined || lines === undefined)) refusals.push({ table: order.name, reason: 'The rule names no table of lines to make an amount or a subtotal from.' });

  // A table of lines the rule names that is not there, or is the order itself, is no table to add anything to.
  for (const part of parts) {
    if (part.table === order.id) refusals.push({ table: order.name, reason: 'A line part names the order\'s own table: the order as its own line is `self`.' });
    else if (!model.tables.some((candidate) => candidate.id === part.table)) refusals.push({ table: part.table, reason: `There is no table ${part.table} here.` });
  }
  /** Whether a column will be there once this has run: there now, or asked for. */
  const there = (table: EffectiveTable | undefined, column: string, asked: boolean): boolean => asked || table?.columns.some((candidate) => candidate.name === column) === true;
  if (make.subtotal === true && lines !== undefined && !there(lines, 'amount', make.lineAmount === true)) refusals.push({ table: lines.name, column: 'amount', reason: 'A subtotal adds up each line\'s amount, and the lines have none: ask for the line amount too.' });
  if (make.total === true && !there(order, 'subtotal', make.subtotal === true)) refusals.push({ table: order.name, column: 'subtotal', reason: 'A total is worked out from a subtotal, and there is none: ask for the subtotal too.' });
  if (make.total === true && !there(order, adjust.order.discount, make.discount === true)) refusals.push({ table: order.name, column: adjust.order.discount, reason: 'A total is worked out from the reduction, and there is no such column: ask for the reduction too.' });

  if (make.discount === true) {
    number(order, adjust.order.discount, { worked: false });
    for (const part of parts) {
      const of = model.tables.find((candidate) => candidate.id === part.table);
      if (of !== undefined && of.id !== order.id) number(of, part.discount, { worked: false });
    }
  }
  if (make.lineAmount === true && first !== undefined && lines !== undefined) {
    // What a line comes to before any reduction: the reduction stays beside it, never inside it.
    number(lines, 'amount', { worked: true, rule: { op: 'column.formula', value: { formula: first.quantity === undefined ? { add: [first.price, 0] } : { mul: [first.price, first.quantity] } } } });
  }
  if (make.subtotal === true && first !== undefined && lines !== undefined) {
    number(order, 'subtotal', { worked: false, rule: { op: 'column.rollup', value: { from: lines.id, via: first.via, sum: 'amount' } } });
  }
  if (make.total === true) {
    number(order, 'net', { worked: true, rule: { op: 'column.formula', value: { formula: { sub: ['subtotal', adjust.order.discount] } } } });
    number(order, adjust.expect ?? 'total', { worked: true, rule: { op: 'column.formula', value: { formula: { add: ['net', 0] } } } });
  }

  const codes = adjust.codes;
  if (make.codes !== undefined) {
    const key = order.primaryKey[0];
    const keyColumn = order.columns.find((candidate) => candidate.name === key);
    const wanted = codes === undefined ? [] : [codes.via, codes.typed, codes.code, codes.voucher, ...(codes.removed === undefined ? [] : [codes.removed])];
    const existing = model.tables.find((candidate) => candidate.name === make.codes!.table || candidate.id === make.codes!.table);
    const links = (table: string): void => {
      for (const [name, target] of [[codes!.code, input.adjuster!.codes], [codes!.voucher, input.adjuster!.vouchers]] as const) {
        rules.push({ table, column: name, op: 'column.addOnLink', value: { addOn: input.adjuster!.addOn, table: target } });
        made.rules.push({ table: make.codes!.table, column: name, op: 'column.addOnLink' });
      }
    };
    if (codes === undefined) refusals.push({ table: make.codes.table, reason: 'The rule says nothing of where codes are typed: name the table and its columns in `codes`.' });
    // The rule names the table of codes by the name it is made under — never one table made and another named.
    else if (codes.table !== make.codes.table && codes.table !== existing?.id) refusals.push({ table: make.codes.table, reason: `The rule keeps its codes in ${codes.table}, and ${make.codes.table} was asked for: name one table.` });
    else if (order.primaryKey.length !== 1 || key === undefined || keyColumn === undefined) refusals.push({ table: order.name, reason: `${order.name} has no single key a code's row could point at.` });
    else if (new Set(['id', ...wanted]).size !== wanted.length + 1) refusals.push({ table: make.codes.table, reason: 'Each column of the table of codes needs a name of its own (and `id` is its key).' });
    else if (input.adjuster === null) refusals.push({ table: make.codes.table, reason: 'The add-on that reads these codes is not here.' });
    else if (existing !== undefined) {
      // Made before (a call that stopped half way): used as it is when it holds every column asked for, and its links written again.
      const missing = wanted.find((name) => !existing.columns.some((candidate) => candidate.name === name));
      if (missing !== undefined) refusals.push({ table: make.codes.table, column: missing, reason: `A table called ${make.codes.table} is there already, without ${missing}.` });
      else {
        for (const name of wanted) made.columns.push({ table: existing.name, column: name, type: String(existing.columns.find((candidate) => candidate.name === name)!.logicalType), made: false });
        links(existing.id);
      }
    } else {
      const column = (name: string, logicalType: string, more: Record<string, unknown> = {}) => ({ name, logicalType, nullable: true, default: null, maxLength: null, numericPrecision: null, numericScale: null, comment: null, ...more });
      upsertTables.push({
        id: null,
        schema: null,
        name: make.codes.table,
        comment: null,
        columns: [
          column('id', 'integer', { nullable: false, default: { kind: 'autoincrement' } }),
          column(codes.via, String(keyColumn.logicalType), { nullable: false }),
          column(codes.typed, 'varchar', { maxLength: 64 }),
          column(codes.code, 'integer'),
          column(codes.voucher, 'integer'),
          ...(codes.removed === undefined ? [] : [column(codes.removed, 'timestamptz')]),
        ],
        primaryKey: ['id'],
        uniques: [],
        indexes: [],
        foreignKeys: [{ name: null, columns: [codes.via], toTable: order.id, toColumns: [key], onDelete: null, onUpdate: null }],
        enumValues: {},
      } as never);
      made.tables.push(make.codes.table);
      links(make.codes.table);
    }
  }
  made.rules.push({ table: nameOf(order.id), op: 'table.adjust' });
  return { edit: { ...(addColumns.length === 0 ? {} : { addColumns }), ...(upsertTables.length === 0 ? {} : { upsertTables }) }, made, rules, refusals };
}
