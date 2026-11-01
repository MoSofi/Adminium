// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The forms vocabulary: what a form's definition and settings may say (each
 * rule a refusal with its code, and the passes beside it), which questions a
 * visitor is shown, what an answer is held to, and the results counted
 * against the comp's own numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_LOCALE_IDS,
  FORMS_VOCABULARY_VERSION,
  FORM_LANGUAGES,
  checkAnswer,
  cleanText,
  formDefinitionSchema,
  isEmailAddress,
  isPhoneNumber,
  parseForm,
  recommendScoreOf,
  summarise,
  visibleQuestions,
  type Form,
  type FormDefinitionInput,
  type FormSettingsInput,
} from '../src/index.js';
import * as subpath from '../src/forms/index.js';

const en = (text: string) => ({ 'en-US': text });
const both = (text: string, de = `${text} (de)`) => ({ 'en-US': text, 'de-DE': de });

/** A form with one question of each kind a form takes, in two languages. */
function fullForm(): FormDefinitionInput {
  return {
    v: 1,
    kind: 'form',
    languages: ['en-US', 'de-DE'],
    defaultLanguage: 'en-US',
    title: both('Book a showroom visit'),
    intro: both('Tell us what you need.'),
    sections: [
      { id: 'syou', title: both('About you') },
      { id: 'sneed', title: both('What you need') },
    ],
    questions: [
      { id: 'qname', kind: 'short', label: both('Your name'), required: true, role: 'name', section: 'syou' },
      { id: 'qmail', kind: 'short', label: both('Work e-mail'), required: true, check: 'email', role: 'email', section: 'syou' },
      { id: 'qphone', kind: 'short', label: both('Phone'), check: 'phone', section: 'syou' },
      {
        id: 'qroom',
        kind: 'one',
        label: both('Which room?'),
        required: true,
        section: 'sneed',
        choices: [
          { id: 'kitchen', label: both('Kitchen') },
          { id: 'bath', label: both('Bathroom') },
        ],
      },
      {
        id: 'qextras',
        kind: 'several',
        label: both('Extras'),
        section: 'sneed',
        min: 1,
        max: 2,
        choices: [
          { id: 'light', label: both('Lighting') },
          { id: 'floor', label: both('Flooring') },
          { id: 'tiles', label: both('Tiles') },
        ],
      },
      { id: 'qsize', kind: 'number', label: both('Size in m²'), section: 'sneed', min: 1, max: 200, whole: true, showIf: { question: 'qroom', is: 'kitchen' } },
      { id: 'qday', kind: 'date', label: both('When?'), section: 'sneed', from: 'tomorrow' },
      { id: 'qnote', kind: 'long', label: both('Anything else?'), help: both('Optional'), section: 'sneed' },
      { id: 'qhappy', kind: 'score', label: both('How likely are you to visit?'), section: 'sneed' },
      { id: 'qstars', kind: 'stars', label: both('Rate our site'), section: 'sneed' },
      { id: 'qplan', kind: 'file', label: both('Your floor plan'), section: 'sneed', maxMb: 10, kinds: ['pdf', 'jpg', 'png'], many: true },
      {
        id: 'qnews',
        kind: 'tick',
        label: both('Send me the newsletter. I can unsubscribe at any time.'),
        section: 'sneed',
        purpose: 'newsletter',
        wordingVersion: 3,
        wordingChangedAt: '2026-10-01',
      },
      { id: 'qfrom', kind: 'hidden', label: both('Source'), param: 'from', section: 'sneed' },
    ],
    ending: { kind: 'words', words: both('Thank you.') },
  };
}

/** A survey: a recommend score, stars and a long text, in one language. */
function survey(): FormDefinitionInput {
  return {
    v: 1,
    kind: 'survey',
    languages: ['en-US', 'de-DE'],
    defaultLanguage: 'en-US',
    title: both('How did we do?'),
    questions: [
      { id: 'qnps', kind: 'score', label: both('How likely are you to recommend us?'), required: true, recommend: true },
      { id: 'qwhy', kind: 'long', label: both('What should we do better?'), showIf: { question: 'qnps', atMost: 6 } },
      { id: 'qstar', kind: 'stars', label: both('The fitters') },
      { id: 'qmail', kind: 'short', label: both('Your e-mail'), check: 'email' },
      { id: 'qname', kind: 'short', label: both('Your name'), role: 'name' },
    ],
    ending: { kind: 'page', url: 'https://meridian.example/thanks' },
  };
}

const surveySettings = (over: Partial<NonNullable<FormSettingsInput['survey']>> = {}): FormSettingsInput => ({ survey: { mode: 'named', linkNames: true, ...over } });

/** Parse, or fail the test with the issues. */
function form(definition: FormDefinitionInput, settings: FormSettingsInput = {}): Form {
  const parsed = parseForm(definition, settings);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.form;
}

/** The codes a definition (and settings) are refused with, as `code@path`. */
function refusals(definition: unknown, settings: unknown = {}): string[] {
  const parsed = parseForm(definition, settings);
  return parsed.ok ? [] : parsed.issues.map((issue) => `${issue.code}@${issue.path.join('.')}`);
}

