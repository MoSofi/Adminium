// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/add-on-contracts/forms` — the forms vocabulary: a form's
 * definition and settings, the check an answer is held to, which questions
 * are shown, and the results counted.
 *
 * Both the engine and the forms add-on import it, so the builder's preview,
 * the page a stranger fills and the server's check can never disagree. Pure:
 * no I/O, no `node:` import.
 */
export { FORM_LANGUAGES, FORM_WORDS_MAX, formLanguageSchema, wordsSchema, type FormLanguage, type Words } from './words.js';

export {
  FORMS_VOCABULARY_VERSION,
  FORM_CHOICES_MAX,
  FORM_CHOICES_MIN,
  FORM_DEFINITION_CODES,
  FORM_FILES_MAX,
  FORM_FILE_KINDS,
  FORM_QUESTIONS_MAX,
  FORM_QUESTION_KINDS,
  FORM_SECTIONS_MAX,
  FORM_TICK_PURPOSES,
  SCALE_OF,
  SHOW_IF_KINDS,
  choiceIdSchema,
  choiceSchema,
  dateQuestionSchema,
  fileQuestionSchema,
  formDefinitionSchema,
  formEndingSchema,
  formQuestionSchema,
  formSectionSchema,
  hiddenQuestionSchema,
  isHttpsAddress,
  longQuestionSchema,
  numberQuestionSchema,
  oneQuestionSchema,
  questionIdSchema,
  scoreQuestionSchema,
  sectionIdSchema,
  severalQuestionSchema,
  shortQuestionSchema,
  showIfSchema,
  starsQuestionSchema,
  tickQuestionSchema,
  type FormChoice,
  type FormDefinition,
  type FormDefinitionCode,
  type FormDefinitionInput,
  type FormFileKind,
  type FormQuestion,
  type FormQuestionKind,
  type FormQuestionOf,
  type FormTickPurpose,
  type ShowIf,
} from './definition.js';

export {
  FORM_PER_HOUR_DEFAULT,
  FORM_PER_HOUR_MAX,
  FORM_TELL_MAX,
  SURVEY_STOP_AFTER_DAYS_DEFAULT,
  formBecomesSchema,
  formColumnRefSchema,
  formSettingsSchema,
  formTellSchema,
  keepsNames,
  type FormBecomes,
  type FormSettings,
  type FormSettingsInput,
} from './settings.js';

export { FORM_SETTINGS_CODES, parseForm, type Form, type FormIssue, type FormSettingsCode, type ParsedForm } from './parse.js';

export {
  ANSWER_NAME_MAX,
  EMAIL_MAX,
  FORM_ANSWER_CODES,
  HIDDEN_VALUE_MAX,
  UPLOAD_ID,
  WHOLE_ANSWER,
  checkAnswer,
  cleanText,
  isEmailAddress,
  isPhoneNumber,
  visibleQuestions,
  type CheckedAnswer,
  type FormAnswerCode,
  type FormAnswerValue,
  type FormAnswerValues,
} from './check.js';

export { recommendScoreOf, summarise, type FormSummary, type QuestionSummary } from './summary.js';

export {
  WEBSITES_MAX,
  WEBSITE_LINE_CODES,
  WEBSITE_LINE_MAX,
  WEBSITE_ORIGIN_MAX,
  checkWebsiteLine,
  checkWebsiteLines,
  isWebsiteOrigin,
  type WebsiteCheckContext,
  type WebsiteLine,
  type WebsiteLineCode,
} from './websites.js';
