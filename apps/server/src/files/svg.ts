// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CLEANED SVG: a drawing that can carry nothing but its drawing.
 *
 * An SVG is an XML document, and a browser runs what is in it: a `<script>`,
 * an `onload`, a `<foreignObject>` holding a web page, a link to anywhere. So
 * an SVG is kept only as this module writes it again, from its own tree:
 *
 *  - READ BY A STRICT XML READER WRITTEN FOR SVG, not by an HTML parser (an
 *    HTML parser and the browser's XML parser disagree about the same bytes,
 *    and the disagreement is where script gets through). It refuses what SVG
 *    drawings never need and XML tricks always use: a DOCTYPE, any entity but
 *    the five built-in ones and character references, processing
 *    instructions (but the XML declaration at the very start), CDATA, and any
 *    namespace but SVG's and xlink's — save Inkscape's own two (`inkscape:`,
 *    `sodipodi:`), which hold the editor's notes about the drawing (its
 *    layers' names, its page, how a path's nodes are edited) and never what
 *    is drawn: their elements, their attributes and their declarations are
 *    dropped, so a drawing saved as "Inkscape SVG" is taken. A document that
 *    is not well formed is refused, never repaired.
 *  - KEPT FROM AN ALLOW-LIST of elements (shapes, paths, groups, `defs`,
 *    `symbol`, gradients, `clipPath`, `mask`, `use`, `text`/`tspan`,
 *    `title`/`desc`) and attributes (geometry, paint, text and font ones). A
 *    `<script>` or `<metadata>` is dropped with what is in it, an event
 *    handler (`on…`) and a few attributes that draw nothing (`class`,
 *    `data-…`, `aria-…`, `role`, `version`) are dropped: what is drawn is the
 *    same without them. Anything else that could change what is drawn — a
 *    `<foreignObject>`, an `<image>`, a `<style>`, a filter, an unknown
 *    attribute, a link to anything but `#id` — is REFUSED, naming it, rather
 *    than stripped: a drawing with a part quietly missing is a wrong product.
 *  - `href` (or `xlink:href`) only on `use` and gradients, and only `#id`;
 *    `style` only properties of a short list, and no `url(` but `url(#id)`.
 *  - WRITTEN FROM THE TREE: the stored copy is this module's own output,
 *    never the input with bits cut out, so what was checked is what is kept.
 *    Cleaning that output again gives the same bytes (a file column checks a
 *    named SVG that way, `files/column-judge.ts`).
 *
 * Served to a browser as `image/svg+xml` with a content policy that runs
 * nothing (`svgHeaders`), and `nosniff`.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** The headers a cleaned SVG is served with: nothing runs, nothing is fetched, inline styles only. */
export const SVG_CONTENT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Why an SVG is not kept, in a sentence the person reads. */
export class SvgRefused extends Error {
  override readonly name = 'SvgRefused';
}

function refuse(message: string): never {
  throw new SvgRefused(message);
}

/** Bounds on the tree, so a drawing cannot be a way to exhaust the server. */
const MAX_DEPTH = 64;
const MAX_ELEMENTS = 100_000;
const MAX_ATTRIBUTES = 128;

/** The drawing elements kept. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'use',
  'text',
  'tspan',
  'title',
  'desc',
]);

/**
 * An editor's own namespaces, by the prefix it writes them with: Inkscape's,
 * and Sodipodi's (Inkscape's ancestor, still written by it). What they say is
 * about the drawing, never in it, so an element of theirs is dropped with all
 * it holds (`sodipodi:namedview`, the page and its grid), an attribute of
 * theirs is dropped, and a declaration of theirs is dropped when it names
 * their own namespace (and refused when it names any other).
 */
const EDITOR_NAMESPACES: Readonly<Record<string, string>> = {
  inkscape: 'http://www.inkscape.org/namespaces/inkscape',
  sodipodi: 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
};
const editorName = (name: string): boolean => {
  const colon = name.indexOf(':');
  return colon > 0 && Object.prototype.hasOwnProperty.call(EDITOR_NAMESPACES, name.slice(0, colon));
};

/** Elements that draw nothing, dropped with all they hold. */
const DROPPED_ELEMENTS = new Set(['script', 'metadata']);

