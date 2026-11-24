// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S TEXT MESSAGES, AS ITS MANIFEST DECLARES THEM.
 *
 * A text is a template of its own (`textTemplates`), never an email template
 * with fields left empty, so nothing about an installed email changes. An
 * outbox kind is sent as a text when `outbox.channels` says `sms`; one kind has
 * one channel, and "email and text" is two kinds.
 *
 * A text is not private and a phone number gets reassigned, so nothing that
 * opens a door travels by SMS: no sign-in link, no minted link, no code, no QR
 * value. No template asks for a "YES" either, because a provider reads that
 * reply as an opt-in. This file holds that check once: the validator asks it at
 * install and on save, and the send path asks it again for every message.
 *
 * Text consent is its own answer. A kind sent as a text names no mail purpose,
 * so it never inherits a service mail's stop link, and a public form's box for
 * texts (`publicAccess[].textConsent`) is a separate, unticked box that no
 * booking or purchase can depend on.
 *
 * Pure.
 */
import { z } from 'zod';

import { GROUPED_FORM, isCodeColumn, REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, SURVEY_LINK_VARIABLE, type Outbox } from './outbox.js';
import type { People, PublicConsent, PublicTextConsent } from './people.js';
import { placeholdersIn } from './placeholders.js';
import { personalColumn } from './public-access.js';
import { bcp47TagSchema, textOrLabels, type ReferenceIssue, type TableIndex } from './refs.js';

/** The most characters a text template's words may hold, before anything is filled. */
export const TEXT_TEMPLATE_BODY_MAX = 1000;
/** The most text templates one manifest declares. */
export const TEXT_TEMPLATES_MAX = 32;

/** The names a template prints a person's minted links under, beyond the outbox's own. */
export const OBJECT_LINK_VARIABLE = 'object_link';
export const CALENDAR_GOOGLE_VARIABLE = 'calendarGoogle';
export const CALENDAR_OUTLOOK_VARIABLE = 'calendarOutlook';

/**
 * Whether staff read the texts customers send back (`textReplies`). `off` is for
 * an app whose customers may write what nobody should hold in a shared inbox,
 * such as a clinic's patients writing symptoms: nothing is kept, and the sender
 * gets one fixed answer saying the number is not read.
 */
export const TEXT_REPLIES = ['on', 'off'] as const;
export type TextReplies = (typeof TEXT_REPLIES)[number];

/** Links the engine mints for one person. */
const MINTED_LINKS: ReadonlySet<string> = new Set(['signInLink', SURVEY_LINK_VARIABLE, REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, OBJECT_LINK_VARIABLE, CALENDAR_GOOGLE_VARIABLE, CALENDAR_OUTLOOK_VARIABLE]);

const CREDENTIAL_NAME = /(?:^|[_-])(?:code|otp|pin|passcode|password|passwd|token|secret)$|[a-z0-9](?:Code|Otp|Pin|Passcode|Password|Passwd|Token|Secret)$/;
/** Codes that open nothing. */
const HARMLESS_CODE = /(?:^|[_-])(?:postal|post|zip|country|currency|area|calling|dial|language|locale|tax|product|sku|item|colou?r)[_-]?code$/i;

/** Whether a placeholder reads something that must not leave by text. `codeNames` are the columns the app declares as codes. */
export function readsCredential(name: string, codeNames: readonly string[] = []): boolean {
  if (MINTED_LINKS.has(name)) return true;
  if (codeNames.some((code) => name === code || name.startsWith(`${code}.`))) return true;
  const last = name.slice(name.lastIndexOf('.') + 1);
  if (last === 'qr' || last === GROUPED_FORM) return true;
  return CREDENTIAL_NAME.test(last) && !HARMLESS_CODE.test(last);
}

