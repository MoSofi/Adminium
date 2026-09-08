// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Images panel (comp 732-750; `imgSlot` 1567-1575, `imgSlots` 1658): the
 * five fixed slots — a 54 px thumb or a dashed slot that IS a file input —
 * with Upload/Replace and Remove, then the dashed *Add an image section*
 * that opens the Add-section modal in append mode.
 */
import { ImagePlus } from 'lucide-react';

import { t } from '../../../../i18n/t.js';
import { invoiceIcon } from '../../../icons.js';
import { IMAGE_FIELDS, type ImageField } from '../../../model/envelope.js';
import { DashedButton, FileLabel } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { uploadFromInput } from '../upload.js';

function slotText(field: ImageField): { label: string; hint: string; icon: string } {
  switch (field) {
    case 'logoImage':
      return { label: t('invoices:inspector.images.logo', 'Logo'), hint: t('invoices:inspector.images.logoHint', 'Replaces the logo mark'), icon: 'hexagon' };
    case 'bgImage':
      return { label: t('invoices:inspector.images.background', 'Background'), hint: t('invoices:inspector.images.backgroundHint', 'Watermark behind the invoice'), icon: 'image' };
    case 'qrImage':
      return { label: t('invoices:inspector.images.qr', 'QR code'), hint: t('invoices:inspector.images.qrHint', 'Shown in the payment QR block'), icon: 'qr-code' };
    case 'sigImage':
      return { label: t('invoices:inspector.images.signature', 'Signature'), hint: t('invoices:inspector.images.signatureHint', 'Scanned signature image'), icon: 'pen-line' };
    case 'stampImage':
      return { label: t('invoices:inspector.images.stamp', 'Stamp / seal'), hint: t('invoices:inspector.images.stampHint', 'Paid or approval stamp'), icon: 'stamp' };
  }
}

const SMALL_BUTTON = 'rounded-lg border border-border bg-surface px-[10px] py-[6px] text-[11px] font-bold';

export function ImagesPanel({ draft, edits, onOpenAdd, onImageRejected }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11.5px] leading-[1.55] text-fg-muted">
        {t('invoices:inspector.images.intro', 'Fixed images that travel with the invoice. Upload once and every document built from this template keeps them.')}
      </div>
      {IMAGE_FIELDS.map((field) => {
        const { label, hint, icon } = slotText(field);
        const Glyph = invoiceIcon(icon);
        const url = body[field];
        const upload = (event: Parameters<typeof uploadFromInput>[0]) => uploadFromInput(event, (dataUrl) => edits.setImage(field, dataUrl), onImageRejected);
        return (
          <div key={field} data-testid="invoices-image-slot" data-field={field} data-filled={url !== ''} className="flex items-center gap-[11px] rounded-xl border border-border bg-surface-2 p-[11px]">
            {url === '' ? (
              <FileLabel
                onFile={upload}
                ariaLabel={t('invoices:inspector.images.uploadSlot', 'Upload {label}', { label })}
                className="flex size-[54px] shrink-0 items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-border-strong bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_8px,var(--surface-3)_8px_16px)] text-fg-subtle"
              >
                <Glyph className="size-[17px]" aria-hidden="true" />
              </FileLabel>
            ) : (
              <img src={url} alt="" className="size-[54px] shrink-0 rounded-[10px] border border-border object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-extrabold text-fg">{label}</div>
              <div className="mb-[7px] text-[10.5px] leading-[1.45] text-fg-subtle">{hint}</div>
              <div className="flex flex-wrap gap-[6px]">
                <FileLabel onFile={upload} className={`${SMALL_BUTTON} text-fg-muted hover:border-border-strong`}>
                  {url === '' ? t('invoices:inspector.images.upload', 'Upload') : t('invoices:inspector.images.replace', 'Replace')}
                </FileLabel>
                {url === '' ? null : (
                  <button type="button" data-testid="invoices-image-remove" onClick={() => edits.setImage(field, '')} className={`${SMALL_BUTTON} text-danger transition-colors hover:border-border-strong`}>
                    {t('invoices:inspector.images.remove', 'Remove')}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <DashedButton onClick={onOpenAdd} testId="invoices-images-add-section" className="gap-[7px] rounded-[10px] p-[10px] text-[12px]">
        <ImagePlus className="size-3.5" aria-hidden="true" />
        {t('invoices:inspector.images.addSection', 'Add an image section')}
      </DashedButton>
    </div>
  );
}
