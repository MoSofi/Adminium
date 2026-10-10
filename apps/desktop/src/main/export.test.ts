// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { envForExport, exportFileName, exportList, exported, writeProjectZip } from './export.js';

let dir: string;
let root: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-export-'));
  root = join(dir, 'juniper-kitchen');
  const put = (path: string, text = 'x'): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put('adminium.config.ts', 'export default {};\n');
  put('package.json', '{"name":"juniper"}\n');
  put('package-lock.json', '{}');
  put('.env', 'ADMINIUM_SECRET=the-key\nDATABASE_URL=sqlite:./data/app.sqlite\nADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-secret\nexport PEXELS_API_KEY=px-secret\n# a note\nADMINIUM_AI_MODEL=anthropic/claude\n');
  put('apps/menu/manifest/app.json', '{"key":"menu"}');
  put('apps/menu/staff/src/App.tsx', 'export const App = () => null;\n');
  put('apps/menu/node_modules/react/index.js');
  put('hooks/on-save.ts');
  put('data/meta.db', 'rows');
  put('data/app.sqlite', 'rows'.repeat(50_000));
  put('data/backups/2026-10-09.adminium-backup', 'backup');
  put('data.before-2026-10-09/meta.db', 'old rows');
  put('.env.before', 'ADMINIUM_SECRET=older\n');
  put('my-copy.adminium-backup.zip', 'backup');
  put('node_modules/react/index.js');
  put('.adminium/build/menu/staff/index.js');
  put('.adminium/running.json', '{}');
  put('.adminium/approved-builds.json', '{"menu":"abc"}');
  put('.adminium/export.json', '{"kind":"everything"}');
  put('.adminium/designer/sessions/ds_1/events.jsonl', '{"text":"my card number is…"}');
  put('.adminium/designer/sources.json', '{}');
  put('.adminium/designer/versions.git/HEAD', 'ref: refs/heads/x\n');
  put('.DS_Store');
  put('.git/config');
  put('assets/logo.png', 'png-bytes');
  symlinkSync('/etc/hosts', join(root, 'a-link'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ALWAYS = ['.adminium/designer/sources.json', '.adminium/designer/versions.git/HEAD', 'adminium.config.ts', 'apps/menu/manifest/app.json', 'apps/menu/staff/src/App.tsx', 'assets/logo.png', 'hooks/on-save.ts', 'package-lock.json', 'package.json'];

describe('what goes into an export', () => {
  it('everything: the apps, the data, the key and the chats; never packages, builds, backups, approvals or a link', () => {
    expect(exportList(root, 'everything').sort()).toEqual([...ALWAYS, '.adminium/designer/sessions/ds_1/events.jsonl', '.env', '.env.before', 'data.before-2026-10-09/meta.db', 'data/app.sqlite', 'data/meta.db'].sort());
  });
  it('the apps only: no data (old data included), no key, no chats; the version store still travels', () => {
    expect(exportList(root, 'apps').sort()).toEqual([...ALWAYS].sort());
  });
  it('judges a path by its parts, not by what it happens to start with', () => {
    expect(exported('database/notes.md', 'apps')).toBe(true);
    expect(exported('apps/data/x.json', 'apps')).toBe(true);
    expect(exported('apps/x/node_modules/y.js', 'everything')).toBe(false);
    expect(exported('.adminium/builder/x', 'everything')).toBe(true);
  });
});

describe('a .env that travels', () => {
  it('loses every model and picture line, and keeps the rest as it was', () => {
    expect(envForExport(readFileSync(join(root, '.env'), 'utf8'))).toBe('ADMINIUM_SECRET=the-key\nDATABASE_URL=sqlite:./data/app.sqlite\n# a note\n');
    expect(envForExport('A=1')).toBe('A=1');
    expect(envForExport('')).toBe('');
  });
});

describe('the ZIP', () => {
  const STAMP = { system: 'darwin', chip: 'arm64', engine: '0.3.22', exportedAt: '2026-10-10T10:00:00.000Z' };

  it('holds exactly the list, under one folder named after the project, with a stamp and no key of a model', async () => {
    const to = join(dir, 'out.zip');
    const result = await writeProjectZip({ root, kind: 'everything', to, stamp: STAMP });
    const entries = unzipSync(readFileSync(to));
    const names = Object.keys(entries).sort();
    expect(names).toEqual([...exportList(root, 'everything').map((path) => `juniper-kitchen/${path}`), 'juniper-kitchen/.adminium/export.json'].sort());
    expect(result).toEqual({ files: names.length - 1, bytes: readFileSync(to).length });
    for (const name of names) expect(name.startsWith('juniper-kitchen/') && !name.includes('..')).toBe(true);
    expect(strFromU8(entries['juniper-kitchen/.env'] as Uint8Array)).toBe('ADMINIUM_SECRET=the-key\nDATABASE_URL=sqlite:./data/app.sqlite\n# a note\n');
    expect(JSON.parse(strFromU8(entries['juniper-kitchen/.adminium/export.json'] as Uint8Array))).toEqual({ kind: 'everything', ...STAMP });
    // A large file comes out as it went in.
    expect(strFromU8(entries['juniper-kitchen/data/app.sqlite'] as Uint8Array)).toBe('rows'.repeat(50_000));
    expect(strFromU8(entries['juniper-kitchen/assets/logo.png'] as Uint8Array)).toBe('png-bytes');
    const all = Buffer.from(readFileSync(to)).toString('latin1');
    expect(all).not.toContain('sk-ant-secret');
    expect(all).not.toContain('px-secret');
  });

  it('the apps only: the key, the data and the chats are not in the file at all', async () => {
    const to = join(dir, 'apps.zip');
    await writeProjectZip({ root, kind: 'apps', to, stamp: STAMP });
    const entries = unzipSync(readFileSync(to));
    expect(Object.keys(entries).some((name) => /\/(\.env|data\/|data\.before|\.adminium\/designer\/sessions)/.test(name))).toBe(false);
    expect(JSON.parse(strFromU8(entries['juniper-kitchen/.adminium/export.json'] as Uint8Array))).toMatchObject({ kind: 'apps' });
    const all = Buffer.from(readFileSync(to)).toString('latin1');
    expect(all).not.toContain('the-key');
    expect(all).not.toContain('my card number');
  });

  it('a file that cannot be finished is not left behind', async () => {
    const control = new AbortController();
    control.abort();
    const to = join(dir, 'stopped.zip');
    await expect(writeProjectZip({ root, kind: 'everything', to, stamp: STAMP, signal: control.signal })).rejects.toThrow('The export was stopped.');
    expect(existsSync(to)).toBe(false);
    await expect(writeProjectZip({ root, kind: 'everything', to: join(dir, 'no', 'such', 'folder', 'x.zip'), stamp: STAMP })).rejects.toThrow();
  });

  it('proposes a name from the project’s folder', () => {
    expect(exportFileName(root)).toBe('juniper-kitchen.zip');
  });
});
