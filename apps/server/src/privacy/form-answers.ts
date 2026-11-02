// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S FORM ANSWERS AND SURVEY INVITATIONS, by their address: the part
 * of a person's data a forms add-on keeps (`sources.ts` finds, `export.ts`
 * downloads, `erase.ts` erases).
 *
 *  - THEIR ANSWERS: every answer of every installed forms add-on whose
 *    `email` is the address (the engine fills it from the form's first
 *    e-mail question), a sign-up still waiting for its confirmation
 *    included. The download writes each answer whole as JSON, and as CSV
 *    with each question a column of its own, under its label in the
 *    language the answer was given in (a choice by its label too). An
 *    erasure deletes them, through the one function that deletes answers
 *    (`forms/answers.ts`), which takes their files with them.
 *  - THEIR ANSWERS' FILES (a form's file question): listed and downloaded as
 *    the files on a person's rows are, by name, size and kind (the download
 *    holds no file's bytes), and erased with the answers, from the
 *    strangers' file store too.
 *  - THE INVITATIONS sent to the address: listed and downloaded (never the
 *    token's hash); an erasure empties their `email` and `name` and keeps
 *    the row, so the survey's counts (invited, answered) stay whole.
 *
 * Read as the privacy action, as the rest of a person's data: no role's
 * limits. The address is compared as `normaliseAddress` spells it.
 */
import { parseForm, type Form } from '@adminium/add-on-contracts/forms';
import type { Dialect } from '@adminium/engine';
import type { MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { bindWriteValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { deleteFormAnswers, type AnswerFilesRemover } from '../forms/answers.js';
import { jsonOf } from '../forms/catalog.js';
import { formsAddOnsOn, storedFormsAddOns, type FormsAddOnTables } from '../forms/installed.js';
import { rowKeyOf } from '../payments/payables.js';
import type { ImageTarget } from './erase-meta.js';
import { alreadyBlank, blankValue, columnFacts, type ErasedRole } from './erase-values.js';
import type { FoundSource } from './types.js';
import { plainValue } from './values.js';

/** The columns of an answer that are the person's: its image in the audit log and the removed-row history loses them. */
const ANSWER_COLUMNS = ['email', 'name', 'values', 'ip', 'user_agent', 'sent_from', 'consent_wording'] as const;
/** What an erasure empties on an invitation; its token's hash is never downloaded. */
const INVITATION_COLUMNS: readonly [string, ErasedRole][] = [
  ['email', 'email'],
  ['name', 'name'],
];
const INVITATION_HIDDEN = new Set(['token_hash']);
/** The columns of an answer's file that are the person's: its name. */
const FILE_COLUMNS = ['name'] as const;
/** What the download says of an answer's file: never its handle in the store. */
const FILE_SHOWN = ['answer_id', 'question', 'name', 'size', 'kind', 'uploaded_at'] as const;
/** How many answers one read of their files names. */
const FILES_BATCH = 200;

/** One forms add-on's rows of one person. */
export interface FormPersonRows {
  connectionId: string;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  addOn: FormsAddOnTables;
  answers: Row[];
  invitations: Row[];
  /** The add-on's file rows of their answers. */
  files: Row[];
}

export interface FormRowsDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** The strangers' file store's remover: an erasure takes the answers' files from the store too. */
  answerFiles?: AnswerFilesRemover | undefined;
}

const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

async function rowsOf(db: Kysely<SourceDatabase>, table: ResolvedTable, address: string, limit: number | undefined): Promise<Row[]> {
  if (!table.columns.has('email')) return [];
  let query = db
    .selectFrom(table.id as never)
    .selectAll()
    .where(addressIs('email', address));
  for (const column of table.primaryKey) query = query.orderBy(sql.ref(column) as never);
  return (await (limit === undefined ? query : query.limit(limit)).execute()) as Row[];
}

/** The add-on's file rows of these answers. */
async function filesOf(db: Kysely<SourceDatabase>, addOn: FormsAddOnTables, answers: readonly Row[]): Promise<Row[]> {
  const files = addOn.files;
  const key = addOn.answers?.primaryKey[0];
  if (files === null || key === undefined || !files.columns.has('answer_id') || answers.length === 0) return [];
  const keys = answers.map((row) => row[key]);
  const out: Row[] = [];
  for (let at = 0; at < keys.length; at += FILES_BATCH) {
    let query = db
      .selectFrom(files.id as never)
      .selectAll()
      .where(sql.ref('answer_id'), 'in', keys.slice(at, at + FILES_BATCH) as never);
    for (const column of files.primaryKey) query = query.orderBy(sql.ref(column) as never);
    out.push(...((await query.execute()) as Row[]));
  }
  return out;
}

/** Every forms add-on's answers and invitations of one address (`limit`: the most of each a search keeps). */
export async function findFormRows(deps: FormRowsDeps, address: string, limit?: number): Promise<FormPersonRows[]> {
  const stored = await storedFormsAddOns(deps.meta);
  const out: FormPersonRows[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const { db, dialect } = await deps.manager.data(connectionId);
    for (const addOn of await formsAddOnsOn(deps.meta, connectionId, view, stored)) {
      const answers = addOn.answers === null ? [] : await rowsOf(db, addOn.answers, address, limit);
      const invitations = addOn.invitations === null ? [] : await rowsOf(db, addOn.invitations, address, limit);
      if (answers.length > 0 || invitations.length > 0) out.push({ connectionId, db, dialect, addOn, answers, invitations, files: await filesOf(db, addOn, answers) });
    }
  }
  return out;
}

/** A question's label in a language, else in the form's own; its id when it has neither. */
function labelIn(label: Readonly<Record<string, string>> | undefined, language: string, fallback: string, id: string): string {
  return label?.[language] ?? label?.[fallback] ?? id;
}

/** The forms these answers were given on, parsed (the published words, else the draft's), by the form's key. */
async function formsOf(found: FormPersonRows): Promise<Map<string, { slug: string | null; form: Form | null }>> {
  const out = new Map<string, { slug: string | null; form: Form | null }>();
  const table = found.addOn.forms;
  const key = table?.primaryKey[0];
  const ids = [...new Set(found.answers.map((row) => row['form_id']).filter((id) => id !== null && id !== undefined))];
  if (table === null || key === undefined || ids.length === 0) return out;
  const rows = (await found.db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql.ref(key), 'in', ids as never)
    .execute()) as Row[];
  for (const row of rows) {
    const published = jsonOf(row['published']) as { definition?: unknown; settings?: unknown } | null | undefined;
    const parsed = published !== null && published !== undefined ? parseForm(published.definition, published.settings) : parseForm(jsonOf(row['definition']), jsonOf(row['settings']));
    out.set(String(row[key]), { slug: typeof row['slug'] === 'string' ? row['slug'] : null, form: parsed.ok ? parsed.form : null });
  }
  return out;
}

/** An answer's value as one CSV cell: a choice by its label, several joined, anything else as it was given. */
function cellOf(form: Form, questionId: string, value: unknown, language: string): unknown {
  const question = form.definition.questions.find((one) => one.id === questionId);
  const fallback = form.definition.defaultLanguage;
  if (question !== undefined && (question.kind === 'one' || question.kind === 'several')) {
    const label = (id: unknown) => {
      const choice = question.choices.find((one) => one.id === id);
      return choice === undefined ? String(id) : labelIn(choice.label, language, fallback, choice.id);
    };
    return Array.isArray(value) ? value.map(label).join('; ') : label(value);
  }
  return plainCell(value);
}

/** A value as one CSV cell, with no form to read it by: several joined, an object as JSON. */
function plainCell(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item))).join('; ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return value;
}

