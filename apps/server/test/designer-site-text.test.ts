// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page or a stylesheet of a site template, as text a model reads: what starts as a page, what
 * is minified, how a window is cut, which files a page names, and what a minified file's summary
 * holds.
 */
import { describe, expect, it } from 'vitest';

import { countWords, isMinified, minifiedSummary, namedFiles, SITE_WINDOW_CHARS, startsAsPage, textWindow } from '../src/designer/site-text.js';

describe('what starts as a page', () => {
  it('is a doctype, <html>, <head> or <body>, after blank space, a byte-order mark and comments', () => {
    expect(startsAsPage('<!doctype html><html></html>')).toBe(true);
    expect(startsAsPage('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">')).toBe(true);
    expect(startsAsPage('\uFEFF\n  <html lang="en">')).toBe(true);
    expect(startsAsPage('<head><title>x</title></head>')).toBe(true);
    expect(startsAsPage('<body>')).toBe(true);
    expect(startsAsPage('<!-- Template by someone -->\n<!-- v2 -->\n<!DOCTYPE html>')).toBe(true);
  });

  it('is not a fragment, an unclosed comment, an SVG, a CSV that starts with a tag, or a tag that only starts like one', () => {
    expect(startsAsPage('<div class="hero">')).toBe(false);
    expect(startsAsPage('<!-- never closed <html>')).toBe(false);
    expect(startsAsPage('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
    expect(startsAsPage('<table>,a\n1,2')).toBe(false);
    expect(startsAsPage('<htmlx>')).toBe(false);
    expect(startsAsPage('<bodyguard>')).toBe(false);
    expect(startsAsPage('body { color: red }')).toBe(false);
  });
});

describe('a minified file', () => {
  it('is one longer than a window with most of it on lines no person writes', () => {
    const rule = '.a{color:#123456;margin:0 auto}';
    expect(isMinified(rule.repeat(1000))).toBe(true);
    // The same rules a line each: read a window at a time.
    expect(isMinified(Array.from({ length: 1000 }, () => rule).join('\n'))).toBe(false);
    // One long line among many a person wrote (an inlined picture): still paged.
    expect(isMinified([`.logo{background:url(data:image/png;base64,${'A'.repeat(1500)})}`, ...Array.from({ length: 1000 }, () => rule)].join('\n'))).toBe(false);
    // Short enough for one window: read whole, whatever its lines.
    expect(isMinified(rule.repeat(100))).toBe(false);
  });
});

describe('a window of text', () => {
  it('gives the characters asked, counted from 1, and says where it ends', () => {
    expect(textWindow('abcdefghij', 3, 4)).toEqual({ text: 'cdef', from: 3, to: 6, of: 10 });
    expect(textWindow('abc', 1)).toEqual({ text: 'abc', from: 1, to: 3, of: 3 });
    expect(textWindow('abc', 0, 2)).toEqual({ text: 'ab', from: 1, to: 2, of: 3 });
  });

  it('stops at a line end near its end, and never between the halves of a pair', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${String(index).padStart(3, '0')} ${'x'.repeat(30)}`).join('\n');
    const first = textWindow(lines, 1);
    expect(first.text.endsWith('\n')).toBe(true);
    expect(first.to).toBeLessThanOrEqual(SITE_WINDOW_CHARS);
    expect(first.to).toBeGreaterThan(SITE_WINDOW_CHARS * 0.8);
    // The next window starts where this one stopped: nothing is skipped or read twice.
    const second = textWindow(lines, first.to + 1);
    expect(lines.slice(0, first.to) + second.text).toBe(lines.slice(0, second.to));
    // An emoji across the cut stays whole in the next window.
    const pair = `${'a'.repeat(9)}😀b`;
    const cut = textWindow(pair, 1, 10);
    expect(cut.text).toBe('a'.repeat(9));
    expect(textWindow(pair, cut.to + 1, 10).text).toBe('😀b');
  });
});

describe('the files a page names', () => {
  it('reads the stylesheets, scripts, pictures, fonts and other pages it names, once each, and the other sites by host only', () => {
    const page = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="css/style.css?v=3">',
      "<link rel=stylesheet href='https://fonts.googleapis.com/css2?family=Lora'>",
      '<script src="js/main.js"></script><script src="//cdn.example.org/lib.js"></script>',
      '<style>.hero{background:url("img/hero.jpg")} @font-face{src:url(fonts/lora.woff2)}</style>',
      '</head><body>',
      '<a href="about.html#team">About</a><a href="#top">Top</a><a href="mailto:a@example.test">Mail</a><a href="javascript:void(0)">x</a>',
      '<img src="img/hero.jpg" srcset="img/hero-2x.jpg 2x, img/hero-3x.jpg 3x"><img src="data:image/png;base64,AAAA"><img src={{photo}}>',
      '<video poster="img/poster.webp"></video><a href="docs/brochure.pdf">pdf</a>',
      // A template's own placeholders are not files.
      '<img src="${base}/img/a.png"><img src="{{ asset }}/img/b.png"><a href="#gallery.html">x</a>',
      '</body></html>',
    ].join('\n');
    const named = namedFiles('html', page);
    expect(named.local).toEqual([
      { path: 'img/hero.jpg', kind: 'picture' },
      { path: 'fonts/lora.woff2', kind: 'font' },
      { path: 'css/style.css', kind: 'stylesheet' },
      { path: 'js/main.js', kind: 'script' },
      { path: 'about.html', kind: 'page' },
      { path: 'img/poster.webp', kind: 'picture' },
      { path: 'img/hero-2x.jpg', kind: 'picture' },
      { path: 'img/hero-3x.jpg', kind: 'picture' },
    ]);
    expect(named.hosts.sort()).toEqual(['cdn.example.org', 'fonts.googleapis.com']);
  });

  it('reads a stylesheet’s url() and @import, and never a page’s attributes in it', () => {
    const css = '@import "base.css"; @import url(\'theme.css\'); .a{background:url( ../img/bg.png )} .b{src:url(https://x.example/f.woff2)} /* href="x.html" */';
    expect(namedFiles('css', css).local).toEqual([
      { path: 'base.css', kind: 'stylesheet' },
      { path: 'theme.css', kind: 'stylesheet' },
      { path: '../img/bg.png', kind: 'picture' },
    ]);
    expect(namedFiles('css', css).hosts).toEqual(['x.example']);
  });

  it('counts files by kind in words', () => {
    expect(countWords([])).toBe('');
    expect(countWords([{ kind: 'picture' }])).toBe('1 picture');
    expect(countWords([{ kind: 'picture' }, { kind: 'stylesheet' }, { kind: 'picture' }, { kind: 'script' }])).toBe('1 stylesheet, 1 script and 2 pictures');
    expect(countWords([{ kind: 'page' }, { kind: 'font' }])).toBe('1 other page and 1 font');
  });
});

describe('a minified file’s summary', () => {
  it('says what a stylesheet holds: its rules, colours by use and font families, each a plain line', () => {
    const css = `${'.a{color:#ff385c}'.repeat(5)}.b{color:#222222;font-family:"Lora",\nserif}@media (max-width:600px){.c{color:rgb(1, 2, 3)}}@font-face{font-family:Inter\u202e;src:url(f.woff2)}:root{--brand:#ff385c}`;
    const summary = minifiedSummary('css', css);
    expect(summary).toContain('minified.');
    expect(summary).toContain('@media blocks: 1; @font-face: 1; custom properties: 1');
    expect(summary).toContain('colours, the most used first: #ff385c, #222222, rgb(1,2,3)');
    expect(summary).toContain('- "Lora", serif');
    // A direction-changing character in the template's words is gone.
    expect(summary.endsWith('- Inter')).toBe(true);
  });

  it('says what a page holds: its title, language, headings and counts, the markup gone', () => {
    const html = `<!doctype html><html lang="en"><head><title>Harbor <b>Bakery</b></title><style>.x{color:#abcdef}</style></head><body><h1>Fresh <em>bread</em></h1><h2>Menu</h2><form></form><a href="#">a</a><img src="a.png"></body></html>`;
    const summary = minifiedSummary('html', html);
    expect(summary).toContain('title: Harbor Bakery');
    expect(summary).toContain('language: en');
    expect(summary).toContain('- h1 Fresh bread\n- h2 Menu');
    expect(summary).toContain('forms: 1; links: 1; pictures: 1');
    expect(summary).toContain('colours, the most used first: #abcdef');
  });
});
