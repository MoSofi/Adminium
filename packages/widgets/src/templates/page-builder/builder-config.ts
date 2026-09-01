// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-builder` template — pure config + doc algebra (04-widget-registry.md
 * §10 row `page-builder`, 09-generated-app.md §7.11, M7-T06).
 *
 * JSX-free and DOM-free on purpose, mirroring `families/domain/block-lib.ts`:
 * everything the renderer needs to *decide* (which canvas widget a docType
 * mounts, which blocks a palette offers, how a palette add or a canvas reorder
 * rewrites the doc, what the live survey summary counts are) lives here as
 * golden-testable functions, so the two comp defects this template owns —
 * the Report Builder `kindMeta` icon/label swaps and the Survey Builder static
 * publish-modal counts (research/ia-mapping.md §5) — are fixed in data and in
 * pure functions, each with a regression test that cannot pass on the swapped
 * or static behavior.
 */
import { z } from 'zod';

import {
  BLOCK_IDS,
  DOC_TYPE_BLOCKS,
  isBlockId,
  type BlockId,
} from '../../families/domain/block-lib.js';
import {
  blockAttachmentsDemoData,
  blockBarChartDemoData,
  blockKpiRowDemoData,
  blockLineChartDemoData,
  blockSignatureDemoData,
  blockTwoColTableDemoData,
  documentCanvasDemoData,
} from '../../families/domain/blocks-config.js';
import { mulberry32 } from '../../families/domain/domain-lib.js';
import {
  flowBuilderDemoData,
  questionBuilderDemoData,
} from '../../families/forms/forms-config.js';
import type { DocBlockInstance, DocRecord, DocType } from '../../families/domain/block-types.js';

export type { BlockId, DocBlockInstance, DocRecord, DocType };

// ── the five docType flavors ─────────────────────────────────────────────────

/**
 * `config.docType` (09 §3.2: "doc-type flavor in `config.docType`"). The three
 * `document-canvas` surfaces plus the two builder widgets with their own
 * canvases (annex §14 row `page-builder`).
 */
export const BUILDER_DOC_TYPES = ['invoice', 'report', 'email', 'survey', 'automation'] as const;
export type BuilderDocType = (typeof BUILDER_DOC_TYPES)[number];

/** The three canvas widget ids the manifest's `canvas` slot accepts. */
export const BUILDER_CANVAS_WIDGETS = ['document-canvas', 'question-builder', 'flow-builder'] as const;
export type BuilderCanvasWidgetId = (typeof BUILDER_CANVAS_WIDGETS)[number];

/** Which canvas widget a docType flavor mounts (09 §7.11). */
export function canvasWidgetIdFor(docType: BuilderDocType): BuilderCanvasWidgetId {
  if (docType === 'survey') return 'question-builder';
  if (docType === 'automation') return 'flow-builder';
  return 'document-canvas';
}

/** The `document-canvas` doc surface behind a builder flavor (never survey/automation). */
export function canvasDocTypeOf(docType: BuilderDocType): DocType {
  return docType === 'survey' || docType === 'automation' ? 'report' : docType;
}

// ── stored config body ───────────────────────────────────────────────────────

/**
 * The `page-builder` envelope `config` body. The engine wrap persists
 * `{ templateVersion, toolbar, overlays, docType, layout }` (04 §10); unknown
 * extra fields ride through untouched (01-architecture.md §6.2 forward
 * compatibility), hence `.loose()`.
 */
export const pageBuilderConfigSchema = z
  .object({
    docType: z.enum(BUILDER_DOC_TYPES).default('invoice'),
    /** composeTemplate layout — slot instances incl. the canvas item. */
    layout: z.unknown().optional(),
    toolbar: z.array(z.string()).optional(),
    overlays: z.array(z.string()).optional(),
  })
  .loose();
export type PageBuilderConfig = z.infer<typeof pageBuilderConfigSchema>;

