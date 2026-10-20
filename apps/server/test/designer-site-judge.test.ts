// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The judge of a site template: one set of rules whichever reader hands it the entries. What
 * refuses the whole template (with the sentence the person reads), what is left out with its reason,
 * what is kept and how, and the limits.
 */
import { describe, expect, it } from 'vitest';

import { judgeSite, SITE_MAX_FILES, type SiteEntry } from '../src/designer/site/judge.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PAGE = '<!doctype html><html><body>Hi</body></html>';

/** An entry read from memory; a folder when its path ends in `/`. */
const at = (path: string, data: Buffer | string = PAGE, type: SiteEntry['type'] = path.endsWith('/') ? 'dir' : 'file'): SiteEntry => {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data;
  return { path, size: bytes.length, type, read: async () => bytes };
};
/** The sentence a template is refused with, or "kept". */
async function said(entries: SiteEntry[]): Promise<string> {
  try {
    await judgeSite('harbor.zip', entries);
    return 'kept';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('a path that could land anywhere but where it says', () => {
  it('refuses the whole template, at any depth, naming the file', async () => {
    expect(await said([at('index.html'), at('../evil.html')])).toBe('harbor.zip has a file whose name walks out of its folder (../evil.html).');
    expect(await said([at('index.html'), at('a/./b.css', 'b{}')])).toBe('harbor.zip has a file whose name walks out of its folder (a/./b.css).');
    expect(await said([at('index.html'), at('a//b.css', 'b{}')])).toMatch(/walks out of its folder/);
    expect(await said([at('/etc/x.html')])).toBe('harbor.zip has a file named from the top of a disk (/etc/x.html).');
    expect(await said([at('C:/x.html')])).toMatch(/top of a disk/);
    expect(await said([at('css\\site.css', 'a{}'), at('index.html')])).toBe('harbor.zip has a file whose name holds a backslash (css\\site.css).');
    expect(await said([at('in\u0007dex.html')])).toBe('harbor.zip has a file whose name holds a control character.');
  });

  it('refuses a name Windows cannot hold: a colon, a trailing dot or space, a device name', async () => {
    expect(await said([at('index.html'), at('img/a:b.png', PNG)])).toBe('harbor.zip has a file whose name holds a colon, which Windows cannot hold (img/a:b.png).');
    expect(await said([at('index.html'), at('img./a.png', PNG)])).toBe('harbor.zip has a file whose name ends in a dot or a space, which Windows cannot hold (img./a.png).');
    expect(await said([at('index.html '), at('a.css', 'a{}')])).toMatch(/ends in a dot or a space/);
    expect(await said([at('index.html'), at('con.html')])).toBe('harbor.zip has a file named con.html, a name Windows keeps for itself.');
    expect(await said([at('index.html'), at('assets/AUX/x.css', 'a{}')])).toBe('harbor.zip has a file named AUX, a name Windows keeps for itself.');
    expect(await said([at('index.html'), at('lpt1')])).toMatch(/keeps for itself/);
    // Junk is checked too: a bad name anywhere refuses the template.
    expect(await said([at('index.html'), at('__MACOSX/nul.txt', 'x')])).toMatch(/keeps for itself/);
  });

  it('refuses two paths that are one once folded, naming both', async () => {
    expect(await said([at('About.html'), at('about.html')])).toBe('Two files have the same name apart from capital letters: About.html and about.html.');
    // The same letter written two ways in Unicode, and a letter that folds to two.
    expect(await said([at('caf\u00e9.html'), at('cafe\u0301.html')])).toMatch(/^Two files have the same name/);
    expect(await said([at('stra\u00dfe.html'), at('STRASSE.html')])).toMatch(/^Two files have the same name/);
    // A folder and a file of one name.
    expect(await said([at('Css/'), at('css', 'x'), at('index.html')])).toMatch(/^Two files have the same name/);
    expect(await said([at('index.html'), at('index.html')])).toBe('harbor.zip holds index.html twice.');
  });
});

describe('what is kept and what is left out', () => {
  it('keeps pages, stylesheets, scripts, pictures, safe SVG, fonts and licence text, judged by their bytes', async () => {
    const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40, 2)]);
    const ttf = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(40, 3)]);
    const eot = Buffer.alloc(40, 4);
    eot[34] = 0x4c;
    eot[35] = 0x50;
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(20)]);
    const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(20)]);
    const judged = await judgeSite('t.zip', [
      at('index.html'),
      at('about.htm'),
      at('css/site.css', 'a{}'),
      at('js/menu.js', 'let a = 1;'),
      at('img/hero.png', PNG),
      at('img/new.avif', avif),
      at('favicon.ico', ico),
      at('img/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'),
      at('fonts/a.woff2', woff2),
      at('fonts/b.ttf', ttf),
      at('fonts/c.eot', eot),
      at('LICENSE', 'MIT'),
      at('readme.md', '# Read me'),
    ]);
    expect(judged.files.map((file) => [file.path, file.kind])).toEqual([
      ['LICENSE', 'text'],
      ['about.htm', 'html'],
      ['css/site.css', 'css'],
      ['favicon.ico', 'picture'],
      ['fonts/a.woff2', 'font'],
      ['fonts/b.ttf', 'font'],
      ['fonts/c.eot', 'font'],
      ['img/hero.png', 'picture'],
      ['img/logo.svg', 'svg'],
      ['img/new.avif', 'picture'],
      ['index.html', 'html'],
      ['js/menu.js', 'js'],
      ['readme.md', 'text'],
    ]);
    expect(judged.pages).toBe(2);
    expect(judged.leftOut).toEqual([]);
  });

  it('leaves out, with a reason each, what is not kept; what an operating system adds goes without a word', async () => {
    const judged = await judgeSite('t.zip', [
      at('index.html'),
      at('shop.php', '<?php echo 1;'),
      at('media/intro.mp4', 'x'),
      at('scss/site.scss', 'a{}'),
      at('js/app.js.map', '{}'),
      at('package.json', '{}'),
      at('node_modules/lib/index.js', 'x'),
      at('.htaccess', 'x'),
      at('backup.zip', 'PK'),
      at('img/fake.png', 'not a picture'),
      at('fonts/fake.woff2', 'not a font'),
      at('img/run.svg', '<svg><script>alert(1)</script></svg>'),
      at('img/load.svg', '<svg onload="x()"></svg>'),
      at('img/frame.svg', '<svg><foreignObject><div/></foreignObject></svg>'),
      at('img/not.svg', 'plain words'),
      at('old.html', Buffer.from([0x3c, 0x70, 0x3e, 0xe9])),
      at('logo.png', 'x', 'link'),
      at('notes.docx', 'x'),
      at('__MACOSX/._index.html', 'x'),
      at('.DS_Store', 'x'),
      at('img/Thumbs.db', 'x'),
    ]);
    expect(judged.files.map((file) => file.path)).toEqual(['index.html']);
    expect(judged.leftOut).toEqual([
      { path: 'shop.php', reason: 'php', why: 'PHP is not used' },
      { path: 'media/intro.mp4', reason: 'video', why: 'videos are not kept' },
      { path: 'scss/site.scss', reason: 'scss', why: 'SCSS and Less are not used; their CSS is' },
      { path: 'js/app.js.map', reason: 'map', why: 'source maps are not kept' },
      { path: 'package.json', reason: 'build-file', why: 'build files are not used' },
      { path: 'node_modules/lib/index.js', reason: 'build-folder', why: 'build folders are not used' },
      { path: '.htaccess', reason: 'hidden', why: 'hidden files are not kept' },
      { path: 'backup.zip', reason: 'zip', why: 'a zip inside the template is not opened' },
      { path: 'logo.png', reason: 'link', why: 'links are not followed' },
      { path: 'notes.docx', reason: 'kind', why: 'this kind of file is not kept' },
      { path: 'img/fake.png', reason: 'not-picture', why: 'it is not the picture its name says' },
      { path: 'fonts/fake.woff2', reason: 'not-font', why: 'it is not the font its name says' },
      { path: 'img/run.svg', reason: 'svg-runs', why: 'it holds a script or a link that runs, so it is not kept' },
      { path: 'img/load.svg', reason: 'svg-runs', why: 'it holds a script or a link that runs, so it is not kept' },
      { path: 'img/frame.svg', reason: 'svg-runs', why: 'it holds a script or a link that runs, so it is not kept' },
      { path: 'img/not.svg', reason: 'not-svg', why: 'it is not an SVG picture' },
      { path: 'old.html', reason: 'not-text', why: 'it does not read as text' },
    ]);
    expect(judged.leftOutCount).toBe(17);
  });

  it('takes off one folder that wraps everything, and keeps two tops as they are', async () => {
    const wrapped = await judgeSite('t.zip', [at('harbor/'), at('harbor/index.html'), at('harbor/css/a.css', 'a{}'), at('__MACOSX/harbor/._index.html', 'x')]);
    expect(wrapped.files.map((file) => file.path)).toEqual(['css/a.css', 'index.html']);
    const two = await judgeSite('t.zip', [at('harbor/index.html'), at('other/a.css', 'a{}')]);
    expect(two.files.map((file) => file.path)).toEqual(['harbor/index.html', 'other/a.css']);
    // The same files, wrapped or not, in any order: one site.
    const plain = await judgeSite('t.zip', [at('css/a.css', 'a{}'), at('index.html')]);
    expect(plain.sha256).toBe(wrapped.sha256);
    expect(plain.sha256).not.toBe(two.sha256);
  });

  it('refuses one with nothing a site is made of', async () => {
    expect(await said([at('shop.php', 'x'), at('img/a.png', PNG)])).toBe('harbor.zip holds no page or stylesheet of a site.');
  });
});

