// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Send campaign (39 D11). The comp leaves it undrawn (§0.2 row 15: *Send
 * campaign* toasts "Campaign sent"), so it borrows the test-send modal's
 * anatomy (comp 67-115): header icon/title/subtitle, labelled fields, an
 * info box, a footer count, Cancel/primary, then a success phase. *Send to*
 * = Workspace users with the roles as chips (none = everyone); *When* = Now
 * / Schedule with a date-time in the actor's zone (stored as epoch ms); the
 * count comes from `POST /:id/audience/preview`; success reads *Campaign
 * sent!* / *Campaign scheduled!*. The caller saves first (D1) and POSTs
 * `/send`.
 */
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Info, Send, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { Button, ChoiceChips, DateInput, ModalBody, ModalFooter, ModalHeader, SegmentedControl, TwoPhaseModal, useModalFlow } from '@adminium/ui';

import { bootstrapQuery } from '../../../app/bootstrap.js';
import { t } from '../../../i18n/t.js';
import { rolesQuery } from '../../../team/rolesApi.js';
import { formatStamp } from '../../../team/teamApi.js';
import { emailApi, type EmailAudience, type EmailRunView } from '../../api.js';
import { EMAIL_DOCUMENTS_KEY } from '../../queries.js';

export interface SendCampaignBody {
  audience: EmailAudience;
  scheduleAt?: number | undefined;
}

export interface SendCampaignModalProps {
  documentId: string;
  documentName: string;
  subject: string;
  /** Saves the draft first (D1), then `POST /send`; resolves with the run. */
  onSend: (body: SendCampaignBody) => Promise<EmailRunView>;
  onClose: () => void;
}

type When = 'now' | 'schedule';

/** A `datetime-local` value → epoch ms in the actor's zone; `NaN` while incomplete. */
export function scheduleAtFromInput(value: string): number {
  return value === '' ? Number.NaN : new Date(value).getTime();
}

