// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: what the person chose, kept in one draft the quick save and
 * the wizard share, and turned into the request the server reads.
 *
 * The draft starts from the inventory with everything ticked and no rows: the
 * quick save's "everything on the database goes in, without rows". The wizard
 * only changes it. Both build their request with {@link requestOf}, so the
 * quick save's count and the wizard's Check can never disagree about what is
 * being saved.
 *
 * ─── Answers ───────────────────────────────────────────────────────────────
 * A Check answer is kept with the item it answered, so Check can show the item
 * as done (with Undo) once the next plan no longer lists it. Each one is
 * recorded under the `answers` list its choice names, holding the value the
 * item gives for that choice ({@link answerTarget}).
 *
 * Personal views are one control with two places (What to include and Check):
 * a view the person makes shared goes under `shareViews`; every other personal
 * view is answered "stays behind" by default, with the leave-out value its own
 * Check item gave. So views start "0 of N" shared and never hold Save.
 */
import {
  ANSWER_LIST,
  answerTarget,
  type AnswerChoice,
  type CheckItem,
  type RowChoice,
  type SaveAnswers,
  type SaveInventory,
  type SavePlan,
  type SaveRequest,
} from './saveAppApi.js';

/** The lists of things a person ticks in What to include, by the server's `include` names. */
export const INCLUDE_KINDS = [
  'tables',
  'pages',
  'roles',
  'automations',
  'emailTemplates',
  'documents',
  'reports',
  'invoiceLayouts',
  'scheduledReports',
  'publicEndpoints',
] as const;
export type IncludeKind = (typeof INCLUDE_KINDS)[number];

/** An answer the person gave, kept with the item it answered. */
export interface GivenAnswer {
  item: CheckItem;
  choice: AnswerChoice;
}

export interface SaveDraft {
  connectionId: string;
  name: string;
  key: string;
  /** Null: the next version (the server's own count). */
  version: string | null;
  description: string;
  /** A lucide icon name; null for none. */
  icon: string | null;
  /** Empty: the server's display name. */
  label: string;
  include: Record<IncludeKind, string[]>;
  payments: boolean;
  instance: boolean;
  rows: Record<string, RowChoice>;
  /** `<tableId>.<column>` of personal or secret-looking columns whose values go in. */
  personalColumns: string[];
  /** Personal views made shared views of the app. */
  sharedViews: string[];
  /** By {@link itemId}. */
  answers: Record<string, GivenAnswer>;
  /** A personal view's own Check item, learned from a plan, by view id. */
  viewItems: Record<string, CheckItem>;
}

/** Starting rows: at most this many (the manifest's cap). */
export const MAX_STARTING_ROWS = 200;
/** Sample rows: at most this many per table (the manifest's cap). */
export const MAX_SAMPLE_ROWS = 5000;

/** A key from a name: lower-case letters, digits and -, a letter first. */
export function keyFromName(name: string): string {
  const key = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return key.length >= 2 ? key : '';
}

export const KEY_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function idsOf(inventory: SaveInventory, kind: IncludeKind): string[] {
  if (kind === 'emailTemplates') return inventory.emailTemplates.map((template) => template.key);
  return (inventory[kind] as { id: string }[]).map((item) => item.id);
}

/** Everything ticked, no rows, nothing answered: the quick save. */
export function draftFromInventory(
  inventory: SaveInventory,
  about: { name: string; key: string; description?: string; icon?: string | null; label?: string },
): SaveDraft {
  const include = Object.fromEntries(INCLUDE_KINDS.map((kind) => [kind, idsOf(inventory, kind)])) as Record<IncludeKind, string[]>;
  return {
    connectionId: inventory.connectionId,
    name: about.name,
    key: about.key,
    version: null,
    description: about.description ?? '',
    icon: about.icon ?? null,
    label: about.label ?? '',
    include,
    payments: inventory.payments,
    instance: false,
    rows: {},
    personalColumns: [],
    sharedViews: [],
    answers: {},
    viewItems: {},
  };
}

/** A Check item's identity across plans. */
export function itemId(item: Pick<CheckItem, 'code' | 'kind' | 'item' | 'field'>): string {
  return `${item.code}\u0000${item.kind}\u0000${item.item}\u0000${item.field ?? ''}`;
}

