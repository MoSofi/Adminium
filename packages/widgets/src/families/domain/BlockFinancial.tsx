import { MonoText, StatusPill } from '@adminium/ui';
import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';

import { BlockCallout, BlockEmpty, MoneyRow, fillTemplate } from './BlockShell.js';
import {
  blockBindingSourceOf,
  computeTotals,
  formatBlockDate,
  formatBlockMoney,
  formatBlockRate,
  lineItemsOf,
  maskMethod,
  rowOf,
  rowsOf,
  round2,
} from './block-lib.js';
import {
  blockDiscountCodesConfigSchema,
  blockDiscountCodesDemoData,
  blockLateFeesConfigSchema,
  blockLateFeesDemoData,
  blockLineItemsConfigSchema,
  blockLineItemsDemoData,
  blockMultiCurrencyConfigSchema,
  blockMultiCurrencyDemoData,
  blockPaymentHistoryConfigSchema,
  blockPaymentHistoryDemoData,
  blockQrPayConfigSchema,
  blockQrPayDemoData,
  blockTaxBreakdownConfigSchema,
  blockTaxBreakdownDemoData,
  blockTotalsSummaryConfigSchema,
  blockTotalsSummaryDemoData,
} from './blocks-config.js';
import type {
  BlockDiscountCodesConfig,
  BlockLateFeesConfig,
  BlockLineItemsConfig,
  BlockMultiCurrencyConfig,
  BlockPaymentHistoryConfig,
  BlockQrPayConfig,
  BlockTaxBreakdownConfig,
  BlockTotalsPayload,
  BlockTotalsSummaryConfig,
} from './blocks-config.js';
import { mulberry32, numberField, stringField } from './domain-lib.js';
import type {
  BlockDiscountCode,
  BlockLateFees,
  BlockMultiCurrency,
  BlockPayment,
  BlockQrPay,
  BlockTaxLine,
} from './block-types.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  blockDiscountCodesConfigSchema,
  blockDiscountCodesDemoData,
  blockLateFeesConfigSchema,
  blockLateFeesDemoData,
  blockLineItemsConfigSchema,
  blockLineItemsDemoData,
  blockMultiCurrencyConfigSchema,
  blockMultiCurrencyDemoData,
  blockPaymentHistoryConfigSchema,
  blockPaymentHistoryDemoData,
  blockQrPayConfigSchema,
  blockQrPayDemoData,
  blockTaxBreakdownConfigSchema,
  blockTaxBreakdownDemoData,
  blockTotalsSummaryConfigSchema,
  blockTotalsSummaryDemoData,
};

/**
 * TRACK BUILDER — the INVOICE/PAYMENT half of the annex §13 document-block
 * vocabulary, grouped in one module because the annex specifies them as one
 * shared library and they share the money helpers (`computeTotals`,
 * `formatBlockMoney`) end to end:
 *
 *   `block-line-items`, `block-totals-summary`, `block-tax-breakdown`,
 *   `block-multi-currency`, `block-payment-history`, `block-discount-codes`,
 *   `block-late-fees`, `block-qr-pay`.
 *
 * NEVER WRITES: `block-line-items`' qty/rate edits emit `mutate` intents through
 * `onEvent` and the host runs them through the CRUD API with undo + audit
 * (04 §2.1). An unbound (demo) block has no table to address, so it renders the
 * inputs but emits nothing.
 *
 * MONEY IS ALWAYS RECOMPUTED, never read from a stored column: the totals, the
 * tax lines and the QR amount all derive from the same `computeTotals`, so a
 * canvas edit can never leave one block disagreeing with another.
 */

// ── block-line-items ────────────────────────────────────────────────────────

