// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The run in the editor's header (comp `Email To Contacts.dc.html` 2a–2c,
 * 364-429): what replaces today's chip and its "Cancel sending"
 * (`EditorHeader`); the rest of today's header stays as it is, where the
 * comp drops it.
 *
 *  - Sending: a pill "Sending · {done} of {total}" with a spinner, then
 *    "Pause sending" (secondary) and "Stop sending" (danger outline).
 *  - Paused: a warning pill "Paused · {done} of {total}", then "Stop
 *    sending" and the primary "Go on sending".
 *  - Scheduled, not started: today's chip "Scheduled · {when}" and "Cancel
 *    schedule".
 *  - "Stop sending" asks first (an alert dialog, focus on "Keep sending"):
 *    "Stop for good?" / "{left} people won't get it. A stopped send can't be
 *    started again."
 *
 * The counts are the run's own (`GET /email-runs/:id`), read again every few
 * seconds while it sends; the job channel's events still refresh the
 * document (`useRunProgress`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, OctagonX, Pause, Play, Square } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Modal, ModalFooter, ModalHeader, Tag, cn } from '@adminium/ui';

import { emailApi, type EmailRunView } from '../../email/api.js';
import { EMAIL_DOCUMENTS_KEY, invalidateEmailDocuments } from '../../email/queries.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { formatStamp } from '../../team/teamApi.js';
import { StudioWords } from './campaignWords.js';

/** Whether a run is still going (sending, paused, or waiting for its time). */
export function runIsActive(run: EmailRunView | undefined): run is EmailRunView {
  return run !== undefined && (run.status === 'scheduled' || run.status === 'running');
}

export function runProgressQuery(runId: string, active: boolean) {
  return {
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'run', runId] as const,
    queryFn: () => emailApi.run(runId),
    refetchInterval: active ? 3_000 : (false as const),
    retry: false,
  };
}

export interface RunControlsProps {
  run: EmailRunView;
  /** BCP 47, for the schedule stamp. */
  localeTag: string;
}

export function RunControls(props: RunControlsProps): ReactNode {
  return (
    <StudioWords>
      <Controls {...props} />
    </StudioWords>
  );
}

