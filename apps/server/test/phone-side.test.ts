// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's phone side as a folder: `apps/<key>/mobile/`, an Expo project.
 *
 * Expo's build runs code where the server's bundler only reads it, so what is
 * proved here is what keeps that safe before anything is started: the shape
 * the folder must have, a person's approval of the exact files that decide
 * what is installed and run, what `app check` says of it, and that the
 * starter Adminium writes passes its own rules.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkApp } from '../src/project/apps/check-app.js';
import { approvalsFile } from '../src/project/apps/own-build.js';
import { approvePhone, hasPhoneCode, isPhoneApproved, phoneBuildDir, phoneDir, phoneFingerprint, phonePackages, phoneShapeProblems } from '../src/project/apps/phone.js';
import { addPhoneSide, scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { phoneProject, putPhone } from './phone-fixtures.js';

const RELEASE = APP_VERSION.replace(/[-+].*$/, '');

let root: string;
const extra: string[] = [];
beforeEach(() => {
  root = phoneProject('adminium-phone-side-');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const dir of extra.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env['ADMINIUM_DESKTOP_PROGRAMS'];
});

const mobile = (...rest: string[]): string => join(root, 'apps/shop/mobile', ...rest);
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
/** Change one JSON file of the phone side. */
const change = (file: string, edit: (value: Record<string, unknown>) => void): void => {
  const value = readJson(mobile(file));
  edit(value);
  writeFileSync(mobile(file), `${JSON.stringify(value, null, 2)}\n`);
};
const problems = (): string[] => phoneShapeProblems(root, 'shop').map((problem) => `${problem.file} ${problem.message}`);
const errors = (): string[] =>
  checkApp(root, 'shop', { version: APP_VERSION })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => `${finding.file} ${finding.message}`);

