// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app pack` and `adminium app try`, on the starter `app new` writes.
 *
 * `try` is the real thing: a whole Adminium composed in this process on a temp
 * folder, the package uploaded and installed through its routes. It is the
 * slow file of the `app` tests, and the one that proves the starter installs.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAddOnTarball } from '../src/add-ons/archive.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { runCli } from '../src/cli/run.js';
import { openRuntime } from '../src/cli/runtime.js';
import { validateManifest } from '@adminium/manifest';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
beforeEach(() => {
  root = tempProject('adminium-app-try-');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  // The real one: `try` composes a whole Adminium on a temp folder.
  Object.assign(deps, { openRuntime });
  const code = await runCli(['app', ...argv], { io, deps });
  return { code, out: io.stdout(), err: io.stderr() };
}

const edit = (file: string, change: (value: Record<string, unknown>) => unknown): void => {
  const path = join(root, file);
  writeFileSync(path, `${JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), null, 2)}\n`);
};

describe.skipIf(!canBuildSides)('adminium app pack', () => {
  it('writes a package the server’s own reader takes: one manifest.json, each side, seeds/', async () => {
    await run('new', 'repairs', '--staff', '--customer');
    const { code, out, err } = await run('pack');
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('Packed repairs 0.1.0 → .adminium/packs/repairs-0.1.0.tgz');

    const file = join(root, '.adminium/packs/repairs-0.1.0.tgz');
    const bytes = new Uint8Array(readFileSync(file));
    const integrity = readFileSync(`${file}.integrity`, 'utf8').trim();
    expect(integrity).toBe(sha512Integrity(bytes));
    expect(out).toContain(`fingerprint: ${integrity}`);

    const files = Object.fromEntries(readAddOnTarball(bytes).map((entry) => [entry.path, entry.bytes]));
    const paths = Object.keys(files).sort();
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('staff/index.html');
    expect(paths).toContain('customer/index.html');
    expect(paths).toContain('staff/surface.json');
    expect(paths).toContain('seeds/sample.json');
    // The parts are composed: the package carries one document, and no part file.
    expect(paths.some((path) => path.startsWith('manifest/'))).toBe(false);
    const manifest = JSON.parse(Buffer.from(files['manifest.json'] as Uint8Array).toString('utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ kind: 'app', key: 'repairs', requiredSchema: { prefixed: true } });
    expect(validateManifest(manifest, { allowLocalPublisher: true }).ok).toBe(true);
  });

  it('packs the same bytes twice, writes where it is told, and packs nothing that fails its check', async () => {
    await run('new', 'repairs');
    await run('pack', '--out', 'out');
    const first = readFileSync(join(root, 'out/repairs-0.1.0.tgz'));
    await run('pack', '--out', 'out');
    expect(readFileSync(join(root, 'out/repairs-0.1.0.tgz')).equals(first)).toBe(true);

    edit('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [{ ref: 'id', type: 'nonsense' }] }));
    rmSync(join(root, 'out'), { recursive: true });
    const failed = await run('pack', '--out', 'out');
    expect(failed.code).toBe(2);
    expect(existsSync(join(root, 'out'))).toBe(false);
  });

  it('refuses a link in seeds/', async () => {
    await run('new', 'repairs');
    symlinkSync(join(root, 'package.json'), join(root, 'apps/repairs/seeds/leak.json'));
    const { code, err } = await run('pack');
    expect(code).toBe(1);
    expect(err).toContain('apps/repairs/seeds/leak.json is a link');
  });
});

describe.skipIf(!canBuildSides)('adminium app try', { timeout: 120_000 }, () => {
  it('installs the starter with both sides on a fresh Adminium, and every probe passes', async () => {
    await run('new', 'repairs', '--staff', '--customer');
    const { code, out, err } = await run('try');
    expect(err).toBe('');
    expect(code).toBe(0);
    for (const line of [
      '✓ a fresh Adminium, with an empty SQLite database',
      '✓ the package uploads (repairs-0.1.0.tgz',
      '✓ the table check passes (2 table(s) to create)',
      '✓ it installs: tables, pages, roles',
      '✓ every page shows its table (2 page(s) made)',
      '✓ the sample data loads',
      '✓ the staff side is served at /apps/repairs/staff/',
      '✓ the staff side can read "items" as the signed-in person',
      '✓ the staff side is refused to someone not signed in',
      '✓ the customer side is served a browser key',
      '✓ the customer side can read "items", as access grants',
      '✓ "items" is refused without the key',
      '✓ the customer side cannot add to "items", which access does not grant',
      '✓ the customer side cannot read "requests", which access does not grant',
      '✓ the customer side may add to "requests", as access grants',
      '✓ the customer side cannot read a table outside the app',
      'Repairs 0.1.0 installs and is served.',
    ]) {
      expect(out).toContain(line);
    }
  });

  it('installs an app that is its tables and pages alone', async () => {
    await run('new', 'repairs');
    const { code, out } = await run('try', '--json');
    expect(code, out).toBe(0);
    const result = JSON.parse(out) as { ok: boolean; steps: { ok: boolean; text: string }[] };
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.text)).toContain('it is listed as installed, with no screens of its own');
  });

  it('fails on a page the install had to create empty, naming it', async () => {
    await run('new', 'repairs');
    // A board needs a status to make its columns from; `requests` has none.
    edit('apps/repairs/manifest/pages/repairs-requests.json', (page) => ({ ...page, template: 'page-board' }));
    const { code, err } = await run('try');
    expect(code).toBe(2);
    expect(err).toMatch(/✗ the page "repairs-requests" shows its table\n\s+.*\(PAGE_UNFIT\)/);
  });

  it('reads an entry that asks for the human check as granted', async () => {
    await run('new', 'repairs', '--customer');
    edit('apps/repairs/manifest/access.json', (access) => ({
      publicAccess: (access['publicAccess'] as Record<string, unknown>[]).map((entry) => (entry['table'] === 'requests' ? { ...entry, humanCheck: true } : entry)),
    }));
    const { code, out, err } = await run('try');
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('✓ the customer side may add to "requests", as access grants (it asks for the human check first)');
  });

  it('stops at the check, before anything is started, when the manifest is wrong', async () => {
    await run('new', 'repairs', '--customer');
    edit('apps/repairs/manifest/access.json', () => ({ publicAccess: [{ table: 'items', methods: ['GET', 'POST'], select: ['id'], writable: ['title'] }] }));
    const { code, out, err } = await run('try');
    expect(code).toBe(2);
    expect(err).toContain('lets anyone add a row, so it may not also let anyone read one');
    expect(out).not.toContain('a fresh Adminium');
  });

  it('fails the try when a screen does not build', async () => {
    await run('new', 'repairs', '--staff');
    mkdirSync(join(root, 'apps/repairs/staff/src'), { recursive: true });
    writeFileSync(join(root, 'apps/repairs/staff/src/main.tsx'), 'const = ;\n');
    const { code, err } = await run('try');
    expect(code).toBe(1);
    expect(err).toContain('Could not build the staff side');
  });
});
