// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editing surface every panel and canvas block speaks to (34-invoices-
 * add-on.md Appendix E/F). One interface, implemented once by the editor's
 * `useDocumentEdits`, so the twenty-nine inspector panels and the
 * twenty-seven canvas blocks never touch the draft hook directly.
 *
 * TWO TEMPOS, THE COMP'S (1343-1345): `beginEdit` records a history step and
 * is called on FOCUS, so a run of keystrokes in one field is one undo; the
 * plain setters change the draft without a step (a keystroke); the `hist…`
 * setters record a step AND change (a discrete choice — a swatch, a toggle, a
 * structural edit).
 */
import type { CustomSection, CustomSectionType, ImageField, InvoiceBody, InvoiceStatus, InvoiceTopic, LineItem, LineListField, RowListField } from './envelope.js';
import type { InvoiceLang } from './languages.js';
import type { BuiltinBlockKey, OptionalFlag } from './blocks.js';

export interface DocumentEdits {
  /** A history step — call on focus, before a run of keystrokes. */
  beginEdit: () => void;

  // ── scalar fields ──────────────────────────────────────────────────
  /** A keystroke: no history step. */
  set: <K extends keyof InvoiceBody>(key: K, value: InvoiceBody[K]) => void;
  /** A discrete choice: history step + the change. */
  histSet: <K extends keyof InvoiceBody>(key: K, value: InvoiceBody[K]) => void;
  setName: (name: string) => void;
  histSetStatus: (status: InvoiceStatus) => void;
  histSetTopic: (topic: InvoiceTopic) => void;
  histSetLang: (lang: InvoiceLang) => void;

  // ── string lists: from · customer · ship · payment ─────────────────
  updateLine: (field: LineListField, index: number, value: string) => void;
  addLine: (field: LineListField) => void;
  removeLine: (field: LineListField, index: number) => void;

  // ── object lists: attachments · fx · discCodes · taxLines · payHist · delSteps ──
  updateRow: <F extends RowListField>(field: F, index: number, patch: Partial<InvoiceBody[F][number]>) => void;
  addRow: <F extends RowListField>(field: F, row: InvoiceBody[F][number]) => void;
  removeRow: (field: RowListField, index: number) => void;

  // ── line items ─────────────────────────────────────────────────────
  updateItem: (id: string, patch: Partial<Omit<LineItem, 'id'>>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  reorderItems: (from: number, to: number) => void;

  // ── sections ───────────────────────────────────────────────────────
  enableSection: (flag: OptionalFlag) => void;
  hideSection: (flag: OptionalFlag) => void;
  /** From the Add-section modal; `at` is the pre-filter insert index or `null` to append. */
  addBuiltin: (block: BuiltinBlockKey, flag: OptionalFlag, at: number | null) => void;
  addCustom: (type: CustomSectionType, at: number | null) => CustomSection;
  removeCustom: (id: string) => void;
  reorderBlocks: (from: number, to: number) => void;
  updateCustom: (id: string, patch: Partial<CustomSection>) => void;
  histUpdateCustom: (id: string, patch: Partial<CustomSection>) => void;
  updateCustomImage: (id: string, imageId: string, url: string) => void;
  updateCustomRow: (id: string, index: number, key: 'k' | 'v', value: string) => void;
  addCustomRow: (id: string) => void;
  removeCustomRow: (id: string, index: number) => void;

  // ── images (always a history step) ─────────────────────────────────
  setImage: (field: ImageField, dataUrl: string) => void;
}

/**
 * The implementation a PREVIEW is handed.
 *
 * Nothing calls it: the read-only sheet renders every field as text and every
 * affordance as nothing, so no handler exists to reach these. It is here
 * because the blocks build their `onChange` closures unconditionally, and
 * making thirty of them optional would put a `?.` on a hundred call sites to
 * describe a state none of them can be in. A single inert object says the
 * same thing once.
 *
 * `addCustom` throws rather than returning a hollow section: reaching it
 * would mean the read-only sheet grew an affordance, which is a defect, and
 * a made-up return value would hide it.
 */
const inert = (): void => undefined;

export const NO_EDITS: DocumentEdits = {
  beginEdit: inert,
  set: inert,
  histSet: inert,
  setName: inert,
  histSetStatus: inert,
  histSetTopic: inert,
  histSetLang: inert,
  updateLine: inert,
  addLine: inert,
  removeLine: inert,
  updateRow: inert,
  addRow: inert,
  removeRow: inert,
  updateItem: inert,
  addItem: inert,
  removeItem: inert,
  reorderItems: inert,
  enableSection: inert,
  hideSection: inert,
  addBuiltin: inert,
  addCustom: () => {
    throw new Error('the read-only sheet cannot add a section');
  },
  removeCustom: inert,
  reorderBlocks: inert,
  updateCustom: inert,
  histUpdateCustom: inert,
  updateCustomImage: inert,
  updateCustomRow: inert,
  addCustomRow: inert,
  removeCustomRow: inert,
  setImage: inert,
};
