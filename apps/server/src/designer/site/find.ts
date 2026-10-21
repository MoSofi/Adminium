// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a site template holds, found by rule on the server, for the model to plan an app from.
 *
 * Before anything is built, the model proposes a plan to the person: what becomes a table, what the
 * forms do, what the template shows that Adminium cannot do. It proposes it from these facts, not
 * from reading the pages itself:
 *
 * - Repeated blocks: two or more siblings of the same shape (products, posts, a team, price plans),
 *   with the fields each holds, typed (a heading, a price, a date, a picture…), and samples. The same
 *   shape on several pages is one block. Navigation, the page's header and footer, and forms are not
 *   looked into, and a list of links alone is not a block.
 * - Forms: their fields, and what each is for, guessed from the fields' types and words.
 * - The pages that are a cart, a checkout and a thank-you.
 * - What the pages do or load that a screen does not hold: card payments, passwords, search boxes,
 *   scripts, frames, files from other sites, chat widgets, analytics, videos, maps.
 * - Links that lead nowhere (`href="#"`).
 *
 * Every word from the template is data: each is made one plain line and cut (`plainWords`). Ids and
 * field names are the finder's own and never hold the template's words.
 */
import { parse } from 'parse5';

import { plainWords, quoted } from '../untrusted.js';
import { resolveSitePath } from './css.js';
import { attrOf, HTML_NS, isElement, isHtml, textOf, type Element, type Node, type ParentNode } from './dom.js';

export type FieldKind = 'heading' | 'text' | 'price' | 'date' | 'picture' | 'link' | 'rating';

export interface FoundBlock {
  /** 'block-1', 'block-2' …: the same for the same pages. */
  id: string;
  /** The pages it appears on, in page order. */
  pages: string[];
  /** Instances across all pages. */
  count: number;
  /** Instances whose content repeats an earlier one exactly: copies that fill a grid. */
  filler: number;
  /** A suggested column ref for each field, unique in the block, in the order of the markup. */
  fields: { name: string; kind: FieldKind }[];
  /** Up to 24 instances that are not filler, in order: field name to its text, or a picture's site path. */
  samples: Record<string, string>[];
  /** The block element, as data words: 'div.product-item'. */
  shape: string;
}

export interface FoundForm {
  id: string;
  page: string;
  purpose: 'contact' | 'newsletter' | 'search' | 'login' | 'signup' | 'coupon' | 'checkout' | 'other';
  method: 'get' | 'post';
  /** As written, cleaned. */
  action: string | null;
  /** Its inputs, selects and textareas; not buttons or hidden inputs. */
  fields: { name: string | null; type: string; required: boolean; label: string | null; placeholder: string | null }[];
}

export interface FoundFeature {
  /** One per kind and detail, with its pages merged. */
  id: string;
  kind: 'card-payment' | 'password' | 'search' | 'script' | 'frame' | 'other-host' | 'chat-widget' | 'analytics' | 'video' | 'map';
  pages: string[];
  /** Data words: a script's address, a frame's host, a widget's maker. */
  detail: string;
}

/** A link that leads nowhere, named by its text; one per text, on the first page it is met. */
export interface FoundLink {
  id: string;
  page: string;
  text: string;
}

export interface SiteFacts {
  pages: { path: string; title: string | null }[];
  blocks: FoundBlock[];
  forms: FoundForm[];
  /** The pages that are a cart, a checkout and a thank-you; null when there is no cart or checkout. */
  cart: { cart: string | null; checkout: string | null; thanks: string | null } | null;
  features: FoundFeature[];
  links: FoundLink[];
}

const SAMPLES_MAX = 24;
const VALUE_MAX = 200;
const SHAPE_MAX = 60;
const ACTION_MAX = 120;
const DETAIL_MAX = 120;
const LINK_TEXT_MAX = 60;
const TITLE_MAX = 120;
const LABEL_MAX = 80;
const NAME_MAX = 60;
/** The most of each list kept: a template is never this long, and a made-up one cannot grow the facts without end. */
const LIST_MAX = 200;
/** How many levels up from a picture its block may be. */
const BLOCK_LEVELS = 6;
/** How deep the walk looks for blocks, and how deep inside a block for its fields. */
const WALK_DEPTH_MAX = 300;
const FIELD_DEPTH_MAX = 40;

/** Elements that are not shown, so neither a shape nor the finder looks into them. */
const UNSEEN = ['script', 'style', 'template', 'noscript'];
/** Form controls: what a person types into is not the block's data. */
const CONTROLS = ['input', 'select', 'textarea', 'button', 'option', 'optgroup', 'datalist'];
/** Text that is not a field's words. */
const TEXT_SKIP = [...UNSEEN, ...CONTROLS, 'svg'];
/** Elements a shape looks through, as if their children sat in their place: line breaks and inline
 * wrappers that a template puts in one card and not the next (a "Sale" badge, a bold word, an icon). */
const SEE_THROUGH = new Set(['br', 'wbr', 'span', 'b', 'i', 'em', 'strong', 'small', 'u', 's', 'mark', 'sup', 'sub']);
/** Class words that mark one item's state (the slide shown, the tab open), not its kind. */
const STATE_CLASSES = new Set(['active', 'current', 'selected', 'show', 'open', 'in', 'first', 'last', 'odd', 'even', 'is-active', 'is-current', 'is-selected']);
/** Parts of a page where blocks are not looked for: navigation, the page's header and footer, forms. */
const NOT_BLOCKS = ['nav', 'header', 'footer', 'form', 'menu', ...CONTROLS];
const NOT_BLOCK_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'menu', 'menubar', 'tablist']);
/** Children that make an element more than one run of text. */
const BLOCK_TAGS = new Set(
  'address article aside blockquote dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table ul picture'.split(' '),
);

// ---- small readers ----

/** The element children a page shows. */
const elementsIn = (parent: ParentNode): Element[] => parent.childNodes.filter((child): child is Element => isElement(child) && !UNSEEN.includes(child.tagName));