/** Elements whose text is kept: what text draws, and a drawing's name. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);

/** Elements that may point at another by `#id`. */
const HREF_ELEMENTS = new Set(['use', 'linearGradient', 'radialGradient']);

/** Properties a `style` attribute may set; each is also an attribute of the same name. */
const PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'display',
  'visibility',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'vector-effect',
  'paint-order',
  'shape-rendering',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'text-decoration',
  'writing-mode',
  'direction',
  'unicode-bidi',
  'mix-blend-mode',
];
const STYLE_PROPERTIES = new Set(PAINT_PROPERTIES);

/** Attributes kept, on any kept element. */
const ATTRIBUTES = new Set([
  ...PAINT_PROPERTIES,
  'id',
  'xml:space',
  'xml:lang',
  'lang',
  'transform',
  'style',
  // The drawing's frame.
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  // Shapes.
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'd',
  'pathLength',
  // Gradients, clips and masks.
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'fr',
  'offset',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  // Text.
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
]);

/** Attributes that draw nothing, dropped. */
const DROPPED_ATTRIBUTES = new Set(['class', 'version', 'baseProfile', 'focusable', 'enable-background', 'role']);
const droppedAttribute = (name: string): boolean =>
  DROPPED_ATTRIBUTES.has(name) || /^on[a-z]/i.test(name) || name.startsWith('data-') || name.startsWith('aria-');

/** Style properties that draw nothing in a browser (an editor's own), dropped. */
const droppedProperty = (name: string): boolean => name.startsWith('-') || name === 'enable-background';

const ID = /^[A-Za-z_][\w.:-]*$/;
const LOCAL_REF = /^#([A-Za-z_][\w.:-]*)$/;
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

/* ────────────────────────────────────────────────────────────── the reader */

interface SvgElement {
  name: string;
  attributes: [string, string][];
  children: (SvgElement | string)[];
}

/** Whether a code point may appear in an XML 1.0 document. */
function xmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

const BUILT_IN: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Text or an attribute value with its references read: the five built-in ones and characters, nothing else. */
function unescape(raw: string): string {
  return raw.replace(/&([^;&\s]{0,12});?/g, (whole, body: string) => {
    if (!whole.endsWith(';')) refuse('This SVG has an "&" that is not a reference.');
    const named = BUILT_IN[body];
    if (named !== undefined) return named;
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (numeric === null) refuse(`This SVG uses the entity &${body}; — only the built-in ones are taken.`);
    const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2]!, 10);
    if (!xmlChar(code)) refuse('This SVG has a character reference to a character XML does not allow.');
    return String.fromCodePoint(code);
  });
}

/** Reads one document into a tree, strictly. */
class Reader {
  private at = 0;
  private elements = 0;

  constructor(private readonly text: string) {}

