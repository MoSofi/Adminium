// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Line items and the totals ladder (comp 424-456, 1550-1559; 34-invoices-
 * add-on.md Appendix E §C8–C9, O25).
 *
 * `items`: the `22px 1fr 62px 92px 96px 30px` grid — grip · description ·
 * qty · rate · amount · ×. Rows drag-reorder like blocks (`reorderItem`,
 * 1358) and the grip also answers ArrowUp/ArrowDown (an a11y addition); the
 * × hides until the row is hovered or holds focus. *Add line item* appends
 * the comp's seed (1356).
 *
 * `totals`: the 280 px right-aligned ladder — Subtotal · Discount ({rate})
 * only when the rate is above zero, in the positive green with a U+2212 ·
 * Tax ({rate}) always · **Total**. "Total", not the comp's "Total due"
 * (452): recorded payments never reduce it and there is no balance model
 * (O25). Every figure is `money.ts`' — a line rounds once, the
 * discount comes off the rounded subtotal, tax on the discounted base.
 */
import { GripVertical, Plus, X } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { formatMoney, formatPercent, parseDecimal } from '../../../model/money.js';
import { InlineInput, KICKER, Region } from '../inline.js';
import type { BlockProps } from './types.js';

const ROW_GRID = 'grid grid-cols-[22px_1fr_62px_92px_96px_30px] gap-0';

