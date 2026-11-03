// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The few values and rules the answer's check shares with the schemas,
 * kept apart from them: no schema here, so a page that checks answers in
 * the browser (`@adminium/add-on-contracts/forms/check`) carries the check
 * and none of the schemas.
 *
 * Pure: no I/O, no import but types.
 */

/** The most files one file question takes when it takes several. */
export const FORM_FILES_MAX = 5;

/** The values a question of a scale holds: 0–10 for a score, 1–5 for stars. */
export const SCALE_OF = { score: { min: 0, max: 10 }, stars: { min: 1, max: 5 } } as const;

/** Whether a survey keeps who answered: a named one that links answers to names. Every form does. */
/**
 * The part of a form's settings this reads, spelled out here rather than imported: the settings' schema builds on the
 * definition, which takes these limits, so an import back would close a loop.
 */
export interface SurveyNaming {
  survey?: { mode: 'named' | 'anonymous'; linkNames: boolean } | undefined;
}

export function keepsNames(settings: SurveyNaming): boolean {
  return settings.survey === undefined || (settings.survey.mode === 'named' && settings.survey.linkNames);
}
