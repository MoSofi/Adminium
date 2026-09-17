// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The step inspector (105-157, 572-595; FILL F3, FILL F5).
 *
 * The comp draws a 368 px right-hand sheet with five things: the step's name,
 * a description, a Condition card, two branch labels and a "Continue on
 * error" toggle — plus a footer of Move up / Move down / Duplicate / Delete
 * (150-155). Every one of those is here, in the comp's own anatomy.
 *
 * --- FILL F3: what the comp does not draw --------------------------------
 *
 * Nothing in the inspector configures what an ACTION needs to run: no
 * template, no recipient, no table, no URL. A rule built entirely from the
 * comp would be a rule that cannot execute a single step. So each kind gets
 * a settings card, built to the Condition card's own anatomy (125-136) — a
 * `surface-2` panel, an 11.5 px/700 heading, the same inputs and the same
 * gaps — because that is the pattern the comp established for "the fields
 * this step needs", and inventing a second one would look like a different
 * product.
 *
 * --- FILL F5: "related records" -------------------------------------------
 *
 * The comp's condition is `Field · op · Value` on the record. Both of the
 * owner's examples need a second shape — "did they claim the offer?", "has
 * this patient missed one before?" — which is a COUNT over another table.
 * A segmented control at the top of the Condition card switches between the
 * two, so the common case is unchanged and the second one is one click away
 * rather than a second card nobody finds.
 *
 * --- The Field input is a Select ------------------------------------------
 *
 * The comp draws a free-text "Field" box (127). A typed column name cannot be
 * resolved against a schema — the server refuses it with a 422 the person
 * only sees on save — so it is a Select of the trigger table's own columns.
 * That is the smallest change that makes the control able to keep its
 * promise.
 */

import { Drawer, DrawerBody, DrawerFooter, DrawerHeader, Input, Select, Switch } from '@adminium/ui';
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import { connectionForTrigger } from '../api.js';
import type { SourceColumn, SourceTable, Sources } from '../api.js';
import type { Action, Condition, FlowNode } from '../model/graph.js';
import { KIND_META, iconForNode } from '../model/vocabulary.js';
import { Card, Field } from './inspector/primitives.js';
import { ConditionCard } from './inspector/ConditionCard.js';
import { ActionSettings } from './inspector/ActionSettings.js';
import { TriggerSettings } from './inspector/TriggerSettings.js';
import type { Trigger } from '../model/graph.js';

