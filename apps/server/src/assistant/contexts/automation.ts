// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The automation rules page as a context.
 *
 * A rule is `{ name, description, trigger, graph }`, and a draft is checked
 * by the SAME things the page's own save runs: the stored schemas, and
 * `resolveRule` against the connection's schema, the live email templates and
 * the steps installed add-ons give. So a draft that passes here is one the
 * flow builder can open.
 *
 * WHAT THE MODEL IS TOLD, AND WHAT IT READS. The format is said short
 * (`automation-format.ts`, made from the schema). What a rule can NAME here
 * — templates, add-on steps, address columns — is not in the prompt: it is
 * the read tool `rule_parts`, asked for the one table the rule is about.
 *
 * THE CHECK, NOT THE PROMPT, KEEPS A DRAFT HONEST. A recipient that holds no
 * address, a template placeholder nothing fills, a step no installed add-on
 * gives, an input a step needs: each is refused here with what to do instead,
 * and the model corrects its draft. A sentence in a prompt asks; this decides.
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
import { findStep, stepRefusal, stepsOn } from '../../automations/add-on-steps.js';
import { relatedTarget } from '../../automations/related.js';
import { templateFamilies, type TemplateFamily } from '../../automations/templates.js';
import { firstIncompleteNode, flattenNodes, requiredGrants, resolveRule, ruleWarnings, type RuleSteps } from '../../automations/validate.js';
import type { AddOnInstalls } from '../../apps/table-ref.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { readViewForUser } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { connectionsSection, countLabel, documentNamesSection, readableConnections, tablesSummary } from '../page-facts.js';
import type { AssistantArtefactCheck, AssistantContextAdapter, AssistantDocument, AssistantToolDeps } from '../types.js';
import { addressColumnsOf } from '../tools/rule-parts.js';
import { ruleFormat } from './automation-format.js';
import { clip } from './format.js';

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

/** The keys a step may name, one row each: the same list the page's own select shows and the save checks. */
export async function liveTemplateKeys(deps: Pick<AssistantToolDeps, 'meta'>): Promise<TemplateFamily[]> {
  return (await templateFamilies(deps.meta)).live;
}