describe('where a phone side is', () => {
  it('is the app’s mobile folder, and its preview is built beside the apps’ builds, never inside them', () => {
    expect(phoneDir(root, 'shop')).toBe(join(root, 'apps', 'shop', 'mobile'));
    expect(phoneBuildDir(root, 'shop')).toBe(join(root, '.adminium', 'build', 'phone', 'shop'));
  });

  it('an app has a phone side’s code when mobile/App.tsx is there', () => {
    expect(hasPhoneCode(root, 'shop')).toBe(true);
    rmSync(mobile('App.tsx'));
    expect(hasPhoneCode(root, 'shop')).toBe(false);
    expect(hasPhoneCode(root, 'nobody')).toBe(false);
  });

  it('a folder that is merely called mobile is not a phone side: nothing is said of it, built from it or asked about it', () => {
    const plain = tempProject('adminium-phone-plain-');
    scaffoldApp({ root: plain, key: 'shop', name: 'Shop', sides: [], version: APP_VERSION });
    mkdirSync(join(plain, 'apps/shop/mobile/notes'), { recursive: true });
    writeFileSync(join(plain, 'apps/shop/mobile/notes/todo.txt'), 'call the printer\n');
    expect(hasPhoneCode(plain, 'shop')).toBe(false);
    const checked = checkApp(plain, 'shop', { version: APP_VERSION });
    expect(checked.phone).toBe(false);
    expect(checked.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    rmSync(plain, { recursive: true, force: true });
  });
});

describe('the shape of a phone side’s folder', () => {
  it('the starter Adminium writes has no problem', () => {
    expect(problems()).toEqual([]);
  });

  it('an app with no phone folder has no problem to say', () => {
    rmSync(mobile(), { recursive: true });
    expect(problems()).toEqual([]);
  });

  it.each(['metro.config.js', 'babel.config.js', 'babel.config.json', '.babelrc', '.babelrc.js', 'app.config.ts', 'react-native.config.js', 'postcss.config.mjs', 'Metro.Config.JS'])(
    'refuses %s in the phone folder, as a file Expo would run as configuration',
    (name) => {
      putPhone(root, 'shop', name, 'module.exports = {};\n');
      expect(problems()).toEqual([`apps/shop/mobile/${name} is a file Expo would run as configuration. A phone side has none: take it out.`]);
    },
  );

  it('refuses a screen that draws a picture spot: spots are on the web pages only', () => {
    putPhone(root, 'shop', 'src/Home.tsx', "import { Picture } from '@adminiumjs/adminium/side';\nexport const Home = () => <Picture spot=\"hero\" />;\n");
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/src/Home.tsx draws a picture spot (<Picture spot="…">), and spots are on the web pages only.')]);
    putPhone(root, 'shop', 'src/Home.tsx', 'export const Home = () => <Picture spot="hero" />;\n');
    expect(problems()).toHaveLength(1);
    // A word in a comment or a string that is no spot is nothing.
    putPhone(root, 'shop', 'src/Home.tsx', "// a picture of the shop\nexport const word = 'Picture';\n");
    expect(problems()).toEqual([]);
  });

  it('refuses a configuration file deeper in the phone folder too', () => {
    putPhone(root, 'shop', 'src/metro.config.js', 'module.exports = {};\n');
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/src/metro.config.js is a file Expo would run as configuration')]);
  });

  it.each(['metro.config.js', 'babel.config.cjs', '.babelrc', 'app.config.js', 'react-native.config.js', 'postcss.config.js'])(
    'refuses %s in the app’s own folder: Metro looks for its configuration upward',
    (name) => {
      writeFileSync(join(root, 'apps/shop', name), 'module.exports = {};\n');
      expect(problems()).toEqual([`apps/shop/${name} is a file Expo would run as configuration. An app with a phone side has none: take it out.`]);
    },
  );

  it('refuses "metro" and "babel" in a package.json of the app’s own folder', () => {
    writeFileSync(join(root, 'apps/shop/package.json'), JSON.stringify({ name: 'shop', metro: {}, babel: {} }));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/package.json has "metro"'), expect.stringContaining('apps/shop/package.json has "babel"')]);
  });

  it('refuses a dot file other than .gitignore: Expo loads .env files into its build', () => {
    expect(existsSync(mobile('.gitignore'))).toBe(true);
    putPhone(root, 'shop', '.env', 'EXPO_PUBLIC_X=1\n');
    putPhone(root, 'shop', 'src/.env.local', 'EXPO_PUBLIC_X=1\n');
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/.env is a dot file'), expect.stringContaining('apps/shop/mobile/src/.env.local is a dot file')]);
  });

  it('refuses a link, and never follows one', () => {
    const outside = tempProject('adminium-phone-outside-');
    extra.push(outside);
    writeFileSync(join(outside, 'metro.config.js'), 'module.exports = {};\n');
    symlinkSync(outside, mobile('src', 'shared'), 'dir');
    symlinkSync(join(outside, 'package.json'), mobile('src', 'linked.json'), 'file');
    expect(problems()).toEqual([
      'apps/shop/mobile/src/linked.json is a link. A phone side holds its own files only.',
      'apps/shop/mobile/src/shared is a link. A phone side holds its own files only.',
    ]);
  });

  it('refuses a second package.json', () => {
    putPhone(root, 'shop', 'src/package.json', { main: 'elsewhere.js' });
    expect(problems()).toEqual(['apps/shop/mobile/src/package.json is a second package.json. A phone side has one, at its top.']);
  });

  it('does not read node_modules or Expo’s own .expo folder', () => {
    putPhone(root, 'shop', 'node_modules/some/package.json', {});
    putPhone(root, 'shop', 'node_modules/some/babel.config.js', '');
    putPhone(root, 'shop', '.expo/settings.json', {});
    expect(problems()).toEqual([]);
  });

  it.each(['scripts', 'babel', 'metro', 'expo', 'workspaces', 'overrides', 'resolutions'])('refuses "%s" in the phone side’s package.json', (field) => {
    change('package.json', (pkg) => {
      pkg[field] = {};
    });
    expect(problems()).toEqual([`apps/shop/mobile/package.json has "${field}", which names code to run or a configuration. Take it out.`]);
  });

  it('asks for "main" to be index.ts, and for expo among the packages', () => {
    change('package.json', (pkg) => {
      pkg['main'] = 'node_modules/expo/AppEntry.js';
    });
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package.json its "main" is "index.ts"')]);
    change('package.json', (pkg) => {
      pkg['main'] = 'index.ts';
      delete (pkg['dependencies'] as Record<string, unknown>)['expo'];
    });
    expect(problems()).toEqual(['apps/shop/mobile/package.json does not list "expo". A phone side is an Expo project.']);
  });

  it.each(['https://evil.example/x.tgz', 'git+https://github.com/a/b.git', 'github:a/b', 'file:../x', 'npm:other@1.0.0', 'latest', '*', '>=1.0.0', '1.x', 'workspace:*', 'link:../x'])('refuses a package named by %s: only a version of the registry’s', (spec) => {
    change('package.json', (pkg) => {
      (pkg['dependencies'] as Record<string, unknown>)['left-pad'] = spec;
    });
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package.json lists "left-pad" by something other than a version')]);
  });

  it('takes a version, with ~ or ^ before it, among the packages and the development packages', () => {
    change('package.json', (pkg) => {
      (pkg['dependencies'] as Record<string, unknown>)['left-pad'] = '^1.3.0';
      pkg['devDependencies'] = { ...(pkg['devDependencies'] as Record<string, unknown> | undefined), 'right-pad': '~1.0.1', beta: '2.0.0-beta.1' };
    });
    expect(problems()).toEqual([]);
  });

  it.each(['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'])('refuses "%s": packages are listed where a person is shown them', (field) => {
    change('package.json', (pkg) => {
      pkg[field] = { 'left-pad': '1.3.0' };
    });
    expect(problems()).toEqual([expect.stringContaining(`apps/shop/mobile/package.json has "${field}"`)]);
  });

  it('refuses a lock that fetches a package from anywhere but the npm registry', () => {
    writeFileSync(mobile('package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/expo': { resolved: 'https://registry.npmjs.org/expo/-/expo-57.0.27.tgz' }, 'node_modules/linked': { link: true } } }));
    expect(problems()).toEqual([]);
    writeFileSync(mobile('package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/expo': { resolved: 'https://registry.npmjs.org.evil.example/expo.tgz' }, 'node_modules/b': { resolved: 'git+ssh://git@github.com/a/b.git#abc' } } }));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package-lock.json fetches 2 package(s) from somewhere other than the npm registry (expo, b)')]);
  });

  it('refuses any lock npm would read in place of package-lock.json, another manager’s lock, and a lock in the old form', () => {
    writeFileSync(mobile('npm-shrinkwrap.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/expo': { resolved: 'https://evil.example/expo.tgz' } } }));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/npm-shrinkwrap.json is a lock npm would read in place of package-lock.json')]);
    rmSync(mobile('npm-shrinkwrap.json'));
    writeFileSync(mobile('yarn.lock'), '');
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/yarn.lock is another package manager’s lock')]);
    rmSync(mobile('yarn.lock'));
    // The old form names each package's source under "dependencies", where the rule above does not look.
    writeFileSync(mobile('package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: { expo: { version: '57.0.27', resolved: 'https://evil.example/expo.tgz' } } }));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package-lock.json does not read as a lock npm writes today')]);
    writeFileSync(mobile('package-lock.json'), 'not json');
    expect(problems()).toEqual([expect.stringContaining('does not read as a lock npm writes today')]);
  });

  it('says every package, however many there are', () => {
    change('package.json', (pkg) => {
      for (let n = 0; n < 80; n += 1) (pkg['dependencies'] as Record<string, unknown>)[`zz-extra-${String(n).padStart(2, '0')}`] = '1.0.0';
    });
    const listed = phonePackages(root, 'shop');
    expect(listed).toContain('zz-extra-79');
    expect(listed.filter((name) => name.startsWith('zz-extra-'))).toHaveLength(80);
  });

  it('says what a phone side’s package.json asks for, by name, in order', () => {
    const listed = phonePackages(root, 'shop');
    expect(listed).toContain('expo');
    expect(listed).toContain('@adminiumjs/public-client');
    expect(listed).toEqual([...listed].sort());
    // A name that is not a package's name is not said to anybody.
    change('package.json', (pkg) => {
      (pkg['dependencies'] as Record<string, unknown>)['<img src=x>'] = '1.0.0';
    });
    expect(phonePackages(root, 'shop')).toEqual(listed);
    expect(phonePackages(root, 'nobody')).toEqual([]);
  });

  it('says a package.json that is missing or does not read', () => {
    writeFileSync(mobile('package.json'), '{ not json');
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package.json is missing or does not read')]);
    rmSync(mobile('package.json'));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/package.json is missing or does not read')]);
  });

  it('asks app.json for an "expo" block', () => {
    writeFileSync(mobile('app.json'), '{"name":"Shop"}\n');
    expect(problems()).toEqual(['apps/shop/mobile/app.json is missing or has no "expo" block.']);
    rmSync(mobile('app.json'));
    expect(problems()).toEqual(['apps/shop/mobile/app.json is missing or has no "expo" block.']);
  });

  it.each(['hooks', 'updates'])('refuses "%s" in app.json', (field) => {
    change('app.json', (app) => {
      (app['expo'] as Record<string, unknown>)[field] = {};
    });
    expect(problems()).toEqual([expect.stringContaining(`apps/shop/mobile/app.json has "${field}"`)]);
  });

  it('takes a plugin that is a package the phone side lists, as a name or with its options', () => {
    change('app.json', (app) => {
      (app['expo'] as Record<string, unknown>)['plugins'] = ['expo-secure-store', ['expo-status-bar', { style: 'dark' }], 'typescript'];
    });
    expect(problems()).toEqual([]);
  });

  it.each([
    ['a path', './plugin.js'],
    ['a path up and out', '../../hooks/plugin'],
    ['an absolute path', '/tmp/plugin.js'],
    ['a file inside a listed package', 'expo-secure-store/app.plugin.js'],
    ['a package the phone side does not list', 'expo-camera'],
    ['a path with its options', ['./plugin.js', {}]],
    ['something that is not a name', { resolve: './plugin.js' }],
  ])('refuses a plugin that is %s', (_what, plugin) => {
    change('app.json', (app) => {
      (app['expo'] as Record<string, unknown>)['plugins'] = [plugin];
    });
    expect(problems()).toEqual([expect.stringMatching(/^apps\/shop\/mobile\/app\.json has a plugin \(.*\) that is not a package the phone side lists\./)]);
  });

  it('refuses "paths" and "baseUrl" in tsconfig.json, and any base but Expo’s', () => {
    change('tsconfig.json', (ts) => {
      ts['compilerOptions'] = { strict: true, paths: { '@/*': ['../../../*'] } };
    });
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/tsconfig.json has "paths" or "baseUrl"')]);
    change('tsconfig.json', (ts) => {
      ts['compilerOptions'] = { baseUrl: '..' };
    });
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/tsconfig.json has "paths" or "baseUrl"')]);
    change('tsconfig.json', (ts) => {
      ts['compilerOptions'] = { strict: true };
      ts['extends'] = '../../../tsconfig.json';
    });
    expect(problems()).toEqual(['apps/shop/mobile/tsconfig.json may extend "expo/tsconfig.base" only.']);
  });

  it('asks for App.tsx and index.ts to be there', () => {
    rmSync(mobile('App.tsx'));
    rmSync(mobile('index.ts'));
    expect(problems()).toEqual([expect.stringContaining('apps/shop/mobile/App.tsx does not exist'), expect.stringContaining('apps/shop/mobile/index.ts does not exist')]);
  });
});

