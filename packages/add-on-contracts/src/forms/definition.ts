// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S DEFINITION: what the forms add-on's builder writes and the engine
 * draws, checks and stores answers against.
 *
 * The engine reads every form for a stranger (no add-on code runs for one),
 * so this one schema is the whole of what a form may say: the eleven question
 * kinds and their own checks, "show if" on an earlier answer, sections, a
 * version of every text per language, the agreement tick with its wording's
 * version, the hidden source field, and the ending. The builder previews with
 * it and the engine parses with it at publish and at every draw, so the two
 * can never disagree.
 *
 * A refusal is a CODE at a path, never a sentence: the dashboard and the
 * stranger's page word it in the reader's language. The codes this file adds
 * are in {@link FORM_DEFINITION_CODES}; the rest are Zod's own
 * (`invalid_type`, `too_big`, …).
 *
 * Pure: no I/O.
 */
import { z } from 'zod';

import { FORM_FILES_MAX, SCALE_OF } from './scales.js';
import { FORM_LANGUAGES, FORM_WORDS_MAX, formLanguageSchema, wordsSchema, type FormLanguage, type Words } from './words.js';

export { FORM_FILES_MAX, SCALE_OF };

/** The version of this vocabulary. A form says which one it was written in (`v`). */
export const FORMS_VOCABULARY_VERSION = 1;

/** The most questions, sections and choices a form holds. */
export const FORM_QUESTIONS_MAX = 60;
export const FORM_SECTIONS_MAX = 12;
export const FORM_CHOICES_MIN = 2;
export const FORM_CHOICES_MAX = 30;

/** The eleven kinds of question. */
export const FORM_QUESTION_KINDS = ['short', 'long', 'one', 'several', 'date', 'number', 'score', 'stars', 'file', 'tick', 'hidden'] as const;
export type FormQuestionKind = (typeof FORM_QUESTION_KINDS)[number];

/** The kinds a "show if" may name: the ones whose answer is a pick or a number. */
export const SHOW_IF_KINDS = ['one', 'several', 'score', 'stars', 'number'] as const satisfies readonly FormQuestionKind[];

/**
 * The two purposes a tick may give consent for. A closed list on purpose: the
 * unsubscribe page, the audience and the stop list know these two and no
 * others (the manifest's `CONSENT_PURPOSES` is the same list).
 */
export const FORM_TICK_PURPOSES = ['newsletter', 'surveys'] as const;
export type FormTickPurpose = (typeof FORM_TICK_PURPOSES)[number];

/** The kinds of file a file question may take: pictures, PDF and plain text only. */
export const FORM_FILE_KINDS = ['pdf', 'jpg', 'png', 'text'] as const;
export type FormFileKind = (typeof FORM_FILE_KINDS)[number];

/** Codes this file refuses a definition with, beside Zod's own. */
export const FORM_DEFINITION_CODES = [
  /** Two questions, sections, choices of one question or hidden fields share an id (or a parameter). */
  'id-duplicate',
  'languages-duplicate',
  /** The default language is not one the form lists. */
  'default-language',
  /** A listed language has no version of this text (the path ends in the language). */
  'words-missing',
  /** A text has a version in a language the form does not list. */
  'words-unlisted',
  'section-unknown',
  /** Questions without a section come first, then each section's in the sections' order. */
  'section-order',
  /** A "show if" names no question of the form. */
  'show-if-unknown',
  /** A "show if" names its own question or a later one. */
  'show-if-forward',
  /** A "show if" names a question whose kind it cannot test. */
  'show-if-kind',
  /** A "show if" gives no test, more than one, or one its question's kind does not take. */
  'show-if-test',
  /** A "show if" names a choice its question does not have. */
  'show-if-choice',
  /** A "show if" names a number its question can never hold. */
  'show-if-range',
  /** A hidden field is never shown, so it has no "show if". */
  'hidden-show-if',
  /** A hidden field is filled from the page's address, so nobody can be asked for it. */
  'hidden-required',
  /** An agreement is given freely: a tick is never required. */
  'tick-required',
  /** Two ticks give consent for one purpose. */
  'tick-purpose-twice',
  /**
   * A tick that waits for the click in a confirmation mail, on a form that
   * asks for no e-mail address (a short answer that checks for one): the
   * mail has nowhere to go, so the yes could never be proved.
   */
  'tick-confirm-email',
  /** `recommend` marks a survey's score; a form has none. */
  'recommend-on-form',
  'recommend-twice',
  /** Surveys take no files. */
  'survey-file',
  /** Surveys sign nobody up. */
  'survey-tick',
  /** A several-choice question's least and most picks do not fit its choices. */
  'several-picks',
  /** A number question's least is above its most. */
  'number-bounds',
  'file-kinds-duplicate',
  /** A question marked as the e-mail address checks for one. */
  'role-email-check',
  /** The page an ending sends to is not an https address. */
  'ending-https',
] as const;
export type FormDefinitionCode = (typeof FORM_DEFINITION_CODES)[number];

