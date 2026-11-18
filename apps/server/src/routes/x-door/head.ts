// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HEAD OF A `/x/` PAGE, WRITTEN BY THE SERVER.
 *
 * A link preview (a chat app, a social site) reads a page's HTML and runs no
 * script, and a search engine reads its head first: so the language, the
 * title, the description, the sharing tags and the canonical address of a
 * page are written into the bundle's `index.html` here, before it is sent.
 *
 * The owner's words reach the HTML only through this file, and only as
 * escaped text: every value goes through `escapeHtml` (quotes included), into
 * a tag this file spells, from a typed object. Nothing is concatenated raw,
 * so a title such as `"><script>` or `</title><meta http-equiv=refresh>` is
 * drawn as the words it is, inside the one tag it belongs to.
 *
 * The bundle's file carries `<html lang="en">`, `<title>Form</title>` and a
 * robots tag (`noindex, nofollow`); each is replaced per answer: the robots
 * tag is kept unless the answer may be indexed (`x-door/headers.ts` says the
 * same in its header).
 */
/** Text as HTML text or an attribute's value: `&`, `<`, `>` and both quotes escaped. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What the server writes into a page's head. */
export interface XHead {
  /** `<html lang>`: a BCP 47 tag. */
  lang: string;
  dir: 'ltr' | 'rtl';
  title: string;
  /** The page's own description; none for a page that has none (a form). */
  description?: string | undefined;
  /** The sharing tags and the canonical address: only for a page that is shared (a live landing page). */
  share?:
    | {
        /** The page's canonical address, absolute. */
        url: string;
        /** The sharing picture, absolute, on the canonical host; none for a page without one. */
        image?: string | undefined;
        /** `og:locale`: the page's language, as `en_US`. */
        locale: string;
      }
    | undefined;
  /** Whether a search engine may index this answer: the robots tag is then left out. */
  indexable: boolean;
}

/** One `<meta>` tag, by `name` or by `property`, its content escaped. */
function meta(key: 'name' | 'property', name: string, content: string): string {
  return `<meta ${key}="${escapeHtml(name)}" content="${escapeHtml(content)}" />`;
}

/** The tags a head adds after its title, one per line of the built file's own indent. */
export function headTags(head: XHead): string[] {
  const tags: string[] = [];
  if (head.description !== undefined) tags.push(meta('name', 'description', head.description));
  const share = head.share;
  if (share !== undefined) {
    tags.push(meta('property', 'og:type', 'website'));
    tags.push(meta('property', 'og:title', head.title));
    if (head.description !== undefined) tags.push(meta('property', 'og:description', head.description));
    tags.push(meta('property', 'og:url', share.url));
    if (share.image !== undefined) tags.push(meta('property', 'og:image', share.image));
    tags.push(meta('property', 'og:locale', share.locale));
    tags.push(meta('name', 'twitter:card', share.image === undefined ? 'summary' : 'summary_large_image'));
    tags.push(`<link rel="canonical" href="${escapeHtml(share.url)}" />`);
  }
  return tags;
}

/**
 * The bundle's page with `head` written into it: the `<html>` tag's
 * language and direction, the title, the robots tag kept or taken out, and
 * the other tags added before `</head>`. A file that lacks one of the parts
 * is left as it is there (the bundle's own file has each).
 */
export function withHead(html: string, head: XHead): string {
  let out = html.replace(/<html\b[^>]*>/i, () => `<html lang="${escapeHtml(head.lang)}" dir="${escapeHtml(head.dir)}">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(head.title)}</title>`);
  if (head.indexable) out = out.replace(/[ \t]*<meta\s+name=["']robots["'][^>]*>\s*\n?/gi, '');
  const tags = headTags(head);
  if (tags.length > 0) out = out.replace(/([ \t]*)<\/head>/i, (_whole, indent: string) => `${tags.map((tag) => `${indent}  ${tag}\n`).join('')}${indent}</head>`);
  return out;
}

/** The languages written right to left, by their first part. */
const RIGHT_TO_LEFT: ReadonlySet<string> = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi']);

/** Which way a language is written. */
export function directionOf(language: string): 'ltr' | 'rtl' {
  return RIGHT_TO_LEFT.has(language.split('-')[0]!.toLowerCase()) ? 'rtl' : 'ltr';
}

/** `og:locale`'s spelling of a language tag: `en-US` is `en_US`. */
export function ogLocaleOf(language: string): string {
  return language.replace(/-/g, '_');
}
