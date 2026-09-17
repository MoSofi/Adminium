// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block panel (comp 377-428; I5–I9): *Block title*, the kind's field
 * group, a hairline, the Width segment (Full / Half), the *Show in
 * export* toggle and *Delete block*.
 *
 * *SHOW IN EXPORT* IS STORED AND HONOURED ON THE CANVAS, and nothing else
 * consumes it yet: this comp draws no export, print or download of a
 * report. Off dims the card to 50 % (616) — it never removes the block and
 * never re-orders the stack.
 */
import { useId } from 'react';

import { t } from '../../../i18n/t.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { ReportBlock } from '../../model/envelope.js';
import { reportIcon } from '../../icons.js';
import type { ImageRejection } from '../canvas/inline.js';
import { BlockFields } from './fields/index.js';
import { Divider, Note, PanelLabel, TextField, Toggle } from './parts.js';

export interface BlockPanelProps {
  block: ReportBlock;
  edits: DocumentEdits;
  onImageRejected: (result: ImageRejection) => void;
}

/** The comp's Width segment (424, `widthBtn` 642): a surface pill with a shadow on the active half. */
function WidthSegment({ block, edits }: { block: ReportBlock; edits: DocumentEdits }) {
  const labelId = useId();
  const option = (value: 'full' | 'half', label: string) => (
    <button
      type="button"
      aria-pressed={block.w === value}
      data-testid="report-width-option"
      data-value={value}
      onClick={() => edits.histPatchBlock(block.id, { w: value })}
      className={
        block.w === value
          ? 'flex-1 rounded-md border-0 bg-surface p-1.5 text-[11.5px] font-bold text-fg shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
          : 'flex-1 rounded-md border-0 bg-transparent p-1.5 text-[11.5px] font-bold text-fg-subtle transition-colors hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
      }
    >
      {label}
    </button>
  );
  return (
    <div>
      <PanelLabel id={labelId} className="mb-2">
        {t('reportBuilder:inspector.width', 'Width')}
      </PanelLabel>
      <div role="group" aria-labelledby={labelId} className="flex gap-0.5 rounded-lg border border-border bg-surface-2 p-[3px]">
        {option('full', t('reportBuilder:inspector.widthFull', 'Full'))}
        {option('half', t('reportBuilder:inspector.widthHalf', 'Half'))}
      </div>
    </div>
  );
}

export function BlockPanel({ block, edits, onImageRejected }: BlockPanelProps) {
  const showId = useId();
  const TrashGlyph = reportIcon('trash-2');
  return (
    <div data-testid="report-block-panel" data-kind={block.kind} className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.blockTitle', 'Block title')}
        testId="report-panel-block-title"
        value={block.title}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { title: value })}
      />

      <BlockFields block={block} edits={edits} onImageRejected={onImageRejected} />

      <Divider />

      <WidthSegment block={block} edits={edits} />

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div id={showId} className="text-[12.5px] font-bold text-fg">
            {t('reportBuilder:inspector.show', 'Show in export')}
          </div>
          <Note className="mt-0.5">{t('reportBuilder:inspector.showHint', 'Include when publishing')}</Note>
        </div>
        <Toggle on={block.show} labelledBy={showId} testId="report-show-toggle" onClick={() => edits.histPatchBlock(block.id, { show: !block.show })} />
      </div>

      <button
        type="button"
        data-testid="report-delete-block"
        onClick={() => edits.deleteBlock(block.id)}
        className="flex items-center justify-center gap-1.5 rounded-[9px] border border-danger bg-transparent p-[9px] text-[11.5px] font-bold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <TrashGlyph className="size-3.5" aria-hidden="true" />
        {t('reportBuilder:inspector.deleteBlock', 'Delete block')}
      </button>
    </div>
  );
}