/** A copy of the full form changed by `edit`. */
function changed(edit: (d: FormDefinitionInput & { questions: Record<string, unknown>[] }) => void, start: FormDefinitionInput = fullForm()): FormDefinitionInput {
  const copy = structuredClone(start) as FormDefinitionInput & { questions: Record<string, unknown>[] };
  edit(copy);
  return copy;
}

const q = (d: { questions: Record<string, unknown>[] }, id: string) => d.questions.find((question) => question['id'] === id)!;

describe('the vocabulary', () => {
  it('is version 1, in the product\'s eight languages, at its own subpath too', () => {
    expect(FORMS_VOCABULARY_VERSION).toBe(1);
    expect([...FORM_LANGUAGES].sort()).toEqual([...DOCUMENT_LOCALE_IDS].sort());
    expect(subpath.parseForm).toBe(parseForm);
  });
});

describe('a form\'s definition', () => {
  it('takes a form with all eleven kinds, and fills the defaults', () => {
    const { definition, settings } = form(fullForm());
    expect(new Set(definition.questions.map((question) => question.kind)).size).toBe(11);
    expect(definition.questions.find((question) => question.id === 'qphone')).toMatchObject({ required: false, maxLength: 200 });
    expect(definition.questions.find((question) => question.id === 'qnote')).toMatchObject({ maxLength: 2000 });
    expect(definition.questions.find((question) => question.id === 'qnews')).toMatchObject({ confirm: true, required: false });
    expect(settings).toEqual({ becomes: null, tell: [], limits: { perHour: 200, harder: false } });
  });

  it('takes a survey, and a score on a form that is not the recommend question', () => {
    expect(form(survey(), surveySettings()).settings.survey).toEqual({ mode: 'named', linkNames: true, stopAfterDays: 30 });
    expect(refusals(fullForm())).toEqual([]);
  });

  it('refuses two questions, sections, choices or hidden fields with one id', () => {
    expect(refusals(changed((d) => (q(d, 'qphone')['id'] = 'qname')))).toContain('id-duplicate@definition.questions.2.id');
    expect(refusals(changed((d) => (d.sections![1]!.id = 'syou')))).toContain('id-duplicate@definition.sections.1.id');
    expect(refusals(changed((d) => ((q(d, 'qroom')['choices'] as { id: string }[])[1]!.id = 'kitchen')))).toContain('id-duplicate@definition.questions.3.choices.1.id');
    expect(
      refusals(
        changed((d) => {
          d.questions.push({ ...q(d, 'qfrom'), id: 'qfrom2' });
        }),
      ),
    ).toContain('id-duplicate@definition.questions.13.param');
  });

  it('refuses an id that is not a question id', () => {
    expect(refusals(changed((d) => (q(d, 'qname')['id'] = 'name')))).toContain('invalid_format@definition.questions.0.id');
  });

  it('refuses a language listed twice, and a default it does not list', () => {
    expect(refusals(changed((d) => (d.languages = ['en-US', 'de-DE', 'en-US'])))).toContain('languages-duplicate@definition.languages');
    expect(refusals(changed((d) => (d.defaultLanguage = 'fr-FR')))).toEqual(['default-language@definition.defaultLanguage']);
  });

  it('refuses a listed language missing from any text: title, label, help, choice, section, ending', () => {
    const missing = (edit: (d: FormDefinitionInput & { questions: Record<string, unknown>[] }) => void) => refusals(changed(edit));
    expect(missing((d) => (d.title = en('Book')))).toEqual(['words-missing@definition.title.de-DE']);
    expect(missing((d) => (q(d, 'qname')['label'] = en('Name')))).toEqual(['words-missing@definition.questions.0.label.de-DE']);
    expect(missing((d) => (q(d, 'qnote')['help'] = en('Optional')))).toEqual(['words-missing@definition.questions.7.help.de-DE']);
    expect(missing((d) => ((q(d, 'qroom')['choices'] as { label: unknown }[])[0]!.label = en('Kitchen')))).toEqual(['words-missing@definition.questions.3.choices.0.label.de-DE']);
    expect(missing((d) => (d.sections![0]!.title = en('You')))).toEqual(['words-missing@definition.sections.0.title.de-DE']);
    expect(missing((d) => (d.ending = { kind: 'words', words: en('Thanks') }))).toEqual(['words-missing@definition.ending.words.de-DE']);
  });

  it('refuses a text in a language the form does not list, and an empty or blank one', () => {
    expect(refusals(changed((d) => (d.title = { ...both('Book'), 'fr-FR': 'Réserver' })))).toEqual(['words-unlisted@definition.title.fr-FR']);
    expect(refusals(changed((d) => (d.title = { 'en-US': '   ', 'de-DE': 'x' })))).toEqual(['invalid_format@definition.title.en-US']);
    expect(refusals(changed((d) => (d.title = { 'en-US': 'x', xx: 'y' } as never)))[0]).toMatch(/@definition\.title/);
  });

  it('refuses a section nobody declared, and questions out of their sections\' order', () => {
    expect(refusals(changed((d) => (q(d, 'qname')['section'] = 'snone')))).toEqual(['section-unknown@definition.questions.0.section']);
    expect(refusals(changed((d) => delete q(d, 'qnote')['section']))).toEqual(['section-order@definition.questions.7.section']);
    expect(refusals(changed((d) => (q(d, 'qfrom')['section'] = 'syou')))).toEqual(['section-order@definition.questions.12.section']);
    // Questions before the first section, and no sections at all, are fine.
    expect(refusals(changed((d) => delete q(d, 'qname')['section']))).toEqual([]);
    expect(
      refusals(
        changed((d) => {
          delete d.sections;
          for (const question of d.questions) delete question['section'];
        }),
      ),
    ).toEqual([]);
  });

  describe('"show if"', () => {
    const withShowIf = (showIf: unknown, on = 'qplan') => refusals(changed((d) => (q(d, on)['showIf'] = showIf)));

    it('takes one test of an earlier pick or number', () => {
      expect(withShowIf({ question: 'qroom', is: 'bath' })).toEqual([]);
      expect(withShowIf({ question: 'qextras', includes: 'tiles' })).toEqual([]);
      expect(withShowIf({ question: 'qsize', atLeast: 20 })).toEqual([]);
      expect(withShowIf({ question: 'qhappy', atMost: 6 })).toEqual([]);
      expect(withShowIf({ question: 'qhappy', is: 10 })).toEqual([]);
    });

    it('refuses one naming no question, itself, or a later one', () => {
      expect(withShowIf({ question: 'qnone', is: 'x' })).toEqual(['show-if-unknown@definition.questions.10.showIf.question']);
      expect(withShowIf({ question: 'qplan', is: 'x' })).toEqual(['show-if-forward@definition.questions.10.showIf.question']);
      expect(withShowIf({ question: 'qhappy', atLeast: 9 }, 'qnote')).toEqual(['show-if-forward@definition.questions.7.showIf.question']);
    });

    it('refuses one naming a question it cannot test', () => {
      expect(withShowIf({ question: 'qname', is: 'ann' })).toEqual(['show-if-kind@definition.questions.10.showIf.question']);
      expect(withShowIf({ question: 'qday', is: 'x' })).toEqual(['show-if-kind@definition.questions.10.showIf.question']);
    });

    it('refuses no test, two tests, or a test the question does not take', () => {
      expect(withShowIf({ question: 'qroom' })).toEqual(['show-if-test@definition.questions.10.showIf']);
      expect(withShowIf({ question: 'qhappy', atLeast: 1, atMost: 5 })).toEqual(['show-if-test@definition.questions.10.showIf']);
      expect(withShowIf({ question: 'qroom', includes: 'bath' })).toEqual(['show-if-test@definition.questions.10.showIf']);
      expect(withShowIf({ question: 'qextras', is: 'tiles' })).toEqual(['show-if-test@definition.questions.10.showIf']);
      expect(withShowIf({ question: 'qhappy', is: 'ten' })).toEqual(['show-if-test@definition.questions.10.showIf.is']);
    });

    it('refuses a choice its question does not have', () => {
      expect(withShowIf({ question: 'qroom', is: 'garage' })).toEqual(['show-if-choice@definition.questions.10.showIf.is']);
      expect(withShowIf({ question: 'qroom', is: 3 })).toEqual(['show-if-choice@definition.questions.10.showIf.is']);
      expect(withShowIf({ question: 'qextras', includes: 'walls' })).toEqual(['show-if-choice@definition.questions.10.showIf.includes']);
    });

    it('refuses a number its question can never hold', () => {
      expect(withShowIf({ question: 'qhappy', atLeast: 11 })).toEqual(['show-if-range@definition.questions.10.showIf.atLeast']);
      expect(withShowIf({ question: 'qhappy', is: 2.5 })).toEqual(['show-if-range@definition.questions.10.showIf.is']);
      expect(withShowIf({ question: 'qsize', atMost: 500 })).toEqual(['show-if-range@definition.questions.10.showIf.atMost']);
      expect(withShowIf({ question: 'qstars', atMost: 0 })).toEqual(['show-if-range@definition.questions.10.showIf.atMost']);
    });

    it('is never on a hidden field', () => {
      expect(withShowIf({ question: 'qroom', is: 'bath' }, 'qfrom')).toEqual(['hidden-show-if@definition.questions.12.showIf']);
    });
  });

  it('refuses a required hidden field, and a required tick', () => {
    expect(refusals(changed((d) => (q(d, 'qfrom')['required'] = true)))).toEqual(['hidden-required@definition.questions.12.required']);
    expect(refusals(changed((d) => (q(d, 'qnews')['required'] = true)))).toEqual(['tick-required@definition.questions.11.required']);
  });

  it('takes one tick per purpose, and refuses a second for the same', () => {
    const second = (purpose: string) =>
      refusals(
        changed((d) => {
          d.questions.push({ ...q(d, 'qnews'), id: 'qmore', purpose });
        }),
      );
    expect(second('surveys')).toEqual([]);
    expect(second('newsletter')).toEqual(['tick-purpose-twice@definition.questions.13.purpose']);
    // The purposes are a closed list.
    expect(second('offers')[0]).toMatch(/^invalid_value@definition\.questions\.13\.purpose/);
  });

  it('keeps a tick\'s wording version and date, and its confirmation switch', () => {
    expect(refusals(changed((d) => (q(d, 'qnews')['wordingVersion'] = 0)))).toEqual(['too_small@definition.questions.11.wordingVersion']);
    expect(refusals(changed((d) => (q(d, 'qnews')['wordingChangedAt'] = '1 October')))).toEqual(['invalid_format@definition.questions.11.wordingChangedAt']);
    expect(refusals(changed((d) => (q(d, 'qnews')['default'] = true)))).toEqual(['unrecognized_keys@definition.questions.11']);
  });

  it('takes `recommend` on one survey score only, never on a form', () => {
    expect(refusals(changed((d) => (q(d, 'qhappy')['recommend'] = true)))).toEqual(['recommend-on-form@definition.questions.8.recommend']);
    const twice = changed((d) => d.questions.push({ id: 'qnps2', kind: 'score', label: both('Again?'), recommend: true }), survey());
    expect(refusals(twice, surveySettings())).toEqual(['recommend-twice@definition.questions.5.recommend']);
  });

  it('refuses a survey with a file question or a tick', () => {
    const file = changed((d) => d.questions.push({ id: 'qfile', kind: 'file', label: both('File'), maxMb: 1, kinds: ['pdf'] }), survey());
    expect(refusals(file, surveySettings())).toEqual(['survey-file@definition.questions.5.kind']);
    const tick = changed((d) => d.questions.push({ id: 'qtick', kind: 'tick', label: both('Yes'), purpose: 'surveys', wordingVersion: 1, wordingChangedAt: '2026-01-01' }), survey());
    expect(refusals(tick, surveySettings())).toEqual(['survey-tick@definition.questions.5.kind']);
  });

  it('refuses picks, bounds, file kinds and roles that do not fit', () => {
    expect(refusals(changed((d) => (q(d, 'qextras')['max'] = 4)))).toEqual(['several-picks@definition.questions.4.max']);
    expect(refusals(changed((d) => Object.assign(q(d, 'qextras'), { min: 3, max: 2 })))).toEqual(['several-picks@definition.questions.4.max']);
    expect(refusals(changed((d) => (delete q(d, 'qextras')['max'], (q(d, 'qextras')['min'] = 4))))).toEqual(['several-picks@definition.questions.4.min']);
    expect(refusals(changed((d) => Object.assign(q(d, 'qsize'), { min: 10, max: 5 })))).toEqual(['number-bounds@definition.questions.5.min']);
    expect(refusals(changed((d) => (q(d, 'qplan')['kinds'] = ['pdf', 'pdf'])))).toEqual(['file-kinds-duplicate@definition.questions.10.kinds']);
    expect(refusals(changed((d) => (q(d, 'qplan')['maxMb'] = 11)))).toEqual(['too_big@definition.questions.10.maxMb']);
    expect(refusals(changed((d) => (q(d, 'qplan')['kinds'] = ['heic'])))[0]).toMatch(/^invalid_value@/);
    expect(refusals(changed((d) => delete q(d, 'qmail')['check']))).toEqual(['role-email-check@definition.questions.1.role']);
    expect(refusals(changed((d) => (q(d, 'qname')['maxLength'] = 501)))).toEqual(['too_big@definition.questions.0.maxLength']);
  });

  it('sends a visitor on only to an https page', () => {
    expect(refusals(survey(), surveySettings())).toEqual([]);
    for (const url of ['http://meridian.example/thanks', 'javascript:alert(1)', 'https://user:pw@meridian.example/', 'not a url']) {
      expect(refusals(changed((d) => (d.ending = { kind: 'page', url }), survey()), surveySettings())).toEqual(['ending-https@definition.ending.url']);
    }
  });

  it('holds a form to 1–60 questions and a choice question to 2–30 choices', () => {
    expect(refusals(changed((d) => (d.questions = [])))).toContain('too_small@definition.questions');
    const many = changed((d) => {
      d.questions = Array.from({ length: 61 }, (_, i) => ({ id: `q${String(i)}`, kind: 'stars', label: both('x') }));
      delete d.sections;
    });
    expect(refusals(many)).toEqual(['too_big@definition.questions']);
    expect(refusals(changed((d) => ((q(d, 'qroom')['choices'] as unknown[]).length = 1)))).toContain('too_small@definition.questions.3.choices');
  });

  it('reads with the schema alone too, with the same codes', () => {
    const parsed = formDefinitionSchema.safeParse(changed((d) => (d.defaultLanguage = 'fr-FR')));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({ message: 'default-language', path: ['defaultLanguage'] });
  });
});