export function BlockLineItemsWidget({ config, data, onEvent }: WidgetProps<BlockLineItemsConfig>) {
  const items = lineItemsOf(data, config);
  const source = blockBindingSourceOf(config.binding);
  const locale = config.format?.locale;
  const currency = config.format?.currency;

  if (items.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No line items'} body={config.emptyBody ?? 'Add a line item to build this document.'} />;
  }

  const emit = (id: string, field: string, raw: string): void => {
    if (source === null) return; // unbound: nothing to write to
    /*
      An EMPTY field is not a write of zero. `<input type="number">` reports
      value === '' both while the user is clearing it to retype and for any
      input the control rejects as non-numeric — and `Number('')` is 0, not NaN,
      so without this guard the finite-check below passes and clearing a qty
      silently persists `qty: 0`, zeroing the line item's amount mid-keystroke.
    */
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: source.connectionId,
      table: source.table,
      recordId: id,
      values: { [field]: value },
    });
  };

  return (
    <table data-widget="block-line-items" data-testid={config.testId} className="w-full text-body-sm">
      <thead>
        <tr className="border-b border-border text-micro uppercase text-fg-subtle">
          <th scope="col" className="py-2 text-start font-bold">{config.descHeader ?? 'Description'}</th>
          <th scope="col" className="w-16 py-2 text-end font-bold">{config.qtyHeader ?? 'Qty'}</th>
          <th scope="col" className="w-24 py-2 text-end font-bold">{config.rateHeader ?? 'Rate'}</th>
          {config.showAmountColumn && (
            <th scope="col" className="w-28 py-2 text-end font-bold">{config.amountHeader ?? 'Amount'}</th>
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} data-part="line-item" className="border-b border-border/60 last:border-0">
            <td className="py-2 text-start text-fg">{item.desc}</td>
            <td className="py-2 text-end">
              {config.editable ? (
                <input
                  type="number"
                  min={0}
                  defaultValue={item.qty}
                  aria-label={`${config.qtyHeader ?? 'Qty'} — ${item.desc}`}
                  onChange={(event) => emit(item.id, config.qtyField, event.target.value)}
                  className="w-full rounded-sm bg-transparent px-1 py-0.5 text-end font-mono tabular-nums text-body-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2"
                />
              ) : (
                <MonoText>{item.qty}</MonoText>
              )}
            </td>
            <td className="py-2 text-end">
              {config.editable ? (
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  defaultValue={item.rate}
                  aria-label={`${config.rateHeader ?? 'Rate'} — ${item.desc}`}
                  onChange={(event) => emit(item.id, config.rateField, event.target.value)}
                  className="w-full rounded-sm bg-transparent px-1 py-0.5 text-end font-mono tabular-nums text-body-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2"
                />
              ) : (
                <MonoText>{formatBlockMoney(item.rate, { locale, currency })}</MonoText>
              )}
            </td>
            {config.showAmountColumn && (
              <td className="py-2 text-end">
                <MonoText className="text-fg">
                  {formatBlockMoney(round2(item.qty * item.rate), { locale, currency })}
                </MonoText>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── block-totals-summary ────────────────────────────────────────────────────

export function BlockTotalsSummaryWidget({ config, data }: WidgetProps<BlockTotalsSummaryConfig>) {
  const payload = rowOf<Record<string, unknown>>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No totals'} body={config.emptyBody ?? 'Totals appear once the document has line items.'} />;
  }

  // The doc's items/rates live under CONFIG-NAMED keys (04 §5) — hardcoding
  // `payload.items` would read `undefined` off a doc whose line items are a
  // `lines` column and print a silent $0.00 invoice rather than an empty state.
  const rawItems = payload[config.itemsField];
  const rawRates = payload[config.ratesField];
  const items = lineItemsOf({ rows: Array.isArray(rawItems) ? rawItems : [] }, config);
  const rates = (typeof rawRates === 'object' && rawRates !== null ? rawRates : undefined) as
    | BlockTotalsPayload['rates']
    | undefined;
  const totals = computeTotals(items, rates, config.format?.currency || 'USD');
  const locale = config.format?.locale;
  const currency = config.format?.currency || totals.currency;
  const money = (value: number): string => formatBlockMoney(value, { locale, currency });

  return (
    <div data-widget="block-totals-summary" data-testid={config.testId} className="w-full">
      <MoneyRow label={config.subtotalLabel ?? 'Subtotal'} value={money(totals.subtotal)} />
      {/* The annex's "Discount (green negative)" — a credit reads `pos`. */}
      {(totals.discount > 0 || !config.hideZeroDiscount) && (
        <MoneyRow
          testId="block-totals-discount"
          label={config.discountLabel ?? 'Discount'}
          value={`−${money(totals.discount)}`}
          tone="pos"
        />
      )}
      <MoneyRow label={config.taxLabel ?? 'Tax'} value={money(totals.tax)} />
      <MoneyRow label={config.totalLabel ?? 'Total due'} value={money(totals.total)} tone="accent" emphasis />
    </div>
  );
}

// ── block-tax-breakdown ─────────────────────────────────────────────────────

export function BlockTaxBreakdownWidget({ config, data }: WidgetProps<BlockTaxBreakdownConfig>) {
  const lines: BlockTaxLine[] = rowsOf(data).map((row, index) => ({
    id: stringField(row, config.idField) ?? `tax-${index}`,
    label: stringField(row, config.labelField) ?? '',
    rate: numberField(row, config.rateField) ?? 0,
    amount: numberField(row, config.amountField),
  }));

  if (lines.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No tax lines'} body={config.emptyBody ?? 'Tax lines appear once a rate applies to this document.'} />;
  }

  const locale = config.format?.locale;
  const currency = config.format?.currency;

  return (
    <div data-widget="block-tax-breakdown" data-testid={config.testId} className="w-full">
      {lines.map((line) => (
        <MoneyRow
          key={line.id}
          label={
            config.showRateColumn ? (
              <>
                {line.label} <span className="text-fg-subtle">{formatBlockRate(line.rate, locale)}</span>
              </>
            ) : (
              line.label
            )
          }
          // Derived from `rate × subtotal` unless the row carries its own amount
          // (annex: "applied to subtotal") — an item edit reflows the tax.
          value={formatBlockMoney(line.amount ?? round2(config.subtotal * line.rate), { locale, currency })}
        />
      ))}
    </div>
  );
}

// ── block-multi-currency ────────────────────────────────────────────────────

export function BlockMultiCurrencyWidget({ config, data }: WidgetProps<BlockMultiCurrencyConfig>) {
  const payload = rowOf<BlockMultiCurrency>(data);
  const fx = Array.isArray(payload?.fx) ? payload.fx : [];
  if (payload === null || fx.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No conversions'} body={config.emptyBody ?? 'Currency conversions appear once exchange rates are available.'} />;
  }

  const locale = config.format?.locale;
  const amount = typeof payload.amount === 'number' ? payload.amount : 0;
  const base = payload.baseCurrency || config.format?.currency || 'USD';

  return (
    <div data-widget="block-multi-currency" data-testid={config.testId} className="w-full">
      <MoneyRow label={base} value={formatBlockMoney(amount, { locale, currency: base })} emphasis />
      {fx.map((line) => (
        <MoneyRow
          key={line.currency}
          label={line.currency}
          value={formatBlockMoney(round2(amount * line.rate), { locale, currency: line.currency })}
          tone="muted"
        />
      ))}
      {config.footnote !== undefined && (
        <p className="mt-2 text-caption text-fg-subtle">{config.footnote}</p>
      )}
    </div>
  );
}

// ── block-payment-history ───────────────────────────────────────────────────

export function BlockPaymentHistoryWidget({ config, data }: WidgetProps<BlockPaymentHistoryConfig>) {
  const rows: BlockPayment[] = rowsOf(data)
    .slice(0, config.maxRows)
    .map((row, index) => ({
      id: stringField(row, config.idField) ?? `pay-${index}`,
      date: stringField(row, config.dateField) ?? '',
      method: stringField(row, config.methodField) ?? '',
      last4: stringField(row, config.last4Field),
      amount: numberField(row, config.amountField) ?? 0,
      status: stringField(row, config.statusField) ?? 'pending',
    }));

  if (rows.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No payments yet'} body={config.emptyBody ?? 'Payments against this document will appear here.'} />;
  }

  const locale = config.format?.locale;
  const currency = config.format?.currency;

  return (
    <ul data-widget="block-payment-history" data-testid={config.testId} className="w-full space-y-1">
      {rows.map((row) => (
        <li key={row.id} data-part="payment-row" className="flex items-center gap-3 py-1.5 text-body-sm">
          <MonoText className="shrink-0 text-caption text-fg-subtle">{formatBlockDate(row.date, locale)}</MonoText>
          {/* Only the masked tail ever reaches the DOM — never a full PAN. */}
          <span className="min-w-0 flex-1 truncate text-fg">{maskMethod(row.method, row.last4)}</span>
          <MonoText className="shrink-0 text-fg">{formatBlockMoney(row.amount, { locale, currency })}</MonoText>
          <StatusPill status={row.status} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

// ── block-discount-codes ────────────────────────────────────────────────────

export function BlockDiscountCodesWidget({ config, data }: WidgetProps<BlockDiscountCodesConfig>) {
  const rows: BlockDiscountCode[] = rowsOf(data).map((row, index) => ({
    id: stringField(row, config.idField) ?? `disc-${index}`,
    code: stringField(row, config.codeField) ?? '',
    label: stringField(row, config.labelField) ?? '',
    amount: numberField(row, config.amountField) ?? 0,
  }));

  if (rows.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No discount codes'} body={config.emptyBody ?? 'Applied discount codes will appear here.'} />;
  }

  const locale = config.format?.locale;
  const currency = config.format?.currency;

  return (
    <ul data-widget="block-discount-codes" data-testid={config.testId} className="w-full space-y-1.5">
      {rows.map((row) => (
        <li key={row.id} data-part="discount-row" className="flex items-center gap-2.5 text-body-sm">
          <MonoText className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-caption text-fg">
            {row.code}
          </MonoText>
          <span className="min-w-0 flex-1 truncate text-fg-muted">{row.label}</span>
          <MonoText className="shrink-0 text-pos">−{formatBlockMoney(row.amount, { locale, currency })}</MonoText>
        </li>
      ))}
    </ul>
  );
}

// ── block-late-fees ─────────────────────────────────────────────────────────

export function BlockLateFeesWidget({ config, data }: WidgetProps<BlockLateFeesConfig>) {
  const payload = rowOf<BlockLateFees>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No late fee'} body={config.emptyBody ?? 'Late-fee terms appear once they are set on this document.'} />;
  }

  const locale = config.format?.locale;
  const rate = typeof payload.rate === 'number' ? payload.rate : 0;
  const days = typeof payload.days === 'number' ? payload.days : 0;
  // ONE translated template with placeholders — never concatenated fragments,
  // so translators keep control of word order (and RTL stays correct).
  const template = config.template ?? 'A {rate} late fee applies after {days} days.';

  return (
    <BlockCallout block="block-late-fees" tone="warn" testId={config.testId} icon={<AlertTriangle className="size-4" />}>
      {fillTemplate(template, {
        rate: formatBlockRate(rate, locale),
        days: String(days),
      })}
    </BlockCallout>
  );
}

// ── block-qr-pay ────────────────────────────────────────────────────────────

/**
 * A deterministic QR-shaped PLACEHOLDER: three finder squares + a seeded module
 * field. It encodes nothing — the annex specifies the visual, and a real codec
 * would be a runtime dependency for a block whose payment URL the host owns.
 * Seeded (never `Math.random`) so VRT captures stay byte-identical.
 *
 * FORCED LIGHT, NOT RAW WHITE: the annex's "forced-white QR tile" is the
 * canonical theming exception `adm-always-light` (@adminium/tokens
 * exceptions.css — "Email previews and QR tiles are ALWAYS light, both themes
 * … QR needs dark-on-light contrast"). The scope re-declares the token set on
 * this subtree, so `bg-surface` / `fill-surface` / `currentColor` stay token-driven
 * and no literal color is written here.
 */
function QrPlaceholder({ modules, seed }: { modules: number; seed: number }) {
  const random = mulberry32(seed || 1);
  const cells: { x: number; y: number }[] = [];
  const inFinder = (x: number, y: number): boolean => {
    const near = (ox: number, oy: number): boolean => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    return near(0, 0) || near(modules - 7, 0) || near(0, modules - 7);
  };
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (inFinder(x, y)) continue;
      if (random() < 0.45) cells.push({ x, y });
    }
  }
  const finder = (ox: number, oy: number): ReactElement => (
    <g key={`f-${ox}-${oy}`}>
      <rect x={ox} y={oy} width={7} height={7} fill="currentColor" />
      <rect x={ox + 1} y={oy + 1} width={5} height={5} className="fill-surface" />
      <rect x={ox + 2} y={oy + 2} width={3} height={3} fill="currentColor" />
    </g>
  );
  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      className="adm-always-light size-28 shrink-0 rounded-sm bg-surface p-1 text-fg"
      role="img"
      aria-hidden
      data-part="qr-placeholder"
    >
      {finder(0, 0)}
      {finder(modules - 7, 0)}
      {finder(0, modules - 7)}
      {cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}

export function BlockQrPayWidget({ config, data }: WidgetProps<BlockQrPayConfig>) {
  const payload = rowOf<BlockQrPay>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No payment link'} body={config.emptyBody ?? 'A scannable payment code appears once an amount is due.'} />;
  }

  const locale = config.format?.locale;
  const currency = config.format?.currency || payload.currency || 'USD';
  const total = typeof payload.total === 'number' ? payload.total : 0;

  return (
    <div
      data-widget="block-qr-pay"
      data-testid={config.testId}
      className="flex w-full items-center gap-4"
    >
      <QrPlaceholder modules={config.modules} seed={config.qrSeed} />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm text-fg-muted">{payload.caption}</p>
        <p className="mt-1 text-caption text-fg-subtle">{config.amountLabel ?? 'Amount due'}</p>
        <MonoText className="text-title font-bold text-accent">
          {formatBlockMoney(total, { locale, currency })}
        </MonoText>
      </div>
    </div>
  );
}
