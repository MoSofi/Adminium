// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig, type DesktopConfig } from './config.js';
import { realFolderDeps, rememberProject } from './projects.js';
import { CANNOT_MAKE_PROJECT, createStartService, displayPathOf, nameFromFolder, projectFingerprint, type StartChoice, type StartDeps } from './start.js';

let home: string;
let config: DesktopConfig;
let chosen: StartChoice[];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-start-')));
  config = createDefaultConfig(join(home, 'data'));
  chosen = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A folder that is a project, with one hook. */
function project(name: string, opts: { packages?: boolean } = {}): string {
  const root = join(home, name);
  mkdirSync(join(root, 'hooks'), { recursive: true });
  writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"x"}\n');
  writeFileSync(join(root, 'hooks', 'on-save.ts'), 'export default 1;\n');
  if (opts.packages !== false) mkdirSync(join(root, 'node_modules'));
  return root;
}

function service(overrides: Partial<StartDeps> = {}) {
  const saved: DesktopConfig[] = [];
  const deps: StartDeps = {
    readConfig: () => config,
    saveConfig: (next) => {
      config = next;
      saved.push(next);
      return Promise.resolve();
    },
    folder: { ...realFolderDeps(join(home, 'the-app'), 'darwin'), home },
    classicUsed: () => false,
    chooseDirectory: () => Promise.resolve(null),
    now: () => new Date('2026-10-10T08:00:00.000Z'),
    onChoice: (choice) => {
      chosen.push(choice);
    },
    ...overrides,
  };
  return { start: createStartService(deps), saved };
}

describe('a path as a person reads it', () => {
  it('shortens the home folder, and only the home folder', () => {
    expect(displayPathOf('/Users/sam/Adminium/shop', '/Users/sam', 'darwin')).toBe('~/Adminium/shop');
    expect(displayPathOf('/Users/sam', '/Users/sam', 'darwin')).toBe('~');
    expect(displayPathOf('/Users/samantha/shop', '/Users/sam', 'darwin')).toBe('/Users/samantha/shop');
    expect(displayPathOf('/Volumes/Disk/shop', '/Users/sam', 'linux')).toBe('/Volumes/Disk/shop');
  });
  it('leaves a Windows path as it is', () => {
    expect(displayPathOf('C:\\Users\\Sam\\Adminium\\shop', 'C:\\Users\\Sam', 'win32')).toBe('C:\\Users\\Sam\\Adminium\\shop');
  });
});

describe('a name for a folder opened for the first time', () => {
  it('reads the dashes as spaces', () => {
    expect(nameFromFolder('/Users/sam/Adminium/juniper-kitchen')).toBe('Juniper Kitchen');
    expect(nameFromFolder('C:\\Users\\Sam\\bike_repairs')).toBe('Bike Repairs');
    expect(nameFromFolder('/x/---')).toBe('---');
  });
});

describe('the fingerprint of a folder’s code', () => {
  it('is null for a folder that is not a project', () => {
    mkdirSync(join(home, 'plain'));
    writeFileSync(join(home, 'plain', 'package.json'), '{}');
    expect(projectFingerprint(join(home, 'plain'))).toBeNull();
  });

  it('changes with a hook’s content, a new action, the config and package.json, and with nothing else', () => {
    const root = project('shop');
    const first = projectFingerprint(root);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(projectFingerprint(root)).toBe(first);

    // Not code the engine runs when the folder is opened.
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'meta.db'), 'rows');
    writeFileSync(join(root, 'README.md'), 'hello');
    mkdirSync(join(root, 'hooks', 'node_modules'));
    writeFileSync(join(root, 'hooks', 'node_modules', 'x.js'), '1');
    expect(projectFingerprint(root)).toBe(first);

    writeFileSync(join(root, 'hooks', 'on-save.ts'), 'export default 2;\n');
    const second = projectFingerprint(root);
    expect(second).not.toBe(first);

    mkdirSync(join(root, 'actions', 'deep'), { recursive: true });
    writeFileSync(join(root, 'actions', 'deep', 'send.ts'), 'export default 1;\n');
    const third = projectFingerprint(root);
    expect(third).not.toBe(second);

    writeFileSync(join(root, 'package.json'), '{"name":"y"}\n');
    const fourth = projectFingerprint(root);
    expect(fourth).not.toBe(third);

    writeFileSync(join(root, 'adminium.config.ts'), 'export default { a: 1 };\n');
    expect(projectFingerprint(root)).not.toBe(fourth);
  });

  it('counts a renamed file, and a link by where it points without following it', () => {
    const root = project('shop');
    const before = projectFingerprint(root);
    const outside = join(home, 'elsewhere.ts');
    writeFileSync(outside, 'export default 1;\n');
    symlinkSync(outside, join(root, 'hooks', 'linked.ts'));
    const linked = projectFingerprint(root);
    expect(linked).not.toBe(before);
    // What the link points AT is not read: the fingerprint is of this folder.
    writeFileSync(outside, 'export default 99;\n');
    expect(projectFingerprint(root)).toBe(linked);
  });
});

