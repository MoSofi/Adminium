// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form's results, counted: per choice, per score, per star, the recommend
 * score and the stars' average, how many answered each question, and how
 * many answers came in each language. Every language's answers are counted
 * together (one form, a version per language). Numbers only: the dashboard
 * words them.
 *
 * The answers are what the engine stored, read back: a value that does not
 * fit its question (a form changed since) is left out of that question's
 * counts rather than counted wrong.
 *
 * Pure: no I/O.
 */
import { SCALE_OF, type FormQuestionKind } from './definition.js';
import type { Form } from './parse.js';
import { FORM_LANGUAGES, type FormLanguage } from './words.js';

/** What is counted of one question. */
export type QuestionSummary =
  | { kind: 'one' | 'several'; answered: number; choices: Record<string, number> }
  | {
      kind: 'score';
      answered: number;
      /** How many gave each score, index = score (0–10). */
      counts: number[];
      /** 9–10, 7–8 and 0–6. */
      promoters: number;
      passives: number;
      detractors: number;
      /** Promoters' share minus detractors', a whole-number percentage with its sign; null with no answer. */
      recommendScore: number | null;
    }
  | {
      kind: 'stars';
      answered: number;
      /** How many gave each number of stars, index 0 = one star. */
      counts: number[];
      /** To one decimal; null with no answer. */
      average: number | null;
    }
  | { kind: Exclude<FormQuestionKind, 'one' | 'several' | 'score' | 'stars'>; answered: number };

export interface FormSummary {
  /** Every answer counted. */
  total: number;
  /** Answers per language: every language the form lists, and any other an answer came in. */
  byLanguage: Partial<Record<FormLanguage, number>>;
  /** The survey's recommend question's score; null when it has none or nobody gave one. */
  recommendScore: number | null;
  questions: Record<string, QuestionSummary>;
}

/** The recommend score of counts per score 0–10: promoters' share minus detractors', as a whole-number percentage. */
export function recommendScoreOf(counts: readonly number[]): number | null {
  const answered = counts.reduce((sum, n) => sum + n, 0);
  if (answered === 0) return null;
  const promoters = (counts[9] ?? 0) + (counts[10] ?? 0);
  const detractors = counts.slice(0, 7).reduce((sum, n) => sum + n, 0);
  const score = Math.round(((promoters - detractors) * 100) / answered);
  // Never "-0".
  return score === 0 ? 0 : score;
}

const isLanguage = (value: unknown): value is FormLanguage => typeof value === 'string' && (FORM_LANGUAGES as readonly string[]).includes(value);

/** A form's answers, counted. */
export function summarise(form: Pick<Form, 'definition'>, answers: readonly { values: Readonly<Record<string, unknown>>; language: string }[]): FormSummary {
  const { definition } = form;
  const byLanguage: Partial<Record<FormLanguage, number>> = Object.fromEntries(definition.languages.map((language) => [language, 0]));
  for (const answer of answers) if (isLanguage(answer.language)) byLanguage[answer.language] = (byLanguage[answer.language] ?? 0) + 1;

  const questions: Record<string, QuestionSummary> = {};
  let recommendScore: number | null = null;
  for (const question of definition.questions) {
    const given = answers.map((answer) => answer.values[question.id]).filter((value) => value !== undefined && value !== null && value !== '');
    switch (question.kind) {
      case 'one':
      case 'several': {
        const choices: Record<string, number> = Object.fromEntries(question.choices.map((choice) => [choice.id, 0]));
        let answered = 0;
        for (const value of given) {
          const picks = (question.kind === 'one' ? [value] : Array.isArray(value) ? value : []).filter((pick): pick is string => typeof pick === 'string' && pick in choices);
          if (picks.length === 0) continue;
          answered += 1;
          for (const pick of new Set(picks)) choices[pick] = (choices[pick] ?? 0) + 1;
        }
        questions[question.id] = { kind: question.kind, answered, choices };
        break;
      }
      case 'score':
      case 'stars': {
        const scale = SCALE_OF[question.kind];
        const counts = Array.from({ length: scale.max - scale.min + 1 }, () => 0);
        for (const value of given) {
          if (typeof value === 'number' && Number.isInteger(value) && value >= scale.min && value <= scale.max) counts[value - scale.min]! += 1;
        }
        const answered = counts.reduce((sum, n) => sum + n, 0);
        if (question.kind === 'score') {
          const score = recommendScoreOf(counts);
          questions[question.id] = {
            kind: 'score',
            answered,
            counts,
            promoters: counts[9]! + counts[10]!,
            passives: counts[7]! + counts[8]!,
            detractors: counts.slice(0, 7).reduce((sum, n) => sum + n, 0),
            recommendScore: score,
          };
          if (question.recommend === true) recommendScore = score;
        } else {
          const total = counts.reduce((sum, n, i) => sum + n * (i + 1), 0);
          questions[question.id] = { kind: 'stars', answered, counts, average: answered === 0 ? null : Math.round((total * 10) / answered) / 10 };
        }
        break;
      }
      default:
        questions[question.id] = { kind: question.kind, answered: given.length };
    }
  }
  return { total: answers.length, byLanguage, recommendScore, questions };
}
