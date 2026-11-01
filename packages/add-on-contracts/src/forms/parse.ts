// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form, read whole: its definition and its settings, each parsed, and the
 * rules that need both. What the builder previews with, what the engine
 * publishes and what it draws are all `parseForm`'s answer.
 *
 * Pure: no I/O.
 */
import type { z } from 'zod';

import { formDefinitionSchema, SCALE_OF, type FormDefinition } from './definition.js';
import { formSettingsSchema, keepsNames, type FormSettings } from './settings.js';

/** A form as the engine holds it. */
export interface Form {
  definition: FormDefinition;
  settings: FormSettings;
}

/** Codes the settings are refused with, beside the definition's and Zod's own. */
export const FORM_SETTINGS_CODES = [
  /** A survey says how it is answered (`survey`). */
  'survey-settings-missing',
  /** A form has no survey settings. */
  'survey-settings-on-form',
  /** An anonymous survey keeps no names, so it cannot link answers to them. */
  'survey-anonymous-names',
  /** The map names a question the form does not have. */
  'becomes-question-unknown',
  /** A file or a tick fills no column: files are kept with the answer, a tick is a consent. */
  'becomes-question-kind',
  /** Two questions, or a question and the source, fill one column. */
  'becomes-column-twice',
  /** A survey that keeps no names becomes no row: the row would say who answered. */
  'becomes-anonymous',
  'tell-duplicate',
  /** The low-score tell names no score or star question of the form. */
  'tell-when-question',
  /** The low-score tell's number is beyond its question's scale. */
  'tell-when-range',
] as const;
export type FormSettingsCode = (typeof FORM_SETTINGS_CODES)[number];

export interface FormIssue {
  /** Where: under `definition` or `settings`. */
  path: (string | number)[];
  /** What: one of this vocabulary's codes, or Zod's own. */
  code: string;
}

export type ParsedForm = { ok: true; form: Form } | { ok: false; issues: FormIssue[] };

function issuesOf(error: z.ZodError, under: string): FormIssue[] {
  return error.issues.map((issue) => {
    const own = (issue as { params?: { code?: unknown } }).params?.code;
    return {
      path: [under, ...issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part))],
      code: issue.code === 'custom' && typeof own === 'string' ? own : issue.code,
    };
  });
}

/** The rules that need the definition and the settings together. */
function settingsIssues(definition: FormDefinition, settings: FormSettings): FormIssue[] {
  const out: FormIssue[] = [];
  const report = (code: FormSettingsCode, ...path: (string | number)[]) => out.push({ path: ['settings', ...path], code });
  const questions = new Map(definition.questions.map((question) => [question.id, question]));

  if (definition.kind === 'survey' && settings.survey === undefined) report('survey-settings-missing', 'survey');
  if (definition.kind === 'form' && settings.survey !== undefined) report('survey-settings-on-form', 'survey');
  if (settings.survey?.mode === 'anonymous' && settings.survey.linkNames) report('survey-anonymous-names', 'survey', 'linkNames');

  const becomes = settings.becomes;
  if (becomes !== null) {
    if (definition.kind === 'survey' && !keepsNames(settings)) report('becomes-anonymous', 'becomes');
    const filled = new Set<string>();
    for (const [id, column] of Object.entries(becomes.map)) {
      const question = questions.get(id);
      if (question === undefined) report('becomes-question-unknown', 'becomes', 'map', id);
      else if (question.kind === 'file' || question.kind === 'tick') report('becomes-question-kind', 'becomes', 'map', id);
      if (filled.has(column)) report('becomes-column-twice', 'becomes', 'map', id);
      filled.add(column);
    }
    if (becomes.source !== undefined && filled.has(becomes.source.column)) report('becomes-column-twice', 'becomes', 'source', 'column');
  }

  const told = new Set<string>();
  settings.tell.forEach((tell, t) => {
    const key = `${tell.kind}\u0000${tell.id}`;
    if (told.has(key)) report('tell-duplicate', 'tell', t);
    told.add(key);
  });
  if (settings.tellWhen !== undefined) {
    const question = questions.get(settings.tellWhen.question);
    if (question === undefined || (question.kind !== 'score' && question.kind !== 'stars')) report('tell-when-question', 'tellWhen', 'question');
    else if (settings.tellWhen.atMost < SCALE_OF[question.kind].min || settings.tellWhen.atMost > SCALE_OF[question.kind].max) report('tell-when-range', 'tellWhen', 'atMost');
  }
  return out;
}

/**
 * A form from its stored definition and settings, or every reason it is not
 * one. The definition's issues come first; the rules across the two are
 * checked only when both parse.
 */
export function parseForm(definition: unknown, settings: unknown): ParsedForm {
  const d = formDefinitionSchema.safeParse(definition);
  const s = formSettingsSchema.safeParse(settings);
  const issues = [...(d.success ? [] : issuesOf(d.error, 'definition')), ...(s.success ? [] : issuesOf(s.error, 'settings'))];
  if (!d.success || !s.success) return { ok: false, issues };
  const across = settingsIssues(d.data, s.data);
  return across.length === 0 ? { ok: true, form: { definition: d.data, settings: s.data } } : { ok: false, issues: across };
}
