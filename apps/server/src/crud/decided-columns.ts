// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COLUMNS ADMINIUM DECIDES — a copied price, a running number, a code.
 *
 * Run by `crud/write-service.ts` on every write, whoever writes: a till's
 * session, a guest through the public API, an import, an automation. So a
 * browser never picks a price, a number or a code — and a public endpoint may
 * not list one of these columns as writable at all.
 *
 *     FILL → RESOLVE → before hooks → CHECK → SEQUENCE → statement
 *
 *  - RESOLVE (`column.lookup`, `column.copy`, `column.code`), before the
 *    hooks, so a hook sees the values that will be written:
 *      · a code a person typed is found first (`crud/code-lookup.ts`), so a
 *        copy through the link it fills reads the row just found;
 *      · a copy reads the linked row's column through the write's own handle
 *        (the transaction, inside one). A value the writer sent wins in
 *        `default` mode and never in `always` mode. On an update it runs only
 *        when the link itself changes.
 *      · a code is random Crockford base 32 — no I, L, O or U to misread —
 *        after its prefix. The column's unique index is the arbiter: a create
 *        that collides is tried again with a fresh code (see the service).
 *  - SEQUENCE (`column.sequence`), after CHECK and immediately before the
 *    statement, so a refused write burns no number. The counter lives in the
 *    meta store's document sequences, keyed `app:<connection>:<table>.<column>`,
 *    and starts past the column's largest number on first use. Gaps are
 *    accepted: a statement that fails after its claim leaves one.
 *
 * A value the writer supplied always wins over a code or a number, so a
 * sample row keeps its `S-1042`. An EMPTY code is none: a sample row or an
 * import that brings `share_token: null` gets one made, as a create that
 * leaves the column out does — a shared link with no code opens nothing. Only
 * an undo puts an empty one back, as it was.
 */
import { randomInt } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { clearedLinks, resolveLookups, type LookupOptions } from './code-lookup.js';
import type { ColumnCode, ColumnSequence, TableRules } from './column-rules.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { settingValue } from './rule-settings.js';
import type { WriteAction } from './write-context.js';

/**
 * The inputs of a ledger action that Adminium decides (an amount a card may
 * pay), by where a posting goes; `null` when the ledger is not at hand.
 */
export type DecidedInputs = (into: { addOn: string; ledger: string; action: string }) => readonly string[] | null;

/**
 * THE COLUMNS A TABLE'S RULES MAKE ADMINIUM'S, beside each column's own rule.
 *
 * A price rule (`adjust`) names the columns Adminium writes from the add-on's
 * answer. A posting hands columns of a row to an add-on's ledger; two kinds of them
 * are written by Adminium and by nobody else: the column a posting's
 * `heldUntil` reads (a guest never sets how long a hold lasts), and a column
 * mapped to an input the ledger's action decides. Either may sit on the row
 * itself, or — for a posting whose rows are lines (`via`) — on the parent the
 * lines belong to (`{parent: <column>}`).
 *
 * One function, so every reader that asks "may a guest write this column"
 * gives the same answer: a public entry's check, the key a manifest grants,
 * the definition an operator edits.
 */
export function ruleDecidedColumns(
  table: Pick<EffectiveTable, 'id' | 'postings' | 'adjust'> & { columns?: readonly { name: string; customerKey?: unknown }[] | undefined },
  model: Pick<EffectiveModel, 'tables' | 'relations'>,
  decides?: DecidedInputs,
): Set<string> {
  const out = new Set<string>();
  // A customer's key: a keyed hash of the address beside it, which Adminium alone makes.
  for (const column of table.columns ?? []) if (column.customerKey !== undefined) out.add(column.name);
  // A price rule: every reduction, who gave one by hand, whether the customer was proved, the links a
  // typed code fills, a refund's amount and tax — on the order's table, and on each child table the rule names.
  for (const order of model.tables.some((candidate) => candidate.id === table.id) ? model.tables : [...model.tables, table as EffectiveTable]) {
    const adjust = order.adjust;
    if (adjust === undefined) continue;
    const add = (of: string, column: string | undefined) => {
      if (of === table.id && column !== undefined) out.add(column);
    };
    add(order.id, adjust.order.discount);
    add(order.id, adjust.order.staff?.by);
    add(order.id, adjust.order.customer?.proved);
    for (const part of adjust.lines) add('self' in part ? order.id : part.table, part.discount);
    add(adjust.codes?.table ?? '', adjust.codes?.code);
    add(adjust.codes?.table ?? '', adjust.codes?.voucher);
    add(adjust.refunds?.table ?? '', adjust.refunds?.amount);
    add(adjust.refunds?.table ?? '', adjust.refunds?.tax);
  }
  const decidedOf = (posting: NonNullable<EffectiveTable['postings']>[number]): ReadonlySet<string> => new Set(decides?.(posting.into) ?? []);
  // The table's own postings: a column of the row itself.
  for (const posting of table.postings ?? []) {
    if (typeof posting.heldUntil === 'string') out.add(posting.heldUntil);
    const decided = decidedOf(posting);
    for (const [input, mapping] of Object.entries(posting.map)) {
      if (decided.has(input) && typeof mapping === 'string') out.add(mapping);
    }
  }
  // Postings of the tables whose rows are this table's lines: a column of the parent.
  for (const child of model.tables) {
    for (const posting of child.postings ?? []) {
      if (posting.via === undefined) continue;
      const toHere = model.relations.some(
        (relation) => relation.through === null && relation.from.tableId === child.id && relation.from.columns.length === 1 && relation.from.columns[0] === posting.via && relation.to.tableId === table.id,
      );
      if (!toHere) continue;
      const ofParent = (mapping: unknown): string | null =>
        typeof mapping === 'object' && mapping !== null && typeof (mapping as { parent?: unknown }).parent === 'string' ? (mapping as { parent: string }).parent : null;
      const held = ofParent(posting.heldUntil);
      if (held !== null) out.add(held);
      const decided = decidedOf(posting);
      for (const [input, mapping] of Object.entries(posting.map)) {
        const column = ofParent(mapping);
        if (decided.has(input) && column !== null) out.add(column);
      }
    }
  }
  return out;
}