/** The personal views of the pages that go in. */
export function personalViews(inventory: SaveInventory, draft: Pick<SaveDraft, 'include'>): SaveInventory['views'] {
  const pages = new Set(draft.include.pages);
  return inventory.views.filter((view) => view.ownerId !== null && pages.has(view.pageId));
}

/** The request the draft makes: the plan and the save read the same one. */
export function requestOf(draft: SaveDraft, inventory: SaveInventory): SaveRequest {
  const answers: Required<SaveAnswers> = { carryAsText: [], personalColumns: [...draft.personalColumns], shareViews: [], clear: [], leaveOut: [], keep: [] };
  for (const given of Object.values(draft.answers)) {
    const value = answerTarget(given.item, given.choice);
    if (value !== null) answers[ANSWER_LIST[given.choice]].push(value);
  }
  for (const view of personalViews(inventory, draft)) {
    if (draft.sharedViews.includes(view.id)) {
      answers.shareViews.push(view.id);
      continue;
    }
    const item = draft.viewItems[view.id];
    const value = item === undefined ? null : answerTarget(item, 'leave-out');
    if (value !== null) answers.leaveOut.push(value);
  }
  const rows = Object.fromEntries(Object.entries(draft.rows).filter(([id, choice]) => choice.mode !== 'none' && draft.include.tables.includes(id)));
  const trimmedAnswers = Object.fromEntries(Object.entries(answers).filter(([, list]) => list.length > 0)) as SaveAnswers;
  return {
    connectionId: draft.connectionId,
    key: draft.key,
    name: draft.name.trim(),
    ...(draft.version === null ? {} : { version: draft.version }),
    ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
    ...(draft.icon === null ? {} : { icon: draft.icon }),
    ...(draft.label.trim() === '' ? {} : { label: draft.label.trim() }),
    include: {
      ...Object.fromEntries(INCLUDE_KINDS.map((kind) => [kind, draft.include[kind]])),
      payments: draft.payments,
      instance: draft.instance,
    },
    ...(Object.keys(rows).length === 0 ? {} : { rows }),
    ...(Object.keys(trimmedAnswers).length === 0 ? {} : { answers: trimmedAnswers }),
  };
}

/**
 * The personal views a plan asked about and the draft did not know yet: they
 * are answered "stays behind" by default, which needs the item's own value.
 * Null when there is nothing new (the plan stands).
 */
export function learnViewItems(draft: SaveDraft, plan: SavePlan): SaveDraft | null {
  const learned: Record<string, CheckItem> = {};
  for (const item of plan.check) {
    if (item.code !== 'PERSONAL_VIEW' || item.answer === undefined) continue;
    const viewId = item.answer.target;
    if (draft.viewItems[viewId] === undefined) learned[viewId] = item;
  }
  if (Object.keys(learned).length === 0) return null;
  return { ...draft, viewItems: { ...draft.viewItems, ...learned } };
}

// ── what each thing needs ───────────────────────────────────────────────────

export interface Thing {
  kind: IncludeKind;
  id: string;
}

/** What one thing needs to work in the file: a page its table, a rule the tables it names… */
export function needsOf(inventory: SaveInventory, thing: Thing): Thing[] {
  const tables = (ids: readonly string[]): Thing[] => ids.filter((id) => inventory.tables.some((table) => table.id === id)).map((id) => ({ kind: 'tables', id }));
  switch (thing.kind) {
    case 'pages': {
      const page = inventory.pages.find((one) => one.id === thing.id);
      return page?.tableId == null ? [] : tables([page.tableId]);
    }
    case 'scheduledReports': {
      const report = inventory.scheduledReports.find((one) => one.id === thing.id);
      return report?.pageId === undefined ? [] : [{ kind: 'pages', id: report.pageId }, ...needsOf(inventory, { kind: 'pages', id: report.pageId })];
    }
    case 'automations':
    case 'documents':
    case 'reports':
    case 'invoiceLayouts':
    case 'publicEndpoints':
      return tables((inventory[thing.kind] as { id: string; tableIds: string[] }[]).find((one) => one.id === thing.id)?.tableIds ?? []);
    default:
      return [];
  }
}

/** What would lose something it points to, if `thing` stayed out; links between tables listed apart. */
export interface Dependents {
  things: Thing[];
  /** `<table>.<column>` links from other ticked tables to this one. */
  links: { tableId: string; column: string }[];
}