/** Their answers and invitations as sources of a person's data (the download's rows included). */
export async function formSources(found: readonly FormPersonRows[]): Promise<FoundSource[]> {
  const out: FoundSource[] = [];
  for (const one of found) {
    const { addOn } = one;
    if (one.answers.length > 0 && addOn.answers !== null) {
      const table = addOn.answers;
      const forms = await formsOf(one);
      const rows: Record<string, unknown>[] = [];
      const csvRows: Record<string, unknown>[] = [];
      for (const row of one.answers) {
        const values = jsonOf(row['values']);
        const answer = Object.fromEntries(Object.entries(row).map(([column, value]) => [column, column === 'values' ? plainValue(values) : plainValue(value)]));
        rows.push(answer);
        const language = typeof row['language'] === 'string' ? row['language'] : '';
        const held = forms.get(String(row['form_id']));
        const flat: Record<string, unknown> = Object.fromEntries(Object.entries(answer).filter(([column]) => column !== 'values'));
        if (held?.slug !== null && held?.slug !== undefined) flat['form'] = held.slug;
        const given = typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
        const used = new Set(Object.keys(flat));
        for (const [questionId, value] of Object.entries(given)) {
          const form = held?.form ?? null;
          const question = form?.definition.questions.find((candidate) => candidate.id === questionId);
          let column = form === null || question === undefined ? questionId : labelIn(question.label, language, form.definition.defaultLanguage, questionId);
          // Two questions with one label (or a label that is a column's name): the second keeps its id beside it.
          if (used.has(column)) column = `${column} (${questionId})`;
          used.add(column);
          flat[column] = form === null ? plainCell(value) : cellOf(form, questionId, value, language);
        }
        csvRows.push(flat);
      }
      out.push({
        id: `form-answers-${addOn.key}`,
        kind: 'form-answers',
        group: 'gave',
        connectionId: one.connectionId,
        table: table.id,
        app: addOn.key,
        ref: addOn.block.answers,
        label: table.table.label ?? table.name,
        keptByLaw: null,
        count: one.answers.length,
        keys: one.answers.map((row) => rowKeyOf(table, row)),
        rows,
        csvRows,
      });
    }
    if (one.invitations.length > 0 && addOn.invitations !== null) {
      const table = addOn.invitations;
      out.push({
        id: `form-invitations-${addOn.key}`,
        kind: 'form-invitations',
        group: 'held',
        connectionId: one.connectionId,
        table: table.id,
        app: addOn.key,
        ref: addOn.block.invitations ?? 'invitations',
        label: table.table.label ?? table.name,
        keptByLaw: null,
        count: one.invitations.length,
        keys: one.invitations.map((row) => rowKeyOf(table, row)),
        rows: one.invitations.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !INVITATION_HIDDEN.has(column)).map(([column, value]) => [column, plainValue(value)]))),
      });
    }
    if (one.files.length > 0 && addOn.files !== null) {
      const table = addOn.files;
      out.push({
        id: `form-files-${addOn.key}`,
        kind: 'form-files',
        group: 'gave',
        connectionId: one.connectionId,
        table: table.id,
        app: addOn.key,
        ref: addOn.block.files ?? 'files',
        label: table.table.label ?? table.name,
        keptByLaw: null,
        count: one.files.length,
        keys: one.files.map((row) => rowKeyOf(table, row)),
        rows: one.files.map((row) => Object.fromEntries(FILE_SHOWN.filter((column) => column in row).map((column) => [column, plainValue(row[column])]))),
      });
    }
  }
  return out;
}