describe('a form\'s settings', () => {
  const becomes = (map: Record<string, string>, source?: { column: string; value: string }) => ({ becomes: { table: 'enquiries', map, ...(source === undefined ? {} : { source }) } });

  it('takes a map of its own questions into columns of their own, with a source', () => {
    const settings = form(fullForm(), { ...becomes({ qname: 'name', qmail: 'email', qroom: 'room', qfrom: 'campaign' }, { column: 'source', value: 'Showroom form' }), tell: [{ kind: 'role', id: 'sales' }] }).settings;
    expect(settings.becomes?.source).toEqual({ column: 'source', value: 'Showroom form' });
    expect(settings.limits).toEqual({ perHour: 200, harder: false });
  });

  it('refuses a map naming no question, a file or a tick, or one column twice', () => {
    expect(refusals(fullForm(), becomes({ qnone: 'name' }))).toEqual(['becomes-question-unknown@settings.becomes.map.qnone']);
    expect(refusals(fullForm(), becomes({ qplan: 'plan', qnews: 'newsletter' }))).toEqual([
      'becomes-question-kind@settings.becomes.map.qplan',
      'becomes-question-kind@settings.becomes.map.qnews',
    ]);
    expect(refusals(fullForm(), becomes({ qname: 'name', qphone: 'name' }))).toEqual(['becomes-column-twice@settings.becomes.map.qphone']);
    expect(refusals(fullForm(), becomes({ qname: 'name' }, { column: 'name', value: 'x' }))).toEqual(['becomes-column-twice@settings.becomes.source.column']);
    expect(refusals(fullForm(), becomes({ qname: 'Name' }))).toEqual(['invalid_format@settings.becomes.map.qname']);
  });

  it('asks a survey for its settings, and refuses them on a form', () => {
    expect(refusals(survey())).toEqual(['survey-settings-missing@settings.survey']);
    expect(refusals(fullForm(), surveySettings())).toEqual(['survey-settings-on-form@settings.survey']);
    expect(refusals(survey(), surveySettings({ stopAfterDays: 366 }))).toEqual(['too_big@settings.survey.stopAfterDays']);
  });

  it('keeps no names on an anonymous survey, and makes no row from a survey that keeps none', () => {
    expect(refusals(survey(), surveySettings({ mode: 'anonymous', linkNames: true }))).toEqual(['survey-anonymous-names@settings.survey.linkNames']);
    expect(refusals(survey(), { ...surveySettings({ mode: 'anonymous', linkNames: false }), ...becomes({ qstar: 'score' }) })).toEqual(['becomes-anonymous@settings.becomes']);
    expect(refusals(survey(), { ...surveySettings({ linkNames: false }), ...becomes({ qstar: 'score' }) })).toEqual(['becomes-anonymous@settings.becomes']);
    expect(refusals(survey(), { ...surveySettings(), ...becomes({ qstar: 'score', qwhy: 'text' }) })).toEqual([]);
  });

  it('tells each person or role once, at most ten, and only on a low score of a scale', () => {
    expect(refusals(fullForm(), { tell: [{ kind: 'role', id: 'sales' }, { kind: 'role', id: 'sales' }] })).toEqual(['tell-duplicate@settings.tell.1']);
    expect(refusals(fullForm(), { tell: [{ kind: 'role', id: 'sales' }, { kind: 'person', id: 'sales' }] })).toEqual([]);
    expect(refusals(fullForm(), { tell: Array.from({ length: 11 }, (_, i) => ({ kind: 'person', id: `u${String(i)}` })) })).toEqual(['too_big@settings.tell']);
    expect(refusals(survey(), { ...surveySettings(), tellWhen: { question: 'qnps', atMost: 6 } })).toEqual([]);
    expect(refusals(survey(), { ...surveySettings(), tellWhen: { question: 'qwhy', atMost: 6 } })).toEqual(['tell-when-question@settings.tellWhen.question']);
    expect(refusals(survey(), { ...surveySettings(), tellWhen: { question: 'qstar', atMost: 6 } })).toEqual(['tell-when-range@settings.tellWhen.atMost']);
  });

  it('holds the hourly cap to 1–1000', () => {
    expect(form(fullForm(), { limits: { perHour: 1000, harder: true } }).settings.limits).toEqual({ perHour: 1000, harder: true });
    expect(refusals(fullForm(), { limits: { perHour: 1001 } })).toEqual(['too_big@settings.limits.perHour']);
  });
});

