// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled Reports (M7 reports track; comp: Scheduled Reports
 * .dc.html): the recurring-report manager — list rows through
 * `scheduled-jobs-list` (the §11.2 master-list consistency choice) with a
 * live enable toggle, plus a create/edit modal over the §3.24 schedule
 * fields. The server computes `next_run_at` with croner; this page only
 * displays it.
 *
 * DELIVERY HONESTY (§8.2): the stored `format` is the §3.24 `pdf | png`
 * INTENT. This build delivers every run as a CSV data snapshot through the
 * export pipeline plus an in-app notification — the format control says
 * exactly that, and recipients are stored-not-emailed (no SMTP), which the
 * recipients field explains inline.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
} from '@adminium/ui';
import { ScheduledJobsList, type ScheduledJob } from '@adminium/widgets';

import { bootstrapQuery, flattenNav } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import {
  scheduledReportsApi,
  scheduledReportsQuery,
  type ReportFormat,
  type ReportScheduleDto,
  type ScheduledReportDto,
} from './api.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The repo's non-inflecting `{arg}` substitution (works pre-i18n-init too). */
function fmt(template: string, args: Record<string, string | number>): string {
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    args[name] === undefined ? match : String(args[name]),
  );
}

/** Human cadence line ("Weekly · Mon at 09:00 (UTC)") for the list rows. */
export function cadenceLabel(schedule: ReportScheduleDto): string {
  const zone = schedule.timezone;
  switch (schedule.frequency) {
    case 'daily':
      return fmt(t('reports.cadence.daily', 'Daily at {time} ({zone})'), {
        time: schedule.time,
        zone,
      });
    case 'weekly':
      return fmt(t('reports.cadence.weekly', 'Weekly · {day} at {time} ({zone})'), {
        day: DAY_LABELS[schedule.dayOfWeek ?? 1] ?? 'Mon',
        time: schedule.time,
        zone,
      });
    case 'monthly':
      return fmt(t('reports.cadence.monthly', 'Monthly · day {day} at {time} ({zone})'), {
        day: schedule.dayOfMonth ?? 1,
        time: schedule.time,
        zone,
      });
  }
}

interface DraftState {
  id: string | null; // null = creating
  pageId: string;
  name: string;
  frequency: ReportScheduleDto['frequency'];
  dayOfWeek: number;
  dayOfMonth: number;
  time: string;
  timezone: string;
  recipients: string; // comma-separated in the field
  format: ReportFormat;
  enabled: boolean;
}

