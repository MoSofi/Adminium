// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S SETTINGS: what the owner sets beside the questions (comp M-4,
 * "Form settings"). What an answer becomes, who is told, the limits, and a
 * survey's three settings.
 *
 * "Becomes" names a table and fills its columns from answers. Which tables a
 * form may write, and which of their columns, is the app's to say through its
 * `publicAccess` entry under the key `forms`: the engine holds the map to that
 * entry when the form is published and on every answer. This file checks only
 * what the form itself can see: that the map names its own questions, of
 * kinds an answer can be written from, each into a column of its own.
 *
 * Pure: no I/O.
 */
import { z } from 'zod';

import { questionIdSchema } from './definition.js';

/** A column of an app's table, by the manifest's ref. */
export const formColumnRefSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'a column ref');

/** The most people and roles one form tells. */
export const FORM_TELL_MAX = 10;
/** The hourly cap a form starts with, and the most it may be raised to. */
export const FORM_PER_HOUR_DEFAULT = 200;
export const FORM_PER_HOUR_MAX = 1000;
/** How many days after each invitation a survey takes answers, by default. */
export const SURVEY_STOP_AFTER_DAYS_DEFAULT = 30;

export const formBecomesSchema = z
  .object({
    /** The app table, by the id the kit names it with. */
    table: z.string().min(1).max(200),
    /** Which question fills which column. */
    map: z.record(questionIdSchema, formColumnRefSchema),
    /** A fixed value the row gets whoever answers ("Source → Showroom form"). */
    source: z.object({ column: formColumnRefSchema, value: z.string().min(1).max(200) }).strict().optional(),
  })
  .strict();
export type FormBecomes = z.infer<typeof formBecomesSchema>;

export const formTellSchema = z.object({ kind: z.enum(['role', 'person']), id: z.string().min(1).max(64) }).strict();

export const formSettingsSchema = z
  .object({
    /** A new row in an app's table, or nothing but the answer (`null`). */
    becomes: formBecomesSchema.nullable().default(null),
    /** Who gets a bell and an e-mail for each answer. */
    tell: z.array(formTellSchema).max(FORM_TELL_MAX).default([]),
    /** Only when this score or star answer is at most this (a survey's low-score tell). */
    tellWhen: z.object({ question: questionIdSchema, atMost: z.number().int().min(0).max(10) }).strict().optional(),
    limits: z
      .object({
        perHour: z.number().int().min(1).max(FORM_PER_HOUR_MAX).default(FORM_PER_HOUR_DEFAULT),
        /** A harder human check: the challenge's difficulty goes up. */
        harder: z.boolean().default(false),
      })
      .strict()
      .default({ perHour: FORM_PER_HOUR_DEFAULT, harder: false }),
    /** A survey's own settings; required on a survey and refused on a form. */
    survey: z
      .object({
        /** Named: invitations only. Anonymous: an open link, and no names kept. */
        mode: z.enum(['named', 'anonymous']),
        /** Link answers to names (off: the answers are anonymous). */
        linkNames: z.boolean(),
        stopAfterDays: z.number().int().min(1).max(365).default(SURVEY_STOP_AFTER_DAYS_DEFAULT),
      })
      .strict()
      .optional(),
  })
  .strict();
export type FormSettings = z.infer<typeof formSettingsSchema>;
export type FormSettingsInput = z.input<typeof formSettingsSchema>;

/** Whether a survey keeps who answered: a named one that links answers to names. Every form does. */
export function keepsNames(settings: Pick<FormSettings, 'survey'>): boolean {
  return settings.survey === undefined || (settings.survey.mode === 'named' && settings.survey.linkNames);
}
