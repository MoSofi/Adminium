// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Email card on a trial: the operator's mail service in place of the mail
 * server fields (the Trial Mode comp, view 6). Everything in it is the
 * operator's, so nothing can be changed: the `send` tile, the title and the
 * "Set by the operator" chip; the From address with where replies go; today's
 * use against the caps with two thin bars; and, while mail waits for a cap,
 * the warning box whose "Open the outbox" lists the waiting emails, read-only.
 *
 * The server sends all of it as `relay` beside the email settings
 * (`apps/server/src/email/trial-relay.ts`). Loaded on its own, and only on a
 * trial: nothing of it is in Studio's settings chunk or the first load.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MailWarning, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconTile, Modal, ModalBody, ModalFooter, ModalHeader, ProgressBar } from '@adminium/ui';

import { api } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { SetByOperatorChip } from '../../settings/SetByOperator.js';

/** `relay` on `GET /settings/email`, on a trial. */
export interface TrialRelayView {
  from: string | null;
  replyTo: string | null;
  caps: { perDay: number; perHour: number; recipientsPerDay: number };
  today: number;
  thisHour: number;
  people: number;
  waiting: number;
  limit: 'day' | 'hour' | 'recipients' | 'bounces' | 'system' | null;
  nextAt: number | null;
}

interface WaitingEmail {
  id: string;
  to: string;
  subject: string;
  queuedAt: number;
  goesOutAt: number;
}

const language = (): string => getI18nInstance()?.language ?? 'en-US';
const timeOf = (at: number): string => new Intl.DateTimeFormat(language(), { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
const dateTimeOf = (at: number): string => new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at));

/** A sentence with two values drawn in mono (marked \u0000 and \u0001), in the reader's word order. */
function withMono(sentence: string, values: readonly [string, string]): ReactNode[] {
  const mono = (value: string, key: string): ReactNode => (
    <span key={key} className="font-mono text-[12.5px]">
      {value}
    </span>
  );
  return sentence.split('\u0000').flatMap((outer, i) => [
    ...(i === 0 ? [] : [mono(values[0], `a${String(i)}`)]),
    ...outer.split('\u0001').flatMap((inner, j) => [...(j === 0 ? [] : [mono(values[1], `b${String(i)}-${String(j)}`)]), inner]),
  ]);
}

/** One thin bar of today's use: accent, warn once it is full. */
function UseBar({ used, cap, label }: { used: number; cap: number; label: string }): ReactNode {
  return <ProgressBar size="md" value={used} max={cap} tone={used >= cap ? 'warn' : 'accent'} animated={false} label={label} />;
}

/** What the warning box says, by the cap that holds mail back. */
function limitSentence(relay: TrialRelayView): string | null {
  const count = relay.waiting;
  const time = relay.nextAt === null ? '' : timeOf(relay.nextAt);
  switch (relay.limit) {
    // With nothing waiting (the mail that met the limit went, or none came since), the limit alone.
    case 'day':
      return count === 0
        ? t('studio:settingsHub.email.relay.limitDayOnly', 'Daily email limit reached.')
        : t('studio:settingsHub.email.relay.limitDay', 'Daily email limit reached. {count, plural, one {# email is waiting and goes out tomorrow.} other {# emails are waiting and go out tomorrow.}}', { count });
    case 'hour':
      return count === 0
        ? t('studio:settingsHub.email.relay.limitHourOnly', 'Hourly email limit reached.')
        : t('studio:settingsHub.email.relay.limitHour', 'Hourly email limit reached. {count, plural, one {# email is waiting and goes out at {time}.} other {# emails are waiting and go out from {time}.}}', { count, time });
    case 'recipients':
      return t('studio:settingsHub.email.relay.limitPeople', 'Today’s limit of {max, number} people is reached. Emails to someone new wait for tomorrow.', { max: relay.caps.recipientsPerDay });
    case 'bounces':
      return t('studio:settingsHub.email.relay.limitBounces', 'Email is paused until tomorrow: too many emails bounced or were reported as spam today.');
    default:
      return count === 0
        ? null
        : t('studio:settingsHub.email.relay.waiting', '{count, plural, one {# email is waiting and goes out at {time}.} other {# emails are waiting; the first goes out at {time}.}}', { count, time });
  }
}

