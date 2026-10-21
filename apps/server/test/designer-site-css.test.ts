// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stylesheet of a site template, made fit to copy into an app: comments taken out but a licence
 * kept, addresses on other sites taken out, extensions in lower case, a url() to a missing file set
 * to none. Then the security rules, each with a case that would pass the stylesheet through if the
 * rule were gone: escapes decoded, every way of naming an address, any scheme, only the site's own
 * files and inline pictures kept, and anything uncertain taken out. Last, how an address resolves.
 */
import { describe, expect, it } from 'vitest';

import { cleanCss, CSS_REMOVED_LISTED, resolveSitePath } from '../src/designer/site/css.js';

const SITE = new Set(['css/style.css', 'css/base.css', 'css/Base.css', 'css/img/a.png', 'css/IMG/Hero.png', 'css/fonts/A.woff2', 'img/a.png', 'img/My Pic.jpg', 'css/deep/style.css']);
const has = (path: string): boolean => SITE.has(path);
/** A site that says it holds every path: only the rules themselves stand between an address and the page. */
const holdsEverything = (): boolean => true;

const clean = (css: string, path = 'css/style.css', holds: (path: string) => boolean = has) => cleanCss(css, { path, has: holds });
/** A cleaned stylesheet without the header comment. */
const strip = (css: string): string => css.replace(/^\/\*[^\n]*\*\/\n/, '');
/** The stylesheet cleaned, without the header comment. */
const body = (css: string, path?: string, holds?: (path: string) => boolean): string => strip(clean(css, path, holds).css);

describe('the header', () => {
  it('opens the stylesheet with one comment that says what was changed, and nothing in it closes early', () => {
    const { css } = clean('a{color:red}');
    const first = css.split('\n')[0] ?? '';
    expect(first).toMatch(/^\/\* Copied from the template by Adminium Designer, with four changes: .* \*\/$/);
    expect(first.indexOf('*/')).toBe(first.length - 2);
    expect(css.endsWith('a{color:red}')).toBe(true);
  });

  it('keeps @charset first, where it counts, and drops a byte order mark', () => {
    expect(clean('@charset "UTF-8";\na{}').css).toMatch(/^@charset "UTF-8";\n\/\* Copied/);
    expect(body(String.fromCharCode(0xfeff) + 'body{color:red}')).toBe('body{color:red}');
  });
});

