// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "New rule" (`designs/Automation Rules.dc.html` 45-72, 601;
 * 42-automations-and-workflow-logs.md D12, FILL F1, F4, 42-T22).
 *
 * The comp's two-state dialog: a form (name, When, Then, "Enable
 * immediately"), then a success panel with a big check.
 *
 * --- DEPARTURE D12: what the success panel says --------------------------
 *
 * The comp's second state always reads "Rule created · Your rule is live and
 * will run the next time it's triggered." Every action this modal can pick
 * still needs setting up — a template, a table, a URL — so a rule created
 * from here is, by construction, incomplete, and switching it on would
 * produce a failed run per sign-up. The server therefore stores it PAUSED
 * (`POST /automations` honours `enabled` only when the rule validates), and
 * this panel says so: "Rule saved · Finish its steps, then switch it on."
 * The comp's own copy is kept for the case where the rule IS complete.
 *
 * --- FILL F1 / F4: what "When" offers ------------------------------------
 *
 * The comp lists domain events ("A user signs up"). Adminium observes record
 * writes and a clock, so the vocabulary is a record event per readable table
 * plus "On a schedule".
 *
 * --- DEPARTURE D25: two controls, not one --------------------------------
 *
 * The comp draws ONE select for "When (trigger)". Spelled as a single list
 * that is the cartesian product of {created, updated, deleted} × every
 * readable table, it is 3n options long — Northwind alone is 39 and a real
 * schema is hundreds — so the trigger somebody came here to pick cannot be
 * found. It splits the way the trigger inspector already splits it
 * (`flow/inspector/TriggerSettings.tsx`): a four-option `Select` for the
 * event, then — for the three record events only — a `Combobox` for the
 * table, which is the searchable control the design system reserves for
 * exactly this case ("kept native for plain forms — searchable/rich cases
 * are `Combobox`", `Select.tsx`). §4.1's row for comp 55 asked for a
 * Combobox here and the first build shipped a `Select`; this is that
 * correction too. Field chrome, order and copy stay the comp's own, and F4's
 * "{connection} · {table}" prefix still applies with several connections.
 */

import { Combobox, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Switch } from '@adminium/ui';
import { useId, useState, type ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import { watchesFor } from '../api.js';
import type { Sources } from '../api.js';
import type { Graph, RecordEvent, Trigger } from '../model/graph.js';
import { ACTION_STEPS } from '../model/vocabulary.js';

export interface NewRuleSubmission {
  name: string;
  trigger: Trigger;
  graph: Graph;
  enabled: boolean;
}

export interface NewRuleModalProps {
  open: boolean;
  sources: Sources | null;
  onClose: () => void;
  onCreate: (input: NewRuleSubmission) => Promise<{ enabled: boolean }>;
  /** After Done: select the new rule and open the inspector on its action. */
  onDone: () => void;
}

const EVENTS: RecordEvent[] = ['created', 'updated', 'deleted'];

/** D21 — literal keys, never assembled from the event name. */
const EVENT_WORD: Record<RecordEvent, { key: string; fallback: string }> = {
  created: { key: 'automations:event.created', fallback: 'created' },
  updated: { key: 'automations:event.updated', fallback: 'updated' },
  deleted: { key: 'automations:event.deleted', fallback: 'deleted' },
};

/** What the first dropdown offers (D25): the event, never the table. */
type TriggerKind = RecordEvent | 'schedule';

const KINDS: TriggerKind[] = [...EVENTS, 'schedule'];

const KIND_LABEL: Record<TriggerKind, { key: string; fallback: string }> = {
  created: { key: 'automations:modal.trigger.recordCreated', fallback: 'A record is created' },
  updated: { key: 'automations:modal.trigger.recordUpdated', fallback: 'A record is updated' },
  deleted: { key: 'automations:modal.trigger.recordDeleted', fallback: 'A record is deleted' },
  schedule: { key: 'automations:modal.trigger.schedule', fallback: 'On a schedule' },
};

const EMAIL_LABEL = { key: 'automations:pick.email', fallback: 'Send email' } as const;

const ACTION_LABEL: Record<string, { key: string; fallback: string }> = {
  email: EMAIL_LABEL,
  notification: { key: 'automations:pick.notification', fallback: 'Send notification' },
  create: { key: 'automations:pick.create', fallback: 'Create record' },
  update: { key: 'automations:pick.update', fallback: 'Update field' },
  webhook: { key: 'automations:pick.webhook', fallback: 'Call webhook' },
  slack: { key: 'automations:pick.slack', fallback: 'Slack message' },
};

/** The two controls, back into one trigger. `tableValue` is `<cnx>|<table>`. */
function buildTrigger(kind: TriggerKind, tableValue: string, sources: Sources | null): Trigger | null {
  if (kind === 'schedule') {
    return {
      kind: 'schedule',
      connectionId: sources?.connections[0]?.id ?? null,
      schedule: { kind: 'interval', everyMinutes: '15' },
    };
  }
  const [connectionId, tableId] = tableValue.split('|');
  if (connectionId === undefined || tableId === undefined || tableId === '') return null;
  const connection = sources?.connections.find((row) => row.id === connectionId);
  return {
    kind: 'record',
    event: kind,
    connectionId,
    table: tableId,
    watch: watchesFor(kind, connection?.tables.find((row) => row.id === tableId)),
  };
}

export function NewRuleModal({ open, sources, onClose, onCreate, onDone }: NewRuleModalProps): ReactNode {
  const fieldId = useId();
  const tableId = `${fieldId}-table`;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TriggerKind | ''>('');
  // Kept across a change of event: created → updated is the same table.
  const [tableValue, setTableValue] = useState('');
  const [actionKey, setActionKey] = useState('email');
  const [enable, setEnable] = useState(true);
  const [done, setDone] = useState<{ enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const several = (sources?.connections.length ?? 0) > 1;
  const needsTable = kind !== '' && kind !== 'schedule';
  const ready = name.trim() !== '' && kind !== '' && (!needsTable || tableValue !== '');
  const Check = automationIcon('check');
  const Plus = automationIcon('plus');
  const Workflow = automationIcon('workflow');

  const close = (): void => {
    setDone(null);
    setName('');
    setKind('');
    setTableValue('');
    setEnable(true);
    onClose();
  };

  async function submit(): Promise<void> {
    if (kind === '') return;
    const trigger = buildTrigger(kind, tableValue, sources);
    if (trigger === null || name.trim() === '') return;
    const definition = ACTION_STEPS.find((step) => step.key === actionKey) ?? ACTION_STEPS[0];
    if (definition === undefined) return;
    const graph: Graph = {
      version: 1,
      nodes: [
        {
          id: 'n1',
          kind: 'trigger',
          title:
            trigger.kind === 'schedule'
              ? t('automations:trig.schedule', 'On a schedule')
              : t('automations:node.trigger.record', 'When a record is {event} in {table}', {
                  event: t(EVENT_WORD[trigger.event].key, EVENT_WORD[trigger.event].fallback),
                  table: trigger.table,
                }),
        },
        {
          id: 'n2',
          kind: 'action',
          title: t(
            (ACTION_LABEL[definition.key] ?? EMAIL_LABEL).key,
            (ACTION_LABEL[definition.key] ?? EMAIL_LABEL).fallback,
          ),
          sub: definition.sub,
          onError: false,
          action: definition.action ?? { kind: 'email', templateKey: null, to: null },
        },
      ],
    };
    setBusy(true);
    try {
      setDone(await onCreate({ name: name.trim(), trigger, graph, enabled: enable }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
    >
      {done === null ? (
        <>
          <ModalHeader
            icon={<Workflow aria-hidden />}
            title={t('automations:modal.title', 'New rule')}
            subtitle={t(
              'automations:modal.subtitle',
              'Trigger workflows automatically when things happen.',
            )}
            closeLabel={t('automations:picker.close', 'Close')}
          />
          <ModalBody className="flex flex-col gap-[15px]" data-testid="new-rule-modal">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold">
                {t('automations:modal.name', 'Rule name')}
              </span>
              <Input
                value={name}
                placeholder={t('automations:modal.namePlaceholder', 'e.g. Welcome new signups')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                data-testid="new-rule-name"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold">
                {t('automations:modal.when', 'When (trigger)')}
              </span>
              <Select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as TriggerKind | '');
                }}
                data-testid="new-rule-trigger"
              >
                <option value="">{t('automations:modal.when', 'When (trigger)')}</option>
                {KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(KIND_LABEL[option].key, KIND_LABEL[option].fallback)}
                  </option>
                ))}
              </Select>
            </label>

            {needsTable ? (
              <div data-testid="new-rule-table">
                {/* A composite widget cannot be named by wrapping it in the
                    label: the name goes on its input by id, the way
                    `FormField` wires one. */}
                <label htmlFor={tableId} className="mb-1.5 block text-xs font-semibold">
                  {t('automations:trig.table', 'Table')}
                </label>
                <Combobox
                  id={tableId}
                  value={tableValue === '' ? null : tableValue}
                  onValueChange={(next) => {
                    setTableValue(next ?? '');
                  }}
                  options={(sources?.connections ?? []).flatMap((connection) =>
                    connection.tables
                      .filter((table) => table.canRead)
                      .map((table) => ({
                        value: `${connection.id}|${table.id}`,
                        // FILL F4 — one connection lists its tables bare;
                        // several prefix the connection's name (41 R7).
                        label: several
                          ? t('automations:modal.connection', '{connection} · {table}', {
                              connection: connection.name,
                              table: table.label,
                            })
                          : table.label,
                      })),
                  )}
                  placeholder={t('automations:modal.tablePlaceholder', 'Search tables…')}
                  emptyText={t('automations:modal.tableEmpty', 'No matching table')}
                />
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold">
                {t('automations:modal.then', 'Then (action)')}
              </span>
              <Select
                value={actionKey}
                onChange={(event) => {
                  setActionKey(event.target.value);
                }}
                data-testid="new-rule-action"
              >
                {ACTION_STEPS.map((step) => (
                  <option key={step.key} value={step.key}>
                    {t(
                      (ACTION_LABEL[step.key] ?? EMAIL_LABEL).key,
                      (ACTION_LABEL[step.key] ?? EMAIL_LABEL).fallback,
                    )}
                  </option>
                ))}
              </Select>
            </label>

            <div className="flex items-center gap-3 rounded-[11px] border border-border bg-surface-2 px-3.5 py-3">
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">
                  {t('automations:modal.enable', 'Enable immediately')}
                </div>
                <div className="mt-0.5 text-[11px] text-fg-subtle">
                  {t('automations:modal.enableBody', 'Start running as soon as the rule is created')}
                </div>
              </div>
              <Switch
                checked={enable}
                onCheckedChange={setEnable}
                aria-label={t('automations:modal.enable', 'Enable immediately')}
                data-testid="new-rule-enable"
              />
            </div>
          </ModalBody>
          <ModalFooter className="justify-stretch">
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-[10px] border border-border bg-surface p-[11px] text-[13px] font-bold text-fg-muted"
            >
              {t('automations:modal.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => {
                void submit();
              }}
              data-testid="new-rule-create"
              className="flex flex-1 items-center justify-center gap-[7px] rounded-[10px] bg-accent p-[11px] text-[13px] font-bold text-accent-fg disabled:opacity-40"
            >
              <Plus aria-hidden className="size-[15px]" />
              {t('automations:modal.create', 'Create rule')}
            </button>
          </ModalFooter>
        </>
      ) : (
        <ModalBody className="flex flex-col items-center px-7 pb-[30px] pt-9 text-center" data-testid="new-rule-done">
          <div className="mb-[15px] flex size-14 items-center justify-center rounded-2xl bg-pos-soft text-pos">
            <Check aria-hidden className="size-7" />
          </div>
          <div className="text-[17px] font-extrabold tracking-[-0.02em]">
            {done.enabled
              ? t('automations:modal.doneTitle', 'Rule created')
              : t('automations:modal.savedTitle', 'Rule saved')}
          </div>
          <div className="mt-1.5 max-w-[320px] text-[12.5px] leading-[1.5] text-fg-muted">
            {done.enabled
              ? t(
                  'automations:modal.doneBody',
                  "Your rule is live and will run the next time it's triggered.",
                )
              : t('automations:modal.savedBody', 'Finish its steps, then switch it on.')}
          </div>
          <button
            type="button"
            onClick={() => {
              close();
              onDone();
            }}
            data-testid="new-rule-done-button"
            className="mt-5 rounded-[10px] bg-accent px-6 py-2.5 text-[13px] font-bold text-accent-fg"
          >
            {t('automations:modal.done', 'Done')}
          </button>
        </ModalBody>
      )}
    </Modal>
  );
}
