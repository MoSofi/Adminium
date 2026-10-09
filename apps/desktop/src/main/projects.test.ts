// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig, MAX_RECENT_PROJECTS, type DesktopConfig } from './config.js';
import { folderNameFor, forgetProject, isProjectFolder, judgeNewProjectFolder, proposedParent, realFolderDeps, recentProjects, relocateProject, rememberProject, type FolderDeps } from './projects.js';

const config = (): DesktopConfig => createDefaultConfig('/data');
const at = (iso: string): Date => new Date(iso);

describe('the recent list', () => {
  it('puts what was opened at the head, as opened now, building by default', () => {
    const one = rememberProject(config(), { path: '/p/juniper', name: 'Juniper Kitchen' }, at('2026-10-09T10:00:00Z'));
    const two = rememberProject(one, { path: '/p/repairs', name: 'Repairs' }, at('2026-10-09T11:00:00Z'));
    expect(two.projects.map((project) => project.name)).toEqual(['Repairs', 'Juniper Kitchen']);
    expect(two.projects[0]).toEqual({ path: '/p/repairs', name: 'Repairs', lastOpened: '2026-10-09T11:00:00.000Z', state: 'building', sharePort: null, trusted: null });
  });

  it('opening a listed project again keeps its share port and its trust, and moves it up', () => {
    let c = rememberProject(config(), { path: '/p/juniper', name: 'Juniper Kitchen', sharePort: 4712, trusted: 'sha256:aa', state: 'shared' }, at('2026-10-08T10:00:00Z'));
    c = rememberProject(c, { path: '/p/repairs', name: 'Repairs' }, at('2026-10-09T10:00:00Z'));
    c = rememberProject(c, { path: '/p/juniper', name: 'Juniper Kitchen (renamed)' }, at('2026-10-10T10:00:00Z'));
    expect(c.projects).toHaveLength(2);
    expect(c.projects[0]).toMatchObject({ name: 'Juniper Kitchen (renamed)', sharePort: 4712, trusted: 'sha256:aa', state: 'shared' });
    // Said outright, a value replaces what was kept: trust taken away, back to building.
    expect(rememberProject(c, { path: '/p/juniper', name: 'J', trusted: null, state: 'building' }).projects[0]).toMatchObject({ trusted: null, state: 'building', sharePort: 4712 });
  });

  it('keeps the newest twelve', () => {
    let c = config();
    for (let i = 0; i < MAX_RECENT_PROJECTS + 5; i += 1) c = rememberProject(c, { path: `/p/${String(i)}`, name: `P${String(i)}` }, new Date(Date.UTC(2026, 9, 1, 0, i)));
    expect(c.projects).toHaveLength(MAX_RECENT_PROJECTS);
    expect(c.projects[0]?.name).toBe(`P${String(MAX_RECENT_PROJECTS + 4)}`);
    expect(c.projects.map((project) => project.name)).not.toContain('P0');
  });

  it('lists newest first and says which folders are gone', () => {
    let c = rememberProject(config(), { path: '/p/old', name: 'Old' }, at('2026-10-01T00:00:00Z'));
    c = rememberProject(c, { path: '/p/new', name: 'New' }, at('2026-10-09T00:00:00Z'));
    const exists = (path: string): boolean => path === '/p/new/adminium.config.ts';
    expect(recentProjects(c, exists).map((project) => [project.name, project.missing])).toEqual([
      ['New', false],
      ['Old', true],
    ]);
    // A folder that is there but is no longer a project is as gone as a deleted one.
    expect(isProjectFolder('/p/old', (path) => path === '/p/old')).toBe(false);
  });

  it('"Remove" forgets the folder and touches nothing else', () => {
    const c = rememberProject(rememberProject(config(), { path: '/a', name: 'A' }), { path: '/b', name: 'B' });
    expect(forgetProject(c, '/a').projects.map((project) => project.path)).toEqual(['/b']);
    expect(forgetProject(c, '/not-listed')).toEqual(c);
  });

  it('"Locate…" moves the entry to a folder that is a project, and asks about trust again', () => {
    const c = rememberProject(config(), { path: '/old/juniper', name: 'Juniper', trusted: 'sha256:aa', sharePort: 4712 }, at('2026-10-09T00:00:00Z'));
    const isProject = (path: string): boolean => path === '/new/juniper/adminium.config.ts';
    const moved = relocateProject(c, '/old/juniper', '/new/juniper', isProject);
    expect(moved).toMatchObject({ ok: true });
    expect(moved.ok && moved.config.projects[0]).toMatchObject({ path: '/new/juniper', name: 'Juniper', sharePort: 4712, trusted: null, lastOpened: '2026-10-09T00:00:00.000Z' });
    expect(relocateProject(c, '/old/juniper', '/new/photos', isProject)).toEqual({ ok: false, reason: 'not-a-project' });
    expect(relocateProject(c, '/never/listed', '/new/juniper', isProject)).toEqual({ ok: false, reason: 'not-listed' });
    const both = rememberProject(c, { path: '/new/juniper', name: 'Other' });
    expect(relocateProject(both, '/old/juniper', '/new/juniper', isProject)).toEqual({ ok: false, reason: 'already-listed' });
  });
});