/** The meta store's counters, as far as a write uses them (`documentSequencesRepo`). */
export interface SequenceStore {
  read(key: string): Promise<{ next: number } | null>;
  claim(key: string): Promise<number>;
  raiseTo(key: string, floor: number): Promise<number>;
}

/** Crockford's base 32: digits and letters, without I, L, O and U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateCode(prefix: string, length: number): string {
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += CROCKFORD[randomInt(CROCKFORD.length)];
  return out;
}

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/** Whether the writer gave a code: a value, not a column left out, `null` or `''` (unless an undo keeps those). */
function codeGiven(values: Row, column: string, keepEmpty: boolean): boolean {
  if (!has(values, column)) return false;
  const value = values[column];
  return keepEmpty || (value !== null && value !== undefined && value !== '');
}

/** Reads shared by the rows of one multi-row write: the same menu item is read once. */
export type CopyMemo = Map<string, unknown>;

const COPIED = Symbol('adminium.copied');

/** What a copy read, as it read it: `<via>` → `<from>` → the value. */
export type CopiedValues = Record<string, Record<string, unknown>>;

type Copying = Row & { [COPIED]?: CopiedValues };

/**
 * What this write's copies read from the rows its links point at, as read —
 * before any rounding — so a writer holding a linked row later can tell it
 * changed in between (`crud/states.ts`). The symbol survives every spread on
 * the way to the statement, and no statement writes it.
 */
export function copiedOf(row: Row): CopiedValues | undefined {
  return (row as Copying)[COPIED];
}

interface ResolveTarget {
  db: Kysely<SourceDatabase>;
  table: ResolvedTable;
}

/** What finding a typed code needs of the write (`crud/code-lookup.ts`); absent: a write that finds none. */
export type ResolveOptions = LookupOptions;

/** Whether two values of a link name the same row: a key reads as a number from one door and as text from another. */
const sameLink = (a: unknown, b: unknown): boolean =>
  a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : String(a) === String(b);

/**
 * The values with every copy and code resolved. Returns the SAME OBJECT when
 * nothing was added, like `fillRow`.
 */
