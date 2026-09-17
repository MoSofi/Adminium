// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block vocabulary (the comp's `blockOrder` 1114, `gate` 1490,
 * `optionalSecs()` 1257-1265, `customDefs()` 1266-1272): the 23 built-in
 * blocks, which 18 of them a `*Show` flag gates, the four user-authored
 * section types, and the inspector's section keys.
 *
 * THE GATE FILTERS, IT NEVER GHOSTS. The comp drops an off block from the
 * canvas before rendering (1493), so the "Add <section>" ghost buttons in its
 * markup can never appear; an off block comes back through the Add-section
 * modal, whose *Standard blocks* row lists exactly the off ones (1653). {@link
 * visibleBlocks} is that filter, keeping each block's index in the UNFILTERED
 * order because drag/drop and the between-block insert speak pre-filter
 * indexes (1491-1493, 1359, 1300-1305).
 *
 * `BLOCK_VOCABULARY` is the 27-kind list a CI gate holds equal to the add-on
 * renderer's: a kind added to one tree only must go red.
 */
import { DEFAULT_BLOCK_ORDER, type CustomSection, type CustomSectionType, type InvoiceBody } from './envelope.js';

export type BuiltinBlockKey =
  | 'parties'
  | 'shipping'
  | 'meta'
  | 'items'
  | 'totals'
  | 'paynotes'
  | 'signature'
  | 'terms'
  | 'attachments'
  | 'approval'
  | 'qr'
  | 'latefees'
  | 'poterms'
  | 'multicurrency'
  | 'recurring'
  | 'discount'
  | 'taxbreak'
  | 'payhistory'
  | 'legal'
  | 'refund'
  | 'contact'
  | 'loyalty'
  | 'delivery';

export const BUILTIN_BLOCK_KEYS = DEFAULT_BLOCK_ORDER as readonly BuiltinBlockKey[];

export function isBuiltinBlockKey(value: unknown): value is BuiltinBlockKey {
  return typeof value === 'string' && (BUILTIN_BLOCK_KEYS as readonly string[]).includes(value);
}

/** The eighteen `*Show` flags (comp 1490). */
export type OptionalFlag =
  | 'shipShow'
  | 'sigShow'
  | 'termsShow'
  | 'attachShow'
  | 'approvalShow'
  | 'qrShow'
  | 'lateShow'
  | 'poShow'
  | 'mcShow'
  | 'recurShow'
  | 'discShow'
  | 'taxbShow'
  | 'payhShow'
  | 'legalShow'
  | 'refShow'
  | 'conShow'
  | 'loyShow'
  | 'delShow';

/** Block key → the flag that gates it; `null` for the five permanent blocks. */
export const BLOCK_GATE: Readonly<Record<BuiltinBlockKey, OptionalFlag | null>> = {
  parties: null,
  shipping: 'shipShow',
  meta: null,
  items: null,
  totals: null,
  paynotes: null,
  signature: 'sigShow',
  terms: 'termsShow',
  attachments: 'attachShow',
  approval: 'approvalShow',
  qr: 'qrShow',
  latefees: 'lateShow',
  poterms: 'poShow',
  multicurrency: 'mcShow',
  recurring: 'recurShow',
  discount: 'discShow',
  taxbreak: 'taxbShow',
  payhistory: 'payhShow',
  legal: 'legalShow',
  refund: 'refShow',
  contact: 'conShow',
  loyalty: 'loyShow',
  delivery: 'delShow',
};

/**
 * The inspector's section keys (comp `sec` 1489 + `images` 1657 + `cus:` 1509).
 * `customer` is the comp's `billto` (34 Appendix D.2: the word is retired
 * from keys as well as labels).
 */
export type FixedSectionKey =
  | 'branding'
  | 'theme'
  | 'from'
  | 'customer'
  | 'meta'
  | 'items'
  | 'tax'
  | 'payment'
  | 'notes'
  | 'shipto'
  | 'signature'
  | 'terms'
  | 'attachments'
  | 'approval'
  | 'qr'
  | 'latefees'
  | 'poterms'
  | 'multicurrency'
  | 'recurring'
  | 'discount'
  | 'taxbreak'
  | 'payhistory'
  | 'legal'
  | 'refund'
  | 'contact'
  | 'loyalty'
  | 'delivery'
  | 'images';

export type SectionKey = FixedSectionKey | `cus:${string}`;

export const FIXED_SECTION_KEYS: readonly FixedSectionKey[] = [
  'branding',
  'theme',
  'from',
  'customer',
  'meta',
  'items',
  'tax',
  'payment',
  'notes',
  'shipto',
  'signature',
  'terms',
  'attachments',
  'approval',
  'qr',
  'latefees',
  'poterms',
  'multicurrency',
  'recurring',
  'discount',
  'taxbreak',
  'payhistory',
  'legal',
  'refund',
  'contact',
  'loyalty',
  'delivery',
  'images',
];