/** "Reply YES", in the eight languages a template can be written in. */
const ASKS_FOR_YES: readonly RegExp[] = [
  /\b(?:reply|respond|answer|text|send)\b[^.!?\n]{0,24}\byes\b/iu,
  /\b(?:antworte|antworten)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:svar|send)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:r[ée]ponds|r[ée]pondez|envoyez)\b[^.!?\n]{0,24}\boui\b/iu,
  /\bodpov[eě]z(?:te)?\b[^.!?\n]{0,24}\bano\b/iu,
  /(?:رد|ردّ|أرسل|ارسل)[^.!?؟\n]{0,24}نعم/u,
  /(?:回复|回覆)[^。！？\n]{0,12}(?:是|好)/u,
];

export function asksForYes(text: string): boolean {
  return ASKS_FOR_YES.some((pattern) => pattern.test(text));
}

/** Why a text template cannot be sent, whatever fills it. */
export type TextTemplateRefusal = 'template-empty' | 'credential-in-template' | 'asks-for-yes';
export type TextTemplateVerdict = { ok: true } | { ok: false; reason: TextTemplateRefusal; names?: string[] };

export function checkTextTemplate(template: string, codeNames: readonly string[] = []): TextTemplateVerdict {
  if (typeof template !== 'string' || template.trim() === '') return { ok: false, reason: 'template-empty' };
  const names = placeholdersIn(template).filter((one) => readsCredential(one.name, codeNames)).map((one) => one.name);
  if (names.length > 0) return { ok: false, reason: 'credential-in-template', names: [...new Set(names)] };
  if (asksForYes(template)) return { ok: false, reason: 'asks-for-yes' };
  return { ok: true };
}

/** The placeholders of `body` that read a column holding a code, whatever the column is called. */
export function codeNamesIn(body: string, codeColumns: ReadonlySet<string>): string[] {
  const names = placeholdersIn(body).map((one) => one.name);
  return [...new Set(names.filter((name) => {
    const parts = name.split('.');
    return (parts.length === 1 ? parts : parts.slice(1)).some((part) => codeColumns.has(part));
  }))];
}

/** One language of a text: its words, with placeholders. */
const textContentSchema = z.object({ body: z.string().min(1).max(TEXT_TEMPLATE_BODY_MAX) }).strict();

export const textTemplateSchema = z
  .object({
    /** `<app key>-<name>`: an app names only its own templates. */
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key is kebab-case'),
    name: textOrLabels,
    /** The text in each language it ships, US English always among them. */
    locales: z
      .record(bcp47TagSchema, textContentSchema)
      .refine((locales) => locales['en-US'] !== undefined, { message: 'a template includes en-US' }),
  })
  .strict();
export type TextTemplate = z.infer<typeof textTemplateSchema>;

/** Whether an outbox kind is sent as a text. */
export function isTextKind(outbox: Pick<Outbox, 'channels'> | undefined, kind: string): boolean {
  return outbox?.channels?.[kind] === 'sms';
}

/** Whether a customer is waiting for this text right now, so it may go outside the sending hours. */
export function isWaitingKind(outbox: Pick<Outbox, 'waiting'> | undefined, kind: string): boolean {
  return (outbox?.waiting ?? []).includes(kind);
}

interface TextColumn {
  ref: string;
  type: string;
  nullable?: boolean | undefined;
  default?: unknown;
  rules?: Record<string, unknown> | undefined;
}
type TextTable = { ref: string; columns: readonly TextColumn[] };

const REFUSALS: Readonly<Record<TextTemplateRefusal, string>> = {
  'template-empty': 'a text says something',
  'credential-in-template': 'a text is not private, so it carries no sign-in link, minted link, code or QR value',
  'asks-for-yes': 'a text never asks for a "YES": a provider reads that reply as an opt-in',
};

