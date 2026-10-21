// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One page of a site template, turned into a React screen file by rule, on the server.
 *
 * The page is read with parse5, which builds the tree a browser would: a stray closing tag is
 * dropped, entities are decoded, a table row gets its body. The tree is then written out as JSX.
 *
 * The screen is built into a public page that may run its own scripts, so anything that lands in
 * the file as code runs. The template's words, attribute values and file names are not trusted,
 * so nothing from them is spliced into code:
 *
 * - Every text and every attribute value is written as a JSON string literal, never as JSX text.
 * - Tag and attribute names come from a fixed list of HTML and SVG names that only draw. Any other
 *   name, or a name with a character outside letters, digits and dashes, is left out and listed.
 * - Scripts, frames, embeds, media, `<base>`, `<meta>`, `<link>`, `<template>`, SVG animation and
 *   foreign objects are taken out with all they hold. Every `on…` attribute is taken out.
 * - An address is kept only when it is a file or page the site holds, a `#` place, `mailto:`,
 *   `tel:`, or an `https:` link. Everything else (`javascript:`, `data:`, `http:`…) is taken out.
 *
 * Each thing taken out is listed in plain words, so the person and the model can read what the
 * page lost. Stylesheets, inline styles and scripts are handed back as data for others to judge.
 */
import { parse } from 'parse5';

import { attrOf, HTML_NS, isElement, isHtml, textOf, type Element, type Node, type ParentNode } from './dom.js';
import { repeatedBlockOf } from './find.js';

export interface ConvertOptions {
  /** The page's path in the site: 'index.html', 'blog/post.html'. */
  page: string;
  /** Whether the site holds a file at this site path ('/'-separated, no leading './', extension lower-cased). */
  has(path: string): boolean;
  /** The screen address of a page of the site ('index.html' → '/', 'about.html' → '/about', 'blog/index.html' → '/blog'); null when the path is not one of the site's pages. */
  screenOf(path: string): string | null;
  /** The import specifier for a site file, from the converted page: 'img/hero.png' → '../site/img/hero.png'. */
  importOf(path: string): string;
  /** The component's name: 'AboutPage'. */
  component: string;
  /** Whether a content picture becomes a spot: the spot id to draw, or null to keep it an <img>. Absent: none does. */
  spotFor?: (picture: PageImage) => string | null;
}

export interface PageImage {
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
  near: string | null;
  repeated: boolean;
  logo: boolean;
}

export interface ConvertedPage {
  tsx: string;
  /** The page's <title>, as plain text (control and bidi characters taken out, cut to 120). */
  title: string | null;
  /** <html lang>. */
  lang: string | null;
  /** The <body>'s class attribute: the screen sets it on the body. */
  bodyClass: string | null;
  /** Local stylesheets the page links (<link rel=stylesheet href>), resolved site paths, in order; other sites' stylesheets by host in `remoteStyles`. */
  stylesheets: string[];
  remoteStyles: string[];
  /** The text of the page's <style> elements, head and body, in order (the copier cleans and keeps them). */
  styles: string[];
  /** The site files the TSX imports. */
  imports: string[];
  /** Each local PNG/JPEG/GIF/WebP picture, with the spot it became (null: kept an <img>). */
  pictures: (PageImage & { spot: string | null })[];
  /** Pages of the site it links to (site paths). */
  pages: string[];
  /** What was dropped or unwrapped, in plain words ('<script> taken out', 'onclick on <button> taken out', 'a javascript: link taken out', …), at most 200. */
  dropped: string[];
  /** The scripts the page had: each local src (site path) and each inline script's text cut to 4,000 characters: read by the model as data, never copied. */
  scripts: { src: string | null; text: string | null }[];
}

/** The most a converted page may be. */
export const PAGE_TSX_MAX = 256 * 1024;
/** The most things listed as taken out. */
const DROPPED_MAX = 200;
/** How deep elements may nest; a browser stops nesting a little past this too. */
const DEPTH_MAX = 400;
const SCRIPT_TEXT_MAX = 4000;
const TITLE_MAX = 120;
const NEAR_MAX = 200;

