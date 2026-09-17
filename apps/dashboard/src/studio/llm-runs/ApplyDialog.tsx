// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Apply-confirmation modal (footer): summarizes the writes an apply would
 * perform ("Creates 2 dashboard pages, updates 41 labels…") derived from the
 * accepted rows, then commits via `POST /runs/:id/apply` in one transaction.
 * Not the type-to-confirm `ConfirmModal` — applying is additive and reversible
 * (an Undo toast follows), so a plain confirm suffices.
 */
import { Sparkles } from 'lucide-react';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { REVIEW_GROUPS, type ApplySummary } from './model.js';

/** Group-labelled, non-zero write counts, display order. */
function summaryLines(summary: ApplySummary): { id: string; label: string; count: number }[] {
  const byGroup: Record<string, number> = {
    labels: summary.labels,
    groups: summary.navGroups,
    enums: summary.enums,
    relations: summary.relations,
    keys: summary.keys,
    templates: summary.templates,
    dashboards: summary.dashboards + summary.widgets,
    pii: summary.pii,
    icons: summary.icons,
    microcopy: summary.microcopy,
  };
  const lines: { id: string; label: string; count: number }[] = [];
  for (const group of REVIEW_GROUPS) {
    const count = byGroup[group.id] ?? 0;
    if (count > 0) lines.push({ id: group.id, label: t(group.labelKey, group.labelDefault), count });
  }
  return lines;
}

export interface ApplyDialogProps {
  open: boolean;
  summary: ApplySummary;
  applying: boolean;
  /**
   * Why the last attempt did not land, on the screen that asked for it.
   *
   * The failure was reported ONLY as a toast — bottom-end, auto-dismissing,
   * outside the dialog the operator is looking at — so an apply that died
   * server-side (a `value too long for type character varying(12)` from inside
   * the transaction, say) left the modal open, unchanged, saying nothing. The
   * toast still fires for anyone who has moved on; this is for the person who
   * has not.
   */
  error?: string | null | undefined;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ApplyDialog({ open, summary, applying, error = null, onConfirm, onOpenChange }: ApplyDialogProps) {
  const lines = summaryLines(summary);
  return (
    <Modal
      size="sm"
      open={open}
      onOpenChange={(next) => {
        if (applying && !next) return;
        onOpenChange(next);
      }}
    >
      <ModalHeader
        tone="accent"
        icon={<Sparkles />}
        title={t('studio:llmRuns.review.apply.title', 'Apply {n} suggestions', { n: summary.total })}
        subtitle={t('studio:llmRuns.review.apply.subtitle', 'These changes are written in one transaction and can be undone.')}
        closeLabel={t('common.dismiss', 'Dismiss')}
      />
      <ModalBody>
        {error === null || error === undefined ? null : (
          <Alert
            className="mb-4"
            tone="danger"
            role="alert"
            title={t('studio:llmRuns.review.applyFailed', 'Nothing was applied')}
            body={error}
          />
        )}
        {lines.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('studio:llmRuns.review.apply.empty', 'Nothing selected to apply.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 text-body-sm">
                <span className="text-fg-muted">{line.label}</span>
                <span className="font-semibold tabular-nums text-fg">{line.count}</span>
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={applying} onClick={() => onOpenChange(false)}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button loading={applying} disabled={summary.total === 0} onClick={onConfirm}>
          {t('studio:llmRuns.review.apply.confirm', 'Apply changes')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
