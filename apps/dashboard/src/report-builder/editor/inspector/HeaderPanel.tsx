// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Report header panel (comp 353-371; I3): Kicker · Report title ·
 * Subtitle, the five accent swatches, the three status options, and the
 * background image — upload, or a 46 × 34 thumb with Replace / Remove and an
 * *Overlay {n}%* range at 0–95.
 *
 * A starter may carry an accent that is NOT one of the five (`health` is
 * `#12805c`, Appendix C): none of the swatches shows as active then, exactly
 * as the comp does.
 */
import { useId } from 'react';

import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { ACCENT_SWATCHES, BG_TINT_MAX, type ReportBody, type ReportStatus } from '../../model/envelope.js';
import type { DocumentEdits } from '../../model/edits.js';
import { statusLabel } from '../../manager/model.js';
import { reportIcon } from '../../icons.js';
import { pickImage, type ImageRejection } from '../canvas/inline.js';
import { DASHED, FileLabel, Note, OptionButton, PanelLabel, RangeInput, Swatch, TextAreaField, TextField } from './parts.js';

export interface HeaderPanelProps {
  body: ReportBody;
  status: ReportStatus;
  edits: DocumentEdits;
  onImageRejected: (result: ImageRejection) => void;
}

/** The comp's three status options in their tones (634; D22). */
const STATUS_OPTIONS: readonly { value: ReportStatus; tone: 'neutral' | 'accent' | 'pos' }[] = [
  { value: 'draft', tone: 'neutral' },
  { value: 'sent', tone: 'accent' },
  { value: 'live', tone: 'pos' },
];

export function HeaderPanel({ body, status, edits, onImageRejected }: HeaderPanelProps) {
  const tintId = useId();
  const UploadGlyph = reportIcon('upload');
  const percent = Math.round(body.bgTint * 100);
  const setBackground = (url: string) => edits.histSetHeader('bgImage', url);

  return (
    <div data-testid="report-header-panel" className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.kicker', 'Kicker')}
        testId="report-panel-kicker"
        value={body.kicker}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.setHeader('kicker', value)}
        className="py-[9px] text-[12.5px] font-bold"
      />
      <TextField
        label={t('reportBuilder:inspector.reportTitle', 'Report title')}
        testId="report-panel-title"
        value={body.reportTitle}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.setHeader('reportTitle', value)}
        className="py-[9px] font-bold"
      />
      <TextAreaField
        label={t('reportBuilder:inspector.subtitle', 'Subtitle')}
        testId="report-panel-subtitle"
        rows={2}
        value={body.subtitle}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.setHeader('subtitle', value)}
      />

      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.accent', 'Accent colour')}</PanelLabel>
        <div className="flex gap-[9px]">
          {ACCENT_SWATCHES.map((hex) => (
            <Swatch
              key={hex}
              hex={hex}
              on={body.accent.toLowerCase() === hex.toLowerCase()}
              testId="report-swatch"
              onClick={() => edits.histSetHeader('accent', hex)}
            />
          ))}
        </div>
      </div>

      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.status', 'Status')}</PanelLabel>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              on={status === option.value}
              value={option.value}
              label={statusLabel(option.value)}
              tone={option.tone}
              testId="report-status-option"
              onClick={() => edits.histSetStatus(option.value)}
            />
          ))}
        </div>
      </div>

      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.background', 'Background image')}</PanelLabel>
        {body.bgImage === '' ? (
          <>
            <FileLabel
              className={cn(DASHED, 'h-[46px] gap-2')}
              ariaLabel={t('reportBuilder:inspector.backgroundUpload', 'Upload background')}
              testId="report-background-upload"
              onFile={(event) => void pickImage(event, setBackground, onImageRejected)}
            >
              <UploadGlyph className="size-3.5" aria-hidden="true" />
              {t('reportBuilder:inspector.backgroundUpload', 'Upload background')}
            </FileLabel>
            <Note className="mt-2">
              {t('reportBuilder:inspector.backgroundHint', 'Adds a full-bleed background behind the whole report — great for letterhead or a watermark.')}
            </Note>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              {/* A data URL cannot be a class; `src` is the one place it can go. */}
              <img src={body.bgImage} alt="" className="h-[34px] w-[46px] shrink-0 rounded-[7px] border border-border object-cover" />
              <FileLabel
                className="rounded-[9px] border border-border bg-surface-2 px-3 py-[7px] text-[11.5px] font-bold text-fg-muted hover:border-border-strong"
                ariaLabel={t('reportBuilder:inspector.backgroundReplace', 'Replace')}
                testId="report-background-replace"
                onFile={(event) => void pickImage(event, setBackground, onImageRejected)}
              >
                {t('reportBuilder:inspector.backgroundReplace', 'Replace')}
              </FileLabel>
              <button
                type="button"
                data-testid="report-background-remove"
                onClick={() => setBackground('')}
                className="rounded-[9px] px-2 py-[7px] text-[11.5px] font-bold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('reportBuilder:inspector.backgroundRemove', 'Remove')}
              </button>
            </div>
            <div className="flex items-center gap-2.5">
              <PanelLabel id={tintId} className="mb-0 shrink-0 normal-case tracking-normal">
                {t('reportBuilder:inspector.backgroundOverlay', 'Overlay {pct}%', { pct: percent })}
              </PanelLabel>
              <RangeInput
                value={percent}
                min={0}
                max={Math.round(BG_TINT_MAX * 100)}
                ariaLabel={t('reportBuilder:inspector.backgroundOverlay', 'Overlay {pct}%', { pct: percent })}
                testId="report-background-tint"
                onBegin={edits.beginEdit}
                onChange={(value) => edits.setHeader('bgTint', value / 100)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
