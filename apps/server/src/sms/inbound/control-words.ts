// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a reply for STOP, START and HELP.
 *
 * Adminium reads replies itself, because provider defaults miss "OPT OUT" and
 * "STOP PLEASE" and know no local words.
 *
 * ─── A control word is the whole message ───────────────────────────────────
 * The message is folded (case, accents, width, punctuation), courtesy words are
 * taken off its two ends, and what is left must BE a listed word or phrase.
 * There is no search inside a sentence, so "I will stop by at 3", "please don't
 * cancel" and "end of the day works" are ordinary replies.
 *
 * ─── START is narrower than STOP, on purpose ───────────────────────────────
 * A missed STOP is the worst failure and a missed START costs one more text
 * from the person. So YES is never a START here, even though Twilio's own block
 * treats it as one: an old "yes" must not lift a stop.
 */

export type ControlKind = 'stop' | 'start' | 'help';

export type ControlWord =
  | {
      kind: ControlKind;
      /** The listed word or phrase that matched. */
      word: string;
      /** The whole message, folded: what a provider's exact-word matching would see. */
      whole: string;
      /** The language the word belongs to; null for one shared by several. */
      language: string | null;
    }
  | { kind: 'none' };

/** Longer than any listed word with its courtesy words: not a control message. */
const LONGEST = 80;

const STOP_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  'en-US': [
    'stopall',
    'stop all',
    'quit',
    'end',
    'revoke',
    'opt out',
    'optout',
    'cancel',
    'unsubscribe',
    'unsubscribe me',
    'stop it',
    'stop texting',
    'stop texting me',
    'stop messaging me',
    'stop sending',
    'remove me',
    'opt me out',
  ],
  'de-DE': ['stopp', 'stoppen', 'abmelden', 'abbestellen', 'austragen', 'ende', 'beenden', 'kundigen', 'kuendigen'],
  'fr-FR': ['arret', 'arreter', 'stopper', 'desabonner', 'me desabonner', 'desinscrire', 'me desinscrire', 'desabonnement', 'desinscription'],
  'da-DK': ['afmeld', 'afmeld mig', 'afmelde', 'frameld', 'frameld mig', 'afslut'],
  'cs-CZ': ['odhlasit', 'odhlasit se', 'odhlaseni', 'konec', 'zrusit'],
  'ar-EG': ['ايقاف', 'الغاء', 'الغاء الاشتراك', 'توقف', 'قف', 'ايقاف الرسايل'],
  'zh-CN': ['退订', '我要退订', '我想退订', '取消订阅', '退出', 'td'],
  'zh-TW': ['退訂', '我要退訂', '我想退訂', '取消訂閱'],
};

/** The same word in several languages, so it says nothing about which. */
const STOP_SHARED: readonly string[] = ['stop', '停止', '取消'];

const START_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  'en-US': ['unstop'],
  'de-DE': ['starten'],
  'fr-FR': ['demarrer'],
  'cs-CZ': ['spustit'],
  'ar-EG': ['ابدا'],
  'zh-CN': ['开始'],
  'zh-TW': ['開始'],
};
const START_SHARED: readonly string[] = ['start'];

const HELP_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  'en-US': ['help'],
  'de-DE': ['hilfe'],
  'fr-FR': ['aide'],
  'da-DK': ['hjælp', 'hjaelp'],
  'cs-CZ': ['pomoc'],
  'ar-EG': ['مساعده', 'مساعدة'],
  'zh-CN': ['帮助'],
  'zh-TW': ['幫助'],
};
const HELP_SHARED: readonly string[] = ['info'];

/** Taken off either end. A phrase is written as its folded words. */
const COURTESY: readonly (readonly string[])[] = [
  ['thank', 'you'],
  ['s', 'il', 'vous', 'plait'],
  ['sil', 'vous', 'plait'],
  ['من', 'فضلك'],
  ['لو', 'سمحت'],
  ['please'],
  ['pls'],
  ['plz'],
  ['now'],
  ['thanks'],
  ['thx'],
  ['ty'],
  ['bitte'],
  ['danke'],
  ['merci'],
  ['svp'],
  ['venligst'],
  ['tak'],
  ['prosim'],
  ['dekuji'],
  ['شكرا'],
];