/** Every element under a node, in page order. Walked with a list, so a page nested deep cannot run the stack out. */
function elementsBelow(root: ParentNode): Element[] {
  const out: Element[] = [];
  const stack: Node[] = [...root.childNodes].reverse();
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    if (!isElement(at)) continue;
    out.push(at);
    for (let k = at.childNodes.length - 1; k >= 0; k -= 1) {
      const child = at.childNodes[k];
      if (child !== undefined) stack.push(child);
    }
  }
  return out;
}

/** The nearest element up from `el` (itself included) with one of these HTML names, or null. */
function closest(el: Element, names: readonly string[]): Element | null {
  for (let up: ParentNode | null = el; up !== null && isElement(up); up = up.parentNode) if (isHtml(up, ...names)) return up;
  return null;
}

function classWords(el: Element): string[] {
  return [...new Set((attrOf(el, 'class') ?? '').split(/\s+/).filter((word) => word !== '' && !STATE_CLASSES.has(word.toLowerCase())))];
}

/** The words of class and itemprop, lower case, split at anything not a letter or digit. */
const hintWords = (el: Element): string[] =>
  `${attrOf(el, 'class') ?? ''} ${attrOf(el, 'itemprop') ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');

/** The text right inside an element, and inside the inline wrappers it holds when `inline` is set. */
function ownWords(el: Element, inline: boolean): string {
  let text = '';
  const stack: Node[] = [...el.childNodes].reverse();
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    if (at.nodeName === '#text' && 'value' in at) text += at.value;
    else if (inline && isElement(at) && at.namespaceURI === HTML_NS && SEE_THROUGH.has(at.tagName)) {
      for (let k = at.childNodes.length - 1; k >= 0; k -= 1) {
        const child = at.childNodes[k];
        if (child !== undefined) stack.push(child);
      }
    }
  }
  return text;
}

/** The host of an address on another site (`https:`, `http:` or `//`), lower case, or null. */
function remoteOf(raw: string): { host: string; path: string } | null {
  const url = raw.trim();
  if (!/^(?:https?:)?\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url, 'https://site.invalid/');
    const host = parsed.hostname.toLowerCase();
    return host === '' ? null : { host, path: parsed.pathname };
  } catch {
    return null;
  }
}

// ---- shapes ----

/** The children a shape is made of: the shown elements, looking through inline wrappers. SVG and MathML are drawn whole, so not looked into. */
function shapeChildren(el: Element): Element[] {
  if (el.namespaceURI !== HTML_NS) return [];
  const out: Element[] = [];
  const stack: Node[] = [...el.childNodes].reverse();
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    if (!isElement(at) || UNSEEN.includes(at.tagName)) continue;
    if (at.namespaceURI === HTML_NS && SEE_THROUGH.has(at.tagName)) {
      for (let k = at.childNodes.length - 1; k >= 0; k -= 1) {
        const child = at.childNodes[k];
        if (child !== undefined) stack.push(child);
      }
    } else out.push(at);
  }
  return out;
}

/**
 * Shapes of elements, as small numbers: two elements have the same shape when they have the same tag,
 * the same class words (in any order, state words such as `active` left out) and children of the same
 * shapes in the same order. Text and other attributes do not count. Two tolerances, so the cards of one
 * grid match though the template wrote them a little apart: inline wrappers and line breaks are looked
 * through (one card's "Sale" badge, another's bold word), and a run of children of one shape counts as
 * one (a post of three paragraphs and one of two, four stars and five).
 */
class Shapes {
  private readonly ids = new Map<string, number>();
  private readonly shapes = new WeakMap<Element, number>();
  private readonly groups = new WeakMap<ParentNode, Map<number, Element[]>>();

  shapeOf(el: Element): number {
    const known = this.shapes.get(el);
    if (known !== undefined) return known;
    // Children first, with a list of its own rather than by calling itself: a page may nest very deep.
    const stack: { el: Element; kids: Element[] | null }[] = [{ el, kids: null }];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      if (top.kids === null) {
        top.kids = shapeChildren(top.el);
        for (const kid of top.kids) if (!this.shapes.has(kid)) stack.push({ el: kid, kids: null });
        continue;
      }
      stack.pop();
      if (this.shapes.has(top.el)) continue;
      const parts: number[] = [];
      for (const kid of top.kids) {
        const id = this.shapes.get(kid) ?? -1;
        if (parts.at(-1) !== id) parts.push(id);
      }
      const key = `${top.el.namespaceURI}|${top.el.tagName}|${classWords(top.el).sort().join(' ')}|${parts.join(',')}`;
      let id = this.ids.get(key);
      if (id === undefined) {
        id = this.ids.size;
        this.ids.set(key, id);
      }
      this.shapes.set(top.el, id);
    }
    return this.shapes.get(el) ?? -1;
  }

  /** A parent's shown children, by shape, each list in page order. */
  groupsOf(parent: ParentNode): Map<number, Element[]> {
    let groups = this.groups.get(parent);
    if (groups === undefined) {
      groups = new Map();
      for (const child of elementsIn(parent)) {
        const id = this.shapeOf(child);
        const list = groups.get(id);
        if (list === undefined) groups.set(id, [child]);
        else list.push(child);
      }
      this.groups.set(parent, groups);
    }
    return groups;
  }

  /** Whether an element is one of two or more siblings of its shape. */
  repeated(el: Element): boolean {
    const parent = el.parentNode;
    return parent !== null && (this.groupsOf(parent).get(this.shapeOf(el))?.length ?? 0) >= 2;
  }
}

/** The shapes of one parsed page, for the converter, which asks about one picture at a time. */
const shapesByTree = new WeakMap<ParentNode, Shapes>();
function shapesFor(el: Element): Shapes {
  let root: ParentNode = el;
  for (let up: ParentNode | null = el.parentNode; up !== null; up = 'parentNode' in up ? up.parentNode : null) root = up;
  let shapes = shapesByTree.get(root);
  if (shapes === undefined) {
    shapes = new Shapes();
    shapesByTree.set(root, shapes);
  }
  return shapes;
}

/** The one rule for "a repeated block", shared with the converter: the nearest of the element and its
 * ancestors (up to six up, never the body or the page) that is one of two or more siblings of the same shape. */
