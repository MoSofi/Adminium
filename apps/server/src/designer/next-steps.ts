// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the person can do next, as buttons under the Designer's reply.
 *
 * A reply used to end with a list in words ("Next steps: the Inventory
 * add-on lowers your stock…"), which the person then had to type back.
 * `suggest_next` hands the same things over as steps, and the page draws a
 * button for each. Three kinds, and the server decides what each one may be:
 *
 *   ask     a request the person sends as their next message. The button says
 *           the whole of it: what is pressed is what is sent, nothing more.
 *   add-on  an add-on that would do more for the app. The model gives a KEY;
 *           the name is this server's (its store, or the list adminium.dev
 *           gave). A press asks the Designer for it: the add-on's own card
 *           then asks, gets and installs it (`get_add_on`), or the Designer
 *           says who can, where this person may not.
 *   rows    a table the person fills themselves (their products, their
 *           services). The model gives a table of the app; the name and the
 *           dashboard page are read from the app's own manifest. A press
 *           opens that page.
 *
 * The steps are an event of the turn (`next-steps`), not a card: they wait
 * for nothing, the last call of a turn is the one that stands, and the page
 * shows them only under the newest reply of a turn that applied.
 */
import type { AppManifest } from '@adminium/manifest';

import { checkApp } from '../project/apps/check-app.js';
import type { NextStep } from './events.js';
import type { DesignerTool, ToolOutcome } from './tool-types.js';
import { plainWords } from './untrusted.js';

export type { NextStep } from './events.js';

/** What a step needs to know of an add-on: the line `list_add_ons` gives, less what it does not read. */
type AddOnLine = { key: string; name: string; state: 'installed' | 'available' | 'listed' };

/** The most steps one reply offers, and the most words of one. */
export const NEXT_STEPS_MAX = 4;
export const NEXT_STEP_TEXT_MAX = 110;

export const SUGGEST_NEXT = 'suggest_next';

type Table = NonNullable<NonNullable<AppManifest['requiredSchema']>['tables']>[number];
type Page = NonNullable<AppManifest['pages']>[number];

/** Words a manifest gives as plain text or as words for each language: English, else the first there is. */
function wordsOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const first = record['fallback'] ?? record['en-US'] ?? record['en'] ?? Object.values(record).find((entry) => typeof entry === 'string');
  return typeof first === 'string' ? first : null;
}

/** The tables a page shows: its bindings, else the table its config names. */
function pageShows(page: Page): string[] {
  const bound = Object.values(page.bindings ?? {});
  if (bound.length > 0) return bound;
  const config = (page.config ?? {}) as Record<string, unknown>;
  const source = (config['source'] ?? null) as { table?: unknown } | null;
  const table = typeof config['table'] === 'string' ? config['table'] : typeof source?.table === 'string' ? source.table : null;
  return table === null ? [] : [table];
}

/** The dashboard page a person adds a table's rows on: the list page over it, else any page that shows it. */
export function pageForTable(manifest: AppManifest, table: string): Page | null {
  const pages = (manifest.pages ?? []).filter((page) => pageShows(page).includes(table));
  return pages.find((page) => page.template === 'page-crud' && Object.values(page.bindings ?? {})[0] === table) ?? pages.find((page) => page.template === 'page-crud') ?? pages[0] ?? null;
}

/** A table's name as a person reads it: its plural label, its label, else its ref in words. */
export function tableName(table: Table): string {
  const words = wordsOf(table.labelPlural) ?? wordsOf(table.label) ?? table.ref.replace(/[_-]+/g, ' ');
  return plainWords(words, 60);
}

export interface NextStepsDeps {
  root: string;
  version: string;
  listAddOns: () => Promise<AddOnLine[]>;
}

/**
 * The steps a call asked for, as the server lets them stand, and why each one
 * it dropped was dropped (for the model: it may ask again).
 */
