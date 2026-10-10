// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The automation rules page as a context. PROTOTYPE — a local spike, not the
 * shape the feature ships in.
 *
 * A rule is `{ name, description, trigger, graph }`, and a draft is checked
 * by the SAME two things the page's own save runs: the stored schemas, and
 * `resolveRule` against the connection's schema and the live email templates.
 * So a draft that passes here is one the flow builder can open.
 *
 * A save from here lands the rule SWITCHED OFF. A rule is a standing
 * instruction that sends mail and writes rows; switching it on is a person's
 * act on the page's own toggle.
 */

import {
  automationGraphSchema,
  automationTriggerSchema,
  automationsRepo,
  type AutomationGraph,
  type AutomationTrigger,
} from '@adminium/meta';
import { z } from 'zod';

import { RULE_EMAIL_VARS } from '../../automations/actions/email.js';
import { templateFamilies } from '../../automations/templates.js';
import { isAddressColumn, relatedTargets } from '../../automations/related.js';
import { firstIncompleteNode, flattenNodes, requiredGrants, resolveRule, ruleWarnings } from '../../automations/validate.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { readViewForUser } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { connectionsSection, countLabel, documentNamesSection, readableConnections, tablesSummary } from '../page-facts.js';
import type { AssistantArtefactCheck, AssistantContextAdapter, AssistantDocument, AssistantToolDeps } from '../types.js';
import { clip, jsonSchemaOf } from './format.js';

const artefactSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).nullish(),
  trigger: automationTriggerSchema,
  graph: automationGraphSchema,
});

/** The connection a rule runs against — the trigger's, never a second field to disagree with it. */
export function connectionOf(trigger: AutomationTrigger): string | null {
  return trigger.connectionId;
}

/** Live template keys — the same set the page's own save offers a step. */
interface LiveTemplate {
  key: string;
  name: string;
  /** Every `{{name}}` the template reads. */
  placeholders: string[];
  /** An app shipped it and fills it with its own sender; a rule cannot. */
  ownedByApp: boolean;
}

/** The keys a step may name, one row each: the same list the page's own select shows and the save checks. */
export async function liveTemplateKeys(deps: Pick<AssistantToolDeps, 'meta'>): Promise<LiveTemplate[]> {
  return (await templateFamilies(deps.meta)).live;
}

/**
 * The columns of a table, and of the rows its links lead to, that hold email
 * addresses: what an email step's recipient may be, as a rule spells it.
 */
export function addressColumns(view: SnapshotView, tableId: string): string[] {
  let table: ResolvedTable;
  try {
    table = view.table(tableId);
  } catch {
    return [];
  }
  const own = [...table.columns.keys()].filter((name) => isAddressColumn(table, name));
  const far = relatedTargets(view, table).flatMap(({ link, target }) => [...target.table.columns.keys()].filter((name) => isAddressColumn(target.table, name)).map((name) => `${link}.${name}`));
  return [...own, ...far];
}

function addressColumnsLine(view: SnapshotView, tableId: string): string {
  const names = addressColumns(view, tableId);
  return names.length === 0 ? `No column of ${tableId}, or of a row it links to, does: use typed addresses, or say that there is nobody to write to.` : `The columns that do: ${names.join(', ')}.`;
}

function templateLine(row: LiveTemplate): string {
  const reads = row.placeholders.length === 0 ? 'reads no placeholder' : `reads ${row.placeholders.map((name) => `{{${name}}}`).join(' ')}`;
  return `- ${row.key} — ${row.name} — ${reads}${row.ownedByApp ? ' — an app\'s own template: its app fills it, a rule cannot' : ''}`;
}

function triggerLine(trigger: unknown): string {
  const value = (typeof trigger === 'object' && trigger !== null ? trigger : {}) as Record<string, unknown>;
  if (value.kind === 'record') {
    const changed = typeof value.changedColumn === 'string' && value.changedColumn !== '' ? ` (${value.changedColumn} changed)` : '';
    return `trigger: record ${String(value.event)} in ${String(value.table)}${changed}`;
  }
  return `trigger: schedule ${JSON.stringify(value.schedule ?? {})}`;
}