/** The waiting emails, read-only: who, what, when queued, when it goes out. */
function OutboxModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactNode {
  const waiting = useQuery({
    queryKey: ['settings', 'email', 'waiting'],
    queryFn: async () => (await api.get<{ data: WaitingEmail[] }>('/api/v1/settings/email/waiting')).data,
    enabled: open,
  });
  const head = 'px-3 py-2 text-start text-caption font-bold text-fg-muted';
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg">
      <ModalHeader
        icon={<Send aria-hidden />}
        tone="neutral"
        title={t('studio:settingsHub.email.relay.outboxTitle', 'Waiting emails')}
        subtitle={t('studio:settingsHub.email.relay.outboxHelp', 'They go out by themselves when the email limits allow. Nothing here can be changed.')}
        closeLabel={t('studio:settingsHub.email.relay.close', 'Close')}
      />
      <ModalBody>
        {waiting.isError ? (
          <p className="text-body-sm text-danger">{t('studio:settingsHub.email.relay.failed', 'The waiting emails could not be loaded.')}</p>
        ) : waiting.data === undefined ? null : waiting.data.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{t('studio:settingsHub.email.relay.empty', 'No emails are waiting.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-body-sm" data-testid="trial-outbox">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={head}>{t('studio:settingsHub.email.relay.to', 'To')}</th>
                  <th scope="col" className={head}>{t('studio:settingsHub.email.relay.subject', 'Subject')}</th>
                  <th scope="col" className={head}>{t('studio:settingsHub.email.relay.queued', 'Queued')}</th>
                  <th scope="col" className={head}>{t('studio:settingsHub.email.relay.goesOut', 'Goes out')}</th>
                </tr>
              </thead>
              <tbody>
                {waiting.data.map((mail) => (
                  <tr key={mail.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[12.5px]">{mail.to}</td>
                    <td className="px-3 py-2">{mail.subject}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{dateTimeOf(mail.queuedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{dateTimeOf(mail.goesOutAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
          {t('studio:settingsHub.email.relay.close', 'Close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function TrialEmailPanel({ relay }: { relay: TrialRelayView }): ReactNode {
  const [outbox, setOutbox] = useState(false);
  const warning = limitSentence(relay);
  const fromLine =
    relay.from === null
      ? null
      : relay.replyTo === null
        ? [<span key="from" className="font-mono text-[12.5px]">{relay.from}</span>]
        : withMono(t('studio:settingsHub.email.relay.fromLine', '{from}, replies go to {replyTo}', { from: '\u0000', replyTo: '\u0001' }), [relay.from, relay.replyTo]);
  const label = 'font-bold text-fg-muted';
  return (
    <section aria-labelledby="trial-email-relay" className="flex flex-col gap-4" data-testid="trial-email-panel">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile tone="neutral" size="md" icon={<Send />} />
        <h4 id="trial-email-relay" className="min-w-[220px] flex-1 text-[14.5px] font-bold text-fg">
          {t('studio:settingsHub.email.relay.title', 'Email is sent through the operator’s mail service')}
        </h4>
        <SetByOperatorChip />
      </div>
      {fromLine === null ? (
        <p className="text-body-sm text-fg-muted">
          {t('studio:settingsHub.email.relay.noRelay', 'The operator has not set up a mail service for this installation, so no email is sent.')}
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-body-sm sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className={label}>{t('studio:settingsHub.email.relay.from', 'From address')}</dt>
          <dd className="m-0 min-w-0 break-words">{fromLine}</dd>
          <dt className={label}>{t('studio:settingsHub.email.relay.use', 'Today’s use')}</dt>
          <dd className="m-0 flex flex-col gap-2">
            <span>
              {t('studio:settingsHub.email.relay.useLine', '{today, number} of {perDay, number} emails today · {hour, number} of {perHour, number} this hour', {
                today: relay.today,
                perDay: relay.caps.perDay,
                hour: relay.thisHour,
                perHour: relay.caps.perHour,
              })}
            </span>
            <div className="grid max-w-[420px] grid-cols-2 gap-2.5">
              <UseBar used={relay.today} cap={relay.caps.perDay} label={t('studio:settingsHub.email.relay.dayBar', 'Emails today')} />
              <UseBar used={relay.thisHour} cap={relay.caps.perHour} label={t('studio:settingsHub.email.relay.hourBar', 'Emails this hour')} />
            </div>
            <span className="text-caption text-fg-muted">
              {t('studio:settingsHub.email.relay.people', '{people, number} of {max, number} people written to today', { people: relay.people, max: relay.caps.recipientsPerDay })}
            </span>
          </dd>
        </dl>
      )}
      {warning === null ? null : (
        <div role="status" className="flex items-start gap-2.5 rounded-[10px] border border-warn/25 bg-warn-soft px-3.5 py-3 text-body-sm">
          <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="flex-1">
            <p className="m-0 font-semibold">{warning}</p>
            {relay.waiting === 0 ? null : (
              <button type="button" className="mt-1 inline-flex items-center gap-[5px] font-bold text-accent hover:underline" onClick={() => setOutbox(true)}>
                {t('studio:settingsHub.email.relay.open', 'Open the outbox')}
                <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
              </button>
            )}
          </div>
        </div>
      )}
      <OutboxModal open={outbox} onOpenChange={setOutbox} />
    </section>
  );
}

export default TrialEmailPanel;
