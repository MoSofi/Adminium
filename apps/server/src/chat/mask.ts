// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What of a visitor's words the chat's automatic answerer never sends to the
 * AI service: e-mail addresses and phone numbers, each replaced by a
 * placeholder (`[email]`, `[phone]`) before the words leave this server.
 *
 * The answerer only has to pick one of the owner's answers, and neither an
 * address nor a number helps it pick; both are a person's own. Best effort,
 * so it reaches for the common spellings too:
 *
 *  - the words are NFKC-normalised first, so a full-width `＠`, the small
 *    `﹫` and full-width digits read as their plain forms;
 *  - an address may be spelled out: "anna at mail dot example dot com",
 *    "anna [at] mail [dot] com", in English and in the common words of the
 *    eight languages the dashboard speaks ("punkt", "point", "arobase",
 *    "zavináč", "tečka", "snabel-a", "punktum", "نقطة", "艾特", "点"…). A
 *    spelled-out address needs a domain that ends as one does: letters after
 *    a written dot, or a known ending after a spelled one, so "meet at noon",
 *    "see you at 5.30" or "at the point of sale" stay as written;
 *  - a phone number is any run of 7 or more digits, which may be split by
 *    spaces, dots, dashes, slashes or brackets (at most three between two
 *    digits), with a leading `+`: an order or a long date written that way
 *    is masked too, which costs nothing, since an order is handed to a
 *    person anyway.
 *
 * Pure: the same words always give the same masked words.
 */

/** An e-mail address: something, an `@`, a domain with a dot in it. */
const EMAIL_RE = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+\.[^\s@<>()[\]{}"',;:]*[\p{L}\p{N}]/gu;

/** "at" as people write it out, by language (after NFKC, matched without case). */
const AT_WORDS = ['at', 'ät', 'arobase', 'arrobase', 'zavináč', 'zavinac', 'snabel-a', 'snabela', 'آت'];
/** "dot" as people write it out, by language. */
const DOT_WORDS = ['dot', 'punkt', 'punktum', 'point', 'tečka', 'tecka', 'نقطة', 'دوت'];
/** The same words in scripts written without spaces: they need none around them. */
const AT_CLOSE = ['艾特', '圈a'];
const DOT_CLOSE = ['点', '點'];

const words = (list: readonly string[]): string => list.join('|');
/** A spelled-out word: in brackets (`[at]`, `(dot)`), or standing alone between spaces. */
const spelled = (list: readonly string[], close: readonly string[]): string =>
  `(?:\\s*[([{<]\\s*(?:${words(list)})\\s*[)\\]}>]\\s*|\\s+(?:${words(list)})\\s+|\\s*(?:${words(close)})\\s*)`;
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?';
/** A dot: written (with no space around it, so a sentence's full stop is not one), or spelled out. */
const DOT = `(?:\\.|${spelled(DOT_WORDS, DOT_CLOSE)})`;
/**
 * The endings a spelled-out address is read with: "point", "punkt" and the
 * like are everyday words, so after a spelled dot only a known ending counts
 * ("meet at the point of sale" stays); after a written dot, any letters do.
 */
const ENDINGS = ['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'app', 'dev', 'edu', 'gov', 'eu', 'uk', 'de', 'at', 'ch', 'fr', 'be', 'lu', 'nl', 'cz', 'sk', 'dk', 'se', 'no', 'fi', 'es', 'it', 'pl', 'pt', 'ie', 'us', 'ca', 'au', 'eg', 'sa', 'ae', 'cn', 'tw', 'hk', 'sg', 'jp'];
const ENDING = `(?:\\.\\p{L}{2,}|${spelled(DOT_WORDS, DOT_CLOSE)}(?:${ENDINGS.join('|')}))`;

/** An address with its `@` or its dots written out: a name, "at", a domain that ends as an address does. */
const SPELLED_EMAIL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}._%+-])[\\p{L}\\p{N}._%+-]+${spelled(AT_WORDS, AT_CLOSE)}${LABEL}(?:${DOT}${LABEL})*${ENDING}(?![\\p{L}\\p{N}])`,
  'giu',
);

/**
 * 7 or more digits of any script (Arabic-Indic and full-width ones too), each pair at most three separators apart (a
 * space, dot, dash, slash or bracket), with an optional `+` and `(` first.
 */
const PHONE_RE = /[+＋]?\(?\p{Nd}(?:[\s.\-()/]{0,3}\p{Nd}){6,}/gu;

/** The visitor's words with every e-mail address and phone number replaced. */
export function maskVisitorText(text: string): string {
  return text.normalize('NFKC').replace(EMAIL_RE, '[email]').replace(SPELLED_EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}