export function dependentsOf(inventory: SaveInventory, draft: Pick<SaveDraft, 'include'>, thing: Thing): Dependents {
  const things: Thing[] = [];
  for (const kind of INCLUDE_KINDS) {
    if (kind === 'tables') continue;
    for (const id of draft.include[kind]) {
      if (kind === thing.kind && id === thing.id) continue;
      if (needsOf(inventory, { kind, id }).some((need) => need.kind === thing.kind && need.id === thing.id)) things.push({ kind, id });
    }
  }
  const links =
    thing.kind !== 'tables'
      ? []
      : inventory.tables
          .filter((table) => table.id !== thing.id && draft.include.tables.includes(table.id))
          .flatMap((table) => table.links.filter((link) => link.to === thing.id).map((link) => ({ tableId: table.id, column: link.column })));
  return { things, links };
}

export function nameOf(inventory: SaveInventory, thing: Thing): string {
  if (thing.kind === 'emailTemplates') return inventory.emailTemplates.find((one) => one.key === thing.id)?.name ?? thing.id;
  if (thing.kind === 'pages') return inventory.pages.find((one) => one.id === thing.id)?.title ?? thing.id;
  return (inventory[thing.kind] as { id: string; name: string }[]).find((one) => one.id === thing.id)?.name ?? thing.id;
}

/** Tick one thing, and what it needs; answers the things brought in with it. */
export function tick(inventory: SaveInventory, draft: SaveDraft, thing: Thing): { draft: SaveDraft; brought: Thing[] } {
  const include = { ...draft.include };
  const add = (one: Thing) => {
    if (!include[one.kind].includes(one.id)) include[one.kind] = [...include[one.kind], one.id];
  };
  add(thing);
  const brought = needsOf(inventory, thing).filter((need) => !draft.include[need.kind].includes(need.id));
  brought.forEach(add);
  return { draft: { ...draft, include }, brought };
}

/** Untick things. */
export function untick(draft: SaveDraft, things: readonly Thing[]): SaveDraft {
  const include = { ...draft.include };
  for (const thing of things) include[thing.kind] = include[thing.kind].filter((id) => id !== thing.id);
  return { ...draft, include };
}

// ── Check, grouped ──────────────────────────────────────────────────────────

export interface CheckGroups {
  /** Refusals of the file, and secrets this server holds: Save waits on them. */
  blocks: CheckItem[];
  /** Every other question, the personal views apart. */
  choices: CheckItem[];
  /** The personal views Check asks about (one block, answered by default). */
  views: CheckItem[];
  after: CheckItem[];
  info: CheckItem[];
}

export function groupCheck(plan: Pick<SavePlan, 'check'>): CheckGroups {
  const groups: CheckGroups = { blocks: [], choices: [], views: [], after: [], info: [] };
  for (const item of plan.check) {
    if (item.group === 'after') groups.after.push(item);
    else if (item.group === 'info') groups.info.push(item);
    else if (item.code === 'SECRET_FOUND') groups.blocks.push(item);
    else if (item.code === 'PERSONAL_VIEW') groups.views.push(item);
    else groups.choices.push(item);
  }
  return groups;
}

/**
 * The personal views the plan still asks about that the views block cannot
 * answer: one whose view is not among the views shown (the inventory lists
 * the saver's own views only). Each is a question of its own, answered like
 * any other.
 */
export function unansweredViewItems(plan: Pick<SavePlan, 'check'>, shown: readonly Pick<SaveInventory['views'][number], 'id'>[]): CheckItem[] {
  const ids = new Set(shown.map((view) => view.id));
  return groupCheck(plan).views.filter((item) => item.answer === undefined || !ids.has(item.answer.target));
}

/**
 * How many things need the person: Check's "Blocks saving" and "Needs a
 * choice" counts together, the personal views shown as one, and every
 * personal view the plan still asks about that they cannot answer as one
 * each. The quick save shows this same number.
 */
export function needsCount(plan: SavePlan, shown: readonly Pick<SaveInventory['views'][number], 'id'>[]): { blocks: number; choices: number } {
  const groups = groupCheck(plan);
  return {
    blocks: plan.problems.length + groups.blocks.length,
    // The views shown hold a default answer, so the plan no longer lists them: the draft's count says they are there.
    choices: groups.choices.length + unansweredViewItems(plan, shown).length + (shown.length > 0 ? 1 : 0),
  };
}