describe('Start’s state', () => {
  it('welcomes a first launch: no recent project and no classic workspace', () => {
    expect(service().start.state()).toMatchObject({ firstLaunch: true, recent: [], proposedParent: join(home, 'Adminium'), proposedParentDisplay: '~/Adminium', language: null, theme: 'system' });
    expect(service({ classicUsed: () => true }).start.state().firstLaunch).toBe(false);
  });

  it('lists the recent projects newest first, with a path a person reads and whether the folder is still there', () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop' }, new Date('2026-10-08T00:00:00Z'));
    config = rememberProject(config, { path: join(home, 'gone'), name: 'Gone', state: 'shared' }, new Date('2026-10-09T00:00:00Z'));
    const state = service().start.state();
    expect(state.firstLaunch).toBe(false);
    expect(state.recent).toEqual([
      { path: join(home, 'gone'), displayPath: '~/gone', name: 'Gone', lastOpened: '2026-10-09T00:00:00.000Z', state: 'shared', missing: true },
      { path: shop, displayPath: '~/shop', name: 'Shop', lastOpened: '2026-10-08T00:00:00.000Z', state: 'building', missing: false },
    ]);
    // No fingerprint, no port: the page is told what it draws.
    expect(Object.keys(state.recent[0] ?? {})).not.toContain('trusted');
  });
});