describe('which questions a visitor is shown', () => {
  it('shows a "show if" question only while its test holds, and never a hidden field', () => {
    const f = form(fullForm());
    const ids = (values: Record<string, unknown>) => visibleQuestions(f, values).map((question) => question.id);
    expect(ids({})).not.toContain('qsize');
    expect(ids({})).not.toContain('qfrom');
    expect(ids({ qroom: 'bath' })).not.toContain('qsize');
    expect(ids({ qroom: 'kitchen' })).toContain('qsize');
  });

  it('runs no chain through a question that is not shown', () => {
    const chain = changed((d) => {
      q(d, 'qnote')['showIf'] = { question: 'qsize', atLeast: 20 };
    });
    const f = form(chain);
    const ids = (values: Record<string, unknown>) => visibleQuestions(f, values).map((question) => question.id);
    expect(ids({ qroom: 'kitchen', qsize: 30 })).toContain('qnote');
    // A size kept from before the room changed shows nothing: the size is not asked.
    expect(ids({ qroom: 'bath', qsize: 30 })).not.toContain('qnote');
    expect(ids({ qroom: 'kitchen', qsize: 10 })).not.toContain('qnote');
  });

  it('tests picks, numbers and bounds as written', () => {
    const f = form(
      changed((d) => {
        q(d, 'qnote')['showIf'] = { question: 'qextras', includes: 'tiles' };
        q(d, 'qplan')['showIf'] = { question: 'qhappy', atMost: 6 };
      }),
    );
    const ids = (values: Record<string, unknown>) => visibleQuestions(f, values).map((question) => question.id);
    expect(ids({ qextras: ['tiles'] })).toContain('qnote');
    expect(ids({ qextras: ['light'] })).not.toContain('qnote');
    expect(ids({ qextras: 'tiles' })).not.toContain('qnote');
    expect(ids({ qhappy: 6 })).toContain('qplan');
    expect(ids({ qhappy: 7 })).not.toContain('qplan');
    expect(ids({ qhappy: '3' })).not.toContain('qplan');
  });
});

