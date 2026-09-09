// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The image block's field group (comp 381 as *Placeholder caption*, plus
 * 43 D26/O4's fill).
 *
 * THE FILL, AND WHY IT IS ONE. The comp draws the image block as a dashed
 * striped placeholder with a mono caption (321) and offers no upload anywhere
 * for it — while the SAME comp draws Upload / Replace / Remove for the
 * document background (360-367). This group takes that pattern verbatim: with
 * a picture, a 46 × 34 thumb, *Replace* (a file label) and *Remove* (danger
 * text); without one, a dashed *Upload image* label. The caps are 34 D44's,
 * shared with the background (`readImageFile`), and the refusal is the
 * editor's toast.
 */
import { t } from '../../../../i18n/t.js';
import { reportIcon } from '../../../icons.js';
import { pickImage, type ImageRejection } from '../../canvas/inline.js';
import { DASHED, FileLabel, PanelLabel, TextField } from '../parts.js';
import type { FieldsProps } from './types.js';

export interface ImageFieldsProps extends FieldsProps<'image'> {
  onImageRejected: (result: ImageRejection) => void;
}

export function ImageFields({ block, edits, onImageRejected }: ImageFieldsProps) {
  const UploadGlyph = reportIcon('upload');
  const set = (url: string) => edits.histPatchBlock(block.id, { url });
  return (
    <div className="flex flex-col gap-4">
      <TextField
        // The comp's label for this block's text field (645).
        label={t('reportBuilder:inspector.placeholderCaption', 'Placeholder caption')}
        testId="report-field-text"
        value={block.text}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { text: value })}
      />
      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.blockImage', 'Image')}</PanelLabel>
        {block.url === '' ? (
          <FileLabel
            className={`${DASHED} h-[46px] gap-2`}
            ariaLabel={t('reportBuilder:inspector.blockImageUpload', 'Upload image')}
            testId="report-block-image-upload"
            onFile={(event) => void pickImage(event, set, onImageRejected)}
          >
            <UploadGlyph className="size-3.5" aria-hidden="true" />
            {t('reportBuilder:inspector.blockImageUpload', 'Upload image')}
          </FileLabel>
        ) : (
          <div className="flex items-center gap-2.5">
            {/* A data URL cannot be a class; `src` is the one place it can go. */}
            <img src={block.url} alt="" className="h-[34px] w-[46px] shrink-0 rounded-[7px] border border-border object-cover" />
            <FileLabel
              className="rounded-[9px] border border-border bg-surface-2 px-3 py-[7px] text-[11.5px] font-bold text-fg-muted hover:border-border-strong"
              ariaLabel={t('reportBuilder:inspector.backgroundReplace', 'Replace')}
              testId="report-block-image-replace"
              onFile={(event) => void pickImage(event, set, onImageRejected)}
            >
              {t('reportBuilder:inspector.backgroundReplace', 'Replace')}
            </FileLabel>
            <button
              type="button"
              data-testid="report-block-image-remove"
              onClick={() => set('')}
              className="rounded-[9px] px-2 py-[7px] text-[11.5px] font-bold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('reportBuilder:inspector.backgroundRemove', 'Remove')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
