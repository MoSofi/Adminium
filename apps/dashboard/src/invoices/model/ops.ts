// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Structural edits over the envelope. Every function is pure and returns a
 * new body; the editor's `useDocumentEdits` decides which of them record a
 * history step.
 *
 * THREE COMP BEHAVIOURS, BY LINE:
 *
 *   - `reorderBlocks` (comp `reorderBlk`, 1359) splices on the UNFILTERED
 *     `blockOrder` index captured before the gate filter, so a hidden block
 *     keeps its place while invisible. `dest = from < to ? to − 1 : to`.
 *   - `addBuiltin` (comp 1296-1310) re-splices a key to the insertion index
 *     ONLY when the modal was opened from a between-block chip (`at != null`),
 *     with the `at > cur ? at − 1 : at` correction; the footer's *Add section*
 *     and the Images panel's *Add an image section* pass `null` and append.
 *   - `hideSection` (comp `hideSec`, 1361) only flips a built-in's flag —
 *     built-in keys are never removed from the order — whereas `removeCustom`
 *     (comp `delCustom`, 1317-1323) removes the section AND filters its key
 *     out of the order.
 */
import {
  DEFAULT_BLOCK_ORDER,
  newLocalId,
  type CustomSection,
  type CustomSectionType,
  type ImageField,
  type InvoiceBody,
  type LineItem,
  type LineListField,
  type RowListField,
} from './envelope.js';
import { customKeyOf, type BuiltinBlockKey, type OptionalFlag } from './blocks.js';

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...list];
  const dest = Math.max(0, Math.min(from < to ? to - 1 : to, next.length));
  next.splice(dest, 0, moved);
  return next;
}

/** The comp's `reorderBlk` (1359): `from`/`to` are pre-filter indexes. */
export function reorderBlocks(body: InvoiceBody, from: number, to: number): InvoiceBody {
  return { ...body, blockOrder: move(body.blockOrder, from, to) };
}

/** The comp's `reorderItem` (1358): the same algorithm over the line items. */
export function reorderItems(body: InvoiceBody, from: number, to: number): InvoiceBody {
  return { ...body, items: move(body.items, from, to) };
}

/** `enableSec` (1360): the flag on; the key stays where the order has it. */
export function enableSection(body: InvoiceBody, flag: OptionalFlag): InvoiceBody {
  return { ...body, [flag]: true };
}

/** `hideSec` (1361): the flag off; the key is never removed. */
export function hideSection(body: InvoiceBody, flag: OptionalFlag): InvoiceBody {
  return { ...body, [flag]: false };
}

/**
 * `addBuiltin` (1296-1310): switch the block on and, when the modal was
 * opened from a between-block chip, move its key to that index.
 */
export function addBuiltin(body: InvoiceBody, block: BuiltinBlockKey, flag: OptionalFlag, at: number | null): InvoiceBody {
  let order = [...body.blockOrder];
  if (at !== null) {
    const cur = order.indexOf(block);
    if (cur >= 0) order.splice(cur, 1);
    const ins = cur >= 0 && at > cur ? at - 1 : at;
    order.splice(Math.max(0, Math.min(order.length, ins)), 0, block);
  } else if (!order.includes(block)) {
    order = [...order, block];
  }
  return { ...body, [flag]: true, blockOrder: order };
}

/** The comp's `newCustom` (1274-1281), with the seeded copy passed in so the caller can localize it. */
export interface CustomSeed {
  text: { title: string; body: string };
  image: { title: string; caption: string };
  kv: { title: string; rows: { k: string; v: string }[] };
  gallery: { title: string };
}

export function newCustomSection(type: CustomSectionType, seed: CustomSeed, id = newLocalId('cs')): CustomSection {
  switch (type) {
    case 'text':
      return { id, type, title: seed.text.title, body: seed.text.body };
    case 'image':
      return { id, type, title: seed.image.title, url: '', caption: seed.image.caption, height: 200 };
    case 'kv':
      return { id, type, title: seed.kv.title, rows: seed.kv.rows.map((row) => ({ ...row })) };
    case 'gallery':
      return { id, type, title: seed.gallery.title, images: [`${id}a`, `${id}b`, `${id}c`].map((imageId) => ({ id: imageId, url: '' })) };
  }
}

/** `addCustom` (1284-1295): the section appended, its key at `at` or at the end. */
export function addCustom(body: InvoiceBody, section: CustomSection, at: number | null): InvoiceBody {
  const order = [...body.blockOrder];
  const key = customKeyOf(section.id);
  if (at === null || at < 0 || at > order.length) order.push(key);
  else order.splice(at, 0, key);
  return { ...body, custom: [...body.custom, section], blockOrder: order };
}