describe('the limits', () => {
  it('refuses more than 1,000 entries, 300 files to keep, or 24 MB to keep, before a byte is read', async () => {
    let reads = 0;
    const counted = (path: string, size: number): SiteEntry => ({ path, size, type: 'file', read: async () => ((reads += 1), Buffer.from(PAGE)) });
    expect(await said(Array.from({ length: 1001 }, (_, index) => counted(`p${String(index)}.php`, 1)))).toBe('harbor.zip has more than 1,000 files and folders.');
    expect(await said(Array.from({ length: SITE_MAX_FILES + 1 }, (_, index) => counted(`p${String(index)}.html`, 10)))).toBe('harbor.zip has more than 300 files to keep.');
    expect(await said(Array.from({ length: 50 }, (_, index) => counted(`img/p${String(index)}.png`, 500 * 1024)))).toBe('harbor.zip holds more than 24 MB of files to keep.');
    expect(reads).toBe(0);
  });

  it('refuses a file over its kind’s limit, a path over 200 characters, and one more than 8 folders deep', async () => {
    expect(await said([at('index.html'), { path: 'img/huge.png', size: 5 * 1024 * 1024 + 1, type: 'file', read: async () => PNG }])).toBe('img/huge.png is over 5 MB, larger than a picture of a site template is.');
    expect(await said([{ path: 'index.html', size: 512 * 1024 + 1, type: 'file', read: async () => Buffer.from(PAGE) }])).toBe('index.html is over 512 KB, larger than a page of a site template is.');
    expect(await said([at('index.html'), at(`${'a'.repeat(200)}.css`, 'a{}')])).toMatch(/^harbor\.zip has a file path over 200 characters/);
    expect(await said([at('index.html'), at('1/2/3/4/5/6/7/8/9/a.css', 'a{}')])).toBe('harbor.zip has a file more than 8 folders deep (1/2/3/4/5/6/7/8/9/a.css).');
    expect(await said([at('index.html'), at('1/2/3/4/5/6/7/8/a.css', 'a{}')])).toBe('kept');
    // A reader whose bytes outrun what it declared.
    expect(await said([{ path: 'index.html', size: 4, type: 'file', read: async () => Buffer.from(PAGE) }])).toBe('index.html is larger than it says.');
  });
});