export const questionIdSchema = z.string().regex(/^q[a-z0-9]{1,15}$/, 'a question id is q and 1 to 15 lower-case letters or digits');
export const sectionIdSchema = z.string().regex(/^s[a-z0-9]{1,15}$/, 'a section id is s and 1 to 15 lower-case letters or digits');
/** A choice's id: what an answer stores, so a column a form fills may take it as it is. */
export const choiceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'a choice id is 1 to 40 lower-case letters, digits, _ or -');

/** The one test a "show if" makes of an earlier answer. */
export const showIfSchema = z
  .object({
    question: questionIdSchema,
    /** A pick of a one-choice question, or a score, a star count or a number. */
    is: z.union([choiceIdSchema, z.number()]).optional(),
    /** A several-choice question's picks include this choice. */
    includes: choiceIdSchema.optional(),
    atLeast: z.number().optional(),
    atMost: z.number().optional(),
  })
  .strict();
export type ShowIf = z.infer<typeof showIfSchema>;

export const choiceSchema = z.object({ id: choiceIdSchema, label: wordsSchema(FORM_WORDS_MAX.choice) }).strict();
export type FormChoice = z.infer<typeof choiceSchema>;

/** What every question has. */
const base = {
  id: questionIdSchema,
  label: wordsSchema(FORM_WORDS_MAX.label),
  help: wordsSchema(FORM_WORDS_MAX.help).optional(),
  required: z.boolean().default(false),
  /** The section it sits in; absent, it sits before the first. */
  section: sectionIdSchema.optional(),
  showIf: showIfSchema.optional(),
};

/** A bound a number question may say: a sensible magnitude, so a stored answer fits any number column. */
const NUMBER_MAGNITUDE = 1e12;
const bound = z.number().min(-NUMBER_MAGNITUDE).max(NUMBER_MAGNITUDE);

export const shortQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('short'),
    /** The answer must be an e-mail address, or a phone number. */
    check: z.enum(['email', 'phone']).optional(),
    maxLength: z.number().int().min(1).max(500).default(200),
    /** What the answer is of the person: the engine keeps the name and the e-mail address on the answer itself. */
    role: z.enum(['name', 'email', 'company']).optional(),
  })
  .strict();

export const longQuestionSchema = z.object({ ...base, kind: z.literal('long'), maxLength: z.number().int().min(1).max(5000).default(2000) }).strict();

const choices = z.array(choiceSchema).min(FORM_CHOICES_MIN).max(FORM_CHOICES_MAX);

export const oneQuestionSchema = z.object({ ...base, kind: z.literal('one'), choices }).strict();

export const severalQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('several'),
    choices,
    /** The fewest and the most picks an answer may make. */
    min: z.number().int().min(1).max(FORM_CHOICES_MAX).optional(),
    max: z.number().int().min(1).max(FORM_CHOICES_MAX).optional(),
  })
  .strict();