/** A page that cannot become a screen, with one sentence naming it. */
export class ConvertRefusal extends Error {
  override readonly name = 'ConvertRefusal';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A tag or attribute name may hold letters, digits and dashes only. */
const NAME = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

/** HTML elements kept as they are. */
const HTML_KEEP = new Set(
  (
    'a abbr address area article aside b bdi bdo blockquote br button caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em ' +
    'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li main map mark menu meter nav ol optgroup ' +
    'option output p pre progress q rp rt ruby s samp search section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr'
  ).split(' '),
);
/** SVG elements kept as they are: shapes, text, paint servers, clips, masks and filters. */
const SVG_KEEP = new Set(
  (
    'svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath mask ' +
    'pattern marker image filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight ' +
    'feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting ' +
    'feSpotLight feTile feTurbulence'
  ).split(' '),
);
/** Elements taken out with everything they hold. HTML names compare in lower case. */
const HTML_DROP = new Set(
  'script style iframe object embed applet frame frameset noframes base meta link noscript template video audio canvas title param track source portal fencedframe'.split(' '),
);
const SVG_DROP = new Set([
  ...'foreignObject animate set animateMotion animateTransform animateColor discard mpath cursor handler listener'.split(' '),
  ...[...HTML_DROP].filter((name) => name !== 'title'),
]);
/** Elements whose whitespace React will not hold as text. */
const NO_TEXT = new Set('table thead tbody tfoot tr colgroup select optgroup datalist'.split(' '));
const VOID = new Set('area br col hr img input wbr'.split(' '));

/** HTML attributes kept, by their name in the page, with their React name. */
const HTML_ATTRS: Record<string, string> = {
  id: 'id',
  class: 'className',
  title: 'title',
  lang: 'lang',
  dir: 'dir',
  role: 'role',
  translate: 'translate',
  draggable: 'draggable',
  tabindex: 'tabIndex',
  accesskey: 'accessKey',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  autocapitalize: 'autoCapitalize',
  alt: 'alt',
  width: 'width',
  height: 'height',
  sizes: 'sizes',
  loading: 'loading',
  decoding: 'decoding',
  fetchpriority: 'fetchPriority',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  usemap: 'useMap',
  target: 'target',
  rel: 'rel',
  hreflang: 'hrefLang',
  download: 'download',
  type: 'type',
  name: 'name',
  placeholder: 'placeholder',
  min: 'min',
  max: 'max',
  step: 'step',
  maxlength: 'maxLength',
  minlength: 'minLength',
  pattern: 'pattern',
  size: 'size',
  cols: 'cols',
  rows: 'rows',
  wrap: 'wrap',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  headers: 'headers',
  scope: 'scope',
  span: 'span',
  abbr: 'abbr',
  for: 'htmlFor',
  label: 'label',
  datetime: 'dateTime',
  start: 'start',
  low: 'low',
  high: 'high',
  optimum: 'optimum',
  autocomplete: 'autoComplete',
  inputmode: 'inputMode',
  enterkeyhint: 'enterKeyHint',
  list: 'list',
  accept: 'accept',
  form: 'form',
  shape: 'shape',
  coords: 'coords',
  popover: 'popover',
  popovertarget: 'popoverTarget',
  popovertargetaction: 'popoverTargetAction',
  align: 'align',
  valign: 'valign',
  bgcolor: 'bgcolor',
  border: 'border',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
};
/** HTML attributes whose presence means yes. */
const HTML_BOOL: Record<string, string> = {
  disabled: 'disabled',
  required: 'required',
  hidden: 'hidden',
  multiple: 'multiple',
  readonly: 'readOnly',
  open: 'open',
  reversed: 'reversed',
  novalidate: 'noValidate',
  formnovalidate: 'formNoValidate',
  autofocus: 'autoFocus',
  inert: 'inert',
};
/** React props that take a number. */
const NUMERIC = new Set(['tabIndex', 'maxLength', 'minLength', 'colSpan', 'rowSpan', 'size', 'cols', 'rows', 'span', 'start']);
/** SVG attributes kept, as parse5 spells them; a dashed name becomes camelCase. */
const SVG_ATTRS = new Set(
  (
    'id class style lang role tabindex transform viewBox preserveAspectRatio xmlns width height x y x1 y1 x2 y2 cx cy r rx ry d points pathLength fill ' +
    'stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity fill-opacity fill-rule ' +
    'clip-rule opacity offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy fr patternUnits patternContentUnits ' +
    'patternTransform clip-path clipPathUnits mask maskUnits maskContentUnits marker-start marker-mid marker-end markerWidth markerHeight markerUnits ' +
    'refX refY orient font-size font-family font-weight font-style font-variant text-anchor dominant-baseline alignment-baseline baseline-shift ' +
    'letter-spacing word-spacing text-decoration text-rendering dx dy rotate textLength lengthAdjust startOffset method spacing side vector-effect ' +
    'shape-rendering image-rendering color-interpolation color-interpolation-filters paint-order transform-origin color display visibility overflow ' +
    'filter filterUnits primitiveUnits in in2 result stdDeviation mode operator k1 k2 k3 k4 values type baseFrequency numOctaves seed stitchTiles scale ' +
    'xChannelSelector yChannelSelector flood-color flood-opacity lighting-color tableValues slope intercept amplitude exponent radius kernelMatrix order ' +
    'divisor bias targetX targetY edgeMode preserveAlpha surfaceScale diffuseConstant specularConstant specularExponent kernelUnitLength azimuth ' +
    'elevation z pointsAtX pointsAtY pointsAtZ limitingConeAngle focusable href xlink:href xml:space'
  ).split(' '),
);
/** Pictures a page may import, and those that may become a spot. */
const PICTURE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg']);
const SPOT_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
/** `value` on these input types is what they send, not what a person types. */
const FIXED_VALUE = new Set(['button', 'checkbox', 'image', 'hidden', 'radio', 'reset', 'submit']);

/** A string as a JS literal: JSON, with every invisible, line-ending or angle character escaped too. */
function lit(text: string): string {
  return JSON.stringify(text).replace(/[\p{Cc}\p{Cf}\p{Z}\p{Co}<>]/gu, (c) => (c === ' ' ? c : `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`));
}

/** Text for one line of plain words: no control, bidi or line-breaking characters, spaces folded. */
function plain(text: string, max: number): string {
  const folded = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(folded);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : folded;
}

/** A name from the page, safe to put in a sentence. */
const said = (name: string): string => plain(name, 40);

const extOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';

/** An address as a browser reads it: tabs and line breaks anywhere are ignored, and spaces at the ends. */
function cleanUrl(raw: string): string {
  return raw.replace(/[\t\n\r]/g, '').replace(/^[\p{Cc} ]+|[\p{Cc} ]+$/gu, '');
}

/** The scheme an address names, lower-cased, or null for a relative one. */
function schemeOf(url: string): string | null {
  return /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * A relative address resolved to a site path: against the page's folder, `?` and `#` dropped,
 * percent-decoded, a leading `/` the site's top, a folder its `index.html`, the extension lower-cased.
 * Null when it leaves the site or cannot be read.
 */
function resolveSitePath(ref: string, page: string): string | null {
  if (ref.includes('\\') || ref.startsWith('//')) return null;
  const bare = ref.replace(/[?#].*$/s, '');
  if (bare === '') return page;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  if (/[\p{Cc}\\]/u.test(decoded)) return null;
  const parts = decoded.startsWith('/') ? [] : page.split('/').slice(0, -1);
  const segments = decoded.split('/');
  const end = segments.at(-1);
  const folder = end === '' || end === '.' || end === '..';
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (folder || parts.length === 0) parts.push('index.html');
  const last = parts.length - 1;
  parts[last] = (parts[last] ?? '').replace(/\.([^.]+)$/, (_, ext: string) => `.${ext.toLowerCase()}`);
  return parts.join('/');
}

/** The fragment of an address, without its `#`, or null. */
function fragmentOf(ref: string): string | null {
  const at = ref.indexOf('#');
  return at < 0 || at === ref.length - 1 ? null : ref.slice(at + 1);
}

/** A page's screen address from its site path: 'index.html' → '/', 'about.html' → '/about', 'blog/index.html' → '/blog'. */
export function screenPathOf(page: string): string {
  const parts = page
    .replace(/\.html?$/i, '')
    .split('/')
    .filter((part) => part !== '');
  if (parts.at(-1)?.toLowerCase() === 'index') parts.pop();
  const slugs = parts.map((part) => {
    const slug = part
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug === '' ? 'page' : slug;
  });
  return `/${slugs.join('/')}`;
}

/** A component name from a page path: 'about-us.html' → 'AboutUsPage', 'index.html' → 'HomePage', '404.html' → 'Page404'. */
export function componentNameOf(page: string): string {
  const parts = page
    .replace(/\.html?$/i, '')
    .split('/')
    .filter((part) => part !== '');
  if (parts.at(-1)?.toLowerCase() === 'index') parts.pop();
  const words = parts
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const name = (words.length === 0 ? 'Home' : words.join('')).slice(0, 60);
  return /^[0-9]/.test(name) ? `Page${name}` : `${name}Page`;
}

/** The text right inside a <style> or <script>. */
function ownText(el: Element): string {
  return el.childNodes.map((child) => (child.nodeName === '#text' && 'value' in child ? child.value : '')).join('');
}

/** One JSX attribute: its React name and the expression it takes. */
type Prop = [name: string, expr: string];

class Converter {
  readonly dropped: string[] = [];
  private readonly droppedSeen = new Set<string>();
  readonly imports = new Map<string, string>();
  readonly pictures: (PageImage & { spot: string | null })[] = [];
  readonly pages: string[] = [];
  readonly styles: string[] = [];
  readonly stylesheets: string[] = [];
  readonly remoteStyles: string[] = [];
  readonly scripts: { src: string | null; text: string | null }[] = [];
  usesLink = false;
  usesPicture = false;
  /** The text of the last h1–h3 met, in page order. */
  private heading: string | null = null;

  constructor(private readonly opts: ConvertOptions) {}

  drop(words: string): void {
    if (this.droppedSeen.has(words) || this.dropped.length >= DROPPED_MAX) return;
    this.droppedSeen.add(words);
    this.dropped.push(words);
  }

  /** The import name for a site file, numbered in order of first use. */
  importFor(path: string): string {
    let name = this.imports.get(path);
    if (name === undefined) {
      name = `img${this.imports.size + 1}`;
      this.imports.set(path, name);
    }
    return name;
  }

  /** A site picture this page may import, or null. */
  localPicture(raw: string): string | null {
    const url = cleanUrl(raw);
    if (schemeOf(url) !== null || url.startsWith('#')) return null;
    const path = resolveSitePath(url, this.opts.page);
    return path !== null && PICTURE_EXT.has(extOf(path)) && this.opts.has(path) ? path : null;
  }

  /** Why an address that is not the site's was taken out, in plain words. */
  dropUrl(raw: string, attr: string, tag: string): void {
    const url = cleanUrl(raw);
    const scheme = schemeOf(url);
    const what = attr === 'href' && (tag === 'a' || tag === 'area') ? 'link' : `address in ${attr} on <${tag}>`;
    if (scheme !== null) this.drop(`a ${said(scheme)}: ${what} taken out`);
    else if (url.startsWith('//')) this.drop(`a ${what} to another site without https: taken out`);
    else this.drop(`a ${what} to ${said(url)}, which is not one of the site's pictures, taken out`);
  }

  // ---- the head and other things handed back as data ----

  stylesheet(el: Element): void {
    const rel = (attrOf(el, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attrOf(el, 'href');
    if (!rel.includes('stylesheet') || href === null) return;
    const url = cleanUrl(href);
    const scheme = schemeOf(url);
    if (scheme === 'https' || scheme === 'http' || url.startsWith('//')) {
      let host: string | null = null;
      try {
        host = new URL(url, 'https://site.invalid/').hostname;
      } catch {
        host = null;
      }
      if (host !== null && host !== '' && !this.remoteStyles.includes(host)) this.remoteStyles.push(host);
      return;
    }
    const path = scheme === null ? resolveSitePath(url, this.opts.page) : null;
    if (path !== null && this.opts.has(path)) {
      if (!this.stylesheets.includes(path)) this.stylesheets.push(path);
    } else this.drop(`a stylesheet link to ${said(url)}, which the site does not hold, taken out`);
  }

  script(el: Element): void {
    const src = attrOf(el, 'src');
    if (src !== null) {
      const url = cleanUrl(src);
      const path = schemeOf(url) === null ? resolveSitePath(url, this.opts.page) : null;
      if (path !== null && this.opts.has(path)) this.scripts.push({ src: path, text: null });
      return;
    }
    const text = ownText(el);
    if (text.trim() !== '') this.scripts.push({ src: null, text: text.slice(0, SCRIPT_TEXT_MAX) });
  }

  /** What an element taken out leaves behind as data. */
  takeOut(el: Element, inHead: boolean): void {
    const tag = el.tagName.toLowerCase();
    if (tag === 'style') this.styles.push(ownText(el));
    else if (tag === 'script') this.script(el);
    else if (tag === 'link') this.stylesheet(el);
    if (inHead) {
      if (tag === 'script') this.drop('<script> taken out');
      else if (tag === 'base') this.drop('<base> taken out');
      else if (tag === 'meta' && attrOf(el, 'http-equiv') !== null) this.drop('<meta http-equiv> taken out');
      return;
    }
    if (tag === 'style') this.drop('<style> taken out (its rules are kept with the stylesheets)');
    else if (tag === 'meta' && attrOf(el, 'http-equiv') !== null) this.drop('<meta http-equiv> taken out');
    else this.drop(`<${el.tagName}> taken out`);
  }

  head(head: Element): void {
    for (const child of head.childNodes) {
      if (!isElement(child)) continue;
      if (['style', 'script', 'link', 'base', 'meta'].includes(child.tagName)) this.takeOut(child, true);
    }
  }

  // ---- the body ----

  /** The JSX lines for a parent's children. `holder` is the element the output sits in (an unwrapped element is not one). */
  children(parent: ParentNode, holder: string, depth: number, indent: string): string[] {
    const lines: string[] = [];
    // One line at a time: a page of many thousand elements would overflow the stack as one spread.
    for (const child of parent.childNodes) for (const line of this.node(child, holder, depth, indent)) lines.push(line);
    return lines;
  }

  node(node: Node, holder: string, depth: number, indent: string): string[] {
    if (node.nodeName === '#text' && 'value' in node) {
      if (node.value.trim() !== '' || (node.value !== '' && inPre(node))) return [`${indent}{${lit(node.value)}}`];
      return NO_TEXT.has(holder) || node.value === '' ? [] : [`${indent}{" "}`];
    }
    if (!isElement(node)) return [];
    if (depth > DEPTH_MAX) throw new ConvertRefusal(`${said(this.opts.page)} nests its elements too deep to be a screen.`);
    return this.element(node, holder, depth, indent);
  }

  unwrap(el: Element, holder: string, depth: number, indent: string, words: string | null): string[] {
    if (words !== null) this.drop(words);
    return this.children(el, holder, depth + 1, indent);
  }

  element(el: Element, holder: string, depth: number, indent: string): string[] {
    const name = el.tagName;
    const svg = el.namespaceURI === SVG_NS;
    if (el.namespaceURI !== HTML_NS && !svg) return this.unwrap(el, holder, depth, indent, `<${said(name)}> taken off, its contents kept`);
    if (!NAME.test(name)) return this.unwrap(el, holder, depth, indent, 'an element with a name that is not HTML taken off, its contents kept');
    if ((svg ? SVG_DROP : HTML_DROP).has(name)) {
      this.takeOut(el, false);
      return [];
    }
    if (!svg && name === 'picture') {
      const lines: string[] = [];
      for (const child of el.childNodes) {
        if (isElement(child) && child.tagName === 'source') this.drop('<source> in a <picture> taken out (its <img> is the picture)');
        else for (const line of this.node(child, holder, depth + 1, indent)) lines.push(line);
      }
      return lines;
    }
    if (!(svg ? SVG_KEEP : HTML_KEEP).has(name)) return this.unwrap(el, holder, depth, indent, `<${said(name)}> taken off, its contents kept`);

    if (!svg && /^h[1-3]$/.test(name)) {
      const text = plain(textOf(el), NEAR_MAX);
      if (text !== '') this.heading = text;
    }
    if (!svg && name === 'img') {
      const spot = this.picture(el, indent);
      if (spot !== null) return [spot];
    }

    let tag = name;
    const props = this.props(el, svg);
    if (!svg && name === 'a') {
      const to = props.findIndex(([key]) => key === 'to');
      if (to >= 0) {
        tag = 'Link';
        this.usesLink = true;
      }
    }
    const open = `${indent}<${tag}${props.map(([key, expr]) => ` ${key}={${expr}}`).join('')}`;
    if (!svg && VOID.has(name)) return [`${open} />`];
    if (!svg && name === 'textarea') return [`${open} />`];
    const inner = this.children(el, svg ? 'svg' : name, depth + 1, `${indent}  `);
    if (inner.length === 0) return [`${open} />`];
    return [`${open}>`, ...inner, `${indent}</${tag}>`];
  }

  // ---- attributes ----

  props(el: Element, svg: boolean): Prop[] {
    const tag = el.tagName;
    const props: Prop[] = [];
    const add = (key: string, expr: string): void => {
      if (!props.some(([have]) => have === key)) props.push([key, expr]);
    };
    for (const attr of el.attrs) {
      const full = attr.prefix === undefined ? attr.name : `${attr.prefix}:${attr.name}`;
      if (/^on/i.test(full)) {
        this.drop(`${said(full)} on <${tag}> taken out`);
        continue;
      }
      if (full === 'xmlns:xlink' || full === 'version') continue;
      if (!NAME.test(full) && !(svg && (full === 'xlink:href' || full === 'xml:space'))) {
        this.drop(`an attribute with a name that is not HTML on <${tag}> taken out`);
        continue;
      }
      const value = attr.value;
      if (/^(?:aria|data)-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(full)) {
        add(full, lit(value));
        continue;
      }
      if (full === 'style') {
        const style = this.style(value);
        if (style !== null) add('style', style);
        continue;
      }
      if (svg) this.svgProp(el, full, value, add);
      else this.htmlProp(el, full, value, add);
    }
    if (!svg && tag === 'select') this.selectDefault(el, add);
    if (!svg && tag === 'textarea') {
      const text = textOf(el);
      if (text !== '') add('defaultValue', lit(text));
    }
    return props;
  }

  /** A plain attribute value, unless it points somewhere through `url()` that is not a place in the page. */
  private plainValue(tag: string, name: string, value: string): string | null {
    if (/url\s*\(/i.test(value.replace(/url\(#[A-Za-z0-9_:.-]*\)/g, ''))) {
      this.drop(`${said(name)} on <${tag}> pointing at another file taken out`);
      return null;
    }
    return lit(value);
  }

  private htmlProp(el: Element, name: string, value: string, add: (key: string, expr: string) => void): void {
    const tag = el.tagName;
    switch (name) {
      case 'href':
        if (tag === 'a' || tag === 'area') this.href(el, value, add);
        else this.drop(`href on <${tag}> taken out`);
        return;
      case 'src':
        if (tag === 'img' || (tag === 'input' && (attrOf(el, 'type') ?? '').toLowerCase() === 'image')) {
          const path = this.localPicture(value);
          if (path !== null) add('src', this.importFor(path));
          else this.dropUrl(value, 'src', tag);
        } else this.drop(`src on <${tag}> taken out`);
        return;
      case 'srcset':
        if (tag === 'img') this.srcset(value, add);
        else this.drop(`srcset on <${tag}> taken out`);
        return;
      case 'action':
      case 'method':
      case 'enctype':
      case 'formaction':
      case 'formmethod':
      case 'formenctype':
      case 'formtarget':
        this.drop(`${name} on <${tag}> taken out (forms are wired later)`);
        return;
      case 'target':
        if (tag === 'form') {
          this.drop(`target on <form> taken out (forms are wired later)`);
          return;
        }
        break;
      case 'value': {
        const type = (attrOf(el, 'type') ?? 'text').toLowerCase();
        if (tag === 'input' && !FIXED_VALUE.has(type)) add('defaultValue', lit(value));
        else if (tag === 'select' || tag === 'textarea') this.drop(`value on <${tag}> taken out`);
        else add('value', lit(value));
        return;
      }
      case 'checked':
        if (tag === 'input') add('defaultChecked', 'true');
        else this.drop(`checked on <${tag}> taken out`);
        return;
      case 'selected':
        if (tag !== 'option' || this.selectOf(el) === null) this.drop(`selected on <${tag}> taken out`);
        return;
      case 'usemap':
        if (!value.startsWith('#')) {
          this.drop(`usemap on <${tag}> taken out`);
          return;
        }
        break;
      default:
        break;
    }
    const bool = HTML_BOOL[name];
    if (bool !== undefined) {
      add(bool, 'true');
      return;
    }
    const key = HTML_ATTRS[name];
    if (key === undefined) {
      this.drop(`${said(name)} on <${tag}> taken out`);
      return;
    }
    if (NUMERIC.has(key)) {
      const number = /^\s*(-?\d{1,9})\s*$/.exec(value)?.[1];
      if (number === undefined) this.drop(`${said(name)} on <${tag}> that is not a number taken out`);
      else add(key, String(Number(number)));
      return;
    }
    const expr = this.plainValue(tag, name, value);
    if (expr !== null) add(key, expr);
  }

  private svgProp(el: Element, name: string, value: string, add: (key: string, expr: string) => void): void {
    const tag = el.tagName;
    if (!SVG_ATTRS.has(name)) {
      this.drop(`${said(name)} on <${tag}> taken out`);
      return;
    }
    if (name === 'href' || name === 'xlink:href') {
      const url = cleanUrl(value);
      if (tag === 'image') {
        const path = this.localPicture(url);
        if (path !== null) add('href', this.importFor(path));
        else this.dropUrl(url, name, tag);
      } else if (/^#[A-Za-z0-9_:.-]*$/.test(url)) add('href', lit(url));
      else this.dropUrl(url, name, tag);
      return;
    }
    const key = name === 'class' ? 'className' : name === 'tabindex' ? 'tabIndex' : name === 'xml:space' ? 'xmlSpace' : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (key === 'tabIndex') {
      const number = /^\s*(-?\d{1,9})\s*$/.exec(value)?.[1];
      if (number === undefined) this.drop(`tabindex on <${tag}> that is not a number taken out`);
      else add(key, String(Number(number)));
      return;
    }
    const expr = this.plainValue(tag, name, value);
    if (expr !== null) add(key, expr);
  }

  /** An <a> or <area> address: a page becomes a Link, a site file an import, a missing one goes nowhere. */
  private href(el: Element, raw: string, add: (key: string, expr: string) => void): void {
    const url = cleanUrl(raw);
    const scheme = schemeOf(url);
    if (url.startsWith('#')) {
      add('href', lit(url));
      return;
    }
    if (scheme === 'mailto' || scheme === 'tel') {
      add('href', lit(url));
      return;
    }
    if (scheme === 'https') {
      let ok = false;
      try {
        ok = new URL(url).protocol === 'https:';
      } catch {
        ok = false;
      }
      if (ok) add('href', lit(url));
      else this.dropUrl(url, 'href', el.tagName);
      return;
    }
    if (scheme !== null || url.startsWith('//')) {
      this.dropUrl(url, 'href', el.tagName);
      return;
    }
    const page = this.pageOf(url);
    if (page !== null) {
      const fragment = fragmentOf(url);
      const to = `${page.screen}${fragment === null ? '' : `#${fragment}`}`;
      if (!this.pages.includes(page.path)) this.pages.push(page.path);
      add(el.tagName === 'a' ? 'to' : 'href', lit(to));
      return;
    }
    const picture = this.localPicture(url);
    if (picture !== null) {
      add('href', this.importFor(picture));
      return;
    }
    this.drop(`a link to ${said(url)}, which the site does not hold, now goes nowhere`);
    add('href', lit('#'));
  }

  /** The site page a relative address names, trying `.html` and a folder's `index.html` for a bare name. */
  private pageOf(url: string): { path: string; screen: string } | null {
    const path = resolveSitePath(url, this.opts.page);
    if (path === null) return null;
    const tries = extOf(path) === '' ? [path, `${path}.html`, `${path}/index.html`] : [path];
    for (const candidate of tries) {
      const screen = this.opts.screenOf(candidate);
      if (screen !== null) return { path: candidate, screen };
    }
    return null;
  }

  /** srcset on an <img>: kept only when every candidate is a site picture, built from the imports. */
  private srcset(value: string, add: (key: string, expr: string) => void): void {
    const candidates = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const parts: string[] = [];
    for (const candidate of candidates) {
      const match = /^(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?$/.exec(candidate);
      const path = match?.[1] === undefined ? null : this.localPicture(match[1]);
      if (match === null || path === null) {
        this.drop('srcset on <img> naming a picture the site does not hold taken out');
        return;
      }
      parts.push(match[2] === undefined ? this.importFor(path) : `${this.importFor(path)} + ${lit(` ${match[2]}`)}`);
    }
    if (parts.length > 0) add('srcSet', parts.join(` + ${lit(', ')} + `));
  }

  /** The <select> an <option> belongs to, or null. */
  private selectOf(option: Element): Element | null {
    let up: ParentNode | null = option.parentNode;
    for (let level = 0; level < 2 && up !== null && isElement(up); level += 1) {
      if (isHtml(up, 'select')) return up;
      if (!isHtml(up, 'optgroup')) return null;
      up = up.parentNode;
    }
    return null;
  }

  /** A <select>'s chosen options become its defaultValue, as React reads them. */
  private selectDefault(select: Element, add: (key: string, expr: string) => void): void {
    const chosen: string[] = [];
    const walk = (parent: ParentNode): void => {
      for (const child of parent.childNodes) {
        if (!isElement(child)) continue;
        if (isHtml(child, 'option') && attrOf(child, 'selected') !== null) chosen.push(attrOf(child, 'value') ?? plain(textOf(child), 10000));
        else if (isHtml(child, 'optgroup')) walk(child);
      }
    };
    walk(select);
    if (chosen.length === 0) return;
    if (attrOf(select, 'multiple') !== null) add('defaultValue', `[${chosen.map(lit).join(', ')}]`);
    else add('defaultValue', lit(chosen.at(-1) ?? ''));
  }

  // ---- inline styles ----

  /** A style attribute as a React style object, or null when nothing is kept. */
  style(text: string): string | null {
    const entries: string[] = [];
    for (const declaration of splitDeclarations(text.replace(/\/\*[\s\S]*?\*\//g, ''))) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      let value = declaration.slice(colon + 1).trim();
      const custom = /^--[A-Za-z0-9_-]+$/.test(property);
      if (!custom && !/^-?[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(property)) {
        this.drop('a style with a name that is not CSS taken out');
        continue;
      }
      if (/!\s*important\s*$/i.test(value)) {
        value = value.replace(/\s*!\s*important\s*$/i, '');
        this.drop('!important in a style taken out');
      }
      if (value.includes('\\') || /(?:image-set|cross-fade|src|element)\s*\(/i.test(value)) {
        this.drop(`a style ${said(property)} that may load a file taken out`);
        continue;
      }
      const key = custom ? property : camelStyle(property);
      entries.push(`${lit(key)}: ${this.styleValue(value)}`);
    }
    return entries.length === 0 ? null : `{ ${entries.join(', ')} }`;
  }

  /** A style value: every url() of a site picture becomes its import, any other url() becomes none. */
  private styleValue(value: string): string {
    const pieces: string[] = [];
    let text = '';
    let at = 0;
    for (const match of value.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi)) {
      text += value.slice(at, match.index);
      at = match.index + match[0].length;
      const url = cleanUrl(match[1] ?? match[2] ?? match[3] ?? '');
      if (url.startsWith('#')) {
        text += `url(${url})`;
        continue;
      }
      const path = this.localPicture(url);
      if (path === null) {
        this.drop('a url() in a style that is not one of the site\'s pictures taken out');
        text += 'none';
        continue;
      }
      pieces.push(lit(`${text}url(`), this.importFor(path));
      text = ')';
    }
    text += value.slice(at);
    if (/url\s*\(/i.test(text)) {
      this.drop('a url() in a style that could not be read taken out');
      text = text.replace(/url\s*\([^)]*\)?/gi, 'none');
    }
    pieces.push(lit(text));
    return pieces.join(' + ');
  }

  // ---- pictures ----

  /** A local content picture: a spot when spotFor says so (the JSX line), else null to write the <img>. */
  private picture(img: Element, indent: string): string | null {
    const src = attrOf(img, 'src');
    if (src === null) return null;
    const path = this.localPicture(src);
    if (path === null || !SPOT_EXT.has(extOf(path))) return null;
    const number = (name: string): number | null => {
      const digits = /^\s*(\d{1,6})/.exec(attrOf(img, name) ?? '')?.[1];
      return digits === undefined ? null : Number(digits);
    };
    const info: PageImage = {
      path,
      alt: attrOf(img, 'alt') ?? '',
      width: number('width'),
      height: number('height'),
      near: this.near(img),
      repeated: repeats(img),
      logo: this.isLogo(img, src),
    };
    const spot = this.opts.spotFor?.(info) ?? null;
    this.pictures.push({ ...info, spot });
    if (spot === null) return null;
    this.usesPicture = true;
    const props: Prop[] = [['spot', lit(spot)]];
    const className = attrOf(img, 'class');
    if (className !== null) props.push(['className', lit(className)]);
    const style = attrOf(img, 'style');
    const styleExpr = style === null ? null : this.style(style);
    if (styleExpr !== null) props.push(['style', styleExpr]);
    for (const attr of img.attrs) {
      if (attr.prefix === undefined && /^on/i.test(attr.name)) this.drop(`${said(attr.name)} on <img> taken out`);
    }
    return `${indent}<Picture${props.map(([key, expr]) => ` ${key}={${expr}}`).join('')} />`;
  }

  /** Its <figcaption>, else the last h1–h3 before it. */
  private near(img: Element): string | null {
    for (let up = img.parentNode; up !== null && isElement(up); up = up.parentNode) {
      if (isHtml(up, 'figure')) {
        const caption = up.childNodes.find((child): child is Element => isElement(child) && isHtml(child, 'figcaption'));
        const text = caption === undefined ? '' : plain(textOf(caption), NEAR_MAX);
        if (text !== '') return text;
        break;
      }
    }
    return this.heading;
  }

  private isLogo(img: Element, src: string): boolean {
    const words = [attrOf(img, 'alt'), src, attrOf(img, 'class'), attrOf(img, 'id')];
    if (words.some((word) => word !== null && /logo/i.test(word))) return true;
    let inBar = false;
    let homeLink = false;
    for (let up = img.parentNode; up !== null && isElement(up); up = up.parentNode) {
      if (isHtml(up, 'header', 'nav')) inBar = true;
      if (isHtml(up, 'a') && !homeLink) {
        const href = attrOf(up, 'href');
        const url = href === null ? null : cleanUrl(href);
        const path = url === null || schemeOf(url) !== null ? null : resolveSitePath(url, this.opts.page);
        homeLink = path !== null && this.opts.screenOf(path) === '/';
      }
    }
    return inBar && homeLink;
  }
}

/** Whether a node sits in a <pre>, where whitespace is kept as written. */
function inPre(node: Node): boolean {
  let up = 'parentNode' in node ? node.parentNode : null;
  for (; up !== null && isElement(up); up = up.parentNode) if (isHtml(up, 'pre')) return true;
  return false;
}

/** Whether an element sits in a block that repeats (a product card, a team member): the finder's rule, so the plan and the pictures agree. */
function repeats(el: Element): boolean {
  return repeatedBlockOf(el) !== null;
}

/** A style attribute's declarations, split at `;` outside quotes and brackets. */
function splitDeclarations(text: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let current = '';
  for (const c of text) {
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part !== '');
}

/** `background-color` → `backgroundColor`, `-webkit-x` → `WebkitX`, `-ms-x` → `msX`. */
function camelStyle(property: string): string {
  const lower = property.toLowerCase();
  const name = lower.startsWith('-ms-') ? lower.slice(1) : lower;
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** One page of a site, as a screen file and what it held. */
export function convertPage(html: string, opts: ConvertOptions): ConvertedPage {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(opts.component)) throw new TypeError(`Not a component name: ${said(opts.component)}`);
  const document = parse(html);
  const root = document.childNodes.find((child): child is Element => isElement(child) && child.tagName === 'html');
  const head = root?.childNodes.find((child): child is Element => isElement(child) && child.tagName === 'head');
  const body = root?.childNodes.find((child): child is Element => isElement(child) && child.tagName === 'body');
  const converter = new Converter(opts);

  const titleEl = head?.childNodes.find((child): child is Element => isElement(child) && isHtml(child, 'title'));
  const title = titleEl === undefined ? '' : plain(textOf(titleEl), TITLE_MAX);
  const langValue = (root === undefined ? null : attrOf(root, 'lang'))?.trim() ?? '';
  const lang = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(langValue) ? langValue : null;
  const bodyClassValue = body === undefined ? '' : plain(attrOf(body, 'class') ?? '', 1000);

  if (head !== undefined) converter.head(head);
  let lines: string[] = [];
  if (body !== undefined) {
    for (const attr of body.attrs) if (attr.name !== 'class') converter.drop(`${said(attr.name)} on <body> taken out`);
    lines = converter.children(body, 'body', 1, '      ');
  } else if (root?.childNodes.some((child) => isElement(child) && child.tagName === 'frameset')) {
    converter.drop('<frameset> taken out');
  }

  const sideNames = [converter.usesLink ? 'Link' : null, converter.usesPicture ? 'Picture' : null].filter((name) => name !== null);
  const pageName = lit(opts.page.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ''));
  const tsx = [
    `// Made by Adminium Designer's use_site from the template's page ${pageName}: the markup and words are the template's.`,
    ...(sideNames.length > 0 ? [`import { ${sideNames.join(', ')} } from '@adminiumjs/adminium/side';`] : []),
    ...[...converter.imports].map(([path, name]) => `import ${name} from ${lit(opts.importOf(path))};`),
    '',
    `export default function ${opts.component}() {`,
    '  return (',
    ...(lines.length === 0 ? ['    <></>'] : ['    <>', ...lines, '    </>']),
    '  );',
    '}',
    '',
  ].join('\n');
  if (Buffer.byteLength(tsx) > PAGE_TSX_MAX) throw new ConvertRefusal(`${said(opts.page)} would be over 256 KB as a screen.`);

  return {
    tsx,
    title: title === '' ? null : title,
    lang,
    bodyClass: bodyClassValue === '' ? null : bodyClassValue,
    stylesheets: converter.stylesheets,
    remoteStyles: converter.remoteStyles,
    styles: converter.styles,
    imports: [...converter.imports.keys()],
    pictures: converter.pictures,
    pages: converter.pages,
    dropped: converter.dropped,
    scripts: converter.scripts,
  };
}