/** One composed slot instance the renderer reads from `config.layout.items`. */
export interface BuilderCanvasItem {
  i: string;
  widget: BuilderCanvasWidgetId;
  config: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Locate the canvas slot instance in the stored layout. Prefers the widget the
 * docType calls for, falls back to ANY of the three canvas widgets (a stored
 * doc keeps rendering after a docType edit), and synthesizes a default when
 * the layout carries none — a hand-seeded builder page still mounts a canvas
 * instead of the unknown-template card this template exists to kill.
 */
export function canvasItemOf(layout: unknown, docType: BuilderDocType): BuilderCanvasItem {
  const wanted = canvasWidgetIdFor(docType);
  const items = asRecord(layout)?.['items'];
  if (Array.isArray(items)) {
    const canvases = items.flatMap((raw): BuilderCanvasItem[] => {
      const item = asRecord(raw);
      const widget = item?.['widget'];
      if (
        item === null ||
        typeof widget !== 'string' ||
        !(BUILDER_CANVAS_WIDGETS as readonly string[]).includes(widget)
      ) {
        return [];
      }
      const i = typeof item['i'] === 'string' ? item['i'] : `canvas-${widget}`;
      return [{ i, widget: widget as BuilderCanvasWidgetId, config: asRecord(item['config']) ?? {} }];
    });
    const match = canvases.find((item) => item.widget === wanted) ?? canvases[0];
    if (match !== undefined) return match;
  }
  return { i: `canvas-${wanted}`, widget: wanted, config: {} };
}

/**
 * The write target injected into `question-builder` / `flow-builder` configs
 * that arrive UNBOUND (stories, hand-seeded pages): without a binding those
 * widgets deliberately emit nothing (forms-state.ts), and the survey/automation
 * flavors need the mutate stream to keep the live counts honest. Hosts filter
 * this connectionId out before routing mutations to a real CRUD API.
 */
export const BUILDER_DRAFT_CONNECTION_ID = '__page-builder__';
export const BUILDER_DRAFT_BINDING = {
  kind: 'table-query',
  connectionId: BUILDER_DRAFT_CONNECTION_ID,
  source: { name: '__draft__', type: 'table' },
  shape: 'form-state',
} as const;

/** Is this mutate event addressed to the builder's own draft (not a real table)? */
export function isDraftMutation(event: { connectionId?: string | undefined; table?: string | undefined }): boolean {
  return event.connectionId === BUILDER_DRAFT_CONNECTION_ID || event.table === 'document';
}

// ── block-kind meta (the Report Builder kindMeta fix) ────────────────────────

export interface BlockKindMeta {
  /** Human palette/inspector copy — ALWAYS the label, never an icon slug. */
  label: string;
  /** lucide icon slug (kebab-case) — ALWAYS the icon, never copy. */
  icon: string;
}

/**
 * Block registry id → `{ label, icon }` (M7-T06; 15-quality.md §comp-defects).
 *
 * THE BUG THIS FIXES: the Report Builder comp's `kindMeta` map returned
 * `[label, icon]` tuples for most kinds but `[icon, label]` — swapped — for
 * four entries (`refund: ['rotate-ccw', 'Refund policy']`, `contact:
 * ['life-buoy', 'Contact']`, `loyalty: ['award', 'Loyalty points']`,
 * `delivery: ['truck', 'Delivery timeline']`), so those palette rows rendered
 * an icon slug as their caption. Positional tuples are the defect, so this
 * registry uses NAMED fields — the swap is now unrepresentable — and
 * `page-builder.test.tsx` pins the `[label, icon]` orientation for every
 * entry (labels are Title-cased copy, icons are kebab slugs).
 */
export const BLOCK_KIND_META: Readonly<Record<BlockId, BlockKindMeta>> = {
  'block-totals-summary': { label: 'Totals summary', icon: 'sigma' },
  'block-line-items': { label: 'Line items', icon: 'table-2' },
  'block-kpi-row': { label: 'KPI row', icon: 'layout-grid' },
  'block-bar-chart': { label: 'Bar chart', icon: 'bar-chart-3' },
  'block-line-chart': { label: 'Line chart', icon: 'trending-up' },
  'block-two-col-table': { label: 'Two-column table', icon: 'rows-3' },
  'block-tax-breakdown': { label: 'Tax breakdown', icon: 'percent' },
  'block-multi-currency': { label: 'Multi-currency', icon: 'coins' },
  'block-payment-history': { label: 'Payment history', icon: 'history' },
  'block-discount-codes': { label: 'Discount codes', icon: 'ticket-percent' },
  'block-loyalty-banner': { label: 'Loyalty points', icon: 'award' },
  'block-recurring-banner': { label: 'Recurring', icon: 'repeat' },
  'block-qr-pay': { label: 'Payment QR', icon: 'qr-code' },
  'block-delivery-stepper': { label: 'Delivery timeline', icon: 'truck' },
  'block-signature': { label: 'Signature', icon: 'pen-line' },
  'block-terms-checkbox': { label: 'Terms', icon: 'square-check-big' },
  'block-approval': { label: 'Approval', icon: 'badge-check' },
  'block-attachments': { label: 'Attachments', icon: 'paperclip' },
  'block-late-fees': { label: 'Late fees', icon: 'alarm-clock' },
  'block-image-placeholder': { label: 'Image', icon: 'image' },
  'block-contact': { label: 'Contact', icon: 'life-buoy' },
  'block-highlight-box': { label: 'Highlight box', icon: 'square-dashed' },
  'email.heading': { label: 'Heading', icon: 'heading' },
  'email.text': { label: 'Paragraph', icon: 'text' },
  'email.button': { label: 'Call-to-action', icon: 'mouse-pointer-click' },
  'email.divider': { label: 'Divider', icon: 'minus' },
  'email.spacer': { label: 'Spacer', icon: 'move-vertical' },
  'email.footer': { label: 'Footer', icon: 'panel-bottom' },
};

/**
 * The addable blocks per document surface — the palette rail's vocabulary.
 * Wider than `DOC_TYPE_BLOCKS` (the DEFAULT composition): a report may add a
 * highlight box it does not start with. Order follows the comps' palettes.
 */
export const DOC_TYPE_PALETTE: Readonly<Record<DocType, readonly BlockId[]>> = {
  invoice: [
    'block-line-items',
    'block-tax-breakdown',
    'block-totals-summary',
    'block-payment-history',
    'block-qr-pay',
    'block-recurring-banner',
    'block-discount-codes',
    'block-loyalty-banner',
    'block-multi-currency',
    'block-late-fees',
    'block-delivery-stepper',
    'block-signature',
    'block-terms-checkbox',
    'block-approval',
    'block-attachments',
    'block-contact',
    'block-highlight-box',
    'block-image-placeholder',
    'block-two-col-table',
  ],
  report: [
    'block-kpi-row',
    'block-bar-chart',
    'block-line-chart',
    'block-two-col-table',
    'block-highlight-box',
    'block-image-placeholder',
    'block-attachments',
    'block-signature',
    'block-approval',
    'block-terms-checkbox',
    'block-contact',
  ],
  /*
    The comp's palette, in its order: the message itself first (Heading, Body
    paragraphs, Call-to-action, Footer text — the only blocks the mail renderer
    can send), then the optional "Add …" module rail below it.
  */
  email: [
    'email.heading',
    'email.text',
    'email.button',
    'email.divider',
    'email.spacer',
    'email.footer',
    'block-highlight-box',
    'block-discount-codes',
    'block-loyalty-banner',
    'block-delivery-stepper',
    'block-contact',
    'block-image-placeholder',
    'block-qr-pay',
    'block-recurring-banner',
    'block-payment-history',
    'block-tax-breakdown',
    'block-multi-currency',
  ],
};

// ── doc algebra (palette add, canvas reorder echo) ───────────────────────────

/**
 * The doc's resolved block instances: its own order, else the docType default.
 * Same precedence as `block-lib.ts` `blockOrderOf` — an EMPTY declared order is
 * an empty document, not a fall-through to the defaults.
 */
export function docBlockInstancesOf(doc: DocRecord | null, docType: DocType): DocBlockInstance[] {
  const declared = doc?.blockOrder;
  if (Array.isArray(declared)) {
    return declared.flatMap((raw, index) => {
      const record = asRecord(raw);
      const block = record === null ? raw : record['block'];
      if (!isBlockId(block)) return [];
      const id = record !== null && typeof record['id'] === 'string' ? record['id'] : `${block}-${index}`;
      const label = record !== null && typeof record['label'] === 'string' ? record['label'] : undefined;
      return [{ id, block, ...(label === undefined ? {} : { label }) }];
    });
  }
  return DOC_TYPE_BLOCKS[docType].map((block, index) => ({ id: `${block}-${index}`, block }));
}

/** A collision-free instance id for one more `block` on this order. */
function nextInstanceId(order: readonly DocBlockInstance[], block: BlockId): string {
  const taken = new Set(order.map((instance) => instance.id));
  let n = order.length;
  let candidate = `${block}-${n}`;
  while (taken.has(candidate)) candidate = `${block}-${(n += 1)}`;
  return candidate;
}

/**
 * Palette add: append one `block` instance to the doc (annex §13 — the canvas
 * renders the ordered list; the PAGE owns add/remove/reorder). Also clears a
 * `flags[block] === false` show-flag: adding a hidden block must show it, or
 * the palette click does nothing visible.
 */
export function addBlockToDoc(doc: DocRecord, block: BlockId, docType: DocType): DocRecord {
  const order = docBlockInstancesOf(doc, docType);
  const next: DocBlockInstance = { id: nextInstanceId(order, block), block };
  const flags = { ...doc.flags };
  if (flags[block] === false) delete flags[block];
  return { ...doc, blockOrder: [...order, next], flags };
}

/**
 * Echo a canvas reorder/remove back onto the doc. `document-canvas` emits the
 * NEW order as bare block ids (`values.blockOrder`); this re-derives the
 * instance list by consuming current instances per id in emitted order, so
 * labels and instance ids survive the round trip. Ids that match nothing are
 * dropped (never invented), and instances absent from the emitted order are
 * removed — that is exactly the remove case.
 */
export function reorderDocByBlockIds(
  doc: DocRecord,
  emittedOrder: readonly unknown[],
  docType: DocType,
): DocRecord {
  const pool = [...docBlockInstancesOf(doc, docType)];
  const next: DocBlockInstance[] = [];
  for (const raw of emittedOrder) {
    if (typeof raw !== 'string') continue;
    /*
      Instance id first, block id second. A doc with two instances of one kind
      (both paragraphs of any email template) cannot express "swap them" in
      block ids alone — the emitted sequence is identical either way — so the
      canvas now sends `blockInstanceOrder` too and it resolves here. Bare block
      ids keep working for every host and doc that never had a duplicate.
    */
    const byInstance = pool.findIndex((instance) => instance.id === raw);
    const at = byInstance === -1 ? (isBlockId(raw) ? pool.findIndex((i) => i.block === raw) : -1) : byInstance;
    if (at === -1) continue;
    const [taken] = pool.splice(at, 1);
    if (taken !== undefined) next.push(taken);
  }
  return { ...doc, blockOrder: next };
}

// ── survey summary (the Survey Builder static-counts fix) ────────────────────

export interface SurveySummary {
  questions: number;
  required: number;
  /** ~15 s per question, never below one minute — the comp's "Est. length". */
  estMinutes: number;
}

/**
 * LIVE publish-summary counts (M7-T06; ia-mapping §5: "Survey publish-modal
 * counts must be live"). The comp rendered a hard-coded "12" in the publish
 * modal regardless of the canvas; this derives every figure from the CURRENT
 * question list, so the modal and the inspector can only ever tell the truth.
 */
export function surveySummaryOf(values: unknown): SurveySummary {
  const record = asRecord(values);
  const inner = asRecord(record?.['values']) ?? record;
  const raw = inner?.['questions'];
  const questions = Array.isArray(raw) ? raw.filter((entry) => asRecord(entry) !== null) : [];
  const required = questions.filter((entry) => asRecord(entry)?.['required'] === true).length;
  return {
    questions: questions.length,
    required,
    estMinutes: Math.max(1, Math.round(questions.length * 0.25)),
  };
}

// ── automation flow guards ───────────────────────────────────────────────────

export interface FlowNodeLike {
  id?: string | undefined;
  kind?: string | undefined;
  [key: string]: unknown;
}

/** The nodes list out of a flow-builder mutate `values` bag (or form-state). */
export function flowNodesFromValues(values: unknown): FlowNodeLike[] {
  const record = asRecord(values);
  const inner = asRecord(record?.['values']) ?? record;
  const raw = inner?.['nodes'];
  return Array.isArray(raw) ? raw.flatMap((entry) => (asRecord(entry) === null ? [] : [entry as FlowNodeLike])) : [];
}

/**
 * The trigger node is non-removable (09 §7.11). The flow-builder widget lets
 * its LOCAL list drop any node; this guard re-seats the previously-known
 * trigger at the head whenever a committed order lost it, so what the host
 * persists — and what the run-stats header describes — always starts with a
 * trigger. A flow that never had one passes through untouched (the palette is
 * how it gets its first trigger).
 */
export function ensureTriggerFirst(
  next: readonly FlowNodeLike[],
  previous: readonly FlowNodeLike[],
): FlowNodeLike[] {
  const hasTrigger = next.some((node) => node.kind === 'trigger');
  if (hasTrigger) return [...next];
  const lostTrigger = previous.find((node) => node.kind === 'trigger');
  return lostTrigger === undefined ? [...next] : [lostTrigger, ...next];
}

// ── starters (annex: `starter-template-picker` seeds docs) ───────────────────

/**
 * The built-in starter ids, listed as a union so the renderer can index a map
 * of LITERAL bundle keys by them: a new starter is then a compile error in
 * `STARTER_TITLE_KEY` rather than a raw `templates.builder.starters.titles.…`
 * on the card (10 §2.5).
 */
export type BuilderStarterId =
  | 'st-standard'
  | 'st-recurring'
  | 'st-deposit'
  | 'st-credit-note'
  | 'st-late-reminder'
  | 'st-quote'
  | 'st-proforma'
  | 'st-receipt'
  | 'st-retainer'
  | 'st-usage'
  | 'st-milestone'
  | 'st-donation'
  | 'st-monthly'
  | 'st-quarterly'
  | 'st-usage-report'
  | 'st-exec'
  | 'st-welcome'
  | 'st-receipt-email'
  | 'st-digest'
  | 'st-dunning';

/** The English category display values the starter cards group by. */
export type BuilderStarterCategory =
  | 'Billing'
  | 'Sales'
  | 'Non-profit'
  | 'Reports'
  | 'Lifecycle'
  | 'Transactional'
  | 'Marketing';

export interface BuilderStarterDef {
  id: BuilderStarterId;
  title: string;
  category: BuilderStarterCategory;
}

/**
 * Starter `category` display value → its LITERAL bundle key under
 * `templates.builder.starters.categories.*`. The starter defs below keep their
 * English values (API compat — hosts and goldens read them verbatim); the
 * RENDERER resolves the localized card copy at the render boundary by indexing
 * this map, mirroring `useDefaultShortcutGroups` (ShortcutsPanel.tsx). Keeping
 * whole keys here (rather than leaves the renderer concatenates) is what makes
 * them visible to the extractor and to the bundle-parity tests (10 §2.5); the
 * `satisfies` clause makes a new category a compile error.
 */
export const STARTER_CATEGORY_KEYS = {
  Billing: 'ui:templates.builder.starters.categories.billing',
  Sales: 'ui:templates.builder.starters.categories.sales',
  'Non-profit': 'ui:templates.builder.starters.categories.nonProfit',
  Reports: 'ui:templates.builder.starters.categories.reports',
  Lifecycle: 'ui:templates.builder.starters.categories.lifecycle',
  Transactional: 'ui:templates.builder.starters.categories.transactional',
  Marketing: 'ui:templates.builder.starters.categories.marketing',
} as const satisfies Record<BuilderStarterCategory, string>;

/**
 * The 12 domain-true invoice starters (09 §7.11 — "12 domain-true invoice
 * starters", incl. the ia-mapping call-outs: pro forma, credit note, donation
 * receipt with Tax ID), plus report/email starter sets for those flavors.
 */
export const BUILDER_STARTERS: Readonly<Record<DocType, readonly BuilderStarterDef[]>> = {
  invoice: [
    { id: 'st-standard', title: 'Standard invoice', category: 'Billing' },
    { id: 'st-recurring', title: 'Recurring subscription', category: 'Billing' },
    { id: 'st-deposit', title: 'Deposit request', category: 'Billing' },
    { id: 'st-credit-note', title: 'Credit note', category: 'Billing' },
    { id: 'st-late-reminder', title: 'Late-payment reminder', category: 'Billing' },
    { id: 'st-quote', title: 'Quote / estimate', category: 'Sales' },
    { id: 'st-proforma', title: 'Pro forma', category: 'Sales' },
    { id: 'st-receipt', title: 'Payment receipt', category: 'Sales' },
    { id: 'st-retainer', title: 'Retainer', category: 'Sales' },
    { id: 'st-usage', title: 'Usage-based invoice', category: 'Billing' },
    { id: 'st-milestone', title: 'Project milestone', category: 'Sales' },
    { id: 'st-donation', title: 'Donation receipt (Tax ID)', category: 'Non-profit' },
  ],
  report: [
    { id: 'st-monthly', title: 'Monthly summary', category: 'Reports' },
    { id: 'st-quarterly', title: 'Quarterly review', category: 'Reports' },
    { id: 'st-usage-report', title: 'Usage breakdown', category: 'Reports' },
    { id: 'st-exec', title: 'Executive one-pager', category: 'Reports' },
  ],
  email: [
    { id: 'st-welcome', title: 'Welcome email', category: 'Lifecycle' },
    { id: 'st-receipt-email', title: 'Invoice receipt', category: 'Transactional' },
    { id: 'st-digest', title: 'Weekly digest', category: 'Marketing' },
    { id: 'st-dunning', title: 'Payment reminder', category: 'Transactional' },
  ],
};

function hashId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash || 1;
}

