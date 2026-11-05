// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY ADD-ON THAT COMES WITH ADMINIUM INSTALLS FROM THE BYTES IT SHIPS.
 *
 * The build pins each bundled add-on to an exact version and the hash of its
 * published tarball (`scripts/release/add-ons-bundle.json`). This check takes
 * those exact tarballs — fetched and checked against the pins by
 * `scripts/release/fetch-add-ons-bundle.mjs`, the same script the Docker
 * image and the desktop build use — and installs each one the way a server
 * does: the boot seed puts it in the store from the bundle directory, then
 * the install routes install it. An add-on that works with any app is
 * installed alone; one that only attaches to named apps is installed with a
 * minimal app of the first name it gives: required by that app and installed
 * with it, or, when it points at the app's own tables, added to it after.
 *
 * On each engine it asks that the install answers 200, the add-on's row says
 * `installed` (every stage ran, the seeds among them), and each table the
 * add-on fills at install holds exactly the rows its manifest declares (the
 * one settings row when it keeps settings and seeds none).
 *
 * A tarball missing a file its manifest names (Holiday Calendars 1.0.16 and
 * 1.0.17 shipped without `seeds/holidays.json`) fails here at the seeds stage.
 *
 * It downloads, so it runs only when `ADMINIUM_CHECK_BUNDLED_ADD_ONS` names
 * the directory to fetch into (kept between runs: a tarball already there that
 * matches its pin is not fetched again). The release workflow sets it
 * (`pnpm bundled-add-ons-check`); without it the suite is skipped, by name.
 *
 * SQLite always; Postgres with TEST_POSTGRES_URL, MySQL with TEST_MYSQL_URL.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { appTablesRepo } from '@adminium/meta';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { seedBundledPackages } from '../src/add-ons/store.js';
