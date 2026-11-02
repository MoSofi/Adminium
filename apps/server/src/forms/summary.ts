// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S RESULTS, COUNTED OVER EVERY ANSWER: what a survey's results page
 * shows (counts per choice, per score and per star, the recommend score, the
 * stars' average, answers per language), read by the engine so an add-on's
 * page gets totals without reading a row.
 *
 * Every answer of the form is read, a page at a time by its key, and each
 * page counted with the forms vocabulary's own `summarise`; the pages' counts
 * are added up here. No answer is skipped and none is held longer than its
 * page: there is no cap on how many a form may have. The scores, the
 * recommend score and the average are worked out again from the added
 * counts, never averaged from the pages'.
 */
import { recommendScoreOf, summarise, type Form, type FormSummary, type QuestionSummary } from '@adminium/add-on-contracts/forms';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { jsonOf } from './catalog.js';

/** How many answers one page reads. */
export const SUMMARY_PAGE = 500;

/** One question's counts, added to another page's of the same question. */
function addQuestion(into: QuestionSummary, more: QuestionSummary): QuestionSummary {
  if (into.kind !== more.kind) return into;
  const answered = into.answered + more.answered;
  if ((into.kind === 'one' || into.kind === 'several') && (more.kind === 'one' || more.kind === 'several')) {
    const choices = { ...into.choices };
    for (const [id, n] of Object.entries(more.choices)) choices[id] = (choices[id] ?? 0) + n;
    return { kind: into.kind, answered, choices };
  }
  if (into.kind === 'score' && more.kind === 'score') {
    const counts = into.counts.map((n, i) => n + (more.counts[i] ?? 0));
    return {
      kind: 'score',
      answered,
      counts,
      promoters: (counts[9] ?? 0) + (counts[10] ?? 0),
      passives: (counts[7] ?? 0) + (counts[8] ?? 0),
      detractors: counts.slice(0, 7).reduce((sum, n) => sum + n, 0),
      recommendScore: recommendScoreOf(counts),
    };
  }
  if (into.kind === 'stars' && more.kind === 'stars') {
    const counts = into.counts.map((n, i) => n + (more.counts[i] ?? 0));
    const total = counts.reduce((sum, n, i) => sum + n * (i + 1), 0);
    return { kind: 'stars', answered, counts, average: answered === 0 ? null : Math.round((total * 10) / answered) / 10 };
  }
  return { ...into, answered } as QuestionSummary;
}

/** Two pages' counts of one form, added up. */
export function addSummaries(form: Pick<Form, 'definition'>, a: FormSummary, b: FormSummary): FormSummary {
  const byLanguage: FormSummary['byLanguage'] = { ...a.byLanguage };
  for (const [language, n] of Object.entries(b.byLanguage) as [keyof FormSummary['byLanguage'], number][]) byLanguage[language] = (byLanguage[language] ?? 0) + n;
  const questions: Record<string, QuestionSummary> = { ...a.questions };
  for (const [id, more] of Object.entries(b.questions)) questions[id] = questions[id] === undefined ? more : addQuestion(questions[id], more);
  const recommend = form.definition.questions.find((question) => question.kind === 'score' && question.recommend === true);
  const scored = recommend === undefined ? undefined : questions[recommend.id];
  return { total: a.total + b.total, byLanguage, recommendScore: scored?.kind === 'score' ? scored.recommendScore : null, questions };
}

/** Every answer of one form, counted (see the header). */
export async function summariseAnswers(db: Kysely<SourceDatabase>, answers: ResolvedTable, form: Form, formId: unknown): Promise<FormSummary> {
  const key = answers.primaryKey[0];
  let summary = summarise(form, []);
  if (key === undefined) return summary;
  let after: unknown;
  for (;;) {
    let query = db
      .selectFrom(answers.id as never)
      .select([sql.ref(key).as('key'), sql.ref('values').as('values'), sql.ref('language').as('language')] as never)
      .where(sql.ref('form_id'), '=', formId as never);
    if (after !== undefined) query = query.where(sql.ref(key), '>', after as never);
    const page = (await query.orderBy(sql.ref(key) as never).limit(SUMMARY_PAGE).execute()) as Row[];
    if (page.length === 0) break;
    const read = page.map((row) => {
      const values = jsonOf(row['values']);
      return { values: typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {}, language: typeof row['language'] === 'string' ? row['language'] : '' };
    });
    summary = addSummaries(form, summary, summarise(form, read));
    after = page[page.length - 1]!['key'];
    if (page.length < SUMMARY_PAGE) break;
  }
  return summary;
}

/** How many were invited to one form, and how many of them answered. */
export async function invitationCounts(db: Kysely<SourceDatabase>, invitations: ResolvedTable, formId: unknown): Promise<{ invited: number; answered: number }> {
  const row = (await db
    .selectFrom(invitations.id as never)
    .select([sql<number>`count(*)`.as('invited'), sql<number>`count(${sql.ref('answered_at')})`.as('answered')] as never)
    .where(sql.ref('form_id'), '=', formId as never)
    .executeTakeFirst()) as { invited?: unknown; answered?: unknown } | undefined;
  return { invited: Number(row?.invited ?? 0), answered: Number(row?.answered ?? 0) };
}
