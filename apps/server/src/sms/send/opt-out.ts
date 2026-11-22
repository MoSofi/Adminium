// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The opt-out a text carries, which must work for its sender.
 *
 * A number can take a reply, so it says "Reply STOP". A sender name cannot, so
 * it gives the business's phone or e-mail, and staff record the request. A
 * template may carry its own "Reply STOP" sentence; when the sender cannot take
 * a reply that sentence is removed, because it would promise something that
 * cannot happen. Every word the inbound parser reads as a STOP counts, in any
 * case and language ("Reply Stop", "Antworten Sie STOPP", "Text END"). Words
 * like "end" and "cancel" are ordinary too, so a sentence counts only when it
 * tells the reader to send the word, or writes the word as a keyword.
 *
 * Two countries limit what the line may hold. The UAE allows no phone number
 * or link in a text, so the line names the business alone. France bans opting
 * out by phone number, so only an e-mail address will do there.
 *
 * The words are English until the language pass adds the other seven.
 */
import { placeholdersIn } from '@adminium/manifest';

import type { TextOptOut } from '../consent/types.js';
import { foldMessage, listedWords } from '../inbound/control-words.js';

export interface BusinessContact {
  /** Named in the line where a country allows no contact details. */
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
}

const NO_CONTACT_IN_BODY: ReadonlySet<string> = new Set(['AE']);
const NO_PHONE_OPT_OUT: ReadonlySet<string> = new Set(['FR']);

const REPLY_STOP_LINE = 'Reply STOP to opt out.';
const contactLine = (how: string): string => `To stop these texts, contact ${how}.`;

const STOP_WORD = /\bSTOP\b/;
const SENTENCE = /[^.!?。！？؟\n]+[.!?。！？؟]*/gu;

const STOP_PHRASES: readonly (readonly string[])[] = listedWords('stop').map((word) => word.split(' '));
const HAN = /\p{Script=Han}/u;
const HAN_STOP_WORDS: readonly string[] = listedWords('stop').filter((word) => HAN.test(word));
const HAN_REPLY = /回复|回覆|發送|发送|短信|簡訊/u;

/** "Reply …", in the eight languages, folded. */
const REPLY_VERBS: ReadonlySet<string> = new Set([
  'reply', 'respond', 'answer', 'text', 'send', 'sms', 'message',
  'antworte', 'antworten', 'antwortet', 'sende', 'senden', 'schreibe', 'schreiben', 'simse', 'simsen',
  'repondez', 'reponds', 'repondre', 'envoyez', 'envoie', 'envoyer', 'ecrivez',
  'svar', 'svare', 'skriv',
  'odpovez', 'odpovezte', 'odeslete', 'posli', 'poslete', 'napis', 'napiste',
  'رد', 'ارسل', 'اكتب',
]);
/** German can put the verb last: "mit STOPP antworten". */
const VERB_LAST: ReadonlySet<string> = new Set(['antworten', 'senden', 'schreiben', 'simsen']);
/** What may stand between the verb and the word: "Reply with the word STOP". */
const BETWEEN: ReadonlySet<string> = new Set([
  'with', 'the', 'word', 'us', 'back', 'to', 'just', 'keyword',
  'sie', 'mit', 'dem', 'das', 'wort', 'uns',
  'avec', 'le', 'mot', 'par', 'nous',
  'med', 'ordet', 'os',
  'slovem', 'slovo', 'nam',
  'ب', 'كلمه', 'كلمة',
]);
const MOST_BETWEEN = 3;

function phraseAt(tokens: readonly string[], index: number): number {
  let longest = 0;
  for (const phrase of STOP_PHRASES) {
    if (phrase.length > longest && phrase.every((word, offset) => tokens[index + offset] === word)) longest = phrase.length;
  }
  return longest;
}

/** Whether this sentence tells the reader to send a stop word. */
function tellsToSendStopWord(sentence: string): boolean {
  const folded = foldMessage(sentence);
  if (HAN_REPLY.test(folded) && HAN_STOP_WORDS.some((word) => folded.includes(word))) return true;
  const tokens = folded.split(' ');
  for (let index = 0; index < tokens.length; index += 1) {
    if (REPLY_VERBS.has(tokens[index] as string)) {
      for (let next = index + 1; next <= index + 1 + MOST_BETWEEN && next < tokens.length; next += 1) {
        if (phraseAt(tokens, next) > 0) return true;
        if (!BETWEEN.has(tokens[next] as string)) break;
      }
    }
    const length = phraseAt(tokens, index);
    if (length === 0) continue;
    for (let next = index + length; next <= index + length + MOST_BETWEEN && next < tokens.length; next += 1) {
      if (VERB_LAST.has(tokens[next] as string)) return true;
      if (!BETWEEN.has(tokens[next] as string)) break;
    }
  }
  return false;
}

/** A listed word written in capitals is a keyword. A sentence all in capitals says nothing by it, except for STOP itself. */
function writesStopKeyword(sentence: string): boolean {
  if (STOP_WORD.test(sentence)) return true;
  const letters = sentence.replace(/[^\p{L}]/gu, '');
  if (letters !== '' && letters === letters.toUpperCase()) return false;
  const shouted = sentence.match(/\p{Lu}{2,}/gu) ?? [];
  return shouted.some((word) => phraseAt([foldMessage(word)], 0) > 0);
}

/** Whether these words tell the reader to reply with a stop word. For finished text, where a name in capitals is only a name. */
export function repliesWithStopWord(text: string): boolean {
  return (text.match(SENTENCE) ?? []).some(tellsToSendStopWord);
}

const plain = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text === undefined || text === '' ? null : text;
};

/** The template's words with its placeholders held aside, so a dot in a name is not the end of a sentence. */
function withHeldPlaceholders(template: string, change: (words: string) => string): string {
  const held: string[] = [];
  let words = '';
  let cursor = 0;
  for (const placeholder of placeholdersIn(template)) {
    words += `${template.slice(cursor, placeholder.at)}${held.length}`;
    held.push(placeholder.whole);
    cursor = placeholder.at + placeholder.whole.length;
  }
  words += template.slice(cursor);
  return change(words).replace(/(\d+)/gu, (_, index: string) => held[Number(index)] ?? '');
}

/** Whether the template's own words, not a value filled into them, say STOP. */
export function saysStop(template: string): boolean {
  let found = false;
  withHeldPlaceholders(template, (words) => {
    found = STOP_WORD.test(words) || repliesWithStopWord(words);
    return words;
  });
  return found;
}

/** The template without any sentence offering a reply with a stop word. */
export function withoutStopSentence(template: string): string {
  const offersReply = (sentence: string): boolean => tellsToSendStopWord(sentence) || writesStopKeyword(sentence);
  return withHeldPlaceholders(template, (words) => words.replace(SENTENCE, (sentence) => (offersReply(sentence) ? '' : sentence)).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim());
}

/** The line this text ends with; null when a sender that cannot take replies has no contact that is allowed here. */
export function optOutLine(optOut: TextOptOut, country: string, business: BusinessContact): string | null {
  if (optOut === 'reply-stop') return REPLY_STOP_LINE;
  if (NO_CONTACT_IN_BODY.has(country)) {
    const name = plain(business.name);
    return name === null ? null : contactLine(name);
  }
  const email = plain(business.email);
  const phone = NO_PHONE_OPT_OUT.has(country) ? null : plain(business.phone);
  const how = phone ?? email;
  return how === null ? null : contactLine(how);
}