describe('a new project', () => {
  it('is judged for the page, with the path as a person reads it', () => {
    const { start } = service();
    expect(start.judgeNewFolder({ parent: join(home, 'Adminium'), name: 'Juniper Kitchen' })).toEqual({ ok: true, path: join(home, 'Adminium', 'juniper-kitchen'), displayPath: '~/Adminium/juniper-kitchen', warning: null });
    expect(start.judgeNewFolder({ parent: join(home, 'Adminium'), name: '  ' })).toEqual({ ok: false, path: null, displayPath: null, refused: 'no-name' });
  });

  it('is judged AGAIN when it is made: a refused folder is never handed to the maker', async () => {
    const shop = project('shop');
    const makeProject = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { start, saved } = service({ makeProject });
    await expect(start.createProject({ parent: shop, name: 'Inner' })).resolves.toEqual({ status: 'refused', refused: 'inside-a-project' });
    expect(makeProject).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(chosen).toEqual([]);
  });

  it('waits for the person’s yes on a warning', async () => {
    const synced = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    mkdirSync(synced, { recursive: true });
    const makeProject = vi.fn(({ root }: { root: string }) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
      return Promise.resolve({ ok: true as const });
    });
    const { start } = service({ makeProject });
    await expect(start.createProject({ parent: synced, name: 'Shop' })).resolves.toEqual({ status: 'warned', warning: 'icloud' });
    expect(makeProject).not.toHaveBeenCalled();
    await expect(start.createProject({ parent: synced, name: 'Shop', acceptWarning: true })).resolves.toMatchObject({ status: 'created' });
    expect(makeProject).toHaveBeenCalledTimes(1);
  });

  it('is made, remembered as agreed to, and chosen', async () => {
    const parent = join(home, 'Adminium');
    const makeProject = vi.fn(({ root }: { parent: string; folder: string; root: string }) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
      return Promise.resolve({ ok: true as const });
    });
    const { start } = service({ makeProject });
    const root = join(parent, 'juniper-kitchen');
    await expect(start.createProject({ parent, name: ' Juniper Kitchen ' })).resolves.toEqual({ status: 'created', path: root });
    expect(makeProject).toHaveBeenCalledWith({ parent, folder: 'juniper-kitchen', root, onStep: expect.any(Function) as unknown });
    expect(config.projects).toEqual([{ path: root, name: 'Juniper Kitchen', lastOpened: '2026-10-10T08:00:00.000Z', state: 'building', sharePort: null, trusted: projectFingerprint(root) }]);
    expect(config.projects[0]?.trusted).not.toBeNull();
    expect(chosen).toEqual([{ kind: 'project', root }]);
  });

  it('says where the making is while it runs, and nothing once it failed', async () => {
    const seen: (string | null)[] = [];
    let fail = false;
    const made: { start?: ReturnType<typeof service>['start'] } = {};
    const makeProject = vi.fn(({ root, onStep }: { root: string; onStep?: (step: 'files' | 'packages' | 'database') => void }) => {
      seen.push(made.start?.makeProgress().step ?? null);
      onStep?.('files');
      seen.push(made.start?.makeProgress().step ?? null);
      onStep?.('packages');
      seen.push(made.start?.makeProgress().step ?? null);
      if (fail) return Promise.resolve({ ok: false as const, detail: 'no' });
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
      return Promise.resolve({ ok: true as const });
    });
    const { start } = service({ makeProject });
    made.start = start;
    expect(start.makeProgress().step).toBeNull();
    fail = true;
    await start.createProject({ parent: join(home, 'Adminium'), name: 'Shop' });
    expect(seen).toEqual([null, 'files', 'packages']);
    expect(start.makeProgress().step).toBeNull();
    fail = false;
    await start.createProject({ parent: join(home, 'Adminium'), name: 'Shop' });
    // Made: the page is about to be replaced, and is not sent back to "Create" for a moment first.
    expect(start.makeProgress()).toEqual({ step: 'opening', since: new Date('2026-10-10T08:00:00.000Z').getTime() });
  });

  it('says why when the maker fails, and remembers nothing', async () => {
    const { start, saved } = service({ makeProject: () => Promise.resolve({ ok: false, detail: 'npm error code ENOTFOUND' }) });
    await expect(start.createProject({ parent: join(home, 'Adminium'), name: 'Shop' })).resolves.toEqual({ status: 'failed', detail: 'npm error code ENOTFOUND' });
    expect(saved).toEqual([]);
    expect(chosen).toEqual([]);
  });

  it('fails in its own words in a build that cannot make one', async () => {
    await expect(service().start.createProject({ parent: join(home, 'Adminium'), name: 'Shop' })).resolves.toEqual({ status: 'failed', detail: CANNOT_MAKE_PROJECT });
  });

  it('makes one at a time: a second press while the first runs starts nothing', async () => {
    let finish: (() => void) | null = null;
    const makeProject = vi.fn(
      ({ root }: { root: string }) =>
        new Promise<{ ok: true }>((done) => {
          finish = () => {
            mkdirSync(root, { recursive: true });
            writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
            done({ ok: true });
          };
        }),
    );
    const { start } = service({ makeProject });
    const first = start.createProject({ parent: join(home, 'Adminium'), name: 'Shop' });
    await expect(start.createProject({ parent: join(home, 'Adminium'), name: 'Other' })).resolves.toMatchObject({ status: 'failed' });
    expect(makeProject).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(finish).not.toBeNull();
    });
    (finish as unknown as () => void)();
    await expect(first).resolves.toMatchObject({ status: 'created' });
    // And the next one may be made.
    const again = start.createProject({ parent: join(home, 'Adminium'), name: 'Other' });
    await vi.waitFor(() => {
      expect(makeProject).toHaveBeenCalledTimes(2);
    });
    (finish as unknown as () => void)();
    await expect(again).resolves.toMatchObject({ status: 'created' });
  });
});

