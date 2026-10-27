// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Send campaign (comp `Email To Contacts.dc.html` 1a–1e, 36-353). The
 * editor loads it lazily (`lazy.ts`) and saves the draft
 * before it POSTs `/send` (D1).
 *
 *  - "Send to": two radio cards, "Workspace users" (everyone, or the holders
 *    of the roles picked as chips) and "People in a table". The table card is
 *    the default once the server lists a table this person may send to.
 *  - A table: "Table" (the picker lists the tables an app declares as people
 *    and this person reads; its foot opens the table's e-mail settings, and a
 *    switched-off table is offered as "open its e-mail settings"), "Only
 *    these" (the table's saved views), "Why you're writing" (Newsletter /
 *    Surveys), and "Also existing customers who didn't tick" only where the
 *    table's owner switched that basis on.
 *  - The breakdown (the server's count), the fixed marketing line, "When"
 *    and "Sending speed" (default "At most 100 an hour", with the estimate),
 *    the click switch (off unless turned on), the variables note, and the
 *    footer count "{n} recipients · {m} skipped".
 *  - 1b: people ticked before records were kept wait for a review: a warning
 *    card with "Review the {n}" and "Send to the {m} with a record"; the
 *    footer's Send waits while it is there.
 *  - 1c: the sender's refusals (the preview lists them; the send answers
 *    409 `SENDER_REFUSED` with the same codes): a danger card, one row each
 *    with its fix link. Send is disabled.
 *  - 1d: a table this person can no longer send to (masked or hidden
 *    addresses, no read): the Table field turns danger with a lock, a danger
 *    alert says why, and the breakdown, estimate and footer count are gone,
 *    so nothing about the table leaks.
 *  - 1e: success, "Campaign scheduled!" with when and the cap, or "Campaign
 *    sent!".
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarClock, ChevronDown, Contact, EyeOff, Filter, Info, ListChecks, Lock, Send, Settings2, ShieldCheck, Table2, TriangleAlert } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import {
  Button,
  ChoiceChips,
  DateInput,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  Switch,
  TwoPhaseModal,
  cn,
  useModalFlow,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { rolesQuery } from '../../team/rolesApi.js';
import { formatStamp } from '../../team/teamApi.js';
import {
  emailApi,
  type EmailAudience,
  type EmailAudienceRefusal,
  type EmailAudienceTable,
  type EmailPurpose,
  type EmailRunView,
  type EmailSendBody,
  type EmailSenderRefusal,
} from '../../email/api.js';
import { EMAIL_DOCUMENTS_KEY } from '../../email/queries.js';
import { TableEmailSheetLazy } from '../marketing/tableEmailSheetLazy.js';
import { BreakdownCard } from './BreakdownCard.js';
import { AUDIENCE_KEY, StudioWords, audienceRefusalText, audienceTablesQuery, audienceViewsQuery, peopleTablesQuery, purposeLabel } from './campaignWords.js';
import { RefusalCard } from './RefusalCard.js';
import { ReviewView } from './ReviewView.js';

export interface SendCampaignModalProps {
  documentId: string;
  documentName: string;
  subject: string;
  /** Saves the draft first (D1), then `POST /send`; resolves with the run. */
  onSend: (body: EmailSendBody) => Promise<EmailRunView>;
  onClose: () => void;
}

type When = 'now' | 'schedule';
type To = 'users' | 'table';

/** The comp's default cap: "At most 100 an hour". */
export const DEFAULT_RATE = 100;
const RATE_MAX = 100_000;

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

/** A whole number of mails an hour from the field, or null when it is not one. */
export function rateFromInput(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 1 && n <= RATE_MAX ? n : null;
}

interface Success {
  run: EmailRunView;
  total: number;
  when: When;
  rate: number | null;
}

const fieldLabel = 'text-body-sm font-bold text-fg';
const sectionLabel = 'text-micro uppercase text-fg-subtle';

export function SendCampaignModal(props: SendCampaignModalProps): ReactNode {
  return <SendCampaignDialog {...props} />;
}

function SendCampaignDialog({ documentId, documentName, subject, onSend, onClose }: SendCampaignModalProps): ReactNode {
  const flow = useModalFlow<Success>();
  const queryClient = useQueryClient();
  const bootstrap = useQuery(bootstrapQuery()).data;
  const me = bootstrap?.user.id ?? null;
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const roles = useQuery({ ...rolesQuery(), retry: false }).data ?? [];
  const tablesQuery = useQuery(audienceTablesQuery());
  const offTablesQuery = useQuery(peopleTablesQuery());
  const tables = useMemo(() => tablesQuery.data?.tables ?? [], [tablesQuery.data]);
  const switchedOff = (offTablesQuery.data?.tables ?? []).filter((one) => !one.canEmail);

  const [chosenTo, setChosenTo] = useState<To | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<{ connectionId: string; table: string } | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [purposeChoice, setPurposeChoice] = useState<EmailPurpose | null>(null);
  const [existing, setExisting] = useState(false);
  const [when, setWhen] = useState<When>('now');
  const [at, setAt] = useState('');
  const [speed, setSpeed] = useState<'fast' | 'cap'>('cap');
  const [rateText, setRateText] = useState(String(DEFAULT_RATE));
  const [trackClicks, setTrackClicks] = useState(false);
  const [view, setView] = useState<'form' | 'review'>('form');
  const [sheet, setSheet] = useState<{ connectionId: string; table: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentRefusals, setSentRefusals] = useState<EmailSenderRefusal[] | null>(null);

  // A table is the default once the server lists one this person may pick; "Workspace users" otherwise.
  // Until the list is in, nothing is counted: the dialog would count one audience and then another.
  const decided = chosenTo !== null || !tablesQuery.isPending;
  const to: To = chosenTo ?? (tables.length > 0 ? 'table' : 'users');
  const table: EmailAudienceTable | null =
    (picked === null ? null : (tables.find((one) => one.connectionId === picked.connectionId && one.table === picked.table) ?? null)) ??
    tables.find((one) => one.addresses === 'readable') ??
    tables[0] ??
    null;
  const purpose: EmailPurpose = purposeChoice ?? table?.consentPurpose ?? 'newsletter';
  const switchOn = table !== null && table.existingCustomers.offered && table.existingCustomers.on;
  const blockedBy: EmailAudienceRefusal | null = table === null ? null : table.addresses === 'masked' ? 'addresses-masked' : table.addresses === 'hidden' ? 'addresses-hidden' : null;
  const rate = speed === 'cap' ? rateFromInput(rateText) : null;
  const rateValid = speed === 'fast' || rate !== null;

  const views = useQuery({ ...audienceViewsQuery(table?.connectionId ?? '', table?.table ?? ''), enabled: to === 'table' && table !== null && blockedBy === null });

  const audience = useMemo<EmailAudience | null>(() => {
    if (to === 'users') return roleIds.length === 0 ? { kind: 'users' } : { kind: 'users', roleIds };
    if (table === null) return null;
    return {
      kind: 'table',
      connectionId: table.connectionId,
      table: table.table,
      ...(viewId === null ? {} : { viewId }),
      purpose,
      ...(switchOn && existing ? { existingCustomers: true } : {}),
    };
  }, [to, roleIds, table, viewId, purpose, switchOn, existing]);

  const previewKey = [...EMAIL_DOCUMENTS_KEY, 'audience', documentId, audience, rate] as const;
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: () => emailApi.previewAudience(documentId, audience!, rate),
    enabled: decided && audience !== null && blockedBy === null,
    retry: false,
  });
  // A table the server now refuses by name (lost the right to read it, a view gone…): the dialog's 1d.
  const refusedBy: EmailAudienceRefusal | null =
    blockedBy ??
    (preview.error instanceof ApiError && preview.error.code === 'AUDIENCE_REFUSED' ? (((preview.error.details as { reason?: EmailAudienceRefusal } | undefined)?.reason ?? 'cannot-read') as EmailAudienceRefusal) : null);
  const tableRefused = to === 'table' && refusedBy !== null && refusedBy !== 'view-gone' && refusedBy !== 'view-search' && refusedBy !== 'view-hidden-column';

  // A new audience asks again: what the last send refused with is the preview's to say now.
  useEffect(() => {
    setSentRefusals(null);
    setError(null);
  }, [audience]);

  const breakdown = to === 'table' ? preview.data?.breakdown : undefined;
  const refusals = sentRefusals ?? (to === 'table' ? (preview.data?.refusals ?? []) : []);
  const unfilled = preview.data?.unfilled ?? [];
  const recipients = to === 'table' ? (breakdown?.recipients ?? 0) : Math.max(0, (preview.data?.total ?? 0) - (preview.data?.skipped ?? 0));
  const skipped = preview.data?.skipped ?? 0;
  const awaitingReview = breakdown?.awaitingReview ?? 0;
  const scheduleAt = scheduleAtFromInput(at);
  const scheduleValid = when === 'now' || (Number.isFinite(scheduleAt) && scheduleAt > Date.now());
  const ready = preview.isSuccess && !tableRefused && refusedBy === null && refusals.length === 0 && unfilled.length === 0 && scheduleValid && rateValid && (to === 'users' || recipients > 0);

  const send = async () => {
    if (busy || audience === null || !scheduleValid || !rateValid) return;
    setBusy(true);
    setError(null);
    try {
      const body: EmailSendBody = {
        audience,
        ...(when === 'schedule' ? { scheduleAt } : {}),
        ...(rate === null ? {} : { ratePerHour: rate }),
        ...(to === 'table' && trackClicks ? { trackClicks: true } : {}),
      };
      const run = await onSend(body);
      flow.toSuccess({ run, total: recipients, when, rate });
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'SENDER_REFUSED') {
        setSentRefusals(((failure.details as { refusals?: EmailSenderRefusal[] } | undefined)?.refusals ?? []).slice());
      } else {
        setError(failure instanceof Error ? failure.message : t('studio:email.send.dialog.failed', 'The campaign could not be sent.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const tableLabel = table?.label ?? '';
  const pickTable = (connectionId: string, name: string) => {
    setPicked({ connectionId, table: name });
    setViewId(null);
    setPurposeChoice(null);
    setExisting(false);
  };

  const estimate =
    speed === 'cap' && preview.data?.estimateMinutes != null && recipients > 0
      ? t('studio:email.send.estimate', 'About {hours, plural, one {# hour} other {# hours}} for {count, plural, one {# person} other {# people}}.', {
          hours: Math.max(1, Math.round(preview.data.estimateMinutes / 60)),
          count: recipients,
        })
      : null;

  return (
    <TwoPhaseModal
      open
      size="lg"
      className="max-w-[568px]"
      flow={flow}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      successTitle={(payload) => (payload.when === 'schedule' ? t('studio:email.send.dialog.scheduledTitle', 'Campaign scheduled!') : t('studio:email.send.dialog.sentTitle', 'Campaign sent!'))}
      successBody={(payload) => successBody(payload, documentName, localeTag)}
      successProps={flow.payload?.when === 'schedule' ? { icon: <CalendarCheck /> } : undefined}
      doneLabel={t('studio:email.send.dialog.done', 'Done')}
    >
      {view === 'review' && table !== null ? (
        <ReviewView
          connectionId={table.connectionId}
          table={table.table}
          label={tableLabel}
          waiting={awaitingReview}
          localeTag={localeTag}
          onDone={() => {
            setView('form');
            void queryClient.invalidateQueries({ queryKey: [...EMAIL_DOCUMENTS_KEY, 'audience', documentId] });
            void queryClient.invalidateQueries({ queryKey: [...AUDIENCE_KEY, 'review'] });
          }}
        />
      ) : (
        <>
          <ModalHeader
            className="border-b border-border pb-[18px] pt-[18px]"
            icon={<Send />}
            title={t('studio:email.send.dialog.title', 'Send campaign')}
            subtitle={<span className="block truncate text-caption text-fg-subtle">{`${documentName} · ${subject}`}</span>}
            closeLabel={t('common.close', 'Close')}
          />
          <ModalBody className="flex flex-col gap-4 pt-[18px]">
            <div className="flex flex-col gap-[7px]">
              <span id="email-campaign-to-label" className={sectionLabel}>
                {t('studio:email.send.dialog.sendTo', 'Send to')}
              </span>
              <RadioGroup
                aria-labelledby="email-campaign-to-label"
                value={to}
                onValueChange={(value) => setChosenTo(value === 'table' ? 'table' : 'users')}
                className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2"
                data-testid="email-send-to"
              >
                <RadioCard
                  value="users"
                  hideIndicator
                  className="rounded-[10px] p-3 data-[state=checked]:border-[1.5px]"
                  icon={<RadioDot />}
                  title={<span className="font-bold">{t('studio:email.send.dialog.workspaceUsers', 'Workspace users')}</span>}
                  description={t('studio:email.send.dialog.rolesHint', 'Everyone, or only the holders of the roles you pick.')}
                />
                <RadioCard
                  value="table"
                  hideIndicator
                  disabled={tables.length === 0}
                  className="rounded-[10px] p-3 data-[state=checked]:border-[1.5px]"
                  icon={<RadioDot />}
                  title={<span className="font-bold">{t('studio:email.send.tablePeople', 'People in a table')}</span>}
                />
              </RadioGroup>
              {to === 'users' && roles.length > 0 ? (
                <ChoiceChips
                  multiple
                  aria-labelledby="email-campaign-to-label"
                  data-testid="email-campaign-roles"
                  className="flex flex-wrap gap-1.5"
                  options={roles.map((role) => ({ value: role.id, label: role.name }))}
                  value={roleIds}
                  onValueChange={setRoleIds}
                />
              ) : null}
            </div>

            {to === 'table' && table !== null ? (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span id="email-send-table-label" className={fieldLabel}>
                      {t('studio:email.send.table', 'Table')}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-labelledby="email-send-table-label email-send-table-value"
                          data-testid="email-send-table"
                          className={cn(
                            'flex items-center gap-2 rounded-[10px] border bg-surface px-[11px] py-[9px] text-start text-body text-fg hover:bg-surface-3',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                            tableRefused ? 'border-danger' : 'border-border-strong',
                          )}
                        >
                          {tableRefused ? <Lock className="size-[15px] shrink-0 text-danger" aria-hidden="true" /> : <Table2 className="size-[15px] shrink-0 text-fg-muted" aria-hidden="true" />}
                          <span id="email-send-table-value" className="min-w-0 flex-1 truncate">
                            {tableName(table.label, table.appName)}
                          </span>
                          <ChevronDown className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[300px] rounded-xl p-[7px]">
                        <DropdownMenuRadioGroup value={`${table.connectionId}\u0000${table.table}`} onValueChange={(value) => pickTable(...(value.split('\u0000') as [string, string]))}>
                          {tables.map((one) => (
                            <DropdownMenuRadioItem key={`${one.connectionId}/${one.table}`} value={`${one.connectionId}\u0000${one.table}`} icon={<Contact />}>
                              {tableName(one.label, one.appName)}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {switchedOff.length === 0 ? null : (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{t('studio:email.send.switchedOff', 'Switched off')}</DropdownMenuLabel>
                            {switchedOff.map((one) => (
                              <DropdownMenuItem key={`${one.connectionId}/${one.table}`} icon={<Settings2 />} onSelect={() => setSheet({ connectionId: one.connectionId, table: one.table })}>
                                {t('studio:email.send.switchedOffItem', '{table}: open its e-mail settings', { table: tableName(one.label, one.appName) })}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem icon={<Settings2 />} className="font-bold" onSelect={() => setSheet({ connectionId: table.connectionId, table: table.table })}>
                          {t('studio:email.send.settingsFor', 'E-mail settings for {table}', { table: tableLabel })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      data-testid="email-send-table-settings"
                      onClick={() => setSheet({ connectionId: table.connectionId, table: table.table })}
                      className="inline-flex items-center gap-[5px] self-start text-caption font-semibold text-accent hover:underline"
                    >
                      <Settings2 className="size-[13px]" aria-hidden="true" />
                      {t('studio:email.send.settingsFor', 'E-mail settings for {table}', { table: tableLabel })}
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span id="email-send-only-label" className={fieldLabel}>
                      {t('studio:email.send.only', 'Only these')}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={tableRefused}>
                        <button
                          type="button"
                          aria-labelledby="email-send-only-label email-send-only-value"
                          data-testid="email-send-view"
                          className="flex items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-[11px] py-[9px] text-start text-body text-fg hover:bg-surface-3 disabled:opacity-50"
                        >
                          <Filter className="size-[15px] shrink-0 text-fg-muted" aria-hidden="true" />
                          <span id="email-send-only-value" className="min-w-0 flex-1 truncate">
                            {viewId === null ? t('studio:email.send.allRows', 'All of {table}', { table: tableLabel }) : (views.data?.views.find((one) => one.id === viewId)?.name ?? '')}
                          </span>
                          <ChevronDown className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[260px] rounded-xl p-[7px]">
                        <DropdownMenuRadioGroup value={viewId ?? ''} onValueChange={(value) => setViewId(value === '' ? null : value)}>
                          <DropdownMenuRadioItem value="">{t('studio:email.send.allRows', 'All of {table}', { table: tableLabel })}</DropdownMenuRadioItem>
                          {(views.data?.views ?? []).map((one) => (
                            <DropdownMenuRadioItem key={one.id} value={one.id} disabled={one.refused !== null} description={one.refused === null ? undefined : audienceRefusalText(one.refused, tableLabel)}>
                              {one.name}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span id="email-send-why-label" className={fieldLabel}>
                    {t('studio:email.send.why', 'Why you’re writing')}
                  </span>
                  <SegmentedControl
                    aria-labelledby="email-send-why-label"
                    data-testid="email-send-why"
                    options={[
                      { value: 'newsletter', label: purposeLabel('newsletter') },
                      { value: 'surveys', label: purposeLabel('surveys') },
                    ]}
                    value={purpose}
                    onValueChange={(value) => setPurposeChoice(value === 'surveys' ? 'surveys' : 'newsletter')}
                  />
                </div>

                {switchOn ? (
                  <div className="flex items-start gap-3 rounded-[10px] border border-border px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div id="email-send-existing-label" className="text-body font-bold text-fg">
                        {t('studio:email.send.existing', 'Also existing customers who didn’t tick')}
                      </div>
                      <div className="mt-0.5 text-caption text-fg-muted">{existingLine(table, me, localeTag)}</div>
                    </div>
                    <Switch aria-labelledby="email-send-existing-label" data-testid="email-send-existing" checked={existing} onCheckedChange={setExisting} />
                  </div>
                ) : null}

                {tableRefused || (refusedBy !== null && to === 'table') ? (
                  <div role="alert" data-testid="email-send-refused" className="flex gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-danger-soft px-3.5 py-[13px]">
                    <EyeOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                    <div className="flex-1 text-body font-bold text-fg">{audienceRefusalText(refusedBy ?? 'cannot-read', tableLabel)}</div>
                  </div>
                ) : breakdown === undefined ? null : (
                  <BreakdownCard breakdown={breakdown} purpose={purpose} existing={switchOn && existing} />
                )}

                {!tableRefused && awaitingReview > 0 && refusals.length === 0 ? (
                  <div role="alert" data-testid="email-send-review-card" className="flex gap-[11px] rounded-xl border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-warn-soft px-4 py-3.5">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col gap-[11px]">
                      <div className="text-body font-bold text-fg">
                        {t('studio:email.send.review.card', '{count, plural, one {# person says} other {# people say}} yes but {count, plural, one {was} other {were}} ticked before records were kept. Confirm them before sending?', { count: awaitingReview })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" iconLeft={<ListChecks />} onClick={() => setView('review')} data-testid="email-send-review-open">
                          {t('studio:email.send.review.open', 'Review the {count}', { count: awaitingReview })}
                        </Button>
                        <Button
                          size="sm"
                          iconLeft={<Send />}
                          disabled={busy || recipients === 0 || !scheduleValid || !rateValid || unfilled.length > 0}
                          onClick={() => {
                            void send();
                          }}
                          data-testid="email-send-with-record"
                        >
                          {t('studio:email.send.withRecord', 'Send to the {count} with a record', { count: recipients })}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {refusals.length > 0 && !tableRefused ? <RefusalCard refusals={refusals} sender={preview.data?.sender} /> : null}

                <div className="flex items-start gap-[9px] rounded-[10px] bg-surface-3 px-[13px] py-[11px]">
                  <ShieldCheck className="mt-0.5 size-[15px] shrink-0 text-fg-muted" aria-hidden="true" />
                  <span className="text-body-sm text-fg">{t('studio:email.send.marketingLine', 'This is marketing mail. Every copy carries an unsubscribe link, and the do-not-email list is always skipped.')}</span>
                </div>
              </>
            ) : null}

            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              <div className="flex flex-col gap-2">
                <span id="email-campaign-when-label" className={sectionLabel}>
                  {t('studio:email.send.dialog.when', 'When')}
                </span>
                <SegmentedControl
                  aria-labelledby="email-campaign-when-label"
                  data-testid="email-campaign-when"
                  className="self-start"
                  options={[
                    { value: 'now', label: t('studio:email.send.dialog.now', 'Now') },
                    { value: 'schedule', label: t('studio:email.send.dialog.schedule', 'Schedule') },
                  ]}
                  value={when}
                  onValueChange={(value) => setWhen(value === 'schedule' ? 'schedule' : 'now')}
                />
                {when === 'schedule' ? (
                  <div className="flex flex-col gap-1">
                    <DateInput
                      type="datetime-local"
                      aria-label={t('studio:email.send.dialog.scheduleAt', 'Send at')}
                      data-testid="email-campaign-at"
                      min={localMinute(Date.now())}
                      value={at}
                      error={at !== '' && !scheduleValid}
                      onChange={(event) => setAt(event.target.value)}
                    />
                    {at !== '' && !scheduleValid ? <span className="text-[11px] text-danger">{t('studio:email.send.dialog.pastTime', 'Pick a time in the future.')}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <span id="email-send-speed-label" className={sectionLabel}>
                  {t('studio:email.send.speed', 'Sending speed')}
                </span>
                <RadioGroup aria-labelledby="email-send-speed-label" value={speed} onValueChange={(value) => setSpeed(value === 'fast' ? 'fast' : 'cap')} className="flex flex-col gap-1.5" data-testid="email-send-speed">
                  <Radio value="fast" label={t('studio:email.send.fast', 'As fast as your mail server allows')} />
                  <div className="flex flex-wrap items-center gap-[9px] text-body">
                    <Radio value="cap" label={t('studio:email.send.atMost', 'At most')} />
                    <Input
                      aria-label={t('studio:email.send.perHour', 'Mails an hour')}
                      inputMode="numeric"
                      dir="ltr"
                      data-testid="email-send-rate"
                      value={rateText}
                      disabled={speed !== 'cap'}
                      error={speed === 'cap' && rate === null}
                      onChange={(event) => setRateText(event.target.value)}
                      mono
                      className="w-16 px-2 py-1.5 text-center text-body-sm"
                    />
                    <span className="text-fg">{t('studio:email.send.anHour', 'an hour')}</span>
                  </div>
                </RadioGroup>
                {estimate === null || tableRefused ? null : (
                  <span data-testid="email-send-estimate" className="text-caption text-fg-muted">
                    {estimate}
                  </span>
                )}
              </div>
            </div>

            {to === 'table' ? (
              <div className="flex items-start gap-3 rounded-[10px] border border-border px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div id="email-send-clicks-label" className="text-body font-bold text-fg">
                    {t('studio:email.send.clicks', 'Count clicks on links')}
                  </div>
                  <div className="mt-0.5 text-caption text-fg-muted">
                    {t('studio:email.send.clicksHint', 'Each link goes through this server first, so the send log can say who clicked. Off unless you turn it on.')}
                  </div>
                </div>
                <Switch aria-labelledby="email-send-clicks-label" data-testid="email-send-clicks" checked={trackClicks} onCheckedChange={setTrackClicks} />
              </div>
            ) : null}

            {unfilled.length === 0 ? null : (
              <p role="alert" data-testid="email-campaign-unfilled" className="rounded-[11px] bg-danger-soft px-[13px] py-[11px] text-[11.5px] font-semibold leading-[1.5] text-danger">
                {t('studio:email.send.dialog.unfilled', 'Nothing fills {names}: every recipient would get it as written. Give it a backup in the editor, or take it out.', {
                  names: unfilled.map((name) => `{{${name}}}`).join(', '),
                })}
              </p>
            )}
            <div className="flex items-start gap-[9px] rounded-[10px] bg-info-soft px-[13px] py-[11px]">
              <Info className="mt-0.5 size-[15px] shrink-0 text-info" aria-hidden="true" />
              <span className="text-body-sm text-fg">{t('studio:email.send.dialog.note', 'Variables are filled per recipient — {token} becomes each person’s name.', { token: '{{name}}' })}</span>
            </div>
            {error === null ? null : (
              <p role="alert" className="text-body-sm text-danger">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter className="flex-wrap px-5 py-3.5">
            <span className="me-auto font-mono text-caption text-fg-muted" data-testid="email-campaign-count">
              {to === 'table' && tableRefused
                ? ''
                : preview.isPending
                  ? t('studio:email.send.dialog.counting', 'Counting recipients…')
                  : preview.isError
                    ? t('studio:email.send.dialog.countFailed', 'Couldn’t count recipients')
                    : skipped > 0
                      ? t('studio:email.send.count', '{count, plural, one {# recipient} other {# recipients}} · {skipped} skipped', { count: recipients, skipped })
                      : t('studio:email.send.dialog.count', '{total, plural, one {# recipient} other {# recipients}}', { total: recipients })}
            </span>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              iconLeft={when === 'schedule' ? <CalendarClock /> : <Send />}
              disabled={!ready || (to === 'table' && awaitingReview > 0)}
              loading={busy}
              onClick={() => {
                void send();
              }}
              data-testid="email-campaign-send"
            >
              {busy ? t('studio:email.send.dialog.sending', 'Sending…') : when === 'schedule' ? t('studio:email.send.dialog.scheduleAction', 'Schedule campaign') : t('studio:email.send.dialog.send', 'Send campaign')}
            </Button>
          </ModalFooter>
        </>
      )}
      {sheet === null ? null : (
        <Suspense fallback={null}>
          <TableEmailSheetLazy
            open
            onOpenChange={(open) => {
              if (!open) setSheet(null);
            }}
            connectionId={sheet.connectionId}
            table={sheet.table}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: [...EMAIL_DOCUMENTS_KEY, 'audience', documentId] });
            }}
          />
        </Suspense>
      )}
    </TwoPhaseModal>
  );
}

/** A table's name in the picker: "Contacts — Sales CRM". */
function tableName(label: string, app: string): string {
  return app === '' ? label : t('studio:email.send.tableName', '{table} — {app}', { table: label, app });
}

/** The leading radio dot of a "Send to" card, drawn as the comp draws it. */
function RadioDot(): ReactNode {
  return <span className="mt-0.5 block size-4 rounded-full border-[1.5px] border-border-strong bg-surface group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-accent" />;
}

/** "Where the law allows it. You turned this on for Contacts on 2 Jul." */
function existingLine(table: EmailAudienceTable, me: string | null, localeTag: string): string {
  const { at, by } = table.existingCustomers;
  const date = at === null ? '' : new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short' }).format(at);
  if (by !== null && by.id !== me && date !== '') {
    return t('studio:email.send.existingByOther', 'Where the law allows it. {name} turned this on for {table} on {date}.', { name: by.name, table: table.label, date });
  }
  if (date !== '') return t('studio:email.send.existingByYou', 'Where the law allows it. You turned this on for {table} on {date}.', { table: table.label, date });
  return t('studio:email.send.existingSub', 'Where the law allows it.');
}

function successBody(payload: Success, name: string, localeTag: string): string {
  if (payload.when !== 'schedule') {
    return t('studio:email.send.dialog.sentBody', '{name} is on its way to {count, plural, one {# recipient} other {# recipients}}.', { name, count: payload.total });
  }
  const at = payload.run.scheduledAt;
  const day = new Intl.DateTimeFormat(localeTag, { weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  const time = new Intl.DateTimeFormat(localeTag, { hour: '2-digit', minute: '2-digit' }).format(at);
  if (payload.rate !== null) {
    return t('studio:email.send.scheduledCapped', '{name} goes out {day} at {time}, at most {rate} an hour.', { name, day, time, rate: payload.rate });
  }
  return t('studio:email.send.dialog.scheduledBody', '{name} goes out {when}.', { name, when: formatStamp(at, localeTag) ?? '' });
}

/** The dialog with the Studio's words waited for: what the editor renders under its `<Suspense>`. */
export function SendCampaignModalWithWords(props: SendCampaignModalProps): ReactNode {
  return (
    <StudioWords>
      <SendCampaignModal {...props} />
    </StudioWords>
  );
}
