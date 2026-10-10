// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `rule_parts`: what a rule on one table can name.
 *
 * A rule is made of things that exist here and nowhere else: this
 * workspace's live email templates, the steps its installed add-ons give, the
 * columns of this table (and of the rows it links to) that hold an address. A
 * model that is not told them invents them: a template key that sounds right,
 * a "send coupon" step, a mail addressed to `customer_id`. So they are a READ
 * the assistant makes before it drafts, for the one table the rule is about,
 * instead of a list in the prompt of every conversation.
 *
 * It answers what the ACTING PERSON may use: a table they cannot read is not
 * described, and a step whose row they may not add says so.
 */
import { RULE_EMAIL_VARS } from '../../automations/actions/email.js';
import { personalInputs, stepsOn } from '../../automations/add-on-steps.js';
import { isAddressColumn, relatedTargets } from '../../automations/related.js';
import { templateFamilies } from '../../automations/templates.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { AssistantTool } from '../types.js';
import { tableLabel, viewOrError } from './schema.js';

/** Templates one answer carries. A workspace has seventy; a rule needs one. */
export const RULE_PARTS_TEMPLATES_MAX = 30;

/**
 * The columns of a table, and of the rows its links lead to, that hold email
 * addresses: what an email step's recipient may be, as a rule spells it.
 */
export function addressColumnsOf(view: SnapshotView, table: ResolvedTable): string[] {
  const own = [...table.columns.keys()].filter((name) => isAddressColumn(table, name));
  const far = relatedTargets(view, table).flatMap(({ link, target }) => [...target.table.columns.keys()].filter((name) => isAddressColumn(target.table, name)).map((name) => `${link}.${name}`));
  return [...own, ...far];
}

export const rulePartsTool: AssistantTool = {
  name: 'rule_parts',
  description:
    `What a rule about ONE table can name, read from this workspace: the live email templates (at most ${String(RULE_PARTS_TEMPLATES_MAX)}; each with the placeholders it reads and which of them the rule's step must fill through "vars"), the steps installed add-ons give (each with its add-on's key, its own key and its inputs), and the columns that hold email addresses (the table's own, and a linked row's as "<link>.<column>"). Call it before you draft a rule that sends an email or needs something a plain step cannot do. Name nothing in a rule that it does not list.`,
  args: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      table: { type: 'string', description: 'The table the rule is about: an id from describe_schema.' },
      find: { type: 'string', description: 'Words to narrow the templates by (their key or name), e.g. "thank". Omit to list them all.' },
    },
    required: ['connectionId', 'table'],
    additionalProperties: false,
  },
  async run(args, deps) {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : '';
    const tableId = typeof args.table === 'string' ? args.table : '';
    if (connectionId === '' || tableId === '') return { error: { code: 'BAD_ARGS', message: 'rule_parts needs a `connectionId` and a `table`.' } };
    const resolved = await viewOrError(deps, connectionId);
    if ('error' in resolved) return { error: resolved.error };
    const canRead = await deps.canReadTable(connectionId);
    let table: ResolvedTable;
    try {
      table = resolved.view.table(tableId);
    } catch {
      return { error: { code: 'TABLE_NOT_FOUND', message: `No table has the id ${JSON.stringify(tableId)}. Take the id from describe_schema.` } };
    }
    if (!(await canRead(table.id))) return { error: { code: 'TABLE_FORBIDDEN', message: `You may not read ${table.id}, so a rule of yours cannot be about it.` } };

    // A linked row counts only when its table is this person's to read too.
    const reachable: string[] = [];
    for (const name of addressColumnsOf(resolved.view, table)) {
      const link = name.includes('.') ? name.slice(0, name.indexOf('.')) : null;
      const target = link === null ? null : relatedTargets(resolved.view, table).find((one) => one.link === link)?.target.table.id;
      if (target === null || target === undefined || (await canRead(target))) reachable.push(name);
    }

    const families = await templateFamilies(deps.meta);
    const words = (typeof args.find === 'string' ? args.find : '').toLowerCase().split(/\s+/).filter((word) => word !== '');
    // An app's own template is filled by that app's sender: a rule cannot name it, so it is not offered.
    const usable = families.live.filter((family) => !family.ownedByApp);
    const matching = words.length === 0 ? usable : usable.filter((family) => words.some((word) => `${family.key} ${family.name}`.toLowerCase().includes(word)));
    // What a rule fills by itself: its own words, a column of the record, a column of a row the record links to.
    const linked = relatedTargets(resolved.view, table).flatMap(({ link, target }) => [...target.table.columns.keys()].map((name) => `${link}.${name}`));
    const ruleFills = new Set<string>([...RULE_EMAIL_VARS, ...[...table.columns.keys(), ...linked].flatMap((name) => [name, `record.${name}`])]);
    const templates = matching.slice(0, RULE_PARTS_TEMPLATES_MAX).map((family) => {
      const backed = new Set(family.backed);
      return {
        key: family.key,
        name: family.name,
        reads: family.placeholders,
        // What the step must give through "vars": read with no backup of its own, and not a column of this table.
        mustFill: family.placeholders.filter((name) => !backed.has(name) && !ruleFills.has(name)),
      };
    });

    const installs = deps.installs === undefined ? null : await deps.installs().catch(() => null);
    const steps = [];
    for (const installed of installs === null ? [] : stepsOn(installs, connectionId)) {
      let personal = new Set<string>();
      try {
        const written = installed.table === null ? null : resolved.view.table(installed.table);
        if (written !== null) personal = personalInputs(installed.step, (column) => written.columns.get(column)?.masked === true);
      } catch {
        personal = new Set();
      }
      steps.push({
        addOn: installed.addOn,
        addOnName: installed.addOnName,
        step: installed.step.key,
        name: installed.step.name['en-US'],
        does: installed.step.does['en-US'],
        // A rule's author must be allowed to add the row the step adds.
        youMayUseIt: installed.table !== null && (await deps.can(`table:${connectionId}:${installed.table}:create`)),
        inputs: installed.step.inputs.map((input) => ({
          key: input.key,
          label: input.label['en-US'],
          kind: input.kind,
          required: input.required === true,
          ...(input.options === undefined ? {} : { oneOf: input.options.map((option) => option.value) }),
          // Only such an input may be given a personal column (an address, a name) of the record.
          ...(personal.has(input.key) ? { mayReadPersonalColumns: true } : {}),
        })),
      });
    }

    return {
      result: {
        table: table.id,
        events: ['created', 'updated', 'deleted'],
        addressColumns: reachable,
        templates,
        templatesOmitted: Math.max(matching.length - templates.length, 0),
        templatesSwitchedOff: families.off,
        steps,
        notes: [
          reachable.length === 0 ? 'No column of this table, or of a row it links to, holds email addresses: an email step needs typed addresses, or cannot be made.' : 'An email step\'s `to` column is one of addressColumns, exactly as written.',
          templates.length === 0 ? (words.length === 0 ? 'No live email template exists: an email step cannot be completed. Say so, and offer to draft one on Email templates.' : 'No live template matches those words. Call again without `find`, or say that none fits and offer to draft one on Email templates.') : 'Name a template by its key. Fill every name in its mustFill through the step\'s "vars".',
          steps.length === 0 ? 'No installed add-on gives a step. What only an add-on could do, leave out and say so in "leftOut"; list_add_ons says which add-on would give it.' : 'An add-on\'s step is named by its addOn and step keys, with a text for each input.',
        ],
      },
      tables: [tableLabel(resolved.name, table.id)],
    };
  },
};
