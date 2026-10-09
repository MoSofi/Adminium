// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two packaging facts a project in the app stands on, read from the files a
 * release is built from.
 *
 * 1. The Mac entitlements: exactly these, no more. One of them is wide
 *    (library validation off), and a key added here beside it should be a
 *    decision somebody made, not a line that rode along.
 * 2. Two fuses stay as Electron ships them. The app runs its own program as
 *    Node to be the project's Node and npm, and the read guard that keeps a
 *    copied app's build inside its own folder is put in front of that Node
 *    through NODE_OPTIONS. Flipping either fuse breaks one of those with no
 *    error at build time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DESKTOP = join(import.meta.dirname, '..', '..');
const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');

describe('the Mac entitlements', () => {
  const plist = read('build/entitlements.mac.plist');
  const body = plist.slice(plist.indexOf('<plist'));
  const granted = [...body.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);

  it('grants the JIT and loading a project’s own libraries, and nothing else', () => {
    expect(granted).toEqual(['com.apple.security.cs.allow-jit', 'com.apple.security.cs.disable-library-validation']);
    expect([...body.matchAll(/<key>/g)]).toHaveLength(2);
  });

  it('says what the wide one costs, where the next reader will look', () => {
    expect(plist).toContain('load a library nobody at');
    expect(plist).not.toContain('Nothing here disables library validation');
  });

  it('serves the app and its helpers from the one file', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(/^\s*entitlements: build\/entitlements\.mac\.plist$/m);
    expect(builder).toMatch(/^\s*entitlementsInherit: build\/entitlements\.mac\.plist$/m);
    expect(builder).toMatch(/^\s*hardenedRuntime: true$/m);
  });
});

describe('the fuses', () => {
  /** The build's settings with their comments taken out. */
  const settings = read('electron-builder.yml').replace(/^\s*#.*$/gm, '');

  it('the app’s program still runs as Node, and still reads NODE_OPTIONS', () => {
    expect(settings).not.toMatch(/runAsNode:\s*false/i);
    expect(settings).not.toMatch(/enableNodeOptionsEnvironmentVariable:\s*false/i);
    // Nor through the fuses' own tool, should a script ever call it.
    expect(read('package.json')).not.toContain('@electron/fuses');
  });
});

describe('the .deb', () => {
  it('asks for every library the program links against, the two a desktop system hides included', () => {
    const builder = read('electron-builder.yml').replace(/^\s*#.*$/gm, '');
    const block = /^deb:\n\s+depends:\n((?:\s+- .*\n)+)/m.exec(builder)?.[1] ?? '';
    const asked = block.split('\n').map((line) => line.replace(/^\s+- /, '').trim()).filter((line) => line !== '');
    expect(asked).toEqual(['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libgbm1', 'libasound2 | libasound2t64']);
  });
});
