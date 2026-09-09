// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two picture blocks (comp 321, 327): the image placeholder and the
 * payment QR.
 *
 * THE IMAGE BLOCK TAKES AN IMAGE (43 D26/O4). The comp draws a dashed striped
 * placeholder with a mono caption and offers no upload anywhere for it, while
 * the SAME comp draws Upload / Replace / Remove for the document background
 * (360-367). The fill uses that pattern: with a picture the block draws it
 * `object-cover` at the placeholder's 150 px height with the caption beneath;
 * without one the comp's placeholder stays, unchanged.
 *
 * THE QR BLOCK ENCODES NOTHING (43 §5 item 2). The comp draws a `qr-code`
 * glyph in a white tile plus two lines of text, and the second line promises a
 * live version no route serves. It ships verbatim and is flagged in Appendix
 * E so the owner can strike it in one edit; no encoder is added.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { reportIcon } from '../../../icons.js';
import { SHEET_MUTED, SHEET_SUBTLE } from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** 321 + D26. */
export function ImageBlock({ block }: BlockBodyProps<'image'>) {
  const Glyph = reportIcon('image');
  if (block.url !== '') {
    return (
      <figure data-testid="report-block-image" className="m-0">
        {/* A data URL cannot be a class; `src` is the one place it can go. */}
        <img src={block.url} alt={block.text} className="h-[150px] w-full rounded-[11px] border border-[#ececef] object-cover" />
        {block.text === '' ? null : <figcaption className={cn('mt-2 font-mono text-[11px]', SHEET_SUBTLE)}>{block.text}</figcaption>}
      </figure>
    );
  }
  return (
    <div
      data-testid="report-block-image-placeholder"
      className={cn(
        'flex h-[150px] flex-col items-center justify-center gap-2 rounded-[11px] border-[1.5px] border-dashed border-[#e2e2e8]',
        'bg-[repeating-linear-gradient(45deg,#fafafa_0_10px,#f1f1f4_10px_20px)]',
        SHEET_SUBTLE,
      )}
    >
      <Glyph className="size-6" aria-hidden="true" />
      <span className="font-mono text-[11px]">{block.text}</span>
    </div>
  );
}

/** 327: a 96 px white tile with a 74 px glyph, the caption, and the comp's fixed sentence. */
export function QrBlock({ block }: BlockBodyProps<'qr'>) {
  const Glyph = reportIcon('qr-code');
  return (
    <div data-testid="report-block-qr" className="flex items-center gap-4">
      {/* The comp's own literals on an always-light sheet (34 S5/S6). */}
      <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-[#e2e2e8] bg-white text-[#111111]">
        <Glyph className="size-[74px]" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">{block.qrCaption}</div>
        <div className={cn('mt-1 text-[12px]', SHEET_MUTED)}>{t('reportBuilder:block.qr.hint', 'Point your camera to open the live version.')}</div>
      </div>
    </div>
  );
}
