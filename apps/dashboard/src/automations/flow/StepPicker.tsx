// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add a step" (`designs/Automation Rules.dc.html` 75-102, 546-570;
 * 42-automations-and-workflow-logs.md D10, 42-T21).
 *
 * The comp's dialog exactly: 560 px, two uppercase group labels, a two-column
 * grid of tiles, each a 30 px kind-tinted icon with a bold label and a muted
 * description. The context line under the title is the comp's own three
 * sentences — "Before · {title}", "At the end of the flow", "Inside branch ·
 * {label}" (564-568) — because a picker that does not say WHERE it will
 * insert is a picker you have to undo.
 *
 * DEPARTURE D10: six action tiles, not eight. The four that go — Create task,
 * Add tag, Assign owner, Enrich record — name concepts a customer's schema
 * may not have; the runner cannot keep a promise about them, and a tile that
 * fails at run time on most databases is worse than one that is not offered.
 * `model/vocabulary.ts` carries the reasoning and the replacements.
 *
 * The branch tile is hidden INSIDE a branch (comp 570): the graph has no
 * nesting, and hiding the tile is how the person finds that out before they
 * click rather than after.
 */

import { Modal, ModalBody, ModalHeader } from '@adminium/ui';
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import type { InsertTarget, StepDefinition } from '../model/ops.js';
import { ACTION_STEPS, KIND_META, LOGIC_STEPS } from '../model/vocabulary.js';

/** `automations:pick.<key>` and `pick.<key>Desc` — literal, never assembled. */
const TILE_TEXT: Readonly<Record<string, { label: [string, string]; desc: [string, string] }>> = {
  email: {
    label: ['automations:pick.email', 'Send email'],
    desc: ['automations:pick.emailDesc', 'From a saved template'],
  },
  notification: {
    label: ['automations:pick.notification', 'Send notification'],
    desc: ['automations:pick.notificationDesc', 'Tell people in this workspace'],
  },
  create: {
    label: ['automations:pick.create', 'Create record'],
    desc: ['automations:pick.createDesc', 'Add a row to a table'],
  },
  update: {
    label: ['automations:pick.update', 'Update field'],
    desc: ['automations:pick.updateDesc', 'Write back to a record'],
  },
  webhook: {
    label: ['automations:pick.webhook', 'Call webhook'],
    desc: ['automations:pick.webhookDesc', 'Send data anywhere'],
  },
  slack: {
    label: ['automations:pick.slack', 'Slack message'],
    desc: ['automations:pick.slackDesc', 'Post to a channel'],
  },
  branch: {
    label: ['automations:pick.branch', 'If / else branch'],
    desc: ['automations:pick.branchDesc', 'Split into two paths'],
  },
  filter: {
    label: ['automations:pick.filter', 'Only continue if'],
    desc: ['automations:pick.filterDesc', 'Stop when unmatched'],
  },
  wait: {
    label: ['automations:pick.wait', 'Wait / delay'],
    desc: ['automations:pick.waitDesc', 'Hold before next step'],
  },
  stop: {
    label: ['automations:pick.stop', 'Stop workflow'],
    desc: ['automations:pick.stopDesc', 'Halt this run here'],
  },
};

export interface StepPickerProps {
  target: InsertTarget | null;
  /** The comp's context line needs the node it inserts before, or the branch. */
  contextLine: string;
  onPick: (definition: StepDefinition) => void;
  onClose: () => void;
}

export function StepPicker({ target, contextLine, onPick, onClose }: StepPickerProps): ReactNode {
  if (target === null) return null;
  const inBranch = target.branchId !== undefined;
  const logic = inBranch ? LOGIC_STEPS.filter((step) => step.key !== 'branch') : LOGIC_STEPS;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
    >
      <ModalHeader
        title={t('automations:picker.title', 'Add a step')}
        subtitle={contextLine}
        closeLabel={t('automations:picker.close', 'Close')}
      />
      <ModalBody data-testid="step-picker">
        <div className="flex flex-col gap-4">
          <Group
            label={t('automations:picker.actions', 'Actions')}
            steps={ACTION_STEPS}
            onPick={onPick}
          />
          <Group label={t('automations:picker.logic', 'Logic')} steps={logic} onPick={onPick} />
        </div>
      </ModalBody>
    </Modal>
  );
}

function Group({
  label,
  steps,
  onPick,
}: {
  label: string;
  steps: readonly StepDefinition[];
  onPick: (definition: StepDefinition) => void;
}): ReactNode {
  return (
    <div>
      <div className="mb-[9px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg-subtle">
        {label}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {steps.map((step) => {
          const text = TILE_TEXT[step.key];
          const meta = KIND_META[step.kind];
          const Icon = automationIcon(step.icon);
          return (
            <button
              key={step.key}
              type="button"
              data-testid={`step-pick-${step.key}`}
              onClick={() => {
                onPick(step);
              }}
              className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-[11px] text-start hover:border-accent hover:bg-surface-2"
            >
              <span
                className={`flex size-[30px] shrink-0 items-center justify-center rounded-[9px] ${meta.soft} ${meta.text}`}
              >
                <Icon aria-hidden className="size-[15px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-bold text-fg">
                  {text === undefined ? step.label : t(text.label[0], text.label[1])}
                </span>
                <span className="mt-0.5 block text-[11px] text-fg-subtle">
                  {text === undefined ? step.desc : t(text.desc[0], text.desc[1])}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
