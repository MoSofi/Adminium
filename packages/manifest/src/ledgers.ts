// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LEDGERS AND POSTINGS.
 *
 * A ledger is an add-on's own set of tables that only Adminium writes, from
 * rows the add-on's code works out (stock movements, a gift card's spends).
 * The add-on declares it under `addOn.ledgers`: its receipt table, the tables
 * and columns that may be written, and its ACTIONS (use, receive, spend …) —
 * each with the inputs it takes, the rows it reads first and the rows a lock
 * is named by.
 *
 * A posting is the other half, declared on any table of any manifest
 * (`postings`): "when a row of this table reaches this point, hand these
 * columns to that action". An order line reserving stock at checkout and
 * taking it when the order is picked up is one posting with two points.
 *
 * This file holds the words and what one manifest can check of them by
 * itself. Whether a host's posting fits the ledger it names is checked with
 * both manifests at hand (`postingFitIssues`), at install and when an owner
 * stores a rule.
 *
 * Pure: no I/O, and nothing imported from the manifest's own schema file, so
 * that file may import this one.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, type ReferenceIssue } from './refs.js';

const kebab = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kebab-case id');
const addOnKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key');
const inputName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a snake_case name');
const readName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a snake_case name');
const stateName = z.string().min(1).max(40);

// ── limits ───────────────────────────────────────────────────────────────────

/** The most ledgers one add-on declares. */
export const LEDGERS_MAX = 4;
/** The most actions one ledger declares. */
export const LEDGER_ACTIONS_MAX = 16;
/** The most tables one ledger may write. */
export const LEDGER_WRITES_MAX = 12;
/** The most reads one action declares. */
export const LEDGER_READS_MAX = 6;
/** The most rows one read returns. */
export const LEDGER_READ_ROWS = 1000;
/** The most postings one table carries. */
export const POSTINGS_PER_TABLE = 6;

// ── the ledger ───────────────────────────────────────────────────────────────

/** What an action's input is: a link, a number, text, a date, a yes/no, a table's stored name, or a row of any table. */
export const LEDGER_INPUT_TYPES = ['link', 'link?', 'number', 'number?', 'decimal', 'decimal?', 'text', 'text?', 'date?', 'bool?', 'tableRef', 'rowRef'] as const;
export type LedgerInputType = (typeof LEDGER_INPUT_TYPES)[number];

/** Whether a posting may leave the input unmapped. */
export const optionalInput = (type: LedgerInputType): boolean => type.endsWith('?');

/** The phases of a posting round: held, taken, given back. */
export const POSTING_PHASES = ['reserve', 'post', 'reverse'] as const;
export type PostingPhase = (typeof POSTING_PHASES)[number];

/**
 * Where a read's key comes from: an input of the action (`input.item`; a
 * `rowRef` input as `input.what.table` / `input.what.row`), a column of an
 * earlier read (`items.unit_id`), the source row (`source.table`,
 * `source.row`, `source.line`), the round's receipt (`receipt.id`), a column
 * of the add-on's settings row (`setting.low_below`), or what a price
 * question recorded (`uses.offer`, `uses.code`, `uses.voucher`).
 */