function addressColumnsLine(view: SnapshotView, tableId: string): string {
  let names: string[] = [];
  try {
    names = addressColumnsOf(view, view.table(tableId));
  } catch {
    names = [];
  }
  return names.length === 0 ? `No column of ${tableId}, or of a row it links to, does: use typed addresses, or say that there is nobody to write to.` : `The columns that do: ${names.join(', ')}.`;
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

/** Each step of an add-on carries its add-on's name as installed: what the step says of itself the day the add-on is gone. */
function withStepNames(graph: AutomationGraph, steps: RuleSteps): AutomationGraph {
  const copy = JSON.parse(JSON.stringify(graph)) as AutomationGraph;
  for (const node of flattenNodes(copy)) {
    if (node.kind !== 'action' || node.action.kind !== 'add-on.step') continue;
    const answer = steps(node.action.addOn, node.action.step);
    node.action.addOnName = answer.state === 'ok' ? answer.step.addOnName : answer.state === 'no-add-on' ? '' : answer.addOnName;
  }
  return copy;
}

type Rejection = { path: string; code: string; message: string };

/** What a draft got wrong about a step an add-on gives: one that is not there, or a needed input left empty. */
function stepErrors(graph: AutomationGraph, steps: RuleSteps, installs: AddOnInstalls | null, connectionId: string | null): Rejection[] {
  const out: Rejection[] = [];
  const there = installs === null || connectionId === null ? [] : stepsOn(installs, connectionId);
  const offered = there.length === 0 ? 'No installed add-on gives a step here: take this step out, and say in "leftOut" what it would have done.' : `The steps there are: ${there.map((one) => `${one.addOn}/${one.step.key}`).join(', ')}. Use one of them, or take this step out and say so in "leftOut".`;
  for (const node of flattenNodes(graph)) {
    if (node.kind !== 'action' || node.action.kind !== 'add-on.step') continue;
    const at = `graph.nodes[${node.id}].action`;
    const answer = steps(node.action.addOn, node.action.step);
    const refusal = stepRefusal(answer, node.action);
    if (answer.state !== 'ok' || refusal !== null) {
      // "No longer installed" is the sentence for a rule that was saved; of a draft it is simply not there.
      const why = answer.state === 'no-add-on' ? `No add-on with the key "${node.action.addOn}" is installed.` : (refusal ?? '');
      out.push({ path: at, code: 'STEP_NOT_AVAILABLE', message: `${why} ${offered}` });
      continue;
    }
    const empty = answer.step.step.inputs.filter((input) => input.required === true && (node.action.kind === 'add-on.step' ? (node.action.inputs[input.key] ?? '') : '').trim() === '');
    if (empty.length > 0) {
      out.push({ path: `${at}.inputs`, code: 'STEP_INPUT_MISSING', message: `"${answer.step.step.name['en-US']}" needs ${empty.map((input) => `"${input.key}" (${input.label['en-US']}, ${input.kind})`).join(' and ')}. Give each a text, or a column of the record as {{record.<column>}}.` });
    }
  }
  return out;
}

/** The placeholders of each email step's template that nothing fills: not the rule, not the record, not the step's `vars`. */
function placeholderErrors(graph: AutomationGraph, families: readonly TemplateFamily[], view: SnapshotView | null, subject: string): Rejection[] {
  let table: ResolvedTable | null = null;
  try {
    table = view === null || subject === '' ? null : view.table(subject);
  } catch {
    table = null;
  }
  const ofRecord = (name: string): boolean => {
    if (table === null) return false;
    const column = name.startsWith('record.') ? name.slice('record.'.length) : name;
    if (table.columns.has(column)) return true;
    const dot = column.indexOf('.');
    if (dot <= 0 || view === null) return false;
    return relatedTarget(view, table, column.slice(0, dot))?.table.columns.has(column.slice(dot + 1)) === true;
  };
  const out: Rejection[] = [];
  for (const node of flattenNodes(graph)) {
    if (node.kind !== 'action' || node.action.kind !== 'email' || node.action.templateKey === null) continue;
    const key = node.action.templateKey;
    const family = families.find((one) => one.key === key);
    if (family === undefined) continue;
    const at = `graph.nodes[${node.id}].action`;
    if (family.ownedByApp) {
      out.push({ path: `${at}.templateKey`, code: 'TEMPLATE_NOT_A_RULES', message: `"${family.key}" is an app's own template: its app fills it, a rule cannot. Choose another from rule_parts.` });
      continue;
    }
    const vars = node.action.vars ?? {};
    const backed = new Set(family.backed);
    const unfilled = family.placeholders.filter((name) => !backed.has(name) && !(RULE_EMAIL_VARS as readonly string[]).includes(name) && !Object.hasOwn(vars, name) && !ofRecord(name));
    if (unfilled.length === 0) continue;
    const first = unfilled[0] as string;
    out.push({
      path: `${at}.vars`,
      code: 'PLACEHOLDER_UNFILLED',
      message: `The template "${family.key}" reads ${unfilled.map((name) => `{{${name}}}`).join(', ')}, which nothing fills here. Fill each in this step's "vars" (for example "vars": { "${first}": "{{record.<a column that holds it>}}" }; a linked row's column is {{record.<link>.<column>}}), or choose a template that fits.`,
    });
  }
  return out;
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
      ruleFormat(),
      '',
      'Rules of the format:',
      '- `graph.nodes[0]` is the one `trigger` node (a title for the card); the real trigger settings live in `trigger`.',
      '- Every node needs a unique short `id` and a `title` a person would read.',
      '- Table and column names are EXACTLY the ones `describe_schema` lists. Call it before naming any; never guess a column.',
      '- Before a rule that sends an email or needs more than a plain step, call `rule_parts` for the rule\'s table: it lists the templates, the add-on steps and the address columns there are. Name nothing it does not list.',
      '- There is no "delivered" or "paid" event. A rule fires on a record being created, updated or deleted, or on a schedule. "When an order is delivered" is `updated` with `changedColumn` on the column that records it, plus a `when` condition on the value it must hold.',
      '- A mail to "the customer of an order" goes to the address column of the LINKED row (`customer_id.email`), never to the link itself.',
      '- Text values may carry `{{record.<column>}}`, a linked row\'s `{{record.<link>.<column>}}`, `{{recordLabel}}`, `{{ruleName}}` and `{{now}}`. `{{record.first_name|there}}` writes "there" when the value is empty.',
      '- When no step can do a part of what was asked, draft the rest and put that part in "leftOut" with why. Never invent a step, a template or a column to cover it. When an add-on that is not installed would give it, name its key in "suggest".',
      '- When no live template fits the email, say so in "say" and offer to draft one on Email templates; do not name a template that does not fit.',
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
    const connectionId = connectionOf(trigger);
    // The steps installed add-ons give on the rule's own database, as they stand now.
    const installs = deps.installs === undefined ? null : await deps.installs().catch(() => null);
    const steps: RuleSteps = (addOn, step) => (installs === null || connectionId === null ? { state: 'no-add-on' } : findStep(installs, connectionId, addOn, step));
    const graph = withStepNames(withoutSealedSecrets(parsed.data.graph), steps);

    // A step of an add-on: a person may keep one whose add-on is gone; a DRAFT may not name one
    // that is not there, nor leave empty an input it needs. Said with what there is instead.
    const missing = stepErrors(graph, steps, installs, connectionId);
    if (missing.length > 0) return { ok: false, errors: missing };

    let whole: SnapshotView | null = null;
    try {
      // As its author reads the table: a rule cannot name a column their role is not shown.
      whole = connectionId === null ? null : await loadSnapshotView(deps.meta, connectionId);
      const view = whole === null || deps.userId === null ? whole : await readViewForUser(deps.meta, deps.userId, whole);
      resolveRule(trigger, graph, {
        view,
        templateKeys: new Set((await liveTemplateKeys(deps)).map((row) => row.key)),
        blockLoopback: process.env['NODE_ENV'] === 'production',
        steps,
      });
    } catch (error) {
      return {
        ok: false,
        errors: [{ path: 'graph', code: 'RULE_INVALID', message: error instanceof Error ? error.message : String(error) }],
      };
    }
    // The author's own reach, as the page's own save asks it: read on what the rule watches,
    // create and update on what its steps write, an add-on's step among them.
    for (const { permission, table } of requiredGrants(trigger, graph, connectionId, whole, steps)) {
      if (await deps.can(permission)) continue;
      return {
        ok: false,
        errors: [{ path: 'graph', code: 'TABLE_FORBIDDEN', message: `You do not have access to ${table}, so a rule cannot use it.` }],
      };
    }
    const subject = trigger.kind === 'record' ? trigger.table : (trigger.forEach?.table ?? '');
    // A mail goes to a column that holds addresses. A person may point one elsewhere and is
    // warned; a draft may not, and is told which columns do, one hop away included, so it
    // writes to the order's customer and not to "customer_id".
    const odd = ruleWarnings(trigger, graph, whole);
    if (odd.length > 0 && whole !== null) {
      return {
        ok: false,
        errors: odd.map((warning) => ({
          path: `graph.nodes[${warning.nodeId}].action.to.column`,
          code: 'RECIPIENT_NOT_ADDRESS',
          message: `"${warning.column}" does not hold email addresses. ${addressColumnsLine(whole as SnapshotView, subject)}`,
        })),
      };
    }
    // A template's placeholder that nothing fills goes out as written. A person is shown which
    // in the builder; a draft is sent back to fill it, or to choose a template that fits.
    const unfilled = placeholderErrors(graph, (await templateFamilies(deps.meta)).live, whole, subject);
    if (unfilled.length > 0) return { ok: false, errors: unfilled };
    const incomplete = firstIncompleteNode(graph, steps);
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
  toolNames: ['workspace_settings', 'list_connections', 'describe_schema', 'rule_parts', 'list_add_ons', 'read_rows', 'sample_record'],

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
        templates.length === 0
          ? 'No live email template exists: an email step cannot be completed until one does; say so, and offer to draft one on Email templates.'
          : `${countLabel(templates.filter((row) => !row.ownedByApp).length, 'live email template', 'live email templates')} a rule may send. \`rule_parts\` lists them for a table, with what each reads.`,
        `An email step fills a placeholder only from: ${RULE_EMAIL_VARS.map((name) => `{{${name}}}`).join(' ')}, a column of the triggering record or of a row it links to, and the step's own \`vars\`. A draft that leaves one unfilled is sent back to you.`,
        '',
        'Connected databases and the tables this person may read:',
        connectionsSection(connections),
      ].join('\n'),
    };
  },

  document: automationDocument,
};