  read(): SvgElement {
    const { text } = this;
    for (const char of text) {
      if (!xmlChar(char.codePointAt(0)!)) refuse('This SVG has a character XML does not allow.');
    }
    // The XML declaration, only at the very start.
    if (text.startsWith('<?xml')) {
      const end = text.indexOf('?>');
      const declaration = end < 0 ? '' : text.slice(0, end + 2);
      if (!/^<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])utf-8\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/i.test(declaration)) {
        refuse('This SVG starts with an XML declaration that is not a plain UTF-8 one.');
      }
      this.at = end + 2;
    }
    this.misc();
    if (!this.peek('<') || this.peek('</')) refuse('This is not an SVG drawing.');
    const root = this.element(0);
    this.misc();
    if (this.at !== text.length) refuse('This SVG has something after its drawing.');
    return root;
  }

  private peek(what: string): boolean {
    return this.text.startsWith(what, this.at);
  }

  /** Whitespace and comments around the root; anything else that is markup is refused by name. */
  private misc(): void {
    for (;;) {
      while (this.at < this.text.length && /\s/.test(this.text[this.at]!)) this.at += 1;
      if (this.peek('<!--')) this.comment();
      else {
        this.forbidden();
        return;
      }
    }
  }

  /** The markup refused wherever it appears. */
  private forbidden(): void {
    if (this.peek('<!DOCTYPE') || this.peek('<!doctype')) refuse('This SVG has a DOCTYPE, which is not taken (it can define entities).');
    if (this.peek('<![CDATA[')) refuse('This SVG has a CDATA section, which is not taken.');
    if (this.peek('<!')) refuse('This SVG has a declaration, which is not taken.');
    if (this.peek('<?')) refuse('This SVG has a processing instruction, which is not taken.');
  }

  private comment(): void {
    const end = this.text.indexOf('-->', this.at + 4);
    if (end < 0) refuse('This SVG has a comment that never ends.');
    if (this.text.slice(this.at + 4, end).includes('--')) refuse('This SVG has a comment that is not well formed.');
    this.at = end + 3;
  }

  private name(): string {
    const match = /^[^\s/>=<"']+/.exec(this.text.slice(this.at, this.at + 256));
    if (match === null || !NAME.test(match[0])) refuse('This SVG has a name that is not well formed.');
    this.at += match[0].length;
    return match[0];
  }

  private space(): boolean {
    const start = this.at;
    while (this.at < this.text.length && /\s/.test(this.text[this.at]!)) this.at += 1;
    return this.at > start;
  }

  private element(depth: number): SvgElement {
    if (depth >= MAX_DEPTH) refuse('This SVG is nested too deeply.');
    if ((this.elements += 1) > MAX_ELEMENTS) refuse('This SVG has too many parts.');
    this.at += 1; // '<'
    const name = this.name();
    const attributes: [string, string][] = [];
    const seen = new Set<string>();
    for (;;) {
      const spaced = this.space();
      if (this.peek('/>')) {
        this.at += 2;
        return { name, attributes, children: [] };
      }
      if (this.peek('>')) {
        this.at += 1;
        break;
      }
      if (!spaced) refuse('This SVG has attributes that are not well formed.');
      const attribute = this.name();
      this.space();
      if (!this.peek('=')) refuse(`This SVG's attribute ${attribute} has no value.`);
      this.at += 1;
      this.space();
      const quote = this.text[this.at];
      if (quote !== '"' && quote !== "'") refuse(`This SVG's attribute ${attribute} is not quoted.`);
      const end = this.text.indexOf(quote, this.at + 1);
      if (end < 0) refuse(`This SVG's attribute ${attribute} never ends.`);
      const raw = this.text.slice(this.at + 1, end);
      if (raw.includes('<')) refuse(`This SVG's attribute ${attribute} holds a "<".`);
      this.at = end + 1;
      if (seen.has(attribute)) refuse(`This SVG gives ${attribute} twice on one element.`);
      seen.add(attribute);
      if (attributes.length >= MAX_ATTRIBUTES) refuse('This SVG has an element with too many attributes.');
      // Attribute-value normalization: a literal tab or line break reads as a space; a reference to one does not.
      attributes.push([attribute, unescape(raw.replace(/[\t\n]/g, ' '))]);
    }
    const children: (SvgElement | string)[] = [];
    const text = (value: string): void => {
      const last = children[children.length - 1];
      if (typeof last === 'string') children[children.length - 1] = last + value;
      else children.push(value);
    };
    for (;;) {
      if (this.at >= this.text.length) refuse(`This SVG's <${name}> is never closed.`);
      if (this.peek('</')) {
        this.at += 2;
        const closing = this.name();
        this.space();
        if (closing !== name || !this.peek('>')) refuse(`This SVG closes <${name}> with </${closing}>.`);
        this.at += 1;
        return { name, attributes, children };
      }
      if (this.peek('<!--')) {
        this.comment();
        continue;
      }
      this.forbidden();
      if (this.peek('<')) {
        children.push(this.element(depth + 1));
        continue;
      }
      const next = this.text.indexOf('<', this.at);
      const raw = this.text.slice(this.at, next < 0 ? this.text.length : next);
      if (raw.includes(']]>')) refuse('This SVG has "]]>" in its text.');
      text(unescape(raw));
      this.at += raw.length;
    }
  }
}

/* ───────────────────────────────────────────────────────────── the cleaner */