export const readFromSchema = z
  .string()
  .regex(
    /^(input\.[a-z][a-z0-9_]*(\.(table|row))?|source\.(table|row|line)|receipt\.id|setting\.[a-z][a-z0-9_]*|uses\.(offer|code|voucher)|[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/,
    'input.<name>, <read>.<column>, source.table | source.row | source.line, receipt.id, setting.<column> or uses.offer | uses.code | uses.voucher',
  );

const readWhereSchema = z
  .object({ column: refSchema, eq: scalarSchema.optional(), in: z.array(scalarSchema).min(1).max(16).optional() })
  .strict()
  .refine((w) => (w.eq === undefined) !== (w.in === undefined), { message: 'a condition gives one of `eq` or `in`' });

/** One read an action makes before its code runs: rows of an own table, by up to three keys. */
export const ledgerReadSchema = z
  .object({
    as: readName,
    table: refSchema,
    /** Each key column and where its values come from; several sources are read together. */
    by: z.array(z.object({ column: refSchema, from: z.union([readFromSchema, z.array(readFromSchema).min(1).max(3)]) }).strict()).max(3),
    where: z.array(readWhereSchema).max(3).optional(),
    limit: z.number().int().min(1).max(LEDGER_READ_ROWS).optional(),
  })
  .strict();
export type LedgerRead = z.infer<typeof ledgerReadSchema>;

/** What Adminium fills in for the action, between a floor of zero and a ceiling it reads itself. */
const decidesSchema = z
  .object({
    input: inputName,
    min: z.literal('0'),
    max: z.union([z.object({ input: inputName }).strict(), z.object({ read: readName, column: refSchema }).strict()]),
  })
  .strict();

export const ledgerActionSchema = z
  .object({
    inputs: z.record(inputName, z.enum(LEDGER_INPUT_TYPES)),
    phases: z.array(z.enum(POSTING_PHASES)).min(1).max(3),
    reads: z.array(ledgerReadSchema).max(LEDGER_READS_MAX),
    /** What a lock is named by: a column of a read's rows, standing for a row of `table`. */
    locks: z.array(z.object({ read: readName, column: refSchema, table: refSchema }).strict()).min(1).max(4),
    decides: z.array(decidesSchema).min(1).max(4).optional(),
    /** A reserve writes rows that expire: a posting into this action says until when. */
    holds: z.literal(true).optional(),
    /** While the add-on cannot answer: a yes/no column of a read that lets the save through unplanned. */
    unavailable: z.object({ allow: z.object({ read: readName, column: refSchema }).strict() }).strict().optional(),
    /** The tables of the ledger's `writes` this action writes; absent, all of them. */
    writes: z.array(refSchema).min(1).max(LEDGER_WRITES_MAX).optional(),
  })
  .strict()
  .refine((a) => new Set(a.phases).size === a.phases.length, { message: 'a phase is listed once', path: ['phases'] })
  .refine((a) => new Set(a.reads.map((read) => read.as)).size === a.reads.length, { message: 'two reads share a name', path: ['reads'] });
export type LedgerAction = z.infer<typeof ledgerActionSchema>;

const writeScopeSchema = z
  .object({
    insert: z.array(refSchema).min(1).max(40).optional(),
    update: z.object({ by: z.array(refSchema).min(1).max(4), set: z.array(refSchema).min(1).max(20) }).strict().optional(),
  })
  .strict()
  .refine((scope) => scope.insert !== undefined || scope.update !== undefined, { message: 'a written table takes inserts, updates, or both' });

export const ledgerSchema = z
  .object({
    id: kebab,
    /** The receipt table: one row per source, line, posting, phase and round, written by Adminium alone. */
    receipts: refSchema,
    /** Which public answer a refusal becomes: out of stock, or a refused card. */
    refusal: z.enum(['stock', 'value']),
    writes: z.record(refSchema, writeScopeSchema).refine((writes) => Object.keys(writes).length >= 1 && Object.keys(writes).length <= LEDGER_WRITES_MAX, {
      message: `a ledger writes 1 to ${String(LEDGER_WRITES_MAX)} tables`,
    }),
    actions: z.record(kebab, ledgerActionSchema).refine((actions) => Object.keys(actions).length >= 1 && Object.keys(actions).length <= LEDGER_ACTIONS_MAX, {
      message: `a ledger declares 1 to ${String(LEDGER_ACTIONS_MAX)} actions`,
    }),
  })
  .strict();
export type Ledger = z.infer<typeof ledgerSchema>;

export const ledgersSchema = z
  .array(ledgerSchema)
  .min(1)
  .max(LEDGERS_MAX)
  .refine((ledgers) => new Set(ledgers.map((ledger) => ledger.id)).size === ledgers.length, { message: 'two ledgers share an id' });

// ── the posting ──────────────────────────────────────────────────────────────

/**
 * The moment a posting's phase fires: the row's own create; a move of its
 * state; a column reaching a value; a column being filled. Under `via` every
 * point but a create is judged on the parent row, unless it says `own`.
 */
export const postingPointSchema = z.union([
  z.object({ create: z.literal(true) }).strict(),
  z.object({ to: z.array(stateName).min(1).max(16), from: z.array(stateName).min(1).max(16).optional() }).strict(),
  z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(16), from: z.array(scalarSchema).min(1).max(16).optional(), own: z.literal(true).optional() }).strict(),
  z.object({ column: refSchema, set: z.literal(true), own: z.literal(true).optional() }).strict(),
]);
export type PostingPoint = z.infer<typeof postingPointSchema>;

