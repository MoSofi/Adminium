// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIVE COUNTER: characters, encoding and segments of a finished text.
 *
 * A MIRROR. The server's rules live in `apps/server/src/sms/send/length.ts`
 * (`estimateLength`, `limitsFor`, `TEXT_MAX_SEGMENTS`), `opt-out.ts`
 * (`optOutLine`), `compose.ts` (how the line is joined) and the manifest
 * package's `text-messages.ts` (`asksForYes`, `readsCredential`). The
 * dashboard does not depend on either package, so the rules are copied here,
 * and `textCounter.test.ts` runs both the server's own cases and the design
 * data block's through this copy. A change on the server must change this
 * file and that test together. The server checks every text again when it
 * goes; this copy only says, while a person types, what it will decide.
 *
 * Counted on the FILLED text with its opt-out line, never on the raw
 * template: one customer's name can move a whole message to Unicode.
 */

/** The most segments one text may run to. Over it, a text is refused and never sent. */
export const TEXT_MAX_SEGMENTS = 6;

const GSM_BASIC: ReadonlySet<string> = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_ESCAPED: ReadonlySet<string> = new Set('^{}\\[~]|€\f');

export interface LengthLimits {
  gsm: { alone: number; split: number };
  ucs2: { alone: number; split: number };
}

/** The destination tables the editor offers (comp X29). */
export const SEGMENT_TABLES = {
  standard: { gsm: { alone: 160, split: 153 }, ucs2: { alone: 70, split: 67 } },
  canadaLongCode: { gsm: { alone: 136, split: 136 }, ucs2: { alone: 70, split: 67 } },
  tollFree: { gsm: { alone: 160, split: 152 }, ucs2: { alone: 70, split: 66 } },
} as const satisfies Record<string, LengthLimits>;
export type SegmentTable = keyof typeof SEGMENT_TABLES;

export interface TextEstimate {
  encoding: 'gsm-7' | 'ucs-2';
  /** Characters as a person counts them (code points). */
  characters: number;
  /** Septets for GSM-7, UTF-16 units for UCS-2. */
  units: number;
  segments: number;
  /** The room of one segment at this length: the single size, or the split size once it splits. */
  perSegment: number;
  /** Room left in the last segment. */
  left: number;
  /** Over {@link TEXT_MAX_SEGMENTS}: refused, never sent. */
  tooLong: boolean;
}

/** The server's `limitsFor`, by the editor's own choice of table. */
export function limitsOf(table: SegmentTable): LengthLimits {
  return SEGMENT_TABLES[table];
}

/** Whether one character is in the standard (GSM-7) alphabet, either plain or escaped. */
export function isStandardCharacter(character: string): boolean {
  return GSM_BASIC.has(character) || GSM_ESCAPED.has(character);
}

/** The server's `estimateLength`, packing one character at a time so none is cut across segments. */
export function estimateLength(body: string, limits: LengthLimits): TextEstimate {
  const characters = Array.from(body);
  const gsm = characters.every(isStandardCharacter);
  const widths = gsm ? characters.map((one) => (GSM_ESCAPED.has(one) ? 2 : 1)) : characters.map((one) => one.length);
  const limit = gsm ? limits.gsm : limits.ucs2;
  const units = widths.reduce((sum, width) => sum + width, 0);
  let segments: number;
  let perSegment: number;
  let left: number;
  if (units === 0) {
    segments = 0;
    perSegment = limit.alone;
    left = limit.alone;
  } else if (units <= limit.alone) {
    segments = 1;
    perSegment = limit.alone;
    left = limit.alone - units;
  } else {
    segments = 1;
    let room = limit.split;
    for (const width of widths) {
      if (width > room) {
        segments += 1;
        room = limit.split;
      }
      room -= width;
    }
    perSegment = limit.split;
    left = room;
  }
  return { encoding: gsm ? 'gsm-7' : 'ucs-2', characters: characters.length, units, segments, perSegment, left, tooLong: segments > TEXT_MAX_SEGMENTS };
}

/**
 * The characters of a text that make it Unicode, each once, in reading order.
 * Empty for a standard text.
 */
export function unicodeCharacters(text: string): string[] {
  const out: string[] = [];
  for (const one of Array.from(text)) if (!isStandardCharacter(one) && !out.includes(one)) out.push(one);
  return out;
}

/** Characters a keyboard types for a plain one, and the plain one (comp X28's "Use a plain one"). */
export const PLAIN_FOR: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
};

/** The text with every typed look-alike replaced by its plain character. */
export function withPlainCharacters(text: string): string {
  return Array.from(text)
    .map((one) => PLAIN_FOR[one] ?? one)
    .join('');
}

// ─── the opt-out line (`opt-out.ts`) ────────────────────────────────────────

/** How the person can opt out: by replying, or through the business. */
export type TextOptOut = 'reply-stop' | 'through-business';