describe('opening a folder', () => {
  it('asks before a folder never agreed to is opened, and starts nothing', async () => {
    const shop = project('shop');
    const { start, saved } = service();
    await expect(start.openProject({ path: shop })).resolves.toEqual({ status: 'trust-needed', path: shop, displayPath: '~/shop', changed: false });
    expect(saved).toEqual([]);
    expect(chosen).toEqual([]);
  });

  it('opens it on a yes, and remembers what was agreed to', async () => {
    const shop = project('juniper-kitchen');
    const { start } = service();
    await expect(start.openProject({ path: shop, agreed: true })).resolves.toEqual({ status: 'opened' });
    expect(config.projects).toEqual([{ path: shop, name: 'Juniper Kitchen', lastOpened: '2026-10-10T08:00:00.000Z', state: 'building', sharePort: null, trusted: projectFingerprint(shop) }]);
    expect(chosen).toEqual([{ kind: 'project', root: shop }]);
  });

  it('opens an agreed folder again without asking, keeping its name', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'My Shop', trusted: projectFingerprint(shop) });
    await expect(service().start.openProject({ path: shop })).resolves.toEqual({ status: 'opened' });
    expect(config.projects[0]?.name).toBe('My Shop');
  });

  it('opens it on its dashboard when Start asked for that, and on the Designer otherwise', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'My Shop', trusted: projectFingerprint(shop) });
    const { start } = service();
    await start.openProject({ path: shop, land: 'dashboard' });
    await start.openProject({ path: shop, land: 'designer' });
    await start.openProject({ path: shop });
    expect(chosen).toEqual([{ kind: 'project', root: shop, land: 'dashboard' }, { kind: 'project', root: shop }, { kind: 'project', root: shop }]);
  });

  it('asks again when the code is no longer the code agreed to', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop', trusted: projectFingerprint(shop) });
    writeFileSync(join(shop, 'hooks', 'on-save.ts'), 'export default "changed";\n');
    await expect(service().start.openProject({ path: shop })).resolves.toEqual({ status: 'trust-needed', path: shop, displayPath: '~/shop', changed: true });
    expect(chosen).toEqual([]);
  });

  it('is by the folder’s real path: a link to an agreed folder is that folder', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop', trusted: projectFingerprint(shop) });
    symlinkSync(shop, join(home, 'alias'));
    await expect(service().start.openProject({ path: join(home, 'alias') })).resolves.toEqual({ status: 'opened' });
    expect(chosen).toEqual([{ kind: 'project', root: shop }]);
  });

  it('says a folder is gone, or is not a project, and never adopts a parent’s', async () => {
    const shop = project('shop');
    mkdirSync(join(shop, 'inner'));
    const { start } = service();
    await expect(start.openProject({ path: join(home, 'nowhere'), agreed: true })).resolves.toEqual({ status: 'missing' });
    await expect(start.openProject({ path: join(shop, 'inner'), agreed: true })).resolves.toEqual({ status: 'not-a-project' });
    expect(chosen).toEqual([]);
  });

  it('remembers an agreed folder that has no packages yet, and does not start it', async () => {
    const shop = project('shop', { packages: false });
    await expect(service().start.openProject({ path: shop, agreed: true })).resolves.toEqual({ status: 'needs-packages', path: shop, displayPath: '~/shop' });
    expect(config.projects[0]?.trusted).toBe(projectFingerprint(shop));
    expect(chosen).toEqual([]);
  });

  it('gets the packages of an agreed folder, then opens it where it was asked to land', async () => {
    const shop = project('shop', { packages: false });
    const installPackages = vi.fn(({ root }: { root: string }) => {
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'package-lock.json'), '{}');
      return Promise.resolve({ ok: true as const });
    });
    const { start } = service({ installPackages });
    // Never into a folder nobody agreed to open.
    await expect(start.getPackages({ path: shop })).resolves.toEqual({ status: 'trust-needed' });
    expect(installPackages).not.toHaveBeenCalled();
    await start.openProject({ path: shop, agreed: true });
    await expect(start.getPackages({ path: shop, land: 'dashboard' })).resolves.toEqual({ status: 'opened' });
    expect(installPackages).toHaveBeenCalledWith({ root: shop });
    expect(chosen).toEqual([{ kind: 'project', root: shop, land: 'dashboard' }]);
    // What the install wrote is the app's own change: the folder opens next time without the question.
    await expect(start.openProject({ path: shop })).resolves.toEqual({ status: 'opened' });
  });

  it('says why when the packages did not come, opens nothing, and refuses a folder that is not a project', async () => {
    const shop = project('shop', { packages: false });
    const { start } = service({ installPackages: () => Promise.resolve({ ok: false, detail: 'npm error code ENOTFOUND' }) });
    await start.openProject({ path: shop, agreed: true });
    await expect(start.getPackages({ path: shop })).resolves.toEqual({ status: 'failed', detail: 'npm error code ENOTFOUND' });
    expect(chosen).toEqual([]);
    await expect(start.getPackages({ path: join(home, 'nowhere') })).resolves.toEqual({ status: 'missing' });
    await expect(start.getPackages({ path: home })).resolves.toEqual({ status: 'not-a-project' });
    await expect(service().start.getPackages({ path: shop })).resolves.toEqual({ status: 'failed', detail: 'This build of Adminium cannot make a project.' });
  });

  it('picks a folder with the system’s picker, by its real path', async () => {
    const shop = project('shop');
    symlinkSync(shop, join(home, 'alias'));
    const chooseDirectory = vi.fn(() => Promise.resolve<string | null>(join(home, 'alias')));
    const { start } = service({ chooseDirectory });
    await expect(start.chooseFolder({ title: 'Open a folder' })).resolves.toEqual({ path: shop, displayPath: '~/shop' });
    expect(chooseDirectory).toHaveBeenCalledWith({ title: 'Open a folder', defaultPath: join(home, 'Adminium') });
    chooseDirectory.mockResolvedValueOnce(null);
    await expect(start.chooseFolder({ title: 'Open a folder' })).resolves.toBeNull();
    chooseDirectory.mockResolvedValueOnce(join(home, 'vanished'));
    await expect(start.chooseFolder({ title: 'Open a folder' })).resolves.toEqual({ path: join(home, 'vanished'), displayPath: '~/vanished' });
  });
});