/** What an input is filled from: a column of the row, the row itself, a column of the `via` parent, a setting of the add-on, or a fixed value. */
export const postingMappingSchema = z.union([
  refSchema,
  z.object({ row: z.literal(true) }).strict(),
  z.object({ parent: refSchema }).strict(),
  z.object({ setting: refSchema }).strict(),
  z.object({ value: scalarSchema }).strict(),
]);
export type PostingMapping = z.infer<typeof postingMappingSchema>;

const phaseSchema = z.object({ on: postingPointSchema }).strict();

export const postingSchema = z
  .object({
    id: kebab,
    into: z.object({ addOn: addOnKey, ledger: kebab, action: kebab }).strict(),
    /** The rule is live only while this feature's add-ons are there (an app's `addOns.features`). */
    needs: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id').optional(),
    /** This table's rows are lines of the row this foreign key names. */
    via: refSchema.optional(),
    reserve: phaseSchema.optional(),
    post: phaseSchema.optional(),
    reverse: phaseSchema.optional(),
    map: z.record(inputName, postingMappingSchema),
    multipliers: z.record(inputName, postingMappingSchema).optional(),
    /** Until when a hold lasts; needed when the action holds. */
    heldUntil: postingMappingSchema.optional(),
    /** The save is refused while a sibling line has this column filled (a card never pays for a card). */
    refuses: z
      .array(z.object({ table: refSchema.optional(), via: refSchema.optional(), column: refSchema, set: z.literal(true) }).strict())
      .min(1)
      .max(4)
      .optional(),
    /** A line with this column filled is left out of every call (a voided line). */
    unlessSet: refSchema.optional(),
    /** Only such lines are handed over (a payment by card, not by cash). */
    only: z
      .union([
        z.object({ column: refSchema, eq: scalarSchema }).strict(),
        z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(16) }).strict(),
        z.object({ column: refSchema, set: z.literal(true) }).strict(),
      ])
      .optional(),
  })
  .strict();
export type Posting = z.infer<typeof postingSchema>;

export const postingsSchema = z
  .array(postingSchema)
  .min(1)
  .max(POSTINGS_PER_TABLE)
  .refine((postings) => new Set(postings.map((posting) => posting.id)).size === postings.length, { message: 'two postings of the table share an id' });

/** The owner's switch, stored apart from the rule so an app update never switches it back on. */
export const switchedOffSchema = z.object({ postings: z.array(kebab).max(POSTINGS_PER_TABLE), adjust: z.literal(true).optional() }).strict();
export type SwitchedOff = z.infer<typeof switchedOffSchema>;

// ── what one manifest can check ──────────────────────────────────────────────