import { addOnHarness, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

type Doc = Record<string, unknown>;
interface Pin {
  key: string;
  version: string;
  integrity: string;
}
interface Attach {
  app: string;
  range?: string;
  table?: string;
}

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const FETCH = join(REPO, 'scripts', 'release', 'fetch-add-ons-bundle.mjs');
const PINS: Pin[] = (JSON.parse(readFileSync(join(REPO, 'scripts', 'release', 'add-ons-bundle.json'), 'utf8')) as { addOns: Pin[] }).addOns;

/** Where the pinned tarballs are fetched to, relative to the repository when not absolute; unset, nothing runs. */
const ASKED = process.env['ADMINIUM_CHECK_BUNDLED_ADD_ONS'];
const DIR = ASKED === undefined || ASKED === '' ? null : resolve(REPO, ASKED);

/** The lowest version a range names: the version the minimal host app is given. `*` is any, so 0.1.0. */
function lowestOf(range: string | undefined): string {
  return /\d+\.\d+\.\d+/.exec(range ?? '')?.[0] ?? '0.1.0';
}

/**
 * How it is installed: alone when it attaches to any app without asking for a
 * table; else with a minimal app of the first name it gives. The app holds
 * every table of its own the add-on points at (a key column, a
 * `records:<table>` scope, a table it attaches by); `pointed` lists them.
 */
function hostFor(manifest: Doc): { key: string; version: string; tables: string[]; pointed: string[] } | null {
  const addOn = (manifest['addOn'] ?? {}) as { attaches?: Attach[]; scopes?: string[] };
  const attaches = addOn.attaches ?? [];
  if (attaches.some((one) => one.app === '*' && one.table === undefined)) return null;
  const named = attaches.find((one) => one.app !== '*');
  if (named === undefined) throw new Error(`${String(manifest['key'])} attaches to no app this check can stand up`);
  const own = ((manifest['requiredSchema'] as { tables?: { ref: string; columns: { references?: string }[] }[] } | undefined)?.tables ?? []);
  const owned = new Set(own.map((table) => table.ref));
  const pointed = [
    ...own.flatMap((table) => table.columns.flatMap((column) => (column.references === undefined ? [] : [column.references]))),
    ...(addOn.scopes ?? []).flatMap((scope) => /^records:([a-z0-9_]+):/.exec(scope)?.slice(1) ?? []),
    ...attaches.flatMap((one) => (one.table === undefined ? [] : [one.table])),
  ];
  const theirs = [...new Set(pointed)].filter((ref) => !owned.has(ref)).sort();
  return { key: named.app, version: lowestOf(named.range), tables: [...new Set(['jobs', ...theirs])].sort(), pointed: theirs };
}

describe('the bundled add-on pins', () => {
  it.skipIf(DIR === null)('are fetched and match every pinned hash', () => {
    // A child process: the fetch is the release script itself, and this test process stops any call to adminium.dev.
    const fetched = spawnSync(process.execPath, [FETCH, DIR!], { encoding: 'utf8' });
    expect(fetched.status, `${fetched.stdout}\n${fetched.stderr}`).toBe(0);
  });
});

describe.each(ENGINES)('every bundled add-on installs from its pinned tarball — %s', (dialect, available) => {
  const runs = available && DIR !== null;
  let h: Harness | null = null;

  beforeAll(() => {
    if (!runs) return;
    // Every engine's suite fetches for itself (idempotent), so one engine can be run alone.
    const fetched = spawnSync(process.execPath, [FETCH, DIR!], { encoding: 'utf8' });
    if (fetched.status !== 0) throw new Error(`fetching the bundled add-ons failed:\n${fetched.stdout}\n${fetched.stderr}`);
  }, 300_000);

  afterEach(async () => {
    await h?.close();
    h = null;
  });

  it.skipIf(!runs).each(PINS.map((pin) => [`${pin.key} ${pin.version}`, pin] as const))('%s', async (_name, pin) => {
    h = await addOnHarness(dialect);
    const tarball = `${pin.key}-${pin.version}.tgz`;
    // Only this package in the bundle directory: the boot seed stages it, its hash checked again, and records it as vouched for.
    await copyFile(join(DIR!, tarball), join(h.bundledDir, tarball));
    await copyFile(join(DIR!, `${tarball}.integrity`), join(h.bundledDir, `${tarball}.integrity`));
    const meta = h.meta;
    const seeded = await seedBundledPackages(h.addOnStore, h.bundledDir, () => undefined, 'add-on', (pkg) => recordDeciderTrust(meta, pkg));
    expect(seeded).toEqual({ seeded: [`${pin.key}@${pin.version}`], skipped: [], failed: [] });
    expect((await readFile(join(h.bundledDir, `${tarball}.integrity`), 'utf8')).trim()).toBe(pin.integrity);

    const manifest = JSON.parse((await h.addOnStore.readFile(pin.key, pin.version, 'manifest.json')).toString('utf8')) as Doc;
    expect(manifest['version']).toBe(pin.version);
    const host = hostFor(manifest);
    if (host === null) {
      const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: pin.key, version: pin.version, attachTo: [] } });
      expect(res.statusCode, res.body).toBe(200);
    } else {
      const tables = host.tables.map((ref) => ({ ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', nullable: true }] }));
      if (host.pointed.length === 0) {
        // Installed with the app that requires it, as an owner installing that app gets it: the add-on before the app's tables.
        const requires = [{ key: pin.key, range: pin.version, reason: { 'en-US': 'Comes with it.' } }];
        await h.stageApp(appManifest(host.key, { version: host.version, requiredSchema: { tables }, addOns: { requires } }));
        const res = await h.install(host.key, host.version);
        expect(res.statusCode, res.body).toBe(200);
        expect((res.json() as { addOns: { installed: { key: string }[] } }).addOns.installed.map((one) => one.key)).toEqual([pin.key]);
      } else {
        // It points at the app's own tables, so the app is there first and the add-on is added to it.
        await h.stageApp(appManifest(host.key, { version: host.version, requiredSchema: { tables } }));
        const app = await h.install(host.key, host.version);
        expect(app.statusCode, app.body).toBe(200);
        const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: pin.key, version: pin.version, attachTo: [host.key] } });
        expect(res.statusCode, res.body).toBe(200);
      }
    }

    const row = await meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', pin.key).executeTakeFirst();
    expect(row).toEqual({ version: pin.version, status: 'installed' });

    // The rows each table starts with: its seeds (inline, or the file the package carries), and the one settings row.
    const expected = new Map<string, number>();
    for (const seed of (manifest['seeds'] ?? []) as { table: string; rows?: unknown[]; file?: string }[]) {
      const rows = seed.rows ?? (JSON.parse((await h.addOnStore.readFile(pin.key, pin.version, seed.file!)).toString('utf8')) as unknown[]);
      expected.set(seed.table, (expected.get(seed.table) ?? 0) + rows.length);
    }
    const settings = (manifest['addOn'] as { settingsTable?: string }).settingsTable;
    if (settings !== undefined && !expected.has(settings)) expected.set(settings, 1);
    const records = await appTablesRepo(meta).forInstall(h.connectionId, pin.key);
    const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
    const held: Record<string, number> = {};
    for (const ref of expected.keys()) {
      const record = records.find((one) => one.ref === ref);
      if (record === undefined) throw new Error(`${pin.key} keeps no record of its table "${ref}"`);
      held[ref] = Number((await h.rows(`select count(*) as n from ${q(record.tableName)}`))[0]!['n']);
    }
    expect(held).toEqual(Object.fromEntries(expected));
  }, 120_000);
});
