// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PLAIN TEXT — a name or a note that names no place to go.
 *
 * Some text is shown to people who did not write it: a guest's name on a
 * ticket, the message on a gift card, a note to the kitchen. Such a column
 * holds letters, spaces and sentence punctuation, only so many digits, and
 * no web address, email address or handle — so nobody can use it to send a
 * stranger somewhere. One judge for every place the rule is said: a public
 * entry's own list, and a column's own rule (`plainText`), which holds every
 * way of writing the row.
 */
import { PLAIN_TEXT_MAX } from '@adminium/manifest';

/** What one plain-text column may hold beyond letters, spaces and punctuation. */
export interface PlainTextRule {
  digits: number;
  max: number;
}

/** A name's rule: no digits, 80 characters. */
export const NAME_RULE: PlainTextRule = { digits: 0, max: PLAIN_TEXT_MAX };

/** The rule that refuses the most of two: one column declared twice holds to both. */
export const stricterRule = (a: PlainTextRule, b: PlainTextRule): PlainTextRule => ({ digits: Math.min(a.digits, b.digits), max: Math.min(a.max, b.max) });

/**
 * Letters, marks, spaces, digits (counted apart) and the punctuation a
 * sentence is written with: the Latin marks (`. , ' ’ ( ) & - ! ? : ; "` and
 * `¿ ¡ « » „ “ ”`), the CJK ones (`，。、！？：；「」『』・`) and the Arabic ones
 * (`، ؛ ؟`). Never `/`, `@`, `<`, `>`, `#`, `=` or `%`: no path, handle, tag
 * or query.
 */
const PLAIN = /^[\p{L}\p{M}\p{Nd} .,'’()&\-!?:;"¿¡«»„“”，。、！？：；「」『』・،؛؟]*$/u;
const DIGIT = /\p{Nd}/gu;

/**
 * Whether a value is plain text: letters, spaces, sentence punctuation, no
 * more digits than its rule allows (a name: none), no longer than its rule
 * (a name: 80 characters), and no `://` or `www.`. Every plain-text column is
 * held to {@link linkFreeText}, which asks this first.
 */
export function plainText(value: unknown, rule: PlainTextRule = NAME_RULE): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value.length > rule.max || !PLAIN.test(value)) return false;
  if ((value.match(DIGIT)?.length ?? 0) > rule.digits) return false;
  const lower = asShown(value).toLowerCase();
  return !lower.includes('://') && !lower.includes('www.');
}

/**
 * The endings a web address a stranger could be sent to ends in: the common
 * generic ones (those a venue or a shop would pick first), the country ones a
 * link is usually made with, and the common ones in other scripts. Never a
 * short word a name is made of ("Mary.Ann", "J.R.R.", "Jo"). A closed list:
 * an address ending in one it does not hold still passes.
 */
const KNOWN_TLDS: ReadonlySet<string> = new Set([
  // generic
  'com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'ai', 'app', 'dev', 'xyz', 'online', 'site',
  'top', 'shop', 'store', 'club', 'live', 'me', 'tv', 'cc', 'ly', 'gg', 'sh', 'fm', 'ws', 'link', 'click', 'help', 'support',
  'page', 'pro', 'name', 'mobi', 'tech', 'website', 'space', 'world', 'today', 'news', 'blog', 'cloud', 'email', 'host', 'lol',
  'vip', 'win', 'bid', 'loan', 'work', 'review', 'download', 'racing', 'date', 'trade', 'science', 'party', 'stream', 'fun',
  'icu', 'buzz', 'cam', 'rest', 'bar', 'cyou', 'monster', 'sbs', 'cfd', 'ink', 'wiki', 'social', 'events', 'tickets',
  'finance', 'money', 'bank', 'pay', 'gift', 'gifts', 'deals', 'sale', 'promo', 'claims', 'refund',
  // what a venue, a shop or a clinic is called online
  'cafe', 'restaurant', 'pub', 'hotel', 'clinic', 'dental', 'health', 'care', 'company', 'menu', 'pizza', 'food', 'kitchen',
  'delivery', 'booking', 'travel', 'ticket', 'services', 'center', 'agency', 'group', 'solutions', 'network', 'express',
  'digital', 'market', 'shopping', 'global', 'plus', 'zone', 'one', 'best', 'free', 'new', 'studio', 'design', 'media',
  'art', 'chat', 'cash', 'credit', 'loans', 'tax', 'legal', 'law', 'exchange', 'zip', 'mov',
  // countries a link is usually made with
  'uk', 'de', 'fr', 'nl', 'eu', 'us', 'ca', 'au', 'in', 'br', 'jp', 'cn', 'ru', 'it', 'es', 'pl', 'ch', 'se', 'dk', 'fi',
  'at', 'cz', 'pt', 'ie', 'nz', 'za', 'mx', 'tr', 'ua', 'kr', 'hk', 'sg', 'tw', 'vn', 'ng', 'ke', 'gr', 'ro', 'hu', 'su',
  'be', 'to', 'li', 'im', 'nu', 'ee', 'lv', 'lt', 'sk', 'si', 'hr', 'bg', 'rs', 'il', 'ae', 'sa', 'qa', 'ph', 'th', 'pk',
  'eg', 'kz', 'lu', 'cl', 'tk', 'ga', 'ml', 'cf', 'gy', 'ac', 'st', 'vc',
  // other scripts
  'рф', 'срб', 'укр', 'бел', 'қаз', 'москва', 'онлайн', 'сайт', '中国', '中國', '网址', '公司', '网络',
]);