function Controls({ run, localeTag }: RunControlsProps): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [confirm, setConfirm] = useState(false);
  const paused = run.state === 'paused';
  const started = run.status === 'running';
  const progress = useQuery(runProgressQuery(run.id, runIsActive(run)));
  const done = progress.data?.done ?? run.sent + run.failed + run.skipped;
  const total = progress.data?.total ?? run.total;
  const left = progress.data?.left ?? Math.max(0, total - done);
  const refresh = async () => {
    await invalidateEmailDocuments(queryClient);
  };
  const failed = (title: string) => toasts.push({ variant: 'error', title });

  const pause = useMutation({
    mutationFn: () => emailApi.pauseRun(run.id),
    onSuccess: refresh,
    onError: () => failed(t('studio:email.send.run.pauseFailed', 'Could not pause the send. Try again.')),
  });
  const resume = useMutation({
    mutationFn: () => emailApi.resumeRun(run.id),
    onSuccess: refresh,
    onError: () => failed(t('studio:email.send.run.resumeFailed', 'Could not go on sending. Try again.')),
  });
  const stop = useMutation({
    mutationFn: () => emailApi.stopRun(run.id),
    onSuccess: async (reply) => {
      setConfirm(false);
      toasts.push({ variant: 'info', title: t('studio:email.send.run.stopped', 'Stopped. {count, plural, one {# person won’t} other {# people won’t}} get it.', { count: reply.left }) });
      await refresh();
    },
    onError: () => failed(t('studio:email.send.run.stopFailed', 'Could not stop the send. Try again.')),
  });
  const cancel = useMutation({
    mutationFn: () => emailApi.cancelRun(run.id),
    onSuccess: async () => {
      toasts.push({ variant: 'info', title: t('studio:email.send.dialog.cancelled', 'Schedule cancelled') });
      await refresh();
    },
    onError: () => failed(t('studio:email.send.dialog.cancelFailed', 'Could not cancel')),
  });

  // A scheduled run that has not started: today's chip and "Cancel schedule".
  if (!started && !paused) {
    return (
      <div className="flex items-center gap-1.5" data-testid="email-run-chip" data-status={run.status}>
        <Tag tone="warn" className="gap-1 rounded-[20px] px-[9px] py-[3px] text-[10.5px]">
          <CalendarClock className="size-3" aria-hidden="true" />
          {t('studio:email.send.dialog.chipScheduled', 'Scheduled · {when}', { when: formatStamp(run.scheduledAt, localeTag) ?? '' })}
        </Tag>
        <Button variant="outline" size="sm" onClick={() => cancel.mutate()} loading={cancel.isPending} data-testid="email-cancel-run">
          {t('studio:email.send.dialog.cancelSchedule', 'Cancel schedule')}
        </Button>
      </div>
    );
  }

  const counts = (
    <span dir="ltr" className="font-mono">
      {t('studio:email.send.run.of', '{done} of {total}', { done, total })}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="email-run-chip" data-status={paused ? 'paused' : 'running'}>
      <div
        role="status"
        className={cn(
          'flex items-center gap-[7px] rounded-[20px] border px-[11px] py-[5px] text-caption font-bold',
          paused ? 'border-[color-mix(in_srgb,var(--warn)_25%,transparent)] bg-warn-soft text-fg' : 'border-border bg-surface-2 text-fg-muted',
        )}
      >
        {paused ? <Pause className="size-[13px] text-warn" aria-hidden="true" /> : <Loader2 className="size-[13px] animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />}
        <span data-testid="email-run-count">
          {paused ? t('studio:email.send.run.paused', 'Paused') : t('studio:email.send.run.sending', 'Sending')}
          {' · '}
          {counts}
        </span>
      </div>
      {paused ? null : (
        <Button variant="secondary" iconLeft={<Pause />} loading={pause.isPending} onClick={() => pause.mutate()} data-testid="email-run-pause">
          {t('studio:email.send.run.pause', 'Pause sending')}
        </Button>
      )}
      <Button
        variant="outline"
        iconLeft={<Square />}
        className="border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-surface text-danger hover:bg-surface-3"
        onClick={() => setConfirm(true)}
        data-testid="email-run-stop"
      >
        {t('studio:email.send.run.stop', 'Stop sending')}
      </Button>
      {paused ? (
        <Button iconLeft={<Play className="rtl:-scale-x-100" />} loading={resume.isPending} onClick={() => resume.mutate()} data-testid="email-run-resume">
          {t('studio:email.send.run.resume', 'Go on sending')}
        </Button>
      ) : null}
      <Modal open={confirm} onOpenChange={(open) => !stop.isPending && setConfirm(open)} size="sm" role="alertdialog" className="max-w-[420px]">
        <ModalHeader
          icon={<OctagonX />}
          tone="danger"
          hideClose
          closeLabel={t('studio:marketingMail.close', 'Close')}
          title={t('studio:email.send.run.stopTitle', 'Stop for good?')}
          subtitle={
            <span className="mx-auto mt-1.5 block max-w-[310px] text-body text-fg-muted">
              {t('studio:email.send.run.stopBody', '{count, plural, one {# person won’t} other {# people won’t}} get it. A stopped send can’t be started again.', { count: left })}
            </span>
          }
          className="flex-col items-center px-6 pb-5 pt-6 text-center [&>*:first-child]:mb-1.5 [&>*:first-child]:size-[52px] [&>*:first-child]:rounded-lg [&>*:first-child_svg]:size-6"
        />
        <ModalFooter className="gap-2.5 px-6">
          <Button variant="secondary" className="h-10 flex-1" autoFocus onClick={() => setConfirm(false)} data-testid="email-run-keep">
            {t('studio:email.send.run.keep', 'Keep sending')}
          </Button>
          <Button variant="destructive" className="h-10 flex-1" loading={stop.isPending} onClick={() => stop.mutate()} data-testid="email-run-stop-confirm">
            {t('studio:email.send.run.stop', 'Stop sending')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