/** The most names a cleaning lists of what it took out; past it, the list stops (the drawing is cleaned all the same). */
export const SVG_REMOVED_MAX = 40;

/** An editor's element or attribute, as the one entry its editor's notes are listed under. */
const editorNotes = (name: string): string => `${name.slice(0, name.indexOf(':'))}:*`;

/**
 * What a cleaning took out, by name, each once, in the order first met: an
 * element as `<script>` (with all it held), an attribute or a style property
 * by its own name (`onload`, `class`, `-inkscape-font-specification`). An
 * editor's notes are one entry for each editor (`inkscape:*`), however many
 * there were: a drawing saved by Inkscape carries dozens, and they are one
 * thing to the person. Namespace declarations, comments and the spaces
 * between parts are not listed: they draw nothing and say nothing of the
 * drawing.
 */
class Removed {
  private readonly names = new Set<string>();

  add(name: string): void {
    if (this.names.size < SVG_REMOVED_MAX) this.names.add(name);
  }

  list(): string[] {
    return [...this.names];
  }
}

/** A paint or reference value: `url(` only as `url(#id)`, written back plainly. */
function cleanValue(name: string, value: string): string {
  if (!/url\s*\(/i.test(value)) return value;
  const match = /^\s*url\(\s*(['"]?)(#[A-Za-z_][\w.:-]*)\1\s*\)\s*(.*)$/i.exec(value);
  if (match === null || /url\s*\(/i.test(match[3]!)) refuse(`This SVG's ${name} points outside the drawing (only url(#id) is taken).`);
  return match[3] === '' ? `url(${match[2]!})` : `url(${match[2]!}) ${match[3]!}`;
}

/** A `style` attribute, held to its properties, written back as `name:value;name:value`. */
function cleanStyle(style: string, removed: Removed): string | null {
  if (/[\\<>@]|\/\*|expression\s*\(/i.test(style)) refuse('This SVG has a style that is not taken (an escape, a comment, a rule or an expression).');
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    if (declaration.trim() === '') continue;
    const colon = declaration.indexOf(':');
    if (colon < 0) refuse(`This SVG has a style that is not a property: "${declaration.trim().slice(0, 40)}".`);
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (droppedProperty(property)) {
      removed.add(property);
      continue;
    }
    if (!STYLE_PROPERTIES.has(property)) refuse(`This SVG's style sets ${property}, which is not taken.`);
    if (value === '') refuse(`This SVG's style sets ${property} to nothing.`);
    kept.push(`${property}:${cleanValue(property, value)}`);
  }
  return kept.length === 0 ? null : kept.join(';');
}

/** One element, kept from the allow-list, or null when it is one dropped with all it holds. */
function cleanElement(element: SvgElement, root: boolean, removed: Removed): { element: SvgElement; xlink: boolean } | null {
  const { name } = element;
  if (editorName(name)) {
    removed.add(editorNotes(name));
    return null;
  }
  if (name.includes(':')) refuse(`This SVG has <${name}>, from a namespace that is not SVG's.`);
  if (DROPPED_ELEMENTS.has(name)) {
    removed.add(`<${name}>`);
    return null;
  }
  if (!ELEMENTS.has(name)) refuse(`This SVG has a <${name}>, which is not taken.`);
  if (root && name !== 'svg') refuse('This is not an SVG drawing: its first element is not <svg>.');
  let xlink = false;
  const attributes: [string, string][] = [];
  for (const [attribute, value] of element.attributes) {
    if (attribute === 'xmlns') {
      if (value !== SVG_NS) refuse(`This SVG puts a part in the namespace ${value.slice(0, 80)}, which is not SVG's.`);
      continue;
    }
    if (attribute.startsWith('xmlns:')) {
      if (attribute === 'xmlns:xlink' && value === XLINK_NS) continue;
      // SVG's own namespace under a prefix (Inkscape declares `svg:`), and an editor's own: written by nothing kept.
      if (attribute === 'xmlns:svg' && value === SVG_NS) continue;
      if (editorName(attribute.slice(6) + ':') && EDITOR_NAMESPACES[attribute.slice(6)] === value) continue;
      refuse(`This SVG declares the namespace ${attribute.slice(6)}, which is not taken. Save it as a plain SVG.`);
    }
    if (attribute === 'href' || attribute === 'xlink:href') {
      if (!HREF_ELEMENTS.has(name)) refuse(`This SVG's <${name}> has a link, which is not taken.`);
      if (!LOCAL_REF.test(value.trim())) refuse('This SVG links to something outside the drawing (only #id is taken).');
      attributes.push([attribute, value.trim()]);
      if (attribute === 'xlink:href') xlink = true;
      continue;
    }
    if (droppedAttribute(attribute) || editorName(attribute)) {
      removed.add(editorName(attribute) ? editorNotes(attribute) : attribute);
      continue;
    }
    if (attribute.includes(':') && attribute !== 'xml:space' && attribute !== 'xml:lang') refuse(`This SVG has the attribute ${attribute}, from a namespace that is not taken.`);
    if (!ATTRIBUTES.has(attribute)) refuse(`This SVG has the attribute ${attribute} on <${name}>, which is not taken.`);
    if (attribute === 'id' && !ID.test(value)) refuse(`This SVG has an id that is not a plain name: "${value.slice(0, 40)}".`);
    if (attribute === 'style') {
      const style = cleanStyle(value, removed);
      if (style !== null) attributes.push(['style', style]);
      continue;
    }
    attributes.push([attribute, cleanValue(attribute, value)]);
  }
  const children: (SvgElement | string)[] = [];
  for (const child of element.children) {
    if (typeof child === 'string') {
      // Text draws only in text, and names a drawing in its title; elsewhere it is nothing.
      if (TEXT_ELEMENTS.has(name)) children.push(child);
      continue;
    }
    const kept = cleanElement(child, false, removed);
    if (kept === null) continue;
    xlink ||= kept.xlink;
    children.push(kept.element);
  }
  // Two pieces of text a dropped element stood between are one.
  const merged: (SvgElement | string)[] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (typeof child === 'string' && typeof last === 'string') merged[merged.length - 1] = last + child;
    else if (child !== '') merged.push(child);
  }
  return { element: { name, attributes, children: merged }, xlink };
}

/* ───────────────────────────────────────────────────────────── the writer */

const escapeText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

function write(element: SvgElement, out: string[], namespaces: string): void {
  out.push(`<${element.name}${namespaces}`);
  for (const [name, value] of element.attributes) out.push(` ${name}="${escapeAttribute(value)}"`);
  if (element.children.length === 0) {
    out.push('/>');
    return;
  }
  out.push('>');
  for (const child of element.children) {
    if (typeof child === 'string') out.push(escapeText(child));
    else write(child, out, '');
  }
  out.push(`</${element.name}>`);
}

/** A cleaned SVG and what the cleaning took out of it (see {@link Removed}); `removed` is empty when nothing was. */
export interface CleanedSvg {
  bytes: Buffer;
  removed: string[];
}

/**
 * An SVG, cleaned: read strictly, kept from the allow-list, written again
 * from its tree. Throws {@link SvgRefused} with the sentence the person
 * reads. Cleaning the result again gives the same bytes.
 */
export function cleanSvg(input: Buffer): Buffer {
  return cleanSvgReport(input).bytes;
}

/** As {@link cleanSvg}, saying also what was taken out, so a page can tell the person "We removed …". */
export function cleanSvgReport(input: Buffer): CleanedSvg {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    refuse('This SVG is not UTF-8 text.');
  }
  // XML's own line-end handling, before anything is read.
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const tree = new Reader(text).read();
  const removed = new Removed();
  const cleaned = cleanElement(tree, true, removed);
  if (cleaned === null) refuse('This is not an SVG drawing.');
  const out: string[] = [];
  write(cleaned.element, out, ` xmlns="${SVG_NS}"${cleaned.xlink ? ` xmlns:xlink="${XLINK_NS}"` : ''}`);
  return { bytes: Buffer.from(out.join(''), 'utf8'), removed: removed.list() };
}

/** Whether a stored file's (sniffed) type is SVG. */
export function isSvgMime(mime: string): boolean {
  return mime.toLowerCase().split(';')[0]!.trim() === 'image/svg+xml';
}
