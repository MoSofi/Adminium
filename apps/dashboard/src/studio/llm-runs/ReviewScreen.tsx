// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/llm-runs/:id/review` — the review-diff screen (06-llm-assist.md
 * §8.2, §10.3). Loads the run detail + `SuggestionDiff[]`, groups them into the
 * ten §10.3 categories, and drives the accept/reject selection: default checks
 * follow the §8.2 review defaults, the header slider bulk-accepts by confidence
 * (never `rejects-heuristic`/`user-locked` — acceptance criterion 12), and the
 * selection persists across reload until the run is applied (criterion 12).
 * Applying commits `POST /runs/:id/apply` in one transaction and raises an Undo
 * toast via the app-wide undo contract; an applied run renders read-only.
 *
 * Exported as `ReviewScreen({ runId })` — the lazy contract `studio/routes.tsx`
 * loads from `./llm-runs/ReviewScreen.tsx`.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { aiApi, type RunApplyResult, type SuggestionDiff } from '../ai/api.js';
import { ApplyDialog } from './ApplyDialog.js';
import { CategorySection } from './CategorySection.js';
import { ReviewHeader } from './ReviewHeader.js';
import {
  DEFAULT_ACCEPT_THRESHOLD,
  acceptedCount,
  bulkAcceptSelection,
  countStatuses,
  defaultSelection,
  groupDiffs,
  selectableIds,
  summarizeAccepted,
} from './model.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { clearDraftSelection, loadDraftSelection, saveDraftSelection } from './persistence.js';

function runQuery(runId: string) {
  return queryOptions({
    queryKey: ['llm', 'run', runId] as const,
    queryFn: () => aiApi.getRun(runId),
  });
}

function diffQuery(runId: string) {
  return queryOptions({
    queryKey: ['llm', 'diff', runId] as const,
    queryFn: () => aiApi.getDiff(runId),
  });
}

const REVIEWABLE_STATUSES = new Set(['validated', 'applied', 'partially_applied']);