describe('the recent list’s buttons', () => {
  it('removes an entry and answers with the list', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop' });
    await expect(service().start.forgetProject(shop)).resolves.toEqual([]);
    expect(config.projects).toEqual([]);
  });

  it('locates a moved project: the entry moves, the trust does not', async () => {
    const moved = project('moved');
    config = rememberProject(config, { path: join(home, 'old'), name: 'Shop', trusted: 'abc' });
    const { start } = service({ chooseDirectory: () => Promise.resolve(moved) });
    const result = await start.locateProject({ path: join(home, 'old'), title: 'Where is Shop now?' });
    expect(result).toMatchObject({ status: 'located', recent: [{ path: moved, name: 'Shop', missing: false }] });
    expect(config.projects[0]?.trusted).toBeNull();
  });

  it('says so when the picked folder is not a project, is already listed, or nothing was picked', async () => {
    const other = project('other');
    mkdirSync(join(home, 'plain'));
    config = rememberProject(config, { path: join(home, 'old'), name: 'Shop' });
    config = rememberProject(config, { path: other, name: 'Other' });
    const pick = (path: string | null) => service({ chooseDirectory: () => Promise.resolve(path) }).start.locateProject({ path: join(home, 'old'), title: 't' });
    await expect(pick(null)).resolves.toEqual({ status: 'cancelled' });
    await expect(pick(join(home, 'plain'))).resolves.toEqual({ status: 'not-a-project' });
    await expect(pick(join(home, 'no-such-folder'))).resolves.toEqual({ status: 'not-a-project' });
    await expect(pick(other)).resolves.toEqual({ status: 'already-listed' });
  });

  it('passes "Change…" to the system’s picker from where the field is', async () => {
    const chooseDirectory = vi.fn(() => Promise.resolve<string | null>('/picked'));
    await expect(service({ chooseDirectory }).start.chooseParent({ from: '/from', title: 'Where to keep it' })).resolves.toBe('/picked');
    expect(chooseDirectory).toHaveBeenCalledWith({ title: 'Where to keep it', defaultPath: '/from' });
  });

  it('chooses the classic workspace', () => {
    service().start.useClassic();
    expect(chosen).toEqual([{ kind: 'classic' }]);
  });
});

describe('letting go of a project', () => {
  it('takes the fingerprint again, so the app’s own changes are not asked about', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop', trusted: projectFingerprint(shop) });
    writeFileSync(join(shop, 'hooks', 'on-save.ts'), 'export default "the Designer wrote this";\n');
    const { start, saved } = service();
    await start.trustNow(shop);
    expect(config.projects[0]?.trusted).toBe(projectFingerprint(shop));
    await expect(start.openProject({ path: shop })).resolves.toEqual({ status: 'opened' });
    // Unchanged: nothing is written.
    const writes = saved.length;
    await start.trustNow(shop);
    expect(saved).toHaveLength(writes);
  });

  it('never grants what was not given: an entry never agreed to stays so, and an unknown folder is left alone', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop' });
    const { start, saved } = service();
    await start.trustNow(shop);
    await start.trustNow(join(home, 'unknown'));
    expect(config.projects[0]?.trusted).toBeNull();
    expect(saved).toEqual([]);
  });

  it('leaves the entry alone when the folder stopped being a project', async () => {
    const shop = project('shop');
    config = rememberProject(config, { path: shop, name: 'Shop', trusted: 'abc' });
    rmSync(join(shop, 'adminium.config.ts'));
    const { start, saved } = service();
    await start.trustNow(shop);
    expect(saved).toEqual([]);
  });
});
