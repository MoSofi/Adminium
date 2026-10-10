// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE ASSISTANT PUT INTO THE OPEN RULE, AND THE WAY BACK.
 *
 * A change the assistant makes goes into the page's own unsaved draft. Until
 * the person edits, saves or undoes, the page keeps what the draft was BEFORE
 * (null: the rule as saved) and which steps are new. A second change applied
 * on top of the first keeps the first one's way back: one Undo returns to
 * what the person had, never to the assistant's earlier change.
 */
export interface AssistantChange<Draft> {
  ruleId: string;
  /** The person's own unsaved draft from before; null when the rule was as saved. */
  before: Draft | null;
  /** The steps that are new, by id. */
  added: string[];
}

export function afterApply<Draft>(
  current: AssistantChange<Draft> | null,
  now: { ruleId: string; dirty: boolean; draft: Draft | null; added: readonly string[] },
): AssistantChange<Draft> {
  const earlier = current !== null && current.ruleId === now.ruleId && now.dirty ? current : null;
  if (earlier === null) return { ruleId: now.ruleId, before: now.dirty ? now.draft : null, added: [...now.added] };
  return { ...earlier, added: [...new Set([...earlier.added, ...now.added])] };
}
