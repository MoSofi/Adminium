// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector (comp 349-428; 43-report-builder.md Appendix A I1–I4, D18):
 * a 288 px right aside under the accent-soft banner, holding the header
 * panel, one of the 25 block field groups, or the *Nothing selected* fallback.
 *
 * BELOW `lg` IT IS A DRAWER under the canvas (D18, 34 §E11's fill): the comp
 * draws no responsive rule at all (E11), and two aside columns beside a 760 px
 * sheet cannot fit a 390 px viewport. Both instances mount at once below `lg`
 * (one hidden by `lg:hidden`, one by `hidden lg:flex`), so an e2e or axe pass
 * that reaches for a panel test id finds it TWICE — scope to the aside or the
 * drawer, never a bare `getByTestId` (43 §0.3 trap 9).
 *
 * THE BANNER'S HINT IS AT FULL ACCENT (34 DEP-29): the comp draws it at
 * `opacity: .75` on the accent-soft wash (351), which measures 3.3:1 and
 * fails WCAG AA. Same colour, no opacity.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { BLOCK_KIND_META } from '../../model/blocks.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { ReportBody, ReportStatus } from '../../model/envelope.js';
import { blockAt, type Selection } from '../../model/ops.js';
import { reportIcon } from '../../icons.js';
import type { ImageRejection } from '../canvas/inline.js';
import { blockLabel } from '../blockText.js';
import { BlockPanel } from './BlockPanel.js';
import { HeaderPanel } from './HeaderPanel.js';

export interface InspectorProps {
  body: ReportBody;
  status: ReportStatus;
  selection: Selection;
  edits: DocumentEdits;
  onImageRejected: (result: ImageRejection) => void;
  /** `drawer` is the below-`lg` instance under the canvas (D18). */
  variant?: 'aside' | 'drawer' | undefined;
}

/** The comp's `insHeadMeta` (632). */
function banner(selection: Selection, body: ReportBody): { glyph: string; title: string; hint: string } {
  if (selection === 'header') {
    return {
      glyph: 'file-text',
      title: t('reportBuilder:inspector.header.title', 'Report header'),
      hint: t('reportBuilder:inspector.header.hint', 'Title, kicker & theme'),
    };
  }
  const block = blockAt(body, selection);
  if (block === null) {
    return { glyph: 'mouse-pointer-click', title: t('reportBuilder:inspector.none.title', 'Nothing selected'), hint: '' };
  }
  return { glyph: BLOCK_KIND_META[block.kind].icon, title: blockLabel(block.kind), hint: t('reportBuilder:inspector.block.hint', 'Block content & settings') };
}

/** 373-375: reachable only when the selection is neither the header nor a live block (a deleted block's id, 538). */
function NonePanel() {
  const Glyph = reportIcon('mouse-pointer-click');
  return (
    <div data-testid="report-none-panel" className="flex flex-col items-center px-2 py-8 text-center">
      <Glyph className="size-7 text-fg-subtle" aria-hidden="true" />
      <div className="mt-3 text-[13px] font-extrabold text-fg">{t('reportBuilder:inspector.none.select', 'Select a block')}</div>
      <div className="mt-1.5 max-w-[220px] text-[11.5px] leading-[1.5] text-fg-muted">
        {t('reportBuilder:inspector.none.body', 'Click any block on the canvas to edit its content and settings here.')}
      </div>
    </div>
  );
}

export function Inspector({ body, status, selection, edits, onImageRejected, variant = 'aside' }: InspectorProps) {
  const head = banner(selection, body);
  const Glyph = reportIcon(head.glyph);
  const block = selection === 'header' ? null : blockAt(body, selection);

  return (
    <aside
      data-testid="report-inspector"
      data-variant={variant}
      aria-label={t('reportBuilder:inspector.header.title', 'Report header')}
      className={cn(
        variant === 'aside'
          ? // The COLUMN paints the comp's full-height surface and border-left
            // (353); the panel inside it is what sticks and scrolls. Painting
            // them on the sticky box instead left the sidebar ending mid-page
            // — the comp's aside is a stretched flex child and runs the whole
            // height of the editor.
            'hidden w-72 shrink-0 self-stretch border-s border-border bg-surface lg:block'
          : 'flex flex-col rounded-2xl border border-border bg-surface px-4 pb-6 pt-[18px] lg:hidden',
      )}
    >
      <div
        className={cn(
          variant === 'aside' &&
            'sticky top-[calc(var(--adm-topbar-h,0px)+var(--adm-editor-header-h,0px))] flex max-h-[calc(100vh-var(--adm-topbar-h,0px)-var(--adm-editor-header-h,0px))] flex-col overflow-y-auto overflow-x-hidden px-4 pb-10 pt-[18px]',
        )}
      >
      <div className="mb-[18px] flex items-center gap-2.5 rounded-xl bg-accent-soft px-[13px] py-[11px]">
        <Glyph className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <div data-testid="report-inspector-title" className="text-[13px] font-extrabold text-accent">
            {head.title}
          </div>
          {/* 34 DEP-29: the comp's `opacity: .75` here is 3.3:1 on the wash. */}
          {head.hint === '' ? null : <div className="text-[10.5px] text-accent">{head.hint}</div>}
        </div>
      </div>

      {selection === 'header' ? (
        <HeaderPanel body={body} status={status} edits={edits} onImageRejected={onImageRejected} />
      ) : block === null ? (
        <NonePanel />
      ) : (
        <BlockPanel block={block} edits={edits} onImageRejected={onImageRejected} />
      )}
      </div>
    </aside>
  );
}
