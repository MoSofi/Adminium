// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's package install in a project with no `package.json`.
 *
 * An operator project (a trial's `/data/project`) is made with none. A package
 * manager started there takes the nearest folder above that has one, or a
 * `node_modules`, as the project: in the image that is `/`, and npm fails with
 * `Tracker "idealTree" already exists`. So the installer writes one first, and
 * never over one that is there.
 *
 * The install is started for real, against a fake `npm` on the PATH that
 * writes down where it ran and what `package.json` it found there.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureProjectManifest, installer } from '../src/designer/ask-needs.js';

const unix = process.platform !== 'win32';

describe('the Designer’s install in a project with no package.json', () => {
  let root: string;
  let bin: string;
  let seen: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'adminium-install-manifest-'));
    bin = mkdtempSync(join(tmpdir(), 'adminium-install-manifest-bin-'));
    seen = join(bin, 'seen.json');
    // What an operator project holds: its apps and the engine's own folder, and nothing else.
    mkdirSync(join(root, 'apps'));
    mkdirSync(join(root, '.adminium'));
    const npm = join(bin, 'npm');
    writeFileSync(
      npm,
      `#!${process.execPath}\nconst fs = require('node:fs');\nlet manifest = null;\ntry { manifest = fs.readFileSync('package.json', 'utf8'); } catch {}\nfs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ cwd: fs.realpathSync(process.cwd()), manifest, args: process.argv.slice(2) }));\n`,
    );
    chmodSync(npm, 0o755);
    savedPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${savedPath ?? ''}`;
  });
  afterEach(() => {
    if (savedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = savedPath;
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it('writes a package.json that lists nothing, once', () => {
    expect(ensureProjectManifest(root)).toBeNull();
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toEqual({ private: true });
    // A second call leaves what is there, whatever it now holds.
    writeFileSync(join(root, 'package.json'), '{"private":true,"dependencies":{"clsx":"2.1.1"}}');
    expect(ensureProjectManifest(root)).toBeNull();
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{"private":true,"dependencies":{"clsx":"2.1.1"}}');
  });

  it('never writes over a project’s own package.json', () => {
    const own = '{"name":"bakery","version":"1.0.0","dependencies":{"react":"19.2.0"}}';
    writeFileSync(join(root, 'package.json'), own);
    expect(ensureProjectManifest(root)).toBeNull();
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(own);
  });

  it('says why when the file cannot be written, and starts no install', async () => {
    const gone = join(root, 'not-there');
    const said = await installer(gone)([{ name: 'clsx', version: '2.1.1' }], new AbortController().signal);
    expect(said).toMatch(/^The project's package\.json could not be written: /);
    expect(existsSync(seen)).toBe(false);
  });

  it.runIf(unix)('the package manager is started in the project, with the package.json already there', async () => {
    expect(existsSync(join(root, 'package.json'))).toBe(false);
    expect(await installer(root)([{ name: 'clsx', version: '2.1.1' }], new AbortController().signal)).toBeNull();
    const ran = JSON.parse(readFileSync(seen, 'utf8')) as { cwd: string; manifest: string | null; args: string[] };
    expect(ran.args).toEqual(['install', 'clsx@2.1.1', '--ignore-scripts', '--save-exact']);
    expect(ran.manifest).not.toBeNull();
    expect(JSON.parse(ran.manifest ?? 'null')).toEqual({ private: true });
    expect(existsSync(join(ran.cwd, 'apps'))).toBe(true);
  });
});