function draftOf(report: ScheduledReportDto | null): DraftState {
  return {
    id: report?.id ?? null,
    pageId: report?.pageId ?? '',
    name: report?.name ?? '',
    frequency: report?.schedule.frequency ?? 'weekly',
    dayOfWeek: report?.schedule.dayOfWeek ?? 1,
    dayOfMonth: report?.schedule.dayOfMonth ?? 1,
    time: report?.schedule.time ?? '09:00',
    timezone:
      report?.schedule.timezone ??
      (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    recipients: (report?.recipients ?? []).join(', '),
    format: report?.format ?? 'pdf',
    enabled: report?.enabled ?? true,
  };
}

function scheduleOf(draft: DraftState): ReportScheduleDto {
  return {
    frequency: draft.frequency,
    dayOfWeek: draft.frequency === 'weekly' ? draft.dayOfWeek : null,
    dayOfMonth: draft.frequency === 'monthly' ? draft.dayOfMonth : null,
    time: draft.time,
    timezone: draft.timezone,
  };
}

export function ScheduledReportsPage() {
  const queryClient = useQueryClient();
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const list = useQuery(scheduledReportsQuery());
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const navItems = useMemo(
    () => (boot.data === undefined ? [] : flattenNav(boot.data.nav)),
    [boot.data],
  );

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] });

  const saveMutation = useMutation({
    mutationFn: async (input: DraftState) => {
      const body = {
        pageId: input.pageId,
        name: input.name,
        schedule: scheduleOf(input),
        recipients: input.recipients
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        format: input.format,
        enabled: input.enabled,
      };
      return input.id === null
        ? scheduledReportsApi.create(body)
        : scheduledReportsApi.update(input.id, body);
    },
    onSuccess: () => {
      setDraft(null);
      setFormError(null);
      invalidate();
    },
    onError: (error) => {
      setFormError(
        error instanceof Error
          ? error.message
          : t('reports.saveFailed', 'Could not save this report.'),
      );
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      scheduledReportsApi.update(id, { enabled }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduledReportsApi.remove(id),
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });

  const rows: ScheduledJob[] = useMemo(
    () =>
      (list.data ?? []).map((report) => ({
        id: report.id,
        name: report.name,
        target: report.pageTitle ?? report.pageId,
        frequency: cadenceLabel(report.schedule),
        // Delivery truth, not the stored intent (§8.2).
        format: t('reports.deliveryBadge', 'CSV snapshot'),
        next: report.nextRunAt === null ? undefined : new Date(report.nextRunAt).toISOString(),
        enabled: report.enabled,
        recipients: report.recipients,
      })),
    [list.data],
  );

  const byId = useMemo(
    () => new Map((list.data ?? []).map((report) => [report.id, report] as const)),
    [list.data],
  );

  return (
    <PageSurface width="content" fill className="gap-5">
      <PageActions
        title={t('reports.title', 'Scheduled reports')}
        subtitle={t(
          'reports.subtitle',
          'Recurring data snapshots of a page, delivered as in-app notifications.',
        )}
      >
        <Button onClick={() => { setFormError(null); setDraft(draftOf(null)); }} data-testid="new-report">
          {t('reports.new', 'New report')}
        </Button>
      </PageActions>

      {list.isError ? (
        <Alert
          tone="danger"
          title={
            list.error instanceof Error
              ? list.error.message
              : t('reports.loadFailed', 'Could not load scheduled reports.')
          }
        />
      ) : null}

      <ScheduledJobsList
        jobs={rows}
        toggleable
        showRecipients
        nextRunLabel={t('reports.nextRun', 'Next run')}
        emptyTitle={t('reports.emptyTitle', 'No scheduled reports yet')}
        emptyBody={t(
          'reports.emptyBody',
          'Create one to get a recurring data snapshot of any table page.',
        )}
        onToggle={(job, enabled) => toggleMutation.mutate({ id: String(job.id), enabled })}
        onSelect={(job) => {
          const report = byId.get(String(job.id));
          if (report !== undefined) {
            setFormError(null);
            setDraft(draftOf(report));
          }
        }}
        testId="reports-list"
      />

      {/* --- create / edit modal ------------------------------------------------ */}
      <Modal open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }} size="md">
        {draft === null ? null : (
          <>
            <ModalHeader
              title={
                draft.id === null
                  ? t('reports.createTitle', 'New scheduled report')
                  : t('reports.editTitle', 'Edit scheduled report')
              }
              closeLabel={t('common.close', 'Close')}
            />
            <ModalBody className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-body-sm font-medium text-fg">
                  {t('reports.nameLabel', 'Name')}
                </span>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  placeholder={t('reports.namePlaceholder', 'e.g. Weekly revenue')}
                  data-testid="report-name"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-body-sm font-medium text-fg">
                  {t('reports.pageLabel', 'Page')}
                </span>
                <Select
                  value={draft.pageId}
                  onChange={(event) => setDraft({ ...draft, pageId: event.currentTarget.value })}
                  data-testid="report-page"
                >
                  <option value="">{t('reports.pagePlaceholder', 'Choose a page…')}</option>
                  {navItems.map((item) => (
                    <option key={item.pageId} value={item.pageId}>
                      {item.fallback}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-fg">
                    {t('reports.frequencyLabel', 'Frequency')}
                  </span>
                  <Select
                    value={draft.frequency}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        frequency: event.currentTarget.value as DraftState['frequency'],
                      })
                    }
                  >
                    <option value="daily">{t('reports.frequency.daily', 'Daily')}</option>
                    <option value="weekly">{t('reports.frequency.weekly', 'Weekly')}</option>
                    <option value="monthly">{t('reports.frequency.monthly', 'Monthly')}</option>
                  </Select>
                </label>
                {draft.frequency === 'weekly' ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-body-sm font-medium text-fg">
                      {t('reports.dayOfWeekLabel', 'Day')}
                    </span>
                    <Select
                      value={String(draft.dayOfWeek)}
                      onChange={(event) =>
                        setDraft({ ...draft, dayOfWeek: Number(event.currentTarget.value) })
                      }
                    >
                      {DAY_LABELS.map((label, index) => (
                        <option key={label} value={String(index)}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
                {draft.frequency === 'monthly' ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-body-sm font-medium text-fg">
                      {t('reports.dayOfMonthLabel', 'Day of month')}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={String(draft.dayOfMonth)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          dayOfMonth: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                        })
                      }
                      className="w-24"
                    />
                  </label>
                ) : null}
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-fg">
                    {t('reports.timeLabel', 'Time')}
                  </span>
                  <Input
                    type="time"
                    value={draft.time}
                    onChange={(event) => setDraft({ ...draft, time: event.currentTarget.value })}
                    className="w-28"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-fg">
                    {t('reports.timezoneLabel', 'Timezone')}
                  </span>
                  <Input
                    value={draft.timezone}
                    onChange={(event) => setDraft({ ...draft, timezone: event.currentTarget.value })}
                    placeholder="UTC"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-body-sm font-medium text-fg">
                  {t('reports.formatLabel', 'Delivery')}
                </span>
                <Select
                  value={draft.format}
                  onChange={(event) =>
                    setDraft({ ...draft, format: event.currentTarget.value as ReportFormat })
                  }
                >
                  <option value="pdf">PDF</option>
                  <option value="png">PNG</option>
                </Select>
                <span className="text-caption text-fg-subtle">
                  {t(
                    'reports.formatHint',
                    'Data snapshot (PDF/PNG rendering arrives in a later release) — each run produces a CSV snapshot and an in-app notification.',
                  )}
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-body-sm font-medium text-fg">
                  {t('reports.recipientsLabel', 'Recipients')}
                </span>
                <Input
                  value={draft.recipients}
                  onChange={(event) => setDraft({ ...draft, recipients: event.currentTarget.value })}
                  placeholder="ava@example.com, sam@example.com"
                />
                <span className="text-caption text-fg-subtle">
                  {t(
                    'reports.recipientsHint',
                    'Stored with the report. Email delivery arrives in a later release — runs notify you in-app for now.',
                  )}
                </span>
              </label>

              {formError !== null ? <Alert tone="danger" title={formError} /> : null}
            </ModalBody>
            <ModalFooter className="flex items-center gap-2">
              {draft.id !== null ? (
                <Button
                  variant="destructiveSoft"
                  onClick={() => deleteMutation.mutate(draft.id as string)}
                  disabled={deleteMutation.isPending}
                  data-testid="delete-report"
                >
                  {t('reports.delete', 'Delete')}
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={() => saveMutation.mutate(draft)}
                disabled={
                  saveMutation.isPending || draft.name.trim() === '' || draft.pageId === ''
                }
                data-testid="save-report"
              >
                {draft.id === null ? t('reports.create', 'Create') : t('common.save', 'Save')}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </PageSurface>
  );
}
