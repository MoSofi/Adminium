// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A STRANGER IS SHOWN OF A FORM: the published definition in one of its
 * languages, and who the business is.
 *
 * The page draws a form from this and checks answers with the same forms
 * vocabulary the server checks with, so the definition goes out whole, in a
 * single language: every text of it holds that language's version only, and
 * `languages`/`defaultLanguage` name that one language, so it still parses
 * with `formDefinitionSchema`. The languages the form is written in go
 * beside it, for the page's language menu.
 *
 * The settings never go out: what an answer becomes (`becomes`), who is told
 * (`tell`, `tellWhen`), the hourly cap. A survey says only whether it keeps
 * names, for the page's "not linked to your name" note.
 */
import { FORM_LANGUAGES, keepsNames, type Form, type FormDefinition, type FormLanguage, type Words } from '@adminium/add-on-contracts/forms';
import { connectionTenantConfig, isHttpsPageUrl, paymentSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { storedPublicOrigin } from '../email/door-reach.js';
import { businessName, privacyNoticeOf } from '../privacy/business.js';
import { PAY_PAGE_DOC, payPageSchema } from '../routes/payments/ways.js';

/** Who the business is, as every page a stranger sees says it. */
export interface StrangerBusiness {
  /** The one name every page a stranger sees uses (`privacy/business.ts`). */
  name: string;
  /** The controller's own name, from the privacy notice settings; null while not set. */
  legalName: string | null;
  /** Where to write with a question: the pay page's contact address. */
  email: string | null;
  /** The privacy notice's address (https only). */
  privacyNotice: string | null;
  /** Whether the pay page's logo is set (served at `/x/api/logo`). */
  hasLogo: boolean;
}

/** The business block and the install's accent: what every answer of the door carries. */
export async function strangerBusiness(meta: MetaDb): Promise<{ business: StrangerBusiness; accent: string }> {
  const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema).catch(() => null);
  const [name, notice, accent] = await Promise.all([
    businessName(meta, { origin: await storedPublicOrigin(meta) }),
    privacyNoticeOf(meta),
    settingsRepo(meta).get('appearance.accent'),
  ]);
  return {
    business: {
      name,
      legalName: notice.businessName,
      email: page?.contactEmail ?? null,
      privacyNotice: notice.noticeUrl !== null && isHttpsPageUrl(notice.noticeUrl) ? notice.noticeUrl : null,
      hasLogo: (page?.logoFileId ?? null) !== null,
    },
    accent: typeof accent === 'string' ? accent : 'indigo',
  };
}

/**
 * The language a form is drawn in: the one asked for in the address
 * (`?lang=`), else the reader's browser's first that the form is written in
 * (an exact tag, then the same language in another region), else the form's
 * default. Only a language the form lists is ever picked.
 */
export function formLanguageFor(definition: Pick<FormDefinition, 'languages' | 'defaultLanguage'>, asked: unknown, acceptLanguage: string | undefined): FormLanguage {
  const listed = definition.languages;
  if (typeof asked === 'string') {
    const exact = listed.find((language) => language.toLowerCase() === asked.toLowerCase());
    if (exact !== undefined) return exact;
  }
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q.slice(2)) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = listed.find((language) => language.toLowerCase() === tag);
    if (exact !== undefined) return exact;
    const near = listed.find((language) => language.toLowerCase().split('-')[0] === tag.split('-')[0]);
    if (near !== undefined) return near;
  }
  return definition.defaultLanguage;
}

/**
 * Today, as the business counts days (`yyyy-mm-dd` in its database's time
 * zone, else UTC): what a date question's "from today" and "from tomorrow"
 * count from, on the page and in the answer's check alike.
 */
export async function businessToday(meta: MetaDb, connectionId: string, now: number): Promise<string> {
  const zone = (await connectionTenantConfig(meta, connectionId))?.timezone ?? 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    // A zone this runtime does not know: the day in UTC.
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** One text, in one language only. */
function only(words: Words, language: FormLanguage): Words {
  const text = words[language];
  return text === undefined ? {} : { [language]: text };
}

/** The definition with every text in one language, and that language its only one. */
export function definitionIn(definition: FormDefinition, language: FormLanguage): FormDefinition {
  return {
    ...definition,
    languages: [language],
    defaultLanguage: language,
    title: only(definition.title, language),
    ...(definition.intro === undefined ? {} : { intro: only(definition.intro, language) }),
    ...(definition.sections === undefined ? {} : { sections: definition.sections.map((section) => ({ ...section, title: only(section.title, language) })) }),
    questions: definition.questions.map((question) => {
      const out = { ...question, label: only(question.label, language), ...(question.help === undefined ? {} : { help: only(question.help, language) }) };
      if (out.kind === 'one' || out.kind === 'several') return { ...out, choices: out.choices.map((choice) => ({ ...choice, label: only(choice.label, language) })) };
      return out;
    }) as FormDefinition['questions'],
    ending: definition.ending.kind === 'words' ? { kind: 'words', words: only(definition.ending.words, language) } : definition.ending,
  };
}

/** The form as a stranger is shown it. */
export interface StrangerForm {
  kind: FormDefinition['kind'];
  /** The language it is drawn in, and every language it is written in (the menu's, in the product's order). */
  language: FormLanguage;
  languages: FormLanguage[];
  definition: FormDefinition;
  /** A survey that keeps no names: the page says the answers are not linked to a name. */
  anonymous: boolean;
}

export function strangerForm(form: Form, language: FormLanguage): StrangerForm {
  const listed = new Set(form.definition.languages);
  return {
    kind: form.definition.kind,
    language,
    languages: FORM_LANGUAGES.filter((one) => listed.has(one)),
    definition: definitionIn(form.definition, language),
    anonymous: form.definition.kind === 'survey' && !keepsNames(form.settings),
  };
}
