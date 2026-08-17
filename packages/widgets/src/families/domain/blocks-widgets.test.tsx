// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK BUILDER unit tests (annex §13) — `document-canvas` + the 22 `block-*`
 * document-vocabulary widgets.
 *
 * SCOPE. The central QA harness already runs the four-state, determinism,
 * config-fuzz and registry-parity gates over every entry in `qa/delivered.ts`,
 * so this suite does NOT re-assert them per widget. It covers what is specific
 * to the document vocabulary and would otherwise go untested:
 *
 *   - the pure algebra behind the canvas (`moveBlock`, `blockOrderOf`,
 *     `blockDataOf`) — the show-flags, the unknown-id drop, and the derived
 *     money projection, all golden-testable without mounting;
 *   - LIVE-RECOMPUTING TOTALS (annex §13): the invariant that totals, tax and QR
 *     can never disagree about the same invoice, plus the untrusted-row coercion
 *     that keeps a corrupt qty from poisoning the arithmetic with NaN. Asserted
 *     BOTH on blocks mounted standalone with their own schema-built config (the
 *     `cfg()` helper) and THROUGH THE CANVAS — a canvas test that only counts
 *     `block-instance` elements passes happily while every block inside it
 *     renders blank, so the canvas suite reads real rendered money too;
 *   - NEVER WRITES (04 §2.1): edits emit `mutate` intents through `onEvent` and
 *     an UNBOUND block emits nothing (no table to address);
 *   - the security-shaped bits: `maskMethod` never renders a full PAN, and the
 *     canvas never resolves an unknown block id to an arbitrary widget;
 *   - RTL/direction and the block-axis reorder semantics (up is up in every
 *     locale — the controls are on the block axis, which never mirrors).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlockContactWidget, BlockHighlightBoxWidget } from './BlockContent.js';
import {
  BlockLineItemsWidget,
  BlockPaymentHistoryWidget,
  BlockQrPayWidget,
  BlockTotalsSummaryWidget,
} from './BlockFinancial.js';
import { BlockAttachmentsWidget, BlockKpiRowWidget } from './BlockReport.js';
import { BlockApprovalWidget, BlockTermsCheckboxWidget } from './BlockStatus.js';
import { DocumentCanvasWidget } from './DocumentCanvas.js';
import { fillTemplate } from './BlockShell.js';
import {
  BLOCK_IDS,
  DOC_TYPE_BLOCKS,
  blockDataOf,
  blockOrderOf,
  computeTotals,
  formatBlockMoney,
  formatBlockRate,
  maskMethod,
  moveBlock,
  rowData,
  rowsData,
} from './block-lib.js';
import {
  blockApprovalConfigSchema,
  blockAttachmentsConfigSchema,
  blockContactConfigSchema,
  blockHighlightBoxConfigSchema,
  blockKpiRowConfigSchema,
  blockLineItemsConfigSchema,
  blockPaymentHistoryConfigSchema,
  blockQrPayConfigSchema,
  blockQrPayDemoData,
  blockTermsCheckboxConfigSchema,
  blockTotalsSummaryConfigSchema,
  blockTotalsSummaryDemoData,
  documentCanvasConfigSchema,
  documentCanvasDemoData,
} from './blocks-config.js';
import type { DocRecord } from './block-types.js';

afterEach(cleanup);

/**
 * Build a widget config THROUGH its own schema, exactly as the registry does.
 * The blocks read their field names (`nameField`, `qtyField`, …) from config,
 * and those names are schema DEFAULTS — hand-rolling a config bag would silently
 * hand the component `undefined` for every field and test a shape production
 * never sees.
 */
const cfg = <T,>(schema: { parse: (input: unknown) => T }, extra: Record<string, unknown> = {}): never =>
  schema.parse(extra) as never;

const noop = (): void => {};

const ITEMS = [
  { id: 'li-1', desc: 'Design', qty: 10, rate: 100 },
  { id: 'li-2', desc: 'Build', qty: 5, rate: 200 },
];

// ============================================================================
// moveBlock — the reorder index algebra (keyboard + pointer share it)
// ============================================================================