/** Replies do not work here (`consent/rules.ts`): the opt-out goes through the business. */
export const NO_REPLY_COUNTRIES: ReadonlySet<string> = new Set(['AE', 'EG', 'SA', 'CN', 'TW']);
/** The UAE allows no phone number or link in a text: the line names the business alone. */
const NO_CONTACT_IN_BODY: ReadonlySet<string> = new Set(['AE']);
/** France bans opting out by phone number: only an e-mail address will do. */
const NO_PHONE_OPT_OUT: ReadonlySet<string> = new Set(['FR']);

/** The words the product adds to a text, in one language: the catalogue's `email:texts.optOut` (`textLineWords.ts` loads them). */
export interface TextLineWords {
  /** "Reply STOP to opt out." */
  replyStop: string;
  /** "To stop these texts, contact {contact}." */
  contactLine(contact: string): string;
  /** What goes between a text and its line. Chinese runs on, with no space. */
  gap: string;
}

export const REPLY_STOP_LINE = 'Reply STOP to opt out.';

/** US English, as the server falls back to: the words before a language's own are loaded, and in unit tests. */
export const ENGLISH_LINE_WORDS: TextLineWords = { replyStop: REPLY_STOP_LINE, contactLine: (how) => `To stop these texts, contact ${how}.`, gap: ' ' };

export interface BusinessContact {
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
}

/** The server's `optOutFor`: "Reply STOP" only from a number, to a country with replies, on a server that reads them. */
export function optOutFor(senderKind: 'number' | 'name' | 'pool', country: string, repliesReachUs: boolean): TextOptOut {
  return senderKind === 'number' && repliesReachUs && !NO_REPLY_COUNTRIES.has(country) ? 'reply-stop' : 'through-business';
}

const plain = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text === undefined || text === '' ? null : text;
};

/** The line the product adds; null when a sender that cannot take replies has no contact allowed here. */
export function optOutLine(optOut: TextOptOut, country: string, business: BusinessContact, words: TextLineWords = ENGLISH_LINE_WORDS): string | null {
  if (optOut === 'reply-stop') return words.replyStop;
  if (NO_CONTACT_IN_BODY.has(country)) {
    const name = plain(business.name);
    return name === null ? null : words.contactLine(name);
  }
  const email = plain(business.email);
  const phone = NO_PHONE_OPT_OUT.has(country) ? null : plain(business.phone);
  const how = phone ?? email;
  return how === null ? null : words.contactLine(how);
}

// ─── placeholders (`packages/manifest/src/placeholders.ts`) ─────────────────

export interface Placeholder {
  whole: string;
  name: string;
  backup: string | undefined;
  at: number;
}

export function placeholdersIn(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*(?:\|([^{}]*))?\}\}/g)) {
    out.push({ whole: match[0], name: match[1] as string, backup: match[2]?.trim(), at: match.index });
  }
  return out;
}

/** Each placeholder name once, in reading order. */
export function placeholderNames(text: string): string[] {
  return [...new Set(placeholdersIn(text).map((one) => one.name))];
}

// ─── what a template may not say (`text-messages.ts`) ───────────────────────

const MINTED_LINKS: ReadonlySet<string> = new Set(['signInLink', 'survey_link', 'reviewLink', 'stopLink', 'object_link', 'calendarGoogle', 'calendarOutlook']);
const CREDENTIAL_NAME = /(?:^|[_-])(?:code|otp|pin|passcode|password|passwd|token|secret)$|[a-z0-9](?:Code|Otp|Pin|Passcode|Password|Passwd|Token|Secret)$/;
const HARMLESS_CODE = /(?:^|[_-])(?:postal|post|zip|country|currency|area|calling|dial|language|locale|tax|product|sku|item|colou?r)[_-]?code$/i;

/** Whether a placeholder reads a sign-in link, a minted link, a code or a QR value. */
export function readsCredential(name: string): boolean {
  if (MINTED_LINKS.has(name)) return true;
  const last = name.slice(name.lastIndexOf('.') + 1);
  if (last === 'qr' || last === 'grouped') return true;
  return CREDENTIAL_NAME.test(last) && !HARMLESS_CODE.test(last);
}

const ASKS_FOR_YES: readonly RegExp[] = [
  /\b(?:reply|respond|answer|text|send)\b[^.!?\n]{0,24}\byes\b/iu,
  /\b(?:antworte|antworten)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:svar|send)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:r[ée]ponds|r[ée]pondez|envoyez)\b[^.!?\n]{0,24}\boui\b/iu,
  /\bodpov[eě]z(?:te)?\b[^.!?\n]{0,24}\bano\b/iu,
  /(?:رد|ردّ|أرسل|ارسل)[^.!?؟\n]{0,24}نعم/u,
  /(?:回复|回覆)[^。！？\n]{0,12}(?:是|好)/u,
];

/** "Reply YES", in the eight languages: a provider reads that reply as an opt-in. */
export function asksForYes(text: string): boolean {
  return ASKS_FOR_YES.some((pattern) => pattern.test(text));
}

/** A link written into the words. Adminium has no link shortener, and a public one is filtered by carriers. */
const SHORT_LINK = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly)\//iu;

// ─── one finished text (`compose.ts`) ───────────────────────────────────────

