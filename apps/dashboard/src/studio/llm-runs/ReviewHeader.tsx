// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review-screen header (§10.3): a run summary (path · model-or-"BYO" · snapshot
 * · counts agree/conflict/new/rejects) plus the bulk controls — an "Accept all
 * ≥ threshold" confidence slider driving a bulk-select action that can never
 * pick `rejects-heuristic` or `user-locked` rows (acceptance criterion 12).
 */
import { Badge, Button, MonoText, Slider } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { LlmRunDetail } from '../ai/api.js';
import type { StatusCounts } from './model.js';

function pct(threshold: number): number {
  return Math.round(threshold * 100);
}

export interface ReviewHeaderProps {
  run: LlmRunDetail;
  counts: StatusCounts;
  threshold: number;
  readOnly: boolean;
  onThresholdChange: (threshold: number) => void;
  onBulkAccept: () => void;
  onClear: () => void;
}

export function ReviewHeader({
  run,
  counts,
  threshold,
  readOnly,
  onThresholdChange,
  onBulkAccept,
  onClear,
}: ReviewHeaderProps) {
  const isByo = run.mode === 'byo';
  const modelLabel = isByo ? t('studio.llmRuns.review.header.byo', 'BYO') : (run.model ?? t('studio.llmRuns.review.value.dash', '—'));

  return (
    <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title-sm font-semibold text-fg">
            {t('studio.llmRuns.review.header.title', 'Review AI suggestions')}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
            <Badge tone={isByo ? 'info' : 'accent'}>
              {isByo ? t('studio.llmRuns.review.header.pathByo', 'Copy-paste') : t('studio.llmRuns.review.header.pathDirect', 'Direct API')}
            </Badge>
            <span className="inline-flex items-center gap-1">
              {t('studio.llmRuns.review.header.model', 'Model')}
              <MonoText className="text-fg">{modelLabel}</MonoText>
            </span>
            <span className="inline-flex items-center gap-1">
              {t('studio.llmRuns.review.header.snapshot', 'Snapshot')}
              <MonoText className="text-fg">{run.snapshotId}</MonoText>
            </span>
          </div>
        </div>

        <ul className="flex flex-wrap items-center gap-2" aria-label={t('studio.llmRuns.review.header.countsAria', 'Suggestion counts')}>
          <li>
            <Badge tone="pos">{t('studio.llmRuns.review.header.agree', '{n} agree', { n: counts.agree })}</Badge>
          </li>
          <li>
            <Badge tone="warn">{t('studio.llmRuns.review.header.conflict', '{n} conflict', { n: counts.conflict })}</Badge>
          </li>
          <li>
            <Badge tone="accent">{t('studio.llmRuns.review.header.new', '{n} new', { n: counts.new })}</Badge>
          </li>
          <li>
            <Badge tone="danger">{t('studio.llmRuns.review.header.rejects', '{n} rejects', { n: counts.rejects })}</Badge>
          </li>
        </ul>
      </div>

      {readOnly ? null : (
        <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <label className="flex items-center justify-between text-caption font-semibold text-fg-muted">
              <span>{t('studio.llmRuns.review.bulk.thresholdLabel', 'Confidence threshold')}</span>
              <MonoText className="text-fg">{pct(threshold)}%</MonoText>
            </label>
            <Slider
              value={[pct(threshold)]}
              min={0}
              max={100}
              step={5}
              thumbLabels={[t('studio.llmRuns.review.bulk.thresholdAria', 'Accept-all confidence threshold')]}
              onValueChange={(value) => {
                const next = value[0];
                if (typeof next === 'number') onThresholdChange(next / 100);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="soft" size="sm" onClick={onBulkAccept}>
              {t('studio.llmRuns.review.bulk.acceptAll', 'Accept all ≥ {pct}%', { pct: pct(threshold) })}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear}>
              {t('studio.llmRuns.review.bulk.clear', 'Clear selection')}
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