export function repeatedBlockOf(el: Element): Element | null {
  const shapes = shapesFor(el);
  let at: Element = el;
  for (let level = 0; level <= BLOCK_LEVELS; level += 1) {
    if (isHtml(at, 'body', 'html')) return null;
    if (shapes.repeated(at)) return at;
    const up = at.parentNode;
    if (up === null || !isElement(up)) return null;
    at = up;
  }
  return null;
}

// ---- fields ----

interface RawField {
  /** Where it sits in its block, so the same field of each instance lines up. */
  key: string;
  kind: FieldKind;
  hint: string | null;
  value: string;
  /** Its words sit in a link inside the block. */
  inLink: boolean;
  /** It sits in a smaller repeated block inside this one. */
  inner: boolean;
}

const CURRENCY = /[$€£¥₹]|\b(?:USD|EUR|GBP|INR|JPY|CHF|AUD|CAD)\b/;
const PRICE = new RegExp(`(?:${CURRENCY.source})\\s?\\d|\\d\\s?(?:${CURRENCY.source})`);
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE = new RegExp(
  `\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}|${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4})\\b`,
  'i',
);
const STAR_CHARS = /[★⭐]/gu;
/** A class word of a star icon: `star`, `fa-star`, `bi-star-fill`, `icon-star`. */
const STAR_CLASS = /^(?:(?:fa|fas|bi|icon|ti|la|las|mdi|ri|ion)-)?star(?:-fill|-full|-solid|-filled)?$/i;
/** Class words that name what a run of text is. The first that matches wins; 'title' makes it a heading. */
const HINTS: [RegExp, string][] = [
  [/^(?:author|byline|writer)$/, 'author'],
  [/^(?:role|position|job|designation|occupation|profession)$/, 'role'],
  [/^(?:excerpt|summary|description|desc|intro|teaser|bio)$/, 'excerpt'],
  [/^(?:category|categories|tag|tags)$/, 'category'],
  [/^(?:location|address|city)$/, 'location'],
  [/^(?:quote|testimonial|review)$/, 'quote'],
  [/^(?:title|name|heading|headline)$/, 'title'],
];

/** Few enough letters besides a price or a date that the price or date is what the text says ("From $20 / month"). */
const restLetters = (text: string): number => [...text.replace(/[^\p{L}]/gu, '')].length;

function isPrice(text: string): boolean {
  return PRICE.test(text) && restLetters(text.replace(new RegExp(CURRENCY.source, 'g'), '')) <= 12;
}

function isDate(text: string): boolean {
  const found = DATE.exec(text);
  return found !== null && restLetters(text.replace(found[0], '')) <= 16;
}

function hintOf(el: Element, inQuote: boolean): string | null {
  const words = hintWords(el);
  for (const [pattern, hint] of HINTS) if (words.some((word) => pattern.test(word))) return hint;
  return inQuote ? 'quote' : null;
}

/** What a run of text is: stars, a price, a date, a heading, or text (with what its class calls it). */
function typeOf(text: string, el: Element, heading: boolean, inQuote: boolean): { kind: FieldKind; value: string; hint: string | null } {
  const stars = text.match(STAR_CHARS)?.length ?? 0;
  if (stars > 0 && text.replace(/[★☆⭐\s\d.,/()]/gu, '').length <= 3) return { kind: 'rating', value: String(stars), hint: null };
  if (isPrice(text)) return { kind: 'price', value: text, hint: null };
  if (isDate(text)) return { kind: 'date', value: text, hint: null };
  const hint = hintOf(el, inQuote);
  if (hint !== null && hint !== 'title') return { kind: 'text', value: text, hint };
  if (heading || hint === 'title' || (isHtml(el, 'strong', 'b') && [...text].length <= 80)) return { kind: 'heading', value: text, hint: null };
  return { kind: 'text', value: text, hint: null };
}

const PICTURE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/;

/** A picture's site path, resolved against its page; a lazy-loaded one's `data-src` when `src` is not the site's. */
function picturePath(img: Element, page: string): string | null {
  for (const name of ['src', 'data-src']) {
    const value = attrOf(img, name);
    const path = value === null ? null : resolveSitePath(page, value);
    if (path !== null && PICTURE_PATH.test(path)) return path;
  }
  return null;
}

/** The site page a link leads to, or null when it leads elsewhere, to a file, or nowhere. */
function pageLinkOf(a: Element, page: string): string | null {
  const href = attrOf(a, 'href');
  if (href === null || href.trim().startsWith('#')) return null;
  const path = resolveSitePath(page, href);
  if (path === null) return null;
  const last = path.split('/').at(-1) ?? '';
  return !last.includes('.') || /\.(?:html?|php)$/.test(last) ? path : null;
}

const isStar = (el: Element): boolean => classWords(el).some((word) => STAR_CLASS.test(word));

/** A block's own element: down through wrappers that hold only one element and no words (`div.col > div.card`). */
function coreOf(el: Element): Element {
  let at = el;
  for (let step = 0; step < BLOCK_LEVELS; step += 1) {
    if (isHtml(at, 'a') || ownWords(at, true).trim() !== '') return at;
    const kids = shapeChildren(at);
    const only = kids.length === 1 ? kids[0] : undefined;
    if (only === undefined || shapeChildren(only).length === 0) return at;
    at = only;
  }
  return at;
}

interface Walk {
  path: string;
  inLink: boolean;
  inner: boolean;
  inQuote: boolean;
  /** An element above already took all the words below it as one field. */
  textTaken: boolean;
  depth: number;
}