export const dateQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('date'),
    /** The earliest day an answer may name, counted in the business's time zone. */
    from: z.enum(['any', 'today', 'tomorrow']).default('any'),
  })
  .strict();

export const numberQuestionSchema = z.object({ ...base, kind: z.literal('number'), min: bound.optional(), max: bound.optional(), whole: z.boolean().optional() }).strict();

export const scoreQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('score'),
    /** "How likely are you to recommend us?": the survey's one score its results call the recommend score. */
    recommend: z.boolean().optional(),
  })
  .strict();

export const starsQuestionSchema = z.object({ ...base, kind: z.literal('stars') }).strict();

export const fileQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('file'),
    /** The largest file taken, in megabytes, per file. */
    maxMb: z.number().int().min(1).max(10),
    kinds: z.array(z.enum(FORM_FILE_KINDS)).min(1).max(FORM_FILE_KINDS.length),
    /** Up to {@link FORM_FILES_MAX} files; absent, one. */
    many: z.boolean().optional(),
  })
  .strict();

/**
 * The agreement tick. Its `label` IS the wording the visitor agrees to, and
 * its version is what the consent log keeps with the yes. It is never ticked
 * before the visitor ticks it, so the vocabulary has no default value for it.
 */
export const tickQuestionSchema = z
  .object({
    ...base,
    label: wordsSchema(FORM_WORDS_MAX.wording),
    kind: z.literal('tick'),
    purpose: z.enum(FORM_TICK_PURPOSES),
    wordingVersion: z.number().int().min(1),
    wordingChangedAt: z.iso.date(),
    /** A yes waits for the click in a confirmation mail (on by default). */
    confirm: z.boolean().default(true),
  })
  .strict();

/** The hidden source field: filled from the page address's query (`?from=flyer`), never shown. */
export const hiddenQuestionSchema = z
  .object({
    ...base,
    kind: z.literal('hidden'),
    param: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'a parameter is 1 to 32 lower-case letters, digits or _'),
  })
  .strict();

export const formQuestionSchema = z.discriminatedUnion('kind', [
  shortQuestionSchema,
  longQuestionSchema,
  oneQuestionSchema,
  severalQuestionSchema,
  dateQuestionSchema,
  numberQuestionSchema,
  scoreQuestionSchema,
  starsQuestionSchema,
  fileQuestionSchema,
  tickQuestionSchema,
  hiddenQuestionSchema,
]);
export type FormQuestion = z.infer<typeof formQuestionSchema>;
export type FormQuestionOf<K extends FormQuestionKind> = Extract<FormQuestion, { kind: K }>;

export const formSectionSchema = z.object({ id: sectionIdSchema, title: wordsSchema(FORM_WORDS_MAX.section) }).strict();

/** Whether a text is an https address with a host and no user name or password in it. */
export function isHttpsAddress(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}

/** What a visitor sees after sending: the owner's words, or another page. */
export const formEndingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('words'), words: wordsSchema(FORM_WORDS_MAX.ending) }).strict(),
  z.object({ kind: z.literal('page'), url: z.string().min(1).max(2048) }).strict(),
]);

const definitionShape = z
  .object({
    v: z.literal(FORMS_VOCABULARY_VERSION),
    kind: z.enum(['form', 'survey']),
    languages: z.array(formLanguageSchema).min(1).max(FORM_LANGUAGES.length),
    defaultLanguage: formLanguageSchema,
    title: wordsSchema(FORM_WORDS_MAX.title),
    intro: wordsSchema(FORM_WORDS_MAX.intro).optional(),
    sections: z.array(formSectionSchema).max(FORM_SECTIONS_MAX).optional(),
    questions: z.array(formQuestionSchema).min(1).max(FORM_QUESTIONS_MAX),
    ending: formEndingSchema,
  })
  .strict();

type Path = (string | number)[];
type Report = (code: FormDefinitionCode, path: Path) => void;
type DefinitionShape = z.infer<typeof definitionShape>;

