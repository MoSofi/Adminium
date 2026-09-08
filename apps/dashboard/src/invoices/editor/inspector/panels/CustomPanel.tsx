// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The custom section's panel (comp 753-770; bindings 1668-1678): the title
 * for every type; a body textarea (text), an upload + caption + height range
 * (image), *Add row* (kv), the slot hint (gallery); then the danger *Remove
 * section* (`delCustom`, 1317-1323) that also falls back to the items panel.
 */
import { Plus, Trash2, Upload } from 'lucide-react';

import { t } from '../../../../i18n/t.js';
import type { CustomSection } from '../../../model/envelope.js';
import { DASHED, DashedButton, FOCUS, FileLabel, PanelLabel, RangeInput, TextAreaField, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { uploadFromInput } from '../upload.js';
import { cn } from '@adminium/ui';

export function CustomPanel({ section, edits, onSelect, onImageRejected }: PanelProps & { section: CustomSection }) {
  const id = section.id;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.custom.title', 'Section title')} value={section.title} onFocus={edits.beginEdit} onChange={(title) => edits.updateCustom(id, { title })} className="font-bold" testId="invoices-custom-title" />
      {section.type === 'text' ? (
        <TextAreaField label={t('invoices:inspector.custom.body', 'Body copy')} rows={6} value={section.body} onFocus={edits.beginEdit} onChange={(body) => edits.updateCustom(id, { body })} className="py-[9px]" testId="invoices-custom-body" />
      ) : null}
      {section.type === 'image' ? (
        <>
          <div>
            <PanelLabel>{t('invoices:inspector.custom.image', 'Image')}</PanelLabel>
            <FileLabel
              onFile={(event) => uploadFromInput(event, (url) => edits.histUpdateCustom(id, { url }), onImageRejected)}
              className={cn(DASHED, 'gap-[7px] rounded-[10px] bg-surface-2 p-[10px] text-[12px]')}
            >
              <Upload className="size-3.5" aria-hidden="true" />
              {t('invoices:inspector.custom.upload', 'Upload / replace')}
            </FileLabel>
          </div>
          <TextField label={t('invoices:inspector.custom.caption', 'Caption')} value={section.caption} onFocus={edits.beginEdit} onChange={(caption) => edits.updateCustom(id, { caption })} className="text-[12.5px]" testId="invoices-custom-caption" />
          <div className="flex items-center gap-[9px]">
            <span className="whitespace-nowrap text-[11px] text-fg-subtle" aria-hidden="true">
              {t('invoices:inspector.custom.height', 'Height')}
            </span>
            <RangeInput value={section.height} min={110} max={380} ariaLabel={t('invoices:inspector.custom.height', 'Height')} onBegin={edits.beginEdit} onChange={(height) => edits.updateCustom(id, { height })} testId="invoices-custom-height" />
          </div>
        </>
      ) : null}
      {section.type === 'kv' ? (
        <DashedButton onClick={() => edits.addCustomRow(id)} testId="invoices-rows-add" className="rounded-[10px] p-[9px] text-[12px]">
          <Plus className="size-3.5" aria-hidden="true" />
          {t('invoices:inspector.custom.addRow', 'Add row')}
        </DashedButton>
      ) : null}
      {section.type === 'gallery' ? <div className="text-[11.5px] leading-[1.55] text-fg-muted">{t('invoices:inspector.custom.galleryHint', 'Click each slot on the invoice to upload an image.')}</div> : null}
      <button
        type="button"
        data-testid="invoices-remove-custom"
        onClick={() => {
          edits.removeCustom(id);
          onSelect('items');
        }}
        className={cn('flex items-center justify-center gap-[7px] rounded-[10px] border border-border bg-surface p-[9px] text-[12px] font-bold text-danger transition-colors hover:border-border-strong', FOCUS)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t('invoices:inspector.custom.remove', 'Remove section')}
      </button>
    </div>
  );
}
