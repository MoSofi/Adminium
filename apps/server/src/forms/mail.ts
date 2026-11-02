// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAIL A STRANGER CAUSES, AND WHO IS TOLD OF AN ANSWER.
 *
 * A form is filled by someone nobody signed in for, so whatever it makes go
 * out is held to these rules:
 *  - nothing goes while this server's public address (`system.publicOrigin`)
 *    is unset, or no mail server is set up ({@link formsMailBlocked}, which
 *    the form's builder reads to say why); the answer is kept all the same;
 *  - every link is written on the public address, never on the host a
 *    request came to: a forged `Host` changes no link;
 *  - the sign-up confirmation is service mail in the owner's fixed words (the
 *    built-in `sign-up-confirm`, reworded per language in Email templates);
 *    the one word the stranger typed in it is their first name, and only
 *    when it passes the name rule; at most one a day goes to one address,
 *    across every form, so fifty sign-ups for one address send one;
 *  - staff are told in the app (a bell) and by e-mail, with the answers as
 *    plain text: a web address typed in an answer is never made a link.
 *    Staff mail has no class and nothing on the do-not-email list stops it;
 *  - a cap that trips tells the people the form tells, else those who may
 *    change the form, at most once an hour per form.
 */
import { createHmac } from 'node:crypto';

import type { FormQuestion, FormTickPurpose } from '@adminium/add-on-contracts/forms';
import { rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { signUpConfirmLines, translatorForLocale } from '../email/builtins.js';
import { storedPublicOrigin } from '../email/door-reach.js';
import { postalAddressOf } from '../email/sender/marketing-settings.js';
import { enqueueEmail, isEmailConfigured, SIGN_UP_CONFIRM_TEMPLATE_KEY, type EmailLogger } from '../email/send.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { businessZone, notify, type NotificationPublisher } from '../notifications/notify.js';
import { HOUR_MS, linkFreeText, mailboxOf, NAME_RULE } from '../public-api/anonymous-caps.js';
import { DAY_MS } from '../public-api/claim-code.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { businessName } from '../privacy/business.js';
import type { FormCap, FormCaps } from './caps.js';
import { CONFIRM_LINK_DAYS, confirmUrl } from './confirm-token.js';

/** Why mail a stranger causes is not sent; null when it is. */
export type FormsMailBlock = 'no-public-origin' | 'no-mail-server';

/** The notices' kinds (what a person's notification settings switch). */
export const FORMS_ANSWER_NOTICE = 'forms.answer';
export const FORMS_LIMIT_NOTICE = 'forms.limit';

/** Whether mail a stranger causes can go now, and why not. */
export async function formsMailBlocked(meta: MetaDb, secret: string): Promise<FormsMailBlock | null> {
  if ((await storedPublicOrigin(meta)) === null) return 'no-public-origin';
  if (!(await isEmailConfigured(meta, secret))) return 'no-mail-server';
  return null;
}

/** The first word of a typed name, when it passes the name rule; null otherwise. */
export function firstNameOf(name: string | null): string | null {
  if (name === null) return null;
  const first = name.trim().split(/\s+/u)[0] ?? '';
  return first !== '' && linkFreeText(first, NAME_RULE) ? first : null;
}

/** The language a mail to a stranger is written in: the answer's (`de-DE` → `de_DE`). */
const localeOf = (language: string): string => language.replace('-', '_');

export interface ConfirmMailInput {
  meta: MetaDb;
  secret: string;
  caps: FormCaps;
  /** The caps' key: an address is counted under its keyed hash. */
  capKey: Buffer;
  to: string;
  language: string;
  name: string | null;
  purpose: FormTickPurpose;
  token: string;
  at: number;
  logger?: EmailLogger | undefined;
}

/**
 * The sign-up confirmation (see the header). Answers whether it was queued:
 * `blocked` (no public address, no mail server), `held` (one went to this
 * address in the last day), or `sent`.
 */
export async function sendConfirmMail(input: ConfirmMailInput): Promise<'sent' | 'held' | 'blocked'> {
  const { meta } = input;
  if ((await formsMailBlocked(meta, input.secret)) !== null) return 'blocked';
  const origin = await storedPublicOrigin(meta);
  if (origin === null) return 'blocked';
  // One a day per address, across every form: the anonymous caps' own spelling of a mailbox.
  const subject = `confirm-mail:${createHmac('sha256', input.capKey).update(mailboxOf(input.to.trim().toLowerCase())).digest('hex')}`;
  if (!(await input.caps.once(subject, 'confirm-mail', 1, DAY_MS, input.at))) return 'held';
  const locale = localeOf(input.language);
  const { t } = await translatorForLocale(meta, locale);
  const business = await businessName(meta, { origin });
  const lines = signUpConfirmLines(t, { firstName: firstNameOf(input.name), purpose: input.purpose, business });
  const queued = await enqueueEmail(
    { meta, secret: input.secret, ...(input.logger === undefined ? {} : { logger: input.logger }) },
    {
      to: input.to,
      templateKey: SIGN_UP_CONFIRM_TEMPLATE_KEY,
      locale,
      mailClass: 'service',
      vars: { business, greeting: lines.greeting, purposeLine: lines.purposeLine, link: confirmUrl(origin, input.token), postal: (await postalAddressOf(meta)) ?? business },
      counts: { days: CONFIRM_LINK_DAYS },
    },
  );
  return queued === null ? 'blocked' : 'sent';
}

/**
 * A web address in a stranger's words, made plain: a mail program makes a
 * link of `https://…`, `www.…` or `name.tld/…` written in a mail, so a
 * zero-width space goes after its `://` and each of its dots. It reads the
 * same and is no link.
 */
export function unlinked(text: string): string {
  return text.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"]*|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}(?:\/[^\s<>"]*)?/giu, (address) =>
    address.replace(/:\/\//g, ':​//').replace(/\./g, '.​'),
  );
}