/** The images of their answers and invitations the audit log and the removed-row history keep: each loses the person's columns. */
export function formImageTargets(found: readonly FormPersonRows[]): ImageTarget[] {
  const out: ImageTarget[] = [];
  for (const one of found) {
    for (const [table, rows, columns] of [
      [one.addOn.answers, one.answers, ANSWER_COLUMNS as readonly string[]],
      [one.addOn.invitations, one.invitations, INVITATION_COLUMNS.map(([column]) => column)],
      [one.addOn.files, one.files, FILE_COLUMNS as readonly string[]],
    ] as const) {
      if (table === null || rows.length === 0) continue;
      const own = columns.filter((column) => table.columns.has(column));
      const keys = rows.map((row) => rowKeyOf(table, row));
      out.push({ connectionId: one.connectionId, table: table.id, keys, columns: new Map(keys.map((key) => [key, own])), own: true });
    }
  }
  return out;
}

/**
 * Erases their answers and invitations (see the header): the answers go with
 * their files (from the store too, with `removeFiles`), the invitations lose
 * the address and the name. Answers the rows changed, per source id
 * (`form-answers-<add-on>`, `form-files-<add-on>`, `form-invitations-<add-on>`).
 */
export async function eraseFormRows(found: readonly FormPersonRows[], erasedName: string, removeFiles?: AnswerFilesRemover): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const one of found) {
    const { addOn } = one;
    if (addOn.answers !== null && one.answers.length > 0) {
      const key = addOn.answers.primaryKey[0];
      if (key !== undefined) {
        const gone = await deleteFormAnswers({ db: one.db, answers: addOn.answers, files: addOn.files, connectionId: one.connectionId, addOn: addOn.key, removeFiles }, one.answers.map((row) => row[key]));
        counts[`form-answers-${addOn.key}`] = gone.answers;
        // The add-on's file rows went with them (the store's rows and bytes too, when it was told).
        if (one.files.length > 0) counts[`form-files-${addOn.key}`] = one.files.length;
      }
    }
    const invitations = addOn.invitations;
    if (invitations !== null && one.invitations.length > 0) {
      let written = 0;
      await one.db.transaction().execute(async (trx) => {
        for (const row of one.invitations) {
          const values: Row = {};
          for (const [column, role] of INVITATION_COLUMNS) {
            const facts = columnFacts(invitations, column);
            if (facts === null || alreadyBlank(row[column], facts, role, erasedName)) continue;
            const blank = blankValue(facts, role, one.dialect, erasedName);
            if ('left' in blank) continue;
            values[column] = blank.value === null ? null : bindWriteValue(invitations.columns.get(column)!, blank.value, one.dialect);
          }
          if (Object.keys(values).length > 0) {
            let update = trx.updateTable(invitations.id as never).set(values as never);
            for (const column of invitations.primaryKey) update = update.where(sql.ref(column), '=', row[column] as never);
            await update.execute();
          }
          written += 1;
        }
      });
      counts[`form-invitations-${addOn.key}`] = written;
    }
  }
  return counts;
}