/** Everything wrong with the words of the app's text templates. */
export function textTemplateIssues(m: {
  key: string;
  textTemplates?: readonly TextTemplate[] | undefined;
  emailTemplates?: readonly { key: string }[] | undefined;
  requiredSchema?: { tables: readonly TextTable[] } | undefined;
}): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const codeColumns = new Set((m.requiredSchema?.tables ?? []).flatMap((table) => table.columns.filter((column) => isCodeColumn(column as never)).map((column) => column.ref)));
  const emails = new Set((m.emailTemplates ?? []).map((template) => template.key));
  const seen = new Set<string>();
  (m.textTemplates ?? []).forEach((template, t) => {
    const at = (...rest: (string | number)[]) => ['textTemplates', t, ...rest];
    if (!template.key.startsWith(`${m.key}-`)) out.push({ path: at('key'), message: `an app's template key starts with "${m.key}-"` });
    if (seen.has(template.key)) out.push({ path: at('key'), message: `"${template.key}" is declared twice` });
    if (emails.has(template.key)) out.push({ path: at('key'), message: `"${template.key}" is also an email template: a kind names one or the other, so give the text a key of its own` });
    seen.add(template.key);
    for (const [locale, content] of Object.entries(template.locales)) {
      const here = at('locales', locale, 'body');
      const verdict = checkTextTemplate(content.body, codeNamesIn(content.body, codeColumns));
      if (!verdict.ok) out.push({ path: here, message: verdict.names === undefined ? REFUSALS[verdict.reason] : `${REFUSALS[verdict.reason]}: ${verdict.names.map((name) => `{{${name}}}`).join(', ')}` });
      const placeholders = placeholdersIn(content.body);
      for (const name of new Set(placeholders.map((one) => one.name))) {
        if (name.startsWith('row.')) out.push({ path: here, message: `{{${name}}}: a text lists no rows` });
      }
      let rest = '';
      let cursor = 0;
      for (const one of placeholders) {
        rest += content.body.slice(cursor, one.at);
        cursor = one.at + one.whole.length;
      }
      rest += content.body.slice(cursor);
      if (/\{\{|\}\}/.test(rest)) out.push({ path: here, message: 'a broken placeholder would be sent as it stands: write {{name}}' });
    }
  });
  return out;
}

