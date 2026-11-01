// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "YOUR WEBSITES": the check each line of the add box is held to.
 *
 * The owner lists the websites that may show a form in a frame. Each line
 * is one website, reduced to its origin (`https://shop.example`: lower
 * case, no path, no trailing slash, no default port). The Privacy page
 * checks every line as it is typed and the server checks the same lines on
 * save with this one function, so the two can never disagree.
 *
 * The checks, in this order, the first that fails naming the line:
 *
 *   one-per-line  empty, or holds a space, a comma or a `*`
 *   https         does not start with `https://`
 *   address       not a website address once read (no host, a user name in
 *                 it, longer than an origin may be)
 *   path          names a path, a query or a fragment beyond the origin
 *   self          this server's own address
 *   listed        already on the list (or an earlier line of the same batch)
 *   ok            ready to add
 *
 * Pure: no I/O, no schema, no `node:` import, so a page carries it lightly.
 */

/** The most websites the list holds. */
export const WEBSITES_MAX = 50;

/** The longest origin kept (as the server's own public address). */
export const WEBSITE_ORIGIN_MAX = 255;

/** The longest line read: anything longer is refused before it is parsed. */
export const WEBSITE_LINE_MAX = 300;

export const WEBSITE_LINE_CODES = ['one-per-line', 'https', 'address', 'path', 'self', 'listed', 'ok'] as const;
export type WebsiteLineCode = (typeof WEBSITE_LINE_CODES)[number];

/** One line, checked: its code, and its origin once it was read as one. */
export interface WebsiteLine {
  line: string;
  code: WebsiteLineCode;
  /** The origin the line reduces to; null when it did not read as an address. */
  origin: string | null;
}

export interface WebsiteCheckContext {
  /** This server's public address (`system.publicOrigin`), or null when none is set. */
  self: string | null;
  /** The origins already listed. */
  listed: readonly string[];
}

/** The origin a line names when it is one: null when it is not an https address with nothing after its host. */
function originOf(text: string): { origin: string | null; code: 'address' | 'path' | 'ok' } {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { origin: null, code: 'address' };
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return { origin: null, code: 'address' };
  const origin = url.origin.toLowerCase();
  if (origin.length > WEBSITE_ORIGIN_MAX) return { origin: null, code: 'address' };
  // Nothing after the host but one slash: no path, no query, no fragment (an empty `?` or `#` counts too).
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]/.test(text)) return { origin, code: 'path' };
  return { origin, code: 'ok' };
}

/** The same origin, however it was written: lower case, no trailing slash, no default port. */
function sameOrigin(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  try {
    return new URL(value.trim()).origin.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }
}

/** One line, checked against the list and this server's own address. */
export function checkWebsiteLine(line: string, ctx: WebsiteCheckContext): WebsiteLine {
  const text = line.trim();
  if (text === '' || text.length > WEBSITE_LINE_MAX || /[\s,*]/.test(text)) return { line, code: 'one-per-line', origin: null };
  if (!/^https:\/\//i.test(text)) return { line, code: 'https', origin: null };
  const read = originOf(text);
  if (read.code !== 'ok') return { line, code: read.code, origin: read.origin };
  const origin = read.origin!;
  if (origin === sameOrigin(ctx.self)) return { line, code: 'self', origin };
  if (ctx.listed.some((listed) => sameOrigin(listed) === origin)) return { line, code: 'listed', origin };
  return { line, code: 'ok', origin };
}

/**
 * Every line of a batch, checked in order: a line naming the same origin as
 * an earlier line of the batch is "already on the list" too, so a batch
 * never adds one website twice.
 */
export function checkWebsiteLines(lines: readonly string[], ctx: WebsiteCheckContext): WebsiteLine[] {
  const seen = [...ctx.listed];
  return lines.map((line) => {
    const checked = checkWebsiteLine(line, { self: ctx.self, listed: seen });
    if (checked.code === 'ok' && checked.origin !== null) seen.push(checked.origin);
    return checked;
  });
}

/** Whether a stored value is a listed website's origin as this check makes one. */
export function isWebsiteOrigin(value: string): boolean {
  const read = originOf(value);
  return read.code === 'ok' && read.origin === value;
}