/** The fields of one instance, in the order of the markup. */
function fieldsOf(core: Element, page: string, shapes: Shapes): RawField[] {
  const fields: RawField[] = [];
  const seen = new Map<string, number>();
  const add = (at: Walk, kind: FieldKind, value: string, hint: string | null = null): void => {
    const clean = plainWords(value, VALUE_MAX);
    if (clean === '') return;
    const base = `${at.path}:${kind === 'picture' || kind === 'link' || kind === 'rating' ? kind : 'text'}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    fields.push({ key: `${base}#${String(nth)}`, kind, hint, value: clean, inLink: at.inLink, inner: at.inner });
  };
  const visit = (el: Element, from: Walk): void => {
    if (from.depth > FIELD_DEPTH_MAX || el.namespaceURI !== HTML_NS || UNSEEN.includes(el.tagName) || CONTROLS.includes(el.tagName)) return;
    const at: Walk = {
      ...from,
      path: `${from.path}>${el.tagName}.${classWords(el).sort().join('.')}`,
      depth: from.depth + 1,
      // A smaller block of cards inside this one; a run of bare paragraphs or list items is not.
      inner: from.inner || (el !== core && shapeChildren(el).length > 0 && shapes.repeated(el)),
      inQuote: from.inQuote || isHtml(el, 'blockquote', 'q'),
    };
    if (isHtml(el, 'img')) {
      const path = picturePath(el, page);
      if (path !== null) add(at, 'picture', path);
      return;
    }
    if (isHtml(el, 'a')) {
      const to = pageLinkOf(el, page);
      if (to !== null) add(at, 'link', to);
      if (el !== core) at.inLink = true;
    }
    const kids = elementsIn(el);
    const stars = kids.filter(isStar);
    if (stars.length >= 2) add(at, 'rating', String(stars.length));
    if (!at.textTaken) {
      const heading = /^h[1-6]$/.test(el.tagName);
      const words = ownWords(el, false);
      if (heading || words.trim() !== '') {
        // One run of text is one field, inline words and all; text beside blocks is a field of its own.
        const whole = heading || !kids.some((kid) => kid.namespaceURI === HTML_NS && BLOCK_TAGS.has(kid.tagName));
        const text = plainWords(whole ? textOf(el, TEXT_SKIP) : words, VALUE_MAX);
        if (text !== '') {
          const typed = typeOf(text, el, heading, at.inQuote);
          add(at, typed.kind, typed.value, typed.hint);
        }
        if (whole) at.textTaken = true;
      }
    }
    for (const kid of kids) if (!stars.includes(kid)) visit(kid, at);
  };
  visit(core, { path: '', inLink: false, inner: false, inQuote: false, textTaken: false, depth: 0 });
  return fields;
}

interface MergedField {
  key: string;
  name: string;
  kind: FieldKind;
  inLink: boolean;
}

/** Kinds from the most telling to the least, to settle a tie. */
const KIND_ORDER: FieldKind[] = ['picture', 'link', 'rating', 'price', 'date', 'heading', 'text'];