export type TextProblem =
  | { kind: 'empty' }
  | { kind: 'credential'; names: string[] }
  | { kind: 'asks-for-yes' }
  | { kind: 'short-link' }
  | { kind: 'missing'; names: string[] }
  | { kind: 'no-opt-out-contact' }
  | { kind: 'too-long' };

export interface ComposeInput {
  template: string;
  values: Readonly<Record<string, string>>;
  optOut: TextOptOut;
  country: string;
  business: BusinessContact;
  table: SegmentTable;
  /** The template language's line words; US English when not given. */
  words?: TextLineWords | undefined;
}

export interface Composed {
  /** The text as the customer would read it; a placeholder with no value stays as written, so it can be marked. */
  body: string;
  /** The filled words, without the line. */
  words: string;
  /** The line the product adds, or null when it is the template's own "Reply STOP" sentence, or none can be given. */
  line: string | null;
  estimate: TextEstimate;
  /** Every reason the server would refuse this text. */
  problems: TextProblem[];
}

const STOP_WORD = /\bSTOP\b/;
const SENTENCE = /[^.!?。！？؟\n]+[.!?。！？؟]*/gu;

/** The template's own words, placeholders aside, say STOP (the common reading of `saysStop`). */
function templateSaysStop(template: string): boolean {
  return STOP_WORD.test(template.replace(/\{\{[^{}]*\}\}/g, ''));
}

/** Without the sentences that offer a STOP reply: what a sender name sends (`withoutStopSentence`, its common case). */
function withoutStopSentence(template: string): string {
  return template.replace(SENTENCE, (sentence) => (STOP_WORD.test(sentence.replace(/\{\{[^{}]*\}\}/g, '')) ? '' : sentence)).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

/** The server's `fillText`, kept lenient for a preview: an empty value is reported, and its placeholder stays in place. */
function fill(template: string, values: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const missing: string[] = [];
  let text = '';
  let cursor = 0;
  for (const placeholder of placeholdersIn(template)) {
    const held = Object.hasOwn(values, placeholder.name) ? values[placeholder.name] : undefined;
    const raw = typeof held === 'string' && held.trim() !== '' ? held : placeholder.backup;
    const value = raw?.trim() ?? '';
    text += template.slice(cursor, placeholder.at);
    if (value === '') {
      if (!missing.includes(placeholder.name)) missing.push(placeholder.name);
      text += placeholder.whole;
    } else {
      text += value;
    }
    cursor = placeholder.at + placeholder.whole.length;
  }
  return { text: (text + template.slice(cursor)).trim(), missing };
}

export function composeText(input: ComposeInput): Composed {
  const problems: TextProblem[] = [];
  if (input.template.trim() === '') problems.push({ kind: 'empty' });
  const credentials = [...new Set(placeholdersIn(input.template).filter((one) => readsCredential(one.name)).map((one) => one.name))];
  if (credentials.length > 0) problems.push({ kind: 'credential', names: credentials });
  if (SHORT_LINK.test(input.template)) problems.push({ kind: 'short-link' });

  const templateWords = input.optOut === 'through-business' ? withoutStopSentence(input.template) : input.template;
  const filled = fill(templateWords, input.values);
  if (filled.missing.length > 0) problems.push({ kind: 'missing', names: filled.missing });

  const ownStop = input.optOut === 'reply-stop' && templateSaysStop(input.template);
  const lineWords = input.words ?? ENGLISH_LINE_WORDS;
  const line = ownStop ? null : optOutLine(input.optOut, input.country, input.business, lineWords);
  if (!ownStop && line === null) problems.push({ kind: 'no-opt-out-contact' });
  const body = line === null ? filled.text : filled.text === '' ? line : `${filled.text}${lineWords.gap}${line}`;
  if (asksForYes(input.template) || asksForYes(body)) problems.push({ kind: 'asks-for-yes' });

  const estimate = estimateLength(body, limitsOf(input.table));
  if (estimate.tooLong) problems.push({ kind: 'too-long' });
  return { body, words: filled.text, line, estimate, problems };
}

// ─── languages ──────────────────────────────────────────────────────────────

/** The eight languages a text can be written in, as the template store spells them. */
export const TEXT_LOCALES = ['en_US', 'de_DE', 'fr_FR', 'da_DK', 'cs_CZ', 'ar_EG', 'zh_CN', 'zh_TW'] as const;
export type TextLocale = (typeof TEXT_LOCALES)[number];

/** Each language named in itself, as the comp's tabs draw them. */
export const LOCALE_NAMES: Readonly<Record<TextLocale, string>> = {
  en_US: 'English',
  de_DE: 'Deutsch',
  fr_FR: 'Français',
  da_DK: 'Dansk',
  cs_CZ: 'Čeština',
  ar_EG: 'العربية',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
};

/** A message preview takes its direction from the message's language, never the interface's. */
export const localeDir = (locale: string): 'rtl' | 'ltr' => (locale.startsWith('ar') ? 'rtl' : 'ltr');
/** The BCP 47 tag of a stored locale, for `lang` attributes. */
export const localeTag = (locale: string): string => locale.replace('_', '-');
