// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Review the {n}" (comp `Email To Contacts.dc.html` 208-241, 1321-1324):
 * the people who say yes in the table but were ticked before records were
 * kept, one at a time. Each gets "Leave out" or "Confirm"; after a choice a
 * badge ("Confirmed" / "Left out") and "Undo". There is no "confirm all"
 * (the comp's DO-NOT), and the running count the comp computes is shown:
 * "{a} confirmed · {b} left out · {c} to decide".
 *
 * The answers are written when the person is done ("Done", or the back arrow
 * to the send dialog), one request each, so "Undo" is a real undo: nothing
 * reached the consent log yet. What the server takes moves the breakdown
 * (the dialog re-reads it); one it refuses stays chosen here, with the
 * reason, for another try. Who may answer is the table's update grant
 * (Record consent's), so a marketer who may only read the table sees the list
 * and is told they can't answer when they try.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, IconButton, ModalBody, ModalFooter, ModalHeader, Spinner } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { emailApi, type EmailReviewList } from '../../email/api.js';
import { t } from '../../i18n/t.js';
import { reviewListQuery } from './campaignWords.js';

export type ReviewAnswer = 'confirm' | 'leave-out';

export interface ReviewViewProps {
  connectionId: string;
  table: string;
  /** The table's name, for the refusal sentence. */
  label: string;
  /** How many are waiting, from the breakdown: the title's count while the list loads. */
  waiting: number;
  /** "When": the review's dates in the person's language. */
  localeTag: string;
  /** Back to the send dialog, after what was answered is written (the dialog re-reads its counts). */
  onDone: (written: number) => void;
}

function tickedLine(person: EmailReviewList['people'][number], localeTag: string): string {
  const date = person.tickedAt === null ? null : new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short', year: 'numeric' }).format(person.tickedAt);
  if (person.tickedBy !== null && date !== null) return t('studio:email.send.review.tickedByOn', 'Ticked by {name} · {date}', { name: person.tickedBy, date });
  if (person.tickedBy !== null) return t('studio:email.send.review.tickedBy', 'Ticked by {name}', { name: person.tickedBy });
  if (date !== null) return t('studio:email.send.review.tickedOn', 'Ticked on {date}', { date });
  return t('studio:email.send.review.ticked', 'Ticked before records were kept');
}

export function ReviewView({ connectionId, table, label, waiting, localeTag, onDone }: ReviewViewProps): ReactNode {
  const list = useQuery(reviewListQuery(connectionId, table));
  const [answers, setAnswers] = useState<ReadonlyMap<string, ReviewAnswer>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = list.data?.people ?? [];
  const total = list.data?.total ?? waiting;
  const confirmed = [...answers.values()].filter((answer) => answer === 'confirm').length;
  const left = answers.size - confirmed;

  const choose = (key: string, answer: ReviewAnswer | null) => {
    setAnswers((before) => {
      const next = new Map(before);
      if (answer === null) next.delete(key);
      else next.set(key, answer);
      return next;
    });
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let written = 0;
    const kept = new Map(answers);
    for (const [key, answer] of answers) {
      try {
        await emailApi.answerReview({ connectionId, table, key, answer });
        kept.delete(key);
        written += 1;
      } catch (failure) {
        // Answered by somebody else meanwhile: nothing is left to write for this person.
        if (failure instanceof ApiError && failure.code === 'NOT_IN_REVIEW') {
          kept.delete(key);
          continue;
        }
        setError(
          failure instanceof ApiError && failure.status === 403
            ? t('studio:email.send.review.forbidden', 'You can’t change {table}, so you can’t answer for its people.', { table: label })
            : t('studio:email.send.review.failed', 'Not every answer was saved. Try again.'),
        );
        break;
      }
    }
    setAnswers(kept);
    setBusy(false);
    if (kept.size === 0) onDone(written);
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-[18px]">
        <IconButton
          variant="bordered"
          size="md"
          label={t('studio:email.send.review.back', 'Back to Send campaign')}
          onClick={() => {
            void finish();
          }}
          data-testid="email-review-back"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </IconButton>
        <ModalHeader
          className="min-w-0 flex-1 p-0"
          hideClose
          closeLabel={t('studio:marketingMail.close', 'Close')}
          title={t('studio:email.send.review.title', 'Review the {count}', { count: total })}
          subtitle={
            <span data-testid="email-review-count" className="text-caption">
              {t('studio:email.send.review.count', '{confirmed} confirmed · {left} left out · {open} to decide', { confirmed, left, open: Math.max(0, total - answers.size) })}
            </span>
          }
        />
      </div>
      <ModalBody className="max-h-[440px] px-3 pb-3 pt-1">
        {list.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner label={t('common.loading', 'Loading')} />
          </div>
        ) : list.isError ? (
          <Alert tone="danger" className="m-2" title={t('studio:email.send.review.loadFailed', 'The list could not be loaded. Try again.')} />
        ) : (
          <ul aria-label={t('studio:email.send.review.listLabel', 'People to review')} className="flex flex-col">
            {people.map((person) => {
              const answer = answers.get(person.key) ?? null;
              return (
                <li key={person.key} data-testid="email-review-row" data-key={person.key} className="flex flex-wrap items-center gap-3 border-b border-border px-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-bold text-fg">
                      {person.name}{' '}
                      <span dir="ltr" className="font-mono text-[12px] font-medium text-fg-muted">
                        · {person.address}
                      </span>
                    </div>
                    <div className="text-caption text-fg-subtle">{tickedLine(person, localeTag)}</div>
                  </div>
                  {answer === null ? (
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => choose(person.key, 'leave-out')} data-testid="email-review-leave-out">
                        {t('studio:email.send.review.leaveOut', 'Leave out')}
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => choose(person.key, 'confirm')} data-testid="email-review-confirm">
                        {t('studio:email.send.review.confirm', 'Confirm')}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Badge tone={answer === 'confirm' ? 'pos' : 'neutral'} data-testid="email-review-answer">
                        {answer === 'confirm' ? t('studio:email.send.review.confirmed', 'Confirmed') : t('studio:email.send.review.leftOut', 'Left out')}
                      </Badge>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => choose(person.key, null)} data-testid="email-review-undo">
                        {t('studio:email.send.review.undo', 'Undo')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.data !== undefined && list.data.total > people.length ? (
          <p className="px-2 pt-3 text-caption text-fg-muted">
            {t('studio:email.send.review.more', 'The first {shown} of {total}: answer these, and the rest come next.', { shown: people.length, total: list.data.total })}
          </p>
        ) : null}
      </ModalBody>
      {error === null ? null : (
        <p role="alert" className="px-5 pb-3 text-body-sm text-danger">
          {error}
        </p>
      )}
      <ModalFooter>
        <Button
          loading={busy}
          onClick={() => {
            void finish();
          }}
          data-testid="email-review-done"
        >
          {t('studio:email.send.review.done', 'Done')}
        </Button>
      </ModalFooter>
    </>
  );
}
