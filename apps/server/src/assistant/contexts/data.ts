// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A data page: any page bound to a table. The assistant answers questions
 * about what the page shows, in words, with the figures. It drafts nothing,
 * so this adapter has no document: the prompt has no document sections and
 * the reply contract no `result`.
 *
 * One adapter serves every page kind. What differs between a grid, a record
 * and a board is which table the page is bound to and what it is showing,
 * and both are facts the server reads (`data-page.ts`), not text the page
 * sends.
 */
import { dataPageOf, defaultScope, type DataPage } from '../data-page.js';
import { connectionsSection, readableConnections, tablesSummary } from '../page-facts.js';
import type { AssistantContextAdapter, AssistantFactValues } from '../types.js';

/** The grid's state in a sentence the model can use: what "these" would mean right now. */
function viewLines(page: DataPage): string[] {
  const view = page.view;
  const lines: string[] = [];
  const selected = view.selectedIds?.length ?? 0;
  if (selected > 0) lines.push(`The person has ${String(selected)} row${selected === 1 ? '' : 's'} selected (scope "selection").`);
  if (view.recordId !== undefined && view.recordId !== '') lines.push(`A record is open: key ${JSON.stringify(view.recordId)} (scope "record").`);
  const shown: string[] = [];
  if (view.q !== undefined && view.q !== '') shown.push(`a search for ${JSON.stringify(view.q)}`);
  if (view.where !== undefined && view.where !== '') shown.push('filters');
  // What the browser sent, so only what a sort is made of is quoted: column names, a direction, a comma.
  const order = (view.order ?? '').replace(/[^A-Za-z0-9_.,]/g, '').slice(0, 120);
  if (order !== '') shown.push(`sorted by ${order}`);
  lines.push(
    shown.length === 0
      ? 'The grid shows every row of the table (scope "page" is the whole table).'
      : `The grid shows a part of the table: ${shown.join(', ')} (scope "page" is exactly those rows).`,
  );
  lines.push(`When the person says "these" with nothing else, they most likely mean scope "${defaultScope(view)}".`);
  return lines;
}

export const dataContext: AssistantContextAdapter = {
  key: 'data',
  pageLabel: 'Data',
  toolNames: ['list_connections', 'describe_schema', 'read_rows', 'aggregate', 'sample_record', 'list_add_ons', 'where_is'],

  async pageFacts(deps) {
    const page = await dataPageOf(deps);
    const connections = await readableConnections(deps);
    const summary = tablesSummary(connections);
    const values: AssistantFactValues = { tables: summary.tables };
    const lines: string[] = [];

    if (page === null) {
      lines.push('The person is on a page of this workspace. Which table it shows is not known to you: ask describe_schema, or ask the person.');
    } else if (page.table === null) {
      values.page = page.title;
      lines.push(`The person is on the page "${page.title}", which shows several tables at once. There is no single "this table": when a question could be about more than one, ask which with "ask".`);
    } else {
      values.page = page.title;
      values.table = page.table;
      const selected = page.view.selectedIds?.length ?? 0;
      if (selected > 0) values.selected = selected;
      lines.push(`The person is on the page "${page.title}", which shows the table ${page.table} of connection ${page.connectionId ?? '(unknown)'}.`);
      lines.push(...viewLines(page));
    }

    lines.push(
      '',
      'Answer in "say", in words, with the figures you read. When a question names no measure ("best customers", "busiest day"), use the most natural one the tables can give, and say which one you used.',
      'Every row tool answers `returned` and `total`. When `returned` is less than `total` your answer is about a part of the rows: say so, with both numbers, or read the rest with `offset`.',
      'You cannot change the page (its filters, its saved views) and you cannot change rows. If the person asks you to DO that, say so.',
      'For "where do I…" or "how do I get to…" (a settings screen, another page), call where_is and answer from it with the place\'s path as a link. Name no page or screen where_is did not give you, and never guess at a menu.',
      'A question about what they CAN do here ("can I give customers a discount code?", "is there a way to print labels?") is a question about what this workspace offers, not a request to you. Before you answer that something cannot be done, call list_add_ons. If an add-on that is NOT installed would give it, say in one sentence what is missing and put its key in "suggest" (three at most). Never suggest one that is installed, and never when nothing asked for needs one.',
      '',
      'The databases you may read:',
      connectionsSection(connections),
    );

    return {
      values,
      scope: { primary: page?.table ?? page?.title ?? '', extra: Math.max(summary.tables - (page?.table == null ? 0 : 1), 0) },
      prompt: lines.join('\n'),
    };
  },
};