export interface StepInspectorProps {
  node: FlowNode | null;
  /** The trigger, so a settings card can resolve the record's own columns. */
  trigger: Trigger;
  sources: Sources | null;
  /** The table the rule is about; null for a bare schedule tick. */
  table: SourceTable | null;
  onClose: () => void;
  onTitle: (title: string) => void;
  onSub: (sub: string) => void;
  onCondition: (condition: Condition) => void;
  onBranchLabel: (index: 0 | 1, label: string) => void;
  onToggleError: () => void;
  onAction: (patch: Partial<Action>) => void;
  onTrigger: (trigger: Trigger) => void;
  onWait: (patch: { amount?: number; unit?: 'minutes' | 'hours' | 'days' }) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function StepInspector(props: StepInspectorProps): ReactNode {
  const node = props.node;
  if (node === null) return null;
  const meta = KIND_META[node.kind];
  const Icon = automationIcon(iconForNode(node.kind, node.kind === 'action' ? node.action : null));
  const isTrigger = node.kind === 'trigger';
  const columns: readonly SourceColumn[] = props.table?.columns ?? [];

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="sm"
      data-testid="step-inspector"
    >
      <DrawerHeader
        icon={<Icon aria-hidden />}
        title={node.title}
        subtitle={t(meta.labelKey, meta.fallback)}
        closeLabel={t('automations:insp.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-[15px]">
        <Field label={t('automations:insp.stepName', 'Step name')}>
          <Input
            value={node.title}
            onChange={(event) => {
              props.onTitle(event.target.value);
            }}
            data-testid="insp-title"
          />
        </Field>

        <Field label={t('automations:insp.description', 'Description')}>
          <Input
            value={node.sub ?? ''}
            onChange={(event) => {
              props.onSub(event.target.value);
            }}
            data-testid="insp-sub"
          />
        </Field>

        {isTrigger ? (
          <TriggerSettings
            trigger={props.trigger}
            sources={props.sources}
            table={props.table}
            onChange={props.onTrigger}
          />
        ) : null}

        {node.kind === 'condition' || node.kind === 'branch' ? (
          <ConditionCard
            condition={node.condition}
            columns={columns}
            // The rule's OWN connection: `related-count.ts` counts inside the
            // view of the connection the event came from, so a table from
            // any other one throws "unknown table" at run time.
            tables={connectionForTrigger(props.sources, props.trigger)?.tables ?? []}
            onChange={props.onCondition}
          />
        ) : null}

        {node.kind === 'branch' ? (
          <div className="flex flex-col gap-2.5">
            <div className="text-[11.5px] font-bold">
              {t('automations:insp.branchLabels', 'Branch labels')}
            </div>
            {([0, 1] as const).map((index) => (
              <Input
                key={index}
                value={node.branches[index].label}
                aria-label={t('automations:insp.branchLabels', 'Branch labels')}
                onChange={(event) => {
                  props.onBranchLabel(index, event.target.value);
                }}
                data-testid={`insp-branch-${String(index)}`}
              />
            ))}
          </div>
        ) : null}

        {node.kind === 'wait' ? (
          <Card title={t('automations:wait.for', 'Wait for')}>
            <div className="flex gap-2.5">
              <Input
                type="number"
                min={1}
                value={String(node.amount)}
                aria-label={t('automations:wait.amount', 'Amount')}
                onChange={(event) => {
                  props.onWait({ amount: Math.max(1, Number(event.target.value) || 1) });
                }}
                data-testid="insp-wait-amount"
              />
              <Select
                value={node.unit}
                aria-label={t('automations:wait.unit', 'Unit')}
                onChange={(event) => {
                  props.onWait({ unit: event.target.value as 'minutes' | 'hours' | 'days' });
                }}
                data-testid="insp-wait-unit"
              >
                <option value="minutes">
                  {t('automations:unit.minutes', '{count, plural, one {minute} other {minutes}}', {
                    count: node.amount,
                  })}
                </option>
                <option value="hours">
                  {t('automations:unit.hours', '{count, plural, one {hour} other {hours}}', {
                    count: node.amount,
                  })}
                </option>
                <option value="days">
                  {t('automations:unit.days', '{count, plural, one {day} other {days}}', {
                    count: node.amount,
                  })}
                </option>
              </Select>
            </div>
            <div className="text-[11px] text-fg-subtle">{t('automations:wait.max', 'Up to 30 days')}</div>
          </Card>
        ) : null}

        {node.kind === 'action' ? (
          <ActionSettings
            action={node.action}
            sources={props.sources}
            table={props.table}
            connectionId={props.trigger.connectionId}
            onChange={props.onAction}
          />
        ) : null}

        {/* Absent on trigger / branch / wait / stop — a step with no failure
            mode has nothing to continue past (comp 145-148). */}
        {node.kind === 'action' || node.kind === 'condition' ? (
          <div className="flex items-center gap-3 rounded-[11px] border border-border bg-surface-2 px-3.5 py-3">
            <div className="flex-1">
              <div className="text-[12.5px] font-semibold">
                {t('automations:insp.onError', 'Continue on error')}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-subtle">
                {t('automations:insp.onErrorBody', 'Run later steps even if this one fails')}
              </div>
            </div>
            <Switch
              checked={node.onError}
              onCheckedChange={props.onToggleError}
              aria-label={t('automations:insp.onError', 'Continue on error')}
              data-testid="insp-on-error"
            />
          </div>
        ) : null}
      </DrawerBody>

      <DrawerFooter className="justify-start gap-2">
        <IconButton
          label={t('automations:insp.moveUp', 'Move up')}
          icon="arrow-up"
          disabled={isTrigger}
          onClick={() => {
            props.onMove(-1);
          }}
          testId="insp-up"
        />
        <IconButton
          label={t('automations:insp.moveDown', 'Move down')}
          icon="arrow-down"
          disabled={isTrigger}
          onClick={() => {
            props.onMove(1);
          }}
          testId="insp-down"
        />
        <button
          type="button"
          disabled={isTrigger}
          onClick={props.onDuplicate}
          data-testid="insp-duplicate"
          className="flex h-[38px] flex-1 items-center justify-center gap-[7px] rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-bold text-fg-muted disabled:opacity-40"
        >
          <Glyph name="copy" className="size-[15px]" />
          {t('automations:insp.duplicate', 'Duplicate')}
        </button>
        <button
          type="button"
          disabled={isTrigger}
          onClick={props.onDelete}
          data-testid="insp-delete"
          className="flex h-[38px] items-center justify-center gap-[7px] rounded-[10px] border border-danger-soft bg-danger-soft px-3.5 text-[12.5px] font-bold text-danger disabled:opacity-40"
        >
          <Glyph name="trash-2" className="size-[15px]" />
          {t('automations:insp.delete', 'Delete')}
        </button>
      </DrawerFooter>
    </Drawer>
  );
}

function Glyph({ name, className }: { name: string; className: string }): ReactNode {
  const Icon = automationIcon(name);
  return <Icon aria-hidden className={className} />;
}

function IconButton({
  label,
  icon,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="flex size-[38px] items-center justify-center rounded-[10px] border border-border bg-surface text-fg-muted disabled:opacity-40"
    >
      <Glyph name={icon} className="size-4" />
    </button>
  );
}
