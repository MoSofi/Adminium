// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearInstallStamp, INSTALL_STAMP_FILE, installNeed, projectLockHash, readInstallStamp, refreshInstallStamp, writeInstallStamp } from '../src/project/install-stamp.js';

const HERE = { system: 'darwin', chip: 'arm64' };
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-stamp-'));
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"dependencies":{"react":"19.2.0"}}\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const installed = (): void => {
  mkdirSync(join(root, 'node_modules', 'react'), { recursive: true });
};

describe('installNeed', () => {
  it('a folder with no packages needs them', () => {
    expect(installNeed(root, HERE)).toBe('no-packages');
  });

  it('a node_modules folder is not an install: without the mark it never finished', () => {
    installed();
    expect(installNeed(root, HERE)).toBe('not-finished');
  });

  it('a finished install is in place', () => {
    installed();
    expect(writeInstallStamp(root, '0.3.21', HERE)).toEqual({ lockHash: projectLockHash(root), system: 'darwin', chip: 'arm64', engine: '0.3.21' });
    expect(installNeed(root, HERE)).toBeNull();
    expect(JSON.parse(readFileSync(join(root, INSTALL_STAMP_FILE), 'utf8'))).toMatchObject({ engine: '0.3.21' });
  });

  it('a cancelled install leaves no mark, because the mark is taken away first', () => {
    installed();
    writeInstallStamp(root, '0.3.21', HERE);
    clearInstallStamp(root);
    // …the install is stopped here…
    expect(installNeed(root, HERE)).toBe('not-finished');
    expect(() => clearInstallStamp(root)).not.toThrow();
  });

  it('packages that came from another system or another chip are installed again', () => {
    installed();
    writeInstallStamp(root, '0.3.21', { system: 'win32', chip: 'x64' });
    expect(installNeed(root, HERE)).toBe('another-machine');
    writeInstallStamp(root, '0.3.21', { system: 'darwin', chip: 'x64' });
    expect(installNeed(root, HERE)).toBe('another-machine');
  });

  it('a list of packages that changed since is installed again; a lockfile outranks package.json', () => {
    installed();
    writeInstallStamp(root, '0.3.21', HERE);
    writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"dependencies":{"react":"19.2.1"}}\n');
    expect(installNeed(root, HERE)).toBe('changed');

    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}');
    expect(projectLockHash(root)).toMatch(/^lock:[0-9a-f]{64}$/);
    writeInstallStamp(root, '0.3.21', HERE);
    // With a lockfile, package.json alone changing is not a change of what is installed.
    writeFileSync(join(root, 'package.json'), '{"name":"renamed","private":true,"dependencies":{"react":"19.2.1"}}\n');
    expect(installNeed(root, HERE)).toBeNull();
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
    expect(installNeed(root, HERE)).toBe('changed');
  });

  it('another Adminium having installed it is not a reason to install again', () => {
    installed();
    writeInstallStamp(root, '0.3.19', HERE);
    expect(installNeed(root, HERE)).toBeNull();
    expect(readInstallStamp(root)?.engine).toBe('0.3.19');
  });
});

describe('the mark itself', () => {
  it('is not written for a folder with nothing installed or nothing to install', () => {
    expect(writeInstallStamp(root, '0.3.21', HERE)).toBeNull();
    installed();
    rmSync(join(root, 'package.json'));
    expect(writeInstallStamp(root, '0.3.21', HERE)).toBeNull();
    expect(projectLockHash(root)).toBeNull();
  });

  it('reads nothing from a file that is not one', () => {
    installed();
    for (const text of ['', 'x', 'null', '{"lockHash":1}', '{"lockHash":"a","system":"darwin","chip":"arm64"}']) {
      writeFileSync(join(root, INSTALL_STAMP_FILE), text);
      expect(readInstallStamp(root)).toBeNull();
      expect(installNeed(root, HERE)).toBe('not-finished');
    }
  });

  it('is brought up to date when packages are added to an installed project, and never made for one that was not', () => {
    installed();
    refreshInstallStamp(root, '0.3.21');
    expect(existsSync(join(root, INSTALL_STAMP_FILE))).toBe(false);

    writeInstallStamp(root, '0.3.21');
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"added":true}');
    expect(installNeed(root)).toBe('changed');
    refreshInstallStamp(root, '0.3.21');
    expect(installNeed(root)).toBeNull();
  });
});
