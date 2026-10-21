// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template that is a folder: the walk that never follows a link and stops at its limits,
 * the read that refuses a file swapped while it is read, the listing of a project's templates that
 * reads names only, the copy into a project (staged, renamed at the end), and `adminium new
 * --site-template`, which makes a project inside a template's folder and copies the template in
 * without touching the folder.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { clearTemplateNote, copyTemplateInto, listSiteTemplates, readNoFollow, readTemplateNote, snapshotTemplate, templateNameOf, walkFolder, writeTemplateCopy, writeTemplateNote } from '../src/designer/site/folder.js';
import { judgeSite } from '../src/designer/site/judge.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const PAGE = '<!doctype html><html><body>Fresh bread</body></html>';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-site-folder-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const put = (path: string, text: string | Buffer): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
/** A hash of everything in a folder but the names given: to say it was not changed. */
const hashOf = (root: string, except: readonly string[] = []): string => {
  const hash = createHash('sha256');
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (except.includes(relative(root, path))) continue;
      const stat = lstatSync(path);
      hash.update(`${relative(root, path)}\0`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest('hex');
};

describe('the walk of a template folder', () => {
  it('lists files with their sizes, folders and links, never following a link or entering a dot folder or node_modules', async () => {
    const root = join(dir, 'harbor');
    put(join(root, 'index.html'), PAGE);
    put(join(root, 'css', 'site.css'), 'a{}');
    put(join(root, '.git', 'HEAD'), 'ref');
    put(join(root, 'node_modules', 'x', 'index.js'), 'x');
    put(join(dir, 'outside.txt'), 'secret');
    symlinkSync(join(dir, 'outside.txt'), join(root, 'notes.txt'));
    symlinkSync(join(dir), join(root, 'up'));
    const { entries, stopped } = await walkFolder(root);
    expect(stopped).toBeNull();
    expect(entries.map((entry) => [entry.path, entry.type, entry.size])).toEqual([
      ['css/', 'dir', 0],
      ['index.html', 'file', PAGE.length],
      ['notes.txt', 'link', 0],
      ['up', 'link', 0],
      ['css/site.css', 'file', 3],
    ]);
    // A link is never read, and judged out.
    const judged = await judgeSite('harbor', entries);
    expect(judged.files.map((file) => file.path)).toEqual(['css/site.css', 'index.html']);
    expect(judged.leftOut.map((each) => [each.path, each.reason])).toEqual([
      ['notes.txt', 'link'],
      ['up', 'link'],
    ]);
  });

  it('refuses a folder that is a link, and stops at 1,000 entries or its time', async () => {
    const real = join(dir, 'real');
    put(join(real, 'index.html'), PAGE);
    symlinkSync(real, join(dir, 'linked'));
    await expect(walkFolder(join(dir, 'linked'))).rejects.toThrow('is not a folder');
    for (let index = 0; index < 12; index += 1) put(join(real, `p${String(index)}.html`), PAGE);
    expect((await walkFolder(real, { maxEntries: 10 })).stopped).toBe('too-many');
    let clock = 0;
    expect((await walkFolder(real, { maxMs: 5, now: () => (clock += 3) })).stopped).toBe('too-slow');
  });

  it('leaves out the folder a project is being made in, and does not count it', async () => {
    const root = join(dir, 'harbor');
    put(join(root, 'index.html'), PAGE);
    put(join(root, 'my-app', 'package.json'), '{}');
    const { entries, stopped } = await walkFolder(root, { leaveOut: ['my-app'], maxEntries: 1 });
    expect(entries.map((entry) => entry.path)).toEqual(['index.html']);
    expect(stopped).toBeNull();
  });
});

describe('reading one file of a template folder', () => {
  it('refuses a file swapped for a link, or for another file, after the walk saw it', async () => {
    const root = join(dir, 'harbor');
    const page = join(root, 'index.html');
    put(page, PAGE);
    put(join(dir, 'secret.txt'), 'the owner’s key');
    const seen = lstatSync(page);
    expect((await readNoFollow(root, page, seen, 1024)).toString()).toBe(PAGE);
    // The file the walk saw is moved aside, never deleted: a file system may give a new file the number of
    // one just deleted, which no dev+ino check can tell apart.
    renameSync(page, join(dir, 'aside.html'));
    // The last part made a link: not opened at all.
    symlinkSync(join(dir, 'secret.txt'), page);
    await expect(readNoFollow(root, page, seen, 1024)).rejects.toMatchObject({ code: 'ELOOP' });
    // Another file in its place: not the one the walk saw.
    rmSync(page);
    put(page, PAGE);
    await expect(readNoFollow(root, page, seen, 1024)).rejects.toThrow('changed while it was read');
  });

  it('refuses a file whose folder was swapped for a link out of the template, even to the very same file', async () => {
    const root = join(dir, 'harbor');
    put(join(root, 'css', 'site.css'), 'a{}');
    const { entries } = await walkFolder(root);
    const css = entries.find((entry) => entry.path === 'css/site.css');
    // The folder moved out, and a link to it put in its place: the file is the one the walk saw, outside.
    renameSync(join(root, 'css'), join(dir, 'moved'));
    symlinkSync(join(dir, 'moved'), join(root, 'css'));
    await expect(css?.read()).rejects.toThrow('lies outside its folder');
  });
});

describe('the listing of a project’s site templates', () => {
  it('names real folders holding a page at their top or one folder down, and nothing else', async () => {
    const tpl = join(dir, 'site-templates');
    put(join(tpl, 'harbor-bakery', 'index.html'), PAGE);
    put(join(tpl, 'lantern-books', 'lantern-books', 'about.htm'), PAGE);
    put(join(tpl, 'harbor bakery!', 'index.html'), PAGE);
    put(join(tpl, 'no-page', 'readme.md'), '# x');
    put(join(tpl, '.harbor.partial', 'index.html'), PAGE);
    put(join(tpl, 'loose.html'), PAGE);
    put(join(dir, 'elsewhere', 'index.html'), PAGE);
    symlinkSync(join(dir, 'elsewhere'), join(tpl, 'linked'));
    // Names only: a page nobody may read is still found by its name.
    chmodSync(join(tpl, 'harbor-bakery', 'index.html'), 0o000);
    expect(await listSiteTemplates(dir)).toEqual({
      templates: [
        { name: 'harbor bakery!', usable: false },
        { name: 'harbor-bakery', usable: true },
        { name: 'lantern-books', usable: true },
      ],
      more: 0,
    });
    chmodSync(join(tpl, 'harbor-bakery', 'index.html'), 0o644);
    expect(await listSiteTemplates(join(dir, 'none'))).toEqual({ templates: [], more: 0 });
  });

  it('stops at 100 names and says how many more', async () => {
    for (let index = 0; index < 103; index += 1) put(join(dir, 'site-templates', `t${String(index).padStart(3, '0')}`, 'index.html'), PAGE);
    const listed = await listSiteTemplates(dir);
    expect(listed.templates).toHaveLength(100);
    expect(listed.more).toBe(3);
  });
});

describe('a template’s copy into a project', () => {
  it('is staged in a dot folder and renamed into place; a crash before the rename is offered nowhere and cleared by the next copy', async () => {
    const files = [
      { path: 'index.html', bytes: Buffer.from(PAGE) },
      { path: 'css/site.css', bytes: Buffer.from('a{}') },
    ];
    // A crash left a half copy behind: the listing skips it, and the next copy starts clean.
    put(join(dir, 'site-templates', '.harbor.partial', 'index.html'), 'half');
    expect((await listSiteTemplates(dir)).templates).toEqual([]);
    expect(await writeTemplateCopy(dir, 'harbor', files)).toBe('copied');
    expect(readdirSync(join(dir, 'site-templates'))).toEqual(['harbor']);
    expect(readFileSync(join(dir, 'site-templates', 'harbor', 'css', 'site.css'), 'utf8')).toBe('a{}');
    expect(await writeTemplateCopy(dir, 'harbor', files)).toBe('exists');
    // A copy that fails part way leaves nothing.
    await expect(writeTemplateCopy(dir, 'broken', [files[0]!, { path: 'x.css', bytes: 42 as unknown as Buffer }])).rejects.toThrow();
    expect(readdirSync(join(dir, 'site-templates'))).toEqual(['harbor']);
  });

  it('takes a usable name from the folder’s, and keeps why one was not copied until it is put away', async () => {
    expect(templateNameOf('harbor-bakery')).toBe('harbor-bakery');
    expect(templateNameOf('Harbor Bakery (v2)!')).toBe('Harbor Bakery -v2-');
    expect(templateNameOf('...')).toBe('site');
    expect(await readTemplateNote(dir)).toBeNull();
    await writeTemplateNote(dir, { name: 'Downloads', why: 'Downloads holds more than 1,000 files and folders.' });
    expect(await readTemplateNote(dir)).toEqual({ name: 'Downloads', why: 'Downloads holds more than 1,000 files and folders.' });
    await clearTemplateNote(dir);
    expect(await readTemplateNote(dir)).toBeNull();
  });

  it('says why a folder too large to be a template is not copied', async () => {
    const root = join(dir, 'Downloads');
    put(join(root, 'index.html'), PAGE);
    const snapshot = { entries: [], stopped: 'too-many' as const };
    expect(await copyTemplateInto('Downloads', snapshot, root, 'Downloads')).toEqual({ copied: false, why: 'Downloads holds more than 1,000 files and folders.' });
    const copied = await copyTemplateInto('harbor', await snapshotTemplate(root, 'none'), root, 'x');
    expect(copied).toEqual({ copied: true, pages: 1, files: 1 });
  });
});

describe('adminium new --site-template', () => {
  const make = async (folder: string, extra: string[] = []): Promise<{ code: number; out: string }> => {
    const io = fakeIo({ interactive: false });
    const code = await runCli(['new', 'my-app', '--yes', '--no-install', '--no-git', '--site-template', folder, ...extra], { io, deps: fakeDeps({ cwd: folder, env: {} }) });
    return { code, out: io.stdout() };
  };

  it('makes the project inside the template’s folder, copies the template in through the judge, and leaves the folder as it was', async () => {
    const root = join(dir, 'harbor-bakery');
    put(join(root, 'index.html'), PAGE);
    put(join(root, 'css', 'site.css'), 'body{color:#3b2a1a}');
    put(join(root, 'shop.php'), '<?php');
    put(join(root, '.git', 'HEAD'), 'ref');
    const before = hashOf(root);
    const { code, out } = await make(root);
    expect(code).toBe(0);
    const copy = join(root, 'my-app', 'site-templates', 'harbor-bakery');
    expect(readdirSync(copy).sort()).toEqual(['css', 'index.html']);
    expect(existsSync(join(copy, 'shop.php'))).toBe(false);
    // The project never went into its own copy.
    expect(existsSync(join(copy, 'my-app'))).toBe(false);
    expect(out).toContain("Copied the site template in harbor-bakery into site-templates/harbor-bakery/ (1 page, 2 files). harbor-bakery's own files were not changed.");
    expect(hashOf(root, ['my-app'])).toBe(before);
    expect(await listSiteTemplates(join(root, 'my-app'))).toEqual({ templates: [{ name: 'harbor-bakery', usable: true }], more: 0 });
  });

  it('still makes the project in a folder that is not a template, and says why it was not copied', async () => {
    const root = join(dir, 'Downloads');
    put(join(root, 'index.html'), PAGE);
    for (let index = 0; index < 1000; index += 1) put(join(root, `scan-${String(index)}.pdf`), '%PDF');
    const { code, out } = await make(root);
    expect(code).toBe(0);
    expect(existsSync(join(root, 'my-app', 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'my-app', 'site-templates'))).toBe(false);
    const why = 'Downloads holds more than 1,000 files and folders.';
    expect(out).toContain(`Downloads was not copied in as a site template: ${why}`);
    expect(await readTemplateNote(join(root, 'my-app'))).toEqual({ name: 'Downloads', why });
    // A template the judge refuses says the judge's own sentence.
    const other = join(dir, 'Shop');
    put(join(other, 'index.html'), PAGE);
    put(join(other, 'con.html'), PAGE);
    expect((await make(other)).out).toContain('Shop was not copied in as a site template: Shop has a file named con.html, a name Windows keeps for itself.');
  });

  it('says nothing and copies nothing from a folder with no page at its top', async () => {
    const root = join(dir, 'Projects');
    put(join(root, 'notes', 'index.html'), PAGE);
    const { code, out } = await make(root);
    expect(code).toBe(0);
    expect(existsSync(join(root, 'my-app', 'site-templates'))).toBe(false);
    expect(out).not.toContain('site template');
    expect(await readTemplateNote(join(root, 'my-app'))).toBeNull();
  });
});
