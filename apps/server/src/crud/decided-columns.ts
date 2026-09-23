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
 *  - RESOLVE (`column.copy`, `column.code`), before the hooks, so a hook sees
 *    the values that will be written:
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
 * sample row keeps its `S-1042`.
 */
import { randomInt } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ColumnCode, ColumnSequence, TableRules } from './column-rules.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import type { WriteAction } from './write-context.js';

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

/** Reads shared by the rows of one multi-row write: the same menu item is read once. */
export type CopyMemo = Map<string, unknown>;

interface ResolveTarget {
  db: Kysely<SourceDatabase>;
  table: ResolvedTable;
}

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
): Promise<Row> {
  if (rules === null || action === 'delete') return values;
  let out: Row | null = null;
  for (const copy of rules.copies ?? []) {
    // On an update, only a change of the link copies again.
    if (!has(values, copy.via)) continue;
    if (copy.mode === 'default' && has(values, copy.column)) continue;
    const link = values[copy.via];
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
    out ??= { ...values };
    out[copy.column] = copied;
  }
  if (action === 'create') {
    for (const code of rules.codes ?? []) {
      if (has(values, code.column)) continue;
      out ??= { ...values };
      out[code.column] = generateCode(code.prefix, code.length);
    }
  }
  return out ?? values;
}

/** The codes this create generated (not sent), to be made again after a collision. */
export function generatedCodes(rules: TableRules | null, sent: Row): ColumnCode[] {
  return (rules?.codes ?? []).filter((code) => !has(sent, code.column));
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
  }
  return out;
}

/** A unique index refused the row, on any of the three engines. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return e.code === '23505' || e.code === 'ER_DUP_ENTRY' || (typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed'));
}