/** The picker's floor: now, in the actor's zone, to the minute. */
function localMinute(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SendCampaignModal({ documentId, documentName, subject, onSend, onClose }: SendCampaignModalProps) {
  const flow = useModalFlow<{ run: EmailRunView; total: number; when: When }>();
  const bootstrap = useQuery(bootstrapQuery()).data;
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const roles = useQuery({ ...rolesQuery(), retry: false }).data ?? [];
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [when, setWhen] = useState<When>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audience = useMemo<EmailAudience>(() => (roleIds.length === 0 ? { kind: 'users' } : { kind: 'users', roleIds }), [roleIds]);
  const preview = useQuery({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'audience', documentId, roleIds] as const,
    queryFn: () => emailApi.previewAudience(documentId, audience),
    retry: false,
  });
  const total = preview.data?.total ?? 0;
  const skipped = preview.data?.skipped ?? 0;
  const scheduleAt = scheduleAtFromInput(at);
  const scheduleValid = when === 'now' || (Number.isFinite(scheduleAt) && scheduleAt > Date.now());

  const send = async () => {
    if (busy || !scheduleValid) return;
    setBusy(true);
    setError(null);
    try {
      const run = await onSend(when === 'schedule' ? { audience, scheduleAt } : { audience });
      flow.toSuccess({ run, total, when });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('email:campaign.failed', 'The campaign could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TwoPhaseModal
      open
      size="md"
      flow={flow}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      successTitle={(payload) => (payload.when === 'schedule' ? t('email:campaign.scheduledTitle', 'Campaign scheduled!') : t('email:campaign.sentTitle', 'Campaign sent!'))}
      successBody={(payload) =>
        payload.when === 'schedule'
          ? t('email:campaign.scheduledBody', '{name} goes out {when}.', { name: documentName, when: formatStamp(payload.run.scheduledAt, localeTag) ?? '' })
          : t('email:campaign.sentBody', '{name} is on its way to {count, plural, one {# recipient} other {# recipients}}.', {
              name: documentName,
              count: payload.total,
            })
      }
      doneLabel={t('email:campaign.done', 'Done')}
    >
      <ModalHeader icon={<Send />} title={t('email:campaign.title', 'Send campaign')} subtitle={`${documentName} · ${subject}`} closeLabel={t('common.close', 'Close')} />
      <ModalBody className="flex flex-col gap-[15px]">
        <div className="flex flex-col gap-2">
          <span id="email-campaign-to-label" className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
            {t('email:campaign.sendTo', 'Send to')}
          </span>
          <div className="flex items-start gap-[9px] rounded-[11px] border border-border bg-surface-2 px-3 py-2.5">
            <Users className="mt-px size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-extrabold text-fg">{t('email:campaign.workspaceUsers', 'Workspace users')}</div>
              <div className="text-[11px] text-fg-subtle">{t('email:campaign.rolesHint', 'Everyone, or only the holders of the roles you pick.')}</div>
            </div>
          </div>
          {roles.length === 0 ? null : (
            <ChoiceChips
              multiple
              aria-labelledby="email-campaign-to-label"
              data-testid="email-campaign-roles"
              className="flex flex-wrap gap-1.5"
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
              value={roleIds}
              onValueChange={setRoleIds}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span id="email-campaign-when-label" className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
            {t('email:campaign.when', 'When')}
          </span>
          <SegmentedControl
            aria-labelledby="email-campaign-when-label"
            data-testid="email-campaign-when"
            options={[
              { value: 'now', label: t('email:campaign.now', 'Now'), icon: <Send /> },
              { value: 'schedule', label: t('email:campaign.schedule', 'Schedule'), icon: <CalendarClock /> },
            ]}
            value={when}
            onValueChange={(value) => setWhen(value === 'schedule' ? 'schedule' : 'now')}
          />
          {when === 'schedule' ? (
            <div className="flex flex-col gap-1">
              <DateInput
                type="datetime-local"
                aria-label={t('email:campaign.scheduleAt', 'Send at')}
                data-testid="email-campaign-at"
                min={localMinute(Date.now())}
                value={at}
                error={at !== '' && !scheduleValid}
                onChange={(event) => setAt(event.target.value)}
              />
              {at !== '' && !scheduleValid ? <span className="text-[11px] text-danger">{t('email:campaign.pastTime', 'Pick a time in the future.')}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-start gap-[9px] rounded-[11px] bg-accent-soft px-[13px] py-[11px]">
          <Info className="mt-px size-[15px] shrink-0 text-accent" aria-hidden="true" />
          <span className="text-[11.5px] leading-[1.5] text-fg-muted">
            {t('email:campaign.note', 'Variables are filled per recipient — {token} becomes each person’s name.', { token: '{{name}}' })}
          </span>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="me-auto text-[11.5px] text-fg-subtle" data-testid="email-campaign-count">
          {preview.isPending
            ? t('email:campaign.counting', 'Counting recipients…')
            : preview.isError
              ? t('email:campaign.countFailed', 'Couldn’t count recipients')
              : skipped > 0
                ? `${t('email:campaign.count', '{total, plural, one {# recipient} other {# recipients}}', { total })} · ${t('email:campaign.optedOut', '{skipped} opted out', { skipped })}`
                : t('email:campaign.count', '{total, plural, one {# recipient} other {# recipients}}', { total })}
        </span>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          iconLeft={when === 'schedule' ? <CalendarClock /> : <Send />}
          disabled={!scheduleValid}
          loading={busy}
          onClick={() => {
            void send();
          }}
          data-testid="email-campaign-send"
        >
          {busy ? t('email:campaign.sending', 'Sending…') : when === 'schedule' ? t('email:campaign.scheduleAction', 'Schedule campaign') : t('email:campaign.send', 'Send campaign')}
        </Button>
      </ModalFooter>
    </TwoPhaseModal>
  );
}
