// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-path validation-error list for the BYO paste screen (06-llm-assist.md
 * §7.2). Every error renders verbatim — code · JSON path · human sentence
 * (+ optional hint) — with a "Copy errors for your AI tool" button that copies
 * the §7.5 repair message, the copy-paste analogue of the direct path's
 * automated repair turn (§7.5).
 */
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { Badge, MonoText } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { LlmValidationError } from '../ai/api.js';
import { CopyButton } from './CopyButton.js';
import { formatRepairMessage } from './enrichState.js';

export interface ValidationErrorListProps {
  errors: readonly LlmValidationError[];
  warnings?: readonly LlmValidationError[] | undefined;
}

function ErrorRow({ error }: { error: LlmValidationError }) {
  const isWarning = error.severity === 'warning';
  return (
    <li className="flex items-start gap-2 border-t border-border py-2 first:border-t-0">
      <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {isWarning ? (
          <TriangleAlert className="size-3.5 text-warn" />
        ) : (
          <CircleAlert className="size-3.5 text-danger" />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={isWarning ? 'warn' : 'danger'}>{error.code}</Badge>
          {error.path.length > 0 ? (
            <MonoText className="text-caption text-fg-muted">{error.path}</MonoText>
          ) : (
            <span className="text-caption text-fg-subtle">
              {t('studio:enrich.byo.wholeDocument', 'whole document')}
            </span>
          )}
        </div>
        <p className="text-body-sm text-fg">{error.message}</p>
        {error.hint !== undefined && error.hint.length > 0 ? (
          <p className="text-caption text-fg-muted">{error.hint}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ValidationErrorList({ errors, warnings }: ValidationErrorListProps) {
  const rows = [...errors, ...(warnings ?? [])];
  if (rows.length === 0) return null;

  const fatalOrItem = errors.filter((error) => error.severity !== 'warning');

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-danger bg-danger-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-sm font-semibold text-fg">
          {t('studio:enrich.byo.errorsTitle', 'Validation found {count} issues', { count: String(rows.length) })}
        </p>
      </div>
      <ul className="flex flex-col">
        {rows.map((error, index) => (
          <ErrorRow key={`${error.code}:${error.path}:${index}`} error={error} />
        ))}
      </ul>
      {fatalOrItem.length > 0 ? (
        <div className="flex items-center gap-2 pt-1">
          <CopyButton
            value={() => formatRepairMessage(fatalOrItem)}
            label={t('studio:enrich.byo.copyErrors', 'Copy errors for your AI tool')}
            copiedLabel={t('studio:enrich.byo.copyErrorsDone', 'Errors copied')}
          />
          <p className="text-caption text-fg-muted">
            {t('studio:enrich.byo.copyErrorsHint', 'Paste this back into your AI tool to get a corrected response.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
