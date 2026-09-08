// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two generated sentences the comp shows and never explains
 * (42-automations-and-workflow-logs.md Appendix A "Default node text").
 *
 *  - the RULE CARD's trigger line — "User signs up" in the comp's seed data
 *    (Automation Rules 223), which here is generated from the trigger;
 *  - the NODE's sub-line — "Template · Day 0 onboarding" in the seed data
 *    (comp 267), which here is generated from the step's own settings.
 *
 * A step whose settings are empty shows the picker's default instead ("Template
 * · pick one"), so the flow reads as a to-do list until it is finished. A step
 * whose description a person TYPED wins over both: the comp keeps the
 * description input, and something somebody wrote is never overwritten by
 * something generated.
 */

import { t } from '../../i18n/t.js';
import type { SourceTable } from '../api.js';
import type { Action, Condition, FlowNode, Trigger } from './graph.js';
import { OP_LABELS } from './vocabulary.js';

function tableLabel(id: string, table: SourceTable | null): string {
  return table !== null && table.id === id ? table.label : id;
}

/** The rule card's `zap` line (comp 223). */
export function triggerSentence(trigger: Trigger, table: SourceTable | null = null): string {
  if (trigger.kind === 'record') {
    const event =
      trigger.event === 'created'
        ? t('automations:event.created', 'created')
        : trigger.event === 'updated'
          ? t('automations:event.updated', 'updated')
          : t('automations:event.deleted', 'deleted');
    return t('automations:node.trigger.record', 'When a record is {event} in {table}', {
      event,
      table: tableLabel(trigger.table, table),
    });
  }
  const schedule = trigger.schedule;
  if (schedule.kind === 'interval') {
    return t('automations:node.trigger.interval', 'Every {minutes} minutes', {
      minutes: schedule.everyMinutes,
    });
  }
  if (schedule.kind === 'daily') {
    return t('automations:node.trigger.daily', 'Daily at {time}', { time: schedule.time });
  }
  if (schedule.kind === 'weekly') {
    return t('automations:node.trigger.weekly', 'Weekly on {day} at {time}', {
      day: String(schedule.dayOfWeek ?? 1),
      time: schedule.time,
    });
  }
  return t('automations:node.trigger.monthly', 'Monthly on day {day} at {time}', {
    day: String(schedule.dayOfMonth ?? 1),
    time: schedule.time,
  });
}

function conditionSentence(condition: Condition, table: SourceTable | null): string {
  const op = t(OP_LABELS[condition.op].key, OP_LABELS[condition.op].fallback);
  const right =
    condition.right === undefined
      ? ''
      : typeof condition.right === 'object'
        ? `${String(condition.right.amount)} ${condition.right.unit}`
        : String(condition.right);
  if ('count' in condition.left) {
    const counted = condition.left.count;
    if (counted.table === '') return t('automations:node.condition.empty', 'Set a condition');
    return `${t('automations:insp.countOf', 'Count of')} ${tableLabel(counted.table, table)} ${op} ${right}`.trim();
  }
  const field = condition.left.field;
  if (field === '') return t('automations:node.condition.empty', 'Set a condition');
  const column = table?.columns.find((candidate) => candidate.name === field)?.label ?? field;
  return `${column} ${op} ${right}`.trim();
}

function actionSentence(action: Action, table: SourceTable | null): string {
  switch (action.kind) {
    case 'email': {
      if (action.templateKey === null || action.to === null) {
        return t('automations:node.email.sub', 'Template · pick one');
      }
      const recipient = action.to;
      const to =
        recipient.kind === 'field'
          ? (table?.columns.find((column) => column.name === recipient.column)?.label ??
            recipient.column)
          : recipient.addresses.join(', ');
      return t('automations:node.email.summary', 'Template · {template} → {to}', {
        template: action.templateKey,
        to,
      });
    }
    case 'notification': {
      if (action.to === null) return t('automations:node.notification.sub', 'Choose who to tell');
      const who = 'roles' in action.to ? action.to.roles.length : action.to.users.length;
      return t('automations:node.notification.summary', 'To · {who}', { who: String(who) });
    }
    case 'record.create': {
      if (action.table === null) return t('automations:node.create.sub', 'Table · pick one');
      return t('automations:node.create.summary', '{table} · {count} values', {
        table: tableLabel(action.table, table),
        count: Object.keys(action.values).length,
      });
    }
    case 'record.update': {
      const entries = Object.entries(action.values);
      if (entries.length === 0) return t('automations:node.update.sub', 'Set a value');
      return t('automations:node.update.summary', '{pairs}', {
        pairs: entries
          .map(([column, value]) =>
            typeof value === 'string'
              ? `${column} = ${value}`
              : `${column} = ${t('automations:rec.now', 'Now')}`,
          )
          .join(', '),
      });
    }
    case 'webhook': {
      const slack = action.bodyKind === 'slack';
      if (action.url === null || action.url === '') {
        return slack
          ? t('automations:node.slack.sub', 'Channel · add a webhook URL')
          : t('automations:node.webhook.sub', 'POST · JSON payload');
      }
      let host = action.url;
      try {
        host = new URL(action.url).host;
      } catch {
        // A URL with a `{{token}}` in it is not parseable until the run; the
        // raw text is the honest thing to show.
      }
      return slack
        ? t('automations:node.slack.summary', 'Slack · {host}', { host })
        : t('automations:node.webhook.summary', '{method} {host}', { method: action.method, host });
    }
  }
}

/** The node card's second line (comp 267, 512). */
export function subLineFor(node: FlowNode, table: SourceTable | null): string {
  // Something a person typed always wins over something generated.
  if (node.sub !== undefined && node.sub !== null && node.sub !== '') return node.sub;
  switch (node.kind) {
    case 'trigger':
      return '';
    case 'action':
      return actionSentence(node.action, table);
    case 'condition':
    case 'branch':
      return conditionSentence(node.condition, table);
    case 'wait':
      return t('automations:node.wait.sub', 'Pause for {duration}', {
        duration: `${String(node.amount)} ${node.unit}`,
      });
    case 'stop':
      return t('automations:node.stop.sub', 'Ends the run');
  }
}