describe('a person’s approval of a phone side', () => {
  it('is not there until given, and is kept under <key>#mobile where an own build’s is kept', () => {
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    approvePhone(root, 'shop');
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    expect(readJson(join(root, '.adminium/approved-builds.json'))).toEqual({ 'shop#mobile': phoneFingerprint(root, 'shop') });
  });

  it('a yes to a phone side that came with packages throws those packages away: the install fetches them', () => {
    mkdirSync(mobile('node_modules/expo/bin'), { recursive: true });
    writeFileSync(mobile('node_modules/expo/bin/cli'), 'whatever came with the folder\n');
    mkdirSync(mobile('node_modules/.adminium'), { recursive: true });
    writeFileSync(mobile('node_modules/.adminium/installed'), 'a stamp anybody can write');
    approvePhone(root, 'shop');
    expect(existsSync(mobile('node_modules'))).toBe(false);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    // Approved as it reads, and installed since: a second yes to the same thing throws nothing away, and the
    // approval an install renews for its new lock keeps what it installed.
    mkdirSync(mobile('node_modules/expo'), { recursive: true });
    approvePhone(root, 'shop');
    expect(existsSync(mobile('node_modules/expo'))).toBe(true);
    writeFileSync(mobile('package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    approvePhone(root, 'shop', { afterInstall: true });
    expect(existsSync(mobile('node_modules/expo'))).toBe(true);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
  });

  it('a link in place of node_modules is taken away with the yes, and where it led is left alone', () => {
    const elsewhere = tempProject('adminium-phone-elsewhere-');
    writeFileSync(join(elsewhere, 'kept.txt'), 'x');
    symlinkSync(elsewhere, mobile('node_modules'));
    approvePhone(root, 'shop');
    expect(existsSync(mobile('node_modules'))).toBe(false);
    expect(existsSync(join(elsewhere, 'kept.txt'))).toBe(true);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('a phone folder that is a link to another place is refused, and a yes deletes nothing there', () => {
    const elsewhere = tempProject('adminium-phone-linked-');
    mkdirSync(join(elsewhere, 'node_modules/expo'), { recursive: true });
    writeFileSync(join(elsewhere, 'App.tsx'), 'export function App() { return null; }\n');
    rmSync(mobile(), { recursive: true, force: true });
    symlinkSync(elsewhere, mobile());
    expect(problems()).toEqual([expect.stringContaining('is a link. A phone side is a folder of the app’s own.')]);
    approvePhone(root, 'shop');
    expect(existsSync(join(elsewhere, 'node_modules/expo'))).toBe(true);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('keeps the approvals already in the file', () => {
    mkdirSync(join(root, '.adminium'), { recursive: true });
    writeFileSync(join(root, '.adminium/approved-builds.json'), JSON.stringify({ other: 'abc' }));
    approvePhone(root, 'shop');
    expect(readJson(join(root, '.adminium/approved-builds.json'))).toMatchObject({ other: 'abc', 'shop#mobile': phoneFingerprint(root, 'shop') });
  });

  it.each(['package.json', 'app.json', 'index.ts', 'tsconfig.json'])('is asked again when one byte of %s changes', (file) => {
    approvePhone(root, 'shop');
    const before = phoneFingerprint(root, 'shop');
    writeFileSync(mobile(file), `${readFileSync(mobile(file), 'utf8')} `);
    expect(phoneFingerprint(root, 'shop')).not.toBe(before);
    expect(isPhoneApproved(root, 'shop')).toBe(false);
  });

  it('is asked again when the lock appears, changes or goes', () => {
    approvePhone(root, 'shop');
    writeFileSync(mobile('package-lock.json'), '{"lockfileVersion":3}\n');
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    approvePhone(root, 'shop');
    writeFileSync(mobile('package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    approvePhone(root, 'shop');
    rmSync(mobile('package-lock.json'));
    expect(isPhoneApproved(root, 'shop')).toBe(false);
  });

  it('holds when a screen changes: App.tsx and src/ are not what is approved', () => {
    approvePhone(root, 'shop');
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    putPhone(root, 'shop', 'src/Menu.tsx', 'export const Menu = () => null;\n');
    expect(isPhoneApproved(root, 'shop')).toBe(true);
  });

  it('is of this app alone', () => {
    scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: [], version: APP_VERSION, phone: true });
    approvePhone(root, 'shop');
    expect(isPhoneApproved(root, 'cafe')).toBe(false);
  });

  it('in the desktop app is kept per machine, and one that came with the folder is not read', () => {
    const kept = realpathSync(tempProject('adminium-phone-approvals-'));
    extra.push(kept);
    // A folder someone sent, with their own yes already inside it.
    approvePhone(root, 'shop');
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    process.env['ADMINIUM_DESKTOP_PROGRAMS'] = JSON.stringify({
      binary: join(kept, 'Adminium'),
      npm: join(kept, 'npm'),
      shims: join(kept, 'shims'),
      git: null,
      npmUserConfig: join(kept, 'npmrc'),
      npmGlobalConfig: join(kept, 'npmrc-global'),
      npmCache: join(kept, 'cache'),
      approvals: join(kept, 'approvals'),
    });
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    approvePhone(root, 'shop');
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    const file = join(kept, 'approvals', `${createHash('sha256').update(realpathSync(root)).digest('hex')}.json`);
    expect(approvalsFile(root)).toBe(file);
    expect(readJson(file)).toEqual({ 'shop#mobile': phoneFingerprint(root, 'shop') });
  });
});

describe('what app check says of a phone side', () => {
  it('an app with the starter has a phone side, no error, and no web side called mobile', () => {
    const check = checkApp(root, 'shop', { version: APP_VERSION });
    expect(check.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(check.phone).toBe(true);
    expect(check.sides).toEqual([]);
    expect(check.manifest?.frontends).toEqual([{ side: 'mobile', kind: 'expo' }]);
  });

  it('with a web side beside it, the sides stay the web pair', () => {
    scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: ['staff', 'customer'], version: APP_VERSION, phone: true });
    const check = checkApp(root, 'cafe', { version: APP_VERSION });
    expect(check.phone).toBe(true);
    expect([...check.sides].sort()).toEqual(['customer', 'staff']);
    expect(check.sides).not.toContain('mobile');
  });

  it('an app with no phone side has none', () => {
    scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
    expect(checkApp(root, 'plain', { version: APP_VERSION }).phone).toBe(false);
  });

  it('is an error when the manifest declares a phone side and the folder is missing', () => {
    rmSync(mobile(), { recursive: true });
    const check = checkApp(root, 'shop', { version: APP_VERSION });
    expect(check.phone).toBe(false);
    expect(errors()).toEqual(['apps/shop/manifest/app.json declares a phone side, and apps/shop/mobile/App.tsx does not exist.']);
  });

  it('is an error when the folder has code and the manifest does not list it', () => {
    const file = join(root, 'apps/shop/manifest/app.json');
    const app = readJson(file);
    app['frontends'] = [{ side: 'staff', kind: 'none' }];
    writeFileSync(file, JSON.stringify(app, null, 2));
    expect(checkApp(root, 'shop', { version: APP_VERSION }).phone).toBe(true);
    expect(errors()).toEqual(["apps/shop/mobile has code, and the manifest's frontends do not list a mobile side."]);
  });

  it('says each problem with the folder’s shape as an error', () => {
    putPhone(root, 'shop', 'metro.config.js', 'module.exports = {};\n');
    putPhone(root, 'shop', '.env', 'X=1\n');
    change('package.json', (pkg) => {
      pkg['scripts'] = { postinstall: 'node x.js' };
    });
    expect(errors().sort()).toEqual(problems().sort());
    expect(errors()).toHaveLength(3);
  });
});

describe('the phone starter', () => {
  it('writes the Expo project under mobile/, with its names filled in', () => {
    for (const file of ['App.tsx', 'index.ts', 'package.json', 'app.json', 'tsconfig.json', 'src/adminium.ts', '.gitignore']) expect(existsSync(mobile(file)), file).toBe(true);
    expect(existsSync(mobile('_gitignore'))).toBe(false);
    expect(readFileSync(mobile('.gitignore'), 'utf8')).toContain('node_modules/');
    for (const file of ['App.tsx', 'package.json', 'app.json', 'src/adminium.ts']) {
      expect(readFileSync(mobile(file), 'utf8'), file).not.toMatch(/__(KEY|NAME|CLIENT)__/);
      expect(existsSync(mobile(`${file}.tmpl`)), file).toBe(false);
    }
    expect(readJson(mobile('package.json'))).toMatchObject({ name: 'shop-mobile', main: 'index.ts', dependencies: { '@adminiumjs/public-client': RELEASE } });
    expect(readJson(mobile('app.json'))).toMatchObject({ expo: { name: 'Shop', slug: 'shop', experiments: { baseUrl: '/apps/shop/mobile' } } });
    expect(readFileSync(mobile('App.tsx'), 'utf8')).toContain('The phone app of Shop.');
  });

  it('says in the manifest that the app has a phone side, and gives it public access', () => {
    const app = readJson(join(root, 'apps/shop/manifest/app.json'));
    expect(app['frontends']).toEqual([{ side: 'mobile', kind: 'expo' }]);
    expect(existsSync(join(root, 'apps/shop/manifest/access.json'))).toBe(true);
    scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: ['staff'], version: APP_VERSION, phone: true });
    expect(readJson(join(root, 'apps/cafe/manifest/app.json'))['frontends']).toEqual([
      { side: 'staff', kind: 'spa' },
      { side: 'mobile', kind: 'expo' },
    ]);
  });

  it('lists the files it wrote, and leaves the project’s own package.json as it was', () => {
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const created = scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: [], version: APP_VERSION, phone: true });
    expect(created).toEqual(expect.arrayContaining(['apps/cafe/mobile/App.tsx', 'apps/cafe/mobile/.gitignore', 'apps/cafe/mobile/package.json', 'apps/cafe/mobile/src/adminium.ts', 'apps/cafe/manifest/access.json']));
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('keeps a name with a quote in it from ending a string, and still passes its own rules', () => {
    scaffoldApp({ root, key: 'joes', name: 'Joe\'s "Best" Café', sides: [], version: APP_VERSION, phone: true });
    expect((readJson(join(root, 'apps/joes/mobile/app.json'))['expo'] as Record<string, unknown>)['name']).toBe('Joe\'s "Best" Café');
    expect(phoneShapeProblems(root, 'joes')).toEqual([]);
  });
});

describe('giving an app a phone side later', () => {
  const manifest = (key: string): string => join(root, 'apps', key, 'manifest/app.json');
  const plain = (key: string, floor?: string): void => {
    scaffoldApp({ root, key, name: 'Plain', sides: [], version: APP_VERSION });
    if (floor !== undefined) {
      const app = readJson(manifest(key));
      app['compatibility'] = { minAdminiumVersion: floor };
      writeFileSync(manifest(key), `${JSON.stringify(app, null, 2)}\n`);
    }
  };

  it('writes the starter and declares the side in place of the "no screens" placeholder', () => {
    plain('plain');
    expect(readJson(manifest('plain'))['frontends']).toEqual([{ side: 'staff', kind: 'none' }]);
    const created = addPhoneSide({ root, key: 'plain', name: 'Plain', version: APP_VERSION });
    expect(created).toEqual(expect.arrayContaining(['apps/plain/manifest/app.json', 'apps/plain/mobile/App.tsx', 'apps/plain/mobile/package.json']));
    expect(readJson(manifest('plain'))['frontends']).toEqual([{ side: 'mobile', kind: 'expo' }]);
    expect(phoneShapeProblems(root, 'plain')).toEqual([]);
  });

  it('keeps the web sides the app has', () => {
    scaffoldApp({ root, key: 'desk', name: 'Desk', sides: ['staff'], version: APP_VERSION });
    addPhoneSide({ root, key: 'desk', name: 'Desk', version: APP_VERSION });
    expect(readJson(manifest('desk'))['frontends']).toEqual([
      { side: 'staff', kind: 'spa' },
      { side: 'mobile', kind: 'expo' },
    ]);
  });

  it('raises the oldest Adminium the app runs on to this one when it was lower', () => {
    plain('plain', '0.1.0');
    addPhoneSide({ root, key: 'plain', name: 'Plain', version: `${RELEASE}-rc.1` });
    expect(readJson(manifest('plain'))['compatibility']).toEqual({ minAdminiumVersion: RELEASE });
  });

  it('never lowers it', () => {
    plain('plain', '99.0.0');
    addPhoneSide({ root, key: 'plain', name: 'Plain', version: APP_VERSION });
    expect(readJson(manifest('plain'))['compatibility']).toEqual({ minAdminiumVersion: '99.0.0' });
    expect(readJson(manifest('plain'))['frontends']).toEqual([{ side: 'mobile', kind: 'expo' }]);
  });

  it('writes nothing when the side is there and declared', () => {
    const before = readFileSync(manifest('shop'), 'utf8');
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    expect(addPhoneSide({ root, key: 'shop', name: 'Shop', version: APP_VERSION })).toEqual([]);
    expect(readFileSync(manifest('shop'), 'utf8')).toBe(before);
    expect(readFileSync(mobile('App.tsx'), 'utf8')).toBe('export function App() { return null; }\n');
  });

  it('declares a folder that is there without writing over it', () => {
    plain('plain');
    mkdirSync(join(root, 'apps/plain/mobile'), { recursive: true });
    writeFileSync(join(root, 'apps/plain/mobile/App.tsx'), 'mine\n');
    expect(addPhoneSide({ root, key: 'plain', name: 'Plain', version: APP_VERSION })).toEqual(['apps/plain/manifest/app.json']);
    expect(readFileSync(join(root, 'apps/plain/mobile/App.tsx'), 'utf8')).toBe('mine\n');
  });

  it('refuses an app whose manifest is not written as part files', () => {
    expect(() => addPhoneSide({ root, key: 'nobody', name: 'Nobody', version: APP_VERSION })).toThrow(/apps\/nobody\/manifest\/app\.json is not there/);
  });
});