export async function resolveRow(
  rules: TableRules | null,
  action: WriteAction,
  target: ResolveTarget,
  values: Row,
  memo: CopyMemo = new Map(),
  /** An undo: an empty code is put back as it was. */
  keepEmptyCodes = false,
  /** A code a person typed, found first: the copies below read through the link it fills. */
  lookups?: ResolveOptions,
): Promise<Row> {
  if (rules === null || action === 'delete') return values;
  const looked = lookups === undefined ? values : await resolveLookups(rules.codeLookups ?? [], action, target, values, lookups);
  let out: Row | null = looked === values ? null : looked;
  // A link a typed code filled, emptied by this write: what was copied through it goes with it.
  const cleared = new Set(clearedLinks(looked));
  let storedOnce: Promise<Row | null> | null = null;
  const storedRow = () => (storedOnce ??= lookups?.stored?.() ?? Promise.resolve(null));
  for (const copy of rules.copies ?? []) {
    // The values so far: a link an earlier copy filled (a ticket's show, from
    // its type) is read here like one the writer sent — the copies run in
    // that order (`column-rules.ts`).
    const current = out ?? looked;
    // On an update, only a change of the link copies again.
    if (!has(current, copy.via)) continue;
    /*
     * A link SENT is not a link CHANGED. A person's own write through the
     * public API carries the link that makes the row theirs (an invoice's
     * client), unchanged; copied again, the client's tax rate — empty on a
     * new client, where the invoice holds 0 — read as a change of a sent
     * invoice, and the lock refused "I've sent a payment" for a column the
     * write never named.
     */
    if (action === 'update' && lookups?.stored !== undefined) {
      const before = await storedRow();
      if (before !== null && sameLink(before[copy.via], current[copy.via])) continue;
    }
    if (copy.mode === 'default' && has(current, copy.column)) continue;
    const link = current[copy.via];
    if ((link === null || link === undefined) && cleared.has(copy.via)) {
      out ??= { ...looked };
      out[copy.column] = null;
      continue;
    }
    if (link === null || link === undefined) continue;
    const key = `${copy.toTable}|${copy.toColumn}|${copy.from}|${String(link)}`;
    let copied = memo.get(key);
    if (!memo.has(key)) {
      const row = (await target.db
        .selectFrom(copy.toTable)
        .select(sql<unknown>`${sql.ref(copy.from)}`.as('value'))
        .where((eb) => eb(target.db.dynamic.ref(copy.toColumn), '=', link))
        .executeTakeFirst()) as { value?: unknown } | undefined;
      copied = row?.value;
      memo.set(key, copied);
    }
    // A link to nothing is the database's to refuse, with its own words.
    if (copied === undefined) continue;
    out ??= { ...looked };
    out[copy.column] = copied;
    const read = ((out as Copying)[COPIED] = { ...((out as Copying)[COPIED] ?? {}) });
    read[copy.via] = { ...(read[copy.via] ?? {}), [copy.from]: copied };
  }
  if (action === 'create') {
    for (const code of rules.codes ?? []) {
      if (codeGiven(values, code.column, keepEmptyCodes)) continue;
      out ??= { ...looked };
      out[code.column] = generateCode(code.prefix, code.length);
    }
  }
  return out ?? values;
}

/** The codes this create generated (not sent), to be made again after a collision. */
export function generatedCodes(rules: TableRules | null, sent: Row, keepEmptyCodes = false): ColumnCode[] {
  return (rules?.codes ?? []).filter((code) => !codeGiven(sent, code.column, keepEmptyCodes));
}

/** The same values with each generated code made again. */
export function regenerateCodes(values: Row, codes: readonly ColumnCode[]): Row {
  const out = { ...values };
  for (const code of codes) out[code.column] = generateCode(code.prefix, code.length);
  return out;
}

export function sequenceKey(connectionId: string, table: ResolvedTable, column: string): string {
  return `app:${connectionId}:${table.id}.${column}`;
}

/** The largest number already in the column, or 0: text like `S-1042` counts as none. */
async function largestNumber(target: ResolveTarget, sequence: ColumnSequence): Promise<number> {
  const row = (await target.db
    .selectFrom(target.table.id)
    .select((eb) => eb.fn.max(target.db.dynamic.ref(sequence.column) as never).as('top'))
    .executeTakeFirst()) as { top?: unknown } | undefined;
  const top = Number(row?.top);
  return Number.isFinite(top) ? Math.floor(top) : 0;
}

/**
 * The values with every absent numbered column given its next number. Run
 * after CHECK, immediately before the statement. Creates only.
 */
export async function claimSequences(
  rules: TableRules | null,
  action: WriteAction,
  target: ResolveTarget & { connectionId: string },
  values: Row,
  store: SequenceStore | undefined,
): Promise<Row> {
  const sequences = action === 'create' ? (rules?.sequences ?? []).filter((s) => !has(values, s.column)) : [];
  if (sequences.length === 0) return values;
  if (store === undefined) {
    throw new Error(`${target.table.id} numbers ${sequences[0]!.column}, and this write has no counter to number it from.`);
  }
  const out = { ...values };
  for (const sequence of sequences) {
    const key = sequenceKey(target.connectionId, target.table, sequence.column);
    if ((await store.read(key)) === null) {
      await store.raiseTo(key, Math.max(sequence.start, (await largestNumber(target, sequence)) + 1));
    }
    const next = await store.claim(key);
    out[sequence.column] = sequence.logicalType === 'text' || sequence.logicalType === 'varchar' ? String(next) : next;
    // The number as people read it, written with it: its prefix (the setting's, when a settings row names one) and its digits.
    const format = sequence.format;
    if (format !== undefined && !has(values, format.column)) {
      const set = format.prefixSetting === undefined ? undefined : await settingValue(target.db, format.prefixSetting, undefined);
      out[format.column] = `${typeof set === 'string' ? set : (format.prefix ?? '')}${String(next).padStart(format.pad, '0')}`;
    }
  }
  return out;
}

/** A unique index refused the row, on any of the three engines. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return e.code === '23505' || e.code === 'ER_DUP_ENTRY' || (typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed'));
}