export function ItemsBlock({ body, totals, edits, section, onSelect }: BlockProps) {
  const [drag, setDrag] = useState<{ from: number | null; over: number | null }>({ from: null, over: null });
  const money = (minor: number) => formatMoney(minor, body.currency, body.cents);
  const reset = () => setDrag({ from: null, over: null });
  const onDragStart = (index: number, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Some engines refuse setData outside a real drag; the index is in state anyway.
    }
    setDrag({ from: index, over: null });
  };
  const onDrop = (index: number) => {
    if (drag.from !== null && drag.from !== index) edits.reorderItems(drag.from, index);
    reset();
  };
  const onGripKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      edits.reorderItems(index, index - 1);
    } else if (event.key === 'ArrowDown' && index < body.items.length - 1) {
      event.preventDefault();
      edits.reorderItems(index, index + 2);
    }
  };

  return (
    <Region section="items" selected={section} onSelect={onSelect}>
      <div className={cn(ROW_GRID, KICKER, 'pb-2')}>
        <span />
        <span>{t('invoices:canvas.items.description', 'Description')}</span>
        <span className="text-center">{t('invoices:canvas.items.qty', 'Qty')}</span>
        <span className="text-end">{t('invoices:canvas.items.rate', 'Rate')}</span>
        <span className="text-end">{t('invoices:canvas.items.amount', 'Amount')}</span>
        <span />
      </div>
      <div className="flex flex-col">
        {body.items.map((item, index) => {
          const dragging = drag.from === index;
          const over = drag.over === index && drag.from !== null && drag.from !== index;
          const rowName = item.desc.trim() === '' ? t('invoices:canvas.items.row', 'Line item {n}', { n: index + 1 }) : item.desc;
          return (
            <div
              key={item.id}
              data-testid="invoices-item-row"
              onDragOver={(event) => {
                event.preventDefault();
                if (drag.over !== index) setDrag((current) => ({ ...current, over: index }));
              }}
              onDrop={(event) => {
                event.preventDefault();
                onDrop(index);
              }}
              className={cn(
                ROW_GRID,
                'group/li items-center border-t border-[#ececef] py-[9px] transition-[opacity,box-shadow] duration-150',
                dragging && 'opacity-40',
                over && 'shadow-[inset_0_2px_0_0_var(--adm-invoice-accent)]',
              )}
            >
              <button
                type="button"
                draggable
                title={t('invoices:canvas.items.reorder', 'Drag to reorder')}
                aria-label={t('invoices:canvas.items.reorderOf', 'Drag to reorder: {name}', { name: rowName })}
                onDragStart={(event) => onDragStart(index, event)}
                onDragEnd={reset}
                onKeyDown={(event) => onGripKey(index, event)}
                onClick={(event) => event.stopPropagation()}
                className="flex cursor-grab items-center justify-center rounded border-0 bg-transparent p-0 text-[#6b6b76] hover:text-[var(--adm-invoice-accent)]"
              >
                <GripVertical className="size-3.5" aria-hidden="true" />
              </button>
              <InlineInput
                label={t('invoices:canvas.items.descriptionOf', 'Description of line {n}', { n: index + 1 })}
                value={item.desc}
                onFocus={edits.beginEdit}
                onChange={(value) => edits.updateItem(item.id, { desc: value })}
                className="px-1 py-1 text-[13px] font-semibold"
              />
              <InlineInput
                label={t('invoices:canvas.items.qtyOf', 'Quantity of line {n}', { n: index + 1 })}
                value={item.qty}
                onFocus={edits.beginEdit}
                onChange={(value) => edits.updateItem(item.id, { qty: value })}
                className="py-1 text-center text-[13px]"
                inputMode="decimal"
                mono
              />
              <InlineInput
                label={t('invoices:canvas.items.rateOf', 'Rate of line {n}', { n: index + 1 })}
                value={item.rate}
                onFocus={edits.beginEdit}
                onChange={(value) => edits.updateItem(item.id, { rate: value })}
                className="py-1 text-end text-[13px]"
                inputMode="decimal"
                mono
              />
              <span data-testid="invoices-item-amount" className="self-center text-end font-mono text-[13px] font-bold">
                {money(totals.lines[index] ?? 0)}
              </span>
              <button
                type="button"
                aria-label={t('invoices:canvas.items.remove', 'Remove line item: {name}', { name: rowName })}
                onClick={(event) => {
                  event.stopPropagation();
                  edits.removeItem(item.id);
                }}
                className="nb-ib flex size-6 cursor-pointer items-center justify-center justify-self-end self-center rounded-[7px] border-0 bg-transparent text-[#6b6b76] opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-focus-within/li:opacity-100 group-hover/li:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="invoices-add-item"
        onClick={(event) => {
          event.stopPropagation();
          edits.addItem();
        }}
        className="mt-3 flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-dashed border-[#e2e2e8] bg-transparent px-3 py-2 text-[12.5px] font-bold text-[var(--adm-invoice-accent)]"
      >
        <Plus className="size-[15px]" aria-hidden="true" />
        {t('invoices:canvas.items.add', 'Add line item')}
      </button>
    </Region>
  );
}

export function TotalsBlock({ body, totals, section, onSelect }: BlockProps) {
  const money = (minor: number) => formatMoney(minor, body.currency, body.cents);
  const showDiscount = parseDecimal(body.discountRate) > 0;
  return (
    <div className="flex justify-end">
      <Region section="tax" selected={section} onSelect={onSelect}>
        <div data-testid="invoices-totals" className="flex w-[280px] flex-col gap-[9px]">
          <div className="flex justify-between text-[13px]">
            <span className="text-[#6b6b76]">{t('invoices:canvas.totals.subtotal', 'Subtotal')}</span>
            <span data-testid="invoices-subtotal" className="font-mono font-bold">
              {money(totals.subtotal)}
            </span>
          </div>
          {showDiscount ? (
            <div data-testid="invoices-discount-row" className="flex justify-between text-[13px]">
              <span className="text-[#6b6b76]">{t('invoices:canvas.totals.discount', 'Discount ({rate})', { rate: formatPercent(body.discountRate) })}</span>
              <span className="font-mono font-bold text-pos">{`−${money(totals.discount)}`}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-[13px]">
            <span className="text-[#6b6b76]">{t('invoices:canvas.totals.tax', 'Tax ({rate})', { rate: formatPercent(body.taxRate) })}</span>
            <span data-testid="invoices-tax" className="font-mono font-bold">
              {money(totals.tax)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-[#ececef] pt-[11px]">
            <span className="text-[14px] font-extrabold">{t('invoices:canvas.totals.total', 'Total')}</span>
            <span data-testid="invoices-total" className="font-mono text-[21px] font-extrabold tracking-[-.02em] text-[var(--adm-invoice-accent)]">
              {money(totals.total)}
            </span>
          </div>
        </div>
      </Region>
    </div>
  );
}
