// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A phone side from the terminal: `adminium app new --mobile` and
 * `adminium app approve-build`.
 *
 * Asking for a phone side with `--mobile` is the yes to its install and
 * build; for one that came another way, `approve-build` is where a person
 * says it. Both install through `deps.installPhone`, which is a stand-in
 * here: nothing reaches the network.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { installPhone, phoneInstalled } from '../src/project/apps/phone-build.js';
import { isPhoneApproved, phoneShapeProblems } from '../src/project/apps/phone.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { phoneProject, putPhone, standIn, type StandIn } from './phone-fixtures.js';

let root: string;
let fake: StandIn;
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Ran {
  code: number;
  out: string;
  err: string;
  /** The app keys the phone install was asked for. */
  installs: string[];
  /** Every other program the command started. */
  processes: string[];
  questions: string[];
}

/** Run `adminium app …` in the project, with the phone install as a stand-in. */
async function run(argv: string[], opts: { interactive?: boolean; answers?: string[]; install?: 'stand-in' | 'fails' } = {}): Promise<Ran> {
  const io = fakeIo({ interactive: opts.interactive ?? false, ...(opts.answers === undefined ? {} : { answers: opts.answers }) });
  const deps = fakeDeps({ cwd: root, env: {} });
  const installs: string[] = [];
  const processes: string[] = [];
  deps.runProcess = (command, args) => {
    processes.push(`${command} ${args.join(' ')}`);
    return { status: 0, stdout: '' };
  };
  deps.installPhone = async (at, key) => {
    installs.push(key);
    expect(at).toBe(root);
    if (opts.install === 'fails') return { ok: false, words: `apps/${key}/mobile — its packages could not be installed (npm install). This needs the network.\nnpm error code ENOTFOUND` };
    return installPhone(at, key, { run: fake.run });
  };
  const code = await runCli(['app', ...argv], { io, deps });
  return { code, out: io.stdout(), err: io.stderr(), installs, processes, questions: io.questions() };
}

describe('adminium app new --mobile', () => {
  const PACKAGE = `${JSON.stringify({ name: 'my-admin', private: true, dependencies: { '@adminiumjs/adminium': APP_VERSION } }, null, 2)}\n`;
  beforeEach(() => {
    root = tempProject('adminium-phone-cli-new-');
    writeFileSync(join(root, 'package.json'), PACKAGE);
    fake = standIn();
  });

  it('writes an app with a phone side, approves it and installs its packages', async () => {
    const ran = await run(['new', 'shop', '--mobile']);
    expect(ran.err).toBe('');
    expect(ran.code).toBe(0);
    expect(ran.out).toContain('Created apps/shop/');
    expect(ran.out).toContain('Installing the phone app’s packages');
    expect(ran.out).toContain('edit apps/shop/mobile/App.tsx');
    expect(ran.installs).toEqual(['shop']);
    expect(existsSync(join(root, 'apps/shop/mobile/App.tsx'))).toBe(true);
    expect(phoneShapeProblems(root, 'shop')).toEqual([]);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    expect(phoneInstalled(root, 'shop')).toBe(true);
    // The stand-in was started as the real install is: npm, in the phone folder, with no install scripts.
    expect(fake.installs()).toHaveLength(1);
    expect(fake.installs()[0]?.launch.args).toContain('--ignore-scripts');
    expect(fake.installs()[0]?.cwd.endsWith(join('apps', 'shop', 'mobile'))).toBe(true);
  });

  it('declares the phone side and grants it public access, with no web side and no "no screens" placeholder', async () => {
    await run(['new', 'shop', '--mobile']);
    const app = JSON.parse(readFileSync(join(root, 'apps/shop/manifest/app.json'), 'utf8')) as { frontends: unknown };
    expect(app.frontends).toEqual([{ side: 'mobile', kind: 'expo' }]);
    expect(existsSync(join(root, 'apps/shop/manifest/access.json'))).toBe(true);
    expect(existsSync(join(root, 'apps/shop/staff'))).toBe(false);
    expect(existsSync(join(root, 'apps/shop/customer'))).toBe(false);
  });

  it('leaves the project’s own package.json alone, and installs nothing into the project', async () => {
    const ran = await run(['new', 'shop', '--mobile']);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE);
    expect(ran.processes).toEqual([]);
    expect(ran.out).not.toContain('Added to package.json');
  });

  it('passes its own check, and says what the phone app may reach', async () => {
    const ran = await run(['new', 'shop', '--mobile', '--name', 'Corner Shop']);
    expect(ran.code, ran.err).toBe(0);
    expect(ran.out).toContain('Corner Shop 0.1.0 (shop)');
    expect(ran.out).toContain('items: read (id, title, status)');
    expect(ran.out).toContain('tables, pages, roles, access');
    const check = await run(['check', 'shop']);
    expect(check.code, check.err + check.out).toBe(0);
  });

  it('with --no-install approves it, installs nothing and says how to install later', async () => {
    const ran = await run(['new', 'shop', '--mobile', '--no-install']);
    expect(ran.code, ran.err).toBe(0);
    expect(ran.installs).toEqual([]);
    expect(ran.out).toContain('packages are not installed. Install them before its preview can be built');
    expect(ran.out).toContain('adminium app approve-build shop');
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    expect(phoneInstalled(root, 'shop')).toBe(false);
  });

  it('an install that fails leaves the app’s files in place, says why and ends with an error', async () => {
    const ran = await run(['new', 'shop', '--mobile'], { install: 'fails' });
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('npm error code ENOTFOUND');
    expect(ran.err).toContain('run  adminium app approve-build shop  to install them again');
    expect(existsSync(join(root, 'apps/shop/mobile/App.tsx'))).toBe(true);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
  });

  it('beside web sides, adds both: the project’s packages for the screens, the phone’s own for the phone', async () => {
    const ran = await run(['new', 'shop', '--mobile', '--customer']);
    expect(ran.code, ran.err).toBe(0);
    expect(ran.processes).toHaveLength(1);
    expect(ran.installs).toEqual(['shop']);
    const app = JSON.parse(readFileSync(join(root, 'apps/shop/manifest/app.json'), 'utf8')) as { frontends: unknown };
    expect(app.frontends).toEqual([
      { side: 'customer', kind: 'spa' },
      { side: 'mobile', kind: 'expo' },
    ]);
  });

  it('without --mobile, writes no phone side and asks for no phone install', async () => {
    const ran = await run(['new', 'shop']);
    expect(ran.code, ran.err).toBe(0);
    expect(ran.installs).toEqual([]);
    expect(existsSync(join(root, 'apps/shop/mobile'))).toBe(false);
    expect(isPhoneApproved(root, 'shop')).toBe(false);
  });
});