/** One question's answer as plain text, in a language the form is written in. */
function answerText(question: FormQuestion, value: unknown, language: string): string {
  const words = (all: Readonly<Record<string, string>>): string => all[language] ?? Object.values(all)[0] ?? '';
  if (question.kind === 'one') return words(question.choices.find((choice) => choice.id === value)?.label ?? {}) || String(value);
  if (question.kind === 'several' && Array.isArray(value)) return value.map((id) => words(question.choices.find((choice) => choice.id === id)?.label ?? {}) || String(id)).join(', ');
  if (question.kind === 'tick') return '✓';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

/** An answer as staff read it: a line per question answered, its label then its answer, every web address made plain. */
export function answerLines(questions: readonly FormQuestion[], values: Readonly<Record<string, unknown>>, language: string): string {
  const lines: string[] = [];
  for (const question of questions) {
    const value = values[question.id];
    if (value === undefined || question.kind === 'file') continue;
    const label = question.label[language as keyof typeof question.label] ?? Object.values(question.label)[0] ?? question.id;
    lines.push(`${label}: ${answerText(question, value, language)}`);
  }
  return unlinked(lines.join('\n'));
}

/** Who a form tells: its people, and the holders of its roles, who sign in. */
export async function toldBy(meta: MetaDb, tell: readonly { kind: 'role' | 'person'; id: string }[]): Promise<string[]> {
  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const ids = new Set<string>();
  for (const one of tell) {
    if (one.kind === 'person') ids.add(one.id);
    else {
      const role = (await roles.findById(one.id)) ?? (await roles.findBySlug(one.id));
      if (role !== null) for (const userId of await roles.usersInRole(role.id)) ids.add(userId);
    }
  }
  const out: string[] = [];
  for (const id of ids) if ((await users.findById(id))?.status === 'active') out.push(id);
  return out.sort();
}

/** The people who hold `permission`: whom a cap's alert goes to when the form tells nobody. */
export async function holdersOf(meta: MetaDb, permission: string): Promise<string[]> {
  const out: string[] = [];
  for (const user of await usersRepo(meta).list()) {
    if (user.status !== 'active') continue;
    if (permissionSetAllows(await resolvePermissionSet(meta, { kind: 'user', id: user.id } as never), permission)) out.push(user.id);
  }
  return out.sort();
}

export interface StaffNoticeInput {
  meta: MetaDb;
  hub?: NotificationPublisher | undefined;
  /** The people told. */
  people: readonly string[];
  /** The form's name, in its own languages. */
  formName: Readonly<Record<string, string>>;
  questions: readonly FormQuestion[];
  values: Readonly<Record<string, unknown>>;
  /** The language the answer was written in. */
  language: string;
  /** Where the answer opens in the forms add-on's pages. */
  actionUrl: string;
  /** Whether the e-mail leg may go (no public address: the bell alone). */
  mail: boolean;
  at: number;
  logger?: EmailLogger | undefined;
}

/** "A new answer": a bell and an e-mail to each person told, in their own language (best effort: an answer is kept whatever this does). */
export async function tellStaff(input: StaffNoticeInput): Promise<number> {
  let told = 0;
  for (const userId of input.people) {
    try {
      const i18n = await translatorFor(input.meta, userId);
      const tag = String(i18n.language || 'en-US').replace('_', '-');
      const name = input.formName[tag] ?? input.formName[input.language] ?? Object.values(input.formName)[0] ?? '';
      await notify(
        input.meta,
        {
          userId,
          kind: FORMS_ANSWER_NOTICE,
          title: i18n.t('email:forms.answerTitle', { form: name, defaultValue: 'New answer: {form}' }),
          body: answerLines(input.questions, input.values, input.language),
          actionUrl: input.actionUrl,
        },
        { at: input.at, email: input.mail, ...(input.hub === undefined ? {} : { hub: input.hub }), ...(input.logger === undefined ? {} : { logger: input.logger }) },
      );
      told += 1;
    } catch (error) {
      input.logger?.warn({ err: error, userId }, 'a form answer notice could not be written');
    }
  }
  return told;
}

export interface LimitAlertInput {
  meta: MetaDb;
  caps: FormCaps;
  hub?: NotificationPublisher | undefined;
  /** Whom the form tells; when nobody, those who may change the form (`fallback`). */
  people: readonly string[];
  fallback: () => Promise<string[]>;
  form: { addOn: string; id: string; perHour: number; name: Readonly<Record<string, string>> };
  cap: FormCap;
  /** Where the form's Limits open. */
  actionUrl: string;
  /** When the cap opens again. */
  reopensAt: number;
  mail: boolean;
  at: number;
  logger?: EmailLogger | undefined;
}

/** "A form hit its limit": once an hour per form, saying which cap and offering a higher one or a harder check. Answers how many were told. */
export async function alertLimit(input: LimitAlertInput): Promise<number> {
  const { meta } = input;
  try {
    if (!(await input.caps.once(`form-alert:${input.form.addOn}:${input.form.id}`.slice(0, 191), 'alert', 1, HOUR_MS, input.at))) return 0;
    const people = input.people.length > 0 ? input.people : await input.fallback();
    let told = 0;
    for (const userId of people) {
      const i18n = await translatorFor(meta, userId);
      const tag = String(i18n.language || 'en-US').replace('_', '-');
      const name = input.form.name[tag] ?? Object.values(input.form.name)[0] ?? '';
      const time = new Intl.DateTimeFormat(`${tag}-u-nu-latn`, { hour: '2-digit', minute: '2-digit', timeZone: await businessZone(meta) }).format(new Date(input.reopensAt));
      const which =
        input.cap === 'form'
          ? i18n.t('email:forms.limitForm', { form: name, n: input.form.perHour, defaultValue: '{form} took as many answers as it takes in an hour ({n}).' })
          : input.cap === 'address'
            ? i18n.t('email:forms.limitAddress', { form: name, defaultValue: 'One network address sent {form} as many answers as one address may in an hour.' })
            : input.cap === 'email'
              ? i18n.t('email:forms.limitEmail', { form: name, defaultValue: 'One e-mail address was given on {form} as many times as it may be in a day.' })
              : i18n.t('email:forms.limitEntry', { form: name, defaultValue: 'The table {form} adds to took as many new rows from strangers as its app allows.' });
      await notify(
        meta,
        {
          userId,
          kind: FORMS_LIMIT_NOTICE,
          title: i18n.t('email:forms.limitTitle', { defaultValue: 'A form hit its limit' }),
          body: `${which} ${i18n.t('email:forms.limitBody', { time, defaultValue: 'It opens again at {time}. Raise the limit or use a harder check in the form’s Limits.' })}`,
          actionUrl: input.actionUrl,
        },
        { at: input.at, email: input.mail, ...(input.hub === undefined ? {} : { hub: input.hub }), ...(input.logger === undefined ? {} : { logger: input.logger }) },
      );
      told += 1;
    }
    return told;
  } catch (error) {
    input.logger?.warn({ err: error, form: input.form.id }, 'a form limit alert could not be written');
    return 0;
  }
}
