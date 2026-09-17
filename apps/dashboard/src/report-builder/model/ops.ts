// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pure edits over a report body (the comp's `patchBlock` 534, `addBlock`
 * 535, `moveBlock` 537, `delBlock` 538, `reorderBlock` 539,
 * `updArr`/`addArr`/`delArr` 540-542, `updRow`/`addRow`/ `delRow` 543-545).
 * Every function takes a body and returns a new one; nothing here touches
 * React, history or the network.
 *
 * ─── EVERY INDEX IS THE BLOCK'S INDEX IN `blocks[]` (trap 2) ───────────────
 *
 * `invoices/model/ops.ts` carries three ordering rules because its canvas
 * FILTERS an off block out before rendering, so a drop index is a
 * post-filter index that has to be mapped back. Here `show: false` only
 * DIMS a block (comp `cardStyle` 616: `opacity: show === false ? 0.5 : 1`) —
 * the stack is never filtered, so there is no index to translate and none of
 * that arithmetic exists. A builder copying it from the invoice tree ships
 * the wrong document.
 *
 * ─── TWO REORDER ALGORITHMS, BOTH THE COMP'S ──────────────────────────────
 *
 * {@link swapBlock} is the chevrons (537): it EXCHANGES a block with its
 * neighbour. {@link reorderBlock} is the drag (539): it splices the block out
 * and back in at `dest = from < to ? to − 1 : to`, and a drop on itself is a
 * no-op. They differ for any move of more than one place, and both ship.
 */
import {
  newLocalId,
  type BlockOf,
  type ReportBlock,
  type ReportBlockKind,
  type ReportBody,
  type TableRow,
} from './envelope.js';
import type { RowListField, RowListRow } from './blocks.js';

/** Where the inspector is pointed: the document header, or one block's id (comp `selBlock`, 443). */
export type Selection = 'header' | (string & {});

function withBlocks(body: ReportBody, blocks: ReportBlock[]): ReportBody {
  return { ...body, blocks };
}

export function blockAt(body: ReportBody, id: string): ReportBlock | null {
  return body.blocks.find((block) => block.id === id) ?? null;
}

export function indexOfBlock(body: ReportBody, id: string): number {
  return body.blocks.findIndex((block) => block.id === id);
}

/** The comp's `patchBlock` (534): merge a partial into one block, kind preserved. */
export function patchBlock<K extends ReportBlockKind>(body: ReportBody, id: string, patch: Partial<BlockOf<K>>): ReportBody {
  return withBlocks(
    body,
    body.blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as ReportBlock) : block)),
  );
}

/** The comp's `addBlock` (535): append and select. Never inserts between — this comp has no insert chip (C8). */
export function addBlock(body: ReportBody, block: ReportBlock): { body: ReportBody; selection: Selection } {
  return { body: withBlocks(body, [...body.blocks, block]), selection: block.id };
}

/**
 * The comp's `moveBlock` (537): SWAP with the neighbour `dir` places away.
 * Out of range is a no-op, exactly as the comp returns early.
 */
export function swapBlock(body: ReportBody, id: string, dir: -1 | 1): ReportBody {
  const i = indexOfBlock(body, id);
  if (i === -1) return body;
  const j = i + dir;
  if (j < 0 || j >= body.blocks.length) return body;
  const blocks = body.blocks.slice();
  const t = blocks[i] as ReportBlock;
  blocks[i] = blocks[j] as ReportBlock;
  blocks[j] = t;
  return withBlocks(body, blocks);
}

/**
 * The comp's `reorderBlock` (539): splice out of `from`, back in at
 * `dest = from < to ? to − 1 : to`. `from === to` — a drop on itself — is a
 * no-op, as is an index outside the stack.
 */
export function reorderBlock(body: ReportBody, from: number, to: number): ReportBody {
  if (from === to || from < 0 || from >= body.blocks.length || to < 0 || to > body.blocks.length) return body;
  const blocks = body.blocks.slice();
  const [moved] = blocks.splice(from, 1);
  if (moved === undefined) return body;
  const dest = from < to ? to - 1 : to;
  blocks.splice(dest, 0, moved);
  return withBlocks(body, blocks);
}

