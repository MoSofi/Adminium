// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The user-authored section (comp 669-718; bindings 1509-1548; 34-invoices-
 * add-on.md Appendix F B24-B27): one selectable region whose header is the
 * title input in kicker style beside a 26 px *Remove section* button, then
 * the type's body — `text`: a three-row textarea; `image`: the picture at its
 * own height with a dark clear button, or the hatched *Click to upload an
 * image* drop, then the caption; `gallery`: a grid of N slots, each a
 * picture with a clear button or a hatched drop; `kv`: a bordered table of
 * label / value inputs with a per-row remove, then *Add row*.
 *
 * TEMPOS ARE THE COMP'S (1514-1546): the title, body, caption and cells are
 * keystrokes (`updateCustom`, `updateCustomRow`); an upload, a clear, a row
 * added or removed and the section's removal are history steps
 * (`histUpdateCustom`, `updateCustomImage`, `addCustomRow`, `removeCustomRow`,
 * `removeCustom`). The image height and the slot count are data, so they
 * ride custom properties (`adminium/no-style-prop`'s one escape hatch).
 *
 * A11y, invisible at rest: every file input is named by its wrapping label
 * (the comp's is bare), every clear and remove button carries the comp's
 * `title` as its accessible name too.
 */
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { customKeyOf } from '../../../model/blocks.js';
import type { CustomSection } from '../../../model/envelope.js';
import { CELL, DROP_LABEL, EditOnly, InlineInput, InlineTextarea, KICKER, Region, pickImage } from '../inline.js';
import type { BlockProps } from './types.js';

export interface CustomBlockProps extends BlockProps {
  custom: CustomSection;
}

/** The comp's dark clear button over a picture (682, 696): `rgba(10,10,16,.62)` on white. */
const CLEAR = 'nb-ib absolute flex items-center justify-center border-0 bg-[rgba(10,10,16,.62)] text-white';

export function CustomBlock({ custom, edits, section, onSelect, onRemoveCustom, onImageRejected }: CustomBlockProps) {
  const key = customKeyOf(custom.id);
  const id = custom.id;
  const title = custom.title.trim() === '' ? t('invoices:section.custom.title', 'Custom section') : custom.title;
  return (
    <Region section={key} selected={section} onSelect={onSelect} label={title}>
      <div className="mb-2.5 flex items-center gap-2">
        <InlineInput
          label={t('invoices:canvas.custom.titleLabel', 'Section title')}
          value={custom.title}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.updateCustom(id, { title: value })}
          className={cn(KICKER, 'flex-1')}
          data-testid="invoices-canvas-custom-title"
        />
        <EditOnly>
          <button
            type="button"
            title={t('invoices:canvas.custom.remove', 'Remove section')}
            aria-label={t('invoices:canvas.custom.removeOf', 'Remove section: {title}', { title })}
            data-testid="invoices-canvas-custom-remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveCustom(id);
            }}
            className="nb-ib flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[#ececef] bg-white text-[#6b6b76]"
          >
            <Trash2 className="size-[13px]" aria-hidden="true" />
          </button>
        </EditOnly>
      </div>

      {custom.type === 'text' ? (
        <InlineTextarea
          label={t('invoices:canvas.custom.body', 'Section body')}
          value={custom.body}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.updateCustom(id, { body: value })}
          className="text-[12.5px] leading-[1.65] text-[#6b6b76]"
          data-testid="invoices-canvas-custom-body"
        />
      ) : null}

      {custom.type === 'image' ? (
        <>
          {custom.url === '' ? (
            <EditOnly>
              <label
                onClick={(event) => event.stopPropagation()}
                style={{ '--adm-invoice-image-h': `${String(custom.height)}px` }}
                className={cn(DROP_LABEL, 'h-[var(--adm-invoice-image-h)] flex-col gap-[7px] p-3 text-center text-[11.5px] font-bold')}
              >
                <ImagePlus className="size-5" aria-hidden="true" />
                {t('invoices:canvas.custom.upload', 'Click to upload an image')}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  data-testid="invoices-custom-upload"
                  onChange={(event) => void pickImage(event, (url) => edits.histUpdateCustom(id, { url }), onImageRejected)}
                />
              </label>
            </EditOnly>
          ) : (
            <div className="relative">
              <img
                src={custom.url}
                alt=""
                data-testid="invoices-custom-image"
                style={{ '--adm-invoice-image-h': `${String(custom.height)}px` }}
                className="h-[var(--adm-invoice-image-h)] w-full rounded-xl border border-[#ececef] object-cover"
              />
              <EditOnly>
                <button
                  type="button"
                  title={t('invoices:canvas.custom.clearImage', 'Remove image')}
                  aria-label={t('invoices:canvas.custom.clearImage', 'Remove image')}
                  onClick={(event) => {
                    event.stopPropagation();
                    edits.histUpdateCustom(id, { url: '' });
                  }}
                  className={cn(CLEAR, 'end-[9px] top-[9px] size-7 rounded-lg')}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </EditOnly>
            </div>
          )}
          <InlineInput
            label={t('invoices:canvas.custom.caption', 'Caption')}
            value={custom.caption}
            onFocus={edits.beginEdit}
            onChange={(value) => edits.updateCustom(id, { caption: value })}
            className="mt-2 text-[11.5px] text-[#6b6b76]"
          />
        </>
      ) : null}

      {custom.type === 'gallery' ? (
        <div
          style={{ '--adm-invoice-gallery-n': String(custom.images.length === 0 ? 3 : custom.images.length) }}
          className="grid grid-cols-[repeat(var(--adm-invoice-gallery-n),minmax(0,1fr))] gap-2.5"
        >
          {custom.images.map((image, index) => (
            <div key={image.id} className="relative" data-testid="invoices-gallery-slot" data-filled={image.url === '' ? undefined : ''}>
              {image.url === '' ? (
                <EditOnly>
                  <label onClick={(event) => event.stopPropagation()} className={cn(DROP_LABEL, 'h-28 rounded-[10px]')}>
                    <ImagePlus className="size-[18px]" aria-hidden="true" />
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      aria-label={t('invoices:canvas.custom.uploadSlot', 'Upload image {n}', { n: index + 1 })}
                      onChange={(event) => void pickImage(event, (url) => edits.updateCustomImage(id, image.id, url), onImageRejected)}
                    />
                  </label>
                </EditOnly>
              ) : (
                <>
                  <img src={image.url} alt="" className="h-28 w-full rounded-[10px] border border-[#ececef] object-cover" />
                  <EditOnly>
                    <button
                      type="button"
                      title={t('invoices:canvas.custom.clearSlot', 'Remove')}
                      aria-label={t('invoices:canvas.custom.clearSlotOf', 'Remove image {n}', { n: index + 1 })}
                      onClick={(event) => {
                        event.stopPropagation();
                        edits.updateCustomImage(id, image.id, '');
                      }}
                      className={cn(CLEAR, 'end-1.5 top-1.5 size-6 rounded-[7px]')}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </EditOnly>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {custom.type === 'kv' ? (
        <>
          <div className="overflow-hidden rounded-[11px] border border-[#ececef]">
            {custom.rows.map((row, index) => (
              <div key={index} data-testid="invoices-kv-row" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2.5 border-b border-[#ececef] px-[13px] py-2 last:border-b-0">
                <InlineInput
                  label={t('invoices:canvas.custom.rowLabel', 'Label of row {n}', { n: index + 1 })}
                  value={row.k}
                  onFocus={edits.beginEdit}
                  onChange={(value) => edits.updateCustomRow(id, index, 'k', value)}
                  className="text-[12px] font-bold text-[#6b6b76]"
                />
                <InlineInput
                  label={t('invoices:canvas.custom.rowValue', 'Value of row {n}', { n: index + 1 })}
                  value={row.v}
                  onFocus={edits.beginEdit}
                  onChange={(value) => edits.updateCustomRow(id, index, 'v', value)}
                  className="text-[12px] text-[#191920]"
                />
                <EditOnly placeholder={CELL}>
                  <button
                    type="button"
                    title={t('invoices:canvas.custom.removeRow', 'Remove row')}
                    aria-label={t('invoices:canvas.custom.removeRowOf', 'Remove row {n}', { n: index + 1 })}
                    onClick={(event) => {
                      event.stopPropagation();
                      edits.removeCustomRow(id, index);
                    }}
                    className="nb-ib flex size-[26px] cursor-pointer items-center justify-center rounded-[7px] border border-[#ececef] bg-white text-[#6b6b76]"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </EditOnly>
              </div>
            ))}
          </div>
          <EditOnly>
            <button
              type="button"
              data-testid="invoices-kv-add"
              onClick={(event) => {
                event.stopPropagation();
                edits.addCustomRow(id);
              }}
              className="nb-ib mt-2 flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-dashed border-[#e2e2e8] bg-transparent px-[11px] py-[7px] text-[11.5px] font-bold text-[#6b6b76]"
            >
              <Plus className="size-[13px]" aria-hidden="true" />
              {t('invoices:canvas.custom.addRow', 'Add row')}
            </button>
          </EditOnly>
        </>
      ) : null}
    </Region>
  );
}
