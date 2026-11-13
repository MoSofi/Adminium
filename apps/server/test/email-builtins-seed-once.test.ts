// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in email templates are seeded once per release and translation
 * change, not on every start: the seed loads every locale's words, and they
 * stay in memory. A start with the same release, the same translation stamp
 * and every built-in row present seeds nothing; a new release, a changed
 * override or a missing row seeds again. Without a release (a checkout) it
 * seeds every time, as it always did. What it seeded from is this server's
 * own state: no config export, archive or Export everything carries it.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import { createSqliteMetaDb, emailTemplatesRepo, firstRun, isPortableSettingKey, settingsRepo, translationsRepo } from '@adminium/meta';

import { sanitizeDump } from '../src/archive/policy.js';
import { BUILTIN_EMAIL_TEMPLATE_KEYS, seedBuiltinEmailTemplatesIfChanged } from '../src/email/builtins.js';
import { resourcePath } from '../src/export/bundle.js';
import { importZip } from '../src/export/import-service.js';
import { exportZip } from '../src/export/zip-service.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const ALL_ROWS = BUILTIN_EMAIL_TEMPLATE_KEYS.length * BUILTIN_LOCALE_IDS.length;

describe.each(META_ENGINES)('the built-in email templates seed once — $name', (engine) => {
  let handle: MetaHandle;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    await handle.meta.db.deleteFrom('adminium_email_templates').execute();
    await handle.meta.db.deleteFrom('adminium_translations').execute();
    await handle.meta.db.deleteFrom('adminium_settings').where('key', 'in', ['email.builtinsSeededFor', 'i18n.version']).execute();
  });

  const count = async (): Promise<number> => (await emailTemplatesRepo(handle.meta).list()).length;

  it.skipIf(!engine.available)('seeds a fresh store and records what it seeded from', async () => {
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 1_000)).toBe(true);
    expect(await count()).toBe(ALL_ROWS);
    expect(await settingsRepo(handle.meta).get('email.builtinsSeededFor')).toBe('1.2.3+0');
  });

  it.skipIf(!engine.available)('skips a second start of the same release', async () => {
    await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 1_000);
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 2_000)).toBe(false);
  });

  it.skipIf(!engine.available)('seeds again for a new release', async () => {
    await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 1_000);
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.4', 2_000)).toBe(true);
    expect(await settingsRepo(handle.meta).get('email.builtinsSeededFor')).toBe('1.2.4+0');
  });

  it.skipIf(!engine.available)('seeds again once an override changes the words, and the template carries them', async () => {
    await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 1_000);
    await translationsRepo(handle.meta).upsert({ locale: 'en_US', namespace: 'email', key: 'passwordReset.subject', value: 'Your new password link' }, { at: 1_500 });
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 2_000)).toBe(true);
    const row = await emailTemplatesRepo(handle.meta).findByKeyLocale('password-reset', 'en_US');
    expect(row?.subject).toBe('Your new password link');
  });

  it.skipIf(!engine.available)('seeds again when a built-in row is missing', async () => {
    await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 1_000);
    await handle.meta.db.deleteFrom('adminium_email_templates').where('key', '=', 'password-reset').where('locale', '=', 'de_DE').execute();
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, '1.2.3', 2_000)).toBe(true);
    expect(await count()).toBe(ALL_ROWS);
  });

  it.skipIf(!engine.available)('seeds every time without a release', async () => {
    await seedBuiltinEmailTemplatesIfChanged(handle.meta, null, 1_000);
    expect(await seedBuiltinEmailTemplatesIfChanged(handle.meta, null, 2_000)).toBe(true);
    expect(await settingsRepo(handle.meta).get('email.builtinsSeededFor')).toBeNull();
  });
});

describe('what the seed ran from never travels', () => {
  const SETTING = 'email.builtinsSeededFor';

  it('is not portable', () => {
    expect(isPortableSettingKey(SETTING)).toBe(false);
  });

  it('is not in an archive or an Export everything file, and a restore never writes it', () => {
    for (const kind of ['full', 'export'] as const) {
      const tables = new Map([
        [
          'adminium_settings',
          {
            table: 'adminium_settings',
            kinds: {},
            columns: ['key', 'value', 'updatedAt'],
            rows: [
              [SETTING, '"1.2.3+0"', 1],
              ['branding.appName', '"Hollis Bakery"', 1],
            ],
          },
        ],
      ]);
      const report = sanitizeDump(tables, { kind, dialect: 'sqlite' });
      expect(report.droppedSettings, kind).toContain(SETTING);
      expect(tables.get('adminium_settings')?.rows.map((row) => row[0]), kind).toEqual(['branding.appName']);
    }
  });

  it('is not in a config export, and a bundle carrying it is not imported', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adminium-seed-stamp-'));
    const source = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    const target = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    try {
      await firstRun(source);
      await firstRun(target);
      await settingsRepo(source).set(SETTING, '1.2.3+0');
      await settingsRepo(source).set('branding.appName', 'Hollis Bakery');
      const out = join(dir, 'bundle.zip');
      await exportZip({ meta: source, outPath: out, dataDir: dir });
      const entries = unzipSync(new Uint8Array(await readFile(out)));
      const settings = JSON.parse(strFromU8(entries[resourcePath('settings')] as Uint8Array)) as { key: string; value: unknown }[];
      expect(settings.map((row) => row.key)).toContain('branding.appName');
      expect(settings.map((row) => row.key)).not.toContain(SETTING);

      // A bundle someone wrote by hand to carry it.
      entries[resourcePath('settings')] = new TextEncoder().encode(JSON.stringify([...settings, { key: SETTING, value: '9.9.9+0' }]));
      const crafted = join(dir, 'crafted.zip');
      await writeFile(crafted, zipSync(entries));
      const result = await importZip({ meta: target, inPath: crafted });
      expect(await settingsRepo(target).get('branding.appName')).toBe('Hollis Bakery');
      expect(await settingsRepo(target).get(SETTING)).toBeNull();
      expect(result.warnings.join('\n')).toContain(SETTING);
    } finally {
      await source.db.destroy();
      await target.db.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
