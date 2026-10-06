// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RECEIPTS — the one record of what a posting did.
 *
 * Every time a rule's phase runs for a line, Adminium writes one row in the
 * ledger's receipt table: which source row, which line, which posting, which
 * phase, which ROUND. A round is one life of a posting for a line — held,
 * taken, given back. A line given back and sold again starts round two. The
 * receipts answer the questions a save asks before anything is planned:
 *
 *  - is this phase already done for this line in its round (a save told
 *    twice writes once);
 *  - is a round open (a row with an open round may not be deleted, nor have
 *    a column the posting read changed);
 *  - which rows did this round write (handed to the planner when it gives
 *    them back).
 *
 * Read plainly, never with a lock: the receipt table's own key is what stops
 * two saves writing the same phase twice.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedLedger } from '../ledgers/registry.js';
import { LedgerTooLarge, rowOut, type ScalarRow } from './ledger-reads.js';
import type { Row } from './mask.js';

type Db = Kysely<SourceDatabase>;
export type ReceiptPhase = 'reserve' | 'post' | 'reverse';

export interface Receipt {
  id: string | number;
  /** The source row's table and the line's, in their stored names; `''` for a posting of a whole row. */
  sourceTable: string;
  sourceRow: string;
  sourceLine: string;
  lineTable: string;
  ledger: string;
  action: string;
  posting: string;
  phase: ReceiptPhase;
  round: number;
  /** `unplanned`: let through while the add-on could not answer, to be caught up. */
  state: 'planned' | 'unplanned';
  heldUntil: unknown;
}

export function receiptOf(row: Row): Receipt {
  return {
    id: row['id'] as string | number,
    sourceTable: String(row['source_table'] ?? ''),
    sourceRow: String(row['source_row'] ?? ''),
    sourceLine: String(row['source_line'] ?? ''),
    lineTable: String(row['line_table'] ?? ''),
    ledger: String(row['ledger'] ?? ''),
    action: String(row['action'] ?? ''),
    posting: String(row['posting'] ?? ''),
    phase: String(row['phase']) as ReceiptPhase,
    round: Number(row['round']),
    state: row['state'] === 'unplanned' ? 'unplanned' : 'planned',
    heldUntil: row['held_until'] ?? null,
  };
}

const ordered = (ledger: Pick<ResolvedLedger, 'receipts'>, db: Db) => {
  let query = db.selectFrom(ledger.receipts.id as never).selectAll();
  for (const column of ledger.receipts.primaryKey) query = query.orderBy(sql.ref(column));
  return query;
};

/** Every receipt of one source row, oldest first: one plain read, on the pool before a save and on its transaction inside it. */
export async function receiptsOfSource(db: Db, ledger: Pick<ResolvedLedger, 'receipts'>, source: { table: string; row: string }): Promise<Receipt[]> {
  const rows = (await ordered(ledger, db).where(sql.ref('source_table'), '=', source.table as never).where(sql.ref('source_row'), '=', source.row as never).execute()) as Row[];
  return rows.map(receiptOf);
}

/** Every receipt of one line, whichever source row it hangs under. */
export async function receiptsOfLine(db: Db, ledger: Pick<ResolvedLedger, 'receipts'>, line: { table: string; row: string }): Promise<Receipt[]> {
  const rows = (await ordered(ledger, db).where(sql.ref('line_table'), '=', line.table as never).where(sql.ref('source_line'), '=', line.row as never).execute()) as Row[];
  return rows.map(receiptOf);
}

export interface RoundState {
  /** The round a phase that runs now belongs to: one more than the rounds given back. */
  round: number;
  reserved: Receipt | null;
  posted: Receipt | null;
}

/** Where one posting stands for one line (`''` for a whole row), read off the receipts of its source. */
export function roundOf(receipts: readonly Receipt[], posting: string, line: string, lineTable?: string): RoundState {
  // Two tables of lines under one source may each carry a rule of the same name, and a row of the same key.
  const mine = receipts.filter((receipt) => receipt.posting === posting && receipt.sourceLine === line && (lineTable === undefined || receipt.lineTable === lineTable));
  const round = 1 + mine.filter((receipt) => receipt.phase === 'reverse').length;
  const inRound = mine.filter((receipt) => receipt.round === round);
  return { round, reserved: inRound.find((receipt) => receipt.phase === 'reserve') ?? null, posted: inRound.find((receipt) => receipt.phase === 'post') ?? null };
}

/**
 * Whether a phase still has something to do for a line: a hold or a taking
 * that is not in the round yet; a giving back only when the round holds
 * something to give. A save told twice finds its phase done and plans
 * nothing.
 */
export function phaseDue(state: RoundState, phase: ReceiptPhase): boolean {
  if (phase === 'reserve') return state.reserved === null && state.posted === null;
  if (phase === 'post') return state.posted === null;
  return state.reserved !== null || state.posted !== null;
}

/** The postings and lines whose round holds something not given back. */
export function openRounds(receipts: readonly Receipt[]): { posting: string; line: string; round: number }[] {
  const seen = new Set<string>();
  const out: { posting: string; line: string; round: number }[] = [];
  for (const receipt of receipts) {
    const key = `${receipt.posting} ${receipt.sourceLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = roundOf(receipts, receipt.posting, receipt.sourceLine);
    if (state.reserved !== null || state.posted !== null) out.push({ posting: receipt.posting, line: receipt.sourceLine, round: state.round });
  }
  return out;
}

/** The most rows one round's receipts may have written, per table. */
const ROUND_ROWS_MAX = 500;

/**
 * What a round wrote, by the add-on's own table names: every row of the
 * tables its code may write that carries one of the round's receipt ids.
 * Handed to the planner when it gives the round back, and when it takes what
 * it held.
 */
export async function roundRows(db: Db, ledger: Pick<ResolvedLedger, 'writes' | 'refOf' | 'table'> & Partial<Pick<ResolvedLedger, 'typesOf'>>, receiptIds: readonly (string | number)[]): Promise<Record<string, ScalarRow[]>> {
  const out: Record<string, ScalarRow[]> = {};
  if (receiptIds.length === 0) return out;
  for (const tableId of [...ledger.writes.keys()].sort()) {
    const ref = ledger.refOf(tableId);
    const table = ledger.table(ref);
    if (table === null || !table.columns.has('receipt_id')) continue;
    let query = db.selectFrom(table.id as never).selectAll().where(sql.ref('receipt_id'), 'in', [...receiptIds] as never);
    for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
    const rows = (await query.limit(ROUND_ROWS_MAX + 1).execute()) as Row[];
    if (rows.length > ROUND_ROWS_MAX) throw new LedgerTooLarge(ref);
    const declared = ledger.typesOf?.(table.id);
    if (rows.length > 0) out[ref] = rows.map((row) => rowOut(table, row, declared));
  }
  return out;
}