/** `delCustom` (1317-1323): the section AND its key go. */
export function removeCustom(body: InvoiceBody, id: string): InvoiceBody {
  const key = customKeyOf(id);
  return { ...body, custom: body.custom.filter((section) => section.id !== id), blockOrder: body.blockOrder.filter((k) => k !== key) };
}

export function updateCustom(body: InvoiceBody, id: string, patch: Partial<CustomSection>): InvoiceBody {
  return {
    ...body,
    custom: body.custom.map((section) => (section.id === id ? ({ ...section, ...patch } as CustomSection) : section)),
  };
}

/** `updCustomImg` (1313): one gallery slot's url. */
export function updateCustomImage(body: InvoiceBody, id: string, imageId: string, url: string): InvoiceBody {
  return {
    ...body,
    custom: body.custom.map((section) =>
      section.id === id && section.type === 'gallery'
        ? { ...section, images: section.images.map((image) => (image.id === imageId ? { ...image, url } : image)) }
        : section,
    ),
  };
}

export function updateCustomRow(body: InvoiceBody, id: string, index: number, key: 'k' | 'v', value: string): InvoiceBody {
  return {
    ...body,
    custom: body.custom.map((section) =>
      section.id === id && section.type === 'kv'
        ? { ...section, rows: section.rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }
        : section,
    ),
  };
}

/** `addCustomRow` (1315) seeds `{ k: 'Label', v: 'Value' }` — passed in so it can be localized. */
export function addCustomRow(body: InvoiceBody, id: string, row: { k: string; v: string }): InvoiceBody {
  return {
    ...body,
    custom: body.custom.map((section) => (section.id === id && section.type === 'kv' ? { ...section, rows: [...section.rows, row] } : section)),
  };
}

export function removeCustomRow(body: InvoiceBody, id: string, index: number): InvoiceBody {
  return {
    ...body,
    custom: body.custom.map((section) =>
      section.id === id && section.type === 'kv' ? { ...section, rows: section.rows.filter((_, i) => i !== index) } : section,
    ),
  };
}

// ── line items (comp 1355-1357) ────────────────────────────────────────────

export function updateItem(body: InvoiceBody, id: string, patch: Partial<Omit<LineItem, 'id'>>): InvoiceBody {
  return { ...body, items: body.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

/** `addItem` (1356) seeds `{ desc: 'New item', qty: 1, rate: 0 }` — the description is passed in for i18n. */
export function addItem(body: InvoiceBody, desc: string, id = newLocalId('i')): InvoiceBody {
  return { ...body, items: [...body.items, { id, desc, qty: '1', rate: '0' }] };
}

export function removeItem(body: InvoiceBody, id: string): InvoiceBody {
  return { ...body, items: body.items.filter((item) => item.id !== id) };
}

// ── string lists (comp `updList`/`addList`/`delList`, 1363-1366) ───────────

export function updateLine(body: InvoiceBody, field: LineListField, index: number, value: string): InvoiceBody {
  const list = [...body[field]];
  list[index] = value;
  return { ...body, [field]: list };
}

export function addLine(body: InvoiceBody, field: LineListField): InvoiceBody {
  return { ...body, [field]: [...body[field], ''] };
}

export function removeLine(body: InvoiceBody, field: LineListField, index: number): InvoiceBody {
  return { ...body, [field]: body[field].filter((_, i) => i !== index) };
}

// ── object lists (comp `updObjList`, 1364; the eight repeaters) ────────────

type RowOf<F extends RowListField> = InvoiceBody[F][number];

export function updateRow<F extends RowListField>(body: InvoiceBody, field: F, index: number, patch: Partial<RowOf<F>>): InvoiceBody {
  const list = (body[field] as readonly RowOf<F>[]).map((row, i) => (i === index ? { ...row, ...patch } : row));
  return { ...body, [field]: list };
}

export function addRow<F extends RowListField>(body: InvoiceBody, field: F, row: RowOf<F>): InvoiceBody {
  return { ...body, [field]: [...(body[field] as readonly RowOf<F>[]), row] };
}

export function removeRow(body: InvoiceBody, field: RowListField, index: number): InvoiceBody {
  return { ...body, [field]: (body[field] as readonly unknown[]).filter((_, i) => i !== index) };
}

// ── images (comp `setImgField`, 1329; `readBg`, 1362) ──────────────────────

export function setImage(body: InvoiceBody, field: ImageField, dataUrl: string): InvoiceBody {
  return { ...body, [field]: dataUrl };
}

/** Everything a fresh document's order should be — exported for tests that build bodies by hand. */
export const BLOCK_ORDER = DEFAULT_BLOCK_ORDER;
