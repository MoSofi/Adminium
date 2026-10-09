// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What stands under an answer in words (Milo Panel, section 06): where it
 * came from, how much of it was read, and what to ask next.
 *
 * THE "FROM" LINE IS THE SERVER'S. It lists the tables the turn's tools
 * really read, as the server recorded them while it ran them. Nothing here
 * is taken from the model's own account of what it did.
 *
 * A PART OF A TABLE IS SAID, AND ONLY WHEN IT IS ONE. Rows that were asked
 * for in an order and cut at five are "the top five", a whole answer to that
 * question. Rows read in no order and cut at fifty are fifty of the table,
 * and whatever was concluded from them is about those fifty: that is the
 * line in the warning colour.
 *
 * NOTHING READ IS SAID TOO. An answer with a figure and no read behind it is
 * the model's general knowledge or its guess; the person is told, and given
 * the way to have it read.
 */
import { cn } from '@adminium/ui';
import { Database, RotateCw, TriangleAlert } from 'lucide-react';

import type { AssistantAnswer, AssistantAnswerRead } from '../api.js';
import { t } from '../../i18n/t.js';
import { ChipList } from './ChipList.js';

/** `connection.schema.table` as a person names it: the table. */
export function tableName(qualified: string): string {
  return qualified.split('.').at(-1) ?? qualified;
}

/** The reads that covered a part of their table and were not a "top few". */
export function partialReads(reads: readonly AssistantAnswerRead[]): AssistantAnswerRead[] {
  const worst = new Map<string, AssistantAnswerRead>();
  for (const read of reads) {
    if (read.sorted || read.returned === null || read.total === null || read.returned >= read.total) continue;
    const seen = worst.get(read.table);
    // One line a table: the read that saw the most of it.
    if (seen === undefined || (seen.returned ?? 0) < read.returned) worst.set(read.table, read);
  }
  return [...worst.values()];
}

export interface AnswerFootProps {
  answer: AssistantAnswer;
  /** Whether this page's assistant reads data at all: only there is "nothing was read" worth saying. */
  reads: boolean;
  /** Ask the same question again, told to read. Absent: no button. */
  onReadAgain?: (() => void) | undefined;
  /** Shown only under the newest answer. */
  followups?: readonly string[] | undefined;
  onFollowup?: ((text: string) => void) | undefined;
  disabled?: boolean | undefined;
}

export function AnswerFoot({ answer, reads, onReadAgain, followups, onFollowup, disabled }: AnswerFootProps) {
  const tables = [...new Set((answer.sources.length > 0 ? answer.sources : answer.reads.map((read) => read.table)).map(tableName))];
  const partial = partialReads(answer.reads);
  const nothing = reads && tables.length === 0;
  const chips = followups ?? [];
  if (tables.length === 0 && !nothing && chips.length === 0) return null;
  return (
    <div data-testid="assistant-answer-foot" className="flex flex-col gap-2 ps-[39px]">
      <div className="flex flex-col gap-[5px]">
        {tables.length === 0 ? null : (
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            <Database className="size-3 shrink-0" aria-hidden="true" />
            <span>{t('assistant:answer.from', 'From:')}</span>
            <span className="min-w-0 truncate font-mono text-[11px]">{tables.join(', ')}</span>
          </span>
        )}
        {partial.map((read) => (
          <span key={read.table} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warn">
            <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            <span>
              {t('assistant:answer.part', 'Read {returned, number} of {total, number} rows of {table}.', {
                returned: read.returned ?? 0,
                total: read.total ?? 0,
                table: tableName(read.table),
              })}
            </span>
          </span>
        ))}
        {nothing ? (
          <span className="flex flex-wrap items-center gap-[7px] text-[11.5px] text-fg-subtle">
            <span>{t('assistant:answer.nothingRead', 'Nothing was read for this answer.')}</span>
            {onReadAgain === undefined ? null : (
              <button
                type="button"
                data-testid="assistant-read-again"
                disabled={disabled === true}
                onClick={onReadAgain}
                className={cn(
                  'nb-press inline-flex items-center gap-[5px] rounded-[7px] border border-border-strong bg-surface px-2 py-[3px] text-[11px] font-bold text-fg-muted',
                  'hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                <RotateCw className="size-3" aria-hidden="true" />
                {t('assistant:answer.readAgain', 'Read again')}
              </button>
            )}
          </span>
        ) : null}
      </div>
      {chips.length === 0 || onFollowup === undefined ? null : (
        <ChipList variant="compact" items={chips.map((label) => ({ label }))} onPick={onFollowup} disabled={disabled === true} />
      )}
    </div>
  );
}

/** Between two turns: the model was not sent the oldest messages any more (section 07). */
export function ForgotDivider({ count, name }: { count: number; name: string }) {
  return (
    <div data-testid="assistant-forgot" role="note" className="flex items-center gap-2.5 text-[11px] font-semibold text-fg-subtle">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="max-w-[270px] text-center leading-[1.45]">
        {t('assistant:answer.forgot', '{name} no longer has the first {count, plural, one {message} other {# messages}} in mind.', { name, count })}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
