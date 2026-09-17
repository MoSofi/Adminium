// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The document header on the sheet (comp 292-298, `headerSel` 689;
 * C2): three borderless inputs — the kicker (11 px / 700, uppercase.06em, in
 * the document's accent), the report title (26 px / 800, −.02em) and the
 * subtitle (13 px muted) — under an 18 px-padded hairline. Clicking anywhere
 * selects `header` and draws a 1.5 px accent outline at 6 px offset.
 *
 * The kicker is UPPERCASED by CSS and stored as typed (the comp's own rule):
 * `text-transform` never reaches the value.
 *
 * A11Y: the region is a labelled group with a visually-hidden select button,
 * so a keyboard can point the inspector at the header without a mouse — and
 * each of the three inputs carries its own accessible name (34's addition).
 */
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { ReportBody } from '../../model/envelope.js';
import type { Selection } from '../../model/ops.js';
import { InlineInput, SHEET_MUTED } from './inline.js';

export interface HeaderRegionProps {
  body: ReportBody;
  edits: DocumentEdits;
  selection: Selection;
}

export function HeaderRegion({ body, edits, selection }: HeaderRegionProps) {
  const selected = selection === 'header';
  return (
    <div
      role="group"
      aria-label={t('reportBuilder:inspector.header.title', 'Report header')}
      data-testid="report-header-region"
      data-selected={selected ? '' : undefined}
      onClick={() => edits.select('header')}
      className={cn(
        'relative cursor-pointer rounded-[10px] outline outline-[1.5px] outline-offset-[6px] outline-transparent transition-[outline-color] duration-150',
        'hover:outline-[color:color-mix(in_srgb,var(--adm-report-accent)_50%,transparent)]',
        selected && 'outline-[color:var(--adm-report-accent)] hover:outline-[color:var(--adm-report-accent)]',
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          edits.select('header');
        }}
        className="sr-only start-0 top-0 z-[2] focus:not-sr-only focus:absolute focus:rounded-md focus:bg-white focus:px-2 focus:py-0.5 focus:text-[10.5px] focus:font-bold focus:text-[var(--adm-report-accent)] focus:shadow-[0_0_0_2px_var(--adm-report-accent)] focus:outline-none"
      >
        {t('reportBuilder:canvas.selectHeader', 'Edit report header')}
      </button>
      <div className="mb-5 border-b border-[#ececef] pb-[18px]">
        <InlineInput
          label={t('reportBuilder:canvas.kicker', 'Kicker')}
          data-testid="report-kicker"
          value={body.kicker}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.setHeader('kicker', value)}
          className="text-[11px] font-bold uppercase tracking-[.06em] text-[var(--adm-report-accent)]"
        />
        <InlineInput
          label={t('reportBuilder:canvas.title', 'Report title')}
          data-testid="report-title"
          value={body.reportTitle}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.setHeader('reportTitle', value)}
          className="mt-[5px] text-[26px] font-extrabold tracking-[-.02em]"
        />
        <InlineInput
          label={t('reportBuilder:canvas.subtitle', 'Subtitle')}
          data-testid="report-subtitle"
          value={body.subtitle}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.setHeader('subtitle', value)}
          className={cn('mt-[5px] text-[13px]', SHEET_MUTED)}
        />
      </div>
    </div>
  );
}
