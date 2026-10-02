// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's jail, attacked.
 *
 * A model writes the paths. Every way a path can say one thing and mean
 * another is tried here, and each must be refused before a byte is read or
 * written: climbing out, absolute paths, the folder's secrets, another app,
 * links at the end and on the way, case and Unicode spellings of an allowed
 * folder, binaries, and an app's own build command.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createJail, JailError, MAX_PATH, MAX_WRITE_BYTES, type Jail } from '../src/designer/jail.js';
import { isSecretName, runChild, scrubbedEnvironment } from '../src/designer/child.js';

let root: string;
let jail: Jail;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-jail-'));
  for (const dir of ['apps/repairs/manifest', 'apps/other/manifest', 'hooks', 'actions', 'data']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, '.env'), 'ADMINIUM_SECRET=top-secret\n');
  writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
  writeFileSync(join(root, 'data', 'meta.db'), 'db');
  writeFileSync(join(root, 'apps/repairs/manifest/app.json'), '{"key":"repairs"}');
  writeFileSync(join(root, 'apps/other/manifest/app.json'), '{"key":"other"}');
  jail = createJail(root, 'repairs');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const refusedRead = (path: string): void => {
  expect(() => jail.resolve(path, 'read'), path).toThrow(JailError);
};
const refusedWrite = (path: string, content = '{}'): void => {
  expect(() => jail.write(path, content), path).toThrow(JailError);
};

describe('the Designer’s jail', () => {
  it('reads and writes the app’s folder, hooks and actions', () => {
    expect(jail.resolve('apps/repairs/manifest/app.json', 'read')).toBe(join(jail.resolve('apps/repairs/manifest/app.json', 'read')));
    jail.write('apps/repairs/manifest/tables/jobs.json', '{"ref":"jobs"}');
    jail.write('hooks/on-job.ts', 'export default {};');
    jail.write('actions/send.ts', 'export default {};');
    expect(readFileSync(join(root, 'apps/repairs/manifest/tables/jobs.json'), 'utf8')).toBe('{"ref":"jobs"}');
    expect(jail.roots).toEqual(['apps/repairs', 'hooks', 'actions']);
    jail.delete('hooks/on-job.ts');
    expect(existsSync(join(root, 'hooks/on-job.ts'))).toBe(false);
  });

  it('never climbs out, whatever the spelling', () => {
    for (const path of ['../outside.json', 'apps/repairs/../../.env', 'apps/repairs/./x.json', 'apps//repairs/x.json', '/etc/passwd', 'C:/x.json', 'apps\\repairs\\x.json', 'apps/repairs/x.json\0.txt']) {
      refusedRead(path);
      refusedWrite(path);
    }
  });

  it('never touches the folder’s secrets, data, config or build', () => {
    for (const path of ['.env', 'apps/repairs/.env', 'apps/repairs/.env.local', 'data/meta.db', 'adminium.config.ts', 'package.json', '.adminium/build/manifest.json', '.git/config', 'hooks/.env']) {
      refusedRead(path);
      refusedWrite(path);
    }
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('ADMINIUM_SECRET=top-secret\n');
  });

  it('never touches another app, nor a key that is not one', () => {
    refusedRead('apps/other/manifest/app.json');
    refusedWrite('apps/other/manifest/app.json');
    refusedWrite('apps/repairs2/x.json');
    expect(() => createJail(root, '../repairs')).toThrow(JailError);
    expect(() => createJail(root, 'Repairs')).toThrow(JailError);
  });

  it('reads an allowed folder spelled in another case as that folder, and never makes a second one beside it', () => {
    jail.write('APPS/Repairs/manifest/tables/a.json', '{}');
    expect(existsSync(join(root, 'apps/repairs/manifest/tables/a.json'))).toBe(true);
    jail.write('Hooks/x.ts', '');
    expect(existsSync(join(root, 'hooks/x.ts'))).toBe(true);
  });

  it('reads a decomposed Unicode spelling as the one it means, never as a new folder', () => {
    // "ü" written as u + combining diaeresis: the folder it names is the composed one.
    mkdirSync(join(root, 'apps/repairs/m\u00fcnchen'), { recursive: true });
    jail.write('apps/repairs/mu\u0308nchen/a.json', '{}');
    expect(existsSync(join(root, 'apps/repairs/m\u00fcnchen/a.json'))).toBe(true);
  });

  it('never follows a link, at the end or on the way', () => {
    symlinkSync(join(root, '.env'), join(root, 'apps/repairs/manifest/innocent.json'));
    refusedRead('apps/repairs/manifest/innocent.json');
    refusedWrite('apps/repairs/manifest/innocent.json');

    symlinkSync(join(root, 'data'), join(root, 'apps/repairs/linked'));
    refusedRead('apps/repairs/linked/meta.db');
    refusedWrite('apps/repairs/linked/new.json');
    expect(existsSync(join(root, 'data/new.json'))).toBe(false);

    // A whole allowed folder that is itself a link.
    rmSync(join(root, 'hooks'), { recursive: true });
    symlinkSync(join(root, 'data'), join(root, 'hooks'));
    refusedWrite('hooks/x.ts');
    expect(existsSync(join(root, 'data/x.ts'))).toBe(false);
  });

  it('writes text only, of a bounded size, to files and not folders', () => {
    for (const path of ['apps/repairs/logo.png', 'apps/repairs/run.sh', 'apps/repairs/noextension', 'hooks/a.exe', 'apps/repairs/page.html']) refusedWrite(path);
    jail.write('apps/repairs/staff/src/index.html', '<!doctype html>');
    refusedWrite('apps/repairs/a.json', 'a\0b');
    refusedWrite('apps/repairs/a.json', 'x'.repeat(MAX_WRITE_BYTES + 1));
    refusedWrite(`apps/repairs/${'a'.repeat(MAX_PATH)}.json`);
    refusedRead('apps/repairs');
    refusedWrite('apps/repairs/manifest');
    refusedRead('apps/repairs/manifest/missing.json');
  });

  it('never writes into node_modules', () => {
    refusedWrite('apps/repairs/node_modules/react/index.js');
    refusedWrite('hooks/Node_Modules/x.js');
  });
});

