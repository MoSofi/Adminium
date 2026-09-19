// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this draft changes, against the document it was based on.
 *
 * THE MODEL DID NOT WRITE THIS. A model's account of its own changes is a
 * claim; this is a fact — the server projects both documents to the same
 * canonical lines and diffs them. That is the whole reason the tab exists, and
 * the reason it is worth reading before saving anything.
 *
 * With no base document every line is an addition, and the header says so
 * rather than pretending there was something to compare with.
 */
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { AssistantResult } from '../api.js';

export interface DiffViewProps {
  diff: AssistantResult['diff'];
  /** What the draft would create, for the no-base sentence. */
  kind: string;
}

export function DiffView({ diff, kind }: DiffViewProps) {
  return (
    <div className="px-[18px] pb-[18px] pt-3.5">
      <div className="mb-[11px] flex items-center gap-[9px]">
        <span className="text-caption text-fg-muted">
          {diff.against === null
            ? t('assistant:diff.new', 'New {kind} — fields it will write', { kind })
            : t('assistant:diff.against', 'Compared with {name}', { name: diff.against })}
        </span>
        <span className="ms-auto flex gap-[7px] font-mono text-[11px] font-bold">
          <span className="text-pos">{t('assistant:diff.adds', '+{n}', { n: diff.adds })}</span>
          <span className="text-danger">{t('assistant:diff.dels', '−{n}', { n: diff.dels })}</span>
        </span>
      </div>
      <div className="overflow-hidden rounded-[11px] border border-border font-mono">
        {diff.lines.map((line, index) => (
          <div
            key={`${String(index)}:${line.text}`}
            className={cn(
              'flex gap-2.5 px-3 py-[5px]',
              line.sign === '+' && 'bg-pos-soft',
              line.sign === '-' && 'bg-danger-soft',
            )}
          >
            <span
              className={cn(
                'w-2.5 shrink-0 text-caption font-bold',
                line.sign === '+' && 'text-pos',
                line.sign === '-' && 'text-danger',
                line.sign === ' ' && 'text-fg-muted',
              )}
              aria-hidden="true"
            >
              {line.sign === ' ' ? ' ' : line.sign}
            </span>
            <span
              className={cn(
                'break-words text-caption leading-[1.6]',
                line.sign === ' ' ? 'text-fg-muted' : 'text-fg',
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
      {diff.truncated ? (
        <p className="mt-2 text-[11px] text-fg-muted">
          {t('assistant:diff.truncated', 'The comparison was cut — open the draft to see the rest.')}
        </p>
      ) : null}
    </div>
  );
}
