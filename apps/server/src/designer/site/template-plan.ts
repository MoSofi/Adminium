// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan for building an app from a site template: one shape, asked once.
 *
 * The model proposes it (`use_site` with `plan`), from what the server found in the template
 * (`find.ts`). The server checks it, adds what only the server knows (the template's counts, whether an
 * add-on is installed, what the project needs added), and asks the person on one card: what becomes a
 * table, what the forms do, what the template shows and how each missing thing is handled, the links that
 * lead nowhere, what is added to the project. Nothing is written before the person's answer, and only
 * what they approved is built.
 *
 * The answer is kept in `apps/<key>/template-plan.json` (server-owned: the model never writes it), with the
 * site's sha256. A later session reads it, so it is not asked again; a build stopped by a limit goes on
 * from it; a different template asks again. What strangers may do by the plan (its public reads, its
 * forms' creates) and the roles it grants are kept as `approved`: the "Check this before it goes live"
 * card asks only for what goes beyond them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { appDir } from '../../project/apps/read-app.js';
import type { NeedItem } from '../needs.js';
import { plainWords } from '../untrusted.js';

export const TEMPLATE_PLAN_FILE = 'template-plan.json';

/** A table's or a column's ref, as the manifest names it. */
const REF = /^[a-z][a-z0-9_]{0,62}$/;
/** A role's key in roles.json. */
const ROLE = /^[a-z][a-z0-9-]{0,62}$/;
/** An add-on's key. */
const ADD_ON = /^[a-z][a-z0-9-]{1,79}$/;
/** An id the finder gave (a block, a form, a link), or the model's own for a report row. */
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Words the model wrote for the person: one line, cleaned of what could hide or reorder text, cut to `max`. */
const words = (max: number) =>
  z
    .string()
    .transform((value) => plainWords(value, max))
    .pipe(z.string().min(1));

const ref = z.string().regex(REF, 'a ref: lower-case letters, digits and _');
const count = z.number().int().min(0).max(1000);

/** What the model proposes. */
export const planProposalSchema = z
  .object({
    tables: z
      .array(
        z
          .object({
            table: ref,
            label: words(60),
            /** Each column: its ref, and its name in plain words. */
            columns: z.array(z.object({ column: ref, label: words(40) }).strict()).min(1).max(40),
            /** The pages that show it, as the person knows them ("Home", "Menu"). */
            shownOn: z.array(words(40)).max(20).default([]),
            /** Sample rows made from the template's own blocks; of those, how many repeat another to fill a grid. */
            fromTemplate: count.default(0),
            filler: count.default(0),
            /** Sample rows the template did not have (testimonials, a team, prices), to be replaced before going public. */
            madeUp: count.default(0),
            /** The finder's block it is made from, when it is one. */
            block: z.string().regex(ID).optional(),
            /** The columns strangers read on the site's pages. */
            publicRead: z.array(ref).max(40).default([]),
            /** Built on an add-on's shape (coupons: offers). */
            addOn: z.string().regex(ADD_ON).optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    forms: z
      .array(
        z
          .object({
            /** The finder's form. */
            form: z.string().regex(ID),
            label: words(60),
            /** The table it writes to, and the columns a stranger writes. */
            table: ref,
            writable: z.array(ref).min(1).max(40),
            /** An order: the table of its lines, written as its children, and the lines' columns a stranger writes. */
            lines: ref.optional(),
            linesWritable: z.array(ref).max(40).default([]),
            /** How many a stranger may send in an hour; null for the server's own limit. */
            perHour: z.number().int().min(1).max(1000).nullable().default(null),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    report: z
      .array(
        z
          .object({
            id: z.string().regex(ID),
            label: words(60),
            /** Where it is: "On the Order page", "On every page". */
            where: words(60),
            status: z.enum(['works', 'add-on', 'not-available']),
            /** With `add-on`: which. */
            addOn: z.string().regex(ADD_ON).optional(),
            /** With `not-available`: what each choice does, in plain words. Build is always offered; Replace only with words. */
            build: words(160).optional(),
            /** Building it takes server code of the project's own (each piece still asked as it is written). */
            buildServerCode: z.boolean().default(false),
            replace: words(160).optional(),
            leave: words(160).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
    /** Links that lead nowhere (`href="#"`), by the finder's ids, each named. */
    links: z
      .array(z.object({ id: z.string().regex(ID), label: words(60) }).strict())
      .max(40)
      .default([]),
    /** The roles that get rights to the plan's tables (a page-crud page each). */
    roles: z
      .array(z.object({ role: z.string().regex(ROLE), tables: z.array(ref).min(1).max(20) }).strict())
      .max(8)
      .default([]),
  })
  .strict();

export type PlanProposal = z.output<typeof planProposalSchema>;

/** A table on the card: the proposal's, with the add-on as the server has it. */
export type PlanTable = PlanProposal['tables'][number] & { addOnInfo?: { key: string; name: string; installed: boolean } };
export type PlanForm = PlanProposal['forms'][number] & { tableLabel: string };
export type PlanReportRow = PlanProposal['report'][number];

/** What the card shows: every word the model's (cleaned) or the server's own. */
export type TemplatePlanRequest = {
  type: 'template-plan';
  site: { attachment: string; name: string; pages: number; files: number };
  tables: PlanTable[];
  forms: PlanForm[];
  report: PlanReportRow[];
  links: PlanProposal['links'];
  /** The roles that get rights to the plan's tables: not shown, kept as approved. */
  roles: PlanProposal['roles'];
  /** Section 4, "Added to the project": what the needs card would ask for this build. */
  added: NeedItem[];
};

export type PlanChoice = 'build' | 'replace' | 'leave';

/** The person's answer: what to build, or the changes they want first. */
export type TemplatePlanAnswer = {
  type: 'template-plan';
  /** The tables ticked; an unticked one stays fixed text on its pages. */
  tables: string[];
  /** For each "not available" row. */
  decisions: Record<string, PlanChoice>;
  /** Each link's address; empty when the person gave none. */
  links: Record<string, string>;
  /** Take out the links left empty (else they stay as they are). */
  takeOutEmpty: boolean;
  /** Section 4's ticks. */
  added: string[];
  /** "Send my changes": nothing is approved; the model makes a new plan from these words. */
  changes?: string;
};

/** The choice a row starts on: Replace where there is one, else Leave out. Never Build. */
export const presetChoice = (row: Pick<PlanReportRow, 'replace'>): PlanChoice => (row.replace !== undefined ? 'replace' : 'leave');

const LINK = /^(?:https:\/\/[^\s<>"'`]{1,290}|mailto:[^\s<>"'`]{1,200}|tel:\+?[0-9 ()-]{3,30}|\/(?!\/)[A-Za-z0-9/_.-]{0,100})$/;

/** An answer checked against the card it is for; null when it does not fit. */
export function planAnswerFor(card: TemplatePlanRequest, value: unknown): TemplatePlanAnswer | null {
  const given = (value ?? {}) as Record<string, unknown>;
  const changes = typeof given['changes'] === 'string' ? given['changes'].trim() : '';
  if (changes.length > 4000) return null;
  const offeredTables = new Set(card.tables.map((table) => table.table));
  const tables = Array.isArray(given['tables']) ? [...new Set(given['tables'].filter((id): id is string => typeof id === 'string' && offeredTables.has(id)))] : [];
  const rawDecisions = given['decisions'] !== null && typeof given['decisions'] === 'object' ? (given['decisions'] as Record<string, unknown>) : {};
  const decisions: Record<string, PlanChoice> = {};
  for (const row of card.report) {
    if (row.status !== 'not-available') continue;
    const said = rawDecisions[row.id];
    // Replace only where the card offered it; an answer that says nothing keeps what the card started on.
    decisions[row.id] = said === 'build' || said === 'leave' || (said === 'replace' && row.replace !== undefined) ? said : presetChoice(row);
  }
  const rawLinks = given['links'] !== null && typeof given['links'] === 'object' ? (given['links'] as Record<string, unknown>) : {};
  const links: Record<string, string> = {};
  for (const link of card.links) {
    const address = typeof rawLinks[link.id] === 'string' ? (rawLinks[link.id] as string).trim() : '';
    if (address !== '' && !LINK.test(address)) return null;
    links[link.id] = address;
  }
  const offeredNeeds = new Set(card.added.map((item) => item.id));
  const added = Array.isArray(given['added']) ? [...new Set(given['added'].filter((id): id is string => typeof id === 'string' && offeredNeeds.has(id)))] : [];
  return { type: 'template-plan', tables, decisions, links, takeOutEmpty: given['takeOutEmpty'] !== false, added, ...(changes === '' ? {} : { changes }) };
}

/** One public access entry the plan allows, in access.json's own shape (as much as the check compares). */
export interface ApprovedAccess {
  table: string;
  methods: ('GET' | 'POST')[];
  select?: string[];
  writable?: string[];
  humanCheck?: true;
}

export interface TemplatePlanFile {
  version: 1;
  site: { attachment: string; name: string; sha256: string };
  /** The side the template is brought into. Absent in a plan kept before sides were named: the customer side. */
  side?: 'customer' | 'staff';
  /** When the person approved it. */
  at: string;
  plan: Omit<TemplatePlanRequest, 'type'>;
  answer: Omit<TemplatePlanAnswer, 'type' | 'changes'>;
  approved: { access: ApprovedAccess[]; roles: { role: string; tables: string[] }[] };
}

/** What strangers and roles may do by the plan the person approved: its ticked tables' public reads, its forms' creates. */
export function approvedOf(plan: Omit<TemplatePlanRequest, 'type'>, answer: Pick<TemplatePlanAnswer, 'tables'>): TemplatePlanFile['approved'] {
  const ticked = new Set(answer.tables);
  const access: ApprovedAccess[] = [];
  for (const table of plan.tables) {
    if (ticked.has(table.table) && table.publicRead.length > 0) access.push({ table: table.table, methods: ['GET'], select: [...table.publicRead] });
  }
  for (const form of plan.forms) {
    // An order's lines go with it as its children (`<lines>.<column>`), or by an entry of their own: both are the plan's.
    const children = form.lines === undefined ? [] : form.linesWritable.map((column) => `${form.lines as string}.${column}`);
    access.push({ table: form.table, methods: ['POST'], writable: [...form.writable, ...children], humanCheck: true });
    if (form.lines !== undefined) access.push({ table: form.lines, methods: ['POST'], writable: [...form.linesWritable], humanCheck: true });
  }
  const own = new Set([...ticked, ...plan.forms.flatMap((form) => [form.table, ...(form.lines === undefined ? [] : [form.lines])])]);
  // A form's table is the plan's even when it is not in section 1 (messages, subscribers): its staff page reads what was sent.
  return { access, roles: plan.roles.map((role) => ({ role: role.role, tables: role.tables.filter((table) => own.has(table)) })).filter((role) => role.tables.length > 0) };
}

const planPath = (root: string, appKey: string): string => join(appDir(root, appKey), TEMPLATE_PLAN_FILE);

/** The plan kept for the app, or null (none, or not one this server wrote). */
export function readTemplatePlan(root: string, appKey: string): TemplatePlanFile | null {
  const path = planPath(root, appKey);
  if (!existsSync(path)) return null;
  try {
    const read = JSON.parse(readFileSync(path, 'utf8')) as Partial<TemplatePlanFile>;
    if (read.version !== 1 || typeof read.site?.sha256 !== 'string' || read.plan === undefined || read.answer === undefined || read.approved === undefined) return null;
    return read as TemplatePlanFile;
  } catch {
    return null;
  }
}

/** Keeps the approved plan, by temp-then-rename: a crash leaves the old one or the new one, never half of one. */
export function writeTemplatePlan(root: string, appKey: string, file: TemplatePlanFile): void {
  const path = planPath(root, appKey);
  mkdirSync(appDir(root, appKey), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** The side a plan was approved for. */
export const planSide = (plan: Pick<TemplatePlanFile, 'side'>): 'customer' | 'staff' => plan.side ?? 'customer';

/** The approved plan for this very site (same sha256) and side, or null: a different template, or side, asks again. */
export function planFor(root: string, appKey: string, sha256: string, side: 'customer' | 'staff' = 'customer'): TemplatePlanFile | null {
  const plan = readTemplatePlan(root, appKey);
  return plan !== null && plan.site.sha256 === sha256 && planSide(plan) === side ? plan : null;
}

const listed = (items: readonly string[], max: number): string => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${String(items.length - max)} more`);

/**
 * The "From a template" section of the app's brief, for the system prompt: what the person approved, short.
 * The whole plan is in the file; the section says where.
 */
export function planBrief(appKey: string, file: TemplatePlanFile): string {
  // Refs and ids only (checked by the plan's schema): the plan's own words are the model's, made from the template's,
  // and never ride in a later session's system prompt. The whole plan is in the file, read as data.
  const ticked = new Set(file.answer.tables);
  const tables = file.plan.tables.filter((table) => ticked.has(table.table)).map((table) => `${table.table} (${String(table.fromTemplate)} sample rows from the template${table.madeUp > 0 ? `, ${String(table.madeUp)} made up` : ''})`);
  const fixed = file.plan.tables.filter((table) => !ticked.has(table.table)).map((table) => table.table);
  const forms = file.plan.forms.map((form) => `${form.form} → ${form.table}`);
  const decided = file.plan.report.filter((row) => row.status === 'not-available').map((row) => `${row.id}: ${file.answer.decisions[row.id] ?? presetChoice(row)}`);
  const filled = file.plan.links.filter((link) => (file.answer.links[link.id] ?? '') !== '').length;
  const empty = file.plan.links.length - filled;
  return [
    `From a template: the app's ${planSide(file)} side is built from a site template by the plan the person approved (apps/${appKey}/${TEMPLATE_PLAN_FILE}; read it for the whole plan). Build only what it approved, and never ask for it again.`,
    `Tables: ${tables.length === 0 ? 'none' : listed(tables, 6)}.${fixed.length === 0 ? '' : ` Kept as fixed text: ${listed(fixed, 6)}.`}`,
    ...(forms.length === 0 ? [] : [`Forms: ${listed(forms, 6)}.`]),
    ...(decided.length === 0 ? [] : [`Decided: ${listed(decided, 8)}.`]),
    ...(file.plan.links.length === 0 ? [] : [`Links to nowhere: ${String(filled)} given${empty === 0 ? '' : `, ${String(empty)} left empty (${file.answer.takeOutEmpty ? 'take them out' : 'keep them as they are'})`}.`]),
  ].join('\n');
}
