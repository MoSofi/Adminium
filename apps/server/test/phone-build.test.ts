// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing and building an app's phone side with Expo.
 *
 * Two programs are started for a phone side, and what matters is when they
 * are NOT, and what they are given when they are: nothing before a person's
 * yes, never an install from a build, no shell, no install script, and an
 * environment that carries nothing of this server's. A phone side that is not
 * approved, not installed or does not build is a notice: the app is built and
 * applied as before. Every program here is a stand-in; nothing is installed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appSourcesHash, buildProjectApps } from '../src/project/apps/build-apps.js';
import { buildPhone, builtPhone, installPhone, phoneEnvironment, phoneInstalled, phoneNow, removePhoneBuild, PHONE_BUILD_TIMEOUT_MS, PHONE_INSTALL_TIMEOUT_MS } from '../src/project/apps/phone-build.js';
import { approvePhone, isPhoneApproved, phoneBuildDir, phoneDir } from '../src/project/apps/phone.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { buildFixturePhone, phoneProject, putPhone, standIn, type StandIn } from './phone-fixtures.js';

let root: string;
let fake: StandIn;
const kept: Record<string, string | undefined> = {};
beforeEach(() => {
  root = phoneProject('adminium-phone-build-');
  fake = standIn();
  for (const name of ['ADMINIUM_SECRET', 'MY_TOKEN', 'DATABASE_URL', 'NODE_OPTIONS']) kept[name] = process.env[name];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [name, value] of Object.entries(kept)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const mobile = (...rest: string[]): string => join(phoneDir(root, 'shop'), ...rest);
const preview = (...rest: string[]): string => join(phoneBuildDir(root, 'shop'), ...rest);
const build = () => buildPhone(root, 'shop', { run: fake.run });
const install = () => installPhone(root, 'shop', { run: fake.run });

describe('how a phone side stands', () => {
  it('an app with no phone folder has none, and starts nothing', async () => {
    scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
    expect(phoneNow(root, 'plain')).toEqual({ state: 'none' });
    expect(await buildPhone(root, 'plain', { run: fake.run })).toEqual({ state: 'none' });
    expect(fake.started).toEqual([]);
  });

  it('a folder Expo would run something of unasked is said as its shape, and never built', async () => {
    approvePhone(root, 'shop');
    await install();
    putPhone(root, 'shop', 'metro.config.js', 'module.exports = {};\n');
    const built = await build();
    expect(built).toEqual({ state: 'shape', words: expect.stringContaining('apps/shop/mobile/metro.config.js is a file Expo would run as configuration') });
    expect(phoneNow(root, 'shop')).toEqual(built);
    expect(fake.exports()).toEqual([]);
  });

  it('an unapproved phone side is noted and never built', async () => {
    const built = await build();
    expect(built.state).toBe('unapproved');
    expect(built).toMatchObject({ words: expect.stringContaining('adminium app approve-build shop') });
    expect(phoneNow(root, 'shop').state).toBe('unapproved');
    expect(fake.started).toEqual([]);
    expect(existsSync(preview())).toBe(false);
  });

  it('an approved one whose packages are missing is said as that: a build never installs', async () => {
    approvePhone(root, 'shop');
    const built = await build();
    expect(built).toEqual({ state: 'no-packages', words: expect.stringContaining('its packages are not installed') });
    expect(phoneNow(root, 'shop').state).toBe('no-packages');
    expect(fake.started).toEqual([]);
    expect(existsSync(mobile('node_modules'))).toBe(false);
  });

  it('installed and not built yet reads as not built, until a build makes the preview', async () => {
    approvePhone(root, 'shop');
    await install();
    expect(phoneNow(root, 'shop')).toEqual({ state: 'failed', words: expect.stringContaining('it is not built yet') });
    expect(builtPhone(root, 'shop')).toBeNull();
    const built = await build();
    expect(built).toEqual({ state: 'built', build: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(phoneNow(root, 'shop')).toEqual(built);
    expect(builtPhone(root, 'shop')).toEqual({ build: (built as { build: string }).build });
  });
});

describe('installing a phone side’s packages', () => {
  it('is refused for a phone side nobody approved', async () => {
    expect(await install()).toEqual({ ok: false, words: expect.stringContaining('apps/shop/mobile is not approved') });
    expect(fake.started).toEqual([]);
    expect(phoneInstalled(root, 'shop')).toBe(false);
  });

  it('runs npm in the phone folder with no install scripts, and no shell', async () => {
    approvePhone(root, 'shop');
    expect(await install()).toEqual({ ok: true });
    expect(fake.started).toHaveLength(1);
    const [started] = fake.installs();
    expect(started?.cwd).toBe(mobile());
    expect(started?.launch.command).toBe('npm');
    expect(started?.launch.args).toEqual(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    expect(started?.timeoutMs).toBe(PHONE_INSTALL_TIMEOUT_MS);
    expect(phoneInstalled(root, 'shop')).toBe(true);
  });

  it('installs from the lock when there is one', async () => {
    writeFileSync(mobile('package-lock.json'), '{"lockfileVersion":3}\n');
    approvePhone(root, 'shop');
    await install();
    expect(fake.installs()[0]?.launch.args).toEqual(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  });

  it('the approval given before the install holds after it wrote the lock', async () => {
    approvePhone(root, 'shop');
    expect(existsSync(mobile('package-lock.json'))).toBe(false);
    await install();
    expect(existsSync(mobile('package-lock.json'))).toBe(true);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
  });

  it('a failed install says the program’s last lines, and leaves the phone side uninstalled', async () => {
    approvePhone(root, 'shop');
    fake.installCode = 1;
    fake.output = 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/expo failed\n';
    const installed = await install();
    expect(installed).toEqual({ ok: false, words: expect.stringContaining('its packages could not be installed (npm install --ignore-scripts --no-audit --no-fund)') });
    expect(installed).toMatchObject({ words: expect.stringContaining('npm error code ENOTFOUND') });
    expect(phoneInstalled(root, 'shop')).toBe(false);
    expect(phoneNow(root, 'shop').state).toBe('no-packages');
  });

  it('is not installed any more once the package list changes', async () => {
    approvePhone(root, 'shop');
    await install();
    const pkg = JSON.parse(readFileSync(mobile('package.json'), 'utf8')) as { dependencies: Record<string, string> };
    pkg.dependencies['expo-camera'] = '17.0.0';
    writeFileSync(mobile('package.json'), JSON.stringify(pkg, null, 2));
    expect(phoneInstalled(root, 'shop')).toBe(false);
    // And the yes was to the list as it read: it is asked again before anything runs.
    expect((await build()).state).toBe('unapproved');
    approvePhone(root, 'shop');
    expect((await build()).state).toBe('no-packages');
    expect(fake.exports()).toEqual([]);
  });
});

describe('what the programs are given', () => {
  it('Expo is started as a file given to Node, with the read guard, to export for the web', async () => {
    await buildFixturePhone(root, 'shop', fake);
    const [started] = fake.exports();
    expect(fake.exports()).toHaveLength(1);
    expect(started?.launch.command).toBe(process.execPath);
    expect(started?.cwd).toBe(mobile());
    expect(started?.timeoutMs).toBe(PHONE_BUILD_TIMEOUT_MS);
    const args = started?.launch.args ?? [];
    expect(args[0]).toBe('--require');
    // The guard is a file of the project's own, outside the app's folder.
    expect(isAbsolute(args[1] as string)).toBe(true);
    expect((args[1] as string).startsWith(join(root, '.adminium'))).toBe(true);
    expect(existsSync(args[1] as string)).toBe(true);
    expect(args.slice(2)).toEqual([mobile('node_modules', 'expo', 'bin', 'cli'), 'export', '--platform', 'web', '--output-dir', `${preview()}.staging`, '--max-workers', '2']);
    // Each argument is one word of its own: nothing is a line for a shell to read.
    expect(started?.launch.env).toEqual({});
    expect(started?.env['ADMINIUM_BUILD_GUARD']).toBe(args[1]);
    expect(started?.env['ADMINIUM_BUILD_ROOT']).toBe(mobile());
  });

  it('Expo is told to ask nobody, tell nobody, change no file and bundle this folder alone', async () => {
    await buildFixturePhone(root, 'shop', fake);
    const env = fake.exports()[0]?.env ?? {};
    expect(env).toMatchObject({
      EXPO_OFFLINE: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_NO_TYPESCRIPT_SETUP: '1',
      EXPO_NO_METRO_WORKSPACE_ROOT: '1',
      EXPO_NO_DOTENV: '1',
      CI: '1',
      EXPO_OVERRIDE_METRO_CONFIG: mobile('node_modules', '.adminium', 'metro.config.cjs'),
    });
    // The Metro configuration is the engine's own, written before the build and named by path.
    const config = readFileSync(mobile('node_modules', '.adminium', 'metro.config.cjs'), 'utf8');
    expect(config).toContain('config.watchFolders = [dir];');
    // The install has the same switches, and is not told it is a CI.
    expect(fake.installs()[0]?.env).toMatchObject({ EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1' });
    expect(fake.installs()[0]?.env).not.toHaveProperty('CI');
  });

  it('writes the engine’s Metro configuration over one that was changed', async () => {
    await buildFixturePhone(root, 'shop', fake);
    const file = mobile('node_modules', '.adminium', 'metro.config.cjs');
    const written = readFileSync(file, 'utf8');
    writeFileSync(file, 'module.exports = { evil: true };\n');
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    await build();
    expect(readFileSync(file, 'utf8')).toBe(written);
  });

  it('an install does not renew the yes for a package list or a setting that changed while it ran', async () => {
    approvePhone(root, 'shop');
    const real = fake.run;
    const changing: typeof fake.run = async (launch, opts) => {
      const ended = await real(launch, opts);
      // Something writes app.json while npm runs.
      writeFileSync(mobile('app.json'), JSON.stringify({ expo: { name: 'Shop', slug: 'shop', plugins: ['left-pad'] } }));
      return ended;
    };
    expect(await installPhone(root, 'shop', { run: changing })).toEqual({ ok: true });
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    // Unchanged, the same install renews it for the lock it wrote.
    const other = phoneProject('adminium-phone-build-other-');
    approvePhone(other, 'shop');
    expect(await installPhone(other, 'shop', { run: fake.run })).toEqual({ ok: true });
    expect(isPhoneApproved(other, 'shop')).toBe(true);
    rmSync(other, { recursive: true, force: true });
  });

  it('carries nothing else of this process: no secret, no token, no database address', async () => {
    process.env['ADMINIUM_SECRET'] = 'x';
    process.env['MY_TOKEN'] = 'made-up';
    process.env['DATABASE_URL'] = 'postgres://u:p@db/x';
    process.env['NODE_OPTIONS'] = '--max-old-space-size=4096';
    await buildFixturePhone(root, 'shop', fake);
    const plain = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATHEXT', 'ADMINIUM_DESKTOP_PROGRAMS'];
    const expo = ['EXPO_OFFLINE', 'EXPO_NO_TELEMETRY', 'EXPO_NO_TYPESCRIPT_SETUP', 'EXPO_NO_METRO_WORKSPACE_ROOT', 'EXPO_NO_DOTENV', 'NPM_CONFIG_REGISTRY', 'npm_config_registry'];
    const allowed: Record<string, string[]> = { install: [...plain, ...expo], export: [...plain, ...expo, 'CI', 'ADMINIUM_BUILD_ROOT', 'ADMINIUM_BUILD_GUARD', 'EXPO_OVERRIDE_METRO_CONFIG'] };
    expect(fake.started.map((entry) => entry.kind)).toEqual(['install', 'export']);
    for (const started of fake.started) {
      const given = { ...started.env, ...started.launch.env };
      for (const name of ['ADMINIUM_SECRET', 'MY_TOKEN', 'DATABASE_URL', 'NODE_OPTIONS']) expect(given, `${started.kind} ${name}`).not.toHaveProperty(name);
      expect(Object.keys(given).filter((name) => !(allowed[started.kind] as string[]).includes(name)), started.kind).toEqual([]);
      expect(given['PATH']).toBe(process.env['PATH']);
    }
  });

  it('the environment is built from a short list of names, whatever it is given', () => {
    const env = phoneEnvironment({ PATH: '/bin', HOME: '/home/me', ADMINIUM_SECRET: 'x', MY_TOKEN: 'y', npm_config_registry: 'https://elsewhere.example', EXPO_OFFLINE: '0', EXPO_TOKEN: 'z' });
    // The registry is npm's own, whatever was given: the lock an install writes is then one the next build accepts.
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/me', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_TYPESCRIPT_SETUP: '1', EXPO_NO_METRO_WORKSPACE_ROOT: '1', EXPO_NO_DOTENV: '1', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', npm_config_registry: 'https://registry.npmjs.org/' });
  });
});

describe('building the phone preview', () => {
  it('leaves the preview in its own folder, with its stamp beside index.html and no staging folder', async () => {
    const built = await buildFixturePhone(root, 'shop', fake);
    expect(built.state).toBe('built');
    expect(preview()).toBe(join(root, '.adminium/build/phone/shop'));
    expect(existsSync(preview('index.html'))).toBe(true);
    expect(existsSync(preview('_expo/static/app.js'))).toBe(true);
    expect(JSON.parse(readFileSync(preview('adminium-phone.json'), 'utf8'))).toEqual({ sources: expect.stringMatching(/^[0-9a-f]{64}$/), build: (built as { build: string }).build });
    expect(existsSync(`${preview()}.staging`)).toBe(false);
    // Never where a web side is served from.
    expect(existsSync(join(root, '.adminium/build/apps/shop/mobile'))).toBe(false);
  });

  it('a second build with nothing changed starts no program', async () => {
    const first = await buildFixturePhone(root, 'shop', fake);
    expect(await build()).toEqual(first);
    expect(fake.exports()).toHaveLength(1);
  });

  it('a change to App.tsx builds again, and the build’s name moves', async () => {
    const first = await buildFixturePhone(root, 'shop', fake);
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    const second = await build();
    expect(fake.exports()).toHaveLength(2);
    expect(second.state).toBe('built');
    expect(second).not.toEqual(first);
    expect(readFileSync(preview('index.html'), 'utf8')).toContain('Phone 2');
  });

  it('builds again when the preview on disk is gone', async () => {
    await buildFixturePhone(root, 'shop', fake);
    rmSync(preview('index.html'));
    expect(builtPhone(root, 'shop')).toBeNull();
    expect((await build()).state).toBe('built');
    expect(fake.exports()).toHaveLength(2);
  });

  it('what Expo leaves in node_modules or .expo is not a change', async () => {
    await buildFixturePhone(root, 'shop', fake);
    putPhone(root, 'shop', 'node_modules/.cache/x', 'cache');
    putPhone(root, 'shop', '.expo/web/cache.json', '{}');
    await build();
    expect(fake.exports()).toHaveLength(1);
  });

  it('a failed build leaves the last preview in place, and says the program’s last lines', async () => {
    const first = await buildFixturePhone(root, 'shop', fake);
    const page = readFileSync(preview('index.html'), 'utf8');
    writeFileSync(mobile('App.tsx'), 'export function App() { return <View>; }\n');
    fake.exportCode = 1;
    fake.output = `${Array.from({ length: 30 }, (_unused, index) => `line ${String(index + 1)}`).join('\n')}\n\nSyntaxError: App.tsx: Unexpected token (1:40)\n`;
    const failed = await build();
    expect(failed.state).toBe('failed');
    const words = (failed as { words: string }).words;
    expect(words).toContain('apps/shop/mobile — the phone app did not build:');
    expect(words).toContain('SyntaxError: App.tsx: Unexpected token (1:40)');
    expect(words).toContain('line 30');
    // Its last lines, not all of them.
    expect(words).not.toContain('line 1\n');
    expect(readFileSync(preview('index.html'), 'utf8')).toBe(page);
    expect(builtPhone(root, 'shop')).toEqual({ build: (first as { build: string }).build });
    expect(existsSync(`${preview()}.staging`)).toBe(false);
    // The failure is what the phone side is now, for whoever asks later (a save by hand, `adminium dev`, the page), until its files change.
    expect(phoneNow(root, 'shop')).toEqual({ state: 'failed', words: expect.stringContaining('SyntaxError: App.tsx: Unexpected token (1:40)') });
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    expect(phoneNow(root, 'shop')).toEqual({ state: 'built', build: (first as { build: string }).build });
    writeFileSync(mobile('App.tsx'), 'export function App() { return <View>; }\n');
    expect(phoneNow(root, 'shop').state).toBe('failed');
    // And the next build tries again: a failure is not remembered as a build.
    fake.exportCode = 0;
    expect((await build()).state).toBe('built');
    expect(fake.exports()).toHaveLength(3);
    // A build that ended well forgets the failure.
    expect(existsSync(`${preview()}.failed.json`)).toBe(false);
    expect(phoneNow(root, 'shop').state).toBe('built');
  });

  it('a build that ends well and leaves no index.html is a failed build', async () => {
    approvePhone(root, 'shop');
    await install();
    fake.exportWrites = false;
    expect((await build()).state).toBe('failed');
    expect(existsSync(preview())).toBe(false);
  });

  it('two builds asked for at once run one after the other, never two exports of one app', async () => {
    approvePhone(root, 'shop');
    await install();
    fake.exportMs = 40;
    // The first export changes a screen as it runs, so the second has something to build.
    fake.onExport = (count) => {
      if (count === 1) writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    };
    const [one, two] = await Promise.all([build(), build()]);
    expect(one.state).toBe('built');
    expect(two.state).toBe('built');
    expect(fake.exports()).toHaveLength(2);
    expect(fake.mostAtOnce).toBe(1);
  });

  it('a build that fails does not hold up the one waiting behind it', async () => {
    approvePhone(root, 'shop');
    await install();
    fake.exportMs = 20;
    fake.onExport = (count) => {
      fake.exportCode = count === 1 ? 1 : 0;
    };
    const first = build();
    const second = build();
    expect((await first).state).toBe('failed');
    expect((await second).state).toBe('built');
    expect(fake.exports()).toHaveLength(2);
    expect(fake.mostAtOnce).toBe(1);
  });

  it('the preview can be taken away, with what a stopped build left', async () => {
    await buildFixturePhone(root, 'shop', fake);
    mkdirSync(`${preview()}.staging`, { recursive: true });
    removePhoneBuild(root, 'shop');
    expect(existsSync(preview())).toBe(false);
    expect(existsSync(`${preview()}.staging`)).toBe(false);
    expect(builtPhone(root, 'shop')).toBeNull();
    // Taking away what is not there is fine.
    removePhoneBuild(root, 'shop');
  });
});

describe('a project build, for an app with a phone side', () => {
  const project = (dev: boolean) => buildProjectApps(root, { version: APP_VERSION, bundler: null, ...(dev ? { dev: true } : {}), runPhone: fake.run });

  it('an app whose phone side is not approved is still built, and says how its phone preview stands', async () => {
    const built = await project(true);
    expect(built.apps).toHaveLength(1);
    expect(built.apps[0]).toMatchObject({ key: 'shop', version: '0.1.0', sides: [], phone: { state: 'unapproved' } });
    expect(built.apps[0]?.problems).toBeUndefined();
    expect(built.apps[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(root, '.adminium/build/apps/shop'))).toBe(true);
    expect(fake.started).toEqual([]);
  });

  it('the same for packages that are not installed, and for a build that failed', async () => {
    approvePhone(root, 'shop');
    const missing = await project(true);
    expect(missing.apps[0]?.problems).toBeUndefined();
    expect(missing.apps[0]?.phone?.state).toBe('no-packages');
    expect(fake.installs()).toEqual([]);

    await install();
    fake.exportCode = 1;
    fake.output = 'Error: Unable to resolve module ./src/missing\n';
    const failed = await project(true);
    expect(failed.apps[0]?.problems).toBeUndefined();
    expect(failed.apps[0]?.phone).toEqual({ state: 'failed', words: expect.stringContaining('Unable to resolve module ./src/missing') });
    expect(failed.digest).not.toBe(missing.digest);
  });

  it('for a developer, builds the preview and names its build', async () => {
    approvePhone(root, 'shop');
    await install();
    const built = await project(true);
    expect(built.apps[0]?.phone).toEqual({ state: 'built', build: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(built.dev).toBe(true);
    expect(existsSync(preview('index.html'))).toBe(true);
    expect(fake.exports()).toHaveLength(1);
  });

  it('for a server, builds no preview, removes one that is there and says nothing of the phone side', async () => {
    await buildFixturePhone(root, 'shop', fake);
    expect(existsSync(preview('index.html'))).toBe(true);
    const built = await project(false);
    expect(built.apps[0]).toMatchObject({ key: 'shop', sides: [] });
    expect(built.apps[0]?.problems).toBeUndefined();
    expect(built.apps[0]).not.toHaveProperty('phone');
    expect(existsSync(preview())).toBe(false);
    expect(fake.exports()).toHaveLength(1);
  });

  it('an app with no phone side carries no word of one', async () => {
    scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
    const built = await project(true);
    expect(built.apps.find((app) => app.key === 'plain')).not.toHaveProperty('phone');
  });

  it('removes the preview of an app whose folder is gone', async () => {
    await buildFixturePhone(root, 'shop', fake);
    scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
    rmSync(join(root, 'apps/shop'), { recursive: true });
    await project(true);
    expect(existsSync(preview())).toBe(false);
  });

  it('the phone side’s files are part of what the apps are built from; its packages and Expo’s folder are not', () => {
    const before = appSourcesHash(root);
    putPhone(root, 'shop', 'node_modules/x', 'a package');
    putPhone(root, 'shop', '.expo/y', 'a cache');
    expect(appSourcesHash(root)).toBe(before);
    writeFileSync(mobile('App.tsx'), 'export function App() { return null; }\n');
    const changed = appSourcesHash(root);
    expect(changed).not.toBe(before);
    putPhone(root, 'shop', 'src/Menu.tsx', 'export const Menu = () => null;\n');
    expect(appSourcesHash(root)).not.toBe(changed);
  });
});