/** The comp's `delBlock` (538): drop the block; a selection pointing at it falls back to the header. */
export function deleteBlock(body: ReportBody, id: string, selection: Selection): { body: ReportBody; selection: Selection } {
  return {
    body: withBlocks(
      body,
      body.blocks.filter((block) => block.id !== id),
    ),
    selection: selection === id ? 'header' : selection,
  };
}

// ── the eight repeaters (540-542) ──────────────────────────────────────────

type RowOf<F extends RowListField> = RowListRow[F];

function rowsOf<F extends RowListField>(block: ReportBlock, field: F): RowOf<F>[] {
  return ((block as unknown as Record<string, unknown>)[field] as RowOf<F>[] | undefined) ?? [];
}

/** The comp's `updArr`/`updObjArr` (540): merge a patch into row `index` of one repeater. */
export function updateArrayItem<F extends RowListField>(body: ReportBody, id: string, field: F, index: number, patch: Partial<RowOf<F>>): ReportBody {
  const block = blockAt(body, id);
  if (block === null) return body;
  const next = rowsOf(block, field).map((row, i) => (i === index ? { ...row, ...patch } : row));
  return patchBlock(body, id, { [field]: next } as never);
}

/** The comp's `addArr` (541). */
export function addArrayItem<F extends RowListField>(body: ReportBody, id: string, field: F, row: RowOf<F>): ReportBody {
  const block = blockAt(body, id);
  if (block === null) return body;
  return patchBlock(body, id, { [field]: [...rowsOf(block, field), row] } as never);
}

/** The comp's `delArr` (542). */
export function removeArrayItem<F extends RowListField>(body: ReportBody, id: string, field: F, index: number): ReportBody {
  const block = blockAt(body, id);
  if (block === null) return body;
  return patchBlock(body, id, { [field]: rowsOf(block, field).filter((_, i) => i !== index) } as never);
}

// ── the table's rows (543-545) ─────────────────────────────────────────────

function tableRows(body: ReportBody, id: string): TableRow[] | null {
  const block = blockAt(body, id);
  return block !== null && block.kind === 'table' ? block.rows : null;
}

/** The comp's `updRow` (543): one cell of one row; column 0 or 1 (the canvas draws two, 625). */
export function updateRow(body: ReportBody, id: string, rowIndex: number, cell: 0 | 1, value: string): ReportBody {
  const rows = tableRows(body, id);
  if (rows === null) return body;
  const next = rows.map((row, i): TableRow => (i === rowIndex ? (cell === 0 ? [value, row[1]] : [row[0], value]) : row));
  return patchBlock(body, id, { rows: next } as never);
}

/** The comp's `addRow` (544): the literal `['New', '—']` — a seed, so the label is passed in. */
export function addRow(body: ReportBody, id: string, row: TableRow): ReportBody {
  const rows = tableRows(body, id);
  if (rows === null) return body;
  return patchBlock(body, id, { rows: [...rows, row] } as never);
}

/** The comp's `delRow` (545) — the header row is deletable too, as in the comp. */
export function removeRow(body: ReportBody, id: string, rowIndex: number): ReportBody {
  const rows = tableRows(body, id);
  if (rows === null) return body;
  return patchBlock(body, id, { rows: rows.filter((_, i) => i !== rowIndex) } as never);
}

// ── the header (`mutate`, 525) ─────────────────────────────────────────────

/** One of the header's own fields — kicker, title, subtitle, accent, background, tint. */
export function setHeaderField<K extends 'accent' | 'kicker' | 'reportTitle' | 'subtitle' | 'bgImage' | 'bgTint'>(
  body: ReportBody,
  key: K,
  value: ReportBody[K],
): ReportBody {
  return { ...body, [key]: value };
}

/** A fresh id for a block being copied out of a starter or a duplicate. */
export { newLocalId };