describe('an answer, checked', () => {
  const f = form(fullForm());
  const ctx = { language: 'en-US', today: '2026-11-01', query: { from: 'flyer' } };
  const good = () => ({
    qname: '  Dana Whitlock ',
    qmail: 'Dana@Meridian.Example',
    qphone: '+44 (20) 7946 0958',
    qroom: 'kitchen',
    qextras: ['tiles'],
    qsize: 24,
    qday: '2026-11-02',
    qnote: 'Line one\r\nLine two',
    qhappy: 9,
    qstars: 5,
    qplan: ['upl_0123456789abcdef'],
    qnews: true,
  });
  const errorsOf = (raw: unknown, context: Parameters<typeof checkAnswer>[2] = ctx, of: Form = f) => {
    const checked = checkAnswer(of, raw, context);
    return checked.ok ? {} : checked.errors;
  };
  const with_ = (over: Record<string, unknown>) => ({ ...good(), ...over });

  it('takes a good answer: cleaned, with the e-mail address and the name', () => {
    const checked = checkAnswer(f, good(), ctx);
    expect(checked).toEqual({
      ok: true,
      values: {
        qname: 'Dana Whitlock',
        qmail: 'Dana@Meridian.Example',
        qphone: '+44 (20) 7946 0958',
        qroom: 'kitchen',
        qextras: ['tiles'],
        qsize: 24,
        qday: '2026-11-02',
        qnote: 'Line one\nLine two',
        qhappy: 9,
        qstars: 5,
        qplan: ['upl_0123456789abcdef'],
        qnews: true,
        qfrom: 'flyer',
      },
      email: 'dana@meridian.example',
      name: 'Dana Whitlock',
    });
  });

  it('refuses a question the form does not have', () => {
    expect(errorsOf(with_({ qother: 'x' }))).toEqual({ qother: 'unknown-question' });
    expect(errorsOf(with_({ 'not an id': 'x' }))).toEqual({ '*': 'unknown-question' });
  });

  it('refuses an answer to a question hidden by its "show if", and takes it when shown', () => {
    expect(errorsOf(with_({ qroom: 'bath', qsize: 40 }))).toEqual({ qsize: 'not-shown' });
    const checked = checkAnswer(f, with_({ qroom: 'bath', qsize: undefined }), ctx);
    expect(checked.ok && checked.values['qsize']).toBe(undefined);
    expect(errorsOf(with_({ qroom: 'kitchen', qsize: 40 }))).toEqual({});
  });

  it('asks every shown required question, and not a hidden one', () => {
    expect(errorsOf(with_({ qname: undefined, qmail: '   ', qroom: null, qsize: undefined }))).toEqual({ qname: 'required', qmail: 'required', qroom: 'required' });
    const sized = form(changed((d) => (q(d, 'qsize')['required'] = true)));
    expect(errorsOf(with_({ qroom: 'bath', qsize: undefined }), ctx, sized)).toEqual({});
    expect(errorsOf(with_({ qroom: 'kitchen', qsize: undefined }), ctx, sized)).toEqual({ qsize: 'required' });
  });

  it('holds text to its kind, its length in characters, an address and a phone number', () => {
    expect(errorsOf(with_({ qname: 42 }))).toEqual({ qname: 'text' });
    expect(errorsOf(with_({ qname: 'x'.repeat(201) }))).toEqual({ qname: 'too-long' });
    expect(errorsOf(with_({ qname: '😀'.repeat(200) }))).toEqual({});
    expect(errorsOf(with_({ qmail: 'dana@meridian' }))).toEqual({ qmail: 'email' });
    expect(errorsOf(with_({ qmail: 'dana meridian@x.example' }))).toEqual({ qmail: 'email' });
    expect(errorsOf(with_({ qphone: '12345' }))).toEqual({ qphone: 'phone' });
    expect(errorsOf(with_({ qphone: 'call me' }))).toEqual({ qphone: 'phone' });
    expect(errorsOf(with_({ qnote: 'x'.repeat(2001) }))).toEqual({ qnote: 'too-long' });
  });

  it('takes only the question\'s own choices, once each, within the picks', () => {
    expect(errorsOf(with_({ qroom: 'garage' }))).toEqual({ qroom: 'choice' });
    expect(errorsOf(with_({ qroom: ['kitchen'] }))).toEqual({ qroom: 'choice' });
    expect(errorsOf(with_({ qextras: ['walls'] }))).toEqual({ qextras: 'choice' });
    expect(errorsOf(with_({ qextras: ['tiles', 'tiles'] }))).toEqual({ qextras: 'choice' });
    expect(errorsOf(with_({ qextras: 'tiles' }))).toEqual({ qextras: 'choice' });
    expect(errorsOf(with_({ qextras: ['tiles', 'light', 'floor'] }))).toEqual({ qextras: 'too-many' });
    const atLeastTwo = form(changed((d) => Object.assign(q(d, 'qextras'), { min: 2, max: 3 })));
    expect(errorsOf(good(), ctx, atLeastTwo)).toEqual({ qextras: 'too-few' });
  });

  it('takes a real day, from the earliest the question allows in the business\'s calendar', () => {
    expect(errorsOf(with_({ qday: '2026-02-30' }))).toEqual({ qday: 'date' });
    expect(errorsOf(with_({ qday: '2/11/2026' }))).toEqual({ qday: 'date' });
    expect(errorsOf(with_({ qday: '2026-11-01' }))).toEqual({ qday: 'too-early' });
    expect(errorsOf(with_({ qday: '2026-11-01' }), { ...ctx, today: '2026-10-31' })).toEqual({});
    const fromToday = form(changed((d) => (q(d, 'qday')['from'] = 'today')));
    expect(errorsOf(with_({ qday: '2026-11-01' }), ctx, fromToday)).toEqual({});
    expect(errorsOf(with_({ qday: '2026-10-31' }), ctx, fromToday)).toEqual({ qday: 'too-early' });
    // Tomorrow across a month's and a year's end.
    expect(errorsOf(with_({ qday: '2027-01-01' }), { ...ctx, today: '2026-12-31' })).toEqual({});
  });

  it('takes a number within its bounds, whole where asked, and no 20-character "number"', () => {
    expect(errorsOf(with_({ qsize: '24' }))).toEqual({});
    expect(errorsOf(with_({ qsize: '12345678901234567890' }))).toEqual({ qsize: 'number' });
    expect(errorsOf(with_({ qsize: '24.00000000000000000' }))).toEqual({ qsize: 'number' });
    expect(errorsOf(with_({ qsize: 12345678901234567890 }))).toEqual({ qsize: 'number' });
    expect(errorsOf(with_({ qsize: '24 m²' }))).toEqual({ qsize: 'number' });
    expect(errorsOf(with_({ qsize: 24.5 }))).toEqual({ qsize: 'whole' });
    expect(errorsOf(with_({ qsize: 0 }))).toEqual({ qsize: 'too-small' });
    expect(errorsOf(with_({ qsize: 201 }))).toEqual({ qsize: 'too-large' });
  });

  it('takes a score of 0–10 and 1–5 stars, whole', () => {
    expect(errorsOf(with_({ qhappy: 0, qstars: 1 }))).toEqual({});
    expect(errorsOf(with_({ qhappy: 11 }))).toEqual({ qhappy: 'score' });
    expect(errorsOf(with_({ qhappy: 3.5 }))).toEqual({ qhappy: 'score' });
    expect(errorsOf(with_({ qstars: 0 }))).toEqual({ qstars: 'stars' });
    expect(errorsOf(with_({ qstars: 6 }))).toEqual({ qstars: 'stars' });
  });

  it('takes a file answer as upload ids: one, or up to five where several are taken', () => {
    expect(errorsOf(with_({ qplan: 'upl_0123456789abcdef' }))).toEqual({});
    expect(errorsOf(with_({ qplan: ['../../etc/passwd'] }))).toEqual({ qplan: 'file' });
    expect(errorsOf(with_({ qplan: Array.from({ length: 6 }, (_, i) => `upl_0123456789abcde${String(i)}`) }))).toEqual({ qplan: 'file' });
    expect(errorsOf(with_({ qplan: ['upl_0123456789abcdef', 'upl_0123456789abcdef'] }))).toEqual({ qplan: 'file' });
    const one = form(changed((d) => delete q(d, 'qplan')['many']));
    expect(errorsOf(with_({ qplan: ['upl_0123456789abcdef', 'upl_0123456789abcdeg'] }), ctx, one)).toEqual({ qplan: 'file' });
  });

  it('takes a tick as true or nothing', () => {
    expect(errorsOf(with_({ qnews: undefined }))).toEqual({});
    expect(errorsOf(with_({ qnews: false }))).toEqual({ qnews: 'tick' });
    expect(errorsOf(with_({ qnews: 'yes' }))).toEqual({ qnews: 'tick' });
  });

  it('fills a hidden field from the query alone, plain and cut to 200 characters', () => {
    expect(errorsOf(with_({ qfrom: 'forged' }))).toEqual({ qfrom: 'from-query' });
    const values = (query: Record<string, string | string[]>) => {
      const checked = checkAnswer(f, good(), { ...ctx, query });
      return checked.ok ? checked.values['qfrom'] : 'refused';
    };
    expect(values({})).toBe(undefined);
    expect(values({ from: ['flyer', 'other'] })).toBe('flyer');
    expect(values({ from: 'news\u0000letter\n' })).toBe('newsletter');
    expect([...(values({ from: 'é'.repeat(300) }) as string)]).toHaveLength(200);
  });

  it('keeps every text NFC, without control characters, a long one with its line breaks', () => {
    expect(cleanText('Rémy\u0007 \u0000')).toBe('Rémy');
    expect(cleanText('a\tb\nc')).toBe('abc');
    expect(cleanText('a\r\nb\rc\u0085', true)).toBe('a\nb\nc');
    expect(cleanText('x\uD800y')).toBe('xy');
    const checked = checkAnswer(f, with_({ qname: 'Zoë‮x' }), ctx);
    expect(checked.ok && checked.values['qname']).toBe('Zoë‮x');
  });

  it('refuses an answer that is not an object, or in a language the form does not speak', () => {
    expect(errorsOf(['x'])).toEqual({ '*': 'shape' });
    expect(errorsOf(null)).toEqual({ '*': 'shape' });
    expect(errorsOf(good(), { ...ctx, language: 'fr-FR' })).toEqual({ '*': 'language' });
  });

  it('keeps no address and no name for a survey that keeps no names', () => {
    const answer = { qnps: 9, qmail: 'a@b.example', qname: 'Ann' };
    const named = checkAnswer(form(survey(), surveySettings()), answer, ctx);
    expect(named.ok && [named.email, named.name]).toEqual(['a@b.example', 'Ann']);
    for (const settings of [surveySettings({ linkNames: false }), surveySettings({ mode: 'anonymous', linkNames: false })]) {
      const checked = checkAnswer(form(survey(), settings), answer, ctx);
      expect(checked.ok && [checked.email, checked.name]).toEqual([null, null]);
    }
  });

  it('has an address and a phone rule of its own', () => {
    for (const good of ['a@b.co', 'first.last+tag@sub.example.org', 'ünïcode@exämple.de']) expect(isEmailAddress(good)).toBe(true);
    for (const bad of ['a@b', '@b.co', 'a@@b.co', 'a b@c.co', '<a>@b.co', `${'a'.repeat(65)}@b.co`, `a@${'b'.repeat(250)}.co`, 'a@b.c0']) expect(isEmailAddress(bad)).toBe(false);
    for (const good of ['+49 30 1234567', '(415) 555-0132', '020 7946 0958']) expect(isPhoneNumber(good)).toBe(true);
    for (const bad of ['555-01', '+1 234 567 890 123 456', '12ab34567']) expect(isPhoneNumber(bad)).toBe(false);
  });
});

