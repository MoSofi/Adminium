// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Everywhere else: a page with no context of its own (Home, the settings
 * screens, an app's framed staff side). The assistant answers questions about
 * the workspace and its data and says WHERE things are done. It drafts
 * nothing, so this adapter has no document.
 *
 * It is the fallback only: a page that has a context always uses its own.
 * What the host says of the page is two short strings (the router's route id
 * and, over a framed staff side, the app's key). Neither is trusted for
 * anything but a line of the prompt: no tool reads them.
 */
import { connectionsSection, readableConnections, tablesSummary } from '../page-facts.js';
import type { AssistantContextAdapter, AssistantFactValues } from '../types.js';

/** A route id or an app key as it may be quoted to a model: short, one line, nothing that could be read as an instruction. */
function quotable(raw: string | undefined, max: number): string | null {
  if (raw === undefined) return null;
  const clean = raw.replace(/[^A-Za-z0-9/_$.-]/g, '').slice(0, max);
  return clean === '' ? null : clean;
}

export const generalContext: AssistantContextAdapter = {
  key: 'general',
  pageLabel: 'Workspace',
  toolNames: ['where_is', 'list_connections', 'describe_schema', 'read_rows', 'aggregate', 'sample_record', 'list_add_ons'],

  async pageFacts(deps) {
    const connections = await readableConnections(deps);
    const summary = tablesSummary(connections);
    const values: AssistantFactValues = { tables: summary.tables };
    const route = quotable(deps.host.route, 120);
    const app = quotable(deps.host.app, 64);
    if (app !== null) values.app = app;

    const lines: string[] = [];
    if (app !== null) {
      lines.push(`The person is looking at the staff screens of the app "${app}", shown inside the dashboard. You do not see what is on those screens.`);
    } else if (route !== null) {
      lines.push(`The person is on the dashboard screen whose route is ${route}. You do not see what is on it.`);
    } else {
      lines.push('The person is somewhere in the dashboard. You do not see what is on their screen.');
    }
    lines.push(
      '',
      'You answer questions about this workspace: what its data says, and where things are done.',
      'For "where do I…", "how do I get to…" or "which page shows…", call where_is and answer from it: name the place and give its path as a link. Name no page or screen that where_is did not give you.',
      'For a question about the data, read it with the tools and answer in "say", in words, with the figures. When `returned` is less than `total` your answer is about a part of the rows: say so, with both numbers.',
      'You draft nothing here and you change nothing. Asked to write an email template, a report, an invoice template or an automation rule, say which place does that (from where_is) and that you can draft it there.',
      'A question about what they CAN do here ("can I give customers a discount code?") is a question about what this workspace offers: call list_add_ons before you say it cannot be done.',
      '',
      'The databases you may read:',
      connectionsSection(connections),
    );

    return {
      values,
      scope: { primary: app ?? '', extra: summary.tables },
      prompt: lines.join('\n'),
    };
  },
};