/** What the checks read of a table. */
export interface LedgerTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    nullable?: boolean | undefined;
    enum?: readonly string[] | undefined;
    references?: string | undefined;
    maxLength?: number | undefined;
    rules?:
      | {
          rollup?: { balance?: { column: string } | undefined } | undefined;
          copy?: { follow?: unknown } | undefined;
          tableRef?: true | undefined;
        }
      | undefined;
  }[];
  states?: { column: string; initial: string; moves: Readonly<Record<string, readonly unknown[]>>; timed?: unknown } | undefined;
  postings?: readonly Posting[] | undefined;
}

/** Every state a table's `states` names. */
function statesOf(table: LedgerTableShape): Set<string> {
  const out = new Set<string>();
  if (table.states === undefined) return out;
  out.add(table.states.initial);
  for (const [from, moves] of Object.entries(table.states.moves)) {
    out.add(from);
    for (const move of moves) out.add(typeof move === 'string' ? move : String((move as { to: unknown }).to));
  }
  return out;
}

/** The columns of a table that are a balance another column's total keeps. */
function balanceColumns(table: LedgerTableShape): Set<string> {
  return new Set(table.columns.flatMap((column) => (column.rules?.rollup?.balance === undefined ? [] : [column.rules.rollup.balance.column])));
}

/**
 * Everything wrong with a table's postings that this manifest can see: its
 * points, its `via`, the columns it maps, and — for an add-on posting into
 * its own ledger — the fit with the action it names.
 */
