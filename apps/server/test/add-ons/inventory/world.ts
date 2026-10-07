// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SMALL STOCK ROOM, MADE THROUGH REAL SAVES: a place or two, a supplier,
 * a few items, and whatever stock a test asks to open with. Every row goes
 * through the write service, so what a test starts from is what an owner's
 * own typing would have left.
 */
import type { Writing } from '../harness.js';

export const n = (value: unknown): number => Number(value);
export const yes = (value: unknown): boolean => value === true || n(value) === 1;
/** What a save says it posted: the ledger, the action, the phase, and what became of the add-on's answer. */
export const said = (one: { ledger: string; action: string; phase: string; state: string }): string => `${one.ledger} ${one.action} ${one.phase} ${one.state}`;
export const notes = (saved: { posted: { notes?: { note: string }[] }[] }): string[] => saved.posted.flatMap((one) => (one.notes ?? []).map((note) => note.note));

/** A day so many days from today, as a date column takes one: the tests hold on any day they are run. */
export const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const id = (saved: { row: Record<string, unknown> }): number => n(saved.row['id']);

export async function place(w: Writing, name: string, values: Record<string, unknown> = {}): Promise<number> {
  return id(await w.create('places', { name, ...values }));
}

export async function item(w: Writing, name: string, values: Record<string, unknown> = {}): Promise<number> {
  return id(await w.create('items', { name, ...values }));
}

/** A receipt made, filled and posted line by line, as the Receive screen does it. Answers the receipt and its lines. */
export async function receive(w: Writing, header: Record<string, unknown>, lines: Record<string, unknown>[]): Promise<{ receipt: number; lines: number[] }> {
  const receipt = id(await w.create('receipts', header));
  const made: number[] = [];
  for (const line of lines) made.push(id(await w.create('receipt_lines', { receipt_id: receipt, ...line })));
  await w.update('receipts', receipt, { status: 'posting' });
  for (const line of made) await w.update('receipt_lines', line, { status: 'posted' });
  await w.update('receipts', receipt, { status: 'posted' });
  return { receipt, lines: made };
}

/** Stock on the shelf the day the books begin. */
export async function opening(w: Writing, placeId: number, lines: Record<string, unknown>[]): Promise<{ receipt: number; lines: number[] }> {
  return receive(w, { place_id: placeId, kind: 'opening' }, lines);
}

export async function pointOf(w: Writing, itemId: number, placeId: number): Promise<Record<string, unknown>> {
  const [row] = await w.rowsOf('stock_points', `item_id = ${String(itemId)} and place_id = ${String(placeId)}`);
  if (row === undefined) throw new Error(`no stock point for item ${String(itemId)} at place ${String(placeId)}`);
  return row;
}

/** An item's movements, oldest first, as "kind quantity". */
export async function movementsOf(w: Writing, itemId: number, where = ''): Promise<string[]> {
  return (await w.rowsOf('movements', `item_id = ${String(itemId)}${where === '' ? '' : ` and ${where}`} order by id`)).map((row) => `${String(row['kind'])} ${String(n(row['qty']))}`);
}

/** A level of an item at a place by its batch code; the unassigned one for no code. */
export async function levelOf(w: Writing, itemId: number, placeId: number, batch: string | null): Promise<Record<string, unknown> | undefined> {
  const rows = await w.rowsOf('levels', `item_id = ${String(itemId)} and place_id = ${String(placeId)}`);
  return rows.find((row) => (batch === null ? yes(row['unassigned']) : row['batch_code'] === batch));
}
