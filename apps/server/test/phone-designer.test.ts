// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's phone side in the Designer.
 *
 * Three things: which of the phone side's files a model or a hand may write
 * (the screens, never what decides what Expo's build runs), which of them the
 * Code tab lists, and what the Phone tab's button does on a person's yes: add
 * the starter, approve it, install it, build it. The install and the build
 * are stand-ins here.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupFiles, listEditable } from '../src/designer/files.js';
import type { PhoneDoor, PhoneDoorState } from '../src/designer/phone-door.js';
import { createPhoneService, type PhoneService } from '../src/designer/phone-service.js';
import { noCardRefusal, phoneFileRefusal } from '../src/designer/write-guard.js';
import { phoneInstalled } from '../src/project/apps/phone-build.js';
import { isPhoneApproved, phoneBuildDir, phoneShapeProblems } from '../src/project/apps/phone.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { phoneProject, putPhone, standIn, type StandIn } from './phone-fixtures.js';

let root: string;
beforeEach(() => {
  root = phoneProject('adminium-phone-designer-');
  // A second app, with no phone side.
  scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('which of a phone side’s files are written from the Designer', () => {
  it.each(['mobile/app.tsx', 'mobile/src/x.tsx', 'mobile/src/x.ts', 'mobile/src/screens/menu.tsx', 'mobile/src/data/menu.json', 'mobile/assets/logo.png', 'mobile/assets/icons/cart.svg'])('%s may be written', (inside) => {
    expect(phoneFileRefusal(root, 'shop', inside)).toBeNull();
    expect(noCardRefusal(root, 'shop', `apps/shop/${inside}`, null)).toBeNull();
  });

  it.each([
    'mobile/package.json',
    'mobile/package-lock.json',
    'mobile/app.json',
    'mobile/index.ts',
    'mobile/tsconfig.json',
    'mobile/src/adminium.ts',
    'mobile/.env',
    'mobile/.gitignore',
    'mobile/babel.config.js',
    'mobile/app.config.ts',
    'mobile/src/metro.config.js',
    'mobile/src/package.json',
    'mobile/src/.env.local',
    'mobile/src/x.js',
    'mobile/readme.md',
    'mobile/assets/run.js',
    'mobile/node_modules/expo/index.js',
    'mobile',
  ])('%s is refused, with a sentence for whoever tried', (inside) => {
    const said = phoneFileRefusal(root, 'shop', inside);
    expect(said).toEqual(expect.any(String));
    expect(said).toContain(inside);
    expect(noCardRefusal(root, 'shop', `apps/shop/${inside}`, null)).toBe('phone-file');
  });

  it('goes by the path whatever its case: a caller folds it, and the guard folds it too', () => {
    expect(noCardRefusal(root, 'shop', 'apps/shop/mobile/App.tsx', null)).toBeNull();
    expect(noCardRefusal(root, 'shop', 'apps/shop/mobile/Package.JSON', '{}')).toBe('phone-file');
    expect(noCardRefusal(root, 'shop', 'apps/shop/mobile/src/Adminium.ts', '')).toBe('phone-file');
    expect(noCardRefusal(root, 'shop', 'apps/shop/mobile/Metro.Config.js', '')).toBe('phone-file');
  });

  it.each(['metro.config.js', 'babel.config.json', '.babelrc', 'postcss.config.js', 'package.json'])('%s in the app’s own folder is refused once the app has a phone folder', (inside) => {
    expect(phoneFileRefusal(root, 'shop', inside)).toContain("would be read by Expo's build of the phone app as configuration");
    expect(noCardRefusal(root, 'shop', `apps/shop/${inside}`, null)).toBe('phone-file');
  });

  it.each(['metro.config.js', 'babel.config.json', 'package.json'])('%s is not refused in an app with no phone folder', (inside) => {
    expect(phoneFileRefusal(root, 'plain', inside)).toBeNull();
    expect(noCardRefusal(root, 'plain', `apps/plain/${inside}`, null)).toBeNull();
  });

  it('leaves the rest of an app with a phone side as it was', () => {
    for (const inside of ['manifest/tables/items.json', 'manifest/access.json', 'design.md', 'staff/src/app.tsx', 'customer/src/pages/menu.tsx']) {
      expect(phoneFileRefusal(root, 'shop', inside), inside).toBeNull();
    }
  });
});

describe('the phone side’s files a person may open and save by hand', () => {
  it('lists App.tsx and what is under src/, under the group "mobile", and none of the engine’s files', async () => {
    putPhone(root, 'shop', 'src/screens/Menu.tsx', 'export const Menu = () => null;\n');
    putPhone(root, 'shop', 'src/data/menu.json', '[]\n');
    const files = await listEditable(root, 'shop', { look: false });
    const phone = files.filter((file) => file.group === 'mobile');
    expect(phone.map((file) => file.path)).toEqual(['apps/shop/mobile/App.tsx', 'apps/shop/mobile/src/data/menu.json', 'apps/shop/mobile/src/screens/Menu.tsx']);
    expect(phone.map((file) => file.label)).toEqual(['mobile/App.tsx', 'mobile/data/menu.json', 'mobile/screens/Menu.tsx']);
    // Nothing of the phone folder is on the list under another group.
    expect(files.filter((file) => file.path.startsWith('apps/shop/mobile/') && file.group !== 'mobile')).toEqual([]);
    for (const engine of ['package.json', 'app.json', 'index.ts', 'tsconfig.json', 'src/adminium.ts', '.gitignore']) {
      expect(existsSync(join(root, 'apps/shop/mobile', engine)), engine).toBe(true);
      expect(files.map((file) => file.path)).not.toContain(`apps/shop/mobile/${engine}`);
    }
  });

  it('offers nothing a hand save would be refused: a script, a note, a configuration, a package', async () => {
    putPhone(root, 'shop', 'src/x.js', 'module.exports = 1;\n');
    putPhone(root, 'shop', 'src/notes.md', '# notes\n');
    putPhone(root, 'shop', 'src/metro.config.js', 'module.exports = {};\n');
    putPhone(root, 'shop', 'src/package.json', '{}\n');
    putPhone(root, 'shop', 'node_modules/expo/index.ts', 'export {};\n');
    putPhone(root, 'shop', 'src/node_modules/x/index.ts', 'export {};\n');
    const phone = (await listEditable(root, 'shop', { look: false })).filter((file) => file.group === 'mobile');
    expect(phone.map((file) => file.path)).toEqual(['apps/shop/mobile/App.tsx']);
  });

  it('the group is drawn after the web sides and before the dashboard', async () => {
    scaffoldApp({ root, key: 'cafe', name: 'Cafe', sides: ['staff', 'customer'], version: APP_VERSION, phone: true });
    const groups = groupFiles(await listEditable(root, 'cafe', { look: false })).map((group) => group.key);
    expect(groups).toEqual(['customer', 'staff', 'mobile', 'dashboard', 'settings']);
  });

  it('an app with no phone side has no such group', async () => {
    expect((await listEditable(root, 'plain', { look: false })).filter((file) => file.group === 'mobile')).toEqual([]);
  });
});

describe('the Phone tab’s button', () => {
  let fake: StandIn;
  let doorState: PhoneDoorState;
  let held: number;
  let released: number;
  let applied: string[];
  let audited: { action: string; detail: Record<string, unknown>; by: string }[];
  let logged: string[];
  let turnRunning: boolean;
  let problems: string[];
  let opened: [string, string][];
  let service: PhoneService;
  const BY = { id: 'u1', label: 'Owner' };

  beforeEach(() => {
    fake = standIn();
    doorState = { state: 'off' };
    held = 0;
    released = 0;
    applied = [];
    audited = [];
    logged = [];
    turnRunning = false;
    problems = [];
    opened = [];
    const door: PhoneDoor = {
      state: () => doorState,
      addresses: () => [{ address: '192.168.7.20', name: 'en0' }],
      open: async (key, address) => {
        opened.push([key, address]);
        return doorState;
      },
      stop: () => {
        doorState = { state: 'off' };
      },
    };
    service = createPhoneService({
      root,
      version: APP_VERSION,
      door,
      hold: () => {
        if (turnRunning) throw new Error('A turn is running.');
        held += 1;
        return {
          signal: new AbortController().signal,
          announce() {},
          release() {
            released += 1;
          },
        };
      },
      buildAndApply: async (key) => {
        applied.push(key);
        return problems;
      },
      audit: async (action, by, detail) => {
        audited.push({ action, detail, by: by.label });
      },
      log: (message) => {
        logged.push(message);
      },
      run: fake.run,
    });
  });

  /** Wait for an "add" to end. */
  const settled = (key: string) => vi.waitFor(() => expect(service.status(key).phone.state).not.toBe('working'), { timeout: 5000, interval: 5 });

  it('an app with no phone side is said as that, with this machine’s addresses and a closed door', () => {
    expect(service.status('plain')).toEqual({ phone: { state: 'none' }, door: { state: 'off' }, addresses: [{ address: '192.168.7.20', name: 'en0' }] });
  });

  it('a phone side nobody approved is said as that, and reading it starts nothing', () => {
    expect(service.status('shop').phone.state).toBe('unapproved');
    expect(fake.started).toEqual([]);
    expect(held).toBe(0);
  });

  it('on an app with none: writes the starter, approves it, installs, builds and applies, and ends built', async () => {
    const at = service.add('plain', BY);
    // It answers at once, and the page watches.
    expect(at.phone).toEqual({ state: 'working', step: 'adding' });
    expect(service.status('plain').phone.state).toBe('working');
    await settled('plain');

    expect(existsSync(join(root, 'apps/plain/mobile/App.tsx'))).toBe(true);
    expect(phoneShapeProblems(root, 'plain')).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(root, 'apps/plain/manifest/app.json'), 'utf8')) as { frontends: unknown; name: string };
    expect(manifest.frontends).toEqual([{ side: 'mobile', kind: 'expo' }]);
    expect(readFileSync(join(root, 'apps/plain/mobile/app.json'), 'utf8')).toContain('"name": "Plain"');
    expect(isPhoneApproved(root, 'plain')).toBe(true);
    expect(phoneInstalled(root, 'plain')).toBe(true);

    expect(fake.started.map((entry) => entry.kind)).toEqual(['install', 'export']);
    expect(fake.installs()[0]?.cwd).toBe(join(root, 'apps/plain/mobile'));
    expect(fake.installs()[0]?.launch.args).toContain('--ignore-scripts');
    expect(applied).toEqual(['plain']);
    expect(audited).toEqual([{ action: 'designer.phone.approved', detail: { app: 'plain' }, by: 'Owner' }]);
    expect(held).toBe(1);
    expect(released).toBe(1);
    expect(service.status('plain').phone).toEqual({ state: 'built', build: expect.any(String) });
    expect(existsSync(join(phoneBuildDir(root, 'plain'), 'index.html'))).toBe(true);
  });

  it('says each step while it runs, and a second click while it runs starts nothing more', async () => {
    const steps = new Set<string>();
    fake.exportMs = 20;
    const watch = setInterval(() => {
      const now = service.status('plain').phone;
      if (now.state === 'working') steps.add(now.step);
    }, 1);
    service.add('plain', BY);
    expect(service.add('plain', BY).phone.state).toBe('working');
    await settled('plain');
    clearInterval(watch);
    expect(held).toBe(1);
    expect(fake.installs()).toHaveLength(1);
    expect(steps.has('building')).toBe(true);
  });

  it('on a phone side that is there and unapproved: approves it as it reads and writes nothing over it', async () => {
    writeFileSync(join(root, 'apps/shop/mobile/App.tsx'), 'export function App() { return null; }\n');
    service.add('shop', BY);
    await settled('shop');
    expect(readFileSync(join(root, 'apps/shop/mobile/App.tsx'), 'utf8')).toBe('export function App() { return null; }\n');
    expect(service.status('shop').phone.state).toBe('built');
    expect(audited.map((entry) => entry.action)).toEqual(['designer.phone.approved']);
    // Again, with everything in place: no second approval is recorded, nothing is installed again.
    service.add('shop', BY);
    await settled('shop');
    expect(audited).toHaveLength(1);
    expect(fake.installs()).toHaveLength(1);
    expect(released).toBe(2);
  });

  it('an install that fails ends failed with the program’s words, and gives the folder back', async () => {
    fake.installCode = 1;
    fake.output = 'npm error code ENOTFOUND\n';
    service.add('plain', BY);
    await settled('plain');
    const now = service.status('plain').phone;
    expect(now.state).toBe('failed');
    expect((now as { words: string }).words).toContain('its packages could not be installed');
    expect((now as { words: string }).words).toContain('npm error code ENOTFOUND');
    expect(applied).toEqual([]);
    expect(fake.exports()).toEqual([]);
    expect(released).toBe(1);
    // The next click starts over, and what it ended on is no longer said.
    fake.installCode = 0;
    service.add('plain', BY);
    await settled('plain');
    expect(service.status('plain').phone.state).toBe('built');
    expect(released).toBe(2);
  });

  it('a folder with something Expo would run unasked is never approved or installed', async () => {
    putPhone(root, 'shop', 'babel.config.js', 'module.exports = {};\n');
    service.add('shop', BY);
    await settled('shop');
    expect(service.status('shop').phone).toEqual({ state: 'failed', words: expect.stringContaining('apps/shop/mobile/babel.config.js is a file Expo would run as configuration') });
    expect(isPhoneApproved(root, 'shop')).toBe(false);
    expect(fake.started).toEqual([]);
    expect(audited).toEqual([]);
    expect(released).toBe(1);
  });

  it('an app that does not apply ends failed with its problems', async () => {
    problems = ['apps/plain/manifest/tables/items.json — a column has no type.'];
    service.add('plain', BY);
    await settled('plain');
    expect(service.status('plain').phone).toEqual({ state: 'failed', words: 'apps/plain/manifest/tables/items.json — a column has no type.' });
    expect(fake.exports()).toEqual([]);
    expect(released).toBe(1);
  });

  it('a build that fails ends failed with Expo’s words', async () => {
    fake.exportCode = 1;
    fake.output = 'SyntaxError: App.tsx: Unexpected token\n';
    service.add('plain', BY);
    await settled('plain');
    expect(service.status('plain').phone).toEqual({ state: 'failed', words: expect.stringContaining('SyntaxError: App.tsx: Unexpected token') });
    expect(released).toBe(1);
  });

  it('while a turn has the folder, the refusal is the caller’s to say and nothing changes', () => {
    turnRunning = true;
    expect(() => service.add('plain', BY)).toThrow('A turn is running.');
    expect(service.status('plain').phone).toEqual({ state: 'none' });
    expect(existsSync(join(root, 'apps/plain/mobile'))).toBe(false);
    expect(fake.started).toEqual([]);
    expect(audited).toEqual([]);
    expect(released).toBe(0);
  });

  it('the door of another app is said as closed; the app’s own as it is', () => {
    doorState = { state: 'open', app: 'shop', url: 'exp://192.168.7.20:9000/?code=abc', qr: '<svg/>', address: '192.168.7.20', sdk: '57', connected: false, phoneSdk: null, lastSeen: null };
    expect(service.status('plain').door).toEqual({ state: 'off' });
    expect(service.status('shop').door).toBe(doorState);
    doorState = { state: 'closed', app: 'shop', why: 'idle', words: 'Closed.' };
    expect(service.status('plain').door).toEqual({ state: 'off' });
    expect(service.status('shop').door).toBe(doorState);
  });

  it('opening the door records who opened it, and only when it opened', async () => {
    await service.open('shop', '192.168.7.20', BY);
    expect(opened).toEqual([['shop', '192.168.7.20']]);
    expect(audited).toEqual([]);
    doorState = { state: 'open', app: 'shop', url: 'exp://192.168.7.20:9000/?code=abc', qr: '<svg/>', address: '192.168.7.20', sdk: '57', connected: false, phoneSdk: null, lastSeen: null };
    const status = await service.open('shop', '192.168.7.20', BY);
    expect(status.door.state).toBe('open');
    expect(audited).toEqual([{ action: 'designer.phone.opened', detail: { app: 'shop', address: '192.168.7.20' }, by: 'Owner' }]);
    service.stop();
    expect(service.status('shop').door).toEqual({ state: 'off' });
  });
});