describe('comments', () => {
  it('are taken out, but a /*! licence */ is kept as it was', () => {
    expect(body('/* theme by someone */a{color:red}/*! MIT licence, (c) Someone */\nb{}/* end */')).toBe('a{color:red}/*! MIT licence, (c) Someone */\nb{}');
  });

  it('leave a space where taking them out would join two tokens into one', () => {
    expect(body('a/**/b{}')).toBe('a b{}');
    expect(body('a/**/.b{}')).toBe('a.b{}');
    expect(body('a{margin:1/**/px}')).toBe('a{margin:1 px}');
    expect(body('@/**/import "https://x.com/a.css";')).toBe('@ import "https://x.com/a.css";');
  });

  it('cannot glue a url( together or open a new comment when taken out', () => {
    const glued = body('a{background:u/**/rl(https://evil.example/a.png)}');
    expect(glued).not.toMatch(/url\(/i);
    // A slash and a star kept apart by a comment must not become a comment that hides what follows from this reading.
    expect(body('a{b:1//**/*x*/}')).toBe('a{b:1/ *x*/}');
  });

  it('close a licence comment the template left open', () => {
    expect(body('a{}/*! licence')).toBe('a{}/*! licence*/');
  });
});

describe('addresses on other sites', () => {
  it('are taken out of url(), with or without quotes, and listed as remote', () => {
    const out = clean('a{background:url(https://x.com/a.png)} b{background:url("//cdn.example/b.png")} c{background:url( HTTP://x.com/c.png )}');
    expect(strip(out.css)).toBe('a{background:none} b{background:none} c{background:none}');
    expect(out.removed).toEqual([
      { address: 'https://x.com/a.png', why: 'remote' },
      { address: '//cdn.example/b.png', why: 'remote' },
      { address: 'HTTP://x.com/c.png', why: 'remote' },
    ]);
    // A picture from another site is not a stylesheet or font to self-host.
    expect(out.hosts).toEqual([]);
  });

  it('take out an @import of another site, with url() or a bare string, and list its host', () => {
    const out = clean('@import url(https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap);\n@import "//cdn.example.com/x.css" screen;\na{}');
    expect(strip(out.css)).toBe('\n\na{}');
    expect(out.hosts).toEqual(['fonts.googleapis.com', 'cdn.example.com']);
    expect(out.removed.map((r) => r.why)).toEqual(['remote', 'remote']);
    expect(out.imports).toEqual([]);
  });

  it('take out a font source on another site, keeping the template’s own, and list the host', () => {
    const out = clean('@font-face{font-family:A;src:url(fonts/A.WOFF2) format("woff2"),url(https://Fonts.Example.com/a.ttf) format("truetype")}');
    expect(strip(out.css)).toBe('@font-face{font-family:A;src:url("./fonts/A.woff2") format("woff2")}');
    expect(out.files).toEqual(['css/fonts/A.woff2']);
    expect(out.hosts).toEqual(['fonts.example.com']);
    expect(out.removed).toEqual([{ address: 'https://Fonts.Example.com/a.ttf', why: 'remote' }]);
  });

  it('leave a font source of none when every entry was on another site', () => {
    expect(body('@font-face{src: url(https://x.com/a.woff) format("woff"), local("A") , url(//x.com/b.ttf)}')).toBe('@font-face{src: local("A") }');
    expect(body('@font-face{src:url(https://x.com/a.woff)}')).toBe('@font-face{src: none}');
  });
});

describe('extensions in lower case', () => {
  it('lower-cases only the extension of a kept address, never the rest of the path', () => {
    const out = clean('a{background:url(IMG/Hero.PNG)}');
    expect(strip(out.css)).toBe('a{background:url("./IMG/Hero.png")}');
    expect(out.files).toEqual(['css/IMG/Hero.png']);
  });

  it('keeps a query or fragment as written, for the bundler to carry', () => {
    expect(body('a{background:url(img/a.PNG?v=2#x)}')).toBe('a{background:url("./img/a.png?v=2#x")}');
  });
});

describe('a url() to a file the template lacks', () => {
  it('becomes none and is listed as missing', () => {
    const out = clean('a{background:url(missing.png)}');
    expect(strip(out.css)).toBe('a{background:none}');
    expect(out.removed).toEqual([{ address: 'missing.png', why: 'missing' }]);
    expect(out.files).toEqual([]);
  });

  it('is the same in a custom property', () => {
    const out = clean(':root{--bg: url(missing.png);--fg:url(https://x.com/f.png);--ok:url(img/a.png)}');
    expect(strip(out.css)).toBe(':root{--bg: none;--fg:none;--ok:url("./img/a.png")}');
    expect(out.removed.map((r) => r.why)).toEqual(['missing', 'remote']);
  });

  it('lists each address once and at most 200 of them', () => {
    const many = Array.from({ length: 250 }, (_, k) => `.a${k}{background:url(m${k}.png)}`).join('');
    const out = clean(many + many);
    expect(out.removed).toHaveLength(CSS_REMOVED_LISTED);
    expect(strip(out.css)).not.toMatch(/url\(/);
    expect(clean('a{background:url(m.png)}b{background:url(m.png)}').removed).toHaveLength(1);
  });

  it('shows a long address cut short', () => {
    const long = `${'x'.repeat(300)}.png`;
    expect(clean(`a{background:url(${long})}`).removed[0]?.address).toHaveLength(200);
  });
});

describe('a local @import', () => {
  it('is kept, written relative to the stylesheet, and listed', () => {
    const out = clean('@import "base.css";\n@import url(Base.CSS) screen and (min-width: 40em);\na{}');
    expect(strip(out.css)).toBe('@import url("./base.css");\n@import url("./Base.css") screen and (min-width: 40em);\na{}');
    expect(out.imports).toEqual(['css/base.css', 'css/Base.css']);
    expect(out.files).toEqual([]);
  });

  it('is taken out whole when the file is missing, has no address, or holds a block', () => {
    const out = clean('@import "gone.css";@import foo;@import "base.css" {a{}}\na{}');
    expect(strip(out.css)).toBe('\na{}');
    expect(out.removed).toEqual([
      { address: 'gone.css', why: 'missing' },
      { address: 'foo', why: 'not-allowed' },
      { address: '"base.css"', why: 'not-allowed' },
    ]);
  });

  it('keeps an import at the end of the stylesheet that has no semicolon', () => {
    expect(body('@import "base.css"')).toBe('@import url("./base.css")');
  });
});

describe('strings and comments', () => {
  it('leave a url( inside a string exactly as it was', () => {
    const css = 'a::after{content:"url(https://x.com/y.png)"}b::after{content:\'\\75rl(x)\'}';
    const out = clean(css);
    expect(strip(out.css)).toBe(css);
    expect(out.removed).toEqual([]);
  });

  it('never read a url( inside a comment as an address, licence or not', () => {
    const out = clean('/* url(https://x.com/a.png) */a{}/*! see url(https://x.com/licence) */');
    expect(strip(out.css)).toBe('a{}/*! see url(https://x.com/licence) */');
    expect(out.removed).toEqual([]);
  });
});

describe('escapes are decoded before deciding what a function or rule is', () => {
  it('reads u\\72l( and \\75rl( and \\55 RL( as url(', () => {
    const out = clean('a{background:u\\72l(https://x.com/a.png)}b{background:\\75rl(https://x.com/b.png)}c{background:\\55 RL("https://x.com/c.png")}');
    expect(strip(out.css)).toBe('a{background:none}b{background:none}c{background:none}');
    expect(out.removed.map((r) => r.address)).toEqual(['https://x.com/a.png', 'https://x.com/b.png', 'https://x.com/c.png']);
  });

  it('reads @\\69mport as @import', () => {
    const out = clean('@\\69mport "https://x.com/a.css";\n@\\49MPORT url(//x.com/b.css);a{}');
    expect(strip(out.css)).toBe('\na{}');
    expect(out.hosts).toEqual(['x.com']);
  });

  it('decodes escapes in the address itself', () => {
    expect(body('a{background:url(h\\74tps://x.com/a.png)}')).toBe('a{background:none}');
    expect(body('a{background:url(img/\\61.PNG)}')).toBe('a{background:url("./img/a.png")}');
    expect(body('a{background:\\69mage-set("https://x.com/a.png" 1x)}')).toBe('a{background:\\69mage-set(none 1x)}');
  });

  it('decodes a tab hidden in a scheme, as a browser drops it', () => {
    const out = clean('a{background:url("jav\\9 ascript:alert(1)")}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{background:none}');
    expect(out.removed[0]?.why).toBe('not-allowed');
    // Read without the tab, it is an address on another site, and its host is one to offer.
    const font = clean('@font-face{src:url("ht\\9 tps://x.com/a.woff")}');
    expect(font.removed).toEqual([{ address: 'ht\ttps://x.com/a.woff', why: 'remote' }]);
    expect(font.hosts).toEqual(['x.com']);
  });
});

describe('every way a stylesheet names an address', () => {
  it('reads the strings of image-set() and -webkit-image-set() as addresses', () => {
    const out = clean('a{background:image-set("img/a.png" 1x, "https://x.com/b.png" 2x)}b{background:-webkit-image-set("https://x.com/c.png" 1x, url(img/a.png) 2x)}');
    expect(strip(out.css)).toBe('a{background:image-set(url("./img/a.png") 1x, none 2x)}b{background:-webkit-image-set(none 1x, url("./img/a.png") 2x)}');
    expect(out.removed.map((r) => r.address)).toEqual(['https://x.com/b.png', 'https://x.com/c.png']);
  });

  it('leaves the string of type() inside image-set() alone', () => {
    expect(body('a{background:image-set("img/a.png" type("image/png") 1x)}')).toBe('a{background:image-set(url("./img/a.png") type("image/png") 1x)}');
  });

  it('takes out an image-set() that holds var() or any function it cannot see through', () => {
    const out = clean(':root{--x:"https://x.com/a.png"}a{background:image-set(var(--x) 1x)}b{background:-webkit-image-set(attr(data-src) 1x)}');
    expect(strip(out.css)).toBe(':root{--x:"https://x.com/a.png"}a{background:none}b{background:none}');
    expect(out.removed).toEqual([
      { address: 'image-set(var(--x) 1x)', why: 'not-allowed' },
      { address: '-webkit-image-set(attr(data-src) 1x)', why: 'not-allowed' },
    ]);
  });

  it('reads src() as url()', () => {
    expect(body('a{background:src("img/a.png")}b{background:src("https://x.com/a.png")}')).toBe('a{background:url("./img/a.png")}b{background:none}');
  });

  it('finds addresses in any rule or at-rule, however deep', () => {
    expect(body('@media screen{@supports (display:grid){a{cursor:url(https://x.com/c.cur),auto}}}')).toBe('@media screen{@supports (display:grid){a{cursor:none,auto}}}');
  });
});

describe('any scheme', () => {
  it('is taken out, even when the site says it holds every path', () => {
    const out = clean('a{background:url("javascript:alert(1)")}b{background:url(ftp://x.com/a.png)}c{background:url(blob:abc)}d{background:url(file:///etc/x.png)}e{background:url(C:/x.png)}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{background:none}b{background:none}c{background:none}d{background:none}e{background:none}');
    expect(out.removed.map((r) => r.why)).toEqual(['not-allowed', 'remote', 'not-allowed', 'not-allowed', 'not-allowed']);
    expect(out.files).toEqual([]);
  });

  it('is taken out when a backslash stands for a slash', () => {
    expect(body('a{background:url("\\\\\\\\x.com\\\\a.png")}', 'css/style.css', holdsEverything)).toBe('a{background:none}');
  });
});

describe('only the site’s own files and inline pictures are kept', () => {
  it('keeps a PNG, JPEG, GIF or WebP written inline', () => {
    const out = clean('a{background:url(data:image/png;base64,iVBORw0KGgo=)}b{background:url("DATA:image/webp,abc")}');
    expect(strip(out.css)).toBe('a{background:url("data:image/png;base64,iVBORw0KGgo=")}b{background:url("DATA:image/webp,abc")}');
    expect(out.removed).toEqual([]);
    expect(out.files).toEqual([]);
  });

  it('takes out any other inline data, SVG included', () => {
    const out = clean('a{background:url("data:text/html,<script>alert(1)</script>")}b{background:url("data:image/svg+xml,<svg onload=alert(1)>")}c{background:url(data:,x)}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{background:none}b{background:none}c{background:none}');
    expect(out.removed.map((r) => r.why)).toEqual(['not-allowed', 'not-allowed', 'not-allowed']);
  });

  it('keeps a ../ path that stays inside the site, and takes out one that leaves it', () => {
    const out = clean('a{background:url(../../img/a.png)}b{background:url(../../../etc/passwd.png)}c{background:url(%2e%2e/%2e%2e/%2E%2E/x.png)}', 'css/deep/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{background:url("../../img/a.png")}b{background:none}c{background:none}');
    expect(out.files).toEqual(['img/a.png']);
    expect(out.removed.map((r) => r.why)).toEqual(['not-allowed', 'not-allowed']);
  });

  it('writes a path from the site’s top relative to the stylesheet, and decodes its escapes', () => {
    const out = clean('a{background:url(/img/a.png)}b{background:url("../img/My%20Pic.JPG")}');
    expect(strip(out.css)).toBe('a{background:url("../img/a.png")}b{background:url("../img/My Pic.jpg")}');
    expect(out.files).toEqual(['img/a.png', 'img/My Pic.jpg']);
  });

  it('takes out a reference to a folder, or to nothing', () => {
    const out = clean('b{background:url(img/)}c{background:url()}d{background:url("")}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('b{background:none}c{background:none}d{background:none}');
  });

  it('keeps a part of the page by its id (an SVG filter, clip path or mask): it loads nothing', () => {
    const out = clean('a{filter:url(#blur)}b{clip-path:url("#round-1")}c{mask:url(#m)}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{filter:url("#blur")}b{clip-path:url("#round-1")}c{mask:url("#m")}');
    expect(out.removed).toEqual([]);
    expect(out.files).toEqual([]);
  });

  it('still takes out an id that is not one, and an imported stylesheet named by an id', () => {
    const out = clean('a{filter:url("#bad id")}b{filter:url("#x\\"y")}@import url(#a);', 'css/style.css', holdsEverything);
    expect(strip(out.css)).not.toContain('#bad');
    expect(strip(out.css)).not.toContain('@import url("#a")');
  });
});

describe('anything that cannot be read with certainty', () => {
  it('becomes none and is listed: a bad address, a url() holding more than one string, an unfinished string in image-set()', () => {
    const out = clean('a{background:url(img/a b.png)}b{background:url("img/a.png" crossorigin)}c{background:url(img/a.png"x)}d{background:image-set("img/a.png\n 1x)}', 'css/style.css', holdsEverything);
    expect(strip(out.css)).toBe('a{background:none}b{background:none}c{background:none}d{background:image-set(none\n 1x)}');
    expect(out.removed.every((r) => r.why === 'not-allowed')).toBe(true);
    expect(out.files).toEqual([]);
  });

  it('reads a NUL as the replacement character, as a browser does, so it names no file', () => {
    const out = clean(`#main{color:#FFF;background:url(img/a${String.fromCharCode(0)}.png)}`);
    expect(strip(out.css)).toBe('#main{color:#FFF;background:none}');
    expect(out.removed[0]?.why).toBe('missing');
  });

  it('lists no host for an address on another site it cannot read', () => {
    const out = clean('@import "https://[x/a.css";a{}');
    expect(strip(out.css)).toBe('a{}');
    expect(out.hosts).toEqual([]);
    expect(out.removed).toEqual([{ address: 'https://[x/a.css', why: 'remote' }]);
  });

  it('closes a url() the template left open', () => {
    expect(body('a{background:url("img/a.png"')).toBe('a{background:url("./img/a.png")');
  });
});

describe('cleaning twice', () => {
  it('changes nothing the second time', () => {
    const css = '@import "base.css";/* x */@font-face{src:url(fonts/A.WOFF2),url(https://x.com/a.ttf)}a{background:image-set("img/a.png" 1x, "https://x.com/b.png" 2x),url(IMG/Hero.PNG),url(missing.png)}/*! licence */';
    const once = body(css);
    expect(body(once)).toBe(once);
  });

  it('escapes what it writes inside a kept address', () => {
    const site = new Set(['css/a"b.png']);
    expect(body('a{background:url(a\\"b.PNG)}', 'css/style.css', (p) => site.has(p))).toBe('a{background:url("./a\\"b.png")}');
  });
});

describe('resolveSitePath', () => {
  it('resolves from the stylesheet’s folder, or from the top for a leading slash', () => {
    expect(resolveSitePath('css/style.css', 'img/a.png')).toBe('css/img/a.png');
    expect(resolveSitePath('css/style.css', '../img/A.PNG?x=1#y')).toBe('img/A.png');
    expect(resolveSitePath('css/style.css', '/img/a.png')).toBe('img/a.png');
    expect(resolveSitePath('style.css', './a/./b/../c.PNG')).toBe('a/c.png');
    expect(resolveSitePath('css/style.css', 'My%20Pic.JPG')).toBe('css/My Pic.jpg');
    expect(resolveSitePath('css/style.css', '  img\\a.png ')).toBe('css/img/a.png');
    expect(resolveSitePath('style.css', 'a.b.TAR.GZ')).toBe('a.b.TAR.gz');
  });

  it('is null for an address that leaves the site or is not a relative path', () => {
    for (const address of ['../../x.png', '/../x.png', '%2e%2e/x.png', 'https://x.com/a.png', '//x.com/a.png', '\\\\x.com\\a.png', '/\\x.com/a.png', 'C:/x.png', 'data:image/png,x', '#frag', '?q', '', ' ', 'img/', 'img/..', 'a//b.png', 'a%2Fb.png', 'a%00.png', '%zz.png', 'java\tscript:x']) {
      expect(resolveSitePath('style.css', address), address).toBeNull();
    }
  });
});