function nodeLine(node: Record<string, unknown>): string {
  const kind = String(node.kind);
  const title = clip(typeof node.title === 'string' ? node.title : '', 60);
  if (kind === 'action') {
    const action = (typeof node.action === 'object' && node.action !== null ? node.action : {}) as Record<string, unknown>;
    return `step: ${String(action.kind)} "${title}" ${clip(JSON.stringify(action), 160)}`;
  }
  if (kind === 'condition' || kind === 'branch') return `step: ${kind} "${title}" ${clip(JSON.stringify(node.condition ?? {}), 160)}`;
  if (kind === 'wait') return `step: wait "${title}" ${String(node.amount)} ${String(node.unit)}`;
  return `step: ${kind} "${title}"`;
}

/** Name, trigger, then one line per step — the diff's canonical form. */
function projectForDiff(artefact: Record<string, unknown>): string[] {
  const lines = [`name: ${typeof artefact.name === 'string' ? artefact.name : ''}`, triggerLine(artefact.trigger)];
  const parsed = automationGraphSchema.safeParse(artefact.graph);
  if (!parsed.success) return lines;
  for (const node of flattenNodes(parsed.data)) {
    if (node.kind === 'trigger') continue;
    lines.push(nodeLine(node as unknown as Record<string, unknown>));
  }
  return lines;
}

/** A webhook's sealed header is the server's to write; a draft never carries one. */
function withoutSealedSecrets(graph: AutomationGraph): AutomationGraph {
  const copy = JSON.parse(JSON.stringify(graph)) as AutomationGraph;
  for (const node of flattenNodes(copy)) {
    if (node.kind === 'action' && node.action.kind === 'webhook') {
      node.action.headerValueEncrypted = null;
      delete node.action.headerValueSet;
    }
  }
  return copy;
}

const EXAMPLE = {
  name: 'Thank a customer when their order ships',
  description: 'Sends the order-shipped email once the shipped date is filled in.',
  trigger: {
    kind: 'record',
    event: 'updated',
    connectionId: '<connection id>',
    table: '<table id from describe_schema>',
    watch: true,
    changedColumn: 'shipped_date',
    when: [{ left: { field: 'shipped_date' }, op: 'not_empty' }],
  },
  graph: {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'Order is shipped' },
      {
        id: 'n2',
        kind: 'action',
        title: 'Send the thank-you email',
        onError: false,
        action: { kind: 'email', templateKey: '<a live template key>', to: { kind: 'field', column: 'email' } },
      },
    ],
  },
};