/** The inspector header's glyph per section (comp `insMeta`, 1565; `images` 1565; `cus:` → `shapes`). */
export const SECTION_ICONS: Readonly<Record<FixedSectionKey, string>> = {
  branding: 'pencil-ruler',
  theme: 'palette',
  from: 'building-2',
  customer: 'user-round',
  meta: 'calendar-days',
  items: 'list',
  tax: 'percent',
  payment: 'landmark',
  notes: 'sticky-note',
  shipto: 'truck',
  signature: 'pen-line',
  terms: 'square-check-big',
  attachments: 'paperclip',
  approval: 'badge-check',
  qr: 'qr-code',
  latefees: 'alarm-clock',
  poterms: 'scroll-text',
  multicurrency: 'coins',
  recurring: 'repeat',
  discount: 'ticket-percent',
  taxbreak: 'percent',
  payhistory: 'history',
  legal: 'scale',
  refund: 'rotate-ccw',
  contact: 'life-buoy',
  loyalty: 'award',
  delivery: 'truck',
  images: 'image',
};

export const CUSTOM_SECTION_ICON = 'shapes';

export function isCustomKey(key: string): key is `cus:${string}` {
  return key.startsWith('cus:');
}

export function customIdOf(key: string): string | null {
  return isCustomKey(key) ? key.slice(4) : null;
}

export function customKeyOf(id: string): `cus:${string}` {
  return `cus:${id}`;
}

/** One optional section as the Add-section modal and `hideSec` know it (comp `optionalSecs()`, 1257-1265). */
export interface OptionalSection {
  flag: OptionalFlag;
  /** The inspector section selected once the block is on. */
  section: FixedSectionKey;
  block: BuiltinBlockKey;
  icon: string;
}

/** In the comp's own order (1258-1263). */
export const OPTIONAL_SECTIONS: readonly OptionalSection[] = [
  { flag: 'shipShow', section: 'shipto', block: 'shipping', icon: 'truck' },
  { flag: 'sigShow', section: 'signature', block: 'signature', icon: 'pen-line' },
  { flag: 'termsShow', section: 'terms', block: 'terms', icon: 'square-check-big' },
  { flag: 'attachShow', section: 'attachments', block: 'attachments', icon: 'paperclip' },
  { flag: 'approvalShow', section: 'approval', block: 'approval', icon: 'badge-check' },
  { flag: 'qrShow', section: 'qr', block: 'qr', icon: 'qr-code' },
  { flag: 'lateShow', section: 'latefees', block: 'latefees', icon: 'alarm-clock' },
  { flag: 'poShow', section: 'poterms', block: 'poterms', icon: 'scroll-text' },
  { flag: 'mcShow', section: 'multicurrency', block: 'multicurrency', icon: 'coins' },
  { flag: 'recurShow', section: 'recurring', block: 'recurring', icon: 'repeat' },
  { flag: 'discShow', section: 'discount', block: 'discount', icon: 'ticket-percent' },
  { flag: 'taxbShow', section: 'taxbreak', block: 'taxbreak', icon: 'percent' },
  { flag: 'payhShow', section: 'payhistory', block: 'payhistory', icon: 'history' },
  { flag: 'legalShow', section: 'legal', block: 'legal', icon: 'scale' },
  { flag: 'refShow', section: 'refund', block: 'refund', icon: 'rotate-ccw' },
  { flag: 'conShow', section: 'contact', block: 'contact', icon: 'life-buoy' },
  { flag: 'loyShow', section: 'loyalty', block: 'loyalty', icon: 'award' },
  { flag: 'delShow', section: 'delivery', block: 'delivery', icon: 'truck' },
];

export function optionalSectionOf(flag: OptionalFlag): OptionalSection {
  const found = OPTIONAL_SECTIONS.find((section) => section.flag === flag);
  if (found === undefined) throw new Error(`unknown optional section ${flag}`);
  return found;
}

/** The four custom types with their tile glyphs (comp 1268-1271). */
export const CUSTOM_TYPES: readonly { type: CustomSectionType; icon: string }[] = [
  { type: 'text', icon: 'align-left' },
  { type: 'image', icon: 'image' },
  { type: 'kv', icon: 'table-2' },
  { type: 'gallery', icon: 'images' },
];

/**
 * The 27 kinds the canvas can draw — the list the vocabulary gate compares
 * with the add-on renderer's. Sorted so two trees' lists diff cleanly.
 */
export const BLOCK_VOCABULARY: readonly string[] = [...BUILTIN_BLOCK_KEYS, 'custom.text', 'custom.image', 'custom.kv', 'custom.gallery'].sort();

export interface VisibleBlock {
  key: string;
  /** The index in the UNFILTERED `blockOrder` — what drag/drop and inserts use. */
  index: number;
  /** The section for a `cus:` key; `null` for a built-in. */
  custom: CustomSection | null;
}

/** The comp's `blocks` (1491-1493): the order with the off blocks dropped, pre-filter indexes kept. */
export function visibleBlocks(body: InvoiceBody): VisibleBlock[] {
  const out: VisibleBlock[] = [];
  body.blockOrder.forEach((key, index) => {
    if (isBuiltinBlockKey(key)) {
      const flag = BLOCK_GATE[key];
      if (flag === null || body[flag]) out.push({ key, index, custom: null });
      return;
    }
    const id = customIdOf(key);
    if (id === null) return;
    const custom = body.custom.find((section) => section.id === id);
    if (custom !== undefined) out.push({ key, index, custom });
  });
  return out;
}

/** The Add-section modal's *Standard blocks* row: exactly the sections that are off (comp 1653). */
export function offSections(body: InvoiceBody): OptionalSection[] {
  return OPTIONAL_SECTIONS.filter((section) => !body[section.flag]);
}
