// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in email templates are seeded once per release and translation
 * change, not on every start: the seed loads every locale's words, and they
 * stay in memory. A start with the same release, the same translation stamp
 * and every built-in row present seeds nothing; a new release, a changed
 * override or a missing row seeds again. Without a release (a checkout) it
 * seeds every time, as it always did.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import { emailTemplatesRepo, settingsRepo, translationsRepo } from '@adminium/meta';

import { BUILTIN_EMAIL_TEMPLATE_KEYS, seedBuiltinEmailTemplatesIfChanged } from '../src/email/builtins.js';
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