/**
 * Seed a full doc from a starter (the picker's "selection seeds a full doc").
 * `null` — the blank ghost card — seeds the base doc for the surface with no
 * line items. Deterministic in the starter id, per 04 §7.7. `untitledTitle`
 * lets the RENDERER pass the localized blank-doc title
 * (`templates.builder.untitledDoc`) without this pure module touching i18n;
 * the default keeps today's English for every existing caller.
 */
export function starterDocOf(
  starterId: string | null,
  docType: DocType,
  untitledTitle: string = 'Untitled document',
): DocRecord {
  const base = builderDemoDoc(docType, starterId === null ? 7 : hashId(starterId));
  if (starterId === null) {
    return { ...base, title: untitledTitle, number: undefined, items: [] };
  }
  const def = BUILDER_STARTERS[docType].find((starter) => starter.id === starterId);
  const title = def?.title ?? base.title;
  if (starterId === 'st-donation') {
    // The domain-true seed the ia-mapping calls out: a donation receipt carries
    // the org's Tax ID where a commercial invoice carries payment plumbing.
    return {
      ...base,
      title,
      rates: { ...base.rates, taxRate: 0 },
      blockOrder: [
        { id: 'block-line-items-0', block: 'block-line-items' },
        { id: 'block-totals-summary-1', block: 'block-totals-summary' },
        { id: 'block-highlight-box-2', block: 'block-highlight-box', label: 'Tax ID' },
        { id: 'block-signature-3', block: 'block-signature' },
      ],
      blocks: {
        ...base.blocks,
        'block-highlight-box': { row: { label: 'Tax ID', value: 'EIN 84-2231907' } },
      },
    };
  }
  if (starterId === 'st-credit-note' || starterId === 'st-proforma') {
    const kicker = starterId === 'st-credit-note' ? 'CN' : 'PF';
    return { ...base, title, number: `${kicker}-${2600 + (hashId(starterId) % 400)}` };
  }
  return { ...base, title };
}

