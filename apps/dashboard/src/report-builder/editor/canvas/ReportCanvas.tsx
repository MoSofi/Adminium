// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The canvas (comp 287-347; C1–C8): the paper, the document header, and
 * the block stack — a wrapping flex row at gap 16 where a `half` block is
 * `calc(50% − 8px)` (303, 613).
 *
 * DRAG STATE LIVES HERE, not in the draft: which index is being dragged and
 * which is being dragged over are UI, and a `dragBlock` in the draft would
 * become an undo step (the comp keeps both in component state too, 443).
 *
 * The empty stack is the comp's dashed box (344). There is no between-block
 * insert chip and no trailing *Add section* button — blocks are appended from
 * the palette only (C8).
 *
 * READ-ONLY draws the same paper with nothing on it to operate: no outlines,
 * no selector buttons, no inline fields, no grips, no head-row actions. It
 * exists so a preview elsewhere in the product is this sheet rather than a
 * second one that would disagree with it the first time either changed. The
 * flag reaches the blocks through a context (`ReadOnlySheet`), not through
 * every block's props, and `edits` and `selection` become optional.
 */
import { useState } from 'react';

import { t } from '../../../i18n/t.js';
import { NO_EDITS, type DocumentEdits } from '../../model/edits.js';
import type { ReportBody } from '../../model/envelope.js';
import type { Selection } from '../../model/ops.js';
import { BlockCard } from './BlockCard.js';
import { HeaderRegion } from './HeaderRegion.js';
import { PaperShell } from './PaperShell.js';
import { ReadOnlySheet } from './inline.js';
import { BlockBody } from './blocks/index.js';

export interface ReportCanvasProps {
  body: ReportBody;
  /** Draw the paper and nothing to operate it with; the two props below are then unused. */
  readOnly?: boolean | undefined;
  edits?: DocumentEdits | undefined;
  selection?: Selection | undefined;
  /** BCP-47, from the viewer's preference (D11). */
  locale: string;
}

export function ReportCanvas({ body, readOnly, edits = NO_EDITS, selection = 'header', locale }: ReportCanvasProps) {
  const [drag, setDrag] = useState<{ dragging: number | null; over: number | null }>({ dragging: null, over: null });
  const sheet = (
    <PaperShell body={body}>
      <HeaderRegion body={body} edits={edits} selection={selection} />
      <div data-testid="report-stack" className="flex flex-wrap items-start gap-4">
        {body.blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            block={block}
            index={index}
            count={body.blocks.length}
            selection={selection}
            edits={edits}
            dragging={drag.dragging}
            over={drag.over}
            onDragState={(state) => setDrag((current) => ({ ...current, ...state }))}
          >
            <BlockBody block={block} edits={edits} locale={locale} />
          </BlockCard>
        ))}
      </div>
      {body.blocks.length === 0 ? (
        <div data-testid="report-stack-empty" className="mt-4 rounded-[13px] border-[1.5px] border-dashed border-[#e2e2e8] p-[26px] text-center text-[#6b6b76]">
          <div className="text-[12.5px] font-semibold">{t('reportBuilder:canvas.empty', 'Add a block from the left to start building.')}</div>
        </div>
      ) : null}
    </PaperShell>
  );
  return readOnly === true ? <ReadOnlySheet>{sheet}</ReadOnlySheet> : sheet;
}