describe('adminium app approve-build, for an app with a phone side', () => {
  beforeEach(() => {
    root = phoneProject('adminium-phone-cli-approve-');
    fake = standIn();
  });

  it('refuses a folder with something Expo would run unasked, and approves nothing', async () => {
    putPhone(root, 'shop', 'metro.config.js', 'module.exports = {};\n');
    const ran = await run(['approve-build', 'shop', '--yes']);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('apps/shop/mobile cannot be approved as it is:');
    expect(ran.err).toContain('apps/shop/mobile/metro.config.js is a file Expo would run as configuration');
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    expect(ran.installs).toEqual([]);
  });

  it('with nobody to ask and no --yes, shows what would run and refuses', async () => {
    const ran = await run(['approve-build', 'shop']);
    expect(ran.code).toBe(1);
    expect(ran.out).toContain('npm install (no install scripts)');
    expect(ran.out).toContain('expo export --platform web');
    expect(ran.err).toContain('Nobody is here to ask.');
    expect(ran.err).toContain('adminium app approve-build shop --yes');
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    expect(ran.installs).toEqual([]);
  });

  it('with --yes approves the phone side as it reads now and installs its packages', async () => {
    const ran = await run(['approve-build', 'shop', '--yes']);
    expect(ran.err).toBe('');
    expect(ran.code).toBe(0);
    expect(ran.out).toContain('Approved.');
    expect(ran.out).toContain('Installed. The next build makes its preview');
    expect(ran.questions).toEqual([]);
    expect(ran.installs).toEqual(['shop']);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    expect(phoneInstalled(root, 'shop')).toBe(true);
  });

  it('finds the app by itself when the project has one', async () => {
    const ran = await run(['approve-build', '--yes']);
    expect(ran.code, ran.err).toBe(0);
    expect(isPhoneApproved(root, 'shop')).toBe(true);
  });

  it('a second time says it is approved and installed, and starts nothing', async () => {
    await run(['approve-build', 'shop', '--yes']);
    const again = await run(['approve-build', 'shop']);
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain('The phone app of apps/shop is approved and its packages are installed.');
    expect(again.out).not.toContain('Approved.');
    expect(again.installs).toEqual([]);
    expect(fake.installs()).toHaveLength(1);
  });

  it('asks a person who is there, and a no approves and runs nothing', async () => {
    const ran = await run(['approve-build', 'shop'], { interactive: true, answers: ['n'] });
    expect(ran.questions).toEqual(['Let them run?']);
    expect(ran.code).toBe(2);
    expect(ran.out).toContain('Not approved. Nothing was run.');
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    expect(ran.installs).toEqual([]);
  });

  it('a yes from a person approves and installs; no answer is a no', async () => {
    const silent = await run(['approve-build', 'shop'], { interactive: true });
    expect(silent.code).toBe(2);
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    const ran = await run(['approve-build', 'shop'], { interactive: true, answers: ['y'] });
    expect(ran.code, ran.err).toBe(0);
    expect(ran.installs).toEqual(['shop']);
    expect(phoneInstalled(root, 'shop')).toBe(true);
  });

  it('approved and not installed: installs without asking again', async () => {
    await run(['new', 'cafe', '--mobile', '--no-install']);
    const ran = await run(['approve-build', 'cafe']);
    expect(ran.code, ran.err).toBe(0);
    expect(ran.out).not.toContain('Let them run');
    expect(ran.out).toContain('Installing the phone app’s packages');
    expect(ran.installs).toEqual(['cafe']);
    expect(phoneInstalled(root, 'cafe')).toBe(true);
  });

  it('is asked again once the phone side’s package list changes', async () => {
    await run(['approve-build', 'shop', '--yes']);
    const file = join(root, 'apps/shop/mobile/package.json');
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { dependencies: Record<string, string> };
    pkg.dependencies['expo-camera'] = '17.0.0';
    writeFileSync(file, JSON.stringify(pkg, null, 2));
    const ran = await run(['approve-build', 'shop']);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('Nobody is here to ask.');
  });

  it('an install that fails ends with the program’s words', async () => {
    const ran = await run(['approve-build', 'shop', '--yes'], { install: 'fails' });
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('its packages could not be installed');
    expect(ran.err).toContain('npm error code ENOTFOUND');
    // The yes was given and is kept: the next run only installs.
    expect(isPhoneApproved(root, 'shop')).toBe(true);
    expect(phoneInstalled(root, 'shop')).toBe(false);
  });
});