describe('the results', () => {
  /** Comp E4.11: 23 answers, 19 in English and 4 in German. */
  function compAnswers() {
    const scores = [...[2, 4, 5, 6], ...[7, 7, 8, 8, 8, 7], ...Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? 10 : 9))];
    const stars = [...Array.from({ length: 13 }, () => 5), ...Array.from({ length: 7 }, () => 4), 3, 3, 2];
    return scores.map((score, i) => ({
      language: i < 19 ? 'en-US' : 'de-DE',
      values: { qnps: score, qstar: stars[i], ...(score <= 6 ? { qwhy: 'Faster replies' } : {}) },
    }));
  }

  it('counts the comp\'s survey: recommend score +39, stars 4.4, English 19 and Deutsch 4', () => {
    const summary = summarise(form(survey(), surveySettings()), compAnswers());
    expect(summary.total).toBe(23);
    expect(summary.byLanguage).toEqual({ 'en-US': 19, 'de-DE': 4 });
    expect(summary.recommendScore).toBe(39);
    expect(summary.questions['qnps']).toEqual({
      kind: 'score',
      answered: 23,
      counts: [0, 0, 1, 0, 1, 1, 1, 3, 3, 6, 7],
      promoters: 13,
      passives: 6,
      detractors: 4,
      recommendScore: 39,
    });
    expect(summary.questions['qstar']).toEqual({ kind: 'stars', answered: 23, counts: [0, 1, 2, 7, 13], average: 4.4 });
    expect(summary.questions['qwhy']).toEqual({ kind: 'long', answered: 4 });
    expect(summary.questions['qmail']).toEqual({ kind: 'short', answered: 0 });
  });

  it('keeps the recommend score\'s sign, and never says -0', () => {
    expect(recommendScoreOf([3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0])).toBe(-50);
    expect(recommendScoreOf([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBe(0);
    expect(recommendScoreOf(Array.from({ length: 11 }, () => 0))).toBe(null);
  });

  it('counts choices, and leaves out what no longer fits its question', () => {
    const f = form(fullForm());
    const summary = summarise(f, [
      { language: 'en-US', values: { qroom: 'kitchen', qextras: ['tiles', 'light'], qhappy: 12, qstars: 'five' } },
      { language: 'de-DE', values: { qroom: 'bath', qextras: ['tiles', 'gone'] } },
      { language: 'xx-XX', values: { qroom: 'garage', qextras: 'tiles' } },
    ]);
    expect(summary.questions['qroom']).toEqual({ kind: 'one', answered: 2, choices: { kitchen: 1, bath: 1 } });
    expect(summary.questions['qextras']).toEqual({ kind: 'several', answered: 2, choices: { light: 1, floor: 0, tiles: 2 } });
    expect(summary.questions['qhappy']).toMatchObject({ answered: 0, recommendScore: null });
    expect(summary.questions['qstars']).toMatchObject({ answered: 0, average: null });
    expect(summary.byLanguage).toEqual({ 'en-US': 1, 'de-DE': 1 });
    expect(summary.recommendScore).toBe(null);
  });
});
