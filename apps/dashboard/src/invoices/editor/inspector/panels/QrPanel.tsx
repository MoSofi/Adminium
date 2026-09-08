// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Payment QR panel (comp 918-924): the centred white tile — the comp's
 * 92 px qr-code glyph, or the uploaded `qrImage` — the caption, the info hint
 * and *Remove section* (`qrShow`).
 *
 * THE HINT IS NOT THE COMP'S (34 D21 as amended 2026-09-07): comp:922
 * promises a payment provider that renders the live code on send. Neither
 * exists and the first is forbidden (17 §2), so the copy says what is true —
 * the code shown is the image uploaded under Images.
 */
import { Info, QrCode } from 'lucide-react';

import { t } from '../../../../i18n/t.js';
import { formatMoney } from '../../../model/money.js';
import { Hint, RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function QrPanel({ draft, edits, totals, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex justify-center py-[6px]">
        {body.qrImage === '' ? (
          <div data-testid="invoices-qr-tile" className="flex size-[120px] items-center justify-center rounded-[14px] border border-[#e2e2e8] bg-[#ffffff]">
            <QrCode className="size-[92px] text-[#111111]" aria-hidden="true" />
          </div>
        ) : (
          <img data-testid="invoices-qr-tile" src={body.qrImage} alt="" className="size-[120px] rounded-[14px] border border-[#e2e2e8] bg-[#ffffff] object-cover" />
        )}
      </div>
      <TextField label={t('invoices:inspector.qr.caption', 'Caption')} value={body.qrCaption} onFocus={edits.beginEdit} onChange={(value) => edits.set('qrCaption', value)} className="text-[12.5px]" testId="invoices-qr-caption" />
      <Hint icon={Info} testId="invoices-qr-hint">
        {t('invoices:inspector.qr.hint', 'Encodes Amount due · {total}. The code shown is the image you upload under Images.', { total: formatMoney(totals.total, body.currency, body.cents) })}
      </Hint>
      <RemoveSectionButton flag="qrShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
