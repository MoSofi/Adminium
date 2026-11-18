// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FUNNEL'S RULE, AS ITS READERS ARE SHOWN IT: "What happens after".
 *
 * A funnel names one rule, picked by hand (`rule_id`). The people who read
 * the funnel (a marketer among them) may hold no system permission, so they
 * never read the rule itself: they are shown its name and its steps as chips,
 * the trigger and each step by its kind and the title staff gave it, in the
 * order the automations page draws them. Nothing else of the rule goes out:
 * never a step's settings, an address it writes to, a condition's value or a
 * template.
 *
 * Pure.
 */
import type { Automation, AutomationGraph } from '@adminium/meta';

/** The longest title a chip carries. */
const TITLE_MAX = 120;

/** One step of a rule, as a chip says it. */
export type RuleChip =
  | { kind: 'trigger'; title: string; on: 'record'; event: 'created' | 'updated' | 'deleted' }
  | { kind: 'trigger'; title: string; on: 'schedule' }
  | { kind: 'action'; title: string; action: string }
  | { kind: 'condition'; title: string }
  | { kind: 'wait'; title: string; amount: number; unit: string }
  | { kind: 'branch'; title: string }
  | { kind: 'stop'; title: string };

function title(text: string): string {
  return [...text.trim()].slice(0, TITLE_MAX).join('');
}

/** A rule's steps as chips: its trigger first, then its top-level steps in order (a branch is one chip). */
export function ruleChips(rule: Pick<Automation, 'trigger'> & { graph: AutomationGraph }): RuleChip[] {
  return rule.graph.nodes.map((node): RuleChip => {
    switch (node.kind) {
      case 'trigger':
        return rule.trigger.kind === 'record' ? { kind: 'trigger', title: title(node.title), on: 'record', event: rule.trigger.event } : { kind: 'trigger', title: title(node.title), on: 'schedule' };
      case 'action':
        return { kind: 'action', title: title(node.title), action: node.action.kind };
      case 'condition':
        return { kind: 'condition', title: title(node.title) };
      case 'wait':
        return { kind: 'wait', title: title(node.title), amount: node.amount, unit: node.unit };
      case 'branch':
        return { kind: 'branch', title: title(node.title) };
      case 'stop':
        return { kind: 'stop', title: title(node.title) };
    }
  });
}
