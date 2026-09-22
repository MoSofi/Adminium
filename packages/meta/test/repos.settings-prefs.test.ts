// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  MetaValidationError,
  UnknownSettingError,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type SettingKey,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`settingsRepo + userPrefsRepo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);


    it('falls back to registry defaults when no override is stored', async () => {
      const settings = settingsRepo(meta());
      expect(await settings.get('appearance.accent')).toBe('indigo');
      expect(await settings.get('appearance.theme')).toBe('system');
      expect(await settings.get('locale.default')).toBe('en_US');
      expect(await settings.get('auth.sessionTtlHours')).toBe(720);
      expect(await settings.get('retention.exportsDays')).toBe(30);
      expect(await settings.overrides()).toEqual({});
    });

    it('stores validated overrides and returns them; unset restores the default', async () => {
      const settings = settingsRepo(meta());
      await settings.set('appearance.accent', 'violet', { at: T0 });
      expect(await settings.get('appearance.accent')).toBe('violet');
      expect(await settings.overrides()).toEqual({ 'appearance.accent': 'violet' });

      await settings.set('appearance.accent', 'teal', { at: T0 + 1 }); // upsert
      expect(await settings.get('appearance.accent')).toBe('teal');

      expect(await settings.unset('appearance.accent')).toBe(true);
      expect(await settings.get('appearance.accent')).toBe('indigo');
    });

    it('reads back a typed name that is itself JSON text as that string', async () => {
      // Postgres and MySQL hand a stored `"2048"` back as the string `2048`.
      // `readJson` parsed that into the NUMBER 2048, so `get` threw on the
      // setting's own schema and `overrides()` dropped the row. SQLite keeps
      // the serialized text and never showed it.
      const settings = settingsRepo(meta());
      for (const name of ['2048', 'true', 'null', '[1]', '{"a":1}', '"quoted"']) {
        await settings.set('branding.appName', name, { at: T0 });
        const read = await settings.get('branding.appName');
        expect(typeof read).toBe('string');
        expect(read).toBe(name);
        const stored = (await settings.overrides())['branding.appName'];
        expect(typeof stored).toBe('string');
        expect(stored).toBe(name);
      }
      await settings.set('assistant.name', '42', { at: T0 });
      expect(typeof (await settings.get('assistant.name'))).toBe('string');
    });

    it('reads back every stored shape as the type it was written', async () => {
      const settings = settingsRepo(meta());
      await settings.set('auth.sessionTtlHours', 48, { at: T0 });
      await settings.set('branding.showVersion', false, { at: T0 });
      await settings.set('branding.logoFileId', null, { at: T0 });
      await settings.set('system.seededRoleGrants', ['admin:x'], { at: T0 });

      const ttl = await settings.get('auth.sessionTtlHours');
      expect(typeof ttl).toBe('number');
      expect(ttl).toBe(48);
      const showVersion = await settings.get('branding.showVersion');
      expect(typeof showVersion).toBe('boolean');
      expect(showVersion).toBe(false);
      expect(await settings.get('branding.logoFileId')).toBeNull();
      expect(await settings.get('system.seededRoleGrants')).toEqual(['admin:x']);
      expect(await settings.overrides()).toEqual({
        'auth.sessionTtlHours': 48,
        'branding.showVersion': false,
        'branding.logoFileId': null,
        'system.seededRoleGrants': ['admin:x'],
      });
    });

    it('rejects invalid values and unknown keys', async () => {
      const settings = settingsRepo(meta());
      await expect(settings.set('appearance.accent', 'magenta' as never)).rejects.toThrow(MetaValidationError);
      await expect(settings.set('auth.sessionTtlHours', 0)).rejects.toThrow(MetaValidationError);
      await expect(settings.get('nope.key' as SettingKey)).rejects.toThrow(UnknownSettingError);
    });

    it('user prefs upsert with NULL = inherit and enum validation', async () => {
      const users = usersRepo(meta());
      const prefs = userPrefsRepo(meta());
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      expect(await prefs.get(u.id)).toBeNull();
      const row = await prefs.set(u.id, { theme: 'dark', uiState: { sidebar: 'collapsed' } }, T0);
      expect(row.theme).toBe('dark');
      expect(row.accent).toBeNull();
      expect(row.uiState).toEqual({ sidebar: 'collapsed' });

      await prefs.set(u.id, { theme: null }, T0 + 1); // clear = inherit again
      expect((await prefs.get(u.id))?.theme).toBeNull();

      await expect(prefs.set(u.id, { accent: 'chartreuse' as never })).rejects.toThrow(MetaValidationError);
    });

    it('resolves BRIEF order: system default → global override → user override', async () => {
      const users = usersRepo(meta());
      const settings = settingsRepo(meta());
      const prefs = userPrefsRepo(meta());
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      // Fresh install: all system.
      let resolved = await prefs.resolve(u.id);
      expect(resolved).toMatchObject({ theme: 'system', accent: 'indigo', density: 'comfortable', locale: 'en_US', dir: 'ltr' });
      expect(resolved.source.accent).toBe('system');

      // Global override applies to users without an explicit axis.
      await settings.set('appearance.accent', 'rose', { at: T0 });
      resolved = await prefs.resolve(u.id);
      expect(resolved.accent).toBe('rose');
      expect(resolved.source.accent).toBe('global');

      // User override wins.
      await prefs.set(u.id, { accent: 'black' }, T0 + 1);
      resolved = await prefs.resolve(u.id);
      expect(resolved.accent).toBe('black');
      expect(resolved.source.accent).toBe('user');

      // Clearing the user axis re-inherits the global value without other writes.
      await prefs.set(u.id, { accent: null }, T0 + 2);
      resolved = await prefs.resolve(u.id);
      expect(resolved.accent).toBe('rose');
      expect(resolved.source.accent).toBe('global');
    });

    it('derives dir from locale (ar_EG → rtl) unless explicitly overridden', async () => {
      const users = usersRepo(meta());
      const prefs = userPrefsRepo(meta());
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      await prefs.set(u.id, { locale: 'ar_EG' }, T0);
      let resolved = await prefs.resolve(u.id);
      expect(resolved.dir).toBe('rtl');

      await prefs.set(u.id, { dir: 'ltr' }, T0 + 1);
      resolved = await prefs.resolve(u.id);
      expect(resolved.dir).toBe('ltr');
      expect(resolved.source.dir).toBe('user');
    });

    it('resolves for anonymous (null user) from globals only', async () => {
      const settings = settingsRepo(meta());
      const prefs = userPrefsRepo(meta());
      await settings.set('appearance.theme', 'dark', { at: T0 });
      const resolved = await prefs.resolve(null);
      expect(resolved.theme).toBe('dark');
      expect(resolved.source.theme).toBe('global');
    });
  });
}