/** Everything wrong with how the outbox sends texts. An outbox that names no text word has nothing here. */
export function outboxTextIssues(
  m: {
    kind?: string | undefined;
    outbox?: Outbox | undefined;
    textTemplates?: readonly TextTemplate[] | undefined;
    people?: People | undefined;
    requiredSchema?: { tables: readonly TextTable[] } | undefined;
  },
  index: TableIndex,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const box = m.outbox;
  if (box === undefined) return out;
  const at = (...rest: (string | number)[]) => ['outbox', ...rest];
  const r = box.recipient;
  if (m.kind === 'add-on') {
    for (const [word, used] of [['channels', box.channels], ['waiting', box.waiting], ['recipient', r.phone ?? r.fallback?.phone]] as const) {
      if (used !== undefined) out.push({ path: at(word), message: 'texts are an app\'s: an add-on\'s outbox sends email' });
    }
    return out;
  }

  /** A text column holding a phone number, which the install must treat as personal data. */
  const phoneColumn = (table: string | undefined, ref: string, path: (string | number)[]) => {
    if (table === undefined) return;
    const found = index.column(table, ref);
    if (found === undefined) {
      out.push({ path, message: `"${table}" has no column "${ref}"` });
      return;
    }
    if (found.type !== 'text') {
      out.push({ path, message: `"${table}.${ref}" must be a text column: a number keeps its "+"` });
      return;
    }
    const declared = m.requiredSchema?.tables.find((candidate) => candidate.ref === table);
    if (declared !== undefined && personalColumn(declared as never, ref) === null) {
      out.push({ path, message: `"${table}.${ref}" holds a phone number: mark it personal ("rules": { "personal": true })` });
    }
  };
  if (r.phone !== undefined) {
    phoneColumn(r.table, r.phone, at('recipient', 'phone'));
    const entry = (m.people ?? []).find((candidate) => candidate.table === r.table);
    if (entry !== undefined && entry.phone !== r.phone) {
      out.push({ path: ['people', (m.people ?? []).indexOf(entry), 'phone'], message: `the outbox texts "${r.table}.${r.phone}" (outbox.recipient.phone), so the people of "${r.table}" have that number: name it here` });
    }
  }
  if (r.fallback?.phone !== undefined) {
    if (r.phone === undefined) out.push({ path: at('recipient', 'fallback', 'phone'), message: 'a fallback number stands in for the person\'s own: name it too (outbox.recipient.phone)' });
    phoneColumn(index.column(box.table, r.fallback.via)?.references, r.fallback.phone, at('recipient', 'fallback', 'phone'));
  }

  for (const kind of Object.keys(box.channels ?? {})) {
    if (box.kinds[kind] === undefined) out.push({ path: at('channels', kind), message: `"${kind}" is not one of the outbox's kinds` });
  }
  const texts = new Set((m.textTemplates ?? []).map((template) => template.key));
  for (const [kind, template] of Object.entries(box.kinds)) {
    if (!isTextKind(box, kind)) continue;
    if (!texts.has(template)) out.push({ path: at('kinds', kind), message: `"${template}" is not one of the app's textTemplates` });
    if (r.phone === undefined) out.push({ path: at('channels', kind), message: `"${kind}" is sent as a text: name the column that holds the person's number (outbox.recipient.phone)` });
    // A purpose is a mail's: it brings a stop link and reads an e-mail answer, and neither belongs to a text.
    if (box.purposes?.[kind] !== undefined) out.push({ path: at('purposes', kind), message: `"${kind}" is a text: a mail purpose brings an email stop link and an email answer, and neither counts for a text` });
    if ((box.surveyLinks ?? []).includes(kind)) out.push({ path: at('surveyLinks'), message: `"${kind}" is a text, which carries no survey link` });
    if ((box.reviewLinks?.kinds ?? []).includes(kind)) out.push({ path: at('reviewLinks', 'kinds'), message: `"${kind}" is a text, which carries no review link` });
  }
  (box.producers ?? []).forEach((producer, p) => {
    if (!isTextKind(box, producer.kind)) return;
    if (producer.recipient !== undefined) out.push({ path: at('producers', p, 'recipient'), message: `"${producer.kind}" is a text, sent to the person's own number (outbox.recipient.phone)` });
    if (producer.replyTo !== undefined) out.push({ path: at('producers', p, 'replyTo'), message: `"${producer.kind}" is a text, which has no Reply-To` });
  });

  const waiting = new Set<string>();
  (box.waiting ?? []).forEach((kind, k) => {
    if (waiting.has(kind)) out.push({ path: at('waiting', k), message: `"${kind}" is named twice` });
    waiting.add(kind);
    if (box.kinds[kind] === undefined) out.push({ path: at('waiting', k), message: `"${kind}" is not one of the outbox's kinds` });
    else if (!isTextKind(box, kind)) out.push({ path: at('waiting', k), message: `"${kind}" is not a text: only a text waits for the sending hours` });
    else if (box.classes?.[kind] !== 'service') out.push({ path: at('waiting', k), message: `"${kind}" is not a service text: nobody is waiting for an offer, so it keeps the sending hours` });
  });
  return out;
}