export function postingIssues(
  table: LedgerTableShape,
  ctx: {
    /** This manifest's key and kind. */
    key: string;
    kind: 'app' | 'add-on';
    tables: ReadonlyMap<string, LedgerTableShape>;
    /** The add-ons the manifest names (`requires` and `suggests`). */
    named: ReadonlySet<string>;
    /** An app's `addOns.features`, by id, with the add-ons each needs. */
    features: ReadonlyMap<string, readonly string[]>;
    /** The manifest's own ledgers, when it is an add-on. */
    ledgers: readonly Ledger[];
  },
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const has = (ref: string, of: LedgerTableShape = table) => of.columns.find((column) => column.ref === ref);
  (table.postings ?? []).forEach((posting, p) => {
    const here = (...rest: (string | number)[]) => at('postings', p, ...rest);

    // Where it goes.
    const own = posting.into.addOn === ctx.key;
    if (own && ctx.kind !== 'add-on') out.push({ path: here('into', 'addOn'), message: 'a posting goes into an add-on\'s ledger, not into the app itself' });
    if (!own && !ctx.named.has(posting.into.addOn)) {
      out.push({ path: here('into', 'addOn'), message: `"${posting.into.addOn}" is not an add-on this manifest names: add it to addOns.requires or addOns.suggests` });
    }
    if (posting.needs !== undefined) {
      const feature = ctx.features.get(posting.needs);
      if (feature === undefined) out.push({ path: here('needs'), message: `"${posting.needs}" is not one of the app's addOns.features` });
      else if (!feature.includes(posting.into.addOn)) out.push({ path: here('needs'), message: `the feature "${posting.needs}" does not need "${posting.into.addOn}", so it cannot switch this posting` });
    }

    // Whose rows the points are judged on.
    let parent: LedgerTableShape | undefined;
    if (posting.via !== undefined) {
      const link = has(posting.via);
      if (link === undefined || link.type !== 'fk' || link.references === undefined) {
        out.push({ path: here('via'), message: `"${table.ref}.${posting.via}" is not a foreign key of the table, so its rows are no lines of anything` });
      } else {
        parent = ctx.tables.get(link.references);
        if (parent === undefined) out.push({ path: here('via'), message: `"${link.references}" is not one of this manifest's tables` });
      }
    }
    if (posting.reserve === undefined && posting.post === undefined) out.push({ path: here(), message: 'a posting declares when it reserves, when it posts, or both' });

    for (const phase of POSTING_PHASES) {
      const point = posting[phase]?.on;
      if (point === undefined) continue;
      const path = here(phase, 'on');
      if ('create' in point) continue;
      if ('own' in point && point.own === true && posting.via === undefined) {
        out.push({ path: [...path, 'own'], message: '"own" judges a point on the line itself: it is said under "via"' });
      }
      // Under `via` a point is the parent's, unless it says it is the line's own.
      const judged = posting.via !== undefined && !('own' in point && point.own === true) ? parent : table;
      if (judged === undefined) continue;
      if ('to' in point) {
        if (judged.states === undefined) {
          out.push({ path: [...path, 'to'], message: `"${judged.ref}" declares no states to move between: name a column and its values instead ({"column": …, "in": […]})` });
          continue;
        }
        const states = statesOf(judged);
        for (const state of [...point.to, ...(point.from ?? [])]) {
          if (!states.has(state)) out.push({ path, message: `"${state}" is not a state of "${judged.ref}"` });
        }
        continue;
      }
      const column = has(point.column, judged);
      if (column === undefined) {
        out.push({ path: [...path, 'column'], message: `"${judged.ref}" has no column "${point.column}"` });
      } else if ('set' in point) {
        if (column.nullable !== true) out.push({ path: [...path, 'column'], message: `"${judged.ref}.${point.column}" is never empty, so it is never "set": make it nullable` });
        if (phase === 'reverse' && 'from' in point) out.push({ path, message: 'a column being set has no "from"' });
      }
    }

    // What it maps.
    const mapped = (mapping: PostingMapping, path: (string | number)[], what: string) => {
      if (typeof mapping === 'string') {
        const column = has(mapping);
        if (column === undefined) {
          out.push({ path, message: `"${table.ref}" has no column "${mapping}"` });
          return;
        }
        if (balanceColumns(table).has(mapping) || column.rules?.rollup !== undefined) {
          out.push({ path, message: `"${table.ref}.${mapping}" is a total Adminium settles in the same save, so ${what} is not read from it` });
        } else if (column.rules?.copy?.follow !== undefined) {
          out.push({ path, message: `"${table.ref}.${mapping}" follows another row and is settled in the same save, so ${what} is not read from it` });
        }
        return;
      }
      if ('parent' in mapping) {
        if (posting.via === undefined) out.push({ path, message: 'a column of the parent is read under "via"' });
        else if (parent !== undefined && has(mapping.parent, parent) === undefined) out.push({ path, message: `"${parent.ref}" has no column "${mapping.parent}"` });
      }
    };
    for (const [input, mapping] of Object.entries(posting.map)) mapped(mapping, here('map', input), `the input "${input}"`);
    for (const [name, mapping] of Object.entries(posting.multipliers ?? {})) mapped(mapping, here('multipliers', name), `the multiplier "${name}"`);
    if (posting.heldUntil !== undefined) mapped(posting.heldUntil, here('heldUntil'), 'how long a hold lasts');

    if (posting.unlessSet !== undefined && has(posting.unlessSet) === undefined) out.push({ path: here('unlessSet'), message: `"${table.ref}" has no column "${posting.unlessSet}"` });
    if (posting.only !== undefined && has(posting.only.column) === undefined) out.push({ path: here('only', 'column'), message: `"${table.ref}" has no column "${posting.only.column}"` });
    (posting.refuses ?? []).forEach((refusal, r) => {
      const path = here('refuses', r);
      if ((refusal.table === undefined) !== (refusal.via === undefined)) {
        out.push({ path, message: 'lines of another table are named by that table and its foreign key to the same parent ("table" and "via" together)' });
        return;
      }
      const sibling = refusal.table === undefined ? table : ctx.tables.get(refusal.table);
      if (sibling === undefined) {
        out.push({ path: [...path, 'table'], message: `"${String(refusal.table)}" is not one of this manifest's tables` });
        return;
      }
      if (posting.via === undefined) out.push({ path, message: 'sibling lines are lines of one parent: said under "via"' });
      if (has(refusal.column, sibling) === undefined) out.push({ path: [...path, 'column'], message: `"${sibling.ref}" has no column "${refusal.column}"` });
      if (refusal.via !== undefined) {
        const link = has(refusal.via, sibling);
        if (link === undefined || link.type !== 'fk' || (parent !== undefined && link.references !== parent.ref)) {
          out.push({ path: [...path, 'via'], message: `"${sibling.ref}.${refusal.via}" is not a foreign key to the same parent` });
        }
      }
    });

    // An add-on posting into its own ledger: the action is at hand.
    if (own && ctx.kind === 'add-on') {
      const ledger = ctx.ledgers.find((candidate) => candidate.id === posting.into.ledger);
      if (ledger === undefined) out.push({ path: here('into', 'ledger'), message: `this add-on declares no ledger "${posting.into.ledger}"` });
      else out.push(...postingFitIssues(posting, ledger, { timed: parentTimed(posting, table, parent) }).map((issue) => ({ path: here(...issue.path), message: issue.message })));
    }
  });
  return out;
}

