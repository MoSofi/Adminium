import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, AvatarStack, EmptyState, IconTile, MonoText, Switch, Tag } from '@adminium/ui';
import { CalendarClock } from 'lucide-react';

import { scheduledJobsListConfigSchema, scheduledJobsListDemoData } from './calendar-config.js';
import { bindingSourceOf, fmtNextRun, resolveLocale, toneOf } from './calendar-lib.js';
import type { ScheduledJobsListConfig } from './calendar-config.js';
import type { ScheduledJob } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { scheduledJobsListConfigSchema, scheduledJobsListDemoData };
export type { ScheduledJobsListConfig, ScheduledJob };

/**
 * `scheduled-jobs-list` (annex §5) — recurring-job rows: an icon tile, the name
 * plus a format badge, a meta line ("target · human cadence"), a recipient
 * avatar stack, the "Next run" column, and an on/off switch; disabled rows dim
 * (Scheduled Reports, Data Exports, Adminium UI Kit's saved reports).
 *
 * The cadence string arrives ALREADY humanized: cron → prose needs the
 * schedule's timezone and the viewer's locale, both of which live at the host /
 * server boundary, so the widget renders what it is given rather than shipping a
 * cron parser to the browser.
 *
 * Toggling emits a `mutate` UPDATE intent — the widget never writes. The host
 * runs it through the CRUD API with undo + audit (04 §2), which is also why the
 * switch is optimistic-free: the row re-renders from the next payload.
 */

export interface ScheduledJobsListProps {
  jobs: readonly ScheduledJob[];
  toggleable?: boolean | undefined;
  showRecipients?: boolean | undefined;
  locale?: string | undefined;
  nextRunLabel?: string | undefined;
  toggleLabel?: string | undefined;
  recipientsLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onToggle?: ((job: ScheduledJob, enabled: boolean) => void) | undefined;
  onSelect?: ((job: ScheduledJob) => void) | undefined;
  testId?: string | undefined;
}

export function ScheduledJobsList({
  jobs,
  toggleable = true,
  showRecipients = true,
  locale,
  nextRunLabel,
  toggleLabel,
  recipientsLabel,
  emptyTitle,
  emptyBody,
  onToggle,
  onSelect,
  testId,
}: ScheduledJobsListProps) {
  const t = useMaybeT();
  const resolvedNextRunLabel = nextRunLabel ?? t('ui:widgets.calendar.scheduledJobsList.nextRunLabel', 'Next run');
  const resolvedRecipientsLabel = recipientsLabel ?? t('ui:widgets.calendar.scheduledJobsList.recipientsLabel', 'Recipients');
  const tag = resolveLocale(locale);

  if (jobs.length === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? t('ui:widgets.calendar.scheduledJobsList.emptyTitle', 'No scheduled jobs')}
        body={emptyBody ?? t('ui:widgets.calendar.scheduledJobsList.emptyBody', 'Recurring reports and exports will appear here once scheduled.')}
      />
    );
  }

  return (
    <ul data-widget="scheduled-jobs-list" data-testid={testId} className="h-full divide-y divide-border overflow-auto">
      {jobs.map((job) => {
        const enabled = job.enabled !== false;
        const next = job.next === undefined ? '' : fmtNextRun(tag, job.next);
        const recipients = job.recipients ?? [];
        return (
          <li
            key={job.id}
            data-part="job-row"
            data-enabled={enabled ? '' : undefined}
            // Disabled rows dim (annex) — the whole row, not just the switch, so
            // the "this is off" read survives at a glance.
            className={`flex items-center gap-3 px-3 py-2.5 ${enabled ? '' : 'opacity-55'}`}
          >
            <IconTile size="md" tone={toneOf(job.tone, enabled ? 'accent' : 'neutral')} icon={<CalendarClock />} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {onSelect === undefined ? (
                  <span className="min-w-0 truncate text-body-sm font-semibold text-fg">{job.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(job)}
                    className="min-w-0 truncate text-start text-body-sm font-semibold text-fg hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {job.name}
                  </button>
                )}
                {job.format !== undefined && (
                  <Tag mono tone="neutral" className="shrink-0 uppercase">
                    {job.format}
                  </Tag>
                )}
              </div>
              {(job.target !== undefined || job.frequency !== undefined) && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-fg-muted">
                  {job.target !== undefined && <MonoText className="truncate">{job.target}</MonoText>}
                  {job.target !== undefined && job.frequency !== undefined && (
                    <span aria-hidden="true" className="text-fg-subtle">
                      ·
                    </span>
                  )}
                  {job.frequency !== undefined && <span className="truncate">{job.frequency}</span>}
                </p>
              )}
            </div>

            {showRecipients && recipients.length > 0 && (
              <AvatarStack max={3} size="xs" label={resolvedRecipientsLabel} className="shrink-0">
                {recipients.map((name) => (
                  <Avatar key={name} size="xs" name={name} locale={tag} />
                ))}
              </AvatarStack>
            )}

            <div data-part="job-next" className="hidden w-40 shrink-0 flex-col text-end sm:flex">
              <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{resolvedNextRunLabel}</span>
              <MonoText className="truncate text-caption text-fg">{next === '' ? '—' : next}</MonoText>
            </div>

            {toggleable && (
              // The aria default is the job's NAME (each switch stays uniquely
              // announced), so the scheduledJobsList toggleLabel bundle key is
              // a config-layer suggestion, not a wired bundle default.
              <Switch
                data-part="job-toggle"
                checked={enabled}
                aria-label={toggleLabel ?? job.name}
                onCheckedChange={(checked: boolean) => onToggle?.(job, checked)}
                className="shrink-0"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Project an untrusted `record-list` onto `ScheduledJob`s via the row mapping. */
export function scheduledJobsOf(data: unknown, config: ScheduledJobsListConfig): ScheduledJob[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null
      ? ((data as { rows?: unknown; data?: unknown }).rows ?? (data as { data?: unknown }).data)
      : undefined;
  if (!Array.isArray(raw)) return [];
  const str = (row: Record<string, unknown>, key: string): string | undefined => {
    const value = row[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row, index): ScheduledJob => {
      const id = row.id;
      const recipients = row[config.recipientsField];
      return {
        id: typeof id === 'string' || typeof id === 'number' ? id : index,
        name: str(row, config.nameField) ?? `#${index + 1}`,
        target: str(row, config.targetField),
        frequency: str(row, config.frequencyField),
        format: str(row, config.formatField),
        next: str(row, config.nextRunField),
        enabled: row[config.toggleField] !== false,
        recipients: Array.isArray(recipients)
          ? recipients.filter((name): name is string => typeof name === 'string' && name !== '')
          : undefined,
        tone: str(row, 'tone'),
      };
    });
}

export function ScheduledJobsListWidget({ config, data, onEvent }: WidgetProps<ScheduledJobsListConfig>) {
  const source = bindingSourceOf(config.binding);
  return (
    <ScheduledJobsList
      jobs={scheduledJobsOf(data, config)}
      toggleable={config.toggleable}
      showRecipients={config.showRecipients}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.nextRunLabel === undefined ? {} : { nextRunLabel: config.nextRunLabel })}
      {...(config.toggleLabel === undefined ? {} : { toggleLabel: config.toggleLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onToggle={(job, enabled) => {
        if (source === null) return; // unbound: nothing to write to
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: source.connectionId,
          table: source.table,
          recordId: job.id,
          values: { [config.toggleField]: enabled },
        });
      }}
      {...(config.href === undefined
        ? {}
        : { onSelect: () => onEvent({ type: 'drill-through', href: config.href as string }) })}
    />
  );
}
