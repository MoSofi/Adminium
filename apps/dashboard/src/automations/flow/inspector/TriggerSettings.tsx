// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILL F1 / F3 — the trigger's own settings (42-automations-and-workflow-
 * logs.md D3, D4, D5, F6).
 *
 * The comp draws a trigger NODE with a title and a sub-line and no way to
 * change what it listens to. This is the card that makes it real, and it is
 * where the feature's one genuinely surprising fact lives:
 *
 * Both table pickers here are searchable `Combobox`es rather than native
 * selects (**D25**, the New-rule modal's rule applied to the same choice):
 * a real schema is hundreds of tables and a native list cannot be searched.
 *
 * "When" is ONE select of four options, the modal's shape (D25 again). It
 * used to be two — a kind select and an event select, both labelled "When",
 * which is a duplicate accessible name and, worse, a lie: the kind select
 * hard-coded "A record is created" as its record option, so an `updated`
 * trigger read "created" on one line and "updated" on the next.
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

import { Combobox, Input, Select, Switch } from '@adminium/ui';
import { useId, type ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import { watchesFor } from '../../api.js';
import type { SourceConnection, SourceTable, Sources } from '../../api.js';
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

/** The empty row: `Combobox` has no clear affordance, so "none" has to BE a row. */
const UNSET = '';

/** Readable tables as `<connection>|<table>` rows, F4-prefixed when several. */
function tableOptions(
  connections: readonly SourceConnection[],
  several: boolean,
): { value: string; label: string }[] {
  return connections.flatMap((connection) =>
    connection.tables
      .filter((row) => row.canRead)
      .map((row) => ({
        value: `${connection.id}|${row.id}`,
        // FILL F4 — one connection lists its tables bare; several prefix the
        // connection's name (41 R7's rule).
        label: several
          ? t('automations:modal.connection', '{connection} · {table}', {
              connection: connection.name,
              table: row.label,
            })
          : row.label,
      })),
  );
}

/** The four things "When" can say: the three record events, or the clock. */
type TriggerKind = RecordEvent | 'schedule';

export function TriggerSettings({ trigger, sources, table, onChange }: TriggerSettingsProps): ReactNode {
  const several = (sources?.connections.length ?? 0) > 1;
  const kind: TriggerKind = trigger.kind === 'schedule' ? 'schedule' : trigger.event;

  const pickKind = (next: TriggerKind): void => {
    if (next === 'schedule') {
      if (trigger.kind === 'schedule') return;
      onChange({
        kind: 'schedule',
        connectionId: trigger.connectionId,
        schedule: { kind: 'interval', everyMinutes: '15' },
      });
      return;
    }
    if (trigger.kind === 'record') {
      onChange({
        ...trigger,
        event: next,
        // Never turn watching ON for someone — but an event this table cannot
        // be watched for must not keep the flag, or the line below says
        // "watching" while nothing polls (D4).
        watch: trigger.watch && watchesFor(next, table),
      });
      return;
    }
    onChange({
      kind: 'record',
      event: next,
      connectionId: trigger.connectionId ?? sources?.connections[0]?.id ?? '',
      table: '',
      // No table yet, so nothing to watch; picking one derives it.
      watch: false,
    });
  };

  return (
    <Card title={t('automations:trig.title', 'Trigger')}>
      <Field label={t('automations:trig.kind', 'When')}>
        <Select
          value={kind}
          onChange={(event) => {
            pickKind(event.target.value as TriggerKind);
          }}
          data-testid="trig-kind"
        >
          {EVENTS.map((event) => (
            <option key={event} value={event}>
              {t('automations:trig.record', 'A record is {event}', {
                event: t(EVENT_LABELS[event].key, EVENT_LABELS[event].fallback),
              })}
            </option>
          ))}
          <option value="schedule">{t('automations:trig.schedule', 'On a schedule')}</option>
        </Select>
      </Field>

      {trigger.kind === 'record' ? (
        <RecordTrigger
          trigger={trigger}
          several={several}
          table={table}
          sources={sources}
          onChange={onChange}
        />
      ) : (
        <ScheduleTrigger trigger={trigger} sources={sources} onChange={onChange} />
      )}
    </Card>
  );
}

function RecordTrigger({
  trigger,
  several,
  table,
  sources,
  onChange,
}: {
  trigger: Extract<Trigger, { kind: 'record' }>;
  several: boolean;
  table: SourceTable | null;
  sources: Sources | null;
  onChange: (trigger: Trigger) => void;
}): ReactNode {
  const fieldId = useId();
  const watchColumn =
    trigger.event === 'created' ? (table?.watch.created ?? null) : (table?.watch.updated ?? null);
  const canWatch = trigger.event !== 'deleted' && watchColumn !== null;

  return (
    <>
      <Field label={t('automations:trig.table', 'Table')} htmlFor={`${fieldId}-table`}>
        <Combobox
          id={`${fieldId}-table`}
          // `<connection>|<table>`, so two connections holding the same
          // `schema.table` stay distinguishable — by id alone the write
          // picked whichever connection came first.
          value={trigger.table === '' ? null : `${trigger.connectionId}|${trigger.table}`}
          onValueChange={(next) => {
            const [connectionId, tableId] = (next ?? '').split('|');
            if (connectionId === undefined || tableId === undefined || tableId === '') return;
            const chosen = sources?.connections
              .find((row) => row.id === connectionId)
              ?.tables.find((row) => row.id === tableId);
            onChange({
              ...trigger,
              table: tableId,
              connectionId,
              changedColumn: null,
              // A table that cannot be watched FOR THIS EVENT must not be
              // left with the flag on: the line below would say "watching"
              // and nothing would poll.
              watch: watchesFor(trigger.event, chosen),
            });
          }}
          options={tableOptions(sources?.connections ?? [], several)}
          placeholder={t('automations:modal.tablePlaceholder', 'Search tables…')}
          emptyText={t('automations:modal.tableEmpty', 'No matching table')}
        />
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
  sources,
  onChange,
}: {
  trigger: Extract<Trigger, { kind: 'schedule' }>;
  sources: Sources | null;
  onChange: (trigger: Trigger) => void;
}): ReactNode {
  const fieldId = useId();
  const schedule = trigger.schedule;
  const forEach = trigger.forEach;
  /**
   * The connection a for-each scan would read. `automations/schedule.ts`
   * resolves `forEach.table` against the rule's own `connectionId`, so the
   * list is that connection's tables and nothing else — offering every
   * connection's, as this field used to, offered rows that could never run.
   */
  const scanned =
    sources?.connections.find((row) => row.id === trigger.connectionId) ??
    sources?.connections[0] ??
    null;
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

      <Field
        label={t('automations:trig.forEach', 'For each record of')}
        htmlFor={`${fieldId}-foreach`}
      >
        <Combobox
          id={`${fieldId}-foreach`}
          value={forEach?.table ?? UNSET}
          onValueChange={(next) => {
            if (next === null || next === UNSET) {
              const cleared = { ...trigger };
              delete cleared.forEach;
              onChange(cleared);
              return;
            }
            onChange({
              ...trigger,
              // The scan resolves the table against the rule's OWN connection,
              // so picking one also PINS that connection — a schedule left at
              // `connectionId: null` scanned nothing at all.
              connectionId: scanned?.id ?? trigger.connectionId,
              forEach: { table: next, where: forEach?.where ?? [], once: forEach?.once ?? true },
            });
          }}
          options={[
            { value: UNSET, label: t('automations:trig.noTable', 'No table — one run per tick') },
            ...(scanned?.tables ?? [])
              .filter((row) => row.canRead)
              .map((row) => ({ value: row.id, label: row.label })),
          ]}
          placeholder={t('automations:modal.tablePlaceholder', 'Search tables…')}
          emptyText={t('automations:modal.tableEmpty', 'No matching table')}
        />
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
