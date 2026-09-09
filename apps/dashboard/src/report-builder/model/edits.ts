// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editing surface every canvas block and inspector field group speaks to
 * (43-report-builder.md §3.5, Appendix A/B). One interface, implemented once
 * by the editor's `useDocumentEdits`, so the 25 field groups and the 25
 * canvas blocks never touch the draft hook directly.
 *
 * TWO TEMPOS, THE COMP'S (523-525): `beginEdit` records a history step and is
 * called on FOCUS, so a run of keystrokes in one field is one undo; the plain
 * setters change the draft without a step (a keystroke); the `hist…` setters
 * record a step AND change (a discrete choice — a swatch, a toggle, a
 * structural edit).
 */
import type { RowListField } from './blocks.js';
import type { BlockOf, ReportBlockKind, ReportBody, ReportStatus, TableRow } from './envelope.js';
import type { Selection } from './ops.js';

export interface DocumentEdits {
  /** A history step — call on focus, before a run of keystrokes. */
  beginEdit: () => void;

  // ── the document header (comp `mutate`, 525) ───────────────────────
  /** A keystroke: no history step. */
  setHeader: <K extends 'accent' | 'kicker' | 'reportTitle' | 'subtitle' | 'bgImage' | 'bgTint'>(key: K, value: ReportBody[K]) => void;
  /** A discrete choice — a swatch, a status, an upload: history step + the change. */
  histSetHeader: <K extends 'accent' | 'kicker' | 'reportTitle' | 'subtitle' | 'bgImage' | 'bgTint'>(key: K, value: ReportBody[K]) => void;
  setName: (name: string) => void;
  histSetStatus: (status: ReportStatus) => void;

  // ── one block's own fields ─────────────────────────────────────────
  /** A keystroke into a block field. */
  patchBlock: <K extends ReportBlockKind>(id: string, patch: Partial<BlockOf<K>>) => void;
  /** A discrete choice inside a block — a status option, a checkbox, the width. */
  histPatchBlock: <K extends ReportBlockKind>(id: string, patch: Partial<BlockOf<K>>) => void;

  // ── the stack ──────────────────────────────────────────────────────
  /** A palette click: append and select (comp 535). */
  addBlock: (kind: ReportBlockKind) => void;
  /** The chevrons: SWAP with the neighbour (comp 537). */
  swapBlock: (id: string, dir: -1 | 1) => void;
  /** The drag: splice to `to`, the comp's `dest` arithmetic (comp 539). */
  reorderBlock: (from: number, to: number) => void;
  deleteBlock: (id: string) => void;

  // ── the eight repeaters (comp 540-542) ─────────────────────────────
  updateArrayItem: (id: string, field: RowListField, index: number, patch: Record<string, unknown>) => void;
  addArrayItem: (id: string, field: RowListField, row: Record<string, unknown>) => void;
  removeArrayItem: (id: string, field: RowListField, index: number) => void;

  // ── the table's rows (comp 543-545) ────────────────────────────────
  updateRow: (id: string, rowIndex: number, cell: 0 | 1, value: string) => void;
  addRow: (id: string, row: TableRow) => void;
  removeRow: (id: string, rowIndex: number) => void;

  // ── selection ──────────────────────────────────────────────────────
  select: (selection: Selection) => void;
}