/** The kinds of test each kind of question takes in a "show if". */
const TESTS_OF: Readonly<Record<(typeof SHOW_IF_KINDS)[number], readonly ('is' | 'includes' | 'atLeast' | 'atMost')[]>> = {
  one: ['is'],
  several: ['includes'],
  score: ['is', 'atLeast', 'atMost'],
  stars: ['is', 'atLeast', 'atMost'],
  number: ['is', 'atLeast', 'atMost'],
};


/** Every text of the definition, with its path, to hold against the form's languages. */
function textsOf(d: DefinitionShape): { words: Words; path: Path }[] {
  const out: { words: Words; path: Path }[] = [{ words: d.title, path: ['title'] }];
  if (d.intro !== undefined) out.push({ words: d.intro, path: ['intro'] });
  (d.sections ?? []).forEach((section, s) => out.push({ words: section.title, path: ['sections', s, 'title'] }));
  d.questions.forEach((question, q) => {
    out.push({ words: question.label, path: ['questions', q, 'label'] });
    if (question.help !== undefined) out.push({ words: question.help, path: ['questions', q, 'help'] });
    if (question.kind === 'one' || question.kind === 'several') {
      question.choices.forEach((choice, c) => out.push({ words: choice.label, path: ['questions', q, 'choices', c, 'label'] }));
    }
  });
  if (d.ending.kind === 'words') out.push({ words: d.ending.words, path: ['ending', 'words'] });
  return out;
}

