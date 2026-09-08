// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILL F1 / F3 — the trigger's own settings (42-automations-and-workflow-
 * logs.md D3, D4, D5, F6).
 *
 * The comp draws a trigger NODE with a title and a sub-line and no way to
 * change what it listens to. This is the card that makes it real, and it is
 * where the feature's one genuinely surprising fact lives:
 *
 * **The watch line tells the truth about what this rule can see.** A record
 * trigger only ever hears writes Adminium made — unless the table has a
 * `created_at`-shaped column or an increasing key, in which case a poller
 * also sees rows the customer's own application wrote (D4). Which of those
 * two worlds a rule is in changes whether it works at all, so the inspector
 * says it in a sentence rather than leaving a toggle whose consequence is
 * invisible. The server computes the answer per table (`watch` on
 * `/automations/sources`); this only renders it.
 */

import { Input, Select, Switch } from '@adminium/ui';
import type { ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import type { SourceTable, Sources } from '../../api.js';
import type { RecordEvent, Schedule, Trigger } from '../../model/graph.js';
import { Card, Field } from './primitives.js';

export interface TriggerSettingsProps {
  trigger: Trigger;
  sources: Sources | null;
  table: SourceTable | null;
  onChange: (trigger: Trigger) => void;
}

const EVENTS: RecordEvent[] = ['created', 'updated', 'deleted'];

const EVENT_LABELS: Record<RecordEvent, { key: string; fallback: string }> = {
  created: { key: 'automations:event.created', fallback: 'created' },
  updated: { key: 'automations:event.updated', fallback: 'updated' },
  deleted: { key: 'automations:event.deleted', fallback: 'deleted' },
};

export function TriggerSettings({ trigger, sources, table, onChange }: TriggerSettingsProps): ReactNode {
  const tables = sources?.connections.flatMap((connection) => connection.tables) ?? [];
  const several = (sources?.connections.length ?? 0) > 1;

  return (
    <Card title={t('automations:trig.title', 'Trigger')}>
      <Field label={t('automations:trig.kind', 'When')}>
        <Select
          value={trigger.kind}
          onChange={(event) => {
            if (event.target.value === 'schedule') {
              onChange({
                kind: 'schedule',
                connectionId: trigger.kind === 'record' ? trigger.connectionId : null,
                schedule: { kind: 'interval', everyMinutes: '15' },
              });
            } else {
              onChange({
                kind: 'record',
                event: 'created',
                connectionId: sources?.connections[0]?.id ?? '',
                table: '',
                watch: true,
              });
            }
          }}
          data-testid="trig-kind"
        >
          <option value="record">
            {t('automations:trig.record', 'A record is {event}', {
              event: t(EVENT_LABELS.created.key, EVENT_LABELS.created.fallback),
            })}
          </option>
          <option value="schedule">{t('automations:trig.schedule', 'On a schedule')}</option>
        </Select>
      </Field>

      {trigger.kind === 'record' ? (
        <RecordTrigger
          trigger={trigger}
          tables={tables}
          several={several}
          table={table}
          sources={sources}
          onChange={onChange}
        />
      ) : (
        <ScheduleTrigger trigger={trigger} tables={tables} onChange={onChange} />
      )}
    </Card>
  );
}

function RecordTrigger({
  trigger,
  tables,
  several,
  table,
  sources,
  onChange,
}: {
  trigger: Extract<Trigger, { kind: 'record' }>;
  tables: readonly SourceTable[];
  several: boolean;
  table: SourceTable | null;
  sources: Sources | null;
  onChange: (trigger: Trigger) => void;
}): ReactNode {
  const watchColumn =
    trigger.event === 'created' ? (table?.watch.created ?? null) : (table?.watch.updated ?? null);
  const canWatch = trigger.event !== 'deleted' && watchColumn !== null;

  return (
    <>
      <Field label={t('automations:trig.table', 'Table')}>
        <Select
          value={trigger.table}
          onChange={(event) => {
            const chosen = tables.find((row) => row.id === event.target.value);
            const connection = sources?.connections.find((row) =>
              row.tables.some((candidate) => candidate.id === event.target.value),
            );
            onChange({
              ...trigger,
              table: event.target.value,
              connectionId: connection?.id ?? trigger.connectionId,
              changedColumn: null,
              // A table that cannot be watched must not be left with the flag
              // on: the inspector would say "watching" and nothing would poll.
              watch: chosen !== undefined && chosen.watch.created !== null,
            });
          }}
          data-testid="trig-table"
        >
          <option value="">{t('automations:trig.table', 'Table')}</option>
          {(sources?.connections ?? []).map((connection) =>
            connection.tables
              .filter((row) => row.canRead)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {/* FILL F4 — one connection lists its tables bare; several
                      prefix the connection's name (41 R7's rule). */}
                  {several
                    ? t('automations:modal.connection', '{connection} · {table}', {
                        connection: connection.name,
                        table: row.label,
                      })
                    : row.label}
                </option>
              )),
          )}
        </Select>
      </Field>

      <Field label={t('automations:trig.kind', 'When')}>
        <Select
          value={trigger.event}
          onChange={(event) => {
            onChange({ ...trigger, event: event.target.value as RecordEvent });
          }}
          data-testid="trig-event"
        >
          {EVENTS.map((event) => (
            <option key={event} value={event}>
              {t('automations:trig.record', 'A record is {event}', {
                event: t(EVENT_LABELS[event].key, EVENT_LABELS[event].fallback),
              })}
            </option>
          ))}
        </Select>
      </Field>

      {trigger.event === 'updated' ? (
        <Field label={t('automations:trig.changed', 'Only when this column changes')}>
          <Select
            value={trigger.changedColumn ?? ''}
            onChange={(event) => {
              onChange({ ...trigger, changedColumn: event.target.value === '' ? null : event.target.value });
            }}
            data-testid="trig-changed"
          >
            <option value="">{t('automations:trig.anyColumn', 'Any column')}</option>
            {(table?.columns ?? []).map((column) => (
              <option key={column.name} value={column.name}>
                {column.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {/* The watch line — see the header. */}
      <div className="flex items-start gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-3">
        <p className="m-0 flex-1 text-[11px] leading-[1.45] text-fg-subtle">
          {trigger.event === 'deleted'
            ? t(
                'automations:trig.watch.deleted',
                'Deleted rows cannot be watched; only deletes made through Adminium trigger this rule',
              )
            : canWatch && trigger.watch
              ? `${t(
                  'automations:trig.watch.on',
                  'Also watches for rows written outside Adminium · every minute · via {column}',
                  { column: watchColumn ?? '' },
                )} · ${t('automations:trig.watch.fromNow', 'Rows from now on')}`
              : t(
                  'automations:trig.watch.off',
                  'Watching is off: this table has no {shape}-shaped column or increasing key, so only writes made through Adminium trigger this rule',
                  { shape: trigger.event === 'created' ? 'created_at' : 'updated_at' },
                )}
        </p>
        {canWatch ? (
          <Switch
            checked={trigger.watch}
            onCheckedChange={(checked) => {
              onChange({ ...trigger, watch: checked });
            }}
            aria-label={t('automations:trig.watch.fromNow', 'Rows from now on')}
            data-testid="trig-watch"
          />
        ) : null}
      </div>
    </>
  );
}

function ScheduleTrigger({
  trigger,
  tables,
  onChange,
}: {
  trigger: Extract<Trigger, { kind: 'schedule' }>;
  tables: readonly SourceTable[];
  onChange: (trigger: Trigger) => void;
}): ReactNode {
  const schedule = trigger.schedule;
  const forEach = trigger.forEach;
  return (
    <>
      <Field label={t('automations:trig.every', 'Every')}>
        <Select
          value={schedule.kind}
          onChange={(event) => {
            const kind = event.target.value as Schedule['kind'];
            onChange({
              ...trigger,
              schedule:
                kind === 'interval'
                  ? { kind: 'interval', everyMinutes: '15' }
                  : {
                      kind,
                      time: '09:00',
                      dayOfWeek: kind === 'weekly' ? 1 : null,
                      dayOfMonth: kind === 'monthly' ? 1 : null,
                      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
            });
          }}
          data-testid="trig-schedule-kind"
        >
          <option value="interval">{t('automations:sched.interval', 'Interval')}</option>
          <option value="daily">{t('automations:sched.daily', 'Daily')}</option>
          <option value="weekly">{t('automations:sched.weekly', 'Weekly')}</option>
          <option value="monthly">{t('automations:sched.monthly', 'Monthly')}</option>
        </Select>
      </Field>

      {schedule.kind === 'interval' ? (
        <Field label={t('automations:trig.every', 'Every')}>
          <Select
            value={schedule.everyMinutes}
            onChange={(event) => {
              onChange({
                ...trigger,
                schedule: {
                  kind: 'interval',
                  everyMinutes: event.target.value as '5' | '10' | '15' | '30' | '60',
                },
              });
            }}
            data-testid="trig-interval"
          >
            {(['5', '10', '15', '30', '60'] as const).map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('automations:node.trigger.interval', 'Every {minutes} minutes', { minutes })}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label={t('automations:trig.at', 'At')}>
            <Input
              type="time"
              value={schedule.time}
              onChange={(event) => {
                onChange({ ...trigger, schedule: { ...schedule, time: event.target.value } });
              }}
              data-testid="trig-time"
            />
          </Field>
          <Field label={t('automations:trig.timezone', 'Timezone')}>
            <Input
              value={schedule.timezone}
              onChange={(event) => {
                onChange({ ...trigger, schedule: { ...schedule, timezone: event.target.value } });
              }}
              data-testid="trig-timezone"
            />
          </Field>
        </>
      )}

      <Field label={t('automations:trig.forEach', 'For each record of')}>
        <Select
          value={forEach?.table ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') {
              const next = { ...trigger };
              delete next.forEach;
              onChange(next);
              return;
            }
            onChange({
              ...trigger,
              forEach: { table: value, where: forEach?.where ?? [], once: forEach?.once ?? true },
            });
          }}
          data-testid="trig-foreach"
        >
          <option value="">—</option>
          {tables
            .filter((row) => row.canRead)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
        </Select>
      </Field>

      {forEach === undefined ? null : (
        <div className="flex items-center gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-3">
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold">
              {t('automations:trig.once', 'Once per record')}
            </div>
            <div className="mt-0.5 text-[11px] text-fg-subtle">
              {t('automations:trig.onceBody', 'A record that matched before is not run again')}
            </div>
          </div>
          <Switch
            checked={forEach.once}
            onCheckedChange={(checked) => {
              onChange({ ...trigger, forEach: { ...forEach, once: checked } });
            }}
            aria-label={t('automations:trig.once', 'Once per record')}
            data-testid="trig-once"
          />
        </div>
      )}
    </>
  );
}