/**
 * Chinese is written without spaces, so its courtesy is taken off the string.
 * Only words that add nothing: 了 would turn "cancelled" into "cancel", and
 * 我要 would turn "I want to cancel" (a visit, most likely) into an opt-out.
 */
const CJK_PREFIXES: readonly string[] = ['麻烦', '麻煩', '请', '請'];
const CJK_SUFFIXES: readonly string[] = ['谢谢', '謝謝'];

interface Listed {
  kind: ControlKind;
  language: string | null;
}

function buildTable(): ReadonlyMap<string, Listed> {
  const table = new Map<string, Listed>();
  const addAll = (kind: ControlKind, byLanguage: Readonly<Record<string, readonly string[]>>, shared: readonly string[]): void => {
    for (const [language, words] of Object.entries(byLanguage)) for (const word of words) table.set(word, { kind, language });
    for (const word of shared) table.set(word, { kind, language: null });
  };
  addAll('stop', STOP_BY_LANGUAGE, STOP_SHARED);
  addAll('start', START_BY_LANGUAGE, START_SHARED);
  addAll('help', HELP_BY_LANGUAGE, HELP_SHARED);
  return table;
}

const TABLE = buildTable();

/**
 * Case, width and accents folded, every mark and piece of punctuation a space.
 * Arabic loses its vowel signs and hamza seats, so the common spellings of one
 * word meet.
 */
export function foldMessage(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function endsWithPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length > tokens.length) return false;
  const start = tokens.length - phrase.length;
  return phrase.every((word, index) => tokens[start + index] === word);
}

function startsWithPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  return phrase.length <= tokens.length && phrase.every((word, index) => tokens[index] === word);
}

function withoutCourtesy(input: readonly string[]): string[] {
  let tokens = [...input];
  for (let changed = true; changed && tokens.length > 0; ) {
    changed = false;
    for (const phrase of COURTESY) {
      if (phrase.length < tokens.length && startsWithPhrase(tokens, phrase)) {
        tokens = tokens.slice(phrase.length);
        changed = true;
      } else if (phrase.length < tokens.length && endsWithPhrase(tokens, phrase)) {
        tokens = tokens.slice(0, tokens.length - phrase.length);
        changed = true;
      }
    }
  }
  return tokens;
}

function withoutCjkCourtesy(input: string): string {
  let text = input;
  for (let changed = true; changed; ) {
    changed = false;
    for (const prefix of CJK_PREFIXES) {
      if (text.length > prefix.length && text.startsWith(prefix)) {
        text = text.slice(prefix.length);
        changed = true;
      }
    }
    for (const suffix of CJK_SUFFIXES) {
      if (text.length > suffix.length && text.endsWith(suffix)) {
        text = text.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return text;
}

/** "stop stop stop" is one stop. */
function collapsed(tokens: readonly string[]): string[] {
  return tokens.length > 1 && tokens.every((token) => token === tokens[0]) ? [tokens[0] as string] : [...tokens];
}

/** What a reply says, if it is a control word at all. */
export function readControlWord(text: unknown): ControlWord {
  if (typeof text !== 'string' || text.length === 0 || text.length > LONGEST * 4) return { kind: 'none' };
  const whole = foldMessage(text);
  if (whole === '' || whole.length > LONGEST) return { kind: 'none' };

  const rest = collapsed(withoutCourtesy(whole.split(' ')));
  const candidates = [rest.join(' ')];
  if (rest.length === 1) candidates.push(withoutCjkCourtesy(rest[0] as string));
  else if (/\p{Script=Han}/u.test(whole)) candidates.push(withoutCjkCourtesy(rest.join('')));

  for (const word of candidates) {
    const listed = TABLE.get(word);
    if (listed !== undefined) return { kind: listed.kind, word, whole, language: listed.language };
  }
  return { kind: 'none' };
}

/** Every listed word of a kind, for tests and the console's help text. */
export function listedWords(kind: ControlKind): string[] {
  return [...TABLE.entries()].filter(([, listed]) => listed.kind === kind).map(([word]) => word);
}