/** The rules across a definition's parts, each a code at a path. */
function definitionIssues(d: DefinitionShape, report: Report): void {
  // Languages: listed once, the default among them, and every text in exactly those.
  const listed = new Set<FormLanguage>(d.languages);
  if (listed.size !== d.languages.length) report('languages-duplicate', ['languages']);
  if (!listed.has(d.defaultLanguage)) report('default-language', ['defaultLanguage']);
  for (const { words, path } of textsOf(d)) {
    for (const language of listed) if (words[language] === undefined) report('words-missing', [...path, language]);
    for (const language of Object.keys(words) as FormLanguage[]) if (!listed.has(language)) report('words-unlisted', [...path, language]);
  }

  // Sections: unique, named by their questions, and drawn in order.
  const sections = d.sections ?? [];
  const sectionAt = new Map<string, number>();
  sections.forEach((section, s) => {
    if (sectionAt.has(section.id)) report('id-duplicate', ['sections', s, 'id']);
    else sectionAt.set(section.id, s);
  });
  let lastSection = -1;
  d.questions.forEach((question, q) => {
    if (question.section === undefined) {
      if (lastSection !== -1) report('section-order', ['questions', q, 'section']);
      return;
    }
    const at = sectionAt.get(question.section);
    if (at === undefined) {
      report('section-unknown', ['questions', q, 'section']);
      return;
    }
    if (at < lastSection) report('section-order', ['questions', q, 'section']);
    lastSection = Math.max(lastSection, at);
  });

  // Questions: ids, choices and hidden parameters unique.
  const questionAt = new Map<string, number>();
  const params = new Set<string>();
  d.questions.forEach((question, q) => {
    if (questionAt.has(question.id)) report('id-duplicate', ['questions', q, 'id']);
    else questionAt.set(question.id, q);
    if (question.kind === 'one' || question.kind === 'several') {
      const seen = new Set<string>();
      question.choices.forEach((choice, c) => {
        if (seen.has(choice.id)) report('id-duplicate', ['questions', q, 'choices', c, 'id']);
        seen.add(choice.id);
      });
    }
    if (question.kind === 'hidden') {
      if (params.has(question.param)) report('id-duplicate', ['questions', q, 'param']);
      params.add(question.param);
    }
  });

  // Each kind's own rules.
  const asksEmail = d.questions.some((question) => question.kind === 'short' && question.check === 'email');
  const purposes = new Set<FormTickPurpose>();
  let recommends = 0;
  d.questions.forEach((question, q) => {
    const at = (...rest: Path): Path => ['questions', q, ...rest];
    switch (question.kind) {
      case 'short':
        if (question.role === 'email' && question.check !== 'email') report('role-email-check', at('role'));
        break;
      case 'several': {
        const most = question.max ?? question.choices.length;
        if (most > question.choices.length || (question.min ?? 1) > most) report('several-picks', at(question.max === undefined ? 'min' : 'max'));
        break;
      }
      case 'number':
        if (question.min !== undefined && question.max !== undefined && question.min > question.max) report('number-bounds', at('min'));
        break;
      case 'score':
        if (question.recommend === true) {
          if (d.kind === 'form') report('recommend-on-form', at('recommend'));
          else if (++recommends > 1) report('recommend-twice', at('recommend'));
        }
        break;
      case 'file':
        if (new Set(question.kinds).size !== question.kinds.length) report('file-kinds-duplicate', at('kinds'));
        if (d.kind === 'survey') report('survey-file', at('kind'));
        break;
      case 'tick':
        if (question.required) report('tick-required', at('required'));
        if (purposes.has(question.purpose)) report('tick-purpose-twice', at('purpose'));
        purposes.add(question.purpose);
        if (d.kind === 'survey') report('survey-tick', at('kind'));
        else if (question.confirm && !asksEmail) report('tick-confirm-email', at('confirm'));
        break;
      case 'hidden':
        if (question.required) report('hidden-required', at('required'));
        if (question.showIf !== undefined) report('hidden-show-if', at('showIf'));
        break;
      default:
        break;
    }
  });

  // "Show if": one test, of an earlier question it can test, naming what that question can hold.
  d.questions.forEach((question, q) => {
    const showIf = question.showIf;
    if (showIf === undefined || question.kind === 'hidden') return;
    const at = (...rest: Path): Path => ['questions', q, 'showIf', ...rest];
    const target = questionAt.get(showIf.question);
    if (target === undefined) {
      report('show-if-unknown', at('question'));
      return;
    }
    if (target >= q) {
      report('show-if-forward', at('question'));
      return;
    }
    const named = d.questions[target]!;
    if (!(SHOW_IF_KINDS as readonly string[]).includes(named.kind)) {
      report('show-if-kind', at('question'));
      return;
    }
    const given = (['is', 'includes', 'atLeast', 'atMost'] as const).filter((test) => showIf[test] !== undefined);
    const takes = TESTS_OF[named.kind as (typeof SHOW_IF_KINDS)[number]];
    if (given.length !== 1 || !takes.includes(given[0]!)) {
      report('show-if-test', at());
      return;
    }
    const test = given[0]!;
    const value = showIf[test]!;
    if (named.kind === 'one' || named.kind === 'several') {
      if (typeof value !== 'string' || !named.choices.some((choice) => choice.id === value)) report('show-if-choice', at(test));
      return;
    }
    if (typeof value !== 'number') {
      report('show-if-test', at(test));
      return;
    }
    if (named.kind === 'score' || named.kind === 'stars') {
      const scale = SCALE_OF[named.kind];
      if (!Number.isInteger(value) || value < scale.min || value > scale.max) report('show-if-range', at(test));
    } else if (named.kind === 'number' && ((named.min !== undefined && value < named.min) || (named.max !== undefined && value > named.max))) {
      report('show-if-range', at(test));
    }
  });

  if (d.ending.kind === 'page' && !isHttpsAddress(d.ending.url)) report('ending-https', ['ending', 'url']);
}

/**
 * A form's definition. Its defaults filled in (`required: false`, a short
 * answer's 200 characters, a tick's confirmation on), and every rule across
 * its parts held: a value that parses here is one the engine can draw in each
 * of its languages and check an answer against.
 */
export const formDefinitionSchema = definitionShape.superRefine((d, ctx) => {
  definitionIssues(d, (code, path) => ctx.addIssue({ code: 'custom', message: code, path, params: { code } }));
});
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;