/**
 * The endings an address is read in even after one capital letter: `X.Com`
 * and `J.Co` are addresses, where `A.Page` and `W.Hu` are names.
 */
const ALWAYS_ADDRESS: ReadonlySet<string> = new Set(['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'app', 'dev', 'shop', 'online', 'site']);

/**
 * A name with dots between its parts (`evil.com`, `claim.refund.net`, `J.R.R`,
 * and with digits where a note may hold them: `shop1.com`); the last part is
 * read as an ending.
 */
const DOTTED = /[\p{L}\p{M}\p{Nd}-]+(?:\.[\p{L}\p{M}\p{Nd}-]+)+/gu;

/**
 * The text as a reader takes it in, for finding an ending or a `www.` only:
 * fullwidth and other compatibility letters as their plain ones, every letter
 * apart from its marks (the compatibility decomposition, NFKD), and the marks
 * and invisible characters taken out (`co\u034Fm`, `com\uFE0F` and `coḿ`
 * read `com`). The ideographic full stop is read as the dot a browser takes it
 * for (`evil。com` opens `evil.com`). Never what is stored.
 */
function asShown(value: string): string {
  return value.normalize('NFKD').replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '').replace(/\u3002/g, '.');
}

/** A dotted part with the hyphens or punctuation at either end taken off (`com-` reads `com`). */
const trimmed = (part: string): string => part.replace(/^[-\p{P}]+|[-\p{P}]+$/gu, '');

/** Initials before a surname (`W.Hu`, `K.Y.Ng`, `M.De`): single capitals, then one capitalised word. */
function initialsName(parts: readonly string[]): boolean {
  const last = parts[parts.length - 1]!;
  return parts.slice(0, -1).every((part) => /^\p{Lu}$/u.test(part)) && /^\p{Lu}\p{Ll}+$/u.test(last);
}

/**
 * Plain text that names no place to go (`anonymous.plainText`,
 * `limits.plainText`, a child row's `plainText`): {@link plainText}, and no
 * `@` handle, no path and no web address ending in a known ending ("Claim
 * your refund at evil.com", "evil.co.uk/x", "@handle"), however its letters
 * are dressed ("refund-desk.com-", fullwidth letters, invisible marks) —
 * while "Mary.Ann", "J.R.R. Tolkien", "St. John" and "K.Y.Ng" are names, and
 * pass. It refuses web and email addresses in their common forms, not every
 * way of writing one.
 */
export function linkFreeText(value: unknown, rule: PlainTextRule = NAME_RULE): boolean {
  if (!plainText(value, rule)) return false;
  if (typeof value !== 'string') return true;
  if (value.includes('@') || value.includes('/')) return false;
  for (const [dotted] of asShown(value).matchAll(DOTTED)) {
    const parts = dotted.split('.').map(trimmed).filter((part) => part !== '');
    if (parts.length < 2) continue;
    const ending = parts[parts.length - 1]!.toLowerCase();
    if (!KNOWN_TLDS.has(ending)) continue;
    if (initialsName(parts) && !ALWAYS_ADDRESS.has(ending)) continue;
    return false;
  }
  return true;
}