describe('a command the Designer starts', () => {
  it('is given no secret of this server', async () => {
    const env = {
      PATH: process.env['PATH'] ?? '',
      ADMINIUM_SECRET: 's1',
      ADMINIUM_AI_ANTHROPIC_API_KEY: 's2',
      ADMINIUM_AI_MODEL: 'anthropic/x',
      GITHUB_TOKEN: 's3',
      DATABASE_URL: 'postgres://u:p@h/d',
      SHOP_DATABASE_URL: 'postgres://u:p@h/s',
      MY_PASSWORD: 's4',
      NODE_OPTIONS: '--require ./evil.js',
      AWS_SECRET_ACCESS_KEY: 's5',
      HOME: '/home/someone',
    };
    expect(Object.keys(scrubbedEnvironment(env)).sort()).toEqual(['HOME', 'PATH']);
    expect(isSecretName('STRIPE_API_KEY')).toBe(true);
    expect(isSecretName('LANG')).toBe(false);

    const result = await runChild(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { cwd: root, timeoutMs: 10_000, env });
    const seen = JSON.parse(result.output) as Record<string, string>;
    for (const name of ['ADMINIUM_SECRET', 'ADMINIUM_AI_ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'DATABASE_URL', 'NODE_OPTIONS', 'MY_PASSWORD']) expect(seen[name], name).toBeUndefined();
  });

  it('is killed when it runs too long, and when the turn stops', async () => {
    const slow = await runChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: root, timeoutMs: 200 });
    expect(slow).toMatchObject({ code: null, timedOut: true });

    const stop = new AbortController();
    const pending = runChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: root, timeoutMs: 60_000, signal: stop.signal });
    setTimeout(() => stop.abort(), 100);
    expect(await pending).toMatchObject({ code: null, stopped: true });
  });
});
