// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A MANIFEST CAN CHECK OF `addOn.assistant`: that every table and column
 * it describes, and every page a question is for, is the add-on's own. A line
 * about a table the add-on does not have would be a line about somebody
 * else's data, in the add-on's voice.
 */
import type { AddOnAssistant } from '@adminium/add-on-contracts';

export interface AssistantTableShape {
  ref: string;
  columns: readonly { ref: string }[];
}

type Issue = { path: (string | number)[]; message: string };

export function assistantIssues(block: AddOnAssistant, tables: readonly AssistantTableShape[], pages: readonly string[]): Issue[] {
  const out: Issue[] = [];
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  for (const [ref, note] of Object.entries(block.tables ?? {})) {
    const table = byRef.get(ref);
    if (table === undefined) {
      out.push({ path: ['addOn', 'assistant', 'tables', ref], message: `"${ref}" is not one of this add-on's tables: it says only what its own are` });
      continue;
    }
    for (const column of Object.keys(note.columns ?? {})) {
      if (!table.columns.some((candidate) => candidate.ref === column)) out.push({ path: ['addOn', 'assistant', 'tables', ref, 'columns', column], message: `"${ref}" has no column "${column}"` });
    }
  }
  (block.questions ?? []).forEach((question, q) => {
    if (question.page !== undefined && !pages.includes(question.page)) {
      out.push({ path: ['addOn', 'assistant', 'questions', q, 'page'], message: `"${question.page}" is not one of this add-on's pages` });
    }
  });
  return out;
}