/** Everything wrong with a public entry's box for texts. */
export function publicTextConsentIssues(
  m: {
    people?: People | undefined;
    publicAccess?:
      | readonly {
          table: string;
          methods: readonly string[];
          writable?: readonly string[] | undefined;
          writableValues?: Readonly<Record<string, unknown>> | undefined;
          defaults?: Readonly<Record<string, unknown>> | undefined;
          requires?: readonly string[] | undefined;
          requiresWhen?: Readonly<Record<string, unknown>> | undefined;
          consent?: PublicConsent | undefined;
          textConsent?: PublicTextConsent | undefined;
          identity?: { table: string } | undefined;
          claimedBy?: { table: string } | undefined;
        }[]
      | undefined;
  },
  index: TableIndex,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  (m.publicAccess ?? []).forEach((entry, e) => {
    const box = entry.textConsent;
    if (box === undefined) return;
    const at = (...rest: (string | number)[]) => ['publicAccess', e, 'textConsent', ...rest];
    const writable = entry.writable ?? [];
    if (!entry.methods.includes('POST') && !entry.methods.includes('PATCH')) out.push({ path: at(), message: 'a tick is given on a create or a change: this entry writes nothing' });
    if (entry.consent?.column === box.column) out.push({ path: at('column'), message: `"${entry.table}.${box.column}" is the entry's e-mail tick: a yes to mail is not a yes to texts, so the text box has a column of its own` });

    const column = index.column(entry.table, box.column) as TextColumn | undefined;
    if (column === undefined) out.push({ path: at('column'), message: `"${entry.table}" has no column "${box.column}"` });
    else if (column.type !== 'bool') out.push({ path: at('column'), message: `"${entry.table}.${box.column}" is not a bool (a tick)` });
    else {
      if (!writable.includes(box.column)) out.push({ path: at('column'), message: `"${entry.table}.${box.column}" is not writable through this entry, so no tick reaches it` });
      // Unticked: nothing but the person's own tick may set it.
      const preset = entry.defaults?.[box.column] !== undefined || entry.writableValues?.[box.column] !== undefined || (column.default !== undefined && column.default !== false && column.default !== 0 && column.default !== 'false' && column.default !== '0') || ['default', 'copy', 'formula'].some((rule) => column.rules?.[rule] !== undefined);
      if (preset) out.push({ path: at('column'), message: `"${entry.table}.${box.column}" starts unticked and only the person ticks it: it takes no default of yes, and nothing else may set it` });
      // Never a condition of booking or buying.
      const required = column.rules?.['required'] !== undefined || column.rules?.['requiredWhen'] !== undefined || (entry.requires ?? []).includes(box.column) || entry.requiresWhen?.[box.column] !== undefined || (column.nullable !== true && column.default === undefined);
      if (required) out.push({ path: at('column'), message: `"${entry.table}.${box.column}" is never required to book or buy: make it optional (nullable, or a default of false)` });
    }

    const phone = index.column(entry.table, box.phone);
    if (phone === undefined) out.push({ path: at('phone'), message: `"${entry.table}" has no column "${box.phone}"` });
    else if (phone.type !== 'text') out.push({ path: at('phone'), message: `"${entry.table}.${box.phone}" is not a text column (a phone number)` });
    else if (!writable.includes(box.phone)) out.push({ path: at('phone'), message: `"${entry.table}.${box.phone}" is not writable through this entry, so the number the answer is for never reaches it` });

    for (const [locale, text] of Object.entries(box.wording.text)) {
      if (asksForYes(text)) out.push({ path: at('wording', 'text', locale), message: REFUSALS['asks-for-yes'] });
    }

    // Kept for a person the erasure can find by that number.
    const person = entry.identity?.table ?? entry.claimedBy?.table ?? entry.table;
    const declared = (m.people ?? []).find((candidate) => candidate.table === person && candidate.kind === 'people');
    if (declared === undefined) out.push({ path: at(), message: `a tick is kept for a person: "${person}" is not one of the app's people tables (people), and the entry finds no other (identity, claimedBy)` });
    else if (declared.phone === undefined) out.push({ path: at(), message: `a text answer is kept with the person's number: name the column that holds it on "${person}" (people.phone)` });
    else if (person === entry.table && declared.phone !== box.phone) out.push({ path: at('phone'), message: `the people of "${person}" keep their number in "${declared.phone}" (people.phone): this box is for that number` });
  });
  return out;
}