/** Whether the row a posting's points are judged on moves by itself in time (`states.timed`). */
function parentTimed(posting: Posting, table: LedgerTableShape, parent: LedgerTableShape | undefined): boolean {
  const judged = posting.via === undefined ? table : parent;
  return judged?.states?.timed !== undefined;
}

/**
 * Whether a posting fits the ledger action it names: the action exists, every
 * input it needs is mapped and nothing else is, its phases are ones the
 * action has, and a hold has an end.
 *
 * `timed`: whether the judged row's table moves by itself in time — a round
 * that Adminium decides at the create must be given back by something.
 */
export function postingFitIssues(posting: Posting, ledger: Ledger, facts: { timed: boolean }): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const action = ledger.actions[posting.into.action];
  if (action === undefined) {
    out.push({ path: ['into', 'action'], message: `the ledger "${ledger.id}" has no action "${posting.into.action}": it has ${Object.keys(ledger.actions).map((name) => `"${name}"`).join(', ')}` });
    return out;
  }
  for (const [input, type] of Object.entries(action.inputs)) {
    const decided = (action.decides ?? []).some((rule) => rule.input === input);
    if (posting.map[input] === undefined && !optionalInput(type) && !decided) {
      out.push({ path: ['map'], message: `the action "${posting.into.action}" needs "${input}" (${type}): map it to a column, {"row": true}, {"parent": …}, {"setting": …} or {"value": …}` });
    }
  }
  for (const input of Object.keys(posting.map)) {
    if (action.inputs[input] === undefined) out.push({ path: ['map', input], message: `the action "${posting.into.action}" takes no input "${input}"` });
  }
  for (const phase of POSTING_PHASES) {
    if (posting[phase] !== undefined && !action.phases.includes(phase)) {
      out.push({ path: [phase], message: `the action "${posting.into.action}" has no "${phase}" phase` });
    }
  }
  if (action.holds === true) {
    if (posting.reverse === undefined) out.push({ path: ['reverse'], message: `the action "${posting.into.action}" holds: say when the hold is given back ("reverse")` });
    if (posting.reserve !== undefined && posting.heldUntil === undefined) out.push({ path: ['heldUntil'], message: `the action "${posting.into.action}" holds: say until when ("heldUntil")` });
  }
  if (action.decides !== undefined) {
    const onCreate = [posting.reserve, posting.post].some((phase) => phase !== undefined && 'create' in phase.on);
    if (onCreate && posting.reverse === undefined) out.push({ path: ['reverse'], message: 'an amount Adminium decides at the create is given back by something: declare "reverse"' });
    if (onCreate && posting.heldUntil === undefined && !facts.timed) {
      out.push({ path: ['heldUntil'], message: 'an amount Adminium decides at the create needs an end: a timed move of the row\'s state that reaches the reverse point, or "heldUntil"' });
    }
    // An input another input caps is read from the parent's balance.
    for (const rule of action.decides) {
      if ('input' in rule.max && posting.map[rule.max.input] === undefined) {
        out.push({ path: ['map'], message: `"${rule.input}" is decided up to "${rule.max.input}": map "${rule.max.input}" to what is still due ({"parent": <the balance column>})` });
      }
    }
  }
  return out;
}