// ── deterministic demo payloads per flavor (04 §7.7) ─────────────────────────

function isoDayAfterDemoEpoch(days: number): string {
  // 2026-06-01T00:00:00Z — the shared block-vocabulary demo anchor.
  return new Date(Date.UTC(2026, 5, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Deterministic doc for the three `document-canvas` surfaces. */
export function builderDemoDoc(docType: DocType, seed: number): DocRecord {
  if (docType === 'invoice') {
    return documentCanvasDemoData(seed).row ?? { docType: 'invoice', title: 'Invoice' };
  }
  const random = mulberry32(seed || 1);
  if (docType === 'report') {
    const blocks = DOC_TYPE_BLOCKS.report;
    return {
      docType: 'report',
      title: 'Quarterly revenue report',
      number: `RPT-${2026}-Q${1 + Math.floor(random() * 4)}`,
      issuedAt: isoDayAfterDemoEpoch(0),
      fromLines: ['Northwind Studio', 'Finance team'],
      blockOrder: blocks.map((block, index) => ({ id: `${block}-${index}`, block })),
      flags: Object.fromEntries(blocks.map((block) => [block, true])),
      blocks: {
        'block-kpi-row': blockKpiRowDemoData(seed),
        'block-bar-chart': blockBarChartDemoData(seed),
        'block-line-chart': blockLineChartDemoData(seed + 1),
        'block-two-col-table': blockTwoColTableDemoData(seed),
        'block-attachments': blockAttachmentsDemoData(seed),
        'block-signature': blockSignatureDemoData(seed),
      },
    };
  }
  /*
    A transactional message, keyed BY INSTANCE — two paragraphs of different
    text is the ordinary case (every seeded built-in has one), and a
    block-keyed payload can only hold one of them. `blockDataForInstance`
    reads the instance id first for exactly this reason.
  */
  const order: readonly { id: string; block: BlockId }[] = [
    { id: 'heading', block: 'email.heading' },
    { id: 'intro', block: 'email.text' },
    { id: 'action', block: 'email.button' },
    { id: 'notice', block: 'email.text' },
    { id: 'rule', block: 'email.divider' },
    { id: 'footer', block: 'email.footer' },
  ];
  const expiresInDays = 1 + Math.floor(random() * 6);
  return {
    docType: 'email',
    title: 'Welcome to Adminium',
    issuedAt: isoDayAfterDemoEpoch(0),
    fromLines: ['Adminium', 'no-reply@adminium.io'],
    toLines: ['{{first_name}} <{{email}}>'],
    blockOrder: order.map((entry) => ({ ...entry })),
    flags: Object.fromEntries(order.map((entry) => [entry.block, true])),
    blocks: {
      heading: { text: 'Welcome to {{appName}}', level: 1 },
      intro: { text: 'Hi {{first_name}}, your workspace is ready. Everything you connected is waiting for you.' },
      action: { label: 'Open your dashboard', url: '{{actionUrl}}' },
      notice: { text: `This link expires in ${String(expiresInDays)} days.` },
      footer: { text: 'You are receiving this because you created an {{appName}} workspace.' },
    },
  };
}

/** Deterministic canvas payload per flavor — the shape its canvas widget binds. */
export function builderDemoData(docType: BuilderDocType, seed: number): unknown {
  if (docType === 'survey') return questionBuilderDemoData(seed);
  if (docType === 'automation') return flowBuilderDemoData(seed);
  return { row: builderDemoDoc(docType, seed) };
}

export { BLOCK_IDS, DOC_TYPE_BLOCKS };
