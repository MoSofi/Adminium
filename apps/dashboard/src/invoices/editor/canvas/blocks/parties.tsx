// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The address blocks (comp 388-421; 34-invoices-add-on.md Appendix F B1–B3):
 * `parties` — *From* and *Invoice to* side by side; `shipping` — *Ship to*;
 * `meta` — the four-column Issued · Due · Terms · PO number strip.
 *
 * *Invoice to*, not the comp's *Bill to* (395): 34 Appendix D.2's standing
 * `"bill" (noun) → "invoice"` row; the field is `customerName` for the same
 * reason.
 */
import { t } from '../../../../i18n/t.js';
import { InlineInput, KICKER, Region, lineLabel } from '../inline.js';
import type { BlockProps } from './types.js';

export function PartiesBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <div className="grid grid-cols-2 gap-[18px]">
      <Region section="from" selected={section} onSelect={onSelect}>
        <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.from', 'From')}</div>
        {body.from.map((line, index) => (
          <InlineInput
            key={index}
            label={lineLabel('from', index)}
            value={line}
            onFocus={edits.beginEdit}
            onChange={(value) => edits.updateLine('from', index, value)}
            className="mb-0.5 text-[11.5px] text-[#6b6b76]"
          />
        ))}
      </Region>
      <Region section="customer" selected={section} onSelect={onSelect}>
        <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.invoiceTo', 'Invoice to')}</div>
        <InlineInput
          label={t('invoices:canvas.customerName', 'Customer name')}
          value={body.customerName}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.set('customerName', value)}
          className="mb-[3px] text-[14px] font-bold"
        />
        {body.customer.map((line, index) => (
          <InlineInput
            key={index}
            label={lineLabel('customer', index)}
            value={line}
            onFocus={edits.beginEdit}
            onChange={(value) => edits.updateLine('customer', index, value)}
            className="mb-0.5 text-[12px] text-[#6b6b76]"
          />
        ))}
      </Region>
    </div>
  );
}

export function ShippingBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <Region section="shipto" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.shipTo', 'Ship to')}</div>
      <InlineInput
        label={t('invoices:canvas.shipName', 'Shipping name')}
        value={body.shipName}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.set('shipName', value)}
        className="mb-[3px] text-[14px] font-bold"
      />
      {body.ship.map((line, index) => (
        <InlineInput
          key={index}
          label={lineLabel('ship', index)}
          value={line}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.updateLine('ship', index, value)}
          className="mb-0.5 text-[12px] text-[#6b6b76]"
        />
      ))}
    </Region>
  );
}

export function MetaBlock({ body, edits, section, onSelect }: BlockProps) {
  const cell = 'text-[12.5px] font-bold';
  return (
    <Region section="meta" selected={section} onSelect={onSelect}>
      <div className="grid grid-cols-4 gap-3.5">
        <div>
          <div className={`${KICKER} mb-[5px]`}>{t('invoices:canvas.issued', 'Issued')}</div>
          <InlineInput label={t('invoices:canvas.issued', 'Issued')} value={body.issued} onFocus={edits.beginEdit} onChange={(value) => edits.set('issued', value)} className={cell} mono />
        </div>
        <div>
          <div className={`${KICKER} mb-[5px]`}>{t('invoices:canvas.due', 'Due')}</div>
          <InlineInput label={t('invoices:canvas.due', 'Due')} value={body.due} onFocus={edits.beginEdit} onChange={(value) => edits.set('due', value)} className={cell} mono />
        </div>
        <div>
          <div className={`${KICKER} mb-[5px]`}>{t('invoices:canvas.terms', 'Terms')}</div>
          <InlineInput label={t('invoices:canvas.terms', 'Terms')} value={body.terms} onFocus={edits.beginEdit} onChange={(value) => edits.set('terms', value)} className={cell} />
        </div>
        <div>
          <div className={`${KICKER} mb-[5px]`}>{t('invoices:canvas.poNumber', 'PO number')}</div>
          <InlineInput label={t('invoices:canvas.poNumber', 'PO number')} value={body.poNumber} onFocus={edits.beginEdit} onChange={(value) => edits.set('poNumber', value)} className={cell} mono />
        </div>
      </div>
    </Region>
  );
}