/** The fields of a block: each instance's lined up by where they sit, kept in markup order, typed by most instances, and named. */
function mergeFields(instances: readonly RawField[][]): MergedField[] {
  const order: string[] = [];
  const seen = new Map<string, { kinds: Map<FieldKind, number>; hints: Map<string, number>; inLink: boolean }>();
  for (const fields of instances) {
    let at = -1;
    for (const field of fields) {
      let info = seen.get(field.key);
      if (info === undefined) {
        info = { kinds: new Map(), hints: new Map(), inLink: true };
        seen.set(field.key, info);
        order.splice(at + 1, 0, field.key);
        at += 1;
      } else at = order.indexOf(field.key);
      info.kinds.set(field.kind, (info.kinds.get(field.kind) ?? 0) + 1);
      if (field.hint !== null) info.hints.set(field.hint, (info.hints.get(field.hint) ?? 0) + 1);
      info.inLink &&= field.inLink;
    }
  }
  const most = <T>(counts: Map<T, number>, rank: (value: T) => number): T | undefined =>
    [...counts].sort(([a, m], [b, n]) => n - m || rank(a) - rank(b)).at(0)?.[0];
  const typed = order.map((key) => {
    const info = seen.get(key);
    const kind = info === undefined ? 'text' : (most(info.kinds, (kind) => KIND_ORDER.indexOf(kind)) ?? 'text');
    return { key, kind, hint: info === undefined ? null : (most(info.hints, () => 0) ?? null), inLink: info?.inLink ?? false };
  });
  const dated = typed.some((field) => field.kind === 'date');
  const used = new Set<string>();
  let headings = 0;
  return typed.map(({ key, kind, hint, inLink }) => {
    let base: string = kind;
    if (kind === 'heading') {
      base = headings === 0 ? (dated ? 'title' : 'name') : 'subtitle';
      headings += 1;
    } else if (kind === 'text') base = hint ?? 'text';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}_${String(n)}`;
    used.add(name);
    return { key, name, kind, inLink };
  });
}

/** Whether instances with these fields are content: words or pictures beyond the links, and more than one field unless it is a picture. */
function isContent(fields: readonly MergedField[]): boolean {
  const content = fields.filter((field) => field.kind !== 'link' && !((field.kind === 'text' || field.kind === 'heading') && field.inLink));
  if (content.length === 0) return false;
  return fields.length >= 2 || fields[0]?.kind === 'picture';
}

/** Data words for a block's element: its tag and its first class words, letters, digits, `-` and `_` only. */
function describe(el: Element): string {
  const tag = /^[a-z][a-z0-9-]*$/.test(el.tagName) ? el.tagName : 'element';
  const words = classWords(el)
    .filter((word) => /^[A-Za-z0-9_-]{1,40}$/.test(word))
    .slice(0, 4);
  return plainWords([tag, ...words].join('.'), SHAPE_MAX);
}

interface BlockKind {
  shape: string;
  pages: string[];
  instances: RawField[][];
}

/** Records the repeated blocks of one page into `kinds`, keyed by the shape of the block's own element. */
function findBlocks(body: ParentNode, page: string, shapes: Shapes, kinds: Map<number, BlockKind>): void {
  const lookedInto = (el: Element): boolean =>
    el.namespaceURI === HTML_NS && !isHtml(el, ...NOT_BLOCKS) && !NOT_BLOCK_ROLES.has((attrOf(el, 'role') ?? '').trim().toLowerCase());

  /** Records a set of same-shape siblings as a block, unless it is not one. */
  const block = (members: readonly Element[]): boolean => {
    const cores = members.map(coreOf);
    const instances = cores.map((core) => fieldsOf(core, page, shapes));
    const first = instances[0] ?? [];
    // A row of cards repeated is layout: its cards are the block.
    if (first.length > 0 && first.every((field) => field.inner)) return false;
    if (!isContent(mergeFields(instances))) return false;
    const core = cores[0];
    if (core === undefined) return false;
    const id = shapes.shapeOf(core);
    let kind = kinds.get(id);
    if (kind === undefined) {
      if (kinds.size >= LIST_MAX) return true;
      kind = { shape: describe(core), pages: [], instances: [] };
      kinds.set(id, kind);
    }
    if (!kind.pages.includes(page)) kind.pages.push(page);
    kind.instances.push(...instances);
    return true;
  };

  const walk = (parent: ParentNode, depth: number): void => {
    if (depth > WALK_DEPTH_MAX) return;
    const groups = shapes.groupsOf(parent);
    const taken = new Set<Element>();
    for (const child of elementsIn(parent)) {
      if (taken.has(child) || !lookedInto(child)) continue;
      const same = groups.get(shapes.shapeOf(child)) ?? [];
      if (same.length >= 2 && same[0] === child && block(same)) {
        for (const member of same) taken.add(member);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  walk(body, 0);
}

function blocksOf(kinds: Map<number, BlockKind>): FoundBlock[] {
  return [...kinds.values()].map((kind, index) => {
    const fields = mergeFields(kind.instances);
    const names = new Map(fields.map((field) => [field.key, field.name]));
    const contents = new Set<string>();
    const samples: Record<string, string>[] = [];
    let filler = 0;
    for (const instance of kind.instances) {
      const content = JSON.stringify(instance.map((field) => [field.key, field.value]));
      if (contents.has(content)) {
        filler += 1;
        continue;
      }
      contents.add(content);
      if (samples.length >= SAMPLES_MAX) continue;
      const sample: Record<string, string> = {};
      for (const field of instance) {
        const name = names.get(field.key);
        if (name !== undefined) sample[name] = field.value;
      }
      samples.push(sample);
    }
    return {
      id: `block-${String(index + 1)}`,
      pages: kind.pages,
      count: kind.instances.length,
      filler,
      fields: fields.map(({ name, kind: fieldKind }) => ({ name, kind: fieldKind })),
      samples,
      shape: kind.shape,
    };
  });
}

// ---- forms ----

type Purpose = FoundForm['purpose'];
type FormField = FoundForm['fields'][number];

/** Inputs that send what they are, not what a person types. */
const NOT_TYPED = new Set(['submit', 'button', 'reset', 'image', 'hidden']);
/** The parts of a card a payment form asks for, and the words that name each. */
const CARD_PARTS: [RegExp, string][] = [
  [/cc-?number|card[\s_-]?(?:number|num|no)\b|cardnumber|credit[\s_-]?card/, 'card number'],
  [/cc-?name|name[\s_-]?on[\s_-]?card|card[\s_-]?holder/, 'name on card'],
  [/cc-?exp|expir|\bexp[\s_-]?(?:date|month|year|mm|yy)|\bmm\s*\/\s*yy/, 'expiry'],
  [/cc-?csc|\bcvc2?\b|\bcvv2?\b|\bcsc\b|security[\s_-]?code|card[\s_-]?code/, 'security code'],
];
const SEARCH_NAME = /^(?:q|s|search|query|keywords?|search[_-]?(?:query|term|text)|searchterm)$/i;

interface Control {
  el: Element;
  field: FormField;
  /** Its words for guessing, lower case: name, id, type, placeholder, label, autocomplete. */
  words: string;
  card: string[];
  search: boolean;
}

function controlOf(el: Element, labels: Map<string, string>): Control | null {
  let type = el.tagName;
  if (isHtml(el, 'input')) {
    type = (attrOf(el, 'type') ?? 'text').trim().toLowerCase();
    if (!/^[a-z-]{1,24}$/.test(type)) type = 'text';
    if (NOT_TYPED.has(type)) return null;
  }
  const id = attrOf(el, 'id');
  const wrapping = closest(el, ['label']);
  const said = [id === null ? '' : (labels.get(id) ?? ''), wrapping === null ? '' : plainWords(textOf(wrapping, TEXT_SKIP), LABEL_MAX), plainWords(attrOf(el, 'aria-label') ?? '', LABEL_MAX)];
  const label = said.find((words) => words !== '') ?? '';
  const name = plainWords(attrOf(el, 'name') ?? '', NAME_MAX);
  const placeholder = plainWords(attrOf(el, 'placeholder') ?? '', LABEL_MAX);
  const words = [name, id ?? '', type, placeholder, label, attrOf(el, 'autocomplete') ?? ''].join(' ').toLowerCase();
  return {
    el,
    field: { name: name === '' ? null : name, type, required: attrOf(el, 'required') !== null, label: label === '' ? null : label, placeholder: placeholder === '' ? null : placeholder },
    words,
    card: CARD_PARTS.filter(([pattern]) => pattern.test(words)).map(([, part]) => part),
    search: type === 'search' || SEARCH_NAME.test(name) || SEARCH_NAME.test(id ?? '') || /^search\b/.test(placeholder.toLowerCase()),
  };
}

/** What a form is for, from its fields' types and the words in and around them. */
function purposeOf(controls: readonly Control[], formWords: string): Purpose {
  const words = `${formWords} ${controls.map((control) => control.words).join(' ')}`;
  const types = controls.map((control) => control.field.type);
  const passwords = types.filter((type) => type === 'password').length;
  if (passwords > 0) return passwords >= 2 || /confirm|repeat|retype|sign[\s_-]?up|register|create[\s_-]+(?:an[\s_-]+)?account/.test(words) ? 'signup' : 'login';
  if (/\brole=search\b/.test(formWords) || controls.some((control) => control.search)) return 'search';
  if (controls.length <= 2 && /coupon|promo|voucher|discount|gift[\s_-]?card/.test(words)) return 'coupon';
  if (controls.some((control) => control.card.length > 0)) return 'checkout';
  if (controls.length >= 3 && /billing|shipping|address|country|postcode|post[\s_-]code|\bzip\b|\bcity\b/.test(words)) return 'checkout';
  const emails = controls.filter((control) => control.field.type === 'email' || /e-?mail/.test(control.field.name?.toLowerCase() ?? ''));
  const message = controls.some((control) => control.field.type === 'textarea' || /message|comment|enquiry|inquiry/.test(control.words));
  if (message && (emails.length > 0 || controls.length >= 2)) return 'contact';
  if (emails.length > 0 && controls.length - emails.length <= 1 && (controls.length === 1 || /subscribe|newsletter|sign[\s_-]?up/.test(words))) return 'newsletter';
  return 'other';
}

/** The words a form says about itself: its id, class, action and role, its buttons and legend. */
function formWordsOf(container: Element, inside: readonly Element[]): string {
  const own = ['id', 'class', 'action', 'aria-label'].map((name) => attrOf(container, name) ?? '');
  const role = attrOf(container, 'role');
  const said = inside
    .filter((el) => isHtml(el, 'button', 'legend') || (isHtml(el, 'input') && ['submit', 'button'].includes((attrOf(el, 'type') ?? '').toLowerCase())))
    .map((el) => (isHtml(el, 'input') ? (attrOf(el, 'value') ?? '') : textOf(el)));
  return `${role === null ? '' : `role=${role}`} ${[...own, ...said].join(' ')}`.toLowerCase();
}

// ---- features ----

type FeatureKind = FoundFeature['kind'];

/** Chat widgets and analytics, by the address they load from or the words of their inline script. */
const VENDORS: { kind: 'chat-widget' | 'analytics'; name: string; url: RegExp; text: RegExp }[] = [
  { kind: 'chat-widget', name: 'Tawk.to', url: /(?:^|\.)tawk\.to\//, text: /Tawk_API|embed\.tawk\.to/ },
  { kind: 'chat-widget', name: 'Crisp', url: /(?:^|\.)crisp\.chat\//, text: /\$crisp|client\.crisp\.chat/ },
  { kind: 'chat-widget', name: 'Intercom', url: /(?:^|\.)intercom(?:cdn)?\.(?:io|com)\//, text: /Intercom\(|widget\.intercom\.io|intercomSettings/ },
  { kind: 'chat-widget', name: 'Drift', url: /(?:^|\.)(?:drift\.com|driftt\.com)\//, text: /drift\.load|js\.driftt\.com/ },
  { kind: 'chat-widget', name: 'LiveChat', url: /(?:^|\.)(?:livechatinc|livechat)\.com\//, text: /__lc\.license|LiveChatWidget|livechatinc\.com/ },
  { kind: 'chat-widget', name: 'Zendesk chat', url: /(?:^|\.)(?:zdassets|zendesk|zopim)\.com\//, text: /\bzE\(|zdassets\.com|zopim/ },
  { kind: 'chat-widget', name: 'Messenger chat', url: /^connect\.facebook\.net\/.*customerchat/, text: /customerchat|fb-customerchat/ },
  { kind: 'analytics', name: 'Facebook Pixel', url: /^connect\.facebook\.net\/.*fbevents/, text: /\bfbq\(|fbevents\.js/ },
  { kind: 'analytics', name: 'Google Tag Manager', url: /(?:^|\.)googletagmanager\.com\/gtm/, text: /googletagmanager\.com\/gtm|GTM-[A-Z0-9]+/ },
  { kind: 'analytics', name: 'Google Analytics', url: /(?:^|\.)(?:google-analytics\.com|googletagmanager\.com)\//, text: /google-analytics\.com|\bgtag\(|\bga\(\s*['"]create/ },
  { kind: 'analytics', name: 'Plausible', url: /(?:^|\.)plausible\.io\//, text: /plausible\.io|\bplausible\(/ },
  { kind: 'analytics', name: 'Matomo', url: /matomo|piwik/, text: /\b_paq\b|matomo|piwik/ },
  { kind: 'analytics', name: 'Hotjar', url: /(?:^|\.)hotjar\.com\//, text: /hotjar|_hjSettings/ },
];
const VIDEO_HOST = /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)$/;
const isMap = (host: string, path: string): boolean =>
  /(?:^|\.)openstreetmap\.org$/.test(host) || /^maps\.google\./.test(host) || /(?:^|\.)mapbox\.com$/.test(host) || (/(?:^|\.)google(?:apis)?\.[a-z.]+$/.test(host) && /^\/maps\b/.test(path));
/** Script types a browser runs; any other (`application/ld+json`, a template) is data. */
const RUNS = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript)|text\/jscript)$/i;
const CSS_REMOTE = /(?:url\(\s*['"]?|@import\s+['"])((?:https?:)?\/\/[^'")\s]+)/gi;

class Features {
  readonly list: FoundFeature[] = [];
  private readonly byKey = new Map<string, FoundFeature>();

  add(kind: FeatureKind, detail: string, page: string): void {
    const words = plainWords(detail, DETAIL_MAX);
    const key = `${kind}\n${words}`;
    let feature = this.byKey.get(key);
    if (feature === undefined) {
      if (this.list.length >= LIST_MAX) return;
      feature = { id: `feature-${String(this.list.length + 1)}`, kind, pages: [], detail: words };
      this.byKey.set(key, feature);
      this.list.push(feature);
    }
    if (!feature.pages.includes(page)) feature.pages.push(page);
  }

  /** A file the page loads from another site. */
  host(raw: string, page: string): void {
    const remote = remoteOf(raw);
    if (remote !== null) this.add('other-host', remote.host, page);
  }

  script(el: Element, page: string): void {
    if (!RUNS.test((attrOf(el, 'type') ?? '').trim())) return;
    const src = attrOf(el, 'src');
    if (src !== null) {
      const remote = remoteOf(src);
      if (remote === null) {
        this.add('script', resolveSitePath(page, src) ?? src, page);
        return;
      }
      const where = `${remote.host}${remote.path}`;
      const vendor = VENDORS.find((one) => one.url.test(where));
      if (vendor !== undefined) this.add(vendor.kind, vendor.name, page);
      else if (isMap(remote.host, remote.path)) this.add('map', remote.host, page);
      else this.add('script', where, page);
      this.add('other-host', remote.host, page);
      return;
    }
    const text = textOf(el, []);
    if (text.trim() === '') return;
    this.add('script', 'inline scripts', page);
    for (const vendor of VENDORS) if (vendor.text.test(text)) this.add(vendor.kind, vendor.name, page);
  }

  frame(el: Element, page: string): void {
    const src = attrOf(el, 'src');
    const remote = src === null ? null : remoteOf(src);
    if (remote === null) this.add('frame', src === null || src.trim() === '' ? 'inline frame' : (resolveSitePath(page, src) ?? src), page);
    else if (VIDEO_HOST.test(remote.host)) this.add('video', remote.host, page);
    else if (isMap(remote.host, remote.path)) this.add('map', remote.host, page);
    else this.add('frame', remote.host, page);
  }

  styles(text: string, page: string): void {
    for (const found of text.matchAll(CSS_REMOTE)) if (found[1] !== undefined) this.host(found[1], page);
  }
}

// ---- links that lead nowhere ----

const NOWHERE = /^(?:#|javascript:(?:void\(0\);?|;?)?)$/i;
const ICON_CLASS = /^(?:fa|fab|fas|far|bi|icon|ti|la|lab|ion|mdi|ri)-([a-z][a-z0-9-]{1,30})$/;

/** What a link says: its text, its aria-label or title, its icon, its picture's alt. */
function linkTextOf(a: Element): string {
  const text = plainWords(textOf(a, TEXT_SKIP), LINK_TEXT_MAX);
  if (text !== '') return text;
  for (const name of ['aria-label', 'title']) {
    const said = plainWords(attrOf(a, name) ?? '', LINK_TEXT_MAX);
    if (said !== '') return said;
  }
  for (const el of elementsBelow(a)) {
    const icon = classWords(el)
      .map((word) => ICON_CLASS.exec(word.toLowerCase())?.[1])
      .find((word) => word !== undefined && !/^(?:fw|lg|xs|sm|[0-9]x|solid|regular|brands)$/.test(word));
    if (icon !== undefined) return plainWords(`${icon} icon`, LINK_TEXT_MAX);
    if (isHtml(el, 'img')) {
      const alt = plainWords(attrOf(el, 'alt') ?? '', LINK_TEXT_MAX);
      if (alt !== '') return alt;
    }
  }
  return '';
}

// ---- the cart ----

function cartOf(pages: readonly { path: string; title: string | null }[]): SiteFacts['cart'] {
  let cart: string | null = null;
  let checkout: string | null = null;
  let thanks: string | null = null;
  for (const page of pages) {
    const words = `${page.path.replace(/\.[^./]*$/, '')} ${page.title ?? ''}`.toLowerCase();
    if (/thank[\s_-]?you|thankyou|thanks|order[\s_-]?(?:complete|confirm|received|success|placed)/.test(words)) thanks ??= page.path;
    else if (/check[\s_-]?out/.test(words)) checkout ??= page.path;
    else if (/(?:^|[^a-z])(?:cart|basket)(?:[^a-z]|$)/.test(words)) cart ??= page.path;
  }
  return cart === null && checkout === null ? null : { cart, checkout, thanks };
}

// ---- one page ----

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Finds what a site template's pages hold. Gives the event loop a turn between pages, and stops between pages when `signal` is aborted. */
export async function findInSite(pages: readonly { path: string; html: string }[], opts: { signal?: AbortSignal } = {}): Promise<SiteFacts> {
  const shapes = new Shapes();
  const kinds = new Map<number, BlockKind>();
  const features = new Features();
  const facts: SiteFacts = { pages: [], blocks: [], forms: [], cart: null, features: features.list, links: [] };
  const linkTexts = new Set<string>();

  for (const { path: page, html } of pages) {
    opts.signal?.throwIfAborted();
    await pause();
    opts.signal?.throwIfAborted();
    const document = parse(html);
    await pause();
    opts.signal?.throwIfAborted();

    const all = elementsBelow(document);
    const root = document.childNodes.find((child): child is Element => isElement(child) && child.tagName === 'html');
    const body = root?.childNodes.find((child): child is Element => isElement(child) && child.tagName === 'body');
    const titleEl = all.find((el) => isHtml(el, 'title') && closest(el, ['head']) !== null);
    const title = titleEl === undefined ? '' : plainWords(textOf(titleEl), TITLE_MAX);
    facts.pages.push({ path: page, title: title === '' ? null : title });

    if (body !== undefined) findBlocks(body, page, shapes, kinds);

    const labels = new Map<string, string>();
    for (const el of all) {
      const target = isHtml(el, 'label') ? attrOf(el, 'for') : null;
      if (target !== null && !labels.has(target)) labels.set(target, plainWords(textOf(el, TEXT_SKIP), LABEL_MAX));
    }

    const formed = new Set<Element>();
    const cardParts = new Set<string>();
    const addForm = (container: Element, method: 'get' | 'post', action: string | null): void => {
      const inside = elementsBelow(container);
      const controls = inside
        .filter((el) => isHtml(el, 'input', 'select', 'textarea') && (isHtml(container, 'form') || closest(el, ['form']) === null))
        .map((el) => controlOf(el, labels))
        .filter((control) => control !== null);
      for (const el of inside) formed.add(el);
      formed.add(container);
      if (facts.forms.length >= LIST_MAX) return;
      facts.forms.push({
        id: `form-${String(facts.forms.length + 1)}`,
        page,
        purpose: purposeOf(controls, formWordsOf(container, inside)),
        method,
        action,
        fields: controls.map((control) => control.field),
      });
    };

    for (const el of all) {
      const style = attrOf(el, 'style');
      if (style !== null) features.styles(style, page);
      if (el.tagName === 'script') {
        features.script(el, page);
        continue;
      }
      if (el.namespaceURI !== HTML_NS) continue;
      switch (el.tagName) {
        case 'link': {
          const rel = (attrOf(el, 'rel') ?? '').toLowerCase().split(/\s+/);
          if (rel.some((word) => ['stylesheet', 'preload', 'modulepreload', 'icon', 'font'].includes(word))) features.host(attrOf(el, 'href') ?? '', page);
          break;
        }
        case 'style':
          features.styles(textOf(el, []), page);
          break;
        case 'iframe':
          features.frame(el, page);
          break;
        case 'video': {
          const source = [el, ...elementsBelow(el)].map((one) => attrOf(one, 'src')).find((src) => src !== null) ?? null;
          const remote = source === null ? null : remoteOf(source);
          features.add('video', remote?.host ?? 'video element', page);
          if (remote !== null) features.add('other-host', remote.host, page);
          break;
        }
        case 'img':
          features.host(attrOf(el, 'src') ?? '', page);
          break;
        case 'a': {
          const href = attrOf(el, 'href')?.replace(/\s+/g, '') ?? null;
          if (href === null || (href !== '' && !NOWHERE.test(href))) break;
          const text = linkTextOf(el);
          const key = text.toLowerCase();
          if (text === '' || linkTexts.has(key) || facts.links.length >= LIST_MAX) break;
          linkTexts.add(key);
          facts.links.push({ id: `link-${String(facts.links.length + 1)}`, page, text });
          break;
        }
        case 'form': {
          const action = attrOf(el, 'action');
          addForm(el, (attrOf(el, 'method') ?? '').trim().toLowerCase() === 'post' ? 'post' : 'get', action === null ? null : plainWords(action, ACTION_MAX));
          if ((attrOf(el, 'role') ?? '').toLowerCase() === 'search') features.add('search', 'search box', page);
          break;
        }
        case 'input':
        case 'select':
        case 'textarea': {
          const control = controlOf(el, labels);
          if (control === null) break;
          if (control.field.type === 'password') features.add('password', 'password field', page);
          if (control.search) features.add('search', 'search box', page);
          for (const part of control.card) cardParts.add(part);
          // An email box with a button beside it and no form around it is a form too (a newsletter box wired by a script).
          if (control.field.type === 'email' && !formed.has(el) && closest(el, ['form']) === null) {
            let box: Element | null = null;
            for (let up = el.parentNode, level = 0; up !== null && isElement(up) && level < 3 && !isHtml(up, 'body'); up = up.parentNode, level += 1) {
              if (elementsBelow(up).some((one) => isHtml(one, 'button') || (isHtml(one, 'input') && ['submit', 'button'].includes((attrOf(one, 'type') ?? '').toLowerCase())))) {
                box = up;
                break;
              }
            }
            if (box !== null) addForm(box, 'get', null);
          }
          break;
        }
        default:
          if (classWords(el).includes('fb-customerchat')) features.add('chat-widget', 'Messenger chat', page);
      }
    }
    if (cardParts.size > 0) features.add('card-payment', CARD_PARTS.map(([, part]) => part).filter((part) => cardParts.has(part)).join(', '), page);
  }

  facts.blocks = blocksOf(kinds);
  facts.cart = cartOf(facts.pages);
  return facts;
}

// ---- as text for the model ----

/** A site path as data words: bare when it is only letters, digits and the usual marks, quoted otherwise. */
function pathWords(path: string): string {
  const words = plainWords(path, 120);
  return /^[A-Za-z0-9._/@+-]+$/.test(words) ? words : JSON.stringify(words);
}

/** Facts as plain text lines for the model (the caller wraps it as DATA). At most `maxChars` characters; what is cut is said in a last line. */
export function factsText(facts: SiteFacts, maxChars: number): string {
  const lines: string[] = [];
  const pages = facts.pages.map((page) => `${pathWords(page.path)}${page.title === null ? '' : ` ${quoted(page.title, 60)}`}`);
  for (let at = 0; at < Math.max(1, pages.length); at += 12) lines.push(`${at === 0 ? 'Pages' : 'More pages'}: ${pages.slice(at, at + 12).join(' | ') || 'none'}`);

  if (facts.blocks.length === 0) lines.push('Repeated blocks: none found.');
  for (const block of facts.blocks) {
    const fields = block.fields.map((field) => `${field.name} (${field.kind})`).join(', ');
    const samples = block.samples
      .slice(0, 2)
      .map((sample) => Object.entries(sample).map(([name, value]) => `${name} ${quoted(value, 40)}`).join(', '))
      .join(' | ');
    lines.push(
      `${block.id} ${block.shape}: on ${block.pages.map(pathWords).join(', ')}; ${String(block.count)} shown, ${String(block.filler)} filler; fields ${fields}${samples === '' ? '' : `; e.g. ${samples}`}`,
    );
  }

  if (facts.forms.length === 0) lines.push('Forms: none found.');
  for (const form of facts.forms) {
    const fields = form.fields
      .map((field) => {
        const notes = [field.type, ...(field.required ? ['required'] : []), ...(field.label === null ? [] : [`label ${quoted(field.label, 40)}`]), ...(field.placeholder === null ? [] : [`placeholder ${quoted(field.placeholder, 40)}`])];
        return `${field.name === null ? '(no name)' : quoted(field.name, 40)} (${notes.join(', ')})`;
      })
      .join(', ');
    lines.push(`${form.id} on ${pathWords(form.page)}: ${form.purpose}, ${form.method}${form.action === null ? '' : ` to ${quoted(form.action, 60)}`}; fields ${fields === '' ? 'none' : fields}`);
  }

  const cart = facts.cart;
  const pageOrNone = (path: string | null): string => (path === null ? 'none' : pathWords(path));
  lines.push(cart === null ? 'Cart: none' : `Cart: ${pageOrNone(cart.cart)}, checkout ${pageOrNone(cart.checkout)}, thanks ${pageOrNone(cart.thanks)}`);

  for (const feature of facts.features) lines.push(`${feature.id} ${feature.kind} on ${feature.pages.map(pathWords).join(', ')}: ${quoted(feature.detail, DETAIL_MAX)}`);
  for (const link of facts.links) lines.push(`${link.id} on ${pathWords(link.page)}: ${quoted(link.text, LINK_TEXT_MAX)}`);

  // Whole lines are cut from the end, and the last line says how many.
  let length = -1;
  const ends = lines.map((line) => (length += line.length + 1));
  if ((ends.at(-1) ?? 0) <= maxChars) return lines.join('\n');
  for (let keep = lines.length - 1; keep >= 0; keep -= 1) {
    const cut = `… and ${String(lines.length - keep)} more lines cut`;
    const before = keep === 0 ? 0 : (ends[keep - 1] ?? 0) + 1;
    if (before + cut.length <= maxChars) return [...lines.slice(0, keep), cut].join('\n');
  }
  return `… and ${String(lines.length)} more lines cut`.slice(0, Math.max(0, maxChars));
}