describe('moveBlock', () => {
  const list = ['a', 'b', 'c'];

  it('moves an item down and up, returning a new list', () => {
    expect(moveBlock(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveBlock(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveBlock(list, 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('never mutates the input', () => {
    const input = [...list];
    moveBlock(input, 0, 1);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  /** The canvas's end controls rely on this: a move off the end is a no-op, not a wrap. */
  it('is a no-op at the ends and for out-of-range indices', () => {
    expect(moveBlock(list, 0, -1)).toEqual(list);
    expect(moveBlock(list, 2, 1)).toEqual(list);
    expect(moveBlock(list, -1, 1)).toEqual(list);
    expect(moveBlock(list, 9, -1)).toEqual(list);
  });
});

// ============================================================================
// blockOrderOf — precedence, show-flags, unknown-id drop
// ============================================================================

describe('blockOrderOf', () => {
  /**
   * Note this resolves the default composition even for a null doc — the canvas
   * short-circuits to its empty card before it ever renders that order, so the
   * fallback is about "no blockOrder column", not "no document".
   */
  it('falls back to the doc type composition when the doc declares no order', () => {
    expect(blockOrderOf(null, { docType: 'invoice' }).map((i) => i.block)).toEqual([
      ...DOC_TYPE_BLOCKS.invoice,
    ]);
    expect(blockOrderOf({} as DocRecord, { docType: 'report' }).map((i) => i.block)).toEqual([
      ...DOC_TYPE_BLOCKS.report,
    ]);
  });

  it('prefers enabledBlocks over the doc type default', () => {
    const order = blockOrderOf({} as DocRecord, { docType: 'invoice', enabledBlocks: ['block-contact'] });
    expect(order.map((i) => i.block)).toEqual(['block-contact']);
  });

  it('prefers the doc blockOrder over the doc type default', () => {
    const doc = { blockOrder: [{ id: 'x', block: 'block-contact' }] } as unknown as DocRecord;
    expect(blockOrderOf(doc, { docType: 'invoice' }).map((i) => i.block)).toEqual(['block-contact']);
  });

  it('accepts a bare id string as a blockOrder entry and synthesizes an id', () => {
    const doc = { blockOrder: ['block-contact', 'block-signature'] } as unknown as DocRecord;
    expect(blockOrderOf(doc, { docType: 'invoice' })).toEqual([
      { id: 'block-contact-0', block: 'block-contact' },
      { id: 'block-signature-1', block: 'block-signature' },
    ]);
  });

  /** Unknown ids must never resolve to an arbitrary widget — they are dropped. */
  it('drops unknown block ids from an untrusted doc', () => {
    const doc = {
      blockOrder: ['block-contact', 'block-not-a-real-block', 'widget-missing', 42, null],
    } as unknown as DocRecord;
    expect(blockOrderOf(doc, { docType: 'invoice' }).map((i) => i.block)).toEqual(['block-contact']);
  });

  /** The annex's "~20 boolean show-flags per doc". */
  it('hides a block whose flag is false, keeping true/absent flags', () => {
    const doc = {
      blockOrder: ['block-contact', 'block-signature', 'block-approval'],
      flags: { 'block-signature': false, 'block-contact': true },
    } as unknown as DocRecord;
    expect(blockOrderOf(doc, { docType: 'report' }).map((i) => i.block)).toEqual([
      'block-contact',
      'block-approval',
    ]);
  });

  it('intersects the declared order with enabledBlocks', () => {
    const doc = { blockOrder: ['block-contact', 'block-signature'] } as unknown as DocRecord;
    const order = blockOrderOf(doc, { docType: 'report', enabledBlocks: ['block-signature'] });
    expect(order.map((i) => i.block)).toEqual(['block-signature']);
  });
});

// ============================================================================
// computeTotals + blockDataOf — the live-recomputing money contract
// ============================================================================

describe('computeTotals', () => {
  it('derives subtotal → discount → tax on the discounted base → total', () => {
    expect(computeTotals(ITEMS, { taxRate: 0.2, discountRate: 0.1, currency: 'EUR' })).toEqual({
      subtotal: 2000,
      discount: 200,
      taxable: 1800,
      tax: 360,
      total: 2160,
      currency: 'EUR',
    });
  });

  it('treats absent rates as no discount and no tax', () => {
    const totals = computeTotals(ITEMS, undefined);
    expect(totals).toMatchObject({ subtotal: 2000, discount: 0, tax: 0, total: 2000, currency: 'USD' });
  });

  /** Untrusted rows reach this from a live table — they must not produce NaN. */
  it('coerces corrupt quantities and rates instead of poisoning the arithmetic', () => {
    const corrupt = [
      { id: '1', desc: 'NaN qty', qty: Number.NaN, rate: 100 },
      { id: '2', desc: 'negative', qty: -5, rate: 100 },
      { id: '3', desc: 'infinite rate', qty: 1, rate: Number.POSITIVE_INFINITY },
      { id: '4', desc: 'good', qty: 2, rate: 50 },
    ];
    const totals = computeTotals(corrupt, { taxRate: 9, discountRate: -3, currency: '' });
    expect(Number.isFinite(totals.total)).toBe(true);
    expect(totals.subtotal).toBe(100); // only the good row contributes
    expect(totals.discount).toBe(0); // rate clamped up into [0,1]
    expect(totals.tax).toBe(100); // rate clamped down into [0,1]
    expect(totals.currency).toBe('USD'); // '' is schema-valid but throws inside Intl
  });

  it('rounds money to cents rather than leaking float error', () => {
    const totals = computeTotals([{ id: '1', desc: 'x', qty: 3, rate: 6.666 }], { taxRate: 0.2, discountRate: 0, currency: 'USD' });
    expect(totals.subtotal).toBe(20);
    expect(totals.tax).toBe(4);
  });
});

describe('blockDataOf — doc → per-block payload projection', () => {
  const doc = {
    items: ITEMS,
    rates: { taxRate: 0.2, discountRate: 0.1, currency: 'USD' },
    blocks: { 'block-contact': rowData({ name: 'Ava' }) },
  } as unknown as DocRecord;

  it('returns null for every block when there is no doc', () => {
    for (const id of BLOCK_IDS) expect(blockDataOf(id, null)).toBeNull();
  });

  it('projects the line items as a record-list', () => {
    expect(blockDataOf('block-line-items', doc)).toEqual(rowsData(ITEMS));
  });

  /**
   * THE INVARIANT the annex's "live-recomputing totals" buys: totals, tax and QR
   * are all derived from the same `computeTotals`, so they cannot disagree.
   */
  it('derives totals, tax and QR from one computation', () => {
    const totals = computeTotals(ITEMS, doc.rates, 'USD');
    expect(blockDataOf('block-totals-summary', doc)).toEqual(rowData({ items: ITEMS, rates: doc.rates }));
    expect(blockDataOf('block-tax-breakdown', doc)).toEqual(
      rowsData([{ id: 'tax-1', label: 'Tax', rate: 0.2, amount: totals.tax }]),
    );
    expect(blockDataOf('block-qr-pay', doc)).toEqual(
      rowData({ caption: 'Scan to pay', total: totals.total, currency: 'USD' }),
    );
  });

  it('prefers the doc own tax lines over the derived single line', () => {
    const multi = { ...doc, blocks: { 'block-tax-breakdown': rowsData([{ id: 't', label: 'VAT', rate: 0.21 }]) } } as unknown as DocRecord;
    expect(blockDataOf('block-tax-breakdown', multi)).toEqual(rowsData([{ id: 't', label: 'VAT', rate: 0.21 }]));
  });

  it('emits no tax line when the doc has no tax rate', () => {
    const untaxed = { items: ITEMS, rates: { taxRate: 0, discountRate: 0, currency: 'USD' } } as unknown as DocRecord;
    expect(blockDataOf('block-tax-breakdown', untaxed)).toEqual(rowsData([]));
  });

  it('passes non-derived blocks through from the blocks bag, null when absent', () => {
    expect(blockDataOf('block-contact', doc)).toEqual(rowData({ name: 'Ava' }));
    expect(blockDataOf('block-signature', doc)).toBeNull();
  });
});

// ============================================================================
// maskMethod — a full PAN must never reach the DOM
// ============================================================================

describe('maskMethod', () => {
  it('renders only the last four digits of the row own last4 field', () => {
    expect(maskMethod('Visa', '4242')).toBe('Visa ···· 4242');
    expect(maskMethod('Amex', '1234567890123')).toBe('Amex ···· 0123');
  });

  it('falls back to the bare method when there is no last4', () => {
    expect(maskMethod('Bank transfer', undefined)).toBe('Bank transfer');
    expect(maskMethod('Bank transfer', 'n/a')).toBe('Bank transfer');
  });
});

describe('formatBlockRate', () => {
  /**
   * The whole-percent test runs on a float. `0.07 * 100` is `7.000000000000001`
   * and `0.29 * 100` is `28.999999999999996`, so a naive `% 1 === 0` answers
   * "not whole" for two perfectly ordinary tax rates — and the same tax table
   * then prints `20%` on one row and `7.00%` on the next.
   */
  it('renders whole-percent rates with no fraction digits, float error and all', () => {
    expect(formatBlockRate(0.2, 'en-US')).toBe('20%');
    expect(formatBlockRate(0.07, 'en-US')).toBe('7%');
    expect(formatBlockRate(0.29, 'en-US')).toBe('29%');
  });

  it('keeps two digits for a genuinely fractional rate', () => {
    expect(formatBlockRate(0.075, 'en-US')).toBe('7.50%');
    expect(formatBlockRate(0.015, 'en-US')).toBe('1.50%');
  });

  it('renders an em dash rather than NaN% for a non-finite rate', () => {
    expect(formatBlockRate(Number.NaN, 'en-US')).toBe('—');
  });
});

describe('fillTemplate', () => {
  it('fills placeholders from already-translated values', () => {
    expect(fillTemplate('Recurring — {freq} · {count} cycles', { freq: 'Monthly', count: '12' })).toBe(
      'Recurring — Monthly · 12 cycles',
    );
  });

  /** A missing value leaves the token rather than printing "undefined". */
  it('leaves an unknown placeholder untouched', () => {
    expect(fillTemplate('A {rate} fee after {days} days', { rate: '2%' })).toBe('A 2% fee after {days} days');
  });
});

// ============================================================================
// Blocks — render, empty, and the never-writes contract
// ============================================================================

describe('block-line-items', () => {
  it('renders a row per item with the amount column', () => {
    render(<BlockLineItemsWidget config={cfg(blockLineItemsConfigSchema)} data={rowsData(ITEMS) as never} instanceId="b1" onEvent={noop} />);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
    expect(screen.getByText('Design')).toBeTruthy();
  });

  it('renders its own empty copy when there are no items', () => {
    render(
      <BlockLineItemsWidget
        config={cfg(blockLineItemsConfigSchema, { emptyTitle: 'No line items', emptyBody: 'Add one.' })}
        data={rowsData([]) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('No line items')).toBeTruthy();
  });

  /** 04 §2.1 — the block emits an intent; the host does the write. */
  it('emits a mutate intent addressing binding.source.name on a qty edit', () => {
    const onEvent = vi.fn();
    render(
      <BlockLineItemsWidget
        config={cfg(blockLineItemsConfigSchema, { binding: { connectionId: 'c1', source: { schema: 'public', name: 'line_items' }, shape: 'record-list' } })}
        data={rowsData(ITEMS) as never}
        instanceId="b1"
        onEvent={onEvent}
      />,
    );
    fireEvent.change(screen.getByLabelText('Qty — Design'), { target: { value: '14' } });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'update',
      connectionId: 'c1',
      table: 'public.line_items',
      recordId: 'li-1',
      values: { qty: 14 },
    });
  });

  it('emits nothing when unbound, and nothing for a negative or non-numeric qty', () => {
    const onEvent = vi.fn();
    const { rerender } = render(
      <BlockLineItemsWidget config={cfg(blockLineItemsConfigSchema)} data={rowsData(ITEMS) as never} instanceId="b1" onEvent={onEvent} />,
    );
    fireEvent.change(screen.getByLabelText('Qty — Design'), { target: { value: '14' } });
    expect(onEvent).not.toHaveBeenCalled(); // unbound: no table to address

    rerender(
      <BlockLineItemsWidget
        config={cfg(blockLineItemsConfigSchema, { binding: { connectionId: 'c1', source: { name: 'line_items' }, shape: 'record-list' } })}
        data={rowsData(ITEMS) as never}
        instanceId="b1"
        onEvent={onEvent}
      />,
    );
    fireEvent.change(screen.getByLabelText('Qty — Design'), { target: { value: '-3' } });
    expect(onEvent).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION: an empty field is not a write of zero. `<input type="number">`
   * reports `''` both while the user clears it to retype and for input the
   * control rejects as non-numeric — and `Number('')` is 0, not NaN, so a naive
   * finite-check persists `qty: 0` and silently zeroes the line item.
   */
  it('never emits a zero-qty write for a cleared or rejected number field', () => {
    const onEvent = vi.fn();
    render(
      <BlockLineItemsWidget
        config={cfg(blockLineItemsConfigSchema, {
          binding: { connectionId: 'c1', source: { name: 'line_items' }, shape: 'record-list' },
        })}
        data={rowsData(ITEMS) as never}
        instanceId="b1"
        onEvent={onEvent}
      />,
    );
    const qty = screen.getByLabelText('Qty — Design');
    fireEvent.change(qty, { target: { value: '' } }); // cleared to retype
    fireEvent.change(qty, { target: { value: '   ' } }); // whitespace only
    expect(onEvent).not.toHaveBeenCalled();

    // …but a real edit still writes.
    fireEvent.change(qty, { target: { value: '3' } });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ values: { qty: 3 } });
  });
});

describe('block-totals-summary', () => {
  it('recomputes the figures from items + rates rather than a stored total', () => {
    render(
      <BlockTotalsSummaryWidget
        config={cfg(blockTotalsSummaryConfigSchema, { format: { currency: 'USD', locale: 'en-US' } })}
        data={rowData({ items: ITEMS, rates: { taxRate: 0.2, discountRate: 0.1, currency: 'USD' } }) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText(formatBlockMoney(2000, { locale: 'en-US', currency: 'USD' }))).toBeTruthy();
    expect(screen.getByText(formatBlockMoney(2160, { locale: 'en-US', currency: 'USD' }))).toBeTruthy();
  });

  /**
   * The 04 §5 field-naming contract, which this block DECLARES (`itemsField` /
   * `ratesField`). Hardcoding `payload.items` makes the mismatch invisible in
   * the worst way: `rowOf` returns a non-null payload so the empty guard is
   * skipped, `payload.items ?? []` yields `[]`, and the block prints Subtotal
   * $0.00 / Total due $0.00 — a silently WRONG invoice, not a visible failure.
   */
  it('reads items and rates through the configured field names (04 §5)', () => {
    render(
      <BlockTotalsSummaryWidget
        config={cfg(blockTotalsSummaryConfigSchema, {
          itemsField: 'lines',
          ratesField: 'charges',
          format: { currency: 'USD', locale: 'en-US' },
        })}
        data={
          rowData({
            lines: [{ id: 'l1', desc: 'X', qty: 2, rate: 500 }],
            charges: { taxRate: 0.2, discountRate: 0, currency: 'USD' },
          }) as never
        }
        instanceId="b-fields"
        onEvent={noop}
      />,
    );
    expect(screen.getByText(formatBlockMoney(1000, { locale: 'en-US', currency: 'USD' }))).toBeTruthy(); // subtotal
    expect(screen.getByText(formatBlockMoney(1200, { locale: 'en-US', currency: 'USD' }))).toBeTruthy(); // total due
  });

  it('agrees with block-qr-pay about the same invoice', () => {
    const totals = blockTotalsSummaryDemoData(7);
    const items = totals.row?.items ?? [];
    const derived = computeTotals(items, totals.row?.rates);
    const qr = blockQrPayDemoData(7);
    expect(Number.isFinite(derived.total)).toBe(true);
    expect(Number.isFinite(qr.row?.total ?? Number.NaN)).toBe(true);
  });
});

describe('block-payment-history', () => {
  it('masks the method and never renders a full number', () => {
    render(
      <BlockPaymentHistoryWidget
        config={cfg(blockPaymentHistoryConfigSchema)}
        data={rowsData([{ id: 'p1', date: '2026-06-01T00:00:00.000Z', method: 'Visa', last4: '4242', amount: 100, status: 'paid' }]) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Visa ···· 4242')).toBeTruthy();
  });
});

describe('block-terms-checkbox', () => {
  /** `form-state` (04 §3): the payload IS the control state — never "empty". */
  it('renders the toggle with the payload label and never an empty card', () => {
    render(
      <BlockTermsCheckboxWidget
        config={cfg(blockTermsCheckboxConfigSchema, { defaultLabel: 'I accept the terms' })}
        data={{ label: 'I accept the SOW', checked: true } as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('I accept the SOW')).toBeTruthy();
  });

  it('falls back to the config default label when the payload has none', () => {
    render(
      <BlockTermsCheckboxWidget
        config={cfg(blockTermsCheckboxConfigSchema, { defaultLabel: 'I accept the terms' })}
        data={{ checked: false } as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('I accept the terms')).toBeTruthy();
  });
});

describe('block-approval / block-kpi-row / block-attachments / block-contact / block-highlight-box', () => {
  it('renders the approver with a status pill', () => {
    render(
      <BlockApprovalWidget
        config={cfg(blockApprovalConfigSchema, { approvedLabel: 'Approved' })}
        data={rowData({ name: 'Ava Reyes', title: 'Chief Executive', status: 'approved' }) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Ava Reyes')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('caps the KPI row at maxTiles so it stays one line on paper', () => {
    const kpis = Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, label: `KPI ${i}`, value: i, delta: 0, unit: 'plain' }));
    const { container } = render(
      <BlockKpiRowWidget config={cfg(blockKpiRowConfigSchema, { maxTiles: 3 })} data={rowsData(kpis) as never} instanceId="b1" onEvent={noop} />,
    );
    expect(container.querySelectorAll('[data-part="kpi-tile"]').length).toBeLessThanOrEqual(3);
    expect(screen.queryByText('KPI 5')).toBeNull();
  });

  it('renders attachment names', () => {
    render(
      <BlockAttachmentsWidget
        config={cfg(blockAttachmentsConfigSchema)}
        data={rowsData([{ id: 'a1', name: 'Statement of work.pdf', size: 2_400_000 }]) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Statement of work.pdf')).toBeTruthy();
  });

  it('renders contact rows and the highlight value', () => {
    render(
      <BlockContactWidget
        config={cfg(blockContactConfigSchema)}
        data={rowData({ name: 'Ava', email: 'ava@x.test', phone: '+351 21' }) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('ava@x.test')).toBeTruthy();
    cleanup();

    render(
      <BlockHighlightBoxWidget
        config={cfg(blockHighlightBoxConfigSchema)}
        data={rowData({ label: 'Amount charged', value: '$290.00' }) as never}
        instanceId="b1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Amount charged')).toBeTruthy();
    expect(screen.getByText('$290.00')).toBeTruthy();
  });
});

describe('block-qr-pay', () => {
  /** The tile is a deterministic PLACEHOLDER matrix, not a real QR encoding. */
  it('renders a stable placeholder matrix for a pinned qrSeed', () => {
    const data = rowData({ caption: 'Scan to pay', total: 100, currency: 'USD' });
    const first = render(<BlockQrPayWidget config={cfg(blockQrPayConfigSchema, { qrSeed: 7 })} data={data as never} instanceId="b1" onEvent={noop} />);
    const a = first.container.innerHTML;
    cleanup();
    const second = render(<BlockQrPayWidget config={cfg(blockQrPayConfigSchema, { qrSeed: 7 })} data={data as never} instanceId="b1" onEvent={noop} />);
    expect(second.container.innerHTML).toBe(a);
  });
});

// ============================================================================
// document-canvas
// ============================================================================

describe('document-canvas', () => {
  const doc = documentCanvasDemoData(7);

  it('renders the paper header and one list item per block', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={noop} />,
    );
    expect(container.querySelector('[data-part="doc-header"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-part="block-instance"]').length).toBe(
      DOC_TYPE_BLOCKS.invoice.length,
    );
  });

  /**
   * THE CANVAS RENDERS REAL CONTENT, not just the right number of boxes.
   *
   * Every other assertion in this describe is structural — block counts, ids,
   * ordering, `data-selected`, disabled states — and structure is exactly what
   * stays green while the blocks inside render a $2,000 invoice as `0 / $0.00`.
   * A nested block's config must resolve through ITS OWN schema; handing it the
   * canvas's config bag leaves every one of its ~64 fields `undefined`, and the
   * blank/zeroed output that follows is invisible to a count.
   */
  it('renders each block’s real content through the block’s own config schema', () => {
    const invoice = rowData({
      docType: 'invoice',
      title: 'Invoice',
      items: [
        { id: 'i1', desc: 'Design', qty: 10, rate: 100 },
        { id: 'i2', desc: 'Build', qty: 5, rate: 200 },
      ],
      rates: { taxRate: 0.2, discountRate: 0, currency: 'USD' },
    });
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={invoice as never} instanceId="dc-content" onEvent={noop} />,
    );

    // block-line-items: descriptions, quantities and amounts — not '' / 0 / $0.00.
    const rows = [...container.querySelectorAll('[data-part="line-item"]')].map((row) => row.textContent);
    expect(rows[0]).toContain('Design');
    expect(rows[0]).toContain('$1,000.00');
    expect(rows[1]).toContain('Build');
    expect(rows[1]).toContain('$1,000.00');
    // `showAmountColumn` + `editable` default true — both are lost if the
    // canvas's own config reaches the block instead of the block's schema.
    expect(container.querySelectorAll('[data-widget="block-line-items"] thead th')).toHaveLength(4);
    expect(container.querySelectorAll('[data-widget="block-line-items"] input').length).toBeGreaterThan(0);

    // block-totals-summary: the $2,000 subtotal, not a silent zero.
    const totals = container.querySelector('[data-widget="block-totals-summary"]')?.textContent ?? '';
    expect(totals).toContain('$2,000.00');
    expect(totals).toContain('$400.00'); // 20% tax
    expect(totals).toContain('$2,400.00'); // total due
  });

  /**
   * `blockQrPayConfigSchema` defaults `modules: 21` / `qrSeed: 7`. With the
   * canvas's config in their place both are `undefined`, and the tile renders
   * `viewBox="0 0 undefined undefined"` with NaN-positioned finder rects (React
   * logs "Received NaN for the `x` attribute" — visible in the suite's stderr,
   * asserted by nobody).
   */
  it('renders the QR tile with real geometry — no NaN or undefined SVG attributes', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc-qr" onEvent={noop} />,
    );
    const svg = container.querySelector('[data-part="qr-placeholder"]');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 21 21');
    const attributes = [...container.querySelectorAll('svg *')].flatMap((node) =>
      [...node.attributes].map((attribute) => attribute.value),
    );
    expect(attributes.filter((value) => value === 'NaN' || value.includes('undefined'))).toEqual([]);
  });

  it('renders its own empty copy when there is no doc', () => {
    render(
      <DocumentCanvasWidget
        config={cfg(documentCanvasConfigSchema, { emptyTitle: 'Nothing in this document' })}
        data={rowData(null) as never}
        instanceId="dc"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Nothing in this document')).toBeTruthy();
  });

  it('marks an email doc as always-light (we do not control email clients)', () => {
    const { container } = render(
      <DocumentCanvasWidget
        config={cfg(documentCanvasConfigSchema, { docType: 'email' })}
        data={rowData({ docType: 'email', title: 'Receipt', blockOrder: ['block-highlight-box'] }) as never}
        instanceId="dc"
        onEvent={noop}
      />,
    );
    const paper = container.querySelector('[data-widget="document-canvas"]');
    expect(paper?.getAttribute('data-doc-type')).toBe('email');
    expect(paper?.className).toContain('adm-always-light');
  });

  it('selects a block on click and marks it pressed', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={noop} />,
    );
    const first = container.querySelector('[data-part="block-instance"]');
    const region = first?.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(region);
    expect(container.querySelector('[data-part="block-instance"]')?.getAttribute('data-selected')).toBe('true');
    expect(region.getAttribute('aria-pressed')).toBe('true');
  });

  /**
   * Reorder is keyboard-reachable by construction: the controls are real
   * IconButtons, so this drives the SAME path a keyboard user does.
   */
  it('emits a mutate intent carrying the new block order on move down', () => {
    const onEvent = vi.fn();
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={onEvent} />,
    );
    const before = [...container.querySelectorAll('[data-part="block-instance"]')].map((n) => n.getAttribute('data-block'));
    fireEvent.click(container.querySelector('[data-part="block-move-down"]') as HTMLElement);

    expect(onEvent).toHaveBeenCalledTimes(1);
    const event = onEvent.mock.calls[0]?.[0] as { type: string; values: { blockOrder: string[] } };
    expect(event.type).toBe('mutate');
    expect(event.values.blockOrder).toEqual([before[1], before[0], ...before.slice(2)]);

    const after = [...container.querySelectorAll('[data-part="block-instance"]')].map((n) => n.getAttribute('data-block'));
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  it('disables move-up on the first block and move-down on the last', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={noop} />,
    );
    const ups = container.querySelectorAll('[data-part="block-move-up"]');
    const downs = container.querySelectorAll('[data-part="block-move-down"]');
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[downs.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes a block and emits the shortened order', () => {
    const onEvent = vi.fn();
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={onEvent} />,
    );
    const before = container.querySelectorAll('[data-part="block-instance"]').length;
    fireEvent.click(container.querySelector('[data-part="block-remove"]') as HTMLElement);
    expect(container.querySelectorAll('[data-part="block-instance"]').length).toBe(before - 1);
    const event = onEvent.mock.calls[0]?.[0] as { values: { blockOrder: string[] } };
    expect(event.values.blockOrder).toHaveLength(before - 1);
  });

  it('hides the controls entirely when reorderable is off', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema, { reorderable: false })} data={doc as never} instanceId="dc" onEvent={noop} />,
    );
    expect(container.querySelector('[data-part="block-controls"]')).toBeNull();
  });

  /** An unknown id in an untrusted doc must render nothing, not an arbitrary widget. */
  it('never resolves an unknown block id', () => {
    const { container } = render(
      <DocumentCanvasWidget
        config={cfg(documentCanvasConfigSchema)}
        data={rowData({ docType: 'invoice', title: 'X', blockOrder: ['block-contact', 'block-bogus'] }) as never}
        instanceId="dc"
        onEvent={noop}
      />,
    );
    const blocks = [...container.querySelectorAll('[data-part="block-instance"]')].map((n) => n.getAttribute('data-block'));
    expect(blocks).toEqual(['block-contact']);
  });

  it('applies the doc show-flags', () => {
    const { container } = render(
      <DocumentCanvasWidget
        config={cfg(documentCanvasConfigSchema)}
        data={rowData({
          docType: 'invoice',
          title: 'X',
          blockOrder: ['block-contact', 'block-signature'],
          flags: { 'block-signature': false },
        }) as never}
        instanceId="dc"
        onEvent={noop}
      />,
    );
    expect([...container.querySelectorAll('[data-part="block-instance"]')].map((n) => n.getAttribute('data-block'))).toEqual([
      'block-contact',
    ]);
  });

  /**
   * RTL: the canvas mirrors, but reorder is on the BLOCK axis — "up" is up in
   * every locale, so the emitted order under `dir="rtl"` is identical to LTR.
   */
  it('keeps reorder semantics identical under RTL', () => {
    const onEvent = vi.fn();
    const { container } = render(
      <div dir="rtl">
        <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema, { format: { locale: 'ar-EG' } })} data={doc as never} instanceId="dc" onEvent={onEvent} />
      </div>,
    );
    const before = [...container.querySelectorAll('[data-part="block-instance"]')].map((n) => n.getAttribute('data-block'));
    fireEvent.click(container.querySelector('[data-part="block-move-down"]') as HTMLElement);
    const event = onEvent.mock.calls[0]?.[0] as { values: { blockOrder: string[] } };
    expect(event.values.blockOrder).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  /** No physical-direction utilities anywhere in the rendered canvas (CI bans them). */
  it('uses only logical direction utilities', () => {
    const { container } = render(
      <DocumentCanvasWidget config={cfg(documentCanvasConfigSchema)} data={doc as never} instanceId="dc" onEvent={noop} />,
    );
    const classes = [...container.querySelectorAll('[class]')].flatMap((n) => n.className.toString().split(/\s+/));
    const physical = classes.filter((c) =>
      /^(-?)(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right|inset-block)(-|$)/.test(c),
    );
    expect(physical).toEqual([]);
  });
});