/** What this page drafts: its format, its worked examples, its own validator and what a diff compares. */
const automationDocument: AssistantDocument = {
  formatSpec() {
    return [
      'A rule is `{ name, description, trigger, graph }`.',
      'The `trigger`, as JSON Schema:',
      jsonSchemaOf(automationTriggerSchema),
      'The `graph`, as JSON Schema:',
      jsonSchemaOf(automationGraphSchema),
      '',
      'Rules of the format:',
      '- `graph.nodes[0]` is the one `trigger` node (a title for the card); the real trigger settings live in `trigger`.',
      '- Every node needs a unique short `id` and a `title` a person would read.',
      '- Table and column names are EXACTLY the ones `describe_schema` lists. Call it before naming any; never guess a column.',
      '- There is no "delivered" or "paid" event. A rule fires on a record being created, updated or deleted, or on a schedule. "When an order is delivered" is `updated` with `changedColumn` on the column that records it, plus a `when` condition.',
      '- The step kinds are the only ones there are: email, notification, record.create, record.update, webhook, document.render, plus condition, branch, wait and stop. If the person asks for something no step can do (for example issuing a discount code), draft the steps that exist and say plainly in `say` what is missing.',
      '- An email step names a LIVE template by `templateKey` from the list above; it does not carry its own subject or body. `to` is `{ kind: "field", column }` for an address column on the record, or `{ kind: "fixed", addresses }`.',
      '- Text values may carry `{{record.<column>}}`, `{{recordLabel}}`, `{{ruleName}}` and `{{now}}`.',
      '- A rule you draft is saved SWITCHED OFF. Say so, and say what it will do once somebody switches it on.',
    ].join('\n');
  },

  examples() {
    return [JSON.stringify(EXAMPLE)];
  },

  async acceptArtefact(artefact, deps): Promise<AssistantArtefactCheck> {
    const parsed = artefactSchema.safeParse(artefact);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: 'ARTEFACT_INVALID',
          message: issue.message,
        })),
      };
    }
    const { trigger } = parsed.data;
    const graph = withoutSealedSecrets(parsed.data.graph);
    const connectionId = connectionOf(trigger);
    try {
      // As its author reads the table: a rule cannot name a column their role is not shown.
      const whole = connectionId === null ? null : await loadSnapshotView(deps.meta, connectionId);
      const view = whole === null || deps.userId === null ? whole : await readViewForUser(deps.meta, deps.userId, whole);
      resolveRule(trigger, graph, {
        view,
        templateKeys: new Set((await liveTemplateKeys(deps)).map((row) => row.key)),
        blockLoopback: process.env['NODE_ENV'] === 'production',
      });
    } catch (error) {
      return {
        ok: false,
        errors: [{ path: 'graph', code: 'RULE_INVALID', message: error instanceof Error ? error.message : String(error) }],
      };
    }
    // The author's own reach, as the page's own save asks it: read on what the rule watches,
    // create and update on what its steps write.
    const whole = connectionId === null ? null : await loadSnapshotView(deps.meta, connectionId).catch(() => null);
    for (const { permission, table } of requiredGrants(trigger, graph, connectionId, whole)) {
      if (await deps.can(permission)) continue;
      return {
        ok: false,
        errors: [{ path: 'graph', code: 'TABLE_FORBIDDEN', message: `You do not have access to ${table}, so a rule cannot use it.` }],
      };
    }
    // A mail goes to a column that holds addresses. A person may point one elsewhere and is
    // warned; a draft may not, and is told which columns do, one hop away included, so it
    // writes to the order's customer and not to "customer_id".
    const odd = ruleWarnings(trigger, graph, whole);
    if (odd.length > 0 && whole !== null) {
      const subject = trigger.kind === 'record' ? trigger.table : (trigger.forEach?.table ?? '');
      return {
        ok: false,
        errors: odd.map((warning) => ({
          path: `graph.nodes[${warning.nodeId}].action.to.column`,
          code: 'RECIPIENT_NOT_ADDRESS',
          message: `"${warning.column}" does not hold email addresses. ${addressColumnsLine(whole, subject)}`,
        })),
      };
    }
    const incomplete = firstIncompleteNode(graph);
    return {
      ok: true,
      artefact: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        connectionId,
        trigger: trigger as unknown as Record<string, unknown>,
        graph: graph as unknown as Record<string, unknown>,
        // Never on. A person switches a rule on; this page's assistant does not.
        enabled: false,
        incompleteNodeId: incomplete?.id ?? null,
      },
    };
  },

  projectForDiff,

  async baseForDiff(basedOn, deps) {
    const rule = await automationsRepo(deps.meta).findById(basedOn);
    if (rule === null) return null;
    return projectForDiff({ name: rule.name, trigger: rule.trigger, graph: rule.graph });
  },

  details() {
    return [];
  },
};

export const automationContext: AssistantContextAdapter = {
  key: 'automation',
  pageLabel: 'Automation rules',
  toolNames: ['workspace_settings', 'list_connections', 'describe_schema', 'read_rows', 'sample_record'],

  async pageFacts(deps) {
    // The rules' names are the page's own: only someone who may open that page is told them.
    const rules = (await deps.can(PERMISSIONS.automationsManage)) ? await automationsRepo(deps.meta).list() : [];
    const templates = await liveTemplateKeys(deps);
    const connections = await readableConnections(deps);
    const summary = tablesSummary(connections);
    const named = summary.connections === 1 ? (connections.find((entry) => entry.tables.length > 0)?.name ?? '') : '';
    return {
      values: {
        rules: rules.length,
        templates: templates.length,
        tables: summary.tables,
        ...(named === '' ? {} : { connection: named }),
      },
      scope: { primary: 'automations', extra: summary.tables },
      prompt: [
        `This page holds ${countLabel(rules.length, 'rule', 'rules')}: ${documentNamesSection(rules.map((rule) => `${rule.name} (${rule.enabled ? 'on' : 'off'})`))}.`,
        '',
        'Live email templates an email step may name, as `key — name — the placeholders it reads`:',
        templates.length === 0 ? 'none — an email step cannot be completed until one exists; say so.' : templates.map(templateLine).join('\n'),
        `An email step fills a placeholder only from: ${RULE_EMAIL_VARS.map((name) => `{{${name}}}`).join(' ')}, a column of the triggering record ({{record.<column>}} or the bare {{<column>}}), and the step's own \`vars\` (placeholder name → a text that may carry {{record.<column>}}).`,
        'Name only a template whose every placeholder is filled that way. Fill one the record does not have through `vars` when a column holds the value under another name. Never name an app\'s own template. When a placeholder cannot be filled, say which one in your reply.',
        '',
        'Connected databases and the tables this person may read:',
        connectionsSection(connections),
      ].join('\n'),
    };
  },

  document: automationDocument,
};