/** The app-wide undo token an apply may return (parked in the undo store, §10.3). */
function undoTokenOf(result: RunApplyResult): string | null {
  const token = result.undoToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export interface ReviewScreenProps {
  runId: string;
}

export function ReviewScreen({ runId }: ReviewScreenProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  const runResult = useQuery(runQuery(runId));
  const diffResult = useQuery(diffQuery(runId));
  const run = runResult.data;
  const diffs = diffResult.data;

  const isApplied = run !== undefined && (run.status === 'applied' || run.status === 'partially_applied');
  const readOnly = isApplied;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(DEFAULT_ACCEPT_THRESHOLD);
  const [applyOpen, setApplyOpen] = useState(false);
  const initRef = useRef<string | null>(null);

  // Initialize selection once, from the server review (applied) or the persisted
  // draft (falling back to the §8.2 defaults) for an unapplied run.
  useEffect(() => {
    if (run === undefined || diffs === undefined) return;
    if (initRef.current === runId) return;
    initRef.current = runId;
    if (run.status === 'applied' || run.status === 'partially_applied') {
      setSelected(new Set(run.review?.accepted ?? []));
      return;
    }
    const existing = new Set(diffs.map((diff) => diff.id));
    const draft = loadDraftSelection(runId);
    setSelected(
      draft !== null ? new Set(draft.filter((id) => existing.has(id))) : defaultSelection(diffs),
    );
  }, [run, diffs, runId]);

  // Persist the draft on every change while the run is still reviewable.
  useEffect(() => {
    if (initRef.current !== runId || isApplied) return;
    saveDraftSelection(runId, selected);
  }, [selected, runId, isApplied]);

  const groups = useMemo(() => (diffs === undefined ? [] : groupDiffs(diffs)), [diffs]);
  const counts = useMemo(() => (diffs === undefined ? null : countStatuses(diffs)), [diffs]);
  const summary = useMemo(
    () => (diffs === undefined ? null : summarizeAccepted(diffs, selected)),
    [diffs, selected],
  );
  const nAccepted = diffs === undefined ? 0 : acceptedCount(diffs, selected);

  const applyMutation = useMutation({
    mutationFn: () => aiApi.applyRun(runId, [...selected]),
    onSuccess: (result) => {
      clearDraftSelection(runId);
      setSelected(new Set(result.review.accepted));
      setApplyOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['llm', 'diff', runId] });
      pushUndoToast(result);
    },
    onError: (error: unknown) => {
      toasts.push({
        variant: 'error',
        title: t('studio.llmRuns.review.toast.applyFailed', 'Could not apply suggestions'),
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  function pushUndoToast(result: RunApplyResult) {
    const token = undoTokenOf(result);
    const title = result.partial
      ? t('studio.llmRuns.review.toast.appliedPartial', 'Applied {n} suggestions (some skipped)', {
          n: result.review.accepted.length,
        })
      : t('studio.llmRuns.review.toast.applied', 'Applied {n} suggestions', {
          n: result.review.accepted.length,
        });
    toasts.push({
      variant: 'success',
      title,
      ...(token === null
        ? {}
        : {
            action: {
              label: t('common.undo', 'Undo'),
              onAction: () => {
                aiApi
                  .undoApply(runId, token)
                  .then(() => {
                    void queryClient.invalidateQueries({ queryKey: ['llm', 'run', runId] });
                    void queryClient.invalidateQueries({ queryKey: ['llm', 'diff', runId] });
                    toasts.push({ variant: 'info', title: t('undo.done', 'Change undone') });
                  })
                  .catch((error: unknown) => {
                    toasts.push({
                      variant: 'error',
                      title: t('studio.llmRuns.review.toast.undoFailed', 'Could not undo this change'),
                      description: error instanceof Error ? error.message : undefined,
                    });
                  });
              },
            },
          }),
    });
  }

  // ── Selection handlers ──────────────────────────────────────────────────────
  function toggleRow(id: string, next: boolean) {
    setSelected((prev) => {
      const draft = new Set(prev);
      if (next) draft.add(id);
      else draft.delete(id);
      return draft;
    });
  }

  function selectAll(rows: readonly SuggestionDiff[], next: boolean) {
    setSelected((prev) => {
      const draft = new Set(prev);
      if (next) for (const id of selectableIds(rows)) draft.add(id);
      else for (const row of rows) draft.delete(row.id);
      return draft;
    });
  }

  function bulkAccept() {
    if (diffs === undefined) return;
    setSelected(bulkAcceptSelection(diffs, threshold));
  }

  // ── Render states ───────────────────────────────────────────────────────────
  if (runResult.isLoading || diffResult.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner size="md" />
      </div>
    );
  }

  if (runResult.isError || run === undefined) {
    return (
      <PageSurface width="narrow">
        <Alert
          tone="danger"
          title={t('studio.llmRuns.review.error.title', 'Could not load this run')}
          body={runResult.error instanceof Error ? runResult.error.message : undefined}
        />
      </PageSurface>
    );
  }

  if (!REVIEWABLE_STATUSES.has(run.status)) {
    return (
      <PageSurface width="narrow">
        <Alert
          tone="info"
          title={t('studio.llmRuns.review.notReady.title', 'This run has no suggestions to review yet')}
          body={t(
            'studio.llmRuns.review.notReady.body',
            'A run must be validated before its suggestions can be reviewed. Generate or paste a response first.',
          )}
        />
      </PageSurface>
    );
  }

  return (
    <PageSurface width="wide" className="flex flex-col gap-4 pb-24">
      {counts !== null ? (
        <ReviewHeader
          run={run}
          counts={counts}
          threshold={threshold}
          readOnly={readOnly}
          onThresholdChange={setThreshold}
          onBulkAccept={bulkAccept}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {isApplied ? (
        <Alert
          tone="pos"
          title={t('studio.llmRuns.review.applied.title', 'This run has been applied')}
          body={t('studio.llmRuns.review.applied.body', 'The accepted suggestions below are read-only.')}
        />
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title={t('studio.llmRuns.review.empty.title', 'No suggestions')}
          body={t('studio.llmRuns.review.empty.body', 'This run produced no suggestions to review.')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <CategorySection
              key={group.def.id}
              group={group}
              selected={selected}
              readOnly={readOnly}
              defaultCollapsed={group.rows.every((row) => row.status === 'agree')}
              onToggleRow={toggleRow}
              onSelectAll={selectAll}
            />
          ))}
        </div>
      )}

      {readOnly ? null : (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-wide items-center justify-between gap-3">
            <span className="text-body-sm text-fg-muted">
              {t('studio.llmRuns.review.footer.count', '{n} suggestions selected', { n: nAccepted })}
            </span>
            <div className="flex items-center gap-2">
              {applyMutation.isError ? (
                <Badge tone="danger">{t('studio.llmRuns.review.footer.failed', 'Apply failed')}</Badge>
              ) : null}
              <Button disabled={nAccepted === 0} onClick={() => setApplyOpen(true)}>
                {t('studio.llmRuns.review.footer.apply', 'Apply {n} accepted suggestions', { n: nAccepted })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {summary !== null ? (
        <ApplyDialog
          open={applyOpen}
          summary={summary}
          applying={applyMutation.isPending}
          onConfirm={() => applyMutation.mutate()}
          onOpenChange={setApplyOpen}
        />
      ) : null}
    </PageSurface>
  );
}
