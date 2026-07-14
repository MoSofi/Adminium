/**
 * One review-diff row (§10.3 "row anatomy"): checkbox · table/column identifier
 * chip · heuristic value → LLM value side-by-side · confidence meter · reason ·
 * status pill. `rejects-heuristic` rows carry a warn-tone callout and are never
 * pre-checked; `user-locked` rows render a disabled "kept — edited by you"
 * badge (acceptance criteria 11/12). Localized values (labels, groups,
 * micro-copy) get a per-row "Show translations" disclosure.
 */
import { useId, useState } from 'react';
import { ChevronRight, Lock, TriangleAlert } from 'lucide-react';
import { Badge, Checkbox, MonoText, ProgressBar, StatusPill, Tag, cn, type Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SuggestionDiff, SuggestionStatus } from '../ai/api.js';
import { isCheckable, isUserLocked, rowIdentifier } from './model.js';
import { DiffValue, LocalizedField, hasLocalizedDetail, localizedFieldsOf } from './valueViews.js';

interface StatusMeta {
  tone: Tone;
  label: string;
}

function statusMeta(status: SuggestionStatus): StatusMeta {
  switch (status) {
    case 'agree':
      return { tone: 'pos', label: t('studio.llmRuns.review.status.agree', 'Agrees') };
    case 'conflict':
      return { tone: 'warn', label: t('studio.llmRuns.review.status.conflict', 'Conflict') };
    case 'llm-new':
      return { tone: 'accent', label: t('studio.llmRuns.review.status.new', 'New') };
    case 'heuristic-only':
      return { tone: 'neutral', label: t('studio.llmRuns.review.status.heuristicOnly', 'Heuristic only') };
    case 'rejects-heuristic':
      return { tone: 'danger', label: t('studio.llmRuns.review.status.rejects', 'Rejects heuristic') };
    case 'user-locked':
      return { tone: 'info', label: t('studio.llmRuns.review.status.locked', 'Locked') };
  }
}

function confidenceTone(confidence: number): Tone {
  if (confidence >= 0.8) return 'pos';
  if (confidence >= 0.5) return 'accent';
  return 'warn';
}

/**
 * A localized category noun for the checkbox accessible name. Multiple rows can
 * share a target identifier (a table has a label, a key and a micro-copy row,
 * all reading `orders`), so the category disambiguates each checkbox for both
 * assistive tech (acceptance criterion 14) and the tests.
 */
function categoryNoun(category: string): string {
  switch (category) {
    case 'label':
      return t('studio.llmRuns.review.cat.label', 'label');
    case 'key':
      return t('studio.llmRuns.review.cat.key', 'key columns');
    case 'enum':
      return t('studio.llmRuns.review.cat.enum', 'enum');
    case 'relation':
      return t('studio.llmRuns.review.cat.relation', 'relation');
    case 'pii':
      return t('studio.llmRuns.review.cat.pii', 'PII');
    case 'template':
      return t('studio.llmRuns.review.cat.template', 'page template');
    case 'group':
      return t('studio.llmRuns.review.cat.group', 'navigation group');
    case 'dashboard':
      return t('studio.llmRuns.review.cat.dashboard', 'dashboard');
    case 'widget':
      return t('studio.llmRuns.review.cat.widget', 'widget');
    case 'copy':
      return t('studio.llmRuns.review.cat.copy', 'micro-copy');
    default:
      return category;
  }
}

export interface SuggestionRowProps {
  diff: SuggestionDiff;
  checked: boolean;
  /** Read-only once the run is applied — the whole row locks. */
  readOnly: boolean;
  onToggle: (id: string, next: boolean) => void;
}

export function SuggestionRow({ diff, checked, readOnly, onToggle }: SuggestionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const checkboxId = useId();
  const meta = statusMeta(diff.status);
  const locked = isUserLocked(diff.status);
  const checkable = isCheckable(diff.status) && !readOnly && !locked;
  const rejects = diff.status === 'rejects-heuristic';
  const identifier = rowIdentifier(diff);
  const showConfidence = diff.status !== 'heuristic-only';
  const localizedFields = expanded ? localizedFieldsOf(diff.category, diff.llmValue) : [];
  const canExpand = hasLocalizedDetail(diff.category) && localizedFieldsOf(diff.category, diff.llmValue).length > 0;

  return (
    <li
      data-testid="suggestion-row"
      data-status={diff.status}
      data-checked={checked}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        rejects ? 'border-border bg-warn-soft' : 'border-border bg-surface',
        locked && 'opacity-90',
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={checkboxId}
          className="mt-0.5"
          checked={checked}
          disabled={!checkable}
          aria-label={t('studio.llmRuns.review.row.acceptAria', 'Accept {noun} suggestion for {target}', {
            noun: categoryNoun(diff.category),
            target: identifier,
          })}
          onCheckedChange={(next) => onToggle(diff.id, next === true)}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <MonoText className="text-caption font-semibold text-fg-muted">{identifier}</MonoText>
            <StatusPill status={diff.status} tone={meta.tone}>
              {meta.label}
            </StatusPill>
            {locked ? (
              <Badge tone="info">
                <Lock aria-hidden className="me-1 size-3" />
                {t('studio.llmRuns.review.row.keptEdited', 'kept — edited by you')}
              </Badge>
            ) : null}
          </div>

          {/* heuristic → llm side-by-side */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0" data-testid="heuristic-value">
              <DiffValue category={diff.category} value={diff.heuristicValue} />
            </span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle rtl:-scale-x-100" />
            <span className="min-w-0" data-testid="llm-value">
              <DiffValue category={diff.category} value={diff.llmValue} />
            </span>
          </div>

          {rejects ? (
            <p className="flex items-start gap-1.5 text-body-sm text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{t('studio.llmRuns.review.row.rejectsCallout', 'The AI rejects a heuristic decision — confirm before accepting.')}</span>
            </p>
          ) : null}

          {diff.reason !== undefined && diff.reason !== '' ? (
            <p className="text-body-sm text-fg-muted" dir="auto">
              {diff.reason}
            </p>
          ) : null}

          {canExpand ? (
            <div>
              <button
                type="button"
                aria-expanded={expanded}
                className="inline-flex items-center gap-1 rounded-sm text-caption font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => setExpanded((value) => !value)}
              >
                <ChevronRight
                  aria-hidden
                  className={cn('size-3 transition-transform rtl:-scale-x-100', expanded && 'rotate-90')}
                />
                {expanded
                  ? t('studio.llmRuns.review.row.hideTranslations', 'Hide translations')
                  : t('studio.llmRuns.review.row.showTranslations', 'Show translations')}
              </button>
              {expanded ? (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2">
                  {localizedFields.map((field) => (
                    <LocalizedField key={field.key} label={field.label} value={field.value} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {showConfidence ? (
          <div className="flex w-24 shrink-0 flex-col items-end gap-1">
            <span className="text-caption font-semibold tabular-nums text-fg-muted">
              {Math.round(diff.confidence * 100)}%
            </span>
            <ProgressBar
              value={Math.round(diff.confidence * 100)}
              tone={confidenceTone(diff.confidence)}
              size="sm"
              animated={false}
              label={t('studio.llmRuns.review.row.confidenceAria', 'Confidence {pct}%', {
                pct: Math.round(diff.confidence * 100),
              })}
            />
          </div>
        ) : (
          <Tag className="shrink-0">{t('studio.llmRuns.review.row.noAi', 'No AI suggestion')}</Tag>
        )}
      </div>
    </li>
  );
}