export async function resolveNextSteps(deps: NextStepsDeps, appKey: string, given: unknown): Promise<{ steps: NextStep[]; dropped: string[] }> {
  const steps: NextStep[] = [];
  const dropped: string[] = [];
  const list = Array.isArray(given) ? given : [];
  const manifest = checkApp(deps.root, appKey, { version: deps.version }).manifest;
  let addOns: AddOnLine[] | null = null;
  for (const entry of list) {
    if (steps.length >= NEXT_STEPS_MAX) {
      dropped.push(`Only ${String(NEXT_STEPS_MAX)} steps are shown: the rest were left out.`);
      break;
    }
    const item = (entry ?? {}) as Record<string, unknown>;
    const say = typeof item['say'] === 'string' ? plainWords(item['say'], NEXT_STEP_TEXT_MAX) : '';
    if (typeof item['table'] === 'string') {
      const ref = item['table'];
      const table = manifest?.kind === 'app' ? (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref) : undefined;
      const page = table === undefined || manifest?.kind !== 'app' ? null : pageForTable(manifest, ref);
      if (table === undefined || page === null) {
        dropped.push(table === undefined ? `"${ref.slice(0, 60)}" is not a table of this app.` : `The table "${ref}" has no dashboard page to add rows on: give it one, or leave this step out.`);
        continue;
      }
      if (steps.some((step) => step.kind === 'rows' && step.table === ref)) continue;
      steps.push({ kind: 'rows', table: ref, name: tableName(table), path: `/p/${encodeURIComponent(page.ref)}` });
      continue;
    }
    if (typeof item['add_on'] === 'string') {
      const key = item['add_on'];
      addOns ??= await deps.listAddOns();
      const addOn = addOns.find((candidate) => candidate.key === key);
      if (addOn === undefined) {
        dropped.push(`"${key.slice(0, 60)}" is not an add-on this server has or can get: list_add_ons gives the keys.`);
        continue;
      }
      if (say === '') {
        dropped.push(`The step for the add-on "${key}" needs "say": what it would do for this app, in a few words.`);
        continue;
      }
      if (steps.some((step) => step.kind === 'add-on' && step.key === key)) continue;
      steps.push({ kind: 'add-on', key, name: plainWords(addOn.name, 60), text: say, installed: addOn.state === 'installed' });
      continue;
    }
    if (say === '') {
      dropped.push('A step needs "say" (a request the person would send), "add_on" with "say", or "table".');
      continue;
    }
    if (steps.some((step) => step.kind === 'ask' && step.text === say)) continue;
    steps.push({ kind: 'ask', text: say });
  }
  return { steps, dropped };
}

export function suggestNextTool(deps: NextStepsDeps, appKey: string): DesignerTool {
  return {
    name: SUGGEST_NEXT,
    description: `What the person can do next, as buttons under your reply: call it once as a turn that built or changed the app ends, in the same reply as apply_app, with two to ${String(NEXT_STEPS_MAX)} steps, the most useful first. A step is one of: { "say": a request they would send you next, in their own voice, at most ${String(NEXT_STEP_TEXT_MAX)} characters ("Add a page where customers order online") }; { "add_on": an add-on's key as list_add_ons gives it, "say": what it would do for this app ("Lower stock when an order is saved") }; { "table": a table of this app the person fills themselves, such as their products or services }. The server names the add-on and the table. Do not also list these steps in your words.`,
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          maxItems: NEXT_STEPS_MAX,
          items: {
            type: 'object',
            properties: { say: { type: 'string' }, add_on: { type: 'string' }, table: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
    running: () => 'Working out what comes next',
    run: async (input, ctx): Promise<ToolOutcome> => {
      const { steps, dropped } = await resolveNextSteps(deps, appKey, input['steps']);
      // Said even when empty: a call with no step that stands takes the turn's earlier steps off the page.
      ctx.handle.events.emit(ctx.turn, { kind: 'next-steps', steps });
      if (steps.length === 0) {
        // Not a failure of the turn: the reply stands without buttons, and the model is told what was wrong with each.
        return { content: `No step was shown.${dropped.length === 0 ? ' Give at least one.' : `\n${dropped.join('\n')}`}`, label: 'No next steps', facts: { count: 0 } };
      }
      return {
        content: `The person sees ${String(steps.length)} button${steps.length === 1 ? '' : 's'} under your reply: ${steps.map((step) => (step.kind === 'ask' ? `"${step.text}"` : step.kind === 'add-on' ? `the add-on ${step.name}` : `add ${step.name}`)).join('; ')}. Do not list them again in your words.${dropped.length === 0 ? '' : `\nLeft out:\n${dropped.join('\n')}`}`,
        label: 'Suggested what comes next',
        facts: { count: steps.length },
      };
    },
  };
}