describe('a project’s folder name', () => {
  it.each([
    ['Juniper Kitchen', 'juniper-kitchen'],
    ['  Café Zoë — menu & orders!  ', 'cafe-zoe-menu-orders'],
    ['مطعم', ''],
    ['../../etc', 'etc'],
    ['a'.repeat(90), 'a'.repeat(60)],
  ])('%s → %s', (name, folder) => {
    expect(folderNameFor(name)).toBe(folder);
  });

  it('is proposed under Adminium in the home folder', () => {
    expect(proposedParent('/Users/ava')).toBe(join('/Users/ava', 'Adminium'));
  });
});

describe('where a new project may go', () => {
  const HOME = '/Users/ava';
  function deps(over: Partial<FolderDeps> & { folders?: Record<string, string[]>; files?: string[] } = {}): FolderDeps {
    const folders = over.folders ?? {};
    const files = over.files ?? [];
    const known = new Set([HOME, '/Users', '/', '/Applications/Adminium.app', ...Object.keys(folders), ...files]);
    return {
      home: HOME,
      appDir: '/Applications/Adminium.app/Contents/Resources',
      platform: 'darwin',
      exists: (path) => known.has(path),
      real: (path) => path,
      list: (path) => folders[path] ?? null,
      ...over,
    };
  }

  it('the proposed place is fine: a new folder under ~/Adminium', () => {
    expect(judgeNewProjectFolder('/Users/ava/Adminium', 'Juniper Kitchen', deps())).toEqual({ ok: true, path: '/Users/ava/Adminium/juniper-kitchen', warning: null });
  });

  it.each([
    ['no name', '/Users/ava/Adminium', '   ', 'no-name'],
    ['a name with nothing a folder can be called', '/Users/ava/Adminium', 'مطعم', 'bad-name'],
    ['a parent that is not a full path', 'Adminium', 'Juniper', 'not-absolute'],
    ['a system folder', '/Library', 'Juniper', 'system-folder'],
    ['the applications folder', '/Applications', 'Juniper', 'system-folder'],
    ['inside the app itself', '/Applications/Adminium.app/Contents/Resources', 'Juniper', 'inside-the-app'],
  ])('refuses %s', (_label, parent, name, refused) => {
    expect(judgeNewProjectFolder(parent, name, deps())).toMatchObject({ ok: false, refused });
  });

  it('refuses the home folder itself, however it is reached', () => {
    // `/Users` + a name that makes "ava": the folder asked for IS the home folder.
    expect(judgeNewProjectFolder('/Users', 'Ava', deps())).toMatchObject({ ok: false, refused: 'home-folder' });
  });

  it('refuses a folder inside another project, at any depth, and through a link', () => {
    const inside = deps({ files: ['/Users/ava/work/shop/adminium.config.ts'], folders: { '/Users/ava/work/shop': ['adminium.config.ts', 'apps'], '/Users/ava/work/shop/apps': [] } });
    expect(judgeNewProjectFolder('/Users/ava/work/shop', 'Second', inside)).toMatchObject({ ok: false, refused: 'inside-a-project' });
    expect(judgeNewProjectFolder('/Users/ava/work/shop/apps', 'Second', inside)).toMatchObject({ ok: false, refused: 'inside-a-project' });
    // A link that leads into a project is judged by where it really is.
    const linked = deps({
      files: ['/Users/ava/work/shop/adminium.config.ts', '/Users/ava/shortcut'],
      folders: { '/Users/ava/work/shop': ['adminium.config.ts', 'apps'], '/Users/ava/work/shop/apps': [] },
      real: (path) => (path === '/Users/ava/shortcut' ? '/Users/ava/work/shop/apps' : path),
    });
    expect(judgeNewProjectFolder('/Users/ava/shortcut', 'Second', linked)).toMatchObject({ ok: false, refused: 'inside-a-project', path: '/Users/ava/work/shop/apps/second' });
  });

  it('refuses a folder that already holds files, and takes an empty one', () => {
    expect(judgeNewProjectFolder('/Users/ava/Adminium', 'Juniper', deps({ folders: { '/Users/ava/Adminium/juniper': ['notes.txt'] } }))).toMatchObject({ ok: false, refused: 'exists-with-files' });
    expect(judgeNewProjectFolder('/Users/ava/Adminium', 'Juniper', deps({ folders: { '/Users/ava/Adminium/juniper': ['.DS_Store'] } }))).toMatchObject({ ok: true });
    expect(judgeNewProjectFolder('/Users/ava/Adminium', 'Juniper', deps({ folders: { '/Users/ava/Adminium/juniper': [] } }))).toMatchObject({ ok: true });
  });

  it.each([
    ['/Users/ava/Library/Mobile Documents/com~apple~CloudDocs', 'icloud'],
    ['/Users/ava/OneDrive', 'onedrive'],
    ['/Users/ava/Dropbox/work', 'dropbox'],
    ['/Users/ava/Google Drive', 'googledrive'],
  ])('warns about a synced folder (%s), and leaves the choice to the person', (parent, warning) => {
    expect(judgeNewProjectFolder(parent, 'Juniper', deps())).toMatchObject({ ok: true, warning });
  });

  it('warns about a disk that cannot hold links, and says nothing when it could not tell', () => {
    expect(judgeNewProjectFolder('/Volumes/USB', 'Juniper', deps({ holdsLinks: () => false }))).toMatchObject({ ok: true, warning: 'no-links' });
    expect(judgeNewProjectFolder('/Volumes/USB', 'Juniper', deps({ holdsLinks: () => null }))).toMatchObject({ ok: true, warning: null });
  });

  it('a home folder that itself lies under a system name is still the person’s', () => {
    const linux = deps({ home: '/var/home/ava', platform: 'linux' });
    expect(judgeNewProjectFolder('/var/home/ava/Adminium', 'Juniper', linux)).toMatchObject({ ok: true });
    expect(judgeNewProjectFolder('/var/lib', 'Juniper', linux)).toMatchObject({ ok: false, refused: 'system-folder' });
  });
});

describe('on a real disk', () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-projects-')));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sees a project above through a real link, and an empty folder as empty', () => {
    mkdirSync(join(dir, 'shop', 'apps'), { recursive: true });
    writeFileSync(join(dir, 'shop', 'adminium.config.ts'), '');
    symlinkSync(join(dir, 'shop', 'apps'), join(dir, 'shortcut'));
    mkdirSync(join(dir, 'free', 'juniper'), { recursive: true });
    // The temporary folder stands in for the person's own: what is under it is theirs, whatever the system calls its place.
    const real = { ...realFolderDeps(join(dir, 'app')), home: dir };
    expect(judgeNewProjectFolder(join(dir, 'shortcut'), 'Second', real)).toMatchObject({ ok: false, refused: 'inside-a-project' });
    expect(judgeNewProjectFolder(join(dir, 'free'), 'Juniper', real)).toEqual({ ok: true, path: join(dir, 'free', 'juniper'), warning: null });
    writeFileSync(join(dir, 'free', 'juniper', 'x.txt'), 'x');
    expect(judgeNewProjectFolder(join(dir, 'free'), 'Juniper', real)).toMatchObject({ ok: false, refused: 'exists-with-files' });
  });
});