// ── the receipt table ────────────────────────────────────────────────────────

/** The columns of a receipt table Adminium keys by, in key order. */
export const RECEIPT_KEY = ['source_table', 'source_row', 'source_line', 'posting', 'phase', 'round'] as const;

/** Every column of a receipt table, with the type it must have. `held_until` is the one that may be empty. */
export const RECEIPT_COLUMNS: Readonly<Record<string, { type: readonly string[]; nullable?: true; enum?: readonly string[]; tableRef?: true }>> = {
  source_table: { type: ['text'], tableRef: true },
  source_row: { type: ['text'] },
  source_line: { type: ['text'] },
  line_table: { type: ['text'], tableRef: true },
  ledger: { type: ['text'] },
  action: { type: ['text'] },
  posting: { type: ['text'] },
  phase: { type: ['enum'], enum: POSTING_PHASES },
  round: { type: ['int'] },
  state: { type: ['enum'], enum: ['planned', 'unplanned'] },
  rows: { type: ['int'] },
  add_on_version: { type: ['text'] },
  origin: { type: ['enum'], enum: ['staff', 'public', 'system'] },
  by: { type: ['text'] },
  at: { type: ['timestamptz'] },
  held_until: { type: ['timestamptz'], nullable: true },
};

/**
 * Whether a table is a receipt table as Adminium writes one: exactly the
 * columns of `RECEIPT_COLUMNS` beside its key, each of its type, none but
 * `held_until` nullable, and a bounded width on every text column of the key.
 */
export function receiptTableIssues(table: LedgerTableShape, at: (...rest: (string | number)[]) => (string | number)[]): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const columns = new Map(table.columns.map((column) => [column.ref, column]));
  for (const [name, want] of Object.entries(RECEIPT_COLUMNS)) {
    const column = columns.get(name);
    if (column === undefined) {
      out.push({ path: at('columns'), message: `a receipt table has a column "${name}" (${want.type.join(' or ')})` });
      continue;
    }
    const c = table.columns.indexOf(column);
    if (!want.type.includes(column.type)) out.push({ path: at('columns', c, 'type'), message: `"${table.ref}.${name}" is ${want.type.join(' or ')}, not ${column.type}` });
    if (want.enum !== undefined && (column.enum === undefined || want.enum.some((value) => !column.enum!.includes(value)) || column.enum.length !== want.enum.length)) {
      out.push({ path: at('columns', c, 'enum'), message: `"${table.ref}.${name}" takes exactly ${want.enum.map((value) => `"${value}"`).join(', ')}` });
    }
    if ((column.nullable === true) !== (want.nullable === true)) {
      out.push({ path: at('columns', c, 'nullable'), message: want.nullable === true ? `"${table.ref}.${name}" is empty while nothing is held: make it nullable` : `"${table.ref}.${name}" is part of every receipt: it is never nullable` });
    }
    if (column.type === 'text' && column.maxLength === undefined) out.push({ path: at('columns', c, 'maxLength'), message: `"${table.ref}.${name}" needs a maxLength: Adminium indexes it` });
    if (want.tableRef === true && column.rules?.tableRef !== true) out.push({ path: at('columns', c, 'rules'), message: `"${table.ref}.${name}" holds a table's stored name: give it rules.tableRef` });
  }
  for (const column of table.columns) {
    if (column.role === 'pk' || RECEIPT_COLUMNS[column.ref] !== undefined) continue;
    out.push({ path: at('columns', table.columns.indexOf(column)), message: `a receipt table holds what Adminium writes and nothing else: take out "${column.ref}"` });
  }
  return out;
}
