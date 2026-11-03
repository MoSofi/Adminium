// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S DRAFT, AS ITS PREVIEW DRAWS IT.
 *
 * The forms builder shows the form a stranger would see, drawn by the
 * stranger's own page (`/x/forms/<slug>?preview=1`), from the draft its
 * staff are still writing. A draft may be half made, so it is read leniently
 * here, for the preview alone (the door and publishing hold a form to
 * `parseForm` whole, and nothing here touches that):
 *
 *  - a word missing in one of the form's languages is taken from the
 *    default language (else from any language that has it);
 *  - a question that does not read is left out, and named in `skipped`;
 *    so is one a "show if" or a check no longer lets stand once another is
 *    left out;
 *  - settings that do not read are the defaults (a survey: anonymous).
 *
 * What still does not read (no title in any language, nothing to ask) is no
 * preview: null.
 *
 * Pure: no I/O.
 */
import {
  FORM_LANGUAGES,
  FORMS_VOCABULARY_VERSION,
  formQuestionSchema,
  formSettingsSchema,
  parseForm,
  type Form,
  type FormLanguage,
  type FormSettings,
} from '@adminium/add-on-contracts/forms';

type Doc = Record<string, unknown>;

const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A draft as the preview draws it, and the questions left out of it (their ids, or `#<n>` for one with none). */
export interface PreviewForm {
  form: Form;
  skipped: string[];
}

/** The most rounds of leaving out a question a check still points at. */
const ROUNDS = 8;

/** Every listed language's text of a word, each one missing taken from the default language, else from any that has it. */
function filled(words: unknown, languages: readonly FormLanguage[], fallback: FormLanguage): unknown {
  if (!isDoc(words)) return words;
  const given = (language: string): string | undefined => {
    const text = words[language];
    return typeof text === 'string' && text.trim() !== '' ? text : undefined;
  };
  const spare = given(fallback) ?? FORM_LANGUAGES.map(given).find((text) => text !== undefined);
  if (spare === undefined) return words;
  return Object.fromEntries(languages.map((language) => [language, given(language) ?? spare]));
}

/** A question with its words in every listed language. */
function filledQuestion(question: unknown, languages: readonly FormLanguage[], fallback: FormLanguage): unknown {
  if (!isDoc(question)) return question;
  const out: Doc = { ...question, label: filled(question['label'], languages, fallback) };
  if (question['help'] !== undefined) out['help'] = filled(question['help'], languages, fallback);
  if (Array.isArray(question['choices'])) out['choices'] = question['choices'].map((choice) => (isDoc(choice) ? { ...choice, label: filled(choice['label'], languages, fallback) } : choice));
  return out;
}

/** The settings a draft is drawn with: its own when they read, else the defaults for its kind. */
function settingsOf(settings: unknown, kind: unknown): FormSettings {
  const read = formSettingsSchema.safeParse(settings);
  if (read.success) return read.data;
  return formSettingsSchema.parse(kind === 'survey' ? { survey: { mode: 'anonymous', linkNames: false } } : {});
}

/** The id a question is named by in `skipped`. */
function nameOf(question: unknown, at: number): string {
  return isDoc(question) && typeof question['id'] === 'string' && question['id'] !== '' ? question['id'] : `#${String(at)}`;
}

/** The draft as the preview draws it (see the header); null when nothing of it can be drawn. */
export function previewForm(definition: unknown, settings: unknown): PreviewForm | null {
  const whole = parseForm(definition, settings);
  if (whole.ok) return { form: whole.form, skipped: [] };
  if (!isDoc(definition)) return null;

  const languages = (Array.isArray(definition['languages']) ? definition['languages'] : []).filter(
    (language, at, all): language is FormLanguage => (FORM_LANGUAGES as readonly unknown[]).includes(language) && all.indexOf(language) === at,
  );
  if (languages.length === 0) languages.push((FORM_LANGUAGES as readonly unknown[]).includes(definition['defaultLanguage']) ? (definition['defaultLanguage'] as FormLanguage) : 'en-US');
  const fallback = languages.includes(definition['defaultLanguage'] as FormLanguage) ? (definition['defaultLanguage'] as FormLanguage) : languages[0]!;

  const skipped: string[] = [];
  const questions: unknown[] = [];
  (Array.isArray(definition['questions']) ? definition['questions'] : []).forEach((question, at) => {
    const one = filledQuestion(question, languages, fallback);
    if (formQuestionSchema.safeParse(one).success) questions.push(one);
    else skipped.push(nameOf(question, at));
  });
  const ending = isDoc(definition['ending']) && definition['ending']['kind'] === 'words' ? { ...definition['ending'], words: filled(definition['ending']['words'], languages, fallback) } : definition['ending'];
  const draft: Doc = {
    ...definition,
    v: FORMS_VOCABULARY_VERSION,
    languages,
    defaultLanguage: fallback,
    title: filled(definition['title'], languages, fallback),
    ...(definition['intro'] === undefined ? {} : { intro: filled(definition['intro'], languages, fallback) }),
    ...(Array.isArray(definition['sections']) ? { sections: definition['sections'].map((section) => (isDoc(section) ? { ...section, title: filled(section['title'], languages, fallback) } : section)) } : {}),
    questions,
    ending,
  };
  let drawn = settingsOf(settings, definition['kind']);

  // What a check still points at: a question, left out in turn; settings that name what is gone, the defaults; anything else is no preview.
  for (let round = 0; round < ROUNDS; round += 1) {
    const read = parseForm(draft, drawn);
    if (read.ok) return { form: read.form, skipped };
    if (read.issues.some((issue) => issue.path[0] === 'settings')) {
      const plain = settingsOf(undefined, definition['kind']);
      if (JSON.stringify(plain) === JSON.stringify(drawn)) return null;
      drawn = plain;
      continue;
    }
    const at = new Set<number>();
    for (const issue of read.issues) {
      if (issue.path[0] === 'definition' && issue.path[1] === 'questions' && typeof issue.path[2] === 'number') at.add(issue.path[2]);
      else return null;
    }
    const kept = draft['questions'] as unknown[];
    draft['questions'] = kept.filter((question, n) => {
      if (!at.has(n)) return true;
      skipped.push(nameOf(question, n));
      return false;
    });
  }
  return null;
}
